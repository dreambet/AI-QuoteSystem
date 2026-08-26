import React, { useState, useRef, useMemo, useEffect, memo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import { quoteApi, uploadApi, catalogApi } from '../api/quotes';

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

// 单个图元：memo 隔离。选中态只影响新旧两个图元，其余 887 条线不重渲染，
// 否则每次点击特征都会触发全量 <Line> 几何体重建（drei Line 对新 points 数组即重建）。
const Drawing2DShape = memo(function Drawing2DShape({ feature, index, selected, toScene, scale, onSelectFeature }) {
  const data = feature.data || {};
  const color = selected ? '#ffb020' : '#d9f3ff';
  const lineWidth = selected ? 2.4 : 1.25;
  const point = toScene;
  const arcPoints = (d) => {
    const start = Math.abs(d.startAngle || 0) > Math.PI * 2 ? THREE.MathUtils.degToRad(d.startAngle || 0) : (d.startAngle || 0);
    let end = Math.abs(d.endAngle || 0) > Math.PI * 2 ? THREE.MathUtils.degToRad(d.endAngle || 0) : (d.endAngle || 0);
    if (end <= start) end += Math.PI * 2;
    return Array.from({ length: 49 }, (_, i) => {
      const angle = start + (end - start) * i / 48;
      return point(d.cx + Math.cos(angle) * d.r, d.cy + Math.sin(angle) * d.r);
    });
  };
  if (feature.type === '直线' && data.x1 != null && data.y1 != null) {
    return <Line points={[point(data.x1, data.y1), point(data.x2, data.y2)]} color={color} lineWidth={lineWidth} onClick={() => onSelectFeature(index)} />;
  }
  if (feature.type === '圆' && data.cx != null && data.cy != null && data.r > 0) {
    const points = Array.from({ length: 65 }, (_, segment) => {
      const angle = segment / 64 * Math.PI * 2;
      return point(data.cx + Math.cos(angle) * data.r, data.cy + Math.sin(angle) * data.r);
    });
    return <Line points={points} color={color} lineWidth={lineWidth} onClick={() => onSelectFeature(index)} />;
  }
  if (feature.type === '圆弧' && data.cx != null && data.cy != null && data.r > 0) {
    return <Line points={arcPoints(data)} color={color} lineWidth={lineWidth} onClick={() => onSelectFeature(index)} />;
  }
  if (feature.type === '椭圆' && data.cx != null && data.cy != null && Math.hypot(data.majorX, data.majorY) > 0) {
    const majorLength = Math.hypot(data.majorX, data.majorY);
    const start = data.startAngle || 0;
    let end = data.endAngle || Math.PI * 2;
    if (end <= start) end += Math.PI * 2;
    const points = Array.from({ length: 65 }, (_, segment) => {
      const angle = start + (end - start) * segment / 64;
      const major = Math.cos(angle) * majorLength;
      const minor = Math.sin(angle) * majorLength * data.axisRatio;
      const directionX = data.majorX / majorLength;
      const directionY = data.majorY / majorLength;
      return point(data.cx + directionX * major - directionY * minor, data.cy + directionY * major + directionX * minor);
    });
    return <Line points={points} color={color} lineWidth={lineWidth} onClick={() => onSelectFeature(index)} />;
  }
  if ((feature.type === '多段线' || feature.type === '样条曲线') && data.vertices?.length > 1) {
    const points = data.vertices.map(vertex => point(vertex.x, vertex.y));
    if (data.closed) points.push(points[0]);
    return <Line points={points} color={color} lineWidth={lineWidth} onClick={() => onSelectFeature(index)} />;
  }
  if (feature.type === '文本' && data.text && data.x != null && data.y != null) {
    return <Text position={point(data.x, data.y, 0.02)} color={color} fontSize={Math.max(0.1, Math.min(0.28, scale * 3))} anchorX="left" anchorY="middle">{data.text}</Text>;
  }
  return null;
});

function Drawing2DModel({ features, bounds, selectedFeatureIndex, onSelectFeature }) {
  const { scale, centerX, centerY } = useMemo(() => {
    const width = Math.max(bounds?.width || 0, 1);
    const height = Math.max(bounds?.height || 0, 1);
    return {
      scale: 8 / Math.max(width, height),
      centerX: ((bounds?.minX || 0) + (bounds?.maxX || 0)) / 2,
      centerY: ((bounds?.minY || 0) + (bounds?.maxY || 0)) / 2
    };
  }, [bounds]);
  // 稳定的坐标映射函数：bounds 不变时引用不变，保证 Drawing2DShape 的 memo 生效
  const toScene = useCallback((x, y, z = 0) => [(x - centerX) * scale, (y - centerY) * scale, z], [scale, centerX, centerY]);

  return <group>
    {features.map((feature, index) => <Drawing2DShape key={index} feature={feature} index={index} selected={index === selectedFeatureIndex} toScene={toScene} scale={scale} onSelectFeature={onSelectFeature} />)}
  </group>;
}

const StepMesh = memo(function StepMesh({ mesh, showEdges, selected }) {
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
});

// STEP 线路径：memo 隔离，避免选中特征变化时重建全部路径线几何
const StepLinePath = memo(function StepLinePath({ path }) {
  return <Line points={Array.from({ length: path.points.length / 3 }, (_, pointIndex) => path.points.slice(pointIndex * 3, pointIndex * 3 + 3))} color="#d9f3ff" lineWidth={1.2} />;
});

function StepMeshModel({ model, showEdges, selectedFeature, features, selectedFeatureIndex, onSelectFeature }) {
  const { center, scale } = useMemo(() => {
    const values = [
      ...(model.meshes || []).flatMap(mesh => mesh.positions || []),
      ...(model.linePaths || []).flatMap(path => path.points || [])
    ];
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
      {(model.meshes || []).map((mesh, index) => <StepMesh key={`${mesh.name}-${index}`} mesh={mesh} showEdges={showEdges} selected={selectedMeshIndex === index} />)}
      {(model.linePaths || []).map((path, index) => <StepLinePath key={`path-${index}`} path={path} />)}
    </group>
    <FeaturePointMarkers markers={worldMarkers} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} size={0.042} />
  </>;
}

// ========================
// 3D 预览容器
// ========================
// memo：弹窗(工序确认)开关等父组件状态变化不触发 three.js 场景重渲染，避免卡顿与视口跳动
const Part3DPreview = memo(function Part3DPreview({ quoteId, formData, analysisResult, selectedFeatureIndex, onSelectFeature }) {
  const viewportRef = useRef(null);
  const features = analysisResult?.features || [];
  const cadBounds = analysisResult?.cadInfo?.bounds || null;
  const cadEntityCount = analysisResult?.cadInfo?.entityCount || 0;
  const modelInfo = analysisResult?.modelInfo || analysisResult?.cadInfo?.modelInfo || {};
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

  const has2DDrawing = modelInfo.type === 'drawing2d' && features.length > 0;
  const hasStepModel = modelInfo.type === 'mesh' && (stepModel?.meshes?.length || stepModel?.linePaths?.length);
  const modelLabel = modelInfo.label || (has2DDrawing ? '二维原始平面图' : '未生成模型');

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
        {formData.partName || (has2DDrawing ? '二维平面图' : '零件 3D 预览')}
        {cadBounds && (
          <span className="viewport-subtitle">
            {cadBounds.width?.toFixed(0)} × {cadBounds.height?.toFixed(0)} mm
          </span>
        )}
      </div>
      <div className="viewport-help">
        <div>{has2DDrawing ? '滚轮缩放 | 右键平移 | 点击图元查看特征' : '拖拽旋转 | 滚轮缩放 | 右键平移'}</div>
        {features.length > 0 && (
          <div className="viewport-feature-count">
            {cadEntityCount > 0 && `${cadEntityCount} 实体 · `}
            {features.length} 特征
          </div>
        )}
      </div>
      <div className={`model-source-badge ${modelInfo.type || 'none'}`}>{modelLabel}</div>
      {hasStepModel && <button type="button" className="model-edge-toggle" onClick={() => setShowEdges(value => !value)}>{showEdges ? '隐藏轮廓' : '显示轮廓'}</button>}
      {loadingModel && <div className="model-message">正在加载原始三维模型…</div>}
      {!loadingModel && !has2DDrawing && !hasStepModel && (
        <div className="model-message error">{modelError || modelInfo.label || '未识别到可渲染的图纸实体，请检查文件后重试。'}</div>
      )}

      <Canvas
        camera={has2DDrawing ? { position: [0, 0, 10], fov: 45, near: 0.1, far: 100 } : { position: [8, 5, 8], fov: 45, near: 0.1, far: 100 }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 15, 8]} intensity={1.0} />
        <pointLight position={[-5, 8, 5]} intensity={0.5} color="#ffffff" />
        <pointLight position={[5, 3, -5]} intensity={0.3} color="#4a90d9" />

        {hasStepModel
          ? <StepMeshModel model={stepModel} showEdges={showEdges} selectedFeature={features[selectedFeatureIndex] || features[0]} features={features} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />
          : has2DDrawing && <Drawing2DModel features={features} bounds={cadBounds} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />}

        {!has2DDrawing && <Grid
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
        />}
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          enableZoom
          zoomSpeed={0.85}
          enableRotate={!has2DDrawing}
          screenSpacePanning={has2DDrawing}
          minDistance={2}
          maxDistance={80}
          target={has2DDrawing ? [0, 0, 0] : [0, 0.5, 0]}
        />
      </Canvas>
    </div>
  );
});

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
        <p>支持格式: DWG, DXF, STEP, STP</p>

        <input
          type="file"
          accept=".dwg,.dxf,.step,.stp"
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

function SpecField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return <label className="spec-field"><span>{label}</span><input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} /></label>;
}

// ---- 主题化下拉：替代原生 <select> ----
// Chrome 原生下拉弹层由浏览器进程绘制，首帧为默认白底（页面 CSS 管不到），
// 深色页面上表现为「先白一下再出选项」。此组件弹层由页面自身渲染，无白帧。
const ThemeSelect = memo(function ThemeSelect({ value, onChange, options, placeholder = '（请选择）', title }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef(null);
  // 下方空间不足且上方更宽裕时向上弹（如页面底部的报价策略），避免弹层超出视口
  const toggleMenu = () => {
    const rect = rootRef.current ? rootRef.current.getBoundingClientRect() : null;
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 280 && rect.top > spaceBelow);
    }
    setOpen(v => !v);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocMouseDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const selected = (options || []).find(o => String(o.value) === String(value));
  return (
    <div className={`theme-select${open ? ' open' : ''}${dropUp ? ' drop-up' : ''}`} ref={rootRef}>
      <button type="button" className="theme-select-trigger" title={title || (selected && selected.label)} onClick={toggleMenu}>
        <span className={selected ? '' : 'placeholder'}>{selected ? selected.label : placeholder}</span>
        <i className="theme-select-caret">▾</i>
      </button>
      {open && <div className="theme-select-popup" role="listbox">
        {(options || []).map(o => (
          <button type="button" key={o.value} role="option" aria-selected={String(o.value) === String(value)}
            className={`theme-select-option${String(o.value) === String(value) ? ' selected' : ''}`}
            onClick={() => { setOpen(false); onChange(o.value); }}>{o.label}</button>
        ))}
      </div>}
    </div>
  );
});

const num = v => { const n = typeof v === 'string' ? parseFloat(v) : Number(v); return Number.isFinite(n) ? n : 0; };

// ---- 毛重/净重按尺寸×密度自动计算 ----
// 形状：方块 = 长×宽×厚×密度；球体 = 4/3π(外径/2)³×密度。尺寸单位 mm，密度 g/cm³，结果 kg。
// dims: blankSpec 或 finishedSpec；density 缺失或尺寸不全时返回 null（退化为手填）。
const shapeWeightKg = (shape, dims, density) => {
  if (!(density > 0)) return null;
  if (shape === '球体') {
    const d = num(dims['外径']);
    if (!(d > 0)) return null;
    return +(4 / 3 * Math.PI * Math.pow(d / 2, 3) * density / 1e6).toFixed(4);
  }
  const l = num(dims['料长']), w = num(dims['料宽']), h = num(dims['料厚']);
  if (!(l > 0 && w > 0 && h > 0)) return null;
  return +(l * w * h * density / 1e6).toFixed(4);
};
// 自动算重（密度可得且尺寸齐全时覆盖毛/净重）+ 余料重量 = 毛重 − 净重（始终重算）
const autoCalcWeights = (data) => {
  const density = num(data.blankSpec['密度']);
  const shape = data.blankSpec['形状'] || '方块';
  const next = { ...data, blankSpec: { ...data.blankSpec }, finishedSpec: { ...data.finishedSpec } };
  const gross = shapeWeightKg(shape, next.blankSpec, density);
  if (gross != null) next.blankSpec['毛重'] = String(gross);
  const net = shapeWeightKg(shape, next.finishedSpec, density);
  if (net != null) next.finishedSpec['净重'] = String(net);
  const g = num(next.blankSpec['毛重']);
  const n = num(next.finishedSpec['净重']);
  next.blankSpec['余料重量'] = g > 0 && n > 0 && g >= n ? String(+(g - n).toFixed(4)) : '';
  return next;
};
// 触发自动算重的键：尺寸/形状/密度（手动改毛/净重不触发，只重算余料）
const WEIGHT_TRIGGER_KEYS = ['料长', '料宽', '料厚', '外径', '形状', '密度'];

// 计费类型选项：rateKey 为该类型可维护的费率字段（percentage 的率值来自策略默认，无需维护）
const PROCESS_TYPE_OPTIONS = [
  { value: 'time', label: '机加工（按时长）', rateLabel: '工费率(元/h)', rateKey: 'hourlyRate' },
  { value: 'percentage', label: '损耗率型（×R）', rateLabel: null, rateKey: null },
  { value: 'weight', label: '重量型（×净重）', rateLabel: '单价(元/kg)', rateKey: 'unitRate' },
  { value: 'manual', label: '单制程成本（填金额）', rateLabel: '默认金额(元)', rateKey: 'fixedAmount' }
];

// 工序确认面板：填值即选中，实时汇总 R/S/T/U/V/W；工站可新增/改名/改费率/删除（全局共享目录）
function ProcessConfirmPanel({ catalog, processInputs, onProcessInput, onToggleProcess, onCreateProcess, onUpdateProcess, onDeleteProcess, netWeight, inModal }) {
  const groups = [
    { title: '机加工（填加工时长=选中）', types: ['time'] },
    { title: '损耗率型（填损耗率=选中）', types: ['percentage'] },
    { title: '重量型（勾选=选中）', types: ['weight'] },
    { title: '单制程成本（填金额=选中）', types: ['manual'] }
  ];
  // 新增工站：direct=直接填成本（manual 快捷创建并立即选中）；full=完整定义（计费类型+费率）
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState('direct');
  const [addForm, setAddForm] = useState({ name: '', costType: 'manual', rate: '', amount: '' });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  // 行内编辑：名称 + 类型对应费率
  const [editCode, setEditCode] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', rate: '' });
  const [editBusy, setEditBusy] = useState(false);

  const addTypeOption = PROCESS_TYPE_OPTIONS.find(o => o.value === addForm.costType) || PROCESS_TYPE_OPTIONS[3];

  const submitAdd = async () => {
    const name = addForm.name.trim();
    if (!name) { setAddError('请填写工站名称'); return; }
    if (addMode === 'direct') {
      const amount = num(addForm.amount);
      if (!(amount > 0)) { setAddError('请填写成本金额'); return; }
      setAddBusy(true); setAddError('');
      try {
        const created = await onCreateProcess({ name, costType: 'manual', fixedAmount: amount });
        // 快捷模式：创建即选中，金额带入当前报价参与计算
        if (created && created.code) onProcessInput(created.code, 'amount', String(amount));
        setAddForm({ name: '', costType: 'manual', rate: '', amount: '' });
        setAdding(false);
      } catch (e) { setAddError(e.response?.data?.error || '新增工站失败'); }
      finally { setAddBusy(false); }
    } else {
      const rate = addTypeOption.rateKey ? num(addForm.rate) : null;
      if (addTypeOption.rateKey && !(rate > 0)) { setAddError(`请填写${addTypeOption.rateLabel}`); return; }
      setAddBusy(true); setAddError('');
      try {
        const payload = { name, costType: addForm.costType };
        if (addTypeOption.rateKey) payload[addTypeOption.rateKey] = rate;
        await onCreateProcess(payload);
        setAddForm({ name: '', costType: 'manual', rate: '', amount: '' });
        setAdding(false);
      } catch (e) { setAddError(e.response?.data?.error || '新增工站失败'); }
      finally { setAddBusy(false); }
    }
  };

  const startEdit = p => {
    setAddError('');
    setEditCode(p.code);
    const rate = p.costType === 'time' ? p.hourlyRate : p.costType === 'weight' ? p.unitRate : p.costType === 'manual' ? p.fixedAmount : '';
    setEditForm({ name: p.name, rate: rate == null ? '' : String(rate) });
  };
  const submitEdit = async p => {
    const name = editForm.name.trim();
    if (!name) { setAddError('工站名称不能为空'); return; }
    const option = PROCESS_TYPE_OPTIONS.find(o => o.value === p.costType);
    setEditBusy(true); setAddError('');
    try {
      const payload = { name };
      if (option && option.rateKey && editForm.rate !== '') payload[option.rateKey] = num(editForm.rate);
      await onUpdateProcess(p.id, payload);
      setEditCode(null);
    } catch (e) { setAddError(e.response?.data?.error || '保存失败'); }
    finally { setEditBusy(false); }
  };
  const removeProcess = async p => {
    if (!window.confirm(`删除工站「${p.name}」？删除后不再出现在工序列表，历史报价不受影响。`)) return;
    setAddError('');
    try {
      await onDeleteProcess(p.id);
      if (editCode === p.code) setEditCode(null);
    } catch (e) { setAddError(e.response?.data?.error || '删除失败'); }
  };

  return <div className={`process-confirm-panel${inModal ? ' in-modal' : ''}`}>
    {!inModal && <div className="mini-panel-title"><span>工序确认</span><b>填值即选中</b></div>}
    <div className="process-manage-bar">
      <button type="button" className="secondary-action process-add-btn" onClick={() => { setAdding(v => !v); setAddError(''); }}>{adding ? '收起新增' : '+ 新增工站'}</button>
      <small>工站全局共享，新增/修改后下次报价可直接复用</small>
    </div>
    {adding && <div className="process-add-form">
      <div className="process-add-modes">
        <label className={addMode === 'direct' ? 'active' : ''}><input type="radio" checked={addMode === 'direct'} onChange={() => setAddMode('direct')} />直接填成本</label>
        <label className={addMode === 'full' ? 'active' : ''}><input type="radio" checked={addMode === 'full'} onChange={() => setAddMode('full')} />完整定义</label>
      </div>
      <div className="process-add-grid">
        <label><span>工站名称</span><input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="如：CNC 精铣" autoFocus /></label>
        {addMode === 'direct'
          ? <label><span>成本金额(元)</span><input type="number" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} placeholder="本次报价直接计入" /></label>
          : <>
            <label><span>计费类型</span><select value={addForm.costType} onChange={e => setAddForm(f => ({ ...f, costType: e.target.value, rate: '' }))}>{PROCESS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            {addTypeOption.rateKey && <label><span>{addTypeOption.rateLabel}</span><input type="number" value={addForm.rate} onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))} /></label>}
          </>}
      </div>
      {addError && <p className="process-add-error">{addError}</p>}
      <button type="button" className="primary-action process-add-submit" disabled={addBusy} onClick={submitAdd}>{addBusy ? '保存中…' : '保存并加入列表'}</button>
    </div>}
    <div className="process-list">
      {groups.map(g => {
        const items = (catalog.processes || []).filter(p => g.types.includes(p.costType));
        if (!items.length) return null;
        return <div className="process-group" key={g.title}>
          <div className="process-group-title">{g.title}</div>
          {items.map(p => {
            const inp = processInputs[p.code] || {};
            const editing = editCode === p.code;
            const option = PROCESS_TYPE_OPTIONS.find(o => o.value === p.costType);
            if (editing) return <div className="process-row editing" key={p.code}>
              <input className="proc-input proc-name-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="工站名称" />
              {option && option.rateKey && <input className="proc-input" type="number" value={editForm.rate} onChange={e => setEditForm(f => ({ ...f, rate: e.target.value }))} placeholder={option.rateLabel} />}
              <span className="process-ops">
                <button type="button" className="table-action-btn" disabled={editBusy} onClick={() => submitEdit(p)}>{editBusy ? '保存中' : '保存'}</button>
                <button type="button" className="table-action-danger" onClick={() => setEditCode(null)}>取消</button>
              </span>
            </div>;
            return <div className="process-row" key={p.code}>
              <span className="process-name">{p.name}</span>
              {p.costType === 'time' && <>
                <input className="proc-input" type="number" placeholder="分钟" value={inp.minutes ?? ''} onChange={e => onProcessInput(p.code, 'minutes', e.target.value)} />
                <span className="process-rate">@{p.hourlyRate}元/h</span>
              </>}
              {p.costType === 'percentage' && <>
                <input className="proc-input" type="number" step="0.1" placeholder="损耗率%" value={inp.rate ?? ''} onChange={e => onProcessInput(p.code, 'rate', e.target.value)} />
                <span className="process-rate">×R</span>
              </>}
              {p.costType === 'weight' && <>
                <input type="checkbox" checked={!!inp.enabled} onChange={e => onToggleProcess(p.code, e.target.checked)} />
                <span className="process-rate">{p.unitRate}×净重({netWeight || 0})</span>
              </>}
              {p.costType === 'manual' && <>
                <input className="proc-input" type="number" placeholder="金额" value={inp.amount ?? ''} onChange={e => onProcessInput(p.code, 'amount', e.target.value)} />
                <span className="process-rate">元</span>
              </>}
              <span className="process-ops">
                <button type="button" className="table-action-btn" onClick={() => startEdit(p)} title="修改名称/费率">改</button>
                <button type="button" className="table-action-danger" onClick={() => removeProcess(p)} title="删除工站">删</button>
              </span>
            </div>;
          })}
        </div>;
      })}
    </div>
    {addError && !adding && <p className="process-add-error">{addError}</p>}
  </div>;
}

// 特征列表行：memo 隔离，点击选中时只重渲染新旧两行（887 项特征时全量 DOM diff 也可感知）
const FeatureRow = memo(function FeatureRow({ feature, index, selected, onSelect }) {
  const style = getFeatureStyle(feature.type);
  return <button type="button" className={`feature-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(index)}>
    <span className="feature-index">#{String(index + 1).padStart(2, '0')}</span><span className="feature-dot" style={{ background: style.color }} /><span className="feature-row-copy"><strong>{feature.type}</strong><small>{feature.description || '已识别 CAD 特征'}</small></span>
  </button>;
});

function FeatureReviewWorkspace({ quoteId, formData, quote, analysisResult, selectedFeatureIndex, onSelectFeature, onChange, onSpecChange, onMaterialChange, onEditDensity, catalog, processInputs, onProcessInput, onToggleProcess, onOpenProcess, onBack, onCalculate, loading }) {
  const features = analysisResult?.features || [];
  const is2DDrawing = (analysisResult?.modelInfo || analysisResult?.cadInfo?.modelInfo)?.type === 'drawing2d';
  const dimensions = analysisResult?.dimensions || formData;
  const metrics = [['长度', dimensions.length, 'mm'], ['宽度', dimensions.width, 'mm'], ['高度', dimensions.height, 'mm'], ['直径', dimensions.diameter, 'mm'], ['特征', features.length, '项'], ['实体', analysisResult?.cadInfo?.entityCount, '个']];
  const blankSpec = formData.blankSpec || {};
  const finishedSpec = formData.finishedSpec || {};
  // 尺寸字段随形状切换：方块显示 料长/步距/料宽/料厚，球体只显示 外径（材料规格与产品规格同规则）
  const isSphere = (blankSpec['形状'] || '方块') === '球体';
  const specField = (type, key) => ({
    value: (type === 'blank' ? blankSpec[key] : finishedSpec[key]) ?? '',
    onChange: e => onSpecChange(type, key, e.target.value)
  });
  const pct = v => `${Number(v) * 100}%`;
  const strategyLabel = (s) => `${s.name}（管销${pct(s.overheadRate)}/利润${pct(s.profitRate)}/税${pct(s.taxRate)}/倍率${Number(s.sampleMultiplier)}/材料损耗${pct(s.materialLossRate)}/刀具损耗${pct(s.toolLossRate)}）`;
  // 所选材质的计价方式：fixed=直接价格（K=单价本身）| weight=元/kg（K=毛重×单价）
  const selectedMaterial = (catalog.materials || []).find(m => m.code === formData.material);
  const unitPriceLabel = selectedMaterial && selectedMaterial.priceMode === 'fixed' ? '材料价格(元)' : '材料单价(元/kg)';
  return <div className="feature-review">
    <WorkspaceTitle eyebrow="STEP 03 / FEATURE REVIEW" title={is2DDrawing ? '确认图纸特征与成本参数' : '确认特征与成本参数'} description="参照渲染图纸核对尺寸，填写材料/产品规格，并在右侧确认工序与单价后计算报价。" badge={analysisResult?.modelInfo?.label || 'CAD 模型已载入'} />
    <div className="review-layout">
      <aside className="review-feature-panel">
        <div className="mini-panel-title"><span>识别特征</span><b>{features.length} 项</b></div>
        <div className="feature-scroll-area">
          {features.length ? features.map((feature, index) => <FeatureRow key={`${feature.type}-${index}`} feature={feature} index={index} selected={selectedFeatureIndex === index} onSelect={onSelectFeature} />) : <p className="empty-features">未识别到可定位特征，可直接核对下方参数。</p>}
        </div>
      </aside>
      <section className="review-model-panel">
        <div className="metric-grid compact">{metrics.map(([label, value, unit]) => <div className="metric-card" key={label}><small>{label}</small><strong>{value ?? '-'}<em>{unit}</em></strong></div>)}</div>
        <Part3DPreview quoteId={quoteId} formData={formData} analysisResult={analysisResult} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={onSelectFeature} />
        <p className="review-model-help">{is2DDrawing ? '滚轮缩放 · 右键平移 · 点击图元或左侧特征查看关联位置' : '拖拽旋转 · 滚轮缩放 · 点击色块或左侧特征查看关联位置'}</p>
      </section>
    </div>
    <section className="parameter-console">
      <div className="mini-panel-title"><span>参数修正</span><b>参照图纸核对规格与单价</b></div>
      <div className="spec-section">
        <div className="spec-section-title">基本信息</div>
        <div className="console-form-grid">
          <Field label="零件名称" name="partName" value={formData.partName} onChange={onChange} />
          <Field label="物料编码" name="materialCode" value={formData.materialCode} onChange={onChange} />
          <Field label="物料描述" name="partDescription" value={formData.partDescription} onChange={onChange} />
          <div className="process-modal-trigger"><button type="button" className="secondary-action" onClick={onOpenProcess}>⚙ 工序确认</button></div>
        </div>
      </div>
      <div className="spec-section">
        <div className="spec-section-title">材料规格（毛坯）</div>
        <div className="spec-edit-grid">
          <label className="spec-field material-field">
            <span>材质</span>
            <ThemeSelect
              value={formData.material}
              onChange={onMaterialChange}
              placeholder="（选择材质）"
              options={[
                ...(catalog.materials || []).map(m => {
                  const hasPrice = m.unitPrice != null && m.unitPrice !== '';
                  const priceTxt = hasPrice
                    ? (m.priceMode === 'fixed' ? `¥${Number(m.unitPrice).toFixed(2)}（直接价）` : `¥${Number(m.unitPrice).toFixed(2)}/kg`)
                    : '';
                  const confTxt = m.priceConfirmedAt ? ` · ${new Date(m.priceConfirmedAt).toLocaleDateString('zh-CN')} 确认` : '';
                  const staleTxt = hasPrice && m.priceStale ? ' · 超30天待复核' : '';
                  return { value: m.code, label: `${m.name}${hasPrice ? `（${priceTxt}${confTxt}${staleTxt}）` : ''}` };
                }),
                { value: '__new__', label: '（+ 新增材质）' }
              ]}
            />
          </label>
          <label className="spec-field">
            <span>形状</span>
            <ThemeSelect value={blankSpec['形状'] || '方块'} onChange={v => onSpecChange('blank', '形状', v)} options={[{ value: '方块', label: '方块' }, { value: '球体', label: '球体' }]} />
          </label>
          <label className="spec-field">
            <span>密度(g/cm³)<button type="button" className="rate-edit-btn" onClick={onEditDensity} title="维护目录密度">改</button></span>
            <input type="number" step="0.001" value={blankSpec['密度'] ?? ''} readOnly placeholder="点击「改」维护" className="spec-auto-value" title="密度按材质维护在目录中，点击「改」维护" />
          </label>
          {isSphere
            ? <SpecField label="外径(mm)" type="number" {...specField('blank', '外径')} />
            : <>
              <SpecField label="料长(mm)" type="number" {...specField('blank', '料长')} />
              <SpecField label="步距(mm)" type="number" {...specField('blank', '步距')} />
              <SpecField label="料宽(mm)" type="number" {...specField('blank', '料宽')} />
              <SpecField label="料厚(mm)" type="number" {...specField('blank', '料厚')} />
            </>}
          <SpecField label="毛重(kg)" type="number" step="0.0001" {...specField('blank', '毛重')} />
          <SpecField label="MOQ" type="number" {...specField('blank', 'MOQ')} />
          <label className="spec-field"><span>余料重量(kg)</span><input type="text" className="spec-auto-value" value={blankSpec['余料重量'] ?? ''} readOnly placeholder="毛重−净重自动算" /></label>
          <SpecField label="余料单价(元/kg)" type="number" step="0.01" {...specField('blank', '余料单价')} />
        </div>
        <p className="spec-hint">选好形状与密度后，毛重/净重按尺寸自动计算（方块=长×宽×厚×密度，球体=外径球体积×密度，可手动修改）；余料重量=毛重−净重自动算，不参与报价。</p>
      </div>
      <div className="spec-section">
        <div className="spec-section-title">产品规格（成品）</div>
        <div className="spec-edit-grid">
          {isSphere
            ? <SpecField label="外径(mm)" type="number" {...specField('finished', '外径')} />
            : <>
              <SpecField label="料长(mm)" type="number" {...specField('finished', '料长')} />
              <SpecField label="料宽(mm)" type="number" {...specField('finished', '料宽')} />
              <SpecField label="料厚(mm)" type="number" {...specField('finished', '料厚')} />
            </>}
          <SpecField label="净重(kg)" type="number" step="0.0001" {...specField('finished', '净重')} />
        </div>
      </div>
      <div className="spec-section">
        <div className="spec-section-title">单价确认</div>
        <div className="console-form-grid">
          <Field label={unitPriceLabel} type="number" step="0.01" name="unitPrice" value={formData.unitPrice} onChange={onChange} />
          <Field label="打样调机费" type="number" name="setupFee" value={formData.setupFee} onChange={onChange} />
          <Field label="良率(%)" type="number" step="0.1" name="yieldRate" value={formData.yieldRate} onChange={onChange} />
          <Field label="报价策略" name="strategyId">
            <ThemeSelect
              value={formData.strategyId}
              onChange={v => onChange({ target: { name: 'strategyId', value: v } })}
              placeholder="（选择报价策略）"
              options={(catalog.strategies || []).map(s => ({ value: s.id, label: strategyLabel(s) }))}
            />
          </Field>
        </div>
        <p className="price-warn">⚠️ 市场价格波动，请确认最新单价后再计算；此单价将作为本次报价的价格快照留存。{selectedMaterial && selectedMaterial.priceMode === 'fixed' ? '该材质为直接价格：材料成本 = 价格本身，不再乘毛重。' : ''}良率填写后报价单价 = W ÷ 良率（如 85% -> 单价/0.85），留空则不调整。</p>
      </div>
      <div className="workspace-actions"><button type="button" className="secondary-action" onClick={onBack}>返回分析</button><button type="button" className="primary-action" disabled={loading} onClick={onCalculate}>{loading ? '计算中…' : '确认参数并计算报价'}</button></div>
    </section>
  </div>;
}

// 默认规格骨架：新建/恢复流程共用，保证键完整
// 流式增量解析：从尚未生成完的 AI JSON 文本中提取"已闭合"的顶层字段，
// 供第5步流式呈现阶段分区渲染（卡片逐个从骨架变实体）。
const extractStreamingSections = text => {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const sections = { materialRecommendation: '', processSuggestions: [], warningPoints: [], suggestions: [] };
  const m = t.match(/"materialRecommendation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) { try { sections.materialRecommendation = JSON.parse(`"${m[1]}"`); } catch (_) { /* 未闭合/非法则跳过 */ } }
  // 对象数组（工艺建议）：提取已闭合的扁平对象
  const am = t.match(/"processSuggestions"\s*:\s*\[([\s\S]*?)(\]|$)/);
  if (am) {
    sections.processSuggestions = (am[1].match(/\{[^{}]*\}/g) || [])
      .map(s => { try { return JSON.parse(s); } catch (_) { return null; } })
      .filter(Boolean);
  }
  // 字符串数组（风险/优化建议）：提取已闭合的字符串项
  for (const key of ['warningPoints', 'suggestions']) {
    const sm = t.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(\\]|$)`));
    if (sm) {
      sections[key] = (sm[1].match(/"((?:[^"\\]|\\.)*)"/g) || [])
        .map(s => { try { return JSON.parse(s); } catch (_) { return null; } })
        .filter(Boolean);
    }
  }
  return sections;
};

const DEFAULT_BLANK_SPEC = { '材质': '', '料长': '', '步距': '', '料宽': '', '外径': '', '料厚': '', '毛重': '', 'MOQ': '', '余料重量': '', '余料单价': '', '形状': '方块', '密度': '' };
const DEFAULT_FINISHED_SPEC = { '料长': '', '料宽': '', '外径': '', '料厚': '', '净重': '' };
// 工作台会话键：报价未走完离开页面后，返回时按 quoteId 断点续走
const WORKBENCH_SESSION_KEY = 'ai-workbench-session';

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
  const [catalog, setCatalog] = useState({ materials: [], processes: [], strategies: [] });
  const [processInputs, setProcessInputs] = useState({});
  const [processModalOpen, setProcessModalOpen] = useState(false);
  // AI 报价建议流式生成状态：null=非流式/已完成；{ active, text, reasoning }=正在流式生成
  // text=正文增量（用于卡片分区渲染），reasoning=模型思考过程增量（用于即时反馈）
  const [aiStream, setAiStream] = useState(null);
  const aiStreamAbortRef = useRef(null);
  // 思考过程面板：完整内容展示 + 自动吸底（此前用 slice(-800) 滑动窗口导致内容回退跳变）。
  // 吸底失效修复：程序赋值 scrollTop 派发的 scroll 事件在密集增量下会被误判为用户上滚，
  // 以时间窗忽略程序滚动后短时间内的 scroll 事件
  const reasoningPreRef = useRef(null);
  const reasoningStickRef = useRef(true);
  const reasoningAutoScrollAtRef = useRef(0);
  useEffect(() => {
    const el = reasoningPreRef.current;
    if (el && reasoningStickRef.current) {
      reasoningAutoScrollAtRef.current = Date.now();
      el.scrollTop = el.scrollHeight;
    }
  }, [aiStream && aiStream.reasoning]);
  const handleReasoningScroll = () => {
    if (Date.now() - reasoningAutoScrollAtRef.current < 120) return;
    const el = reasoningPreRef.current;
    if (!el) return;
    reasoningStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };
  // 组件卸载（跳转详情/列表页）时中止进行中的流式生成
  useEffect(() => () => { if (aiStreamAbortRef.current) aiStreamAbortRef.current.abort(); }, []);
  const [formData, setFormData] = useState({
    partName: '', materialCode: '', partDescription: '', material: '',
    quantity: '',
    blankSpec: { ...DEFAULT_BLANK_SPEC },
    finishedSpec: { ...DEFAULT_FINISHED_SPEC },
    unitPrice: '', setupFee: 300, strategyId: '', yieldRate: ''
  });

  // 恢复未完成的报价流程：同会话内离开工作台再返回，或从详情页「继续报价流程」(?resume=<id>) 进入
  useEffect(() => {
    (async () => {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(WORKBENCH_SESSION_KEY) || 'null'); } catch { saved = null; }
      const params = new URLSearchParams(window.location.search);
      const resumeId = params.get('resume');
      const id = resumeId || saved?.quoteId;
      if (!id) return;
      try {
        const q = (await quoteApi.getById(id)).data;
        if (!q || q.status === 'finalized' || q.status === 'rejected') { sessionStorage.removeItem(WORKBENCH_SESSION_KEY); return; }
        // 流程已交付（AI 建议已生成）：视为完成，不再自动续走，清空会话回到第1步开始新报价；
        // 仅当从详情页明确带 ?resume= 进入时才恢复（查看/复核场景）
        const flowFinished = !!q.aiQuoteAnalysis || (saved?.quoteId === id && saved.step >= 5);
        if (flowFinished && !resumeId) { sessionStorage.removeItem(WORKBENCH_SESSION_KEY); return; }
        const sameTask = saved?.quoteId === q.id;
        const analysis = (sameTask && saved.analysisResult) || q.drawingAnalysis || null;
        const analysisReady = !!(analysis && (analysis.features?.length || analysis.modelInfo || analysis.notes));
        setQuoteId(q.id); setQuote(q);
        setAnalysisResult(analysisReady ? { ...analysis, aiQuotation: analysis.aiQuotation || q.aiQuoteAnalysis } : null);
        setFormData(sameTask && saved.formData ? saved.formData : {
          partName: q.partName || '', materialCode: q.materialCode || '', partDescription: q.partDescription || '', material: q.material || '', quantity: q.quantity ?? '',
          blankSpec: { ...DEFAULT_BLANK_SPEC, ...(q.blankSpec || {}) }, finishedSpec: { ...DEFAULT_FINISHED_SPEC, ...(q.finishedSpec || {}) },
          unitPrice: q.priceSnapshot?.unitPrice != null ? String(q.priceSnapshot.unitPrice) : '',
          setupFee: q.processSnapshot?.strategy?.setupFee ?? 300,
          strategyId: q.processSnapshot?.strategy?.id != null ? String(q.processSnapshot.strategy.id) : '',
          yieldRate: q.calculation?.inputs?.yieldRate != null ? String(q.calculation.inputs.yieldRate) : (q.priceSnapshot?.yieldRate != null ? String(q.priceSnapshot.yieldRate) : '')
        });
        if (sameTask && saved.processInputs) setProcessInputs(saved.processInputs);
        // 恢复步骤：有会话用会话步骤；否则按数据完成度推导（分析->计算->AI建议）；
        // 显式 ?step= 优先（详情页语义审核"去修改"直达第3步改特征/工序后重算）
        let nextStep = sameTask && saved.step ? saved.step : analysisReady ? (q.calculation ? (q.aiQuoteAnalysis ? 5 : 4) : 3) : 2;
        const stepParam = resumeId ? parseInt(params.get('step'), 10) : NaN;
        if (Number.isFinite(stepParam) && stepParam >= 2 && stepParam <= 5 && analysisReady) nextStep = stepParam;
        setStep(nextStep);
      } catch { /* 恢复失败按新任务处理 */ }
    })();
  }, []);

  // 工作台状态持久化：任意关键状态变化即写入 sessionStorage，供返回时续走
  useEffect(() => {
    if (!quoteId) return;
    try { sessionStorage.setItem(WORKBENCH_SESSION_KEY, JSON.stringify({ quoteId, step, formData, processInputs, analysisResult })); } catch { /* 超限时忽略 */ }
  }, [quoteId, step, formData, processInputs, analysisResult]);

  useEffect(() => {
    Promise.all([catalogApi.getMaterials(), catalogApi.getProcesses(), catalogApi.getStrategies()])
      .then(([m, p, s]) => setCatalog({ materials: m.data, processes: p.data, strategies: s.data }))
      .catch(() => { /* 目录加载失败不阻塞流程 */ });
  }, []);

  // 工序确认弹窗打开时锁定背景滚动，避免弹窗内滚动带动确认特征页面
  useEffect(() => {
    document.body.style.overflow = processModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [processModalOpen]);

  const completedStep = analysisResult?.aiQuotation ? 5 : quote?.calculation ? 4 : analysisResult ? 3 : quote ? 2 : 1;
  const handleFormChange = (event) => setFormData(data => ({ ...data, [event.target.name]: event.target.value }));
  const handleSpecChange = (type, key, value) => setFormData(data => {
    const fieldKey = type === 'blank' ? 'blankSpec' : 'finishedSpec';
    let next = { ...data, [fieldKey]: { ...data[fieldKey], [key]: value } };
    // 报价数量以 MOQ 为准：填写 MOQ 即联动数量；清空/非法则回落 1
    if (type === 'blank' && key === 'MOQ') {
      const moq = parseFloat(value);
      next.quantity = Number.isFinite(moq) && moq > 0 ? String(Math.floor(moq)) : '1';
    }
    if (WEIGHT_TRIGGER_KEYS.includes(key)) {
      // 改尺寸/形状/密度 -> 重算毛/净重（密度可得且尺寸齐全才覆盖）+ 余料
      next = autoCalcWeights(next);
    } else if (key === '毛重' || key === '净重') {
      // 手动改毛/净重：允许覆盖自动值，只重算余料（余料=毛重−净重，不参与报价）
      const g = num(next.blankSpec['毛重']);
      const n = num(next.finishedSpec['净重']);
      next.blankSpec = { ...next.blankSpec, '余料重量': g > 0 && n > 0 && g >= n ? String(+(g - n).toFixed(4)) : '' };
    }
    return next;
  });
  // 材质选择：选已有 -> 同步 formData.material 与 blankSpec.材质；选"新增" -> 弹窗录入并自动入库
  const handleMaterialChange = async (value) => {
    if (value === '__new__') {
      const code = window.prompt('输入新材质牌号（编码，如 S31603）', '');
      if (!code || !code.trim()) return;
      if ((catalog.materials || []).some(m => m.code === code.trim())) { setError('该材质已存在，已自动选中'); setFormData(d => ({ ...d, material: code.trim(), blankSpec: { ...d.blankSpec, '材质': code.trim() } })); return; }
      // 计价方式：1=按公斤（元/kg），2=直接价格（K=单价本身）；留空默认按公斤
      const modeAnswer = window.prompt('该材质计价方式：输入 1 = 按公斤（元/kg），输入 2 = 直接价格', '1');
      const priceMode = String(modeAnswer == null ? '1' : modeAnswer).trim() === '2' ? 'fixed' : 'weight';
      // 密度（g/cm³，可选）：用于按尺寸自动算毛/净重（如不锈钢 7.93、铝 2.70）
      const densityAnswer = window.prompt('该材质密度（g/cm³，如不锈钢 7.93、铝 2.70；可留空）', '');
      const density = densityAnswer != null && densityAnswer.trim() !== '' && !Number.isNaN(Number(densityAnswer)) ? Number(densityAnswer) : null;
      try {
        await catalogApi.createMaterial({ code: code.trim(), name: code.trim(), priceMode, density });
        const m = await catalogApi.getMaterials();
        setCatalog(c => ({ ...c, materials: m.data }));
        setFormData(d => ({ ...d, material: code.trim(), blankSpec: { ...d.blankSpec, '材质': code.trim() } }));
        setError(null);
      } catch (err) { setError(err.response?.data?.error || '新增材质失败'); }
      return;
    }
    // 选中已有材质：自动带入目录 active 单价（单价确认）与目录密度（g/cm³，触发毛/净重按尺寸自动算）
    const material = (catalog.materials || []).find(m => m.code === value);
    setFormData(data => autoCalcWeights({
      ...data,
      material: value,
      blankSpec: {
        ...data.blankSpec,
        '材质': value,
        '密度': material && material.density != null && material.density !== '' ? String(Number(material.density)) : data.blankSpec['密度']
      },
      unitPrice: material && material.unitPrice != null && material.unitPrice !== '' ? String(Number(material.unitPrice)) : ''
    }));
  };
  const chooseFile = (file) => {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.dwg', '.dxf', '.step', '.stp'].includes(ext)) {
      setError('仅支持 DWG / DXF / STEP / STP 格式的 CAD 图纸');
      return;
    }
    setSelectedFile(file);
    setError(null);
  };
  const onProcessInput = (code, field, value) => setProcessInputs(s => ({ ...s, [code]: { ...(s[code] || {}), [field]: value } }));
  const onToggleProcess = (code, checked) => setProcessInputs(s => ({ ...s, [code]: { ...(s[code] || {}), enabled: checked } }));
  // 工站维护（全局共享目录）：新增/修改/删除即时刷新本地 catalog，计算链路无需感知
  const createProcess = async payload => {
    const response = await catalogApi.createProcess(payload);
    setCatalog(c => ({ ...c, processes: [...c.processes, response.data] }));
    return response.data;
  };
  const updateProcess = async (id, payload) => {
    const response = await catalogApi.updateProcess(id, payload);
    setCatalog(c => ({ ...c, processes: c.processes.map(x => x.id === id ? { ...x, ...response.data } : x) }));
    return response.data;
  };
  const deleteProcess = async id => {
    await catalogApi.deleteProcess(id);
    setCatalog(c => ({ ...c, processes: c.processes.filter(x => x.id !== id) }));
  };
  // 密度目录维护：物理常数，直接更新 materials.density 并同步本次表单（重新触发毛/净重自动算）
  const onEditDensity = async () => {
    const material = (catalog.materials || []).find(m => m.code === formData.material);
    if (!material) { setError('请先选择材质，密度按材质维护在目录中'); return; }
    const answer = window.prompt(`维护「${material.name}」目录密度（g/cm³，如不锈钢 7.93）`, material.density ?? '');
    if (answer == null || String(answer).trim() === '') return;
    const density = Number(answer);
    if (!Number.isFinite(density) || density <= 0) { setError('密度需为正数'); return; }
    try {
      await catalogApi.updateMaterial(material.id, { density });
      setCatalog(c => ({ ...c, materials: c.materials.map(x => x.id === material.id ? { ...x, density } : x) }));
      setFormData(d => autoCalcWeights({ ...d, blankSpec: { ...d.blankSpec, '密度': String(density) } }));
    } catch (e) { setError(e.response?.data?.error || '密度更新失败'); }
  };

  const resolveStrategy = () => (catalog.strategies || []).find(s => String(s.id) === String(formData.strategyId)) || (catalog.strategies || [])[0] || { overheadRate: 0.1, profitRate: 0.3, taxRate: 0.13, sampleMultiplier: 1, materialLossRate: 0.05, toolLossRate: 0.08 };

  const createQuote = async () => {
    if (!selectedFile) { setError('请上传一份图纸后再继续。'); return; }
    setLoading(true); setError(null);
    try {
      const drawingPath = (await uploadApi.uploadDrawing(selectedFile)).data.filename;
      const response = await quoteApi.create({ drawingPath, partName: selectedFile.name.replace(/\.[^.]+$/, '') });
      setQuoteId(response.data.id); setQuote(response.data); setAnalysisResult(null); setStep(2);
    } catch (err) { setError(err.response?.data?.error || '创建报价任务失败'); } finally { setLoading(false); }
  };
  const analyzeDrawing = async () => {
    if (!quote?.drawingPath) { setError('未找到图纸，请返回第一步上传文件。'); return; }
    setLoading(true); setError(null);
    try {
      const response = await quoteApi.analyzeDrawing(quoteId, { drawingPath: quote.drawingPath, context: '请详细分析这张机加工图纸' });
      setAnalysisResult(response.data.analysis); setSelectedFeatureIndex(0);
      if (response.data.quote) {
        const q = response.data.quote;
        const dims = response.data.analysis?.dimensions || {};
        setFormData(d => {
          // AI 识别出材质后，自动带入目录当前 active 单价到「单价确认-材料单价」
          const mat = (catalog.materials || []).find(m => m.code === (q.material || d.material));
          return {
            ...d,
            partName: q.partName || d.partName,
            partDescription: q.partDescription || d.partDescription,
            material: q.material || d.material,
            quantity: q.quantity || 1,
            blankSpec: { ...d.blankSpec, '材质': q.material || d.blankSpec['材质'], '料长': dims.length ?? d.blankSpec['料长'], '料宽': dims.width ?? d.blankSpec['料宽'], '料厚': dims.height ?? d.blankSpec['料厚'], '外径': dims.diameter ?? d.blankSpec['外径'] },
            finishedSpec: { ...d.finishedSpec, '料长': dims.length ?? d.finishedSpec['料长'], '料宽': dims.width ?? d.finishedSpec['料宽'], '料厚': dims.height ?? d.finishedSpec['料厚'], '外径': dims.diameter ?? d.finishedSpec['外径'] },
            unitPrice: mat && mat.unitPrice != null && mat.unitPrice !== '' ? String(Number(mat.unitPrice)) : d.unitPrice
          };
        });
      }
      setStep(3);
    } catch (err) { setError(err.response?.data?.error || '图纸分析失败'); } finally { setLoading(false); }
  };
  const calculateQuote = async () => {
    setLoading(true); setError(null);
    try {
      const grossWeight = num(formData.blankSpec?.['毛重']);
      const netWeight = num(formData.finishedSpec?.['净重']);
      // 报价数量 = MOQ 优先：填了 MOQ 按 MOQ 计，未填默认 1
      const moq = num(formData.blankSpec?.['MOQ']);
      const quantity = moq > 0 ? Math.floor(moq) : (num(formData.quantity) || 1);
      await quoteApi.update(quoteId, {
        partName: formData.partName, materialCode: formData.materialCode, partDescription: formData.partDescription, material: formData.material,
        quantity,
        grossWeight, netWeight,
        blankSpec: formData.blankSpec, finishedSpec: formData.finishedSpec
      });
      const strategy = resolveStrategy();
      const processSelection = (catalog.processes || []).map(p => {
        const inp = processInputs[p.code] || {};
        if (p.costType === 'time') { const mins = num(inp.minutes); return mins > 0 ? { processCode: p.code, costType: 'time', hourlyRate: num(p.hourlyRate), minutes: mins } : null; }
        if (p.costType === 'percentage') { const rate = (inp.rate !== '' && inp.rate != null) ? num(inp.rate) / 100 : (p.code === 'material-loss' ? num(strategy.materialLossRate) : p.code === 'tool-loss' ? num(strategy.toolLossRate) : 0); return rate > 0 ? { processCode: p.code, costType: 'percentage', rate } : null; }
        if (p.costType === 'weight') { return inp.enabled ? { processCode: p.code, costType: 'weight', unitRate: num(p.unitRate) } : null; }
        if (p.costType === 'manual') { const amt = num(inp.amount); return amt > 0 ? { processCode: p.code, costType: 'manual', amount: amt } : null; }
        return null;
      }).filter(Boolean);
      const response = await quoteApi.calculate(quoteId, {
        processSelection,
        unitPrice: formData.unitPrice !== '' ? num(formData.unitPrice) : undefined,
        strategyId: formData.strategyId || undefined,
        setupFee: num(formData.setupFee),
        // 计价方式随所选材质（元/kg 或 直接价格）；良率留空则不调整
        priceMode: ((catalog.materials || []).find(m => m.code === formData.material) || {}).priceMode || undefined,
        yieldRate: formData.yieldRate !== '' ? num(formData.yieldRate) : undefined
      });
      setQuote(response.data); setStep(4);
    } catch (err) { setError(err.response?.data?.error || '计算报价失败'); } finally { setLoading(false); }
  };
  const requestAiQuote = async () => {
    setLoading(true); setError(null);
    // 流式：立即进入第5步看 AI 逐字生成；失败降级非流式；返回上一步可取消
    const controller = new AbortController();
    aiStreamAbortRef.current = controller;
    setAiStream({ active: true, text: '' });
    setStep(5);
    const applyResult = (data) => {
      setQuote(data.quote);
      setAnalysisResult(result => ({ ...(result || {}), aiQuotation: data.aiAnalysis }));
      setAiStream(null);
    };
    let gotDone = false;
    try {
      await quoteApi.aiQuoteStream(quoteId, {
        onDelta: (t, kind) => setAiStream(s => (s ? (kind === 'reasoning' ? { ...s, reasoning: (s.reasoning || '') + t } : { ...s, text: s.text + t }) : s)),
        onDone: data => { gotDone = true; applyResult(data); },
        onError: () => { /* 交给流结束后的降级逻辑 */ }
      }, controller.signal);
      if (gotDone) return;
      throw new Error('流式结果不完整');
    } catch (err) {
      if (controller.signal.aborted) { setAiStream(null); return; } // 用户取消，不降级
      // 降级：改走非流式接口
      try {
        const response = await quoteApi.aiQuote(quoteId, { useAnalysisData: true });
        applyResult(response.data);
      } catch (err2) {
        setError(err2.response?.data?.error || 'AI 报价分析失败');
        setAiStream(null);
      }
    } finally { setLoading(false); }
  };
  // 流式生成中返回上一步 = 取消生成（后端同步中止上游，不浪费 token）
  const abortAiStream = () => { if (aiStreamAbortRef.current) aiStreamAbortRef.current.abort(); setAiStream(null); setStep(4); };

  const renderStep1 = () => <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 01 / INTAKE" title="上传机加工图纸" description="先选择图纸建立任务；材料规格、产品规格与工序将在第3步参照解析结果确认。" badge="支持 DWG · DXF · STEP · STP" /><div className="intake-grid intake-single"><section className={`drop-zone ${dragActive ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={event => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}><span className="drop-zone-orbit" /><div className="drop-zone-icon">CAD</div><h3>{selectedFile ? selectedFile.name : '拖拽图纸到此处'}</h3><p>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 等待建立分析任务` : '或从本地选择文件。二维图纸与三维模型均可解析。'}</p><label className="secondary-action file-picker">选择图纸<input type="file" accept=".dwg,.dxf,.step,.stp" onChange={event => chooseFile(event.target.files?.[0])} /></label><div className="format-chips"><span>DWG</span><span>DXF</span><span>STEP</span><span>STP</span></div></section><div className="workspace-actions"><button type="button" className="primary-action" onClick={createQuote} disabled={loading}>{loading ? '正在建立任务…' : '建立分析任务'}</button></div></div></div>;
  const renderStep2 = () => <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 02 / AI PARSING" title="智能解析 CAD 图纸" description="系统会识别几何轮廓、尺寸、特征与模型来源，并准备进入人工复核。" badge={fileExtension(quote?.drawingPath)} /><div className="analysis-command"><div className="command-orb">AI</div><div><span className="eyebrow">READY TO ANALYZE</span><h3>{fileName(quote?.drawingPath)}</h3><p>已建立零件任务。开始分析后，系统将提取几何信息并生成特征确认视图。</p></div><button type="button" className="primary-action" onClick={analyzeDrawing} disabled={loading}>{loading ? '正在解析…' : '开始 AI 分析'}</button></div><div className="status-card-grid"><div><span>输入格式</span><strong>{fileExtension(quote?.drawingPath)}</strong><small>CAD 文件已就绪</small></div><div><span>解析范围</span><strong>几何 + 特征</strong><small>尺寸、轮廓、孔位</small></div><div><span>下一节点</span><strong>人工确认</strong><small>进入三维模型复核</small></div></div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(1)}>返回上传</button></div></div>;
  const renderStep4 = () => { const calc = quote?.calculation; const yieldRate = calc?.inputs?.yieldRate; const costs = [['材料成本 K', calc?.materialCost], ['机加工成本 R', calc?.machiningCost], ['管销 S', calc?.overhead], ['小计 T', calc?.subtotal], ['利润 U', calc?.profit], ['含税 V', calc?.taxIncluded], ['样品价 W', calc?.samplePrice], ...(yieldRate ? [[`良率调整（${yieldRate}%）`, calc?.unitPrice]] : []), ['调机费', calc?.setupFee]]; return <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 04 / PRICING" title="报价成本计算结果" description="费用按 K→R→S→T→U→V→W 公式链生成，可返回第3步调整工序与单价。" badge={calc ? '报价已计算' : '等待计算'} />{calc ? <><div className="quote-result-hero"><div><span>参考总价</span><strong>{money(calc.total)}</strong><small>单价 {money(calc.unitPrice)}{yieldRate ? `（W ${money(calc.samplePrice)} ÷ 良率${yieldRate}%）` : ''} · 数量 {formData.quantity}</small></div><span>CALCULATED</span></div><div className="cost-card-grid">{costs.map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(3)}>返回修改参数</button><button type="button" className="primary-action" onClick={requestAiQuote} disabled={loading}>{loading ? 'AI 分析中…' : '生成 AI 报价建议'}</button></div></> : <div className="console-empty">尚未取得报价结果，请先完成特征确认。</div>}</div>; };
  const renderStep5 = () => {
    const ai = analysisResult?.aiQuotation;
    // ---- 阶段一：流式生成中（骨架卡片 + 增量解析出的内容逐区长出） ----
    if (aiStream?.active) {
      const partial = extractStreamingSections(aiStream.text);
      const streamGroups = [
        ['材料推荐', partial.materialRecommendation ? [partial.materialRecommendation] : []],
        ['工艺建议', partial.processSuggestions.map(item => `${item.process || item.name}：${item.reason}`)],
        ['风险提示', partial.warningPoints],
        ['优化建议', partial.suggestions]
      ];
      const reasoning = aiStream.reasoning || '';
      return <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 05 / DELIVERY" title="报价交付与 AI 建议" description="汇总报价结论、工艺判断和关键风险，支持返回任意已完成步骤复核。" badge="AI 生成中" /><div className="delivery-total"><span>最终参考报价</span><strong>{money(quote?.calculation?.total)}</strong><small>{formData.partName || '未命名零件'} · {formData.material} · {formData.quantity} 件</small></div><div className="stream-status"><span className="stream-dot" />{aiStream.text.length ? `AI 正在生成建议 · 已输出 ${aiStream.text.length} 字` : `AI 正在推理分析 · 已思考 ${reasoning.length} 字`}</div>{reasoning && !aiStream.text && <details className="stream-reasoning" open><summary>思考过程（实时）</summary><pre ref={reasoningPreRef} onScroll={handleReasoningScroll}>{reasoning}</pre></details>}<div className="advice-grid">{streamGroups.map(([title, items]) => <section key={title} className={items.length ? 'advice-live' : 'advice-pending'}><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <><div className="skeleton-line" /><div className="skeleton-line" style={{ width: '72%' }} /><div className="skeleton-line" style={{ width: '45%' }} /></>}</section>)}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={abortAiStream}>取消并返回</button></div></div>;
    }
    // ---- 阶段二：生成完成（done 事件权威数据） ----
    const groups = [['材料推荐', ai?.materialRecommendation ? [ai.materialRecommendation] : []], ['工艺建议', ai?.processSuggestions?.map(item => `${item.process || item.name}：${item.reason}`) || []], ['风险提示', ai?.warningPoints || []], ['优化建议', ai?.suggestions || []]]; return <div className="step-workspace"><WorkspaceTitle eyebrow="STEP 05 / DELIVERY" title="报价交付与 AI 建议" description="汇总报价结论、工艺判断和关键风险，支持返回任意已完成步骤复核。" badge="交付就绪" /><div className="delivery-total"><span>最终参考报价</span><strong>{money(quote?.calculation?.total)}</strong><small>{formData.partName || '未命名零件'} · {formData.material} · {formData.quantity} 件</small></div><div className="advice-grid">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>暂无额外建议。</p>}</section>)}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => setStep(4)}>返回报价计算</button><Link className="primary-action link-action" to={`/quotes/${quoteId}`}>查看报价详情</Link><Link className="secondary-action link-action" to="/quotes">返回报价列表</Link></div></div>;
  };
  const mainContent = step === 1 ? renderStep1() : step === 2 ? renderStep2() : step === 3 ? <FeatureReviewWorkspace quoteId={quoteId} formData={formData} quote={quote} analysisResult={analysisResult} selectedFeatureIndex={selectedFeatureIndex} onSelectFeature={setSelectedFeatureIndex} onChange={handleFormChange} onSpecChange={handleSpecChange} onMaterialChange={handleMaterialChange} onEditDensity={onEditDensity} catalog={catalog} processInputs={processInputs} onProcessInput={onProcessInput} onToggleProcess={onToggleProcess} onOpenProcess={() => setProcessModalOpen(true)} onBack={() => setStep(2)} onCalculate={calculateQuote} loading={loading} /> : step === 4 ? renderStep4() : renderStep5();
  const context = step === 3 ? (analysisResult?.features || []).length : step >= 4 ? money(quote?.calculation?.total) : quote ? fileExtension(quote.drawingPath) : '等待输入';
  return <div className="ai-quote-page"><main className="cad-console"><header className="console-hero"><div><span className="eyebrow">CAD INTELLIGENCE / QUOTATION WORKBENCH</span><h1>机加工模型分析工作台</h1><p>从图纸解析到报价交付，在同一个精密制造工作台内完成。</p></div><div className="console-hero-status"><span>{quote ? '任务进行中' : '新建任务'}</span><span>{fileExtension(quote?.drawingPath || selectedFile?.name)}</span><span>360° 预览</span></div></header><div className={`console-layout${step === 3 ? ' step3-full' : ''}`}><aside className="workflow-rail"><div className="rail-heading"><span>ANALYSIS FLOW</span><b>{step} / 5</b></div><nav>{WORKFLOW_STEPS.map(item => { const available = item.id <= completedStep; const state = item.id === step ? 'active' : item.id < step || (item.id < completedStep) ? 'done' : 'locked'; return <button key={item.id} type="button" className={`workflow-node ${state}`} disabled={!available} onClick={() => available && setStep(item.id)}><i>{state === 'done' ? '✓' : item.icon}</i><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>{state === 'locked' && <em>LOCK</em>}</button>; })}</nav><div className="rail-footnote"><span>当前任务</span><strong>{quoteId ? `#${quoteId}` : '未创建'}</strong><small>后续步骤将在前置数据完成后自动解锁</small></div></aside><section className="console-main">{error && <div className="console-error">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}{mainContent}</section>{step !== 3 && <aside className="context-rail"><div className="context-title"><span>任务摘要</span><b>LIVE</b></div><div className="context-file"><span className="context-file-type">{fileExtension(quote?.drawingPath || selectedFile?.name)}</span><small>当前图纸</small><strong>{fileName(quote?.drawingPath || selectedFile?.name)}</strong></div><div className="context-stat"><span>{step === 3 ? '识别特征' : step >= 4 ? '当前报价' : '任务状态'}</span><strong>{context}</strong><small>{step === 3 ? '可选择并定位' : step >= 4 ? '含成本构成' : quote ? '等待下一步操作' : '请上传图纸'}</small></div>{step >= 4 && <div className="context-list"><span>数据概览</span><p>物料描述 <strong>{formData.partDescription || '-'}</strong></p><p>材料 <strong>{formData.material || '-'}</strong></p><p>毛重 <strong>{formData.blankSpec?.['毛重'] || '-'}</strong></p><p>MOQ数量 <strong>{formData.blankSpec?.['MOQ'] || '-'}</strong></p></div>}<div className="context-tip"><span>操作提示</span><p>{step === 3 ? '在参数修正-基本信息中点击「工序确认」填写工序参数，填值即选中。' : step === 1 ? '优先上传 DWG、DXF、STEP 或 STP 文件，以获得更完整的解析结果。' : '完成当前任务后，下一阶段将在流程中自动解锁。'}</p></div></aside>}</div>{step === 3 && processModalOpen && <div className="console-modal-mask" onClick={() => setProcessModalOpen(false)}><div className="console-modal" onClick={event => event.stopPropagation()}><div className="console-modal-head"><div><span>工序确认</span><small>填加工时长 / 损耗率% / 单制程成本金额即选中对应工序，未填值不参与计算</small></div><button type="button" onClick={() => setProcessModalOpen(false)}>×</button></div><div className="console-modal-body"><ProcessConfirmPanel inModal catalog={catalog} processInputs={processInputs} onProcessInput={onProcessInput} onToggleProcess={onToggleProcess} onCreateProcess={createProcess} onUpdateProcess={updateProcess} onDeleteProcess={deleteProcess} netWeight={num((formData.finishedSpec || {})['净重'])} /></div><div className="console-modal-foot"><span className="console-modal-hint">工站可新增/修改/删除（全局共享）；阳极氧化按勾选：单价×净重；损耗率留空则沿用所选策略默认值。</span><button type="button" className="primary-action" onClick={() => setProcessModalOpen(false)}>完成确认</button></div></div></div>}</main></div>;
}

export default AIQuoteCreation;
