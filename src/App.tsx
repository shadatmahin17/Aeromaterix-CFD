import { useState, useMemo, useEffect } from 'react';
import { SimulationParams } from './types/aerodynamics';
import { calculateAeroTelemetry, AIRCRAFT_MODELS } from './utils/airfoilGenerators';
import { WindTunnelCanvas3D } from './components/WindTunnelCanvas3D';
import { WindTunnelCanvasWebGL } from './components/WindTunnelCanvasWebGL';
import { TelemetryHUD } from './components/TelemetryHUD';
import { AeroCharts } from './components/AeroCharts';
import { ControlsDeck } from './components/ControlsDeck';
import { AeroTheoryModal } from './components/AeroTheoryModal';
import { ModelViewerModal } from './components/ModelViewerModal';
import { probeWebGL2Support } from './utils/webglSupport';
import { 
  BookOpen, 
  RotateCcw, 
  Wind, 
  Box, 
  Keyboard, 
  Sliders, 
  Activity, 
  PanelLeftClose, 
  PanelLeft, 
  PanelRightClose, 
  PanelRight, 
  Volume2, 
  VolumeX, 
  ShieldAlert,
  Flame,
  CheckCircle2,
  Gauge
} from 'lucide-react';

const INITIAL_PARAMS: SimulationParams = {
  modelType: 'f22',
  angle_of_attack: 4.0,
  airspeed_kts: 350,
  altitude_ft: 15000,
  flaps_deg: 0,
  viscosity: 0.10,
  smoke_density: 1.0,
  show_streamlines: true,
  show_particles: true,
  show_heatmap: false,
  show_pressure_vectors: true,
  show_quiver: false,
  show_shockwaves: true,
  audio_enabled: false,
  renderEngine: 'webgl',
  landingGear: false,
  renderShading: 'pbr',
};

export default function App() {
  const webglSupported = useMemo(() => probeWebGL2Support().supported, []);
  const [params, setParams] = useState<SimulationParams>(() => ({
    ...INITIAL_PARAMS,
    renderEngine: probeWebGL2Support().supported ? 'webgl' : 'canvas',
  }));
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isTheoryOpen, setIsTheoryOpen] = useState<boolean>(false);
  const [isModelViewerOpen, setIsModelViewerOpen] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'controls' | 'tunnel' | 'results'>('tunnel');
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(true);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(true);

  // Parameter update handler
  const handleParamChange = <K extends keyof SimulationParams>(
    key: K,
    value: SimulationParams[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // Reset to defaults
  const handleReset = () => {
    setParams({
      ...INITIAL_PARAMS,
      renderEngine: webglSupported ? 'webgl' : 'canvas',
    });
    setIsPaused(false);
  };

  // Keyboard Navigation & Simulator Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input, textarea, or select
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused((prev) => !prev);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        setParams((p) => ({ ...p, angle_of_attack: Math.min(30, +(p.angle_of_attack + 0.5).toFixed(1)) }));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        setParams((p) => ({ ...p, angle_of_attack: Math.max(-15, +(p.angle_of_attack - 0.5).toFixed(1)) }));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setParams((p) => ({ ...p, airspeed_kts: Math.min(1200, p.airspeed_kts + 15) }));
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setParams((p) => ({ ...p, airspeed_kts: Math.max(20, p.airspeed_kts - 15) }));
      } else if (e.key === 'r' || e.key === 'R') {
        handleReset();
      } else if (e.key === 'm' || e.key === 'M') {
        setParams((p) => ({ ...p, audio_enabled: !p.audio_enabled }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Live Aerodynamic Physics Telemetry
  const telemetry = useMemo(() => {
    return calculateAeroTelemetry(
      params.modelType,
      params.angle_of_attack,
      params.airspeed_kts,
      params.altitude_ft,
      params.flaps_deg
    );
  }, [
    params.modelType,
    params.angle_of_attack,
    params.airspeed_kts,
    params.altitude_ft,
    params.flaps_deg,
  ]);

  const currentModel = AIRCRAFT_MODELS[params.modelType];

  return (
    <div className="h-screen h-[100dvh] w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] flex flex-col font-sans select-none selection:bg-[var(--accent-light)] selection:text-[var(--accent)]">
      {/* 1. TOP BAR — CFD WORKSTATION NAVIGATION */}
      <header className="h-12 sm:h-14 px-2 sm:px-4 border-b border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur-md flex items-center justify-between gap-1.5 z-30 flex-shrink-0 shadow-[var(--shadow-tech)]">
        {/* Left Zone: Brand logo & flight status readout */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <div className="flex items-center gap-2">
            <img
              src="/aerolab-logo.png"
              alt="AeroLab"
              className="h-7 sm:h-8 w-auto object-contain shrink-0"
            />
            <span className="hidden md:inline font-script text-xl leading-none text-[#1769AA] pt-0.5">
              Wind Tunnel
            </span>
          </div>

          {/* Real-time status readout (Desktop) */}
          <div className="hidden xl:flex items-center gap-2 pl-3 border-l border-[var(--border)] text-xs">
            <span className="text-[#161A1D] font-semibold font-sans">{currentModel.name}</span>
            <span className="text-[#D9DEE2]" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#1769AA] font-semibold">
              M {telemetry.mach.toFixed(2)}
            </span>
            <span className="text-[#D9DEE2]" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#1769AA] font-semibold">
              α {params.angle_of_attack >= 0 ? '+' : ''}{params.angle_of_attack.toFixed(1)}°
            </span>
            <span className="text-[#D9DEE2]" aria-hidden="true">·</span>
            <span className={`text-[11px] font-mono font-medium ${telemetry.isStalled ? 'text-red-600 font-bold' : 'text-[#5C6670]'}`}>
              {telemetry.flowState}
            </span>
          </div>
        </div>

        {/* Center Zone: Mobile & Tablet Segmented Tab Switcher (< lg) */}
        <div className="flex lg:hidden items-center p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] sm:text-xs shrink-0">
          <button
            onClick={() => setMobileTab('controls')}
            className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-md font-semibold flex items-center gap-1 transition-colors ${
              mobileTab === 'controls'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
            aria-label="Controls"
          >
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden min-[400px]:inline">Setup</span>
          </button>
          <button
            onClick={() => setMobileTab('tunnel')}
            className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-md font-semibold flex items-center gap-1 transition-colors ${
              mobileTab === 'tunnel'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
            aria-label="3D View"
          >
            <Wind className="w-3.5 h-3.5 shrink-0" />
            <span>3D</span>
          </button>
          <button
            onClick={() => setMobileTab('results')}
            className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-md font-semibold flex items-center gap-1 transition-colors ${
              mobileTab === 'results'
                ? 'bg-[#1769AA] text-white'
                : 'text-[#5C6670] hover:text-[#161A1D]'
            }`}
            aria-label="Results"
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden min-[400px]:inline">Data</span>
          </button>
        </div>

        {/* Right Zone: Workstation Controls & Modal Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Desktop Left Sidebar Toggle */}
          <button
            onClick={() => setShowLeftSidebar((prev) => !prev)}
            className={`hidden lg:flex px-2.5 py-1.5 rounded-lg border transition-colors text-xs font-semibold items-center gap-1.5 ${
              showLeftSidebar
                ? 'bg-[var(--accent-light)] border-[#1769AA]/30 text-[#1769AA]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[#5C6670] hover:text-[#161A1D]'
            }`}
            title={showLeftSidebar ? 'Collapse Left Controls Deck' : 'Expand Left Controls Deck'}
          >
            {showLeftSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            <span className="hidden xl:inline text-[11px]">Controls</span>
          </button>

          {/* Desktop Right Sidebar Toggle */}
          <button
            onClick={() => setShowRightSidebar((prev) => !prev)}
            className={`hidden lg:flex px-2.5 py-1.5 rounded-lg border transition-colors text-xs font-semibold items-center gap-1.5 ${
              showRightSidebar
                ? 'bg-[var(--accent-light)] border-[#1769AA]/30 text-[#1769AA]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[#5C6670] hover:text-[#161A1D]'
            }`}
            title={showRightSidebar ? 'Collapse Right Telemetry Deck' : 'Expand Right Telemetry Deck'}
          >
            <span className="hidden xl:inline text-[11px]">Results</span>
            {showRightSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
          </button>

          <div className="hidden lg:block w-px h-5 bg-[var(--border)] mx-0.5" />

          {/* 3D CAD Asset Inspector Trigger */}
          <button
            onClick={() => setIsModelViewerOpen(true)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[#1769AA] text-xs font-semibold text-[#161A1D] hover:text-[#1769AA] transition-colors flex items-center gap-1.5 shadow-sm"
            title="Inspect 3D GLB CAD Model with Full Turntable & Specifications"
          >
            <Box className="w-3.5 h-3.5 text-[#1769AA]" />
            <span className="hidden sm:inline">CAD Inspector</span>
          </button>

          {/* Theory Modal Trigger */}
          <button
            onClick={() => setIsTheoryOpen(true)}
            className="hidden sm:flex px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[#1769AA] text-xs font-semibold text-[#161A1D] hover:text-[#1769AA] transition-colors items-center gap-1.5 whitespace-nowrap shadow-sm"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#1769AA]" />
            <span className="hidden md:inline">Theory</span>
          </button>

          {/* Audio Toggle */}
          <button
            onClick={() => setParams((p) => ({ ...p, audio_enabled: !p.audio_enabled }))}
            className={`p-1.5 rounded-lg border transition-colors ${
              params.audio_enabled
                ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/40'
                : 'bg-[var(--surface)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
            }`}
            title={params.audio_enabled ? 'Mute Audio (M)' : 'Enable Audio (M)'}
          >
            {params.audio_enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Reset Simulation Button */}
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg text-[#5C6670] hover:text-[#161A1D] bg-[var(--surface)] hover:bg-[var(--bg)] transition-colors border border-[var(--border)]"
            title="Reset Simulation to Initial State (R)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. MAIN CFD WORKSTATION VIEWPORT & SIDEBARS */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 relative">
        {/* =========================================================================
            LEFT COLUMN: SIMULATION SETUP & FLIGHT CONTROLS DECK
            ========================================================================= */}
        <section
          id="controls"
          aria-label="Simulation Controls"
          className={`
            ${showLeftSidebar ? 'lg:flex lg:w-80 xl:w-96' : 'lg:hidden'}
            ${mobileTab === 'controls' ? 'flex flex-1 w-full' : 'hidden'}
            flex-shrink-0 h-full overflow-y-auto overscroll-contain custom-scrollbar border-r border-[var(--border)] bg-[var(--bg)] p-3 sm:p-3.5 pb-8 flex-col gap-3.5 z-20
          `}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#1769AA]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
                Simulation Controls
              </h2>
            </div>
            <span className="text-[11px] font-mono text-[#5C6670]">
              Parameters
            </span>
          </div>

          <ControlsDeck
            params={params}
            onParamChange={handleParamChange}
            isPaused={isPaused}
            onTogglePause={() => setIsPaused((prev) => !prev)}
            onReset={handleReset}
            onOpenTheory={() => setIsTheoryOpen(true)}
            onOpenModelInspector={() => setIsModelViewerOpen(true)}
          />
        </section>

        {/* =========================================================================
            CENTER COLUMN: FIXED 3D WIND TUNNEL VIEWPORT (CFD MAIN STAGE)
            ========================================================================= */}
        <section
          id="wind-tunnel"
          aria-label="3D Wind Tunnel Viewport"
          className={`
            ${mobileTab === 'tunnel' ? 'flex flex-1 w-full' : 'hidden lg:flex'}
            flex-1 h-full min-h-0 relative flex-col overflow-hidden bg-[var(--bg)] p-1.5 sm:p-3
          `}
        >
          <div className="w-full h-full relative flex-1 min-h-0">
            {params.renderEngine !== 'canvas' ? (
              <WindTunnelCanvasWebGL
                params={params}
                onParamChange={handleParamChange}
                telemetry={telemetry}
                isPaused={isPaused}
                onFallbackToCanvas={() => handleParamChange('renderEngine', 'canvas')}
                onOpenModelInspector={() => setIsModelViewerOpen(true)}
              />
            ) : (
              <WindTunnelCanvas3D
                params={params}
                onParamChange={handleParamChange}
                telemetry={telemetry}
                isPaused={isPaused}
                onOpenWebGL={webglSupported ? () => handleParamChange('renderEngine', 'webgl') : undefined}
                onOpenModelInspector={() => setIsModelViewerOpen(true)}
              />
            )}
          </div>

          {/* Mobile/Tablet Quick Pitch & Pause Bar (placed below viewport to avoid overlapping 3D camera/shading dock) */}
          <div className="lg:hidden flex flex-wrap items-center justify-between gap-1.5 pt-1.5 px-0.5 flex-shrink-0">
            <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] font-mono pl-1 pr-0.5">AoA:</span>
              {[-5, 0, 5, 15].map((a) => (
                <button
                  key={a}
                  onClick={() => handleParamChange('angle_of_attack', a)}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                    Math.abs(params.angle_of_attack - a) < 1
                      ? 'bg-[#1769AA] text-white font-semibold'
                      : 'bg-[var(--bg)] text-[var(--text)] hover:text-[#1769AA]'
                  }`}
                >
                  {a >= 0 ? `+${a}°` : `${a}°`}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMobileTab('results')}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-semibold bg-[var(--surface)] border border-[var(--border)] text-[#1769AA]"
              >
                L/D {telemetry.ldRatio.toFixed(1)}
              </button>
              <button
                onClick={() => setIsPaused((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shadow-sm ${
                  isPaused
                    ? 'bg-amber-500 border-amber-600 text-slate-950 font-bold'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:border-[#1769AA]'
                }`}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </div>
        </section>

        {/* =========================================================================
            RIGHT COLUMN: TELEMETRY & ANALYTICAL POLARS DECK
            ========================================================================= */}
        <section
          id="telemetry-results"
          aria-label="Flight Telemetry & Polars"
          className={`
            ${showRightSidebar ? 'lg:flex lg:w-88 xl:w-[420px]' : 'lg:hidden'}
            ${mobileTab === 'results' ? 'flex flex-1 w-full' : 'hidden'}
            flex-shrink-0 h-full overflow-y-auto overscroll-contain custom-scrollbar border-l border-[var(--border)] bg-[var(--bg)] p-3 sm:p-3.5 pb-8 flex-col gap-3.5 z-20
          `}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#1769AA]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
                Telemetry &amp; Polars
              </h2>
            </div>
            <span className="text-[11px] font-mono text-[#5C6670]">
              Vortex Lattice
            </span>
          </div>

          {/* Primary Telemetry Instruments */}
          <TelemetryHUD
            telemetry={telemetry}
            aoaDeg={params.angle_of_attack}
            modelType={params.modelType}
            params={params}
          />

          {/* Aerodynamic Polar Curves */}
          <AeroCharts
            modelType={params.modelType}
            currentAoa={params.angle_of_attack}
            airspeedKts={params.airspeed_kts}
            altitudeFt={params.altitude_ft}
            flapsDeg={params.flaps_deg}
            telemetry={telemetry}
          />

          {/* Real-Time Flow Dynamics Insight Card */}
          <div className="antigravity-glass p-3.5 rounded-xl text-xs text-[#5C6670] flex flex-col gap-2 leading-relaxed">
            <div className="flex items-center gap-2 text-[#161A1D] font-semibold">
              <div className="w-5 h-5 rounded-md bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
                <Wind className="w-3 h-3" />
              </div>
              <span className="text-[#161A1D] font-bold text-xs">Vortex &amp; Vertex Flow Law</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#5C6670]">
              Streamlines and PIV streaks are integrated with RK2 midpoint advection through a 3D Biot-Savart horseshoe vortex lattice coupled to real surface vertex normals for boundary tangential slip.
              {telemetry.isStalled ? (
                <span className="text-red-700 font-medium block mt-2 p-2 rounded-lg bg-red-50 border border-red-200">
                  Critical angle of attack exceeded. Adverse pressure gradients have detached the boundary layer, shedding unsteady von Kármán wake vortices.
                </span>
              ) : (
                <span className="text-[#161A1D] block mt-1.5 font-medium">
                  Attached circulation Γ remains steady; Lamb-Oseen wingtip vortices trail downstream from actual spanwise tips.
                </span>
              )}
            </p>
          </div>
        </section>
      </main>

      {/* 3. WORKSTATION BOTTOM STATUS STRIP */}
      <footer className="min-h-7 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] border-t border-[var(--border)] bg-[var(--surface)] px-2.5 sm:px-4 flex items-center justify-between gap-2 text-[11px] text-[#5C6670] z-30 flex-shrink-0 overflow-hidden">
        <div className="hidden xl:flex items-center gap-2.5 whitespace-nowrap">
          <div className="flex items-center gap-1 text-[#161A1D] font-semibold">
            <Keyboard className="w-3 h-3 text-[#1769AA]" />
            <span>Hotkeys:</span>
          </div>
          <span className="font-mono text-[10px] bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.2 rounded text-[#161A1D]">Space</span> Pause
          <span className="font-mono text-[10px] bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.2 rounded text-[#161A1D]">↑/↓</span> Pitch AoA
          <span className="font-mono text-[10px] bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.2 rounded text-[#161A1D]">←/→</span> Airspeed
          <span className="font-mono text-[10px] bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.2 rounded text-[#161A1D]">M</span> Audio
          <span className="font-mono text-[10px] bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.2 rounded text-[#161A1D]">R</span> Reset
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-[10px] text-[#5C6670] tabular-nums whitespace-nowrap">
          <span className="hidden min-[380px]:inline">ISA Std Atm</span>
          <span className="hidden min-[380px]:inline text-[var(--border)]" aria-hidden="true">·</span>
          <span>FL{params.altitude_ft.toLocaleString()}</span>
          <span className="text-[var(--border)]" aria-hidden="true">·</span>
          <span>ρ = {telemetry.air_density_kg_m3.toFixed(3)} kg/m³</span>
        </div>

        <div className="flex items-center gap-2 text-[#5C6670] text-[10px] whitespace-nowrap">
          <button
            onClick={() => setIsTheoryOpen(true)}
            className="hover:text-[#1769AA] font-medium transition-colors"
          >
            Theory Guide
          </button>
          <span className="hidden md:inline text-[var(--border)]" aria-hidden="true">·</span>
          <span className="hidden md:inline font-medium text-[#161A1D]">AeroLab Workstation</span>
        </div>
      </footer>

      {/* Educational Theory Modal */}
      <AeroTheoryModal
        isOpen={isTheoryOpen}
        onClose={() => setIsTheoryOpen(false)}
      />

      {/* 3D CAD Asset Inspector Modal */}
      <ModelViewerModal
        isOpen={isModelViewerOpen}
        onClose={() => setIsModelViewerOpen(false)}
        activeModelType={params.modelType}
        onSelectModel={(modelType) => handleParamChange('modelType', modelType)}
        onApplyToWindTunnel={(opts) => {
          handleParamChange('modelType', opts.modelType);
          if (opts.landingGear !== undefined) {
            handleParamChange('landingGear', opts.landingGear);
          }
        }}
      />
    </div>
  );
}
