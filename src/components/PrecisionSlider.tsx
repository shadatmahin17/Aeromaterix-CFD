import React from 'react';
import { Minus, Plus } from 'lucide-react';

interface PrecisionSliderProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  subLabel?: string;
  badgeTone?: 'accent' | 'amber' | 'danger' | 'neutral';
  scaleLabels?: string[];
}

export const PrecisionSlider: React.FC<PrecisionSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  disabled = false,
  subLabel,
  badgeTone = 'accent',
  scaleLabels,
}) => {
  const span = Math.max(1e-6, max - min);
  const pct = disabled ? 0 : Math.max(0, Math.min(100, ((value - min) / span) * 100));

  const clampStep = (next: number) => {
    const clamped = Math.max(min, Math.min(max, next));
    const decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
    return Number(clamped.toFixed(decimals));
  };

  const badgeClasses =
    badgeTone === 'danger'
      ? 'bg-red-50 text-red-700 border-red-200'
      : badgeTone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : badgeTone === 'neutral'
      ? 'bg-[var(--bg)] text-[#5C6670] border-[var(--border)]'
      : 'bg-[var(--accent-light)] text-[#1769AA] border-[#1769AA]/25';

  const fillColor = disabled
    ? '#C4CCD3'
    : badgeTone === 'danger'
    ? '#DC2626'
    : badgeTone === 'amber'
    ? '#D97706'
    : '#1769AA';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <label htmlFor={id} className="text-[#161A1D] font-semibold truncate">
            {label}
          </label>
          {subLabel && (
            <span className="text-[10px] text-[#5C6670] font-mono hidden min-[360px]:inline">
              {subLabel}
            </span>
          )}
        </div>

        <span
          className={`font-mono tabular-nums font-bold text-[11px] px-2 py-0.5 rounded-md border shrink-0 ${badgeClasses}`}
        >
          {displayValue}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => onChange(clampStep(value - step))}
          className="w-7 h-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[#1769AA] hover:text-[#1769AA] text-[#5C6670] flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
          aria-label={`Decrease ${label}`}
          title={`Decrease ${label}`}
        >
          <Minus className="w-3 h-3" />
        </button>

        <div className="relative flex-1 flex items-center h-6">
          <div className="w-full h-1.5 rounded-full bg-[#E4E9ED] overflow-hidden pointer-events-none">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{ width: `${pct}%`, backgroundColor: fillColor }}
            />
          </div>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className={`absolute inset-0 w-full m-0 ${
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            }`}
          />
        </div>

        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => onChange(clampStep(value + step))}
          className="w-7 h-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[#1769AA] hover:text-[#1769AA] text-[#5C6670] flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
          aria-label={`Increase ${label}`}
          title={`Increase ${label}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {scaleLabels && scaleLabels.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-[#5C6670] font-mono px-8">
          {scaleLabels.map((txt, idx) => (
            <span key={idx}>{txt}</span>
          ))}
        </div>
      )}
    </div>
  );
};
