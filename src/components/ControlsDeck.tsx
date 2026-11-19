import React, { useState, useEffect } from 'react';
import { SimulationParams, AircraftModelType } from '../types/aerodynamics';
import { AIRCRAFT_MODELS, getAtmosphere } from '../utils/airfoilGenerators';
import { PrecisionSlider } from './PrecisionSlider';
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
  Check,
  Waves,
  Gauge,
  ArrowUpRight,
  Zap,
  Sparkles,
  Grid3x3,
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
  onOpenModelInspector,
}) => {
  const currentModel = AIRCRAFT_MODELS[params.modelType];
  const [isAutoSweeping, setIsAutoSweeping] = useState(false);
  const sweepDirRef = React.useRef<number>(1);

  const atmo = getAtmosphere(params.altitude_ft);
  const machEstimate = (params.airspeed_kts * 0.514444) / atmo.speedOfSound_ms;
  const isStalledEstimate = params.angle_of_attack >= currentModel.stallAngle;

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
  const presets: { name: string; tag: string; desc: string; apply: () => void }[] = [
    {
      name: 'High-Speed Cruise',
      tag: 'M 0.85 · Clean',
      desc: 'Optimal L/D glide configuration',
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
      tag: 'Flaps 20°',
      desc: 'High-lift takeoff configuration',
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
      tag: 'α 21° · Wake',
      desc: 'Boundary separation & shedding',
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
      name: 'Supersonic Dash',
      tag: 'M 1.8 · Shock',
      desc: 'Oblique Mach cone & wave drag',
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
      name: 'Fighter High-Alpha',
      tag: 'F-22 · α 18°',
      desc: 'Chined vortex lift at high AoA',
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
      tag: 'Bluff Body',
      desc: 'Symmetric von Kármán wake',
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

  const getModelFileSize = (type: AircraftModelType) => {
    if (type === 'airliner') return '3.9 MB';
    if (type === 'concorde') return '755 KB';
    if (type === 'naca2412') return '11.4 KB';
    return '741 KB';
  };

  return (
    <div className="w-full flex flex-col gap-3.5">
      {/* 1. Aircraft Model Selection & Airframe Configuration */}
      <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
              <Plane className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans truncate">
              Airframe &amp; CAD
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#1769AA] bg-[var(--accent-light)] border border-[#1769AA]/20 px-2 py-0.5 rounded-md font-semibold truncate">
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
                className={`antigravity-card p-2.5 rounded-xl text-left flex flex-col justify-between transition-all cursor-pointer ${
                  isSelected
                    ? '!bg-[var(--accent-light)] !border-[#1769AA] ring-1 ring-[#1769AA]/25'
                    : 'text-[#161A1D]'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span
                    className={`text-[10px] font-mono font-semibold ${
                      isSelected ? 'text-[#1769AA]' : 'text-[#5C6670]'
                    }`}
                  >
                    {config.category}
                    {config.hasGlbModel ? ' · GLB' : ''}
                  </span>
                  {isSelected && (
                    <span className="w-4 h-4 rounded-full bg-[#1769AA] text-white flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs font-bold leading-tight ${
                    isSelected ? 'text-[#1769AA]' : 'text-[#161A1D]'
                  }`}
                >
                  {config.name.split(' (')[0]}
                </span>
                <span className="text-[10px] text-[#5C6670] font-mono tabular-nums truncate mt-1">
                  Stall: {config.stallAngle > 0 ? `${config.stallAngle}°` : 'N/A'}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3D GLB Asset Configuration */}
        {currentModel.hasGlbModel && (
          <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--border)] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
                <Box className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#161A1D] truncate">
                    3D GLB Mesh
                  </span>
                  <span className="text-[10px] font-mono text-[#1769AA] font-semibold shrink-0">
                    {getModelFileSize(params.modelType)}
                  </span>
                </div>
                <p className="text-[10px] text-[#5C6670] truncate">
                  Real vertex normal field &amp; Cp mapping
                </p>
              </div>
            </div>

            {onOpenModelInspector && (
              <button
                onClick={onOpenModelInspector}
                className="px-2.5 py-1.5 rounded-lg bg-[#1769AA] hover:bg-[#145a92] text-white font-semibold text-[11px] transition-colors flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
              >
                <Box className="w-3.5 h-3.5" />
                <span>Inspect CAD</span>
              </button>
            )}
          </div>
        )}

        <p className="text-[11px] text-[#5C6670] leading-relaxed border-t border-[var(--border)] pt-2">
          {currentModel.description}
        </p>
      </div>

      {/* 2. Interactive Primary Flight Sliders */}
      <div className="flex flex-col gap-3.5">
        {/* Attitude & Control Surfaces */}
        <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
                <Compass className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans truncate">
                Attitude &amp; Flaps
              </span>
            </div>

            <button
              onClick={() => setIsAutoSweeping((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors border shrink-0 cursor-pointer ${
                isAutoSweeping
                  ? 'bg-[#1769AA] text-white border-[#1769AA] shadow-xs'
                  : 'bg-[var(--bg)] text-[#5C6670] hover:text-[#161A1D] border-[var(--border)]'
              }`}
              title="Continuously sweep Angle of Attack dynamically"
            >
              <Repeat className={`w-3 h-3 ${isAutoSweeping ? 'animate-spin' : ''}`} />
              <span>{isAutoSweeping ? 'Sweeping' : 'Auto Sweep'}</span>
            </button>
          </div>

          {/* Angle of Attack (AoA) */}
          <div className="flex flex-col gap-2">
            <PrecisionSlider
              id="aoa-slider"
              label="Angle of Attack"
              subLabel="(α)"
              min={-20}
              max={35}
              step={0.5}
              value={params.angle_of_attack}
              displayValue={`${params.angle_of_attack >= 0 ? '+' : ''}${params.angle_of_attack.toFixed(1)}°${
                isStalledEstimate && currentModel.stallAngle > 0 ? ' STALL' : ''
              }`}
              badgeTone={isStalledEstimate && currentModel.stallAngle > 0 ? 'danger' : 'accent'}
              onChange={(val) => {
                setIsAutoSweeping(false);
                onParamChange('angle_of_attack', val);
              }}
            />

            <div className="grid grid-cols-3 min-[360px]:grid-cols-6 gap-1 text-[11px] text-[#5C6670] font-mono tabular-nums">
              {[-10, 0, 5, 12, 18, 25].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    setIsAutoSweeping(false);
                    onParamChange('angle_of_attack', val);
                  }}
                  className={`py-1.5 sm:py-1 rounded-md text-center border transition-colors cursor-pointer ${
                    Math.abs(params.angle_of_attack - val) < 0.6
                      ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/45 font-bold'
                      : 'bg-[var(--bg)] border-[var(--border)]/60 hover:text-[#161A1D] hover:border-[#1769AA]/40'
                  }`}
                >
                  {val >= 0 ? `+${val}°` : `${val}°`}
                </button>
              ))}
            </div>
          </div>

          {/* Trailing Edge Flaps */}
          <div className="flex flex-col gap-2 pt-2.5 border-t border-[var(--border)]">
            <PrecisionSlider
              id="flaps-slider"
              label="Trailing Flap"
              subLabel="(δf)"
              min={0}
              max={currentModel.flapCapable ? 35 : 0}
              step={5}
              disabled={!currentModel.flapCapable}
              value={params.flaps_deg}
              displayValue={
                currentModel.flapCapable
                  ? `${params.flaps_deg}° ${params.flaps_deg > 0 ? 'High-Lift' : 'Clean'}`
                  : 'Fixed'
              }
              badgeTone={
                !currentModel.flapCapable
                  ? 'neutral'
                  : params.flaps_deg > 0
                  ? 'amber'
                  : 'accent'
              }
              onChange={(val) => onParamChange('flaps_deg', Math.round(val))}
            />

            {currentModel.flapCapable ? (
              <div className="grid grid-cols-4 gap-1 text-[11px] font-mono tabular-nums">
                {[0, 10, 20, 35].map((deg) => (
                  <button
                    key={deg}
                    onClick={() => onParamChange('flaps_deg', deg)}
                    className={`py-1 rounded-md text-center border transition-colors cursor-pointer ${
                      params.flaps_deg === deg
                        ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/45 font-bold'
                        : 'bg-[var(--bg)] border-[var(--border)]/60 text-[#5C6670] hover:text-[#161A1D]'
                    }`}
                  >
                    {deg === 0 ? 'Clean' : `${deg}°`}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-[10px] text-[#5C6670]">
                Flap deflection not available on {currentModel.name.split(' (')[0]}
              </span>
            )}
          </div>
        </div>

        {/* Atmospheric Flight Envelope */}
        <div className="antigravity-glass p-3 sm:p-4 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA] shrink-0">
                <Wind className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans truncate">
                Atmospheric Envelope
              </span>
            </div>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                machEstimate >= 1.0
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-[var(--bg)] text-[#5C6670] border-[var(--border)]'
              }`}
            >
              M {machEstimate.toFixed(2)}
            </span>
          </div>

          {/* Inflow Airspeed */}
          <div className="flex flex-col gap-2">
            <PrecisionSlider
              id="airspeed-slider"
              label="Inflow Airspeed"
              min={20}
              max={1200}
              step={10}
              value={params.airspeed_kts}
              displayValue={`${params.airspeed_kts} kts`}
              badgeTone={machEstimate >= 1.0 ? 'amber' : 'accent'}
              onChange={(val) => onParamChange('airspeed_kts', Math.round(val))}
            />
            <div className="grid grid-cols-4 gap-1 text-[10px] font-mono tabular-nums">
              {[
                { label: '150 kts', val: 150 },
                { label: '350 kts', val: 350 },
                { label: '550 kts', val: 550 },
                { label: '950 kts', val: 950 },
              ].map((item) => (
                <button
                  key={item.val}
                  onClick={() => onParamChange('airspeed_kts', item.val)}
                  className={`py-1 rounded-md text-center border transition-colors cursor-pointer ${
                    Math.abs(params.airspeed_kts - item.val) <= 10
                      ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/45 font-bold'
                      : 'bg-[var(--bg)] border-[var(--border)]/60 text-[#5C6670] hover:text-[#161A1D]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Altitude */}
          <div className="flex flex-col gap-2 pt-2.5 border-t border-[var(--border)]">
            <PrecisionSlider
              id="altitude-slider"
              label="Test Altitude"
              subLabel="(ISA)"
              min={0}
              max={50000}
              step={1000}
              value={params.altitude_ft}
              displayValue={`${params.altitude_ft.toLocaleString()} ft`}
              onChange={(val) => onParamChange('altitude_ft', Math.round(val))}
            />
            <div className="grid grid-cols-4 gap-1 text-[10px] font-mono tabular-nums">
              {[
                { label: 'Sea Lvl', val: 0 },
                { label: 'FL150', val: 15000 },
                { label: 'FL350', val: 35000 },
                { label: 'FL500', val: 50000 },
              ].map((item) => (
                <button
                  key={item.val}
                  onClick={() => onParamChange('altitude_ft', item.val)}
                  className={`py-1 rounded-md text-center border transition-colors cursor-pointer ${
                    params.altitude_ft === item.val
                      ? 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/45 font-bold'
                      : 'bg-[var(--bg)] border-[var(--border)]/60 text-[#5C6670] hover:text-[#161A1D]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
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

          <div className="inline-flex items-center gap-1 shrink-0">
            <button
              onClick={onTogglePause}
              className={`px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors border cursor-pointer ${
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
              className="p-1.5 rounded-lg bg-[var(--bg)] text-[#5C6670] hover:text-[#161A1D] border border-[var(--border)] hover:border-[#1769AA] transition-colors cursor-pointer"
              title="Reset Simulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Toggle switches */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
          {[
            { key: 'show_streamlines', label: 'Smoke Lines', desc: 'Vortex ribbons', icon: Waves },
            { key: 'show_heatmap', label: 'CFD Heatmap', desc: 'Cp pressure', icon: Gauge },
            { key: 'show_pressure_vectors', label: 'Force Vectors', desc: 'Lift & Drag 3D', icon: ArrowUpRight },
            { key: 'show_particles', label: 'PIV Particles', desc: 'RK2 streaks', icon: Sparkles },
            { key: 'show_quiver', label: 'Vector Quiver', desc: 'Velocity grid', icon: Grid3x3 },
            { key: 'show_shockwaves', label: 'Mach Cone', desc: 'Shockwave', icon: Zap },
          ].map((item) => {
            const active = params[item.key as keyof SimulationParams] as boolean;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() =>
                  onParamChange(item.key as keyof SimulationParams, !active as never)
                }
                className={`antigravity-card p-2.5 rounded-xl text-left flex flex-col justify-between gap-1.5 transition-all cursor-pointer ${
                  active
                    ? '!bg-[var(--accent-light)] !border-[#1769AA] text-[#1769AA]'
                    : 'text-[#5C6670]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center ${
                      active
                        ? 'bg-[#1769AA] text-white'
                        : 'bg-[var(--bg)] text-[#5C6670] border border-[var(--border)]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <div
                    className={`w-6 h-3.5 rounded-full p-0.5 transition-colors flex items-center ${
                      active ? 'bg-[#1769AA] justify-end' : 'bg-[#D9DEE2] justify-start'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-white shadow-xs" />
                  </div>
                </div>
                <div>
                  <div className={`text-[11px] font-bold leading-tight ${active ? 'text-[#1769AA]' : 'text-[#161A1D]'}`}>
                    {item.label}
                  </div>
                  <div className="text-[10px] text-[#5C6670] mt-0.5 leading-tight">{item.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Smoke density & viscosity sliders */}
        <div className="flex flex-col gap-3 pt-2.5 border-t border-[var(--border)]">
          <PrecisionSlider
            id="viscosity-slider"
            label="Kinematic Viscosity"
            subLabel="(ν)"
            min={0.01}
            max={0.4}
            step={0.01}
            value={params.viscosity}
            displayValue={params.viscosity.toFixed(2)}
            onChange={(val) => onParamChange('viscosity', val)}
          />

          <PrecisionSlider
            id="smoke-slider"
            label="Smoke Density"
            min={0.2}
            max={2.5}
            step={0.1}
            value={params.smoke_density}
            displayValue={`${params.smoke_density.toFixed(1)}x`}
            onChange={(val) => onParamChange('smoke_density', val)}
          />
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
              className="antigravity-card p-2.5 rounded-xl text-left transition-all group flex flex-col justify-between gap-1 cursor-pointer"
            >
              <span className="inline-block w-fit text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[#1769AA]">
                {preset.tag}
              </span>
              <span className="text-xs font-bold text-[#161A1D] group-hover:text-[#1769AA] transition-colors leading-tight">
                {preset.name}
              </span>
              <span className="text-[10px] text-[#5C6670] leading-tight">
                {preset.desc}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
