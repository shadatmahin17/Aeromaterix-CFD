import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AircraftModelType } from '../types/aerodynamics';
import { AIRCRAFT_MODELS } from '../utils/airfoilGenerators';
import {
  loadGlbAircraftModel,
  GLB_MODEL_REGISTRY,
  applyCfdPressureHeatmap,
  restoreOriginalGlbMaterials,
  applyWireframeShading,
  createAeroForceVectorsGroup,
  updateAeroForceVectors,
} from '../utils/aircraftGlbModels';
import { getAircraft3DModel, computeFaceNormal, Vertex3D } from '../utils/aircraft3DGeometry';
import { createSafeWebGLRenderer } from '../utils/webglSupport';
import { PrecisionSlider } from './PrecisionSlider';
import {
  X,
  RotateCw,
  Box,
  Camera,
  Sun,
  Wind,
  Activity,
  Check,
  Plane,
} from 'lucide-react';

interface ModelViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeModelType?: AircraftModelType;
  onSelectModel?: (modelType: AircraftModelType) => void;
  onApplyToWindTunnel?: (modelType: AircraftModelType) => void;
}

export const ModelViewerModal: React.FC<ModelViewerModalProps> = ({
  isOpen,
  onClose,
  activeModelType = 'f22',
  onSelectModel,
  onApplyToWindTunnel,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);
  const forceVectorsRef = useRef<THREE.Group | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lightsGroupRef = useRef<THREE.Group | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackCamRef = useRef({ theta: 0.78, phi: 0.35, distance: 16 });
  const fallbackDragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

  // Active inspected model
  const [selectedModel, setSelectedModel] = useState<AircraftModelType>(activeModelType);

  // Loading state
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  // Inspector controls
  const [isAutoSpin, setIsAutoSpin] = useState<boolean>(true);
  const isAutoSpinRef = useRef<boolean>(true);
  isAutoSpinRef.current = isAutoSpin;
  const [shadingMode, setShadingMode] = useState<'pbr' | 'cfdHeatmap' | 'wireframe' | 'xray'>('pbr');
  const [lightingPreset, setLightingPreset] = useState<'tunnel' | 'studio' | 'sunset' | 'cyber'>('tunnel');
  const [showForceVectors, setShowForceVectors] = useState<boolean>(true);
  const [inspectorAoA, setInspectorAoA] = useState<number>(4.0);
  const [isStalled, setIsStalled] = useState<boolean>(false);

  // Mesh stats
  const [meshCount, setMeshCount] = useState<number>(0);
  const [vertexCount, setVertexCount] = useState<number>(0);

  // Sync with prop when opened
  useEffect(() => {
    if (isOpen && activeModelType) {
      setSelectedModel(activeModelType);
    }
  }, [activeModelType, isOpen]);

  // Main Scene Setup
  useEffect(() => {
    if (!isOpen) return;

    const mount = mountRef.current;
    if (!mount) return;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0d1114);

    // 2. Camera
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 500);
    camera.position.set(16, 8, 16);
    cameraRef.current = camera;

    // 3. Renderer (safely probed to prevent uncaught WebGL context errors)
    const renderer = createSafeWebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    if (!renderer) {
      setWebglUnavailable(true);
      setIsLoading(false);
      return;
    }

    setWebglUnavailable(false);
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
      setIsLoading(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 60;
    controls.minDistance = 4;
    controlsRef.current = controls;

    // 5. Lighting
    const lightsGroup = new THREE.Group();
    scene.add(lightsGroup);
    lightsGroupRef.current = lightsGroup;

    const updateLights = (preset: 'tunnel' | 'studio' | 'sunset' | 'cyber') => {
      lightsGroup.clear();
      if (preset === 'tunnel') {
        lightsGroup.add(new THREE.AmbientLight(0x38bdf8, 0.65));
        const key = new THREE.DirectionalLight(0xe0f2fe, 2.4);
        key.position.set(-15, 20, 15);
        lightsGroup.add(key);
        const rim = new THREE.DirectionalLight(0x0284c7, 1.8);
        rim.position.set(15, -10, -15);
        lightsGroup.add(rim);
      } else if (preset === 'studio') {
        lightsGroup.add(new THREE.AmbientLight(0xffffff, 1.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.8);
        key.position.set(10, 20, 10);
        lightsGroup.add(key);
        const fill = new THREE.DirectionalLight(0xf1f5f9, 1.5);
        fill.position.set(-10, 10, -10);
        lightsGroup.add(fill);
      } else if (preset === 'sunset') {
        lightsGroup.add(new THREE.AmbientLight(0xf59e0b, 0.8));
        const key = new THREE.DirectionalLight(0xf97316, 3.2);
        key.position.set(-20, 10, 5);
        lightsGroup.add(key);
        const rim = new THREE.DirectionalLight(0x7c3aed, 1.8);
        rim.position.set(20, -5, -10);
        lightsGroup.add(rim);
      } else {
        lightsGroup.add(new THREE.AmbientLight(0x06b6d4, 0.7));
        const key = new THREE.DirectionalLight(0x00f0ff, 2.6);
        key.position.set(-15, 15, 10);
        lightsGroup.add(key);
        const rim = new THREE.DirectionalLight(0xf43f5e, 2.6);
        rim.position.set(15, -10, -15);
        lightsGroup.add(rim);
      }
    };
    updateLights(lightingPreset);

    // 6. Ground grid & pedestal
    const gridHelper = new THREE.GridHelper(26, 26, 0x00f0ff, 0x1e3a5f);
    gridHelper.position.y = -3.8;
    scene.add(gridHelper);

    // 7. Force Vectors Group
    const forceGroup = createAeroForceVectorsGroup();
    scene.add(forceGroup);
    forceVectorsRef.current = forceGroup;

    // 8. Animation Loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      if (isAutoSpinRef.current && modelRootRef.current) {
        modelRootRef.current.rotation.y += 0.005;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // 9. Resize handler
    const handleResize = () => {
      if (!mount || !renderer || !camera) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost, false);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      mount.innerHTML = '';
    };
  }, [isOpen]);

  // Software 3D Canvas Fallback Renderer when WebGL2 is unavailable
  useEffect(() => {
    if (!isOpen || !webglUnavailable) return;
    const canvas = fallbackCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const proc = getAircraft3DModel(selectedModel, 0, inspectorAoA, 350, 1.2e6);
    setMeshCount(proc.faces.length);
    setVertexCount(proc.vertices.length);
    setIsLoading(false);

    let rafId = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const focal = Math.min(w, h) * 1.25;
      const cam = fallbackCamRef.current;

      if (isAutoSpinRef.current && !fallbackDragRef.current.dragging) {
        cam.theta += 0.008;
      }

      const camX = cam.distance * Math.cos(cam.phi) * Math.sin(cam.theta);
      const camY = cam.distance * Math.sin(cam.phi);
      const camZ = cam.distance * Math.cos(cam.phi) * Math.cos(cam.theta);

      const fx = -camX;
      const fy = -camY;
      const fz = -camZ;
      const fLen = Math.hypot(fx, fy, fz) || 1;
      const fNorm = { x: fx / fLen, y: fy / fLen, z: fz / fLen };

      const rx = -fNorm.z;
      const rz = fNorm.x;
      const rLen = Math.hypot(rx, rz) || 1;
      const rNorm = { x: rx / rLen, y: 0, z: rz / rLen };

      const ux = rNorm.y * fNorm.z - rNorm.z * fNorm.y;
      const uy = rNorm.z * fNorm.x - rNorm.x * fNorm.z;
      const uz = rNorm.x * fNorm.y - rNorm.y * fNorm.x;
      const uLen = Math.hypot(ux, uy, uz) || 1;
      const uNorm = { x: ux / uLen, y: uy / uLen, z: uz / uLen };

      const project = (v: Vertex3D) => {
        const vx = (v.x - camX) * rNorm.x + (v.y - camY) * rNorm.y + (v.z - camZ) * rNorm.z;
        const vy = (v.x - camX) * uNorm.x + (v.y - camY) * uNorm.y + (v.z - camZ) * uNorm.z;
        const vz = (v.x - camX) * fNorm.x + (v.y - camY) * fNorm.y + (v.z - camZ) * fNorm.z;
        if (vz <= 0.2) return null;
        return { x: cx + (vx * focal) / vz, y: cy - (vy * focal) / vz, depth: vz };
      };

      ctx.fillStyle = '#0D1114';
      ctx.fillRect(0, 0, w, h);

      // Pedestal grid
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.16)';
      ctx.lineWidth = 1;
      for (let g = -12; g <= 12; g += 3) {
        const a1 = project({ x: g, y: -3.5, z: -12 });
        const a2 = project({ x: g, y: -3.5, z: 12 });
        if (a1 && a2) {
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.stroke();
        }
        const b1 = project({ x: -12, y: -3.5, z: g });
        const b2 = project({ x: 12, y: -3.5, z: g });
        if (b1 && b2) {
          ctx.beginPath();
          ctx.moveTo(b1.x, b1.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.stroke();
        }
      }

      const pitchRad = (inspectorAoA * Math.PI) / 180;
      const cosP = Math.cos(pitchRad);
      const sinP = Math.sin(pitchRad);

      const verts = proc.vertices.map((v) => ({
        x: v.x * cosP + v.y * sinP,
        y: -v.x * sinP + v.y * cosP,
        z: v.z,
      }));
      const projected = verts.map(project);

      const faces = proc.faces
        .map((face) => {
          const norm = computeFaceNormal(verts, face.indices);
          let avgZ = 0;
          let valid = true;
          for (const idx of face.indices) {
            const p = projected[idx];
            if (!p) {
              valid = false;
              break;
            }
            avgZ += p.depth;
          }
          return { face, norm, avgZ: avgZ / face.indices.length, valid };
        })
        .filter((f) => f.valid)
        .sort((a, b) => b.avgZ - a.avgZ);

      for (const { face, norm } of faces) {
        const pts = face.indices.map((idx) => projected[idx]!);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();

        if (shadingMode === 'wireframe') {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (shadingMode === 'xray') {
          ctx.fillStyle = 'rgba(0, 240, 255, 0.16)';
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
          ctx.lineWidth = 0.8;
          ctx.fill();
          ctx.stroke();
        } else {
          let color = face.baseColor || '#38bdf8';
          if (shadingMode === 'cfdHeatmap') {
            if (isStalled) color = '#ef4444';
            else if (norm.x < -0.25) color = '#f97316';
            else if (norm.y > 0.1) color = '#00f0ff';
            else color = '#10b981';
          }
          const light = Math.max(0.35, 0.45 + 0.55 * Math.max(0, norm.y * 0.85 - norm.x * 0.3));
          ctx.fillStyle = color;
          ctx.fill();
          ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - light) * 0.45})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      if (showForceVectors) {
        const origin = project({ x: 0, y: 0, z: 0 });
        const liftEnd = project({ x: 0, y: Math.max(-1.5, Math.min(4.5, Math.sin(pitchRad + 0.1) * 4.5)), z: 0 });
        const dragEnd = project({ x: 2.2 + Math.abs(Math.sin(pitchRad)) * 2.5, y: 0, z: 0 });
        if (origin && liftEnd) {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(origin.x, origin.y);
          ctx.lineTo(liftEnd.x, liftEnd.y);
          ctx.stroke();
        }
        if (origin && dragEnd) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(origin.x, origin.y);
          ctx.lineTo(dragEnd.x, dragEnd.y);
          ctx.stroke();
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [isOpen, webglUnavailable, selectedModel, inspectorAoA, isStalled, shadingMode, showForceVectors]);

  // Load Selected GLB Model
  useEffect(() => {
    if (!isOpen || webglUnavailable || !sceneRef.current) return;
    const scene = sceneRef.current;
    let cancelled = false;

    // Clear old model
    if (modelRootRef.current) {
      scene.remove(modelRootRef.current);
      modelRootRef.current = null;
    }

    setIsLoading(true);
    setLoadingProgress(0);
    setLoadError(null);

    loadGlbAircraftModel(selectedModel, (pct) => {
      if (!cancelled) setLoadingProgress(pct);
    })
      .then(({ root }) => {
        if (cancelled) return;
        modelRootRef.current = root;
        scene.add(root);

        // Count meshes and vertices from CAD root
        let mCount = 0;
        let vCount = 0;
        root.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            mCount++;
            const g = (c as THREE.Mesh).geometry;
            if (g && g.attributes.position) {
              vCount += g.attributes.position.count;
            }
          }
        });
        setMeshCount(mCount);
        setVertexCount(vCount);

        // Apply active shading
        if (shadingMode === 'cfdHeatmap') {
          applyCfdPressureHeatmap(root, inspectorAoA, isStalled);
        } else if (shadingMode === 'wireframe') {
          applyWireframeShading(root, true);
        }

        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error loading GLB in inspector:', err);
        setLoadError(`Failed to load 3D CAD asset for ${selectedModel}.`);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedModel, webglUnavailable]);

  // Update AoA Pitch & Heatmap in Inspector
  useEffect(() => {
    if (!modelRootRef.current) return;
    const root = modelRootRef.current;

    // Pitch model with AoA slider
    const pitchRad = (inspectorAoA * Math.PI) / 180;
    root.rotation.z = -pitchRad;

    // Update heatmap if active
    if (shadingMode === 'cfdHeatmap') {
      applyCfdPressureHeatmap(root, inspectorAoA, isStalled);
    }

    // Update force vectors
    if (forceVectorsRef.current) {
      const liftSim_N = Math.sin(pitchRad + 0.08) * 1.8e6;
      const dragSim_N = (0.02 + Math.pow(Math.sin(pitchRad), 2) * 0.8) * 4e5;
      updateAeroForceVectors(forceVectorsRef.current, liftSim_N, dragSim_N, inspectorAoA, showForceVectors);
    }
  }, [inspectorAoA, isStalled, shadingMode, showForceVectors]);

  // Update Shading Mode
  useEffect(() => {
    if (!modelRootRef.current) return;
    const root = modelRootRef.current;

    if (shadingMode === 'cfdHeatmap') {
      applyCfdPressureHeatmap(root, inspectorAoA, isStalled);
    } else if (shadingMode === 'wireframe') {
      restoreOriginalGlbMaterials(root);
      applyWireframeShading(root, true);
    } else if (shadingMode === 'xray') {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = new THREE.MeshPhysicalMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.35,
            roughness: 0.1,
            metalness: 0.8,
          });
        }
      });
    } else {
      restoreOriginalGlbMaterials(root);
      applyWireframeShading(root, false);
    }
  }, [shadingMode, inspectorAoA, isStalled]);

  // Lighting Update
  useEffect(() => {
    if (!lightsGroupRef.current) return;
    const lightsGroup = lightsGroupRef.current;
    lightsGroup.clear();

    if (lightingPreset === 'tunnel') {
      lightsGroup.add(new THREE.AmbientLight(0x38bdf8, 0.65));
      const key = new THREE.DirectionalLight(0xe0f2fe, 2.4);
      key.position.set(-15, 20, 15);
      lightsGroup.add(key);
      const rim = new THREE.DirectionalLight(0x0284c7, 1.8);
      rim.position.set(15, -10, -15);
      lightsGroup.add(rim);
    } else if (lightingPreset === 'studio') {
      lightsGroup.add(new THREE.AmbientLight(0xffffff, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.8);
      key.position.set(10, 20, 10);
      lightsGroup.add(key);
      const fill = new THREE.DirectionalLight(0xf1f5f9, 1.5);
      fill.position.set(-10, 10, -10);
      lightsGroup.add(fill);
    } else if (lightingPreset === 'sunset') {
      lightsGroup.add(new THREE.AmbientLight(0xf59e0b, 0.8));
      const key = new THREE.DirectionalLight(0xf97316, 3.2);
      key.position.set(-20, 10, 5);
      lightsGroup.add(key);
      const rim = new THREE.DirectionalLight(0x7c3aed, 1.8);
      rim.position.set(20, -5, -10);
      lightsGroup.add(rim);
    } else {
      lightsGroup.add(new THREE.AmbientLight(0x06b6d4, 0.7));
      const key = new THREE.DirectionalLight(0x00f0ff, 2.6);
      key.position.set(-15, 15, 10);
      lightsGroup.add(key);
      const rim = new THREE.DirectionalLight(0xf43f5e, 2.6);
      rim.position.set(15, -10, -15);
      lightsGroup.add(rim);
    }
  }, [lightingPreset]);

  // Take PNG Snapshot
  const handleTakeSnapshot = () => {
    const canvasEl = webglUnavailable ? fallbackCanvasRef.current : rendererRef.current?.domElement;
    if (!canvasEl) return;
    const dataUrl = canvasEl.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${selectedModel}-3d-cad-inspector-${Date.now()}.png`;
    a.click();
  };

  // Reset Camera View
  const handleResetCamera = () => {
    if (webglUnavailable) {
      fallbackCamRef.current = { theta: 0.78, phi: 0.35, distance: 16 };
      return;
    }
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(16, 8, 16);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  if (!isOpen) return null;

  const currentMeta = GLB_MODEL_REGISTRY[selectedModel];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6 bg-[#0D1114]/65 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl h-[100dvh] sm:h-[92vh] bg-[var(--surface)] border-0 sm:border border-[var(--border)] rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[var(--text)]">
        
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 sm:px-6 sm:py-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
              <Box className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-lg font-bold font-sans tracking-tight text-[#161A1D] truncate">
                  3D CAD Inspector
                </h2>
                <span className="text-[10px] sm:text-[11px] font-mono text-[#1769AA] font-semibold whitespace-nowrap">
                  GLTF 2.0{currentMeta ? ` · ${currentMeta.fileSizeLabel}` : ''}
                </span>
              </div>
              <p className="hidden sm:block text-xs text-[#5C6670] truncate">
                {currentMeta ? currentMeta.sourceCredit : 'High-fidelity aerodynamic CAD meshes'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleTakeSnapshot}
              className="p-2 sm:px-3 sm:py-1.5 rounded-lg bg-[var(--bg)] hover:bg-[var(--accent-light)] text-[#161A1D] hover:text-[#1769AA] border border-[var(--border)] hover:border-[#1769AA] transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title="Save PNG Snapshot"
            >
              <Camera className="w-4 h-4 text-[#1769AA]" />
              <span className="hidden sm:inline">Snapshot</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[#5C6670] hover:text-[#161A1D] hover:bg-[var(--bg)] transition-colors border border-[var(--border)]"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Model Tabs Bar */}
        <div className="px-3.5 sm:px-6 py-2 sm:py-2.5 bg-[var(--bg)] border-b border-[var(--border)] flex items-center gap-1.5 sm:gap-2 overflow-x-auto custom-scrollbar shrink-0">
          <span className="hidden sm:flex text-xs font-mono font-bold text-[#5C6670] mr-2 items-center gap-1 shrink-0">
            <Plane className="w-3.5 h-3.5 text-[#1769AA]" />
            MODEL:
          </span>
          {[
            { id: 'f22', label: 'F-22 Raptor', tag: 'Stealth Fighter' },
            { id: 'airliner', label: 'Boeing 787', tag: 'Airliner CAD' },
            { id: 'concorde', label: 'Concorde SST', tag: 'Supersonic' },
            { id: 'naca2412', label: 'Airfoil Section', tag: '3D Wing' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelectedModel(m.id as AircraftModelType);
                if (onSelectModel) onSelectModel(m.id as AircraftModelType);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border shrink-0 ${
                selectedModel === m.id
                  ? 'bg-[#1769AA] text-white border-[#1769AA]'
                  : 'bg-[var(--surface)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
              }`}
            >
              <span>{m.label}</span>
              <span className={`text-[10px] font-mono ${selectedModel === m.id ? 'text-white/80' : 'text-[#5C6670]'}`}>
                · {m.tag}
              </span>
            </button>
          ))}
        </div>

        {/* Main Body */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          
          {/* Left Viewport (3D Canvas — --dark: #0D1114) */}
          <div className="relative flex-1 h-full min-h-[210px] sm:min-h-[320px] bg-[#0D1114]">
            {webglUnavailable ? (
              <>
                <canvas
                  ref={fallbackCanvasRef}
                  onPointerDown={(e) => {
                    fallbackDragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!fallbackDragRef.current.dragging) return;
                    const dx = e.clientX - fallbackDragRef.current.lastX;
                    const dy = e.clientY - fallbackDragRef.current.lastY;
                    fallbackDragRef.current.lastX = e.clientX;
                    fallbackDragRef.current.lastY = e.clientY;
                    fallbackCamRef.current.theta -= dx * 0.008;
                    fallbackCamRef.current.phi = Math.max(-1.4, Math.min(1.4, fallbackCamRef.current.phi + dy * 0.008));
                  }}
                  onPointerUp={(e) => {
                    fallbackDragRef.current.dragging = false;
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch {}
                  }}
                  onWheel={(e) => {
                    fallbackCamRef.current.distance = Math.max(7, Math.min(30, fallbackCamRef.current.distance + e.deltaY * 0.015));
                  }}
                  className="w-full h-full block touch-none cursor-grab active:cursor-grabbing"
                />
                <div className="absolute top-2.5 left-2.5 sm:top-4 sm:left-4 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-[#151A1E]/95 border border-amber-500/50 text-amber-200 text-[10px] sm:text-[11px] font-mono pointer-events-none">
                  Canvas 3D <span className="hidden sm:inline">Fallback (WebGL2 unavailable)</span>
                </div>
              </>
            ) : (
              <div ref={mountRef} className="w-full h-full touch-none cursor-grab active:cursor-grabbing" />
            )}

            {/* Loading Indicator */}
            {isLoading && !webglUnavailable && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D1114]/90 gap-4 z-10">
                <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-[#38bdf8] animate-spin" />
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-sm font-semibold text-slate-100 font-mono">
                    Loading {currentMeta ? currentMeta.name : '3D CAD Model'} · {loadingProgress}%
                  </span>
                  <div className="w-48 h-1.5 rounded-full bg-[#151A1E] overflow-hidden border border-slate-700">
                    <div 
                      className="h-full bg-[#1769AA] transition-all duration-200"
                      style={{ width: `${Math.max(5, loadingProgress)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {currentMeta ? currentMeta.fileSizeLabel : 'Parsing geometry & textures'}
                  </span>
                </div>
              </div>
            )}

            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D1114]/95 gap-3 z-10 text-center p-6">
                <span className="text-red-400 font-semibold">{loadError}</span>
              </div>
            )}

            {/* Floating 3D Toolbar Overlay (#151A1E, no backdrop-blur over WebGL) */}
            <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:bottom-4 sm:left-4 sm:right-4 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
              <div className="flex items-center gap-1 sm:gap-1.5 bg-[#151A1E]/95 p-1 rounded-lg border border-slate-700/80 pointer-events-auto">
                <button
                  onClick={() => setIsAutoSpin(!isAutoSpin)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isAutoSpin
                      ? 'bg-[#1769AA] text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isAutoSpin ? 'animate-spin' : ''}`} />
                  <span>Turntable</span>
                </button>
                <button
                  onClick={handleResetCamera}
                  className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-[11px] sm:text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Reset View
                </button>
              </div>

              <div className="hidden md:block text-[11px] font-mono text-slate-300 bg-[#151A1E]/95 px-3 py-1.5 rounded-lg border border-slate-700/80 pointer-events-auto">
                Drag: Orbit · Scroll: Zoom · Right-drag: Pan
              </div>
            </div>
          </div>

          {/* Right Inspector & Aerodynamic Overlays Panel */}
          <div className="w-full lg:w-88 border-t lg:border-t-0 lg:border-l border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-4 overflow-y-auto overscroll-contain max-h-[42vh] sm:max-h-[48vh] lg:max-h-full custom-scrollbar">
            
            {/* 1. Aerodynamic Analysis Overlays */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-[#161A1D] uppercase tracking-wider font-sans">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#1769AA]" />
                  Surface Analysis
                </span>
                <span className="text-[10px] text-[#5C6670] font-mono">CFD Mesh</span>
              </div>

              {/* Shading mode selector */}
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'pbr', label: 'PBR Shading', desc: 'Photorealistic textures' },
                  { id: 'cfdHeatmap', label: 'CFD Pressure', desc: 'Cp surface heatmap' },
                  { id: 'wireframe', label: 'Wireframe', desc: 'Mesh topology' },
                  { id: 'xray', label: 'X-Ray', desc: 'Translucent hull' },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setShadingMode(s.id as any)}
                    className={`p-2 rounded-lg text-left flex flex-col transition-colors border ${
                      shadingMode === s.id
                        ? 'bg-[var(--accent-light)] border-[#1769AA] text-[#1769AA]'
                        : 'bg-[var(--bg)] border-[var(--border)] text-[#5C6670] hover:text-[#161A1D]'
                    }`}
                  >
                    <span className="text-xs font-bold">{s.label}</span>
                    <span className="text-[10px] text-[#5C6670]">{s.desc}</span>
                  </button>
                ))}
              </div>

              {/* Angle of Attack Pitch Slider */}
              <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] flex flex-col gap-2.5">
                <PrecisionSlider
                  id="inspector-aoa-slider"
                  label="Test Angle of Attack"
                  subLabel="(α)"
                  min={-10}
                  max={28}
                  step={0.5}
                  value={inspectorAoA}
                  displayValue={`${inspectorAoA >= 0 ? '+' : ''}${inspectorAoA.toFixed(1)}°`}
                  badgeTone={isStalled ? 'danger' : 'accent'}
                  onChange={setInspectorAoA}
                />
                <div className="flex justify-between items-center text-[10px] text-[#5C6670] font-mono pt-1 border-t border-[var(--border)]">
                  <span>-10°</span>
                  <button
                    onClick={() => setIsStalled(!isStalled)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold font-mono transition-colors border cursor-pointer ${
                      isStalled
                        ? 'bg-red-50 text-red-700 border-red-300'
                        : 'bg-[var(--surface)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
                    }`}
                  >
                    {isStalled ? 'STALL ACTIVE' : 'Attached Flow'}
                  </button>
                  <span>+28°</span>
                </div>
              </div>
            </div>

            {/* 2. Force Vectors Toggle */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-[#161A1D] uppercase tracking-wider font-sans flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-[#1769AA]" />
                3D Force Vectors
              </span>
              <button
                onClick={() => setShowForceVectors(!showForceVectors)}
                className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-colors border flex items-center justify-center gap-1.5 cursor-pointer ${
                  showForceVectors
                    ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]'
                    : 'bg-[var(--bg)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{showForceVectors ? 'Lift & Drag Vectors On' : 'Lift & Drag Vectors Off'}</span>
              </button>
            </div>

            {/* 3. Studio Lighting Atmosphere */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-[#161A1D] uppercase tracking-wider font-sans flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-[#1769AA]" />
                Lighting Environment
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'tunnel', label: 'Wind Tunnel' },
                  { id: 'studio', label: 'Studio White' },
                  { id: 'sunset', label: 'Warm Key' },
                  { id: 'cyber', label: 'High Contrast' },
                ].map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLightingPreset(l.id as any)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium text-center transition-colors border ${
                      lightingPreset === l.id
                        ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA] font-semibold'
                        : 'bg-[var(--bg)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Asset Technical Specifications */}
            <div className="mt-auto pt-3 border-t border-[var(--border)] flex flex-col gap-2 text-[11px] text-[#5C6670]">
              <div className="flex justify-between">
                <span>Model Format:</span>
                <span className="font-mono text-[#161A1D] font-medium">GLTF 2.0 (.glb)</span>
              </div>
              <div className="flex justify-between">
                <span>Total Meshes:</span>
                <span className="font-mono tabular-nums text-[#161A1D] font-medium">{meshCount > 0 ? `${meshCount} Groups` : currentMeta?.meshCountLabel}</span>
              </div>
              <div className="flex justify-between">
                <span>Vertices:</span>
                <span className="font-mono tabular-nums text-[#161A1D] font-medium">{vertexCount > 0 ? vertexCount.toLocaleString() : '52,400+'}</span>
              </div>
              <div className="flex justify-between">
                <span>Wingspan:</span>
                <span className="font-mono tabular-nums text-[#161A1D] font-medium">{AIRCRAFT_MODELS[selectedModel]?.wingspan} m</span>
              </div>

              {onApplyToWindTunnel && (
                <button
                  onClick={() => {
                    onApplyToWindTunnel(selectedModel);
                    onClose();
                  }}
                  className="w-full mt-2 py-2.5 rounded-lg bg-[#1769AA] hover:bg-[#145a92] text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply to Wind Tunnel</span>
                </button>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};
