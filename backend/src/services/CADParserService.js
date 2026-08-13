const fs = require('fs');
const fsp = fs.promises;
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

// DXF DIMENSION 实体 dimensionType(组码70) 低 3 位表示类型
const DIMENSION_TYPE_MAP = {
  0: '线性', 1: '对齐', 2: '角度', 3: '直径', 4: '半径', 5: '角度(三点)', 6: '坐标'
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
      const content = await fsp.readFile(filePath, 'utf8');
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
    const entities = dxf.entities || [];
    const header = dxf.header || {};
    const entitySummary = this._summarizeEntities(entities);
    const model = this._extractDxf3DModel(entities);
    const bounds = model ? this._calculateDxf3DBounds(model) : this._calculateBounds(entities);
    const dimensionAnnotations = this._extractDimensions(entities, header);
    const globalTolerance = this._extractGlobalTolerance(header);

    return {
      success: true,
      format: 'DXF',
      message: 'DXF文件解析成功',
      entityCount: entitySummary.totalEntities,
      entitySummary,
      bounds,
      features: entitySummary.features,
      dimensionAnnotations,
      globalTolerance,
      ...(model ? { model } : {}),
      // 以实体数据而非文件扩展名判断维度：仅有二维图元时保留其原始平面；检测到三维面或 Z 坐标路径时才进入三维渲染。
      modelInfo: model
        ? { type: 'mesh', source: 'dxf_3d', label: 'DXF/DWG 原始三维数据', available: true }
        : { type: 'drawing2d', source: '2d_drawing', label: '二维原始平面图', available: true }
    };
  }

  async parseSTEP(filePath) {
    try {
      const occt = await this._getOCCT();
      const stepBytes = new Uint8Array(await fsp.readFile(filePath));
      // 网格密度可配置：默认 0.005(包围盒 0.5%)，比 0.001 减面约 5x，预览足够；大件可经 env 调大
      const linearDeflection = Number(process.env.STEP_LINEAR_DEFLECTION) || 0.005;
      const angularDeflection = Number(process.env.STEP_ANGULAR_DEFLECTION) || 0.5;
      const imported = occt.ReadStepFile(stepBytes, {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection,
        angularDeflection
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
        dimensionAnnotations: [],
        model: { meshes },
        modelInfo: { type: 'mesh', source: 'step', label: '原始三维模型', available: true }
      };
    } catch (error) {
      console.error('STEP解析失败:', error);
      return {
        success: false,
        error: `STEP解析失败: ${error.message || error}`
      };
    }
  }

  /**
   * 使用项目依赖 dwgdxf（WebAssembly）在进程内将 DWG 转为 DXF，
   * 不需要在服务器上另行安装 ODA 或 AutoCAD。
   */
  async parseDWG(filePath) {
    const version = await this._getDWGVersion(filePath);
    if (!version) {
      return { success: false, error: '文件不是有效的 DWG 文件（未找到 AC10xx 文件头）' };
    }

    try {
      const converter = await this._getDWGConverter();
      const dwgBytes = new Uint8Array(await fsp.readFile(filePath));
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
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let has = false;
    for (const mesh of meshes) {
      const p = mesh.positions;
      if (!p || !p.length) continue;
      has = true;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    if (!has) return null;
    return {
      minX, maxX, minY, maxY, minZ, maxZ,
      width: maxX - minX, height: maxY - minY, depth: maxZ - minZ
    };
  }

  async _getDWGVersion(filePath) {
    const buffer = Buffer.alloc(6);
    const fh = await fsp.open(filePath, 'r');
    try {
      await fh.read(buffer, 0, 6, 0);
      const signature = buffer.toString('ascii');
      return signature.startsWith('AC10') ? signature : null;
    } finally {
      await fh.close();
    }
  }

  _extractDxf3DModel(entities) {
    const positions = [];
    const indices = [];
    const linePaths = [];
    const addFace = (vertices) => {
      const points = vertices.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
      if (points.length < 3) return;
      const start = positions.length / 3;
      points.forEach(point => positions.push(point.x, point.y, point.z || 0));
      for (let index = 1; index < points.length - 1; index += 1) indices.push(start, start + index, start + index + 1);
    };
    const addLinePath = (vertices) => {
      const points = vertices.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
      if (points.length > 1) linePaths.push({ points: points.flatMap(point => [point.x, point.y, point.z || 0]) });
    };
    const hasZ = point => Math.abs(point?.z || 0) > 1e-8;

    entities.forEach(entity => {
      if (entity.type === '3DFACE' || entity.type === 'SOLID') {
        addFace(entity.vertices || entity.points || []);
        return;
      }

      const vertices = entity.vertices || [];
      if (entity.type === 'POLYLINE' && entity.isPolyfaceMesh) {
        const meshVertices = vertices.filter(vertex => !vertex.faceA && !vertex.faceB && !vertex.faceC && !vertex.faceD);
        vertices.filter(vertex => vertex.faceA || vertex.faceB || vertex.faceC || vertex.faceD).forEach(face => {
          const faceVertices = [face.faceA, face.faceB, face.faceC, face.faceD]
            .filter(Boolean)
            .map(index => meshVertices[Math.abs(index) - 1])
            .filter(Boolean);
          addFace(faceVertices);
        });
        return;
      }

      if ((entity.type === 'POLYLINE' && (entity.is3dPolyline || entity.is3dPolygonMesh || vertices.some(hasZ))) ||
        (entity.type === 'LINE' && vertices.some(hasZ))) {
        addLinePath(vertices);
      }
    });

    if (!indices.length && !linePaths.length) return null;
    const meshes = indices.length ? [{
      name: 'DXF/DWG 3D Faces',
      color: [0.55, 0.68, 0.78],
      positions,
      normals: [],
      indices,
      faces: []
    }] : [];
    return { meshes, linePaths };
  }

  _calculateDxf3DBounds(model) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let has = false;
    const consume = p => {
      if (!p || !p.length) return;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        has = true;
      }
    };
    (model.meshes || []).forEach(mesh => consume(mesh.positions));
    (model.linePaths || []).forEach(path => consume(path.points));
    if (!has) return null;
    return {
      minX, maxX, minY, maxY, minZ, maxZ,
      width: maxX - minX, height: maxY - minY, depth: maxZ - minZ
    };
  }

  _extractDimensions(entities, header) {
    const dims = [];
    const globalTol = this._extractGlobalTolerance(header);
    (entities || []).forEach(entity => {
      if (entity.type !== 'DIMENSION') return;
      const typeCode = entity.dimensionType != null ? (entity.dimensionType & 7) : 0;
      const typeLabel = DIMENSION_TYPE_MAP[typeCode] || '未知';
      const value = entity.actualMeasurement != null ? Number(entity.actualMeasurement) : null;
      const tolerance = this._parseDimensionTolerance(entity.text)
        || (globalTol ? { upper: globalTol.upper, lower: globalTol.lower, source: 'dimstyle' } : null);
      dims.push({
        type: typeLabel,
        typeCode,
        value,
        text: entity.text || '',
        tolerance,
        position: entity.middleOfText || entity.anchorPoint || null,
        angle: entity.angle || 0,
        block: entity.block || ''
      });
    });
    return dims;
  }

  _extractGlobalTolerance(header) {
    if (!header) return null;
    const dimtol = header.$DIMTOL;
    if (dimtol == null || Number(dimtol) === 0) return null;
    const upper = header.$DIMTP != null ? Number(header.$DIMTP) : null;
    const lower = header.$DIMTM != null ? Number(header.$DIMTM) : null;
    if (upper == null && lower == null) return null;
    return { upper, lower };
  }

  _parseDimensionTolerance(text) {
    if (!text) return null;
    // MTEXT 堆叠公差: \S<上>^<下>;
    const m = text.match(/\\S([^\^;]+)\^([^;]+);/);
    if (m) return { upper: m[1].trim(), lower: m[2].trim(), source: 'text' };
    // ±数值 形式
    const pm = text.match(/±\s*([-\d.]+)/);
    if (pm) return { upper: pm[1], lower: `-${pm[1]}`, source: 'text' };
    return null;
  }

  _summarizeEntities(entities) {
    const summary = {
      totalEntities: entities.length,
      line: 0,
      circle: 0,
      arc: 0,
      ellipse: 0,
      spline: 0,
      lwpolyline: 0,
      polyline: 0,
      text: 0,
      mtext: 0,
      dimensions: 0,
      '3dface': 0,
      solid: 0,
      other: 0,
      features: []
    };

    entities.forEach(entity => {
      const type = entity.type;
      if (!type) return;

      const summaryKey = type.toLowerCase();
      if (summary[summaryKey] !== undefined) {
        summary[summaryKey] += 1;
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
            data: {
              x1: v[0].x, y1: v[0].y, z1: v[0].z || 0,
              x2: v[1].x, y2: v[1].y, z2: v[1].z || 0,
              position: { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, z: ((v[0].z || 0) + (v[1].z || 0)) / 2 }
            }
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

      if (type === 'ELLIPSE' && entity.center && entity.majorAxisEndPoint) {
        summary.features.push({
          type: '椭圆',
          description: `中心 (${entity.center.x.toFixed(2)}, ${entity.center.y.toFixed(2)})`,
          data: {
            cx: entity.center.x, cy: entity.center.y,
            majorX: entity.majorAxisEndPoint.x, majorY: entity.majorAxisEndPoint.y,
            axisRatio: entity.axisRatio || 1,
            startAngle: entity.startAngle || 0,
            endAngle: entity.endAngle || Math.PI * 2
          }
        });
      }

      if (type === 'SPLINE') {
        const vertices = entity.fitPoints?.length ? entity.fitPoints : (entity.controlPoints || []);
        if (vertices.length > 1) {
          summary.features.push({
            type: '样条曲线',
            description: `${vertices.length} 个控制点`,
            data: { vertices: vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) }
          });
        }
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
            vertices: vertices.map(v => ({ x: v.x, y: v.y, z: v.z || 0 })),
            position: vertices.length ? {
              x: vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length,
              y: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length,
              z: vertices.reduce((sum, vertex) => sum + (vertex.z || 0), 0) / vertices.length
            } : null
          }
        });
      }

      if (type === '3DFACE' || type === 'SOLID') {
        const vertices = entity.vertices || entity.points || [];
        const count = vertices.length || 0;
        const position = count ? {
          x: vertices.reduce((sum, vertex) => sum + (vertex.x || 0), 0) / count,
          y: vertices.reduce((sum, vertex) => sum + (vertex.y || 0), 0) / count,
          z: vertices.reduce((sum, vertex) => sum + (vertex.z || 0), 0) / count
        } : null;
        summary.features.push({
          type: '三维面',
          description: `${type}，${count} 个顶点`,
          data: { position }
        });
      }

      // TEXT: dxf-parser uses startPoint; MTEXT: uses position
      if (type === 'TEXT' || type === 'MTEXT') {
        const text = entity.text || entity.value || '';
        const position = entity.startPoint || entity.position;
        summary.features.push({
          type: '文本',
          description: text.trim() || '无文本内容',
          data: position ? { text, x: position.x, y: position.y } : { text }
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
        case 'CIRCLE': {
          const radius = entity.radius || 0;
          addPoint({ x: entity.center?.x - radius, y: entity.center?.y - radius });
          addPoint({ x: entity.center?.x + radius, y: entity.center?.y + radius });
          break;
        }
        case 'ARC':
          addPoint(entity.center);
          break;
        case 'ELLIPSE':
          addPoint(entity.center);
          addPoint({ x: entity.center?.x + entity.majorAxisEndPoint?.x, y: entity.center?.y + entity.majorAxisEndPoint?.y });
          addPoint({ x: entity.center?.x - entity.majorAxisEndPoint?.x, y: entity.center?.y - entity.majorAxisEndPoint?.y });
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

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of coords) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }

    return {
      minX, minY, maxX, maxY,
      width: maxX - minX, height: maxY - minY
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
