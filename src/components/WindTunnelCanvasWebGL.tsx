import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SimulationParams, AeroTelemetry } from '../types/aerodynamics';
import { AIRCRAFT_MODELS } from '../utils/airfoilGenerators';
import { getAircraft3DModel, Vertex3D } from '../utils/aircraft3DGeometry';
import {
  loadGlbAircraftModel,
  GLB_MODEL_REGISTRY,
  applyCfdPressureHeatmap,
  restoreOriginalGlbMaterials,
  applyWireframeShading,
  createAeroForceVectorsGroup,
  updateAeroForceVectors,
} from '../utils/aircraftGlbModels';
import { FluidDynamics3D, Fluid3DParams } from '../engine/FluidDynamics3D';
import { AircraftSurfaceField } from '../engine/AircraftSurfaceField';
import { windTunnelAudio } from '../utils/audio';
import { createSafeWebGLRenderer } from '../utils/webglSupport';
import {
  AlertTriangle,
  Volume2,
  VolumeX,
  Box,
  Camera,
  RotateCw,
} from 'lucide-react';

interface WindTunnelCanvasWebGLProps {
  params: SimulationParams;
  onParamChange: <K extends keyof SimulationParams>(key: K, value: SimulationParams[K]) => void;
  telemetry: AeroTelemetry;
  isPaused: boolean;
  onFallbackToCanvas?: () => void;
  onOpenModelInspector?: () => void;
}

interface TracedCurveData {
  points: (Vertex3D & { speed: number; pressureCoeff: number; vorticity: number; isSeparated: boolean })[];
}

export const WindTunnelCanvasWebGL: React.FC<WindTunnelCanvasWebGLProps> = ({
  params,
  onParamChange,
  telemetry,
  isPaused,
  onFallbackToCanvas,
  onOpenModelInspector,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Live state refs so the 60fps WebGL loop accesses current model and aerodynamic telemetry
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const surfaceFieldRef = useRef<AircraftSurfaceField | null>(null);

  // Model & Simulation Roots
  const aircraftGroupRef = useRef<THREE.Group | null>(null);
  const glbRootRef = useRef<THREE.Group | null>(null);
  const proceduralMeshRef = useRef<THREE.Mesh | null>(null);
  const streamlinesGroupRef = useRef<THREE.Group | null>(null);
  const quiverGroupRef = useRef<THREE.Group | null>(null);
  const tracedCurvesRef = useRef<TracedCurveData[]>([]);
  const smokePulsesRef = useRef<THREE.Points | null>(null);

  // PIV Particle Streak Buffers
  const particleStreaksRef = useRef<THREE.LineSegments | null>(null);
  const particlePositionsRef = useRef<Float32Array | null>(null);

  const machConeMeshRef = useRef<THREE.Mesh | null>(null);
  const forceVectorsGroupRef = useRef<THREE.Group | null>(null);
  const afterburnerGroupRef = useRef<THREE.Group | null>(null);

  // UI state
  const [activePreset, setActivePreset] = useState<'iso' | 'side' | 'top' | 'front' | 'chase'>('iso');
  const [isAutoOrbit, setIsAutoOrbit] = useState<boolean>(false);
  const isAutoOrbitRef = useRef<boolean>(false);
  isAutoOrbitRef.current = isAutoOrbit;
  const onFallbackRef = useRef(onFallbackToCanvas);
  onFallbackRef.current = onFallbackToCanvas;
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);
  const [modelLoading, setModelLoading] = useState<boolean>(true);
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeShading, setActiveShading] = useState<'pbr' | 'wireframe' | 'cfdHeatmap' | 'xray'>('pbr');
  const [surfaceVersion, setSurfaceVersion] = useState<number>(0);

  // Sync Audio with simulation speed & stall
  useEffect(() => {
    if (params.audio_enabled) {
      windTunnelAudio.start();
      windTunnelAudio.update(params.airspeed_kts, telemetry.mach, telemetry.isStalled);
    } else {
      windTunnelAudio.stop();
    }
  }, [params.audio_enabled, params.airspeed_kts, telemetry.mach, telemetry.isStalled]);

  // Main Three.js Scene Initialization
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 900;
    const height = mount.clientHeight || 560;

    // 1. Scene (--dark: #0D1114)
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0d1114);
    scene.fog = new THREE.FogExp2(0x0d1114, 0.011);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 400);
    camera.position.set(-15, 7.5, 15);
    cameraRef.current = camera;

    // 3. Renderer (safely probed)
    const renderer = createSafeWebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!renderer) {
      setWebglUnavailable(true);
      setModelLoading(false);
      onFallbackRef.current?.();
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Studio IBL environment for crisp metallic PBR reflections
    let envTex: THREE.Texture | null = null;
    try {
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      pmremGenerator.dispose();
    } catch {
      // Fallback gracefully if PMREM fails on constrained drivers
    }

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
      onFallbackRef.current?.();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 50;
    controls.minDistance = 3.5;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // 5. Studio 3-Point + Hemisphere Lighting Rig
    const hemi = new THREE.HemisphereLight(0xe8f3fa, 0x151a1e, 0.85);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-16, 22, 16);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rim.position.set(18, -8, -14);
    scene.add(rim);

    // 6. Chamber Floor Grid (--dark-surface & --accent)
    const gridFloor = new THREE.GridHelper(36, 36, 0x1769aa, 0x1e2730);
    gridFloor.position.y = -4.5;
    scene.add(gridFloor);

    // Lateral rails
    const railMat = new THREE.LineBasicMaterial({ color: 0x1769aa, transparent: true, opacity: 0.4 });
    for (const rz of [-8, 8]) {
      const railGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-18, -4.5, rz),
        new THREE.Vector3(18, -4.5, rz),
      ]);
      scene.add(new THREE.Line(railGeo, railMat));
    }

    // 7. Aircraft Root Group
    const aircraftGroup = new THREE.Group();
    aircraftGroup.name = 'AircraftGroup';
    scene.add(aircraftGroup);
    aircraftGroupRef.current = aircraftGroup;

    // Afterburner exhaust group
    const abGroup = new THREE.Group();
    aircraftGroup.add(abGroup);
    afterburnerGroupRef.current = abGroup;

    for (const zOff of [-0.67, 0.67]) {
      const coneGeo = new THREE.ConeGeometry(0.32, 2.4, 16);
      coneGeo.rotateZ(-Math.PI / 2);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85 });
      const flameMesh = new THREE.Mesh(coneGeo, flameMat);
      flameMesh.position.set(6.8 + 1.2, -0.38, zOff);
      abGroup.add(flameMesh);

      const flameLight = new THREE.PointLight(0xf97316, 2.0, 8);
      flameLight.position.set(6.8, -0.38, zOff);
      abGroup.add(flameLight);
    }
    abGroup.visible = false;

    // 8. PIV Velocity-Aligned Particle Streak System (LineSegments: 2 vertices per particle)
    const particleCount = 900;
    const pPositions = new Float32Array(particleCount * 3);
    const streakPositions = new Float32Array(particleCount * 6);
    const streakColors = new Float32Array(particleCount * 6);

    const spawnParticle = (idx: number, isInitial = false) => {
      const roll = Math.random();
      let y = 0;
      let z = 0;
      const activeSpan = surfaceFieldRef.current ? surfaceFieldRef.current.halfSpan : 6.8;

      if (roll < 0.45) {
        y = -0.85 + Math.random() * 2.1;
        z = -activeSpan * 0.95 + Math.random() * (activeSpan * 1.9);
      } else if (roll < 0.78) {
        // Wingtip vortex roll-up seeding
        const tipSign = Math.random() > 0.5 ? 1 : -1;
        z = tipSign * (activeSpan * 0.94 + (Math.random() - 0.5) * 1.1);
        y = -0.35 + Math.random() * 1.0;
      } else if (roll < 0.92) {
        y = -0.6 + Math.random() * 1.9;
        z = -1.2 + Math.random() * 2.4;
      } else {
        y = -3.4 + Math.random() * 6.8;
        z = -8.5 + Math.random() * 17.0;
      }

      const x = isInitial ? -21 + Math.random() * 42 : -21;
      pPositions[idx * 3] = x;
      pPositions[idx * 3 + 1] = y;
      pPositions[idx * 3 + 2] = z;

      streakPositions[idx * 6] = x - 0.35;
      streakPositions[idx * 6 + 1] = y;
      streakPositions[idx * 6 + 2] = z;
      streakPositions[idx * 6 + 3] = x;
      streakPositions[idx * 6 + 4] = y;
      streakPositions[idx * 6 + 5] = z;

      // Initial freestream tint
      streakColors[idx * 6] = 0.09;
      streakColors[idx * 6 + 1] = 0.41;
      streakColors[idx * 6 + 2] = 0.67;
      streakColors[idx * 6 + 3] = 0.35;
      streakColors[idx * 6 + 4] = 0.78;
      streakColors[idx * 6 + 5] = 0.98;
    };

    for (let i = 0; i < particleCount; i++) {
      spawnParticle(i, true);
    }

    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(streakColors, 3));

    const streakMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    const particleStreaks = new THREE.LineSegments(streakGeo, streakMat);
    particleStreaks.frustumCulled = false;
    scene.add(particleStreaks);
    particleStreaksRef.current = particleStreaks;
    particlePositionsRef.current = pPositions;

    // 9. Streamlines & Travelling Smoke Pulse Beads
    const streamlinesGroup = new THREE.Group();
    scene.add(streamlinesGroup);
    streamlinesGroupRef.current = streamlinesGroup;

    const pulseMaxCount = 240;
    const pulsePos = new Float32Array(pulseMaxCount * 3);
    const pulseCol = new Float32Array(pulseMaxCount * 3);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseCol, 3));
    const pulseMat = new THREE.PointsMaterial({
      size: 0.24,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const smokePulses = new THREE.Points(pulseGeo, pulseMat);
    smokePulses.frustumCulled = false;
    scene.add(smokePulses);
    smokePulsesRef.current = smokePulses;

    // 10. Vector Quiver Group
    const quiverGroup = new THREE.Group();
    scene.add(quiverGroup);
    quiverGroupRef.current = quiverGroup;

    // 11. Supersonic Mach Shockwave Cone
    const coneGeo = new THREE.ConeGeometry(6.0, 16.0, 32, 1, true);
    coneGeo.rotateZ(Math.PI / 2);
    coneGeo.translate(8.0 - 6.7, 0, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      side: THREE.DoubleSide,
    });
    const machConeMesh = new THREE.Mesh(coneGeo, coneMat);
    machConeMesh.visible = false;
    scene.add(machConeMesh);
    machConeMeshRef.current = machConeMesh;

    // 12. Aerodynamic 3D Force Vectors
    const forceGroup = createAeroForceVectorsGroup();
    scene.add(forceGroup);
    forceVectorsGroupRef.current = forceGroup;

    // 13. 60fps Simulation Loop (RK2 Particle Advection + Travelling Smoke Pulses)
    let lastTime = performance.now();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (isAutoOrbitRef.current && controlsRef.current) {
        controlsRef.current.autoRotate = true;
        controlsRef.current.autoRotateSpeed = 1.2;
      } else if (controlsRef.current) {
        controlsRef.current.autoRotate = false;
      }

      const currentParams = paramsRef.current;
      const currentTelemetry = telemetryRef.current;
      const currentPaused = isPausedRef.current;

      const fluid3DParams: Fluid3DParams = {
        modelType: currentParams.modelType,
        aoaDeg: currentParams.angle_of_attack,
        airspeed_kts: currentParams.airspeed_kts,
        mach: currentTelemetry.mach,
        altitude_ft: currentParams.altitude_ft,
        flapsDeg: currentParams.flaps_deg,
        viscosity: currentParams.viscosity,
        isStalled: currentTelemetry.isStalled,
        cl: currentTelemetry.cl,
        cd: currentTelemetry.cd,
        timeSec: now * 0.001,
        surfaceField: surfaceFieldRef.current,
      };

      // A. Update PIV Velocity-Aligned Streaks via RK2 Midpoint Integration
      if (particlePositionsRef.current && particleStreaksRef.current) {
        particleStreaksRef.current.visible = currentParams.show_particles;
        if (currentParams.show_particles) {
          const pos = particlePositionsRef.current;
          const posAttr = particleStreaksRef.current.geometry.attributes.position as THREE.BufferAttribute;
          const colAttr = particleStreaksRef.current.geometry.attributes.color as THREE.BufferAttribute;
          const streakArr = posAttr.array as Float32Array;
          const colArr = colAttr.array as Float32Array;
          const activeCount = Math.min(particleCount, Math.max(220, Math.round(particleCount * Math.min(1, currentParams.smoke_density * 0.85))));
          particleStreaksRef.current.geometry.setDrawRange(0, activeCount * 2);

          const mat = particleStreaksRef.current.material as THREE.LineBasicMaterial;
          mat.opacity = Math.min(0.95, 0.45 + currentParams.smoke_density * 0.32);

          const stepScale = dt * 15.0;

          for (let i = 0; i < activeCount; i++) {
            const px = pos[i * 3];
            const py = pos[i * 3 + 1];
            const pz = pos[i * 3 + 2];

            const v1 = FluidDynamics3D.getVelocity({ x: px, y: py, z: pz }, fluid3DParams);

            if (!currentPaused) {
              // RK2 midpoint evaluation
              const mx = px + v1.u * stepScale * 0.5;
              const my = py + v1.v * stepScale * 0.5;
              const mz = pz + v1.w * stepScale * 0.5;
              const v2 = FluidDynamics3D.getVelocity({ x: mx, y: my, z: mz }, fluid3DParams);

              const nx = px + v2.u * stepScale;
              const ny = py + v2.v * stepScale;
              const nz = pz + v2.w * stepScale;

              pos[i * 3] = nx;
              pos[i * 3 + 1] = ny;
              pos[i * 3 + 2] = nz;

              const speed = v2.speed || 1;
              const streakLen = Math.min(1.35, 0.28 + speed * 0.38);
              const invS = streakLen / speed;

              // Tail -> Head aligned with real velocity vector
              streakArr[i * 6] = nx - v2.u * invS;
              streakArr[i * 6 + 1] = ny - v2.v * invS;
              streakArr[i * 6 + 2] = nz - v2.w * invS;
              streakArr[i * 6 + 3] = nx;
              streakArr[i * 6 + 4] = ny;
              streakArr[i * 6 + 5] = nz;

              // Color by real flow physics: Separation / Suction / Vorticity / Compression
              let hr = 0.22, hg = 0.74, hb = 0.97;
              if (v2.isSeparated || (currentTelemetry.isStalled && nx > -1.0 && ny > -0.5)) {
                hr = 0.96; hg = 0.28; hb = 0.28; // Separated turbulent wake
              } else if (v2.vorticity > 0.35) {
                hr = 0.35; hg = 0.92; hb = 1.0; // Intense Biot-Savart vortex swirl
              } else if (v2.pressureCoeff < -0.55) {
                hr = 0.09; hg = 0.58; hb = 0.92; // Bernoulli suction peak
              } else if (v2.pressureCoeff > 0.25) {
                hr = 0.98; hg = 0.72; hb = 0.16; // Stagnation / compression
              } else {
                hr = 0.20; hg = 0.83; hb = 0.60; // Laminar freestream
              }

              // Dim tail, bright head
              colArr[i * 6] = hr * 0.28;
              colArr[i * 6 + 1] = hg * 0.28;
              colArr[i * 6 + 2] = hb * 0.28;
              colArr[i * 6 + 3] = hr;
              colArr[i * 6 + 4] = hg;
              colArr[i * 6 + 5] = hb;
            }

            if (pos[i * 3] > 22 || Math.abs(pos[i * 3 + 1]) > 8.5 || Math.abs(pos[i * 3 + 2]) > 14.5) {
              spawnParticle(i, false);
            }
          }

          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
        }
      }

      // B. Animate Travelling Smoke Pulses along Traced Vortex Streamlines
      if (smokePulsesRef.current) {
        const curves = tracedCurvesRef.current;
        const showSmoke = currentParams.show_streamlines && curves.length > 0;
        smokePulsesRef.current.visible = showSmoke;

        if (showSmoke) {
          const pPosAttr = smokePulsesRef.current.geometry.attributes.position as THREE.BufferAttribute;
          const pColAttr = smokePulsesRef.current.geometry.attributes.color as THREE.BufferAttribute;
          const pArr = pPosAttr.array as Float32Array;
          const cArr = pColAttr.array as Float32Array;

          const pulsesPerCurve = 3;
          const totalPulses = Math.min(pulseMaxCount, curves.length * pulsesPerCurve);
          smokePulsesRef.current.geometry.setDrawRange(0, totalPulses);

          const speedFactor = (currentParams.airspeed_kts / 350) * 0.35;
          let idx = 0;

          for (let c = 0; c < curves.length && idx < totalPulses; c++) {
            const pts = curves[c].points;
            if (pts.length < 2) continue;

            for (let k = 0; k < pulsesPerCurve && idx < totalPulses; k++) {
              const t = ((now * 0.001 * speedFactor + c * 0.17 + k / pulsesPerCurve) % 1 + 1) % 1;
              const fIdx = t * (pts.length - 1);
              const i0 = Math.floor(fIdx);
              const i1 = Math.min(pts.length - 1, i0 + 1);
              const alpha = fIdx - i0;

              const a = pts[i0];
              const b = pts[i1];
              pArr[idx * 3] = a.x + (b.x - a.x) * alpha;
              pArr[idx * 3 + 1] = a.y + (b.y - a.y) * alpha;
              pArr[idx * 3 + 2] = a.z + (b.z - a.z) * alpha;

              if (a.isSeparated) {
                cArr[idx * 3] = 0.96; cArr[idx * 3 + 1] = 0.28; cArr[idx * 3 + 2] = 0.28;
              } else if (a.vorticity > 0.35) {
                cArr[idx * 3] = 0.45; cArr[idx * 3 + 1] = 0.95; cArr[idx * 3 + 2] = 1.0;
              } else {
                cArr[idx * 3] = 0.9; cArr[idx * 3 + 1] = 0.96; cArr[idx * 3 + 2] = 1.0;
              }
              idx++;
            }
          }
          pPosAttr.needsUpdate = true;
          pColAttr.needsUpdate = true;
        }
      }

      if (machConeMeshRef.current && machConeMeshRef.current.visible) {
        const pulse = 1.0 + Math.sin(now * 0.008) * 0.035;
        machConeMeshRef.current.scale.set(pulse, pulse, pulse);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount || !renderer || !camera) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost, false);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (envTex) envTex.dispose();
      streakGeo.dispose();
      streakMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      coneGeo.dispose();
      coneMat.dispose();
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      mount.innerHTML = '';
    };
  }, []);

  // Dynamic 3D GLB Model Loading & Real Vertex Surface Field Extraction
  useEffect(() => {
    if (!aircraftGroupRef.current || webglUnavailable) return;
    const aircraftGroup = aircraftGroupRef.current;
    let cancelled = false;

    if (glbRootRef.current) {
      aircraftGroup.remove(glbRootRef.current);
      glbRootRef.current = null;
    }
    if (proceduralMeshRef.current) {
      aircraftGroup.remove(proceduralMeshRef.current);
      proceduralMeshRef.current = null;
    }
    surfaceFieldRef.current = null;

    setModelLoading(true);
    setLoadProgress(0);
    setLoadError(null);

    const isGlbAvailable = !!GLB_MODEL_REGISTRY[params.modelType];

    if (isGlbAvailable) {
      loadGlbAircraftModel(params.modelType, (pct) => {
        if (!cancelled) setLoadProgress(pct);
      })
        .then(({ root }) => {
          if (cancelled || !aircraftGroupRef.current) return;
          // Extract real 3D mesh vertices & triangle centroids in pure body frame (before AoA pitch)
          root.updateMatrixWorld(true);
          surfaceFieldRef.current = AircraftSurfaceField.fromThreeGroup(root);

          glbRootRef.current = root;
          aircraftGroupRef.current.add(root);
          setSurfaceVersion((v) => v + 1);
          setModelLoading(false);

          if (activeShading === 'cfdHeatmap' || params.show_heatmap) {
            applyCfdPressureHeatmap(root, params.angle_of_attack, telemetry.isStalled);
          } else if (activeShading === 'wireframe') {
            applyWireframeShading(root, true);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('Failed to load GLB model, falling back to procedural:', err);
          setLoadError('Falling back to procedural mesh');
          loadProceduralFallback();
        });
    } else {
      loadProceduralFallback();
    }

    function loadProceduralFallback() {
      const meshData = getAircraft3DModel(
        params.modelType,
        params.flaps_deg,
        params.angle_of_attack,
        params.airspeed_kts,
        telemetry.lift_N
      );
      const geom = new THREE.BufferGeometry();
      const positions: number[] = [];
      const colors: number[] = [];

      for (const face of meshData.faces) {
        const c = new THREE.Color(face.baseColor || '#1769AA');
        const idx = face.indices;
        for (let i = 1; i < idx.length - 1; i++) {
          const v0 = meshData.vertices[idx[0]];
          const v1 = meshData.vertices[idx[i]];
          const v2 = meshData.vertices[idx[i + 1]];
          positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
          colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }

      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.45,
        side: THREE.DoubleSide,
      });

      const procMesh = new THREE.Mesh(geom, mat);
      proceduralMeshRef.current = procMesh;
      aircraftGroup.add(procMesh);

      surfaceFieldRef.current = AircraftSurfaceField.fromProceduralMesh(meshData);
      setSurfaceVersion((v) => v + 1);
      setModelLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [params.modelType, webglUnavailable]);

  // Update Dynamic Aircraft Pitch (AoA)
  useEffect(() => {
    if (!aircraftGroupRef.current) return;
    const pitchRad = (params.angle_of_attack * Math.PI) / 180;
    aircraftGroupRef.current.rotation.z = -pitchRad;
  }, [params.angle_of_attack, telemetry.isStalled]);

  // Update Shading Mode (PBR, Wireframe, CFD Heatmap, X-Ray)
  useEffect(() => {
    if (!glbRootRef.current) return;
    const root = glbRootRef.current;

    if (activeShading === 'cfdHeatmap' || params.show_heatmap) {
      applyCfdPressureHeatmap(root, params.angle_of_attack, telemetry.isStalled);
    } else if (activeShading === 'wireframe') {
      restoreOriginalGlbMaterials(root);
      applyWireframeShading(root, true);
    } else if (activeShading === 'xray') {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.35,
            roughness: 0.15,
            metalness: 0.75,
          });
        }
      });
    } else {
      restoreOriginalGlbMaterials(root);
      applyWireframeShading(root, false);
    }
  }, [activeShading, params.show_heatmap, params.angle_of_attack, telemetry.isStalled]);

  // Update Mach Shockwave Cone
  useEffect(() => {
    if (!machConeMeshRef.current) return;
    const isSupersonic = telemetry.mach >= 1.0 && params.show_shockwaves;
    machConeMeshRef.current.visible = isSupersonic;

    if (isSupersonic) {
      const mu = Math.asin(1 / Math.max(1.001, telemetry.mach));
      const coneHeight = 16.0;
      const baseRadius = coneHeight * Math.tan(mu);
      machConeMeshRef.current.geometry.dispose();
      const newGeo = new THREE.ConeGeometry(baseRadius, coneHeight, 32, 1, true);
      newGeo.rotateZ(Math.PI / 2);
      newGeo.translate(coneHeight / 2 - 6.7, 0, 0);
      machConeMeshRef.current.geometry = newGeo;
    }
  }, [telemetry.mach, params.show_shockwaves]);

  // Update Afterburner Flame for supersonic aircraft
  useEffect(() => {
    if (!afterburnerGroupRef.current) return;
    const config = AIRCRAFT_MODELS[params.modelType];
    afterburnerGroupRef.current.visible = config.supersonicCapable && params.airspeed_kts > 480;
  }, [params.modelType, params.airspeed_kts]);

  // Update Force Vectors Overlay
  useEffect(() => {
    if (!forceVectorsGroupRef.current) return;
    updateAeroForceVectors(
      forceVectorsGroupRef.current,
      telemetry.lift_N,
      telemetry.drag_N,
      params.angle_of_attack,
      params.show_pressure_vectors
    );
  }, [telemetry.lift_N, telemetry.drag_N, params.angle_of_attack, params.show_pressure_vectors]);

  // Update Dynamic Smoke Streamlines (Vortex Flow Law + Real Vertex Surface Field)
  useEffect(() => {
    const linesGroup = streamlinesGroupRef.current;
    if (!linesGroup) return;

    // Dispose old geometries & materials cleanly
    linesGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    linesGroup.clear();
    tracedCurvesRef.current = [];

    if (!params.show_streamlines) return;

    const sf = surfaceFieldRef.current;
    const halfSpan = sf ? sf.halfSpan : (params.modelType === 'airliner' ? 9.0 : params.modelType === 'concorde' ? 4.8 : 6.8);

    interface RakeFilament {
      y: number;
      z: number;
      type: 'vortex' | 'engine' | 'wing' | 'fuselage';
    }

    const filaments: RakeFilament[] = [];

    if (params.modelType === 'cylinder') {
      [-2.2, -1.5, -0.9, -0.35, 0.0, 0.35, 0.9, 1.5, 2.2].forEach((y) => {
        [-2.5, 0.0, 2.5].forEach((z) => filaments.push({ y, z, type: 'wing' }));
      });
    } else if (params.modelType === 'naca2412' || params.modelType === 'naca0012') {
      [-0.9, -0.35, 0.05, 0.45, 1.0].forEach((y) => {
        [-halfSpan * 0.75, -halfSpan * 0.35, 0.0, halfSpan * 0.35, halfSpan * 0.75].forEach((z) =>
          filaments.push({ y, z, type: 'wing' })
        );
      });
      [-halfSpan * 0.98, halfSpan * 0.98].forEach((z) => {
        [-0.1, 0.2].forEach((y) => filaments.push({ y, z, type: 'vortex' }));
      });
    } else {
      // Fuselage / canopy rake
      [-0.8, 0.0, 0.8].forEach((z) => {
        [-0.35, 0.35, 1.15].forEach((y) => filaments.push({ y, z, type: 'fuselage' }));
      });
      // Main spanwise wing rake adapted to real vertex span
      [-0.78, -0.52, -0.28, 0.28, 0.52, 0.78].forEach((frac) => {
        const z = frac * halfSpan;
        [-0.55, 0.05, 0.65].forEach((y) => filaments.push({ y, z, type: 'wing' }));
      });
      // Wingtip vortex filaments seeded right at actual span tips
      [-halfSpan * 0.98, -halfSpan * 0.93, halfSpan * 0.93, halfSpan * 0.98].forEach((z) => {
        [-0.12, 0.18].forEach((y) => filaments.push({ y, z, type: 'vortex' }));
      });
      // Engine streams
      if (params.modelType === 'airliner') {
        [-3.6, 3.6].forEach((z) => filaments.push({ y: -1.35, z, type: 'engine' }));
      } else if (params.modelType === 'f22') {
        [-0.67, 0.67].forEach((z) => filaments.push({ y: -0.38, z, type: 'engine' }));
      }
    }

    const fluid3DParams: Fluid3DParams = {
      modelType: params.modelType,
      aoaDeg: params.angle_of_attack,
      airspeed_kts: params.airspeed_kts,
      mach: telemetry.mach,
      altitude_ft: params.altitude_ft,
      flapsDeg: params.flaps_deg,
      viscosity: params.viscosity,
      isStalled: telemetry.isStalled,
      cl: telemetry.cl,
      cd: telemetry.cd,
      timeSec: performance.now() * 0.001,
      surfaceField: sf,
    };

    const densityScale = Math.max(0.4, Math.min(1.6, params.smoke_density));
    const tubularSegments = 96;
    const radialSegments = 6;
    const collectedCurves: TracedCurveData[] = [];

    filaments.forEach((fil) => {
      const pts3D = FluidDynamics3D.traceStreamline({ x: -20, y: fil.y, z: fil.z }, fluid3DParams, 136, 0.28);
      if (pts3D.length < 6) return;

      collectedCurves.push({ points: pts3D });

      const points = pts3D.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(points);
      const baseRadius = fil.type === 'engine' ? 0.052 : fil.type === 'vortex' ? 0.044 : 0.032;
      const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, baseRadius * (0.75 + densityScale * 0.25), radialSegments, false);

      // Per-vertex coloring along the tube based on real Cp, vorticity & separation
      const posAttr = tubeGeo.attributes.position;
      const vColors = new Float32Array(posAttr.count * 3);
      const ringSize = radialSegments + 1;

      for (let seg = 0; seg <= tubularSegments; seg++) {
        const sampleIdx = Math.min(pts3D.length - 1, Math.round((seg / tubularSegments) * (pts3D.length - 1)));
        const pt = pts3D[sampleIdx];

        let r = 0.2, g = 0.82, b = 0.6;
        if (pt.isSeparated || (telemetry.isStalled && fil.y > 0 && pt.x > -1)) {
          r = 0.94; g = 0.27; b = 0.27; // Turbulent stall separation
        } else if (fil.type === 'engine') {
          r = 0.98; g = 0.55; b = 0.18; // Jet exhaust
        } else if (pt.vorticity > 0.35 || fil.type === 'vortex') {
          r = 0.22; g = 0.86; b = 1.0; // Biot-Savart vortex core
        } else if (pt.pressureCoeff < -0.5) {
          r = 0.14; g = 0.62; b = 0.96; // Suction acceleration
        } else if (pt.pressureCoeff > 0.25) {
          r = 0.96; g = 0.72; b = 0.16; // Compression / ram
        }

        for (let rad = 0; rad < ringSize; rad++) {
          const vIdx = seg * ringSize + rad;
          if (vIdx < posAttr.count) {
            vColors[vIdx * 3] = r;
            vColors[vIdx * 3 + 1] = g;
            vColors[vIdx * 3 + 2] = b;
          }
        }
      }

      tubeGeo.setAttribute('color', new THREE.BufferAttribute(vColors, 3));

      const tubeMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: Math.min(0.92, (fil.type === 'vortex' ? 0.78 : 0.58) * (0.65 + densityScale * 0.35)),
      });
      linesGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    });

    tracedCurvesRef.current = collectedCurves;
  }, [
    params.show_streamlines,
    params.modelType,
    params.angle_of_attack,
    params.airspeed_kts,
    params.flaps_deg,
    params.viscosity,
    params.smoke_density,
    telemetry.cl,
    telemetry.mach,
    telemetry.isStalled,
    surfaceVersion,
  ]);

  // Update 3D Vector Quiver Grid (when params.show_quiver is enabled)
  useEffect(() => {
    const qGroup = quiverGroupRef.current;
    if (!qGroup) return;

    qGroup.traverse((obj) => {
      if ((obj as THREE.LineSegments).isLineSegments) {
        (obj as THREE.LineSegments).geometry.dispose();
        const m = (obj as THREE.LineSegments).material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    qGroup.clear();

    if (!params.show_quiver) return;

    const fluid3DParams: Fluid3DParams = {
      modelType: params.modelType,
      aoaDeg: params.angle_of_attack,
      airspeed_kts: params.airspeed_kts,
      mach: telemetry.mach,
      altitude_ft: params.altitude_ft,
      flapsDeg: params.flaps_deg,
      viscosity: params.viscosity,
      isStalled: telemetry.isStalled,
      cl: telemetry.cl,
      cd: telemetry.cd,
      timeSec: performance.now() * 0.001,
      surfaceField: surfaceFieldRef.current,
    };

    const positions: number[] = [];
    const colors: number[] = [];

    for (let x = -9; x <= 11; x += 2.5) {
      for (let y = -2.0; y <= 3.0; y += 1.25) {
        for (let z = -6.0; z <= 6.0; z += 3.0) {
          const vel = FluidDynamics3D.getVelocity({ x, y, z }, fluid3DParams);
          const s = vel.speed || 1;
          const len = Math.min(1.6, 0.45 + s * 0.42);
          const nx = (vel.u / s) * len;
          const ny = (vel.v / s) * len;
          const nz = (vel.w / s) * len;

          positions.push(x, y, z, x + nx, y + ny, z + nz);

          let r = 0.22, g = 0.74, b = 0.97;
          if (vel.isSeparated) { r = 0.94; g = 0.27; b = 0.27; }
          else if (vel.pressureCoeff < -0.5) { r = 0.14; g = 0.68; b = 0.98; }
          else if (vel.pressureCoeff > 0.2) { r = 0.96; g = 0.72; b = 0.16; }
          else { r = 0.20; g = 0.83; b = 0.60; }

          colors.push(r * 0.4, g * 0.4, b * 0.4, r, g, b);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 });
    qGroup.add(new THREE.LineSegments(geo, mat));
  }, [
    params.show_quiver,
    params.modelType,
    params.angle_of_attack,
    params.airspeed_kts,
    params.flaps_deg,
    params.viscosity,
    telemetry.cl,
    telemetry.mach,
    telemetry.isStalled,
    surfaceVersion,
  ]);

  // Camera Presets
  const setCameraPreset = (preset: 'iso' | 'side' | 'top' | 'front' | 'chase') => {
    setActivePreset(preset);
    setIsAutoOrbit(false);
    if (!cameraRef.current || !controlsRef.current) return;

    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    ctrl.target.set(0, 0, 0);

    switch (preset) {
      case 'iso':
        cam.position.set(-15, 7.5, 15);
        break;
      case 'side':
        cam.position.set(0, 1, 18);
        break;
      case 'top':
        cam.position.set(0, 22, 0.001);
        break;
      case 'front':
        cam.position.set(-18, 1, 0);
        break;
      case 'chase':
        cam.position.set(18, 4, 0);
        break;
    }
    ctrl.update();
  };

  // Snapshot
  const handleTakeSnapshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `aerolab-${params.modelType}-vortex-flow-${Date.now()}.png`;
    a.click();
  };

  const currentMeta = GLB_MODEL_REGISTRY[params.modelType];

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-xl overflow-hidden border border-[var(--border)] bg-[#0D1114] shadow-[var(--shadow-tech)] flex flex-col group select-none">
      {/* Three.js Canvas Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* WebGL2 Unavailable Fallback Overlay */}
      {webglUnavailable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D1114]/95 gap-4 z-30 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <div className="max-w-md flex flex-col gap-1.5">
            <h3 className="text-sm font-bold text-white">Hardware WebGL2 Unavailable</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your browser or GPU driver could not initialize a WebGL2 context. Use the built-in Software 3D Canvas engine for full aerodynamic simulation.
            </p>
          </div>
          {onFallbackToCanvas && (
            <button
              onClick={onFallbackToCanvas}
              className="px-4 py-2 rounded-lg bg-[#1769AA] hover:bg-[#1e7bc4] text-white font-semibold text-xs transition-colors"
            >
              Switch to Canvas 3D Engine
            </button>
          )}
        </div>
      )}

      {/* Model Loading Spinner / Progress */}
      {modelLoading && !webglUnavailable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D1114]/90 gap-3.5 z-20">
          <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-[#38bdf8] animate-spin" />
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-100 font-mono">
              Loading {currentMeta ? currentMeta.name : '3D CAD Model'} · {loadProgress}%
            </span>
            <div className="w-48 h-1.5 rounded-full bg-[#151A1E] overflow-hidden border border-slate-700">
              <div
                className="h-full bg-[#1769AA] transition-all duration-200"
                style={{ width: `${Math.max(8, loadProgress)}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {currentMeta ? `${currentMeta.fileSizeLabel} · ${currentMeta.meshCountLabel}` : 'Building vertex flow field'}
            </span>
          </div>
        </div>
      )}

      {loadError && !modelLoading && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg bg-[#151A1E] border border-amber-500/40 text-amber-300 text-[11px] font-mono z-10 pointer-events-none">
          {loadError}
        </div>
      )}

      {/* Top Header Overlay (Solid #151A1E surface, zero backdrop-blur over WebGL) */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-2 bg-[#151A1E]/95 px-3 py-1.5 rounded-lg border border-slate-700/80 pointer-events-auto text-xs">
          <span className="font-semibold text-slate-100 whitespace-nowrap">
            {currentMeta ? currentMeta.name : AIRCRAFT_MODELS[params.modelType].name}
          </span>
          <span className="text-slate-500" aria-hidden="true">·</span>
          <span className="text-[11px] font-mono text-sky-300 whitespace-nowrap">
            Biot-Savart Vortex + Vertex Flow
          </span>
          {telemetry.isStalled && (
            <>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span className="text-[11px] font-bold text-red-400 flex items-center gap-1 whitespace-nowrap">
                <AlertTriangle className="w-3 h-3" />
                STALL
              </span>
            </>
          )}
        </div>

        {/* Top-Right Quick Action Toolbar */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {onOpenModelInspector && (
            <button
              onClick={onOpenModelInspector}
              className="px-3 py-1.5 rounded-lg bg-[#151A1E]/95 hover:bg-slate-800 border border-slate-700/80 text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Open 3D CAD Asset Inspector"
            >
              <Box className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">3D Inspector</span>
            </button>
          )}

          <button
            onClick={handleTakeSnapshot}
            className="p-2 rounded-lg bg-[#151A1E]/95 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-white transition-colors"
            title="Save CFD PNG Snapshot"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
          </button>

          <div className="flex items-center bg-[#151A1E]/95 p-0.5 rounded-lg border border-slate-700/80">
            <button
              onClick={() => onParamChange('audio_enabled', !params.audio_enabled)}
              className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              title={params.audio_enabled ? 'Mute Wind Sound' : 'Enable Wind Audio'}
            >
              {params.audio_enabled ? (
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
            </button>

            {onFallbackToCanvas && (
              <button
                onClick={onFallbackToCanvas}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors border-l border-slate-700/80 ml-0.5 whitespace-nowrap shrink-0"
                title="Switch to Canvas 3D Engine"
              >
                Canvas 3D
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Floating Controls Dock */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-1.5 pointer-events-none z-10">
        {/* Camera Presets & Turntable */}
        <div className="flex items-center gap-0.5 sm:gap-1 bg-[#151A1E]/95 p-1 rounded-lg border border-slate-700/80 pointer-events-auto">
          {(['iso', 'side', 'top', 'front', 'chase'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setCameraPreset(p)}
              className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] sm:text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                activePreset === p && !isAutoOrbit
                  ? 'bg-[#1769AA] text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              {p}
            </button>
          ))}

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          <button
            onClick={() => setIsAutoOrbit(!isAutoOrbit)}
            className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] sm:text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              isAutoOrbit
                ? 'bg-[#1769AA] text-white'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
            }`}
            title="Toggle 360 Turntable Orbit"
          >
            <RotateCw className={`w-3 h-3 ${isAutoOrbit ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Orbit</span>
          </button>
        </div>

        {/* Shading & Heatmap Overlays */}
        <div className="flex items-center gap-0.5 sm:gap-1 bg-[#151A1E]/95 p-1 rounded-lg border border-slate-700/80 pointer-events-auto">
          {(
            [
              { id: 'pbr', label: 'PBR' },
              { id: 'cfdHeatmap', label: 'CFD Heat' },
              { id: 'wireframe', label: 'Wire' },
              { id: 'xray', label: 'X-Ray' },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveShading(s.id);
                if (s.id === 'cfdHeatmap') onParamChange('show_heatmap', true);
                else if (s.id === 'pbr') onParamChange('show_heatmap', false);
              }}
              className={`px-2 sm:px-2.5 py-1 rounded-md text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeShading === s.id
                  ? 'bg-[#1769AA] text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Floating Spatial Force Readout */}
      {params.show_pressure_vectors && (
        <div className="absolute top-14 left-3 pointer-events-none z-10 flex flex-col gap-1 font-mono tabular-nums text-[11px] bg-[#151A1E]/92 px-3 py-2 rounded-lg border border-slate-700/80">
          <div className="flex items-center justify-between gap-3 text-emerald-300">
            <span>LIFT</span>
            <span className="font-semibold">{(telemetry.lift_N / 1000).toFixed(1)} kN</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-amber-300">
            <span>DRAG</span>
            <span className="font-semibold">{(telemetry.drag_N / 1000).toFixed(1)} kN</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sky-300">
            <span>L/D</span>
            <span className="font-semibold">{telemetry.ldRatio.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* CFD Pressure Heatmap Legend Overlay */}
      {(activeShading === 'cfdHeatmap' || params.show_heatmap) && (
        <div className="absolute top-14 right-3 pointer-events-none z-10 bg-[#151A1E]/95 px-3 py-2 rounded-lg border border-slate-700/80 flex flex-col gap-1 text-[10px] font-mono">
          <span className="text-slate-200 font-semibold tracking-wider">Cp PRESSURE COEFFICIENT</span>
          <div className="w-32 h-2 rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 via-emerald-400 via-amber-400 to-red-600 border border-slate-700" />
          <div className="flex justify-between text-slate-300">
            <span>-2.5</span>
            <span>0</span>
            <span>+1.0</span>
          </div>
        </div>
      )}
    </div>
  );
};
