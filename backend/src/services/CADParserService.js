const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const DxfParser = require('dxf-parser');

const DWG_VERSIONS = {
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000/2000i/2002',
  AC1018: 'AutoCAD 2004/2005/2006',
  AC1021: 'AutoCAD 2007/2008/2009',
  AC1024: 'AutoCAD 2010/2011/2012',
  AC1027: 'AutoCAD 2013/2014/2015/2016/2017',
  AC1032: 'AutoCAD 2018/2019/2020/2021/2022/2023/2024'
};

class CADParserService {
  constructor() {
    this.dwgConverterPromise = null;
    this.occtPromise = null;
    // dwgdxf 的默认本地路径在 Windows 下会指向其构建环境；显式指向已安装包的 WASM 资源。
    this.dwgWasmBase = pathToFileURL(path.join(path.dirname(require.resolve('dwgdxf')), 'wasm')).href;
  }

  async parseDXF(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this._parseDXFContent(content);
    } catch (error) {
      console.error('DXF解析失败:', error);
      return {
        success: false,
        error: error.message || 'DXF解析失败'
      };
    }
  }

  _parseDXFContent(content) {
    const parser = new DxfParser();
    const dxf = parser.parseSync(content);
    const entitySummary = this._summarizeEntities(dxf.entities || []);
    const bounds = this._calculateBounds(dxf.entities || []);

    const modelSpec = this._buildParametricModelSpec(entitySummary.features, bounds);

    return {
      success: true,
      format: 'DXF',
      message: 'DXF文件解析成功',
      entityCount: entitySummary.totalEntities,
      entitySummary,
      bounds,
      features: entitySummary.features,
      modelSpec,
      modelInfo: modelSpec
        ? { type: 'parametric', source: '2d_drawing', label: '二维图纸推断模型', available: true }
        : { type: 'none', source: '2d_drawing', label: '未找到可拉伸的闭合轮廓', available: false }
    };
  }

  async parseSTEP(filePath) {
    try {
      const occt = await this._getOCCT();
      const stepBytes = new Uint8Array(fs.readFileSync(filePath));
      const imported = occt.ReadStepFile(stepBytes, {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.001,
        angularDeflection: 0.5
      });

      if (!imported?.success || !imported.meshes?.length) {
        throw new Error(imported?.error || 'STEP 文件中未读取到可渲染的网格');
      }

      const meshes = imported.meshes
        .map(mesh => this._serializeMesh(mesh))
        .filter(mesh => mesh.positions.length >= 9 && mesh.indices.length >= 3);

      if (!meshes.length) {
        throw new Error('STEP 网格数据为空');
      }
      const features = this._extractStepFeatures(meshes);

      return {
        success: true,
        format: 'STEP',
        message: `STEP 文件解析成功，已提取 ${meshes.length} 个三维网格和 ${features.length} 项结构特征`,
        bounds: this._calculateMeshBounds(meshes),
        entityCount: features.length,
        features,
        model: { meshes },
        modelInfo: { type: 'mesh', source: 'step', label: '原始三维模型', available: true }
      };
    } catch (error) {
      console.error('STEP解析失败:', error);
      return {
        success: false,
        error: 'STEP解析失败'
      };
    }
  }

  /**
   * 使用项目依赖 dwgdxf（WebAssembly）在进程内将 DWG 转为 DXF，
   * 不需要在服务器上另行安装 ODA 或 AutoCAD。
   */
  async parseDWG(filePath) {
    const version = this._getDWGVersion(filePath);
    if (!version) {
      return { success: false, error: '文件不是有效的 DWG 文件（未找到 AC10xx 文件头）' };
    }

    try {
      const converter = await this._getDWGConverter();
      const dwgBytes = new Uint8Array(fs.readFileSync(filePath));
      const dxfBytes = await converter.convertDwgToDxf(dwgBytes);
      const result = this._parseDXFContent(Buffer.from(dxfBytes).toString('utf8'));

      return {
        ...result,
        format: 'DWG',
        sourceFormat: 'DWG',
        dwgVersion: DWG_VERSIONS[version] || version,
        message: `DWG 文件已转换为 DXF 并解析成功（${DWG_VERSIONS[version] || version}）`
      };
    } catch (error) {
      console.error('DWG解析失败:', error.message || error);
      return {
        success: false,
        error: `DWG 转换失败: ${error.message || '未知错误'}`
      };
    }
  }

  async _getDWGConverter() {
    if (!this.dwgConverterPromise) {
      this.dwgConverterPromise = import('dwgdxf').then(async converter => {
        await converter.init({ wasmBase: this.dwgWasmBase });
        return converter;
      });
    }
    return this.dwgConverterPromise;
  }

  async _getOCCT() {
    if (!this.occtPromise) {
      this.occtPromise = require('occt-import-js')();
    }
    return this.occtPromise;
  }

  _serializeMesh(mesh) {
    const flatten = values => {
      if (!values) return [];
      const raw = Array.from(values);
      return Array.isArray(raw[0]) ? raw.flat() : raw;
    };
    const color = Array.isArray(mesh.color)
      ? mesh.color.slice(0, 3).map(value => value > 1 ? value / 255 : value)
      : [0.55, 0.68, 0.78];

    return {
      name: mesh.name || 'STEP Mesh',
      color,
      positions: flatten(mesh.attributes?.position?.array),
      normals: flatten(mesh.attributes?.normal?.array),
      indices: flatten(mesh.index?.array),
      faces: (mesh.brep_faces || []).map((face, index) => ({
        index,
        firstTriangle: face.first,
        lastTriangle: face.last,
        color: Array.isArray(face.color) ? face.color.slice(0, 3).map(value => value > 1 ? value / 255 : value) : null
      }))
    };
  }

  _extractStepFeatures(meshes) {
    const features = [];
    meshes.forEach((mesh, meshIndex) => {
      const triangleCount = Math.floor(mesh.indices.length / 3);
      features.push({
        type: '三维零件',
        description: `${mesh.name}（${triangleCount} 个三角面）`,
        data: { meshIndex, triangleCount, faceCount: mesh.faces.length, position: this._meshCenter(mesh) }
      });

      mesh.faces.slice(0, 500).forEach(face => {
        const triangleCount = Math.max((face.lastTriangle ?? 0) - (face.firstTriangle ?? 0) + 1, 0);
        features.push({
          type: 'B-Rep 面',
          description: `${mesh.name} · 面 #${face.index + 1}（${triangleCount} 个三角面）`,
          data: { meshIndex, faceIndex: face.index, triangleCount, position: this._faceCenter(mesh, face) }
        });
      });
    });
    return features;
  }

  _meshCenter(mesh) {
    const positions = mesh.positions;
    if (!positions.length) return null;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < positions.length; i += 3) {
      x += positions[i]; y += positions[i + 1]; z += positions[i + 2];
    }
    const count = positions.length / 3;
    return { x: x / count, y: y / count, z: z / count };
  }

  _faceCenter(mesh, face) {
    const indexes = mesh.indices;
    const positions = mesh.positions;
    const start = Math.max(0, (face.firstTriangle || 0) * 3);
    const end = Math.min(indexes.length, ((face.lastTriangle ?? face.firstTriangle ?? 0) + 1) * 3);
    if (start >= end) return this._meshCenter(mesh);

    let x = 0, y = 0, z = 0, count = 0;
    for (let i = start; i < end; i++) {
      const positionIndex = indexes[i] * 3;
      x += positions[positionIndex];
      y += positions[positionIndex + 1];
      z += positions[positionIndex + 2];
      count += 1;
    }
    return count ? { x: x / count, y: y / count, z: z / count } : this._meshCenter(mesh);
  }

  _calculateMeshBounds(meshes) {
    const coords = meshes.flatMap(mesh => mesh.positions);
    if (!coords.length) return null;
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < coords.length; i += 3) {
      xs.push(coords[i]);
      ys.push(coords[i + 1]);
      zs.push(coords[i + 2]);
    }
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      depth: Math.max(...zs) - Math.min(...zs)
    };
  }

  _getDWGVersion(filePath) {
    const buffer = Buffer.alloc(6);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, 6, 0);
      const signature = buffer.toString('ascii');
      return signature.startsWith('AC10') ? signature : null;
    } finally {
      fs.closeSync(fd);
    }
  }

  _summarizeEntities(entities) {
    const summary = {
      totalEntities: entities.length,
      line: 0,
      circle: 0,
      arc: 0,
      lwpolyline: 0,
      polyline: 0,
      text: 0,
      mtext: 0,
      dimensions: 0,
      other: 0,
      features: []
    };

    entities.forEach(entity => {
      const type = entity.type;
      if (!type) return;

      if (summary[type] !== undefined) {
        summary[type] += 1;
      } else {
        summary.other += 1;
      }

      // LINE: dxf-parser uses vertices array, not start/end
      if (type === 'LINE') {
        const v = entity.vertices || [];
        if (v.length >= 2) {
          summary.features.push({
            type: '直线',
            description: `起点 (${v[0].x.toFixed(2)}, ${v[0].y.toFixed(2)}), 终点 (${v[1].x.toFixed(2)}, ${v[1].y.toFixed(2)})`,
            data: { x1: v[0].x, y1: v[0].y, x2: v[1].x, y2: v[1].y }
          });
        }
      }

      // CIRCLE: entity.center
      if (type === 'CIRCLE' && entity.center) {
        const r = entity.radius != null ? entity.radius : 0;
        summary.features.push({
          type: '圆',
          description: `圆心 (${entity.center.x.toFixed(2)}, ${entity.center.y.toFixed(2)}), 半径 ${r.toFixed(2)}`,
          data: { cx: entity.center.x, cy: entity.center.y, r }
        });
      }

      // ARC: entity.center
      if (type === 'ARC' && entity.center) {
        const r = entity.radius != null ? entity.radius : 0;
        const sa = entity.startAngle != null ? entity.startAngle : 0;
        const ea = entity.endAngle != null ? entity.endAngle : 0;
        summary.features.push({
          type: '圆弧',
          description: `圆心 (${entity.center.x.toFixed(2)}, ${entity.center.y.toFixed(2)}), 半径 ${r.toFixed(2)}, 角度 ${sa.toFixed(0)}°-${ea.toFixed(0)}°`,
          data: { cx: entity.center.x, cy: entity.center.y, r, startAngle: sa, endAngle: ea }
        });
      }

      if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const vertices = entity.vertices || [];
        const closed = this._isClosedPolyline(entity, vertices);
        summary.features.push({
          type: '多段线',
          description: `顶点 ${vertices.length} 个${closed ? '（闭合轮廓）' : ''}`,
          data: {
            vertexCount: vertices.length,
            closed,
            vertices: vertices.map(v => ({ x: v.x, y: v.y }))
          }
        });
      }

      // TEXT: dxf-parser uses startPoint; MTEXT: uses position
      if (type === 'TEXT' || type === 'MTEXT') {
        const text = entity.text || entity.value || '';
        summary.features.push({
          type: '文本',
          description: text.trim() || '无文本内容'
        });
      }
    });

    return summary;
  }

  _isClosedPolyline(entity, vertices) {
    if (entity.shape === true || (entity.flags & 1) === 1) return true;
    if (vertices.length < 3) return false;
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    return first.x === last.x && first.y === last.y;
  }

  _buildParametricModelSpec(features, bounds) {
    const candidates = features
      .filter(feature => feature.type === '多段线' && feature.data?.closed && feature.data.vertices.length >= 3)
      .map(feature => ({ vertices: feature.data.vertices, area: Math.abs(this._polygonArea(feature.data.vertices)) }))
      .filter(candidate => candidate.area > 0)
      .sort((a, b) => b.area - a.area);

    if (!candidates.length) return null;

    const outline = candidates[0].vertices;
    const holes = features
      .filter(feature => feature.type === '圆' && feature.data?.r > 0)
      .filter(feature => this._isPointInPolygon(feature.data.cx, feature.data.cy, outline))
      .map(feature => ({ type: 'circle', cx: feature.data.cx, cy: feature.data.cy, r: feature.data.r }));

    return {
      outline,
      holes,
      bounds,
      instruction: '由二维闭合轮廓和内部圆孔拉伸生成；请确认厚度与孔位。'
    };
  }

  _polygonArea(vertices) {
    return vertices.reduce((area, vertex, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return area + vertex.x * next.y - next.x * vertex.y;
    }, 0) / 2;
  }

  _isPointInPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  _calculateBounds(entities) {
    const coords = [];

    const addPoint = point => {
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        coords.push(point);
      }
    };

    entities.forEach(entity => {
      switch (entity.type) {
        case 'LINE':
          // dxf-parser: LINE has vertices array
          (entity.vertices || []).forEach(v => addPoint(v));
          break;
        case 'CIRCLE':
        case 'ARC':
          addPoint(entity.center);
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE':
          (entity.vertices || []).forEach(v => addPoint(v));
          break;
        case 'TEXT':
          // TEXT uses startPoint
          addPoint(entity.startPoint);
          break;
        case 'MTEXT':
          // MTEXT uses position
          addPoint(entity.position);
          break;
        case 'INSERT':
          addPoint(entity.position);
          break;
        default:
          break;
      }
    });

    if (!coords.length) {
      return null;
    }

    const xs = coords.map(p => p.x);
    const ys = coords.map(p => p.y);

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    };
  }

  async generatePreviewFromDXF(dxfData, outputPath) {
    try {
      return { success: true, outputPath };
    } catch (error) {
      console.error('生成预览图失败:', error);
      return { success: false, error: error.message };
    }
  }

  generateSimpleSVG(dxfData, width, height) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="white"/>
      <text x="10" y="30" font-size="16" fill="gray">图纸已上传</text>
    </svg>`;
  }

  getFileInfo(filePath) {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    return {
      name: path.basename(filePath),
      size: stats.size,
      format: ext.slice(1),
      createdAt: stats.birthtime
    };
  }
}

module.exports = new CADParserService();
