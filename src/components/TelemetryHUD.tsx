import React, { useState, useRef, useEffect } from 'react';
import { AeroTelemetry, AircraftModelType, SimulationParams } from '../types/aerodynamics';
import { AIRCRAFT_MODELS } from '../utils/airfoilGenerators';
import {
  downloadTelemetryJSON,
  downloadTelemetryCSV,
  ExportDataPayload,
} from '../utils/telemetryExport';
import { 
  Gauge, 
  Wind, 
  Activity, 
  ArrowUpRight, 
  ShieldAlert, 
  CheckCircle2, 
  Download, 
  ArrowDown, 
  ArrowUp,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Flame,
  FileCode2,
  FileSpreadsheet
} from 'lucide-react';

interface TelemetryHUDProps {
  telemetry: AeroTelemetry;
  aoaDeg: number;
  modelType: AircraftModelType;
  params: SimulationParams;
}

export const TelemetryHUD: React.FC<TelemetryHUDProps> = ({
  telemetry,
  aoaDeg,
  modelType,
  params,
}) => {
  const [showLiftDetails, setShowLiftDetails] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentModel = AIRCRAFT_MODELS[modelType];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  const formatForce = (newtons: number) => {
    if (Math.abs(newtons) >= 1e6) return `${(newtons / 1e6).toFixed(2)} MN`;
    if (Math.abs(newtons) >= 1e3) return `${(newtons / 1e3).toFixed(1)} kN`;
    return `${newtons} N`;
  };

  // Lift Generation Physics Calculation
  const suctionPercentage = telemetry.isStalled
    ? Math.max(25, 45 - Math.max(0, aoaDeg - currentModel.stallAngle) * 2)
    : Math.min(88, 72 + Math.max(0, aoaDeg) * 0.5);
  const compressionPercentage = 100 - suctionPercentage;

  // Downwash angle epsilon = 2 * CL / (pi * AR) in radians
  const aspectRatio = Math.pow(currentModel.wingspan, 2) / (currentModel.wingspan * currentModel.chord);
  const downwashRad = (2 * Math.max(0, telemetry.cl)) / (Math.PI * Math.max(2, aspectRatio));
  const downwashDeg = (downwashRad * 180) / Math.PI;

  const exportPayload: ExportDataPayload = {
    telemetry,
    aoaDeg,
    modelType,
    params,
    suctionPercentage,
    compressionPercentage,
    downwashDeg,
  };

  const handleExportJSON = () => {
    downloadTelemetryJSON(exportPayload);
    setExportSuccessMsg('JSON Snapshot Saved');
    setShowExportMenu(false);
    setTimeout(() => {
      setExportSuccessMsg(null);
    }, 3500);
  };

  const handleExportCSV = () => {
    downloadTelemetryCSV(exportPayload);
    setExportSuccessMsg('CSV Dataset Saved');
    setShowExportMenu(false);
    setTimeout(() => {
      setExportSuccessMsg(null);
    }, 3500);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      {/* HUD Header Toolbar */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="w-3.5 h-3.5 text-[#1769AA] shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] truncate">
            Telemetry &amp; Forces
          </span>
          {exportSuccessMsg && (
            <span className="ml-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>{exportSuccessMsg}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowLiftDetails((prev) => !prev)}
            className="px-2 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[#1769AA] text-[11px] font-semibold text-[#161A1D] flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
            title="Toggle lift breakdown parameters"
          >
            <SlidersHorizontal className="w-3 h-3 text-[#1769AA]" />
            <span>{showLiftDetails ? 'Less' : 'Lift Details'}</span>
            {showLiftDetails ? <ChevronUp className="w-3 h-3 text-[#5C6670]" /> : <ChevronDown className="w-3 h-3 text-[#5C6670]" />}
          </button>

          {/* Dedicated Export Dropdown Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="px-2.5 py-1 rounded-lg bg-[#1769AA] hover:bg-[#145a92] text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              title="Export flight telemetry and aerodynamic dataset"
              aria-expanded={showExportMenu}
              aria-haspopup="true"
            >
              <Download className="w-3 h-3" />
              <span>Export</span>
              <ChevronDown className={`w-3 h-3 text-white/80 transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xl p-1.5 z-50 flex flex-col gap-1">
                <div className="px-2 py-1 border-b border-[var(--border)]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#5C6670]">
                    Export Flight Data
                  </span>
                </div>

                <button
                  onClick={handleExportJSON}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--bg)] flex items-start gap-2.5 text-[#161A1D] group transition-colors cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                    <FileCode2 className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-[#161A1D] flex items-center gap-1.5">
                      JSON Snapshot
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200">.json</span>
                    </span>
                    <span className="text-[10px] text-[#5C6670] leading-tight">
                      Full flight conditions, forces &amp; polar sweep envelope
                    </span>
                  </div>
                </button>

                <button
                  onClick={handleExportCSV}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--bg)] flex items-start gap-2.5 text-[#161A1D] group transition-colors cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-[#161A1D] flex items-center gap-1.5">
                      CSV Dataset
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">.csv</span>
                    </span>
                    <span className="text-[10px] text-[#5C6670] leading-tight">
                      Spreadsheet table with metrics &amp; AoA sweep data
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6 Primary Telemetry Metric Cards */}
      <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
        {/* 1. Lift Coefficient (CL) */}
        <div className="antigravity-card p-2.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Lift Coeff</span>
            <div className="w-5 h-5 rounded-md bg-[var(--accent-light)] border border-[#1769AA]/20 flex items-center justify-center text-[#1769AA]">
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#161A1D] font-mono tabular-nums">
              {telemetry.cl.toFixed(2)}
            </span>
            <span className="text-[11px] font-mono text-[#1769AA] font-bold">CL</span>
          </div>
          <div className="text-[10px] text-[#5C6670] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span>Force:</span>
            <span className="font-mono tabular-nums text-[#1769AA] font-semibold">{formatForce(telemetry.lift_N)}</span>
          </div>
        </div>

        {/* 2. Drag Coefficient (CD) */}
        <div className="antigravity-card p-2.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Drag Coeff</span>
            <div className="w-5 h-5 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <Wind className="w-3 h-3" />
            </div>
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#161A1D] font-mono tabular-nums">
              {telemetry.cd.toFixed(3)}
            </span>
            <span className="text-[11px] font-mono text-amber-700 font-bold">CD</span>
          </div>
          <div className="text-[10px] text-[#5C6670] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span>Force:</span>
            <span className="font-mono tabular-nums text-amber-700 font-semibold">{formatForce(telemetry.drag_N)}</span>
          </div>
        </div>

        {/* 3. Aerodynamic Efficiency (L/D) */}
        <div className="antigravity-card p-2.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Efficiency</span>
            <div className="w-5 h-5 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <Activity className="w-3 h-3" />
            </div>
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-700 font-mono tabular-nums">
              {telemetry.ldRatio.toFixed(1)}
            </span>
            <span className="text-[11px] font-mono text-emerald-700 font-bold">L/D</span>
          </div>
          <div className="text-[10px] text-[#5C6670] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span>Glide:</span>
            <span className="font-mono tabular-nums text-emerald-700 font-semibold">{telemetry.ldRatio > 0 ? `${telemetry.ldRatio.toFixed(1)}:1` : '0:1'}</span>
          </div>
        </div>

        {/* 4. Speed & Mach Regime */}
        <div className="antigravity-card p-2.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Mach Regime</span>
            <div className="w-5 h-5 rounded-md bg-[var(--accent-light)] border border-[#1769AA]/20 flex items-center justify-center text-[#1769AA]">
              <Gauge className="w-3 h-3" />
            </div>
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-xl sm:text-2xl font-bold tracking-tight font-mono tabular-nums ${telemetry.mach >= 1.0 ? 'text-amber-700' : 'text-[#161A1D]'}`}>
              M {telemetry.mach.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-[#5C6670] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span>Speed:</span>
            <span className="font-mono tabular-nums text-[#1769AA] font-semibold">{params.airspeed_kts} kts</span>
          </div>
        </div>

        {/* 5. Dynamic Pressure (q) */}
        <div className="antigravity-card p-2.5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Dyn Pressure</span>
            <div className="w-5 h-5 rounded-md bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center text-[#5C6670]">
              <Flame className="w-3 h-3" />
            </div>
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#161A1D] font-mono tabular-nums">
              {(telemetry.dynamic_pressure_pa / 1000).toFixed(1)}
            </span>
            <span className="text-[11px] font-mono text-[#5C6670] font-bold">kPa</span>
          </div>
          <div className="text-[10px] text-[#5C6670] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span>Altitude:</span>
            <span className="font-mono tabular-nums text-[#161A1D] font-medium">{params.altitude_ft.toLocaleString()} ft</span>
          </div>
        </div>

        {/* 6. Flow State & Stall Margin */}
        <div className={`antigravity-card p-2.5 rounded-xl flex flex-col justify-between ${
          telemetry.isStalled
            ? '!border-red-300 !bg-red-50'
            : telemetry.stallMargin < 4
            ? '!border-amber-300 !bg-amber-50'
            : ''
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider font-sans text-[#5C6670]">Flow State</span>
            {telemetry.isStalled ? (
              <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            )}
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-sm sm:text-base font-bold tracking-tight font-sans truncate ${
              telemetry.isStalled ? 'text-red-700' : 'text-[#161A1D]'
            }`}>
              {telemetry.flowState}
            </span>
          </div>
          <div className="text-[10px] flex items-center justify-between pt-1.5 border-t border-[var(--border)]">
            <span className="text-[#5C6670]">Stall Margin:</span>
            <span className={`font-mono tabular-nums font-semibold ${
              telemetry.stallMargin <= 0 ? 'text-red-700' : telemetry.stallMargin < 3 ? 'text-amber-700' : 'text-emerald-700'
            }`}>
              {telemetry.stallMargin > 0 ? `+${telemetry.stallMargin.toFixed(1)}°` : `${telemetry.stallMargin.toFixed(1)}°`}
            </span>
          </div>
        </div>
      </div>

      {/* LIFT GENERATION MECHANICS BREAKDOWN PANEL */}
      {showLiftDetails && (
        <div className="antigravity-glass p-3.5 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between gap-1 border-b border-[var(--border)] pb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-[var(--accent-light)] border border-[#1769AA]/25 flex items-center justify-center text-[#1769AA]">
                <ArrowUp className="w-3 h-3" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#161A1D] font-sans">
                Lift Distribution
              </span>
            </div>
            <div className="text-[11px] bg-[var(--accent-light)] px-2 py-0.5 rounded font-mono tabular-nums text-[#1769AA] font-semibold">
              {formatForce(telemetry.lift_N)}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {/* 1. Pressure Distribution Split: Suction vs Compression */}
            <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#161A1D]">
                  Surface Pressure Source
                </span>
                <span className="text-[10px] text-[#5C6670]">Upper / Lower</span>
              </div>

              {/* Stacked Percentage Bar */}
              <div className="flex flex-col gap-1.5">
                <div className="w-full h-3 rounded-full overflow-hidden flex bg-[var(--surface)] border border-[var(--border)] p-0.5">
                  <div 
                    style={{ width: `${suctionPercentage}%` }} 
                    className={`h-full rounded-full transition-all duration-300 ${telemetry.isStalled ? 'bg-red-500' : 'bg-[#1769AA]'}`}
                    title={`Upper Surface Suction: ${suctionPercentage.toFixed(1)}%`}
                  />
                  <div 
                    style={{ width: `${compressionPercentage}%` }} 
                    className="h-full rounded-full bg-amber-500 transition-all duration-300 ml-0.5"
                    title={`Lower Surface Compression: ${compressionPercentage.toFixed(1)}%`}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                  <span className={telemetry.isStalled ? 'text-red-700 font-semibold' : 'text-[#1769AA] font-semibold'}>
                    Suction: {suctionPercentage.toFixed(1)}%
                  </span>
                  <span className="text-amber-700 font-semibold">
                    Compression: {compressionPercentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Downwash Momentum Deflection & Net Climb Vector */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex flex-col justify-between">
                <div className="flex items-center gap-1.5 text-[#5C6670]">
                  <ArrowDown className="w-3 h-3 text-[#1769AA]" />
                  <span className="text-[10px] font-medium">Downwash (ε):</span>
                </div>
                <span className="font-mono tabular-nums text-[#1769AA] font-bold text-sm mt-1">
                  {downwashDeg.toFixed(1)}°
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex flex-col justify-between">
                <div className="flex items-center gap-1.5 text-[#5C6670]">
                  <ArrowUp className="w-3 h-3 text-emerald-600" />
                  <span className="text-[10px] font-medium">Vertical Lift:</span>
                </div>
                <span className={`font-mono tabular-nums font-bold text-sm mt-1 ${
                  telemetry.lift_N > 0 && !telemetry.isStalled ? 'text-emerald-700' : 'text-amber-700'
                }`}>
                  {formatForce(telemetry.lift_N)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
