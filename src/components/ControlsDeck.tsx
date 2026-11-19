import React, { useState, useEffect } from 'react';
import { SimulationParams, AircraftModelType } from '../types/aerodynamics';
import { AIRCRAFT_MODELS } from '../utils/airfoilGenerators';
import { 
  Plane, 
  Wind, 
  Layers, 
  Play, 
  Pause, 
  RotateCcw, 
  Flame, 
  Compass,
  Repeat,
  Box,
  Check
} from 'lucide-react';

interface ControlsDeckProps {
  params: SimulationParams;
  onParamChange: <K extends keyof SimulationParams>(key: K, value: SimulationParams[K]) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  onReset: () => void;
  onOpenTheory: () => void;
  onOpenModelInspector?: () => void;
}

export const ControlsDeck: React.FC<ControlsDeckProps> = ({
  params,
  onParamChange,
  isPaused,
  onTogglePause,
  onReset,
  onOpenTheory,
  onOpenModelInspector,
}) => {
  const currentModel = AIRCRAFT_MODELS[params.modelType];
  const [isAutoSweeping, setIsAutoSweeping] = useState(false);
  const sweepDirRef = React.useRef<number>(1);

  // Dynamic Auto AoA Flight Sweep
  useEffect(() => {
    if (!isAutoSweeping || isPaused) return;

    const interval = setInterval(() => {
      let nextAoa = params.angle_of_attack + sweepDirRef.current * 0.4;
      if (nextAoa >= 24) {
        sweepDirRef.current = -1;
        nextAoa = 24;
      } else if (nextAoa <= -4) {
        sweepDirRef.current = 1;
        nextAoa = -4;
      }
      onParamChange('angle_of_attack', parseFloat(nextAoa.toFixed(1)));
    }, 60);

    return () => clearInterval(interval);
  }, [isAutoSweeping, isPaused, params.angle_of_attack, onParamChange]);

  // Flight presets
  const presets: { name: string; desc: string; apply: () => void }[] = [
    {
      name: 'High-Speed Cruise',
      desc: 'Optimal L/D glide, low drag',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'airliner');
        onParamChange('angle_of_attack', 2.5);
        onParamChange('airspeed_kts', 490);
        onParamChange('altitude_ft', 35000);
        onParamChange('flaps_deg', 0);
      },
    },
    {
      name: 'Takeoff Climb',
      desc: 'High lift with flaps 20°',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'airliner');
        onParamChange('angle_of_attack', 10.5);
        onParamChange('airspeed_kts', 165);
        onParamChange('altitude_ft', 1500);
        onParamChange('flaps_deg', 20);
      },
    },
    {
      name: 'Deep Aerodynamic Stall',
      desc: 'Flow boundary detachment & wake',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'naca2412');
        onParamChange('angle_of_attack', 21.0);
        onParamChange('airspeed_kts', 110);
        onParamChange('altitude_ft', 4000);
        onParamChange('flaps_deg', 0);
      },
    },
    {
      name: 'Supersonic Dash (M 1.6)',
      desc: 'Sharp oblique Mach shockwave',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'concorde');
        onParamChange('angle_of_attack', 3.0);
        onParamChange('airspeed_kts', 1050);
        onParamChange('altitude_ft', 45000);
        onParamChange('flaps_deg', 0);
        onParamChange('show_shockwaves', true);
      },
    },
    {
      name: 'Fighter High-Alpha Turn',
      desc: 'Vortex lift at high AoA',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'f22');
        onParamChange('angle_of_attack', 18.0);
        onParamChange('airspeed_kts', 320);
        onParamChange('altitude_ft', 15000);
        onParamChange('flaps_deg', 0);
      },
    },
    {
      name: 'Cylinder Vortex Street',
      desc: 'Symmetric bluff body separation',
      apply: () => {
        setIsAutoSweeping(false);
        onParamChange('modelType', 'cylinder');
        onParamChange('angle_of_attack', 0.0);
        onParamChange('airspeed_kts', 140);
        onParamChange('altitude_ft', 1000);
        onParamChange('flaps_deg', 0);
      },
    },
  ];

  return (
    <div className="w-full flex flex-col gap-3.5">
      {/* 1. Aircraft Model Selection */}
      <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
              <Plane className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans truncate">
              Model Selection
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#1769AA] font-semibold truncate">
            {currentModel.name.split(' (')[0]}
          </span>
        </div>

        {/* Aircraft Model Grid */}
        <div className="grid grid-cols-1 min-[340px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
          {(Object.keys(AIRCRAFT_MODELS) as AircraftModelType[]).map((type) => {
            const config = AIRCRAFT_MODELS[type];
            const isSelected = params.modelType === type;
            return (
              <button
                key={type}
                onClick={() => {
                  onParamChange('modelType', type);
                  if (!config.flapCapable) onParamChange('flaps_deg', 0);
                }}
                className={`antigravity-card p-2.5 rounded-xl text-left flex flex-col justify-between transition-all ${
                  isSelected
                    ? '!bg-[var(--accent-light)] !border-[#1769AA] ring-1 ring-[#1769AA]/20'
                    : 'text-[#161A1D]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-[10px] font-mono font-semibold ${
                    isSelected ? 'text-[#1769AA]' : 'text-[#5C6670]'
                  }`}>
                    {config.category}{config.hasGlbModel ? ' · GLB' : ''}
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[#1769AA]" />}
                </div>
                <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-[#1769AA]' : 'text-[#161A1D]'}`}>
                  {config.name.split(' (')[0]}
                </span>
                <span className="text-[10px] text-[#5C6670] font-mono tabular-nums truncate mt-0.5">
                  Stall: {config.stallAngle > 0 ? `${config.stallAngle}°` : 'N/A'}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3D GLB Asset Action & Controls Banner */}
        {currentModel.hasGlbModel && (
          <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
                <Box className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#161A1D]">
                    3D GLB Mesh Active
                  </span>
                  <span className="text-[10px] font-mono text-[#1769AA] font-semibold">
                    {params.modelType === 'airliner'
                      ? '3.9 MB'
                      : params.modelType === 'concorde'
                      ? '755 KB'
                      : params.modelType === 'naca2412'
                      ? '11.4 KB'
                      : '741 KB'}
                  </span>
                </div>
                <p className="text-[11px] text-[#5C6670]">
                  Vertex normal field &amp; Cp surface mapping
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(params.modelType === 'f22' || params.modelType === 'airliner' || params.modelType === 'concorde') && (
                <button
                  onClick={() => onParamChange('landingGear', !params.landingGear)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    params.landingGear
                      ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/40'
                      : 'bg-[var(--surface)] text-[#5C6670] border-[var(--border)] hover:text-[#161A1D]'
                  }`}
                  title="Toggle landing gear configuration"
                >
                  {params.landingGear ? 'Gear: Down' : 'Gear: Up'}
                </button>
              )}

              {onOpenModelInspector && (
                <button
                  onClick={onOpenModelInspector}
                  className="px-3 py-1.5 rounded-lg bg-[#1769AA] hover:bg-[#145a92] text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>Inspect CAD</span>
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-[#5C6670] leading-relaxed border-t border-[var(--border)] pt-2.5">
          {currentModel.description}
        </p>
      </div>

      {/* 2. Interactive Primary Flight Sliders */}
      <div className="flex flex-col gap-3.5">
        {/* Attitude & Control Surfaces */}
        <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
                <Compass className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
                Attitude &amp; Flaps
              </span>
            </div>

            <button
              onClick={() => setIsAutoSweeping((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors border ${
                isAutoSweeping
                  ? 'bg-[#1769AA] text-white border-[#1769AA]'
                  : 'bg-[var(--bg)] text-[#5C6670] hover:text-[#161A1D] border-[var(--border)]'
              }`}
              title="Continuously sweep Angle of Attack dynamically"
            >
              <Repeat className={`w-3 h-3 ${isAutoSweeping ? 'animate-spin' : ''}`} />
              <span>{isAutoSweeping ? 'Auto Sweep ON' : 'Auto Sweep'}</span>
            </button>
          </div>

          {/* Angle of Attack (AoA) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="aoa-slider" className="text-[#161A1D] font-semibold">Angle of Attack (α)</label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold px-2 py-0.5 rounded bg-[var(--accent-light)]">
                {params.angle_of_attack >= 0 ? '+' : ''}{params.angle_of_attack.toFixed(1)}°
              </span>
            </div>
            <input
              id="aoa-slider"
              type="range"
              min="-20"
              max="35"
              step="0.5"
              value={params.angle_of_attack}
              onChange={(e) => {
                setIsAutoSweeping(false);
                onParamChange('angle_of_attack', parseFloat(e.target.value));
              }}
              className="w-full accent-[#1769AA] cursor-pointer h-2 bg-[#E4E9ED] rounded-lg"
            />
            <div className="grid grid-cols-3 min-[360px]:grid-cols-6 gap-1 text-[11px] text-[#5C6670] mt-0.5 font-mono tabular-nums">
              {[-10, 0, 5, 12, 18, 25].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    setIsAutoSweeping(false);
                    onParamChange('angle_of_attack', val);
                  }}
                  className={`py-1.5 sm:py-0.5 rounded text-center border transition-colors ${
                    Math.abs(params.angle_of_attack - val) < 0.6
                      ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/40 font-semibold'
                      : 'border-transparent hover:text-[#161A1D] hover:bg-[var(--bg)]'
                  }`}
                >
                  {val >= 0 ? `+${val}°` : `${val}°`}
                </button>
              ))}
            </div>
          </div>

          {/* Trailing Edge Flaps */}
          <div className="flex flex-col gap-1.5 pt-2.5 border-t border-[var(--border)]">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="flaps-slider" className="text-[#161A1D] font-semibold">
                Trailing Flap (δf)
              </label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold px-2 py-0.5 rounded bg-[var(--accent-light)]">
                {params.flaps_deg}° {params.flaps_deg > 0 ? '(High-Lift)' : '(Clean)'}
              </span>
            </div>
            <input
              id="flaps-slider"
              type="range"
              min="0"
              max={currentModel.flapCapable ? '35' : '0'}
              step="5"
              disabled={!currentModel.flapCapable}
              value={params.flaps_deg}
              onChange={(e) => onParamChange('flaps_deg', parseInt(e.target.value, 10))}
              className={`w-full h-2 rounded-lg ${
                currentModel.flapCapable ? 'accent-[#1769AA] cursor-pointer bg-[#E4E9ED]' : 'opacity-40 cursor-not-allowed bg-[#E4E9ED]'
              }`}
            />
            {!currentModel.flapCapable && (
              <span className="text-[10px] text-[#5C6670]">
                Flap deflection not available for this geometry
              </span>
            )}
          </div>
        </div>

        {/* Atmospheric Flight Envelope */}
        <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
              <Wind className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
              Atmospheric Envelope
            </span>
          </div>

          {/* Inflow Airspeed */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="airspeed-slider" className="text-[#161A1D] font-semibold">Inflow Airspeed</label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold px-2 py-0.5 rounded bg-[var(--accent-light)]">
                {params.airspeed_kts} kts
              </span>
            </div>
            <input
              id="airspeed-slider"
              type="range"
              min="20"
              max="1200"
              step="10"
              value={params.airspeed_kts}
              onChange={(e) => onParamChange('airspeed_kts', parseInt(e.target.value, 10))}
              className="w-full accent-[#1769AA] cursor-pointer h-2 bg-[#E4E9ED] rounded-lg"
            />
            <div className="flex items-center justify-between text-[10px] text-[#5C6670] font-mono">
              <span>120 kts</span>
              <span>450 kts</span>
              <span>700+ kts</span>
            </div>
          </div>

          {/* Altitude */}
          <div className="flex flex-col gap-1.5 pt-2.5 border-t border-[var(--border)]">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="altitude-slider" className="text-[#161A1D] font-semibold">Test Altitude (ISA)</label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold px-2 py-0.5 rounded bg-[var(--accent-light)]">
                {params.altitude_ft.toLocaleString()} ft
              </span>
            </div>
            <input
              id="altitude-slider"
              type="range"
              min="0"
              max="50000"
              step="1000"
              value={params.altitude_ft}
              onChange={(e) => onParamChange('altitude_ft', parseInt(e.target.value, 10))}
              className="w-full accent-[#1769AA] cursor-pointer h-2 bg-[#E4E9ED] rounded-lg"
            />
            <div className="flex items-center justify-between text-[10px] text-[#5C6670] font-mono">
              <span>Sea Level</span>
              <span>FL350</span>
              <span>FL500</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Visualization Toggles & Fluid Tuning */}
      <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans truncate">
              Flow Overlays
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onTogglePause}
              className={`px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors border ${
                isPaused
                  ? 'bg-[#1769AA] text-white border-[#1769AA]'
                  : 'bg-[var(--bg)] text-[#161A1D] border-[var(--border)] hover:border-[#1769AA]'
              }`}
            >
              {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3" />}
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              onClick={onReset}
              className="p-1.5 rounded-lg bg-[var(--bg)] text-[#5C6670] hover:text-[#161A1D] border border-[var(--border)] hover:border-[#1769AA] transition-colors"
              title="Reset Simulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toggle switches */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
          {[
            { key: 'show_streamlines', label: 'Smoke Lines', desc: 'Vortex ribbons' },
            { key: 'show_heatmap', label: 'CFD Heatmap', desc: 'Cp pressure' },
            { key: 'show_pressure_vectors', label: 'Force Vectors', desc: 'Lift & Drag 3D' },
            { key: 'show_particles', label: 'PIV Particles', desc: 'RK2 streaks' },
            { key: 'show_quiver', label: 'Vector Quiver', desc: 'Velocity grid' },
            { key: 'show_shockwaves', label: 'Mach Cone', desc: 'Shockwave' },
          ].map((item) => {
            const active = params[item.key as keyof SimulationParams] as boolean;
            return (
              <button
                key={item.key}
                onClick={() =>
                  onParamChange(item.key as keyof SimulationParams, !active as never)
                }
                className={`antigravity-card p-2 rounded-xl text-left flex flex-col justify-between transition-all ${
                  active
                    ? '!bg-[var(--accent-light)] !border-[#1769AA] text-[#1769AA]'
                    : 'text-[#5C6670]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[11px] font-bold ${active ? 'text-[#1769AA]' : 'text-[#161A1D]'}`}>{item.label}</span>
                  <div
                    className={`w-2 h-2 rounded-full transition-colors ${
                      active ? 'bg-[#1769AA]' : 'bg-[#D9DEE2]'
                    }`}
                  />
                </div>
                <span className="text-[10px] text-[#5C6670] mt-0.5">{item.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Smoke density & viscosity sliders */}
        <div className="flex flex-col gap-2.5 pt-2.5 border-t border-[var(--border)]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="viscosity-slider" className="text-[#161A1D] font-medium">Kinematic Viscosity (ν)</label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold text-xs">{params.viscosity.toFixed(2)}</span>
            </div>
            <input
              id="viscosity-slider"
              type="range"
              min="0.01"
              max="0.40"
              step="0.01"
              value={params.viscosity}
              onChange={(e) => onParamChange('viscosity', parseFloat(e.target.value))}
              className="w-full accent-[#1769AA] cursor-pointer h-1.5 bg-[#E4E9ED] rounded-lg"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="smoke-slider" className="text-[#161A1D] font-medium">Smoke Density</label>
              <span className="font-mono tabular-nums text-[#1769AA] font-bold text-xs">{params.smoke_density.toFixed(1)}x</span>
            </div>
            <input
              id="smoke-slider"
              type="range"
              min="0.2"
              max="2.5"
              step="0.1"
              value={params.smoke_density}
              onChange={(e) => onParamChange('smoke_density', parseFloat(e.target.value))}
              className="w-full accent-[#1769AA] cursor-pointer h-1.5 bg-[#E4E9ED] rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* 4. One-Click Flight Scenarios */}
      <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
            <Flame className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
            Quick Flight Regimes
          </span>
        </div>

        <div className="grid grid-cols-1 min-[340px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={preset.apply}
              className="antigravity-card p-2.5 rounded-xl text-left transition-all group flex flex-col justify-between"
            >
              <span className="text-xs font-bold text-[#161A1D] group-hover:text-[#1769AA] transition-colors">
                {preset.name}
              </span>
              <span className="text-[10px] text-[#5C6670] mt-0.5 leading-tight">
                {preset.desc}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
