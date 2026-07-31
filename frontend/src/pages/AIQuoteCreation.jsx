import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';
import { quoteApi, uploadApi } from '../api/quotes';

// ========================
// 折叠面板组件
// ========================
function CollapsibleSection({ title, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '1px solid #d0d7de',
      borderRadius: '6px',
      marginBottom: '8px',
      overflow: 'hidden',
      background: '#fff'
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          cursor: 'pointer',
          padding: '10px 15px',
          background: open ? '#f0f6ff' : '#f6f8fa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
          transition: 'background 0.2s',
          borderBottom: open ? '1px solid #d0d7de' : 'none'
        }}
      >
        <span>
          <span style={{ marginRight: '8px', fontSize: '12px' }}>{open ? '▼' : '▶'}</span>
          {title}
        </span>
        {badge && (
          <span style={{
            background: '#007bff',
            color: '#fff',
            borderRadius: '10px',
            padding: '2px 8px',
            fontSize: '12px'
          }}>{badge}</span>
        )}
      </div>
      {open && (
        <div style={{ padding: '12px 15px', animation: 'fadeIn 0.2s' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ========================
// 3D 零件模型（支持 CAD 特征）
// ========================

// CAD 2D → 3D 坐标映射
function mapCadTo3D(cadX, cadY, cadBounds, modelSX, modelSZ) {
  if (!cadBounds || !cadBounds.width || !cadBounds.height) return null;
  const mx = ((cadX - cadBounds.minX) / cadBounds.width) * modelSX - modelSX / 2;
  const mz = ((cadY - cadBounds.minY) / cadBounds.height) * modelSZ - modelSZ / 2;
  return [mx, mz];
}

function FeatureMarkers({ features, cadBounds, modelSX, modelSY, modelSZ, selectedFeatureIndex }) {
  if (!features || !cadBounds || !cadBounds.width) return null;

  // 顶面 Y
  const topY = modelSY / 2;
  const scaleF = Math.min(modelSX, modelSZ) / Math.max(cadBounds.width || 1, cadBounds.height || 1);
  const eps = 0.005; // 微抬避免 z-fighting

  return (
    <group>
      {features.map((f, i) => {
        const d = f.data;
        if (!d) return null;
        const isSelected = selectedFeatureIndex === i;

        // --- 圆 (孔) ---
        if (f.type === '圆' && d.cx != null && d.cy != null) {
          const pos = mapCadTo3D(d.cx, d.cy, cadBounds, modelSX, modelSZ);
          if (!pos) return null;
          const holeR = Math.max((d.r || 5) * scaleF, 0.02);
          return (
            <group key={i} position={[pos[0], topY + 0.002, pos[1]]}>
              <mesh position={[0, -0.025, 0]}>
                <cylinderGeometry args={[holeR * 0.9, holeR * 0.9, 0.06, 32]} />
                <meshStandardMaterial color="#07111e" metalness={0.72} roughness={0.3} />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[holeR, isSelected ? 0.026 : 0.014, 10, 36]} />
                <meshStandardMaterial color={isSelected ? "#ffb020" : "#35d5ff"} emissive={isSelected ? "#ff7a00" : "#087ea4"} emissiveIntensity={isSelected ? 1.15 : 0.55} />
              </mesh>
            </group>
          );
        }

        // --- 圆弧 ---
        if (f.type === '圆弧' && d.cx != null && d.cy != null) {
          const pos = mapCadTo3D(d.cx, d.cy, cadBounds, modelSX, modelSZ);
          if (!pos) return null;
          const arcR = Math.max((d.r || 10) * scaleF, 0.03);
          const arcAngle = d.endAngle != null ? d.endAngle - (d.startAngle || 0) : Math.PI;
          return (
            <mesh key={i} position={[pos[0], topY, pos[1]]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[arcR, 0.01, 8, 48, arcAngle]} />
              <meshStandardMaterial color={isSelected ? "#ffb020" : "#ff9800"} emissive="#e65100" emissiveIntensity={isSelected ? 1 : 0.5} />
            </mesh>
          );
        }

        // --- 直线 ---
        if (f.type === '直线' && d.x1 != null && d.y1 != null && d.x2 != null && d.y2 != null) {
          const p1 = mapCadTo3D(d.x1, d.y1, cadBounds, modelSX, modelSZ);
          const p2 = mapCadTo3D(d.x2, d.y2, cadBounds, modelSX, modelSZ);
          if (!p1 || !p2) return null;
          return (
            <Line
              key={i}
              points={[[p1[0], topY + eps, p1[1]], [p2[0], topY + eps, p2[1]]]}
              color="#ffffff"
              lineWidth={1}
              transparent
              opacity={0.7}
            />
          );
        }

        // --- 多段线 ---
        if (f.type === '多段线' && d.vertices && d.vertices.length > 1) {
          const pts = d.vertices
            .map(v => mapCadTo3D(v.x, v.y, cadBounds, modelSX, modelSZ))
            .filter(Boolean)
            .map(([x, z]) => [x, topY + eps, z]);
          if (pts.length < 2) return null;
          return (
            <Line
              key={i}
              points={pts}
              color="#4fc3f7"
              lineWidth={1}
              transparent
              opacity={0.8}
            />
          );
        }

        return null;
      })}
    </group>
  );
}

const MARKER_COLORS = ['#36c9dd', '#41bf86', '#ef9b4a'];

function FeaturePointMarker({ position, color, selected, onSelect, size = 0.045 }) {
  const markerRef = useRef();
  useFrame(({ clock }) => {
    if (!markerRef.current) return;
    const scale = selected ? 1.35 + Math.sin(clock.elapsedTime * 5) * 0.18 : 1;
    markerRef.current.scale.setScalar(scale);
  });
  return (
    <mesh ref={markerRef} position={position} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      <boxGeometry args={[selected ? size * 1.35 : size, selected ? size * 1.35 : size, selected ? size * 1.35 : size]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 1.05 : 0.35} metalness={0.1} roughness={0.38} />
    </mesh>
  );
}

function FeaturePointMarkers({ markers, selectedFeatureIndex, onSelectFeature, size }) {
  return <group>{markers.map(marker => <FeaturePointMarker
    key={marker.index}
    position={marker.position}
    color={MARKER_COLORS[marker.index % MARKER_COLORS.length]}
    selected={selectedFeatureIndex === marker.index}
    onSelect={() => onSelectFeature(marker.index)}
    size={size}
  />)}</group>;
}

function selectFeatureMarkers(markers, selectedFeatureIndex, maxMarkers = 8) {
  if (!markers.length) return markers;
  const selected = markers.find(marker => marker.index === selectedFeatureIndex);
  const primary = markers.filter(marker => marker.priority === 'primary');
  const secondary = markers.filter(marker => marker.priority !== 'primary');
  const selectedMarkers = [];
  const add = marker => {
    if (marker && !selectedMarkers.some(item => item.index === marker.index) && selectedMarkers.length < maxMarkers) selectedMarkers.push(marker);
  };

  primary.forEach(add);
  const slots = Math.max(maxMarkers - selectedMarkers.length, 0);
  const stride = Math.max(1, Math.ceil(secondary.length / Math.max(slots, 1)));
  secondary.forEach((marker, index) => { if (index % stride === 0) add(marker); });
  if (selected && !selectedMarkers.some(marker => marker.index === selected.index)) {
    if (selectedMarkers.length === maxMarkers) selectedMarkers.pop();
    selectedMarkers.push(selected);
  }
  return selectedMarkers;
}

function get2DFeatureCenter(feature) {
  const data = feature?.data;
  if (!data) return null;
  if (data.cx != null && data.cy != null) return { x: data.cx, y: data.cy };
  if (data.x1 != null && data.y1 != null && data.x2 != null && data.y2 != null) return { x: (data.x1 + data.x2) / 2, y: (data.y1 + data.y2) / 2 };
  if (data.vertices?.length) {
    const total = data.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }), { x: 0, y: 0 });
    return { x: total.x / data.vertices.length, y: total.y / data.vertices.length };
  }
  return null;
}

function ParametricPartModel({ modelSpec, formData, features, selectedFeatureIndex, showContours, onSelectFeature }) {
  const scale = 1 / 50;
  const depth = Math.max(parseFloat(formData.height) || 20, 1) * scale;
  const geometry = useMemo(() => {
    if (!modelSpec?.outline?.length) return null;
    const { minX = 0, maxX = 0, minY = 0, maxY = 0 } = modelSpec.bounds || {};
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const point = ({ x, y }) => new THREE.Vector2((x - centerX) * scale, (y - centerY) * scale);
    const outline = modelSpec.outline.map(point);
    const shape = new THREE.Shape();
    shape.moveTo(outline[0].x, outline[0].y);
    outline.slice(1).forEach(vertex => shape.lineTo(vertex.x, vertex.y));
    shape.closePath();
    (modelSpec.holes || []).forEach(hole => {
      const path = new THREE.Path();
      path.absellipse((hole.cx - centerX) * scale, (hole.cy - centerY) * scale, hole.r * scale, hole.r * scale, 0, Math.PI * 2, true);
      shape.holes.push(path);
    });
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: Math.min(depth * 0.04, 0.03), bevelThickness: Math.min(depth * 0.04, 0.03), curveSegments: 32 });
  }, [modelSpec, depth]);

  const selectedFeature = features[selectedFeatureIndex];
  const highlight = selectedFeature?.type === '圆' ? selectedFeature.data : null;
  const bounds = modelSpec?.bounds || {};
  const highlightPosition = highlight ? [
    (highlight.cx - ((bounds.minX + bounds.maxX) / 2)) * scale,
    (highlight.cy - ((bounds.minY + bounds.maxY) / 2)) * scale,
    depth + 0.01
  ] : null;
  const contourPoints = modelSpec?.outline?.map(vertex => [
    (vertex.x - ((bounds.minX + bounds.maxX) / 2)) * scale,
    (vertex.y - ((bounds.minY + bounds.maxY) / 2)) * scale,
    depth + 0.01
  ]) || [];
  const markerPoints = features.map((feature, index) => {
    const point = get2DFeatureCenter(feature);
    return point && {
      index,
      priority: ['圆', '圆弧'].includes(feature.type) || (feature.type === '多段线' && feature.data?.closed) ? 'primary' : 'secondary',
      position: [
        (point.x - ((bounds.minX + bounds.maxX) / 2)) * scale,
        (point.y - ((bounds.minY + bounds.maxY) / 2)) * scale,
        depth + 0.08
      ]
    };
  }).filter(Boolean);
  const displayedMarkers = selectFeatureMarkers(markerPoints, selectedFeatureIndex);

  if (!geometry) return null;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#8daebf" metalness={0.78} roughness={0.25} />
      </mesh>
      {showContours && contourPoints.length > 2 && <Line points={[...contourPoints, contourPoints[0]]} color="#42dcf4" lineWidth={1.5} />}
      <FeaturePointMarkers markers={displayedMarkers} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} size={0.042} />
      {highlightPosition && <mesh position={highlightPosition}>
        <torusGeometry args={[highlight.r * scale, 0.018, 10, 36]} />
        <meshStandardMaterial color="#ffb020" emissive="#ff7a00" emissiveIntensity={1.2} />
      </mesh>}
    </group>
  );
}

function StepMesh({ mesh, showEdges, selected }) {
  const { geometry, edgeGeometry, color } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    if (mesh.normals?.length === mesh.positions.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(mesh.indices);
    geometry.computeBoundingSphere();
    return { geometry, edgeGeometry: new THREE.EdgesGeometry(geometry, 25), color: new THREE.Color(...(mesh.color || [0.55, 0.68, 0.78])) };
  }, [mesh]);

  useEffect(() => () => { geometry.dispose(); edgeGeometry.dispose(); }, [geometry, edgeGeometry]);
  return <group>
    <mesh geometry={geometry}><meshStandardMaterial color={selected ? '#ffb020' : color} emissive={selected ? '#7a3100' : '#000000'} emissiveIntensity={selected ? 0.55 : 0} metalness={0.65} roughness={0.28} /></mesh>
    {showEdges && <lineSegments geometry={edgeGeometry}><lineBasicMaterial color="#1b3950" transparent opacity={0.72} /></lineSegments>}
  </group>;
}

function StepMeshModel({ model, showEdges, selectedFeature, features, selectedFeatureIndex, onSelectFeature }) {
  const { center, scale } = useMemo(() => {
    const values = model.meshes.flatMap(mesh => mesh.positions);
    if (!values.length) return { center: [0, 0, 0], scale: 0.02 };
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < values.length; i += 3) { xs.push(values[i]); ys.push(values[i + 1]); zs.push(values[i + 2]); }
    return {
      center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2],
      // 统一按毫米缩放到场景单位；不再根据模型尺寸自动放大相机。
      scale: 0.02
    };
  }, [model]);
  const selectedMeshIndex = selectedFeature?.data?.meshIndex;
  const rawMarkers = features.map((feature, index) => {
    const point = feature?.data?.position;
    return point && {
      index,
      priority: feature.type === '三维零件' ? 'primary' : 'secondary',
      position: [point.x, point.y, point.z]
    };
  }).filter(Boolean);
  const displayedMarkers = selectFeatureMarkers(rawMarkers, selectedFeatureIndex);
  const worldMarkers = displayedMarkers.map(marker => {
    const centered = new THREE.Vector3(
      (marker.position[0] - center[0]) * scale,
      (marker.position[1] - center[1]) * scale,
      (marker.position[2] - center[2]) * scale
    );
    // 略微沿模型中心到特征中心的方向抬起，避免悬浮球被面片遮挡。
    const offset = centered.lengthSq() ? centered.clone().normalize().multiplyScalar(0.035) : new THREE.Vector3(0, 0.035, 0);
    return { ...marker, position: centered.add(offset).toArray() };
  });
  return <>
    <group scale={[scale, scale, scale]} position={[-center[0] * scale, -center[1] * scale, -center[2] * scale]}>
      {model.meshes.map((mesh, index) => <StepMesh key={`${mesh.name}-${index}`} mesh={mesh} showEdges={showEdges} selected={selectedMeshIndex === index} />)}
    </group>
    <FeaturePointMarkers markers={worldMarkers} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} size={0.042} />
  </>;
}

// ========================
// 3D 预览容器
// ========================
function Part3DPreview({ quoteId, formData, analysisResult, selectedFeatureIndex, onSelectFeature }) {
  const viewportRef = useRef(null);
  const features = analysisResult?.features || [];
  const cadBounds = analysisResult?.cadInfo?.bounds || null;
  const cadEntityCount = analysisResult?.cadInfo?.entityCount || 0;
  const modelInfo = analysisResult?.modelInfo || analysisResult?.cadInfo?.modelInfo || {};
  const modelSpec = analysisResult?.cadInfo?.modelSpec || null;
  const [stepModel, setStepModel] = useState(null);
  const [modelError, setModelError] = useState('');
  const [loadingModel, setLoadingModel] = useState(false);
  const [showEdges, setShowEdges] = useState(false);

  useEffect(() => {
    let active = true;
    setStepModel(null);
    setModelError('');
    if (modelInfo.type !== 'mesh' || !quoteId) return undefined;
    setLoadingModel(true);
    quoteApi.get3DModel(quoteId)
      .then(response => { if (active) setStepModel(response.data.model); })
      .catch(error => { if (active) setModelError(error.response?.data?.error || '原始三维模型加载失败'); })
      .finally(() => { if (active) setLoadingModel(false); });
    return () => { active = false; };
  }, [quoteId, modelInfo.type]);

  const hasParametricModel = modelInfo.type === 'parametric' && modelSpec?.outline?.length;
  const hasStepModel = modelInfo.type === 'mesh' && stepModel?.meshes?.length;
  const modelLabel = modelInfo.label || (hasParametricModel ? '二维图纸推断模型' : '未生成模型');

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    // 鼠标位于预览区域时，滚轮只交给 OrbitControls 缩放，不再驱动页面滚动。
    const preventPageScroll = event => event.preventDefault();
    viewport.addEventListener('wheel', preventPageScroll, { passive: false });
    return () => viewport.removeEventListener('wheel', preventPageScroll);
  }, []);

  return (
    <div className="model-viewport" ref={viewportRef}>
      {/* 顶部标签 */}
      <div className="viewport-title">
        {formData.partName || '零件 3D 预览'}
        {cadBounds && (
          <span className="viewport-subtitle">
            {cadBounds.width?.toFixed(0)} × {cadBounds.height?.toFixed(0)} mm
          </span>
        )}
      </div>
      <div className="viewport-help">
        <div>🖱 拖拽旋转 | 滚轮缩放 | 右键平移</div>
        {features.length > 0 && (
          <div className="viewport-feature-count">
            {cadEntityCount > 0 && `${cadEntityCount} 实体 · `}
            {features.length} 特征
          </div>
        )}
      </div>
      <div className={`model-source-badge ${modelInfo.type || 'none'}`}>{modelLabel}</div>
      {(hasParametricModel || hasStepModel) && <button type="button" className="model-edge-toggle" onClick={() => setShowEdges(value => !value)}>{showEdges ? '隐藏轮廓' : '显示轮廓'}</button>}
      {loadingModel && <div className="model-message">正在加载原始 STEP/STP 三维模型…</div>}
      {!loadingModel && !hasParametricModel && !hasStepModel && <div className="model-message error">{modelError || modelInfo.label || '未识别到可生成实体的闭合轮廓。请修正图纸或上传 STEP/STP 文件。'}</div>}

      <Canvas
        camera={{ position: [8, 5, 8], fov: 45, near: 0.1, far: 100 }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 15, 8]} intensity={1.0} />
        <pointLight position={[-5, 8, 5]} intensity={0.5} color="#ffffff" />
        <pointLight position={[5, 3, -5]} intensity={0.3} color="#4a90d9" />

        {hasStepModel
          ? <StepMeshModel model={stepModel} showEdges={showEdges} selectedFeature={features[selectedFeatureIndex] || features[0]} features={features} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />
          : hasParametricModel && <ParametricPartModel modelSpec={modelSpec} formData={formData} features={features} selectedFeatureIndex={selectedFeatureIndex} showContours={showEdges} onSelectFeature={onSelectFeature} />}

        <Grid
          position={[0, -0.01, 0]}
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#12314a"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#1c5a78"
          fadeDistance={30}
          infiniteGrid
        />
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          enableZoom
          zoomSpeed={0.85}
          minDistance={2}
          maxDistance={80}
          target={[0, 0.5, 0]}
        />
      </Canvas>
    </div>
  );
}

// ========================
// 特征标签样式映射
// ========================
const FEATURE_STYLES = {
  '圆': { bg: '#e3f2fd', color: '#1565c0', icon: '🔵' },
  '圆弧': { bg: '#fce4ec', color: '#c62828', icon: '🔴' },
  '直线': { bg: '#e8f5e9', color: '#2e7d32', icon: '🟢' },
  '多段线': { bg: '#fff3e0', color: '#e65100', icon: '🟠' },
  '文本': { bg: '#f3e5f5', color: '#7b1fa2', icon: '🟣' },
};

function getFeatureStyle(type) {
  return FEATURE_STYLES[type] || { bg: '#f5f5f5', color: '#333', icon: '⚪' };
}

function AnalysisWorkbench({ quoteId, formData, quote, analysisResult, selectedFeatureIndex, onSelectFeature, onChange, onBack, onCalculate, loading }) {
  const features = analysisResult?.features || [];
  const cadInfo = analysisResult?.cadInfo || {};
  const selectedFeature = features[selectedFeatureIndex] || features[0];
  const dimensions = analysisResult?.dimensions || formData;
  const metricItems = [
    ['长度', dimensions.length || '—', 'mm'],
    ['宽度', dimensions.width || '—', 'mm'],
    ['高度', dimensions.height || '—', 'mm'],
    ['直径', dimensions.diameter || '—', 'mm'],
    ['特征数', features.length, '项'],
    ['实体数', cadInfo.entityCount || '—', '个'],
  ];

  return (
    <div className="analysis-workbench">
      <section className="workbench-hero">
        <div>
          <span className="eyebrow">AI QUOTE / 3D ANALYSIS / FEATURE REVIEW</span>
          <h2>机加工模型分析工作台</h2>
          <p>确认零件尺寸与识别特征，拖动模型检查三维形态后生成报价。</p>
        </div>
        <div className="hero-statuses">
          <span>DWG / DXF / STEP</span><span>360° 预览</span><span>特征高亮</span>
        </div>
      </section>

      <div className="workbench-grid">
        <aside className="analysis-panel workflow-panel">
          <div className="panel-heading"><span>文件与流程</span><b>STEP 3/5</b></div>
          <div className="file-summary">
            <span className="file-icon">⌁</span>
            <div><small>当前图纸</small><strong>{quote?.drawingPath || '未上传图纸'}</strong></div>
          </div>
          <ol className="workflow-steps">
            <li className="done">上传图纸</li><li className="done">AI 分析</li><li className="active">确认特征</li><li>计算报价</li><li>AI 建议</li>
          </ol>

          <div className="feature-list-heading"><span>识别特征</span><b>{features.length} 项</b></div>
          <div className="feature-scroll-area" aria-label="识别特征列表">
            {features.length ? features.map((feature, index) => {
              const style = getFeatureStyle(feature.type);
              return <button type="button" className={`feature-row ${selectedFeatureIndex === index ? 'selected' : ''}`} key={`${feature.type}-${index}`} onClick={() => onSelectFeature(index)}>
                <span className="feature-index">#{String(index + 1).padStart(2, '0')}</span>
                <span className="feature-dot" style={{ background: style.color }} />
                <span className="feature-row-copy"><strong>{feature.type}</strong><small>{feature.description || '已识别的 CAD 特征'}</small></span>
              </button>;
            }) : <p className="empty-features">未识别到结构特征，可直接手动修正参数。</p>}
          </div>
        </aside>

        <section className="analysis-stage">
          <div className="stage-heading"><div><span className="eyebrow">3D 预览</span><h3>{formData.partName || analysisResult?.partName || '未命名零件'}</h3></div><span className="model-chip">可交互模型</span></div>
          <div className="metric-grid">{metricItems.map(([label, value, unit]) => <div className="metric-card" key={label}><small>{label}</small><strong>{value}<em>{unit}</em></strong></div>)}</div>
          <Part3DPreview quoteId={quoteId} formData={formData} analysisResult={analysisResult} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />
          <div className="stage-hint"><span>✦</span> 三维实体由尺寸和 CAD 特征构建；拖拽旋转、滚轮缩放，点击左侧特征可高亮查看。</div>
        </section>

        <aside className="analysis-panel insight-panel">
          <div className="panel-heading"><span>识别信息</span><b>{selectedFeature ? `#${String((selectedFeatureIndex || 0) + 1).padStart(2, '0')}` : '摘要'}</b></div>
          {selectedFeature ? <>
            <div className="selected-feature-title"><span>{getFeatureStyle(selectedFeature.type).icon}</span><div><small>当前选中</small><h3>{selectedFeature.type}</h3></div></div>
            <div className="detail-grid">
              <div><small>类型</small><strong>{selectedFeature.type}</strong></div>
              <div><small>复杂度</small><strong>{analysisResult?.complexity || '中等'}</strong></div>
              <div><small>特征序号</small><strong>{(selectedFeatureIndex || 0) + 1}</strong></div>
              <div><small>数据状态</small><strong>已映射</strong></div>
            </div>
            <div className="recognition-basis"><small>识别依据</small><p>{selectedFeature.description || '基于图纸实体坐标提取。'}</p></div>
          </> : <div className="recognition-basis"><small>分析状态</small><p>{analysisResult?.notes || '图纸已解析，请核对尺寸。'}</p></div>}
          <div className="quote-summary"><div><small>材料</small><strong>{formData.material}</strong></div><div><small>数量</small><strong>{formData.quantity}</strong></div><div><small>精度</small><strong>{formData.precision}</strong></div><div><small>交货期</small><strong>{formData.deliveryDate || '待定'}</strong></div></div>
        </aside>
      </div>

      <section className="analysis-editor">
        <div className="editor-heading"><div><span className="eyebrow">PARAMETER CHECK</span><h3>参数修正</h3></div><span>AI 提取结果可人工覆盖</span></div>
        <div className="edit-grid">
          <label>零件名称<input name="partName" value={formData.partName} onChange={onChange} /></label>
          <label>零件编号<input name="partNumber" value={formData.partNumber} onChange={onChange} /></label>
          <label>材料<select name="material" value={formData.material} onChange={onChange}><option value="钢材">钢材</option><option value="铝材">铝材</option><option value="铜材">铜材</option><option value="不锈钢">不锈钢</option></select></label>
          <label>精度<select name="precision" value={formData.precision} onChange={onChange}><option value="低">低</option><option value="中等">中等</option><option value="高">高</option><option value="极高">极高</option></select></label>
          <label>长度 (mm)<input type="number" name="length" value={formData.length} onChange={onChange} /></label>
          <label>宽度 (mm)<input type="number" name="width" value={formData.width} onChange={onChange} /></label>
          <label>高度 (mm)<input type="number" name="height" value={formData.height} onChange={onChange} /></label>
          <label>直径 (mm)<input type="number" name="diameter" value={formData.diameter} onChange={onChange} /></label>
          <label>数量<input type="number" min="1" name="quantity" value={formData.quantity} onChange={onChange} /></label>
          <label>交货期<input type="date" name="deliveryDate" value={formData.deliveryDate} onChange={onChange} /></label>
        </div>
        <div className="workbench-actions"><button type="button" className="secondary-action" onClick={onBack}>← 返回分析</button><button type="button" className="primary-action" disabled={loading} onClick={onCalculate}>{loading ? '计算中…' : '确认参数并计算报价 →'}</button></div>
      </section>
    </div>
  );
}

// ========================
// 主组件
// ========================
function LegacyAIQuoteCreation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [quoteId, setQuoteId] = useState(null);
  const [quote, setQuote] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [selectedFeatureIndex, setSelectedFeatureIndex] = useState(0);

  const [formData, setFormData] = useState({
    partName: '',
    partNumber: '',
    material: '钢材',
    length: '',
    width: '',
    height: '',
    diameter: '',
    quantity: 1,
    deliveryDate: '',
    precision: '中等'
  });

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
    setError(null);
  };

  const handleFormChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleStep1Next = async () => {
    if (!selectedFile && !formData.partName) {
      setError('请至少上传图纸或填写零件名称');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let drawingPath = null;

      if (selectedFile) {
        const uploadResponse = await uploadApi.uploadDrawing(selectedFile);
        drawingPath = uploadResponse.data.filename;
      }

      const response = await quoteApi.create({
        ...formData,
        drawingPath
      });

      setQuoteId(response.data.id);
      setQuote(response.data);
      setStep(2);

    } catch (err) {
      setError(err.response?.data?.error || '创建报价失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeDrawing = async () => {
    if (!quote?.drawingPath) {
      setError('未找到图纸路径，请先上传图纸后重试');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await quoteApi.analyzeDrawing(quoteId, {
        drawingPath: quote.drawingPath,
        context: '请详细分析这张机加工图纸'
      });

      setAnalysisResult(response.data.analysis);
      setSelectedFeatureIndex(0);

      if (response.data.quote) {
        setQuote(response.data.quote);
        setFormData({
          partName: response.data.quote.partName || '',
          partNumber: response.data.quote.partNumber || '',
          material: response.data.quote.material || '钢材',
          length: response.data.quote.length || '',
          width: response.data.quote.width || '',
          height: response.data.quote.height || '',
          diameter: response.data.quote.diameter || '',
          quantity: response.data.quote.quantity || 1,
          deliveryDate: formData.deliveryDate,
          precision: response.data.quote.precision || '中等'
        });
      }

      setStep(3);

    } catch (err) {
      setError(err.response?.data?.error || '图纸分析失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAndCalculate = async () => {
    setLoading(true);
    setError(null);

    try {
      await quoteApi.update(quoteId, formData);
      const calculateResponse = await quoteApi.calculate(quoteId);
      setQuote(calculateResponse.data);
      setStep(4);
    } catch (err) {
      setError(err.response?.data?.error || '计算报价失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAIQuote = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await quoteApi.aiQuote(quoteId, {
        useAnalysisData: true
      });
      setQuote(response.data.quote);
      setAnalysisResult({ ...analysisResult, aiQuotation: response.data.aiAnalysis });
      setStep(5);
    } catch (err) {
      setError(err.response?.data?.error || 'AI报价失败');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2>步骤1: 上传图纸和基本信息</h2>

      <div style={{ marginBottom: '30px', padding: '20px', border: '2px dashed #ccc', borderRadius: '8px' }}>
        <h3>📄 图纸上传</h3>
        <p>支持格式: DWG, DXF, STEP, STP, PNG, JPG, JPEG, PDF</p>

        <input
          type="file"
          accept=".dwg,.dxf,.step,.stp,.png,.jpg,.jpeg,.pdf"
          onChange={handleFileChange}
          style={{ marginBottom: '10px' }}
        />

        {selectedFile && (
          <p style={{ color: 'green' }}>已选择文件: {selectedFile.name}</p>
        )}
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h3>🔧 基本信息（可选，AI会尝试从图纸提取）</h3>

        <div style={{ marginBottom: '15px' }}>
          <label>零件名称</label>
          <input
            type="text"
            name="partName"
            value={formData.partName}
            onChange={handleFormChange}
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
          <div>
            <label>零件编号</label>
            <input
              type="text"
              name="partNumber"
              value={formData.partNumber}
              onChange={handleFormChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
          <div>
            <label>材料</label>
            <select
              name="material"
              value={formData.material}
              onChange={handleFormChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            >
              <option value="钢材">钢材</option>
              <option value="铝材">铝材</option>
              <option value="铜材">铜材</option>
              <option value="不锈钢">不锈钢</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginTop: '15px' }}>
          <div>
            <label>数量</label>
            <input
              type="number"
              name="quantity"
              value={formData.quantity}
              onChange={handleFormChange}
              min="1"
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
          <div>
            <label>精度</label>
            <select
              name="precision"
              value={formData.precision}
              onChange={handleFormChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            >
              <option value="低">低</option>
              <option value="中等">中等</option>
              <option value="高">高</option>
              <option value="极高">极高</option>
            </select>
          </div>
          <div>
            <label>交货期</label>
            <input
              type="date"
              name="deliveryDate"
              value={formData.deliveryDate}
              onChange={handleFormChange}
              style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: 'red', padding: '10px', backgroundColor: '#fff3f3', borderRadius: '4px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleStep1Next}
        disabled={loading}
        style={{
          padding: '12px 30px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '16px'
        }}
      >
        {loading ? '创建中...' : '下一步 →'}
      </button>
    </div>
  );

  const renderStep2 = () => (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2>步骤2: AI分析图纸</h2>

      {quote?.drawingPath && (
        <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <h3>📄 图纸信息</h3>
          <p>文件: {quote.drawingPath}</p>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', padding: '10px', backgroundColor: '#fff3f3', borderRadius: '4px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '15px' }}>
        <button
          onClick={() => setStep(1)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          ← 返回
        </button>

        <button
          onClick={handleAnalyzeDrawing}
          disabled={loading}
          style={{
            padding: '10px 30px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '16px'
          }}
        >
          {loading ? 'AI分析中...' : '开始AI分析'}
        </button>
      </div>
    </div>
  );

  // ========================
  // 步骤3: 确认参数（含折叠面板 + 3D预览）
  // ========================
  const renderStep3 = () => {
    return (
      <AnalysisWorkbench
        quoteId={quoteId}
        formData={formData}
        quote={quote}
        analysisResult={analysisResult}
        selectedFeatureIndex={selectedFeatureIndex}
        onSelectFeature={setSelectedFeatureIndex}
        onChange={handleFormChange}
        onBack={() => setStep(2)}
        onCalculate={handleConfirmAndCalculate}
        loading={loading}
      />
    );

    /* Legacy step-3 markup is retained below temporarily for reference. */
    const features = analysisResult?.features || [];
    const cadInfo = analysisResult?.cadInfo || null;
    const hasAnalysis = !!analysisResult;

    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <h2>步骤3: 确认参数</h2>

        {/* 3D 预览 */}
        <Part3DPreview formData={formData} analysisResult={analysisResult} />

        {/* 折叠面板：AI 分析结果 */}
        {hasAnalysis && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '10px', color: '#333' }}>🤖 AI 分析结果</h3>

            <CollapsibleSection
              title="📐 零件信息"
              defaultOpen={true}
              badge={analysisResult.complexity || '分析完成'}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <span style={{ color: '#666', fontSize: '13px' }}>零件名称</span>
                  <p style={{ fontWeight: 'bold', margin: '2px 0' }}>{analysisResult.partName || formData.partName || '—'}</p>
                </div>
                <div>
                  <span style={{ color: '#666', fontSize: '13px' }}>材料</span>
                  <p style={{ fontWeight: 'bold', margin: '2px 0' }}>{analysisResult.material || formData.material || '—'}</p>
                </div>
                <div>
                  <span style={{ color: '#666', fontSize: '13px' }}>复杂程度</span>
                  <p style={{ fontWeight: 'bold', margin: '2px 0' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      background: analysisResult.complexity === '中等' ? '#fff3e0' : '#e8f5e9',
                      color: analysisResult.complexity === '中等' ? '#e65100' : '#2e7d32'
                    }}>
                      {analysisResult.complexity || '—'}
                    </span>
                  </p>
                </div>
                <div>
                  <span style={{ color: '#666', fontSize: '13px' }}>数量</span>
                  <p style={{ fontWeight: 'bold', margin: '2px 0' }}>{analysisResult.quantity || formData.quantity || '—'}</p>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="🔍 识别特征"
              defaultOpen={true}
              badge={features.length > 0 ? `${features.length} 个` : '无'}
            >
              {features.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {features.map((feature, i) => {
                    const style = getFeatureStyle(feature.type);
                    return (
                      <div
                        key={i}
                        style={{
                          background: style.bg,
                          color: style.color,
                          padding: '6px 12px',
                          borderRadius: '16px',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: `1px solid ${style.color}20`
                        }}
                      >
                        <span>{style.icon}</span>
                        <span style={{ fontWeight: 'bold' }}>{feature.type}</span>
                        <span style={{ opacity: 0.8 }}>{feature.description}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ color: '#999', fontStyle: 'italic' }}>未识别到特征数据，请手动确认参数</p>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="📏 尺寸参数"
              defaultOpen={false}
              badge="AI 提取"
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
                {[
                  { label: '长度 (mm)', value: analysisResult.dimensions?.length, field: 'length' },
                  { label: '宽度 (mm)', value: analysisResult.dimensions?.width, field: 'width' },
                  { label: '高度 (mm)', value: analysisResult.dimensions?.height, field: 'height' },
                  { label: '直径 (mm)', value: analysisResult.dimensions?.diameter, field: 'diameter' },
                ].map(({ label, value, field }) => (
                  <div key={field} style={{
                    padding: '8px',
                    background: '#f9f9f9',
                    borderRadius: '6px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#333' }}>
                      {value || '—'}
                    </div>
                    <div style={{ fontSize: '10px', color: value ? '#2e7d32' : '#999' }}>
                      {value ? 'AI 提取 ✓' : '未提取到'}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {analysisResult.notes && (
              <CollapsibleSection
                title="⚠️ 注意事项"
                defaultOpen={true}
              >
                <p style={{ color: '#666', lineHeight: '1.6', margin: 0 }}>{analysisResult.notes}</p>
              </CollapsibleSection>
            )}

            {cadInfo && (
              <CollapsibleSection
                title="📋 CAD 原始数据"
                defaultOpen={false}
                badge={cadInfo.format || 'DXF'}
              >
                <div style={{
                  background: '#1e1e2e',
                  color: '#a6e3a1',
                  padding: '12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'Consolas, Monaco, monospace',
                  maxHeight: '300px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {JSON.stringify(cadInfo, null, 2)}
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}

        {/* 编辑参数 */}
        <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>✏️ 编辑参数</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label>零件名称 *</label>
              <input
                type="text"
                name="partName"
                value={formData.partName}
                onChange={handleFormChange}
                required
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
            <div>
              <label>零件编号</label>
              <input
                type="text"
                name="partNumber"
                value={formData.partNumber}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label>材料 *</label>
              <select
                name="material"
                value={formData.material}
                onChange={handleFormChange}
                required
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              >
                <option value="钢材">钢材</option>
                <option value="铝材">铝材</option>
                <option value="铜材">铜材</option>
                <option value="不锈钢">不锈钢</option>
              </select>
            </div>
            <div>
              <label>精度</label>
              <select
                name="precision"
                value={formData.precision}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              >
                <option value="低">低</option>
                <option value="中等">中等</option>
                <option value="高">高</option>
                <option value="极高">极高</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label>长度</label>
              <input
                type="number"
                name="length"
                value={formData.length}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
            <div>
              <label>宽度</label>
              <input
                type="number"
                name="width"
                value={formData.width}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
            <div>
              <label>高度</label>
              <input
                type="number"
                name="height"
                value={formData.height}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
            <div>
              <label>直径</label>
              <input
                type="number"
                name="diameter"
                value={formData.diameter}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div>
              <label>数量</label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleFormChange}
                min="1"
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
            <div>
              <label>交货期</label>
              <input
                type="date"
                name="deliveryDate"
                value={formData.deliveryDate}
                onChange={handleFormChange}
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '15px' }}>
          <button
            onClick={() => setStep(2)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            ← 返回
          </button>
          <button
            onClick={handleConfirmAndCalculate}
            disabled={loading}
            style={{
              padding: '10px 30px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {loading ? '计算中...' : '计算报价 →'}
          </button>
        </div>
      </div>
    );
  };

  const renderStep4 = () => (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2>步骤4: 报价计算</h2>

      {quote?.calculation && (
        <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#e8f5e9', borderRadius: '8px' }}>
          <h3>💰 报价明细</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <p><strong>材料成本:</strong> ¥{quote.calculation.materialCost.toFixed(2)}</p>
              <p><strong>人工成本:</strong> ¥{quote.calculation.laborCost.toFixed(2)}</p>
              <p><strong>设备费用:</strong> ¥{quote.calculation.equipmentCost.toFixed(2)}</p>
              <p><strong>管理费用:</strong> ¥{quote.calculation.overheadCost.toFixed(2)}</p>
              <p><strong>利润:</strong> ¥{quote.calculation.profit.toFixed(2)}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#d32f2f' }}>
                总价: ¥{quote.calculation.total.toFixed(2)}
              </p>
              <p>单价: ¥{quote.calculation.unitPrice.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '15px', marginBottom: '30px' }}>
        <button
          onClick={() => setStep(3)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          ← 返回
        </button>
        <button
          onClick={handleAIQuote}
          style={{
            padding: '10px 30px',
            backgroundColor: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          让AI分析报价 →
        </button>
      </div>

      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <p>💡 提示: AI报价将提供专业的成本分析和优化建议</p>
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2>🎉 完成! 报价已生成</h2>

      {analysisResult?.aiQuotation && (
        <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#fff3e0', borderRadius: '8px' }}>
          <h3>🤖 AI报价建议</h3>

          {analysisResult.aiQuotation.materialRecommendation && (
            <p><strong>材料推荐:</strong> {analysisResult.aiQuotation.materialRecommendation}</p>
          )}

          {analysisResult.aiQuotation.processSuggestions && (
            <div>
              <h4>工艺建议:</h4>
              <ul>
                {analysisResult.aiQuotation.processSuggestions.map((ps, i) => (
                  <li key={i}>{ps.process}: {ps.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {analysisResult.aiQuotation.warningPoints && (
            <div>
              <h4>⚠️ 注意事项:</h4>
              <ul>
                {analysisResult.aiQuotation.warningPoints.map((wp, i) => (
                  <li key={i}>{wp}</li>
                ))}
              </ul>
            </div>
          )}

          {analysisResult.aiQuotation.suggestions && (
            <div>
              <h4>💡 优化建议:</h4>
              <ul>
                {analysisResult.aiQuotation.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {quote?.calculation && (
        <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#e8f5e9', borderRadius: '8px' }}>
          <h3>💰 最终报价</h3>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#d32f2f', textAlign: 'center' }}>
            ¥{quote.calculation.total.toFixed(2)}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
        <Link
          to={`/quotes/${quoteId}`}
          style={{
            padding: '12px 30px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            textDecoration: 'none',
            display: 'inline-block'
          }}
        >
          查看报价详情 →
        </Link>
        <Link
          to="/quotes"
          style={{
            padding: '12px 30px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            textDecoration: 'none',
            display: 'inline-block'
          }}
        >
          返回报价列表
        </Link>
      </div>
    </div>
  );

  return (
    <div className="ai-quote-page">
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1>🤖 AI智能报价系统</h1>
        <p>上传图纸 → AI分析 → 智能报价</p>
      </div>

      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        {[1, 2, 3, 4, 5].map(s => (
          <span
            key={s}
            style={{
              display: 'inline-block',
              width: '30px',
              height: '30px',
              lineHeight: '30px',
              borderRadius: '50%',
              backgroundColor: step >= s ? '#007bff' : '#ccc',
              color: 'white',
              margin: '0 5px',
              fontWeight: 'bold'
            }}
          >
            {s}
          </span>
        ))}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      {step === 5 && renderStep5()}
    </div>
  );
}

const WORKFLOW_STEPS = [
  { id: 1, title: '上传图纸', subtitle: '建立零件任务', icon: '01' },
  { id: 2, title: 'AI 分析', subtitle: '解析 CAD 数据', icon: '02' },
  { id: 3, title: '确认特征', subtitle: '校验三维模型', icon: '03' },
  { id: 4, title: '报价计算', subtitle: '生成成本结果', icon: '04' },
  { id: 5, title: 'AI 建议', subtitle: '交付报价结论', icon: '05' },
];

const fileName = (value) => value ? String(value).split(/[\\/]/).pop() : '尚未上传图纸';
const fileExtension = (value) => {
  const name = fileName(value);
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : 'CAD';
  return ext || 'CAD';
};
const money = (value) => `¥${Number(value || 0).toFixed(2)}`;

function WorkspaceTitle({ eyebrow, title, description, badge }) {
  return <div className="workspace-title">
    <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {badge && <span className="workspace-badge">{badge}</span>}
  </div>;
}

function Field({ label, name, value, onChange, type = 'text', children, ...props }) {
  return <label className="console-field"><span>{label}</span>{children || <input type={type} name={name} value={value} onChange={onChange} {...props} />}</label>;
}

function FeatureReviewWorkspace({ quoteId, formData, quote, analysisResult, selectedFeatureIndex, onSelectFeature, onChange, onBack, onCalculate, loading }) {
  const features = analysisResult?.features || [];
  const selected = features[selectedFeatureIndex] || features[0];
  const dimensions = analysisResult?.dimensions || formData;
  const metrics = [['长度', dimensions.length, 'mm'], ['宽度', dimensions.width, 'mm'], ['高度', dimensions.height, 'mm'], ['直径', dimensions.diameter, 'mm'], ['特征', features.length, '项'], ['实体', analysisResult?.cadInfo?.entityCount, '个']];
  return <div className="feature-review">
    <WorkspaceTitle eyebrow="STEP 03 / FEATURE REVIEW" title="确认特征与三维模型" description="选择特征即可聚焦模型中的对应色块；参数可在此处人工复核。" badge={analysisResult?.modelInfo?.label || 'CAD 模型已载入'} />
    <div className="review-layout">
      <aside className="review-feature-panel">
        <div className="mini-panel-title"><span>识别特征</span><b>{features.length} 项</b></div>
        <div className="feature-scroll-area">
          {features.length ? features.map((feature, index) => {
            const style = getFeatureStyle(feature.type);
            return <button type="button" className={`feature-row ${selectedFeatureIndex === index ? 'selected' : ''}`} key={`${feature.type}-${index}`} onClick={() => onSelectFeature(index)}>
              <span className="feature-index">#{String(index + 1).padStart(2, '0')}</span><span className="feature-dot" style={{ background: style.color }} /><span className="feature-row-copy"><strong>{feature.type}</strong><small>{feature.description || '已识别 CAD 特征'}</small></span>
            </button>;
          }) : <p className="empty-features">未识别到可定位特征，可直接核对下方参数。</p>}
        </div>
      </aside>
      <section className="review-model-panel">
        <div className="metric-grid compact">{metrics.map(([label, value, unit]) => <div className="metric-card" key={label}><small>{label}</small><strong>{value ?? '—'}<em>{unit}</em></strong></div>)}</div>
        <Part3DPreview quoteId={quoteId} formData={formData} analysisResult={analysisResult} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />
        <p className="review-model-help">拖拽旋转 · 滚轮缩放 · 点击色块或左侧特征查看关联位置</p>
      </section>
      <aside className="review-detail-panel">
        <div className="mini-panel-title"><span>当前特征</span><b>{selected ? `#${String(selectedFeatureIndex + 1).padStart(2, '0')}` : '摘要'}</b></div>
        {selected ? <><div className="selected-feature-title"><span>{getFeatureStyle(selected.type).icon}</span><div><small>选中特征</small><h3>{selected.type}</h3></div></div><div className="detail-grid"><div><small>复杂度</small><strong>{analysisResult?.complexity || '中等'}</strong></div><div><small>映射状态</small><strong>已关联</strong></div></div><div className="recognition-basis"><small>识别依据</small><p>{selected.description || '基于 CAD 几何信息提取。'}</p></div></> : <div className="console-empty">暂无可展示的特征详情。</div>}
        <div className="review-file-note"><small>当前图纸</small><strong>{fileName(quote?.drawingPath)}</strong></div>
      </aside>
    </div>
    <section className="parameter-console">
      <div className="mini-panel-title"><span>参数修正</span><b>修改后将重新计算报价</b></div>
      <div className="console-form-grid">
        <Field label="零件名称" name="partName" value={formData.partName} onChange={onChange} /><Field label="零件编号" name="partNumber" value={formData.partNumber} onChange={onChange} />
        <Field label="材料" name="material" value={formData.material} onChange={onChange}><select name="material" value={formData.material} onChange={onChange}><option value="钢材">钢材</option><option value="铝材">铝材</option><option value="铜材">铜材</option><option value="不锈钢">不锈钢</option></select></Field>
        <Field label="精度" name="precision" value={formData.precision} onChange={onChange}><select name="precision" value={formData.precision} onChange={onChange}><option value="低">低</option><option value="中等">中等</option><option value="高">高</option><option value="极高">极高</option></select></Field>
        <Field label="长度 (mm)" type="number" name="length" value={formData.length} onChange={onChange} /><Field label="宽度 (mm)" type="number" name="width" value={formData.width} onChange={onChange} /><Field label="高度 (mm)" type="number" name="height" value={formData.height} onChange={onChange} /><Field label="直径 (mm)" type="number" name="diameter" value={formData.diameter} onChange={onChange} /><Field label="数量" type="number" min="1" name="quantity" value={formData.quantity} onChange={onChange} /><Field label="交货期" type="date" name="deliveryDate" value={formData.deliveryDate} onChange={onChange} />
      </div>
      <div className="workspace-actions"><button type="button" className="secondary-action" onClick={onBack}>返回分析</button><button type="button" className="primary-action" disabled={loading} onClick={onCalculate}>{loading ? '计算中…' : '确认参数并计算报价'}</button></div>
    </section>
  </div>;
}

function AIQuoteCreation() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [quoteId, setQuoteId] = useState(null);
  const [quote, setQuote] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFeatureIndex, setSelectedFeatureIndex] = useState(0);
  const [formData, setFormData] = useState({ partName: '', partNumber: '', material: '钢材', length: '', width: '', height: '', diameter: '', quantity: 1, deliveryDate: '', precision: '中等' });
  const completedStep = analysisResult?.aiQuotation ? 5 : quote?.calculation ? 4 : analysisResult ? 3 : quote ? 2 : 1;
  const handleFormChange = (event) => setFormData(data => ({ ...data, [event.target.name]: event.target.value }));
  const chooseFile = (file) => { if (file) { setSelectedFile(file); setError(null); } };

  const createQuote = async () => {
    if (!selectedFile && !formData.partName) { setError('请至少上传一份图纸，或填写零件名称后再继续。'); return; }
    setLoading(true); setError(null);
    try {
      const drawingPath = selectedFile ? (await uploadApi.uploadDrawing(selectedFile)).data.filename : quote?.drawingPath || null;
      const response = await quoteApi.create({ ...formData, drawingPath });
      setQuoteId(response.data.id); setQuote(response.data); setAnalysisResult(null); setStep(2);
    } catch (err) { setError(err.response?.data?.error || '创建报价任务失败'); } finally { setLoading(false); }
  };
  const analyzeDrawing = async () => {
    if (!quote?.drawingPath) { setError('未找到图纸，请返回第一步上传文件。'); return; }
    setLoading(true); setError(null);
    try {
      const response = await quoteApi.analyzeDrawing(quoteId, { drawingPath: quote.drawingPath, context: '请详细分析这张机加工图纸' });
      setAnalysisResult(response.data.analysis); setSelectedFeatureIndex(0);
      if (response.data.quote) { setQuote(response.data.quote); setFormData(data => ({ ...data, partName: response.data.quote.partName || '', partNumber: response.data.quote.partNumber || '', material: response.data.quote.material || '钢材', length: response.data.quote.length || '', width: response.data.quote.width || '', height: response.data.quote.height || '', diameter: response.data.quote.diameter || '', quantity: response.data.quote.quantity || 1, precision: response.data.quote.precision || '中等' })); }
      setStep(3);
    } catch (err) { setError(err.response?.data?.error || '图纸分析失败'); } finally { setLoading(false); }
  };
  const calculateQuote = async () => {
    setLoading(true); setError(null);
    try { await quoteApi.update(quoteId, formData); const response = await quoteApi.calculate(quoteId); setQuote(response.data); setStep(4); } catch (err) { setError(err.response?.data?.error || '计算报价失败'); } finally { setLoading(false); }
  };
  const requestAiQuote = async () => {
    setLoading(true); setError(null);
    try { const response = await quoteApi.aiQuote(quoteId, { useAnalysisData: true }); setQuote(response.data.quote); setAnalysisResult(result => ({ ...(result || {}), aiQuotation: response.data.aiAnalysis })); setStep(5); } catch (err) { setError(err.response?.data?.error || 'AI 报价分析失败'); } finally { setLoading(false); }
  };

  const renderStep1 = () => <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 01 / INTAKE" title="创建零件分析任务" description="上传 CAD 图纸，补充少量业务信息，即可开始智能解析。" badge="支持 DWG · DXF · STEP · STP" /><div className="intake-grid"><section className={`drop-zone ${dragActive ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={event => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}><span className="drop-zone-orbit" /><div className="drop-zone-icon">CAD</div><h3>{selectedFile ? selectedFile.name : '拖拽图纸到此处'}</h3><p>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 等待建立分析任务` : '或从本地选择文件。二维图纸与三维模型均可解析。'}</p><label className="secondary-action file-picker">选择图纸<input type="file" accept=".dwg,.dxf,.step,.stp,.png,.jpg,.jpeg,.pdf" onChange={event => chooseFile(event.target.files?.[0])} /></label><div className="format-chips"><span>DWG</span><span>DXF</span><span>STEP</span><span>STP</span><span>PDF / 图片</span></div></section><section className="parameter-console intake-form"><div className="mini-panel-title"><span>零件基础信息</span><b>可选，AI 将自动补全</b></div><div className="console-form-grid two-columns"><Field label="零件名称" name="partName" value={formData.partName} onChange={handleFormChange} /><Field label="零件编号" name="partNumber" value={formData.partNumber} onChange={handleFormChange} /><Field label="材料" name="material" value={formData.material} onChange={handleFormChange}><select name="material" value={formData.material} onChange={handleFormChange}><option value="钢材">钢材</option><option value="铝材">铝材</option><option value="铜材">铜材</option><option value="不锈钢">不锈钢</option></select></Field><Field label="精度" name="precision" value={formData.precision} onChange={handleFormChange}><select name="precision" value={formData.precision} onChange={handleFormChange}><option value="低">低</option><option value="中等">中等</option><option value="高">高</option><option value="极高">极高</option></select></Field><Field label="数量" type="number" min="1" name="quantity" value={formData.quantity} onChange={handleFormChange} /><Field label="交货期" type="date" name="deliveryDate" value={formData.deliveryDate} onChange={handleFormChange} /></div><div className="workspace-actions"><button type="button" className="primary-action" onClick={createQuote} disabled={loading}>{loading ? '正在建立任务…' : '建立分析任务'}</button></div></section></div></div>;
  const renderStep2 = () => <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 02 / AI PARSING" title="智能解析 CAD 图纸" description="系统会识别几何轮廓、尺寸、特征与模型来源，并准备进入人工复核。" badge={fileExtension(quote?.drawingPath)} /><div className="analysis-command"><div className="command-orb">AI</div><div><span className="eyebrow">READY TO ANALYZE</span><h3>{fileName(quote?.drawingPath)}</h3><p>已建立零件任务。开始分析后，系统将提取几何信息并生成特征确认视图。</p></div><button type="button" className="primary-action" onClick={analyzeDrawing} disabled={loading}>{loading ? '正在解析…' : '开始 AI 分析'}</button></div><div className="status-card-grid"><div><span>输入格式</span><strong>{fileExtension(quote?.drawingPath)}</strong><small>CAD 文件已就绪</small></div><div><span>解析范围</span><strong>几何 + 特征</strong><small>尺寸、轮廓、孔位</small></div><div><span>下一节点</span><strong>人工确认</strong><small>进入三维模型复核</small></div></div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(1)}>返回上传</button></div></div>;
  const renderStep4 = () => { const calc = quote?.calculation; const costs = [['材料成本', calc?.materialCost], ['人工成本', calc?.laborCost], ['设备费用', calc?.equipmentCost], ['管理费用', calc?.overheadCost], ['利润', calc?.profit]]; return <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 04 / PRICING" title="报价成本计算结果" description="费用构成基于已确认的材料、尺寸、精度与数量生成。" badge={calc ? '报价已计算' : '等待计算'} />{calc ? <><div className="quote-result-hero"><div><span>参考总价</span><strong>{money(calc.total)}</strong><small>单价 {money(calc.unitPrice)} · 数量 {formData.quantity}</small></div><span>CALCULATED</span></div><div className="cost-card-grid">{costs.map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(3)}>返回修改参数</button><button type="button" className="primary-action" onClick={requestAiQuote} disabled={loading}>{loading ? 'AI 分析中…' : '生成 AI 报价建议'}</button></div></> : <div className="console-empty">尚未取得报价结果，请先完成特征确认。</div>}</div>; };
  const renderStep5 = () => { const ai = analysisResult?.aiQuotation; const groups = [['材料推荐', ai?.materialRecommendation ? [ai.materialRecommendation] : []], ['工艺建议', ai?.processSuggestions?.map(item => `${item.process}：${item.reason}`) || []], ['风险提示', ai?.warningPoints || []], ['优化建议', ai?.suggestions || []]]; return <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 05 / DELIVERY" title="报价交付与 AI 建议" description="汇总报价结论、工艺判断和关键风险，支持返回任意已完成步骤复核。" badge="交付就绪" /><div className="delivery-total"><span>最终参考报价</span><strong>{money(quote?.calculation?.total)}</strong><small>{formData.partName || '未命名零件'} · {formData.material} · {formData.quantity} 件</small></div><div className="advice-grid">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>暂无额外建议。</p>}</section>)}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(4)}>返回报价计算</button><Link className="primary-action link-action" to={`/quotes/${quoteId}`}>查看报价详情</Link><Link className="secondary-action link-action" to="/quotes">返回报价列表</Link></div></div>; };
  const mainContent = step === 1 ? renderStep1() : step === 2 ? renderStep2() : step === 3 ? <FeatureReviewWorkspace quoteId={quoteId} formData={formData} quote={quote} analysisResult={analysisResult} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={setSelectedFeatureIndex} onChange={handleFormChange} onBack={() => setStep(2)} onCalculate={calculateQuote} loading={loading} /> : step === 4 ? renderStep4() : renderStep5();
  const context = step === 3 ? (analysisResult?.features || []).length : step >= 4 ? money(quote?.calculation?.total) : quote ? fileExtension(quote.drawingPath) : '等待输入';
  return <div className="ai-quote-page"><main className="cad-console"><header className="console-hero"><div><span className="eyebrow">CAD INTELLIGENCE / QUOTATION WORKBENCH</span><h1>机加工模型分析工作台</h1><p>从图纸解析到报价交付，在同一个精密制造工作台内完成。</p></div><div className="console-hero-status"><span>{quote ? '任务进行中' : '新建任务'}</span><span>{fileExtension(quote?.drawingPath || selectedFile?.name)}</span><span>360° 预览</span></div></header><div className="console-layout"><aside className="workflow-rail"><div className="rail-heading"><span>ANALYSIS FLOW</span><b>{step} / 5</b></div><nav>{WORKFLOW_STEPS.map(item => { const available = item.id <= completedStep; const state = item.id === step ? 'active' : item.id < step || (item.id < completedStep) ? 'done' : 'locked'; return <button key={item.id} type="button" className={`workflow-node ${state}`} disabled={!available} onClick={() => available && setStep(item.id)}><i>{state === 'done' ? '✓' : item.icon}</i><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>{state === 'locked' && <em>LOCK</em>}</button>; })}</nav><div className="rail-footnote"><span>当前任务</span><strong>{quoteId ? `#${quoteId}` : '未创建'}</strong><small>后续步骤将在前置数据完成后自动解锁</small></div></aside><section className="console-main">{error && <div className="console-error">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}{mainContent}</section><aside className="context-rail"><div className="context-title"><span>任务摘要</span><b>LIVE</b></div><div className="context-file"><span className="context-file-type">{fileExtension(quote?.drawingPath || selectedFile?.name)}</span><small>当前图纸</small><strong>{fileName(quote?.drawingPath || selectedFile?.name)}</strong></div><div className="context-stat"><span>{step === 3 ? '识别特征' : step >= 4 ? '当前报价' : '任务状态'}</span><strong>{context}</strong><small>{step === 3 ? '可选择并定位' : step >= 4 ? '含成本构成' : quote ? '等待下一步操作' : '请上传图纸'}</small></div><div className="context-list"><span>数据概览</span><p>材料 <strong>{formData.material}</strong></p><p>数量 <strong>{formData.quantity}</strong></p><p>精度 <strong>{formData.precision}</strong></p><p>模型 <strong>{analysisResult?.modelInfo?.label || '待解析'}</strong></p></div><div className="context-tip"><span>操作提示</span><p>{step === 3 ? '点击特征列表或模型色块，可核对关联的空间位置。' : step === 1 ? '优先上传 DWG、DXF、STEP 或 STP 文件，以获得更完整的解析结果。' : '完成当前任务后，下一阶段将在流程中自动解锁。'}</p></div></aside></div></main></div>;
}

export default AIQuoteCreation;
