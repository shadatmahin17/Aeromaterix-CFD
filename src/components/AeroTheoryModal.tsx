import React from 'react';
import { X, BookOpen, Compass, AlertTriangle, Wind, Zap } from 'lucide-react';

interface AeroTheoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AeroTheoryModal: React.FC<AeroTheoryModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0D1114]/60 backdrop-blur-sm">
      <div 
        className="w-full max-w-3xl max-h-[90vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)] sticky top-0">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-[#1769AA]" />
            <h2 className="text-base font-bold text-[#161A1D] tracking-wide font-sans">
              Aerodynamics &amp; Vortex Flow Physics Guide
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#5C6670] hover:text-[#161A1D] hover:bg-[var(--bg)] transition-colors"
            aria-label="Close guide"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto space-y-5 text-sm text-[#5C6670] leading-relaxed font-sans custom-scrollbar">
          {/* Section 1: Vortex & Vertex Flow Law */}
          <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-[#1769AA] font-semibold mb-2">
              <Compass className="w-4 h-4" />
              <h3>1. Biot-Savart Vortex Lattice &amp; Surface Vertex Boundary</h3>
            </div>
            <p className="text-[#5C6670] mb-2.5">
              Lift is produced by bound circulation (Γ) along the wing quarter-chord paired with downward momentum deflection (downwash) and surface pressure imbalance:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-[#5C6670] pl-1">
              <li>
                <strong className="text-[#161A1D]">Biot-Savart Vortex Filaments:</strong> A 6-panel horseshoe vortex lattice induces velocity via finite vortex filaments with Lamb-Oseen viscous core regularization driven by kinematic viscosity (ν).
              </li>
              <li>
                <strong className="text-[#161A1D]">Real Vertex Tangential Slip:</strong> Flow samples the 3D distance and outward normal field extracted directly from the aircraft mesh vertices to enforce no-penetration boundary slip.
              </li>
              <li>
                <strong className="text-[#161A1D]">Kutta Condition:</strong> Flow leaves the sharp trailing edge smoothly, locking in bound circulation (Γ) and trailing wingtip vortices.
              </li>
            </ul>
          </div>

          {/* Section 2: Aerodynamic Stall */}
          <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
              <AlertTriangle className="w-4 h-4" />
              <h3>2. Aerodynamic Stall &amp; Boundary Layer Separation</h3>
            </div>
            <p className="text-[#5C6670] mb-2">
              A stall is a loss of lift caused by exceeding the <strong className="text-[#161A1D]">critical angle of attack</strong> (α_crit ≈ 14° - 18°):
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-[#5C6670] pl-1">
              <li>
                As α increases, air on the upper surface encounters a harsh <strong className="text-[#161A1D]">adverse pressure gradient</strong> toward the trailing edge.
              </li>
              <li>
                The slowed boundary layer separates from the wing skin, shedding unsteady von Kármán wake vortices behind the trailing edge.
              </li>
              <li>
                Suction collapses, causing a sharp drop in CL and a surge in separation drag (CD).
              </li>
            </ul>
          </div>

          {/* Section 3: Supersonic Flow & Shockwaves */}
          <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-amber-700 font-semibold mb-2">
              <Zap className="w-4 h-4" />
              <h3>3. Transonic Flight, Mach Numbers &amp; Shockwaves</h3>
            </div>
            <p className="text-[#5C6670] mb-2">
              The <strong className="text-[#161A1D]">Mach number</strong> is the ratio of aircraft speed to the local speed of sound (M = V / a):
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-[#5C6670] pl-1">
              <li>
                <strong className="text-[#161A1D]">Subsonic (M &lt; 0.8):</strong> Pressure disturbances propagate ahead of the aircraft, smoothly parting the air.
              </li>
              <li>
                <strong className="text-[#161A1D]">Transonic (0.8 ≤ M ≤ 1.2):</strong> Local airflow over the wing crest accelerates to supersonic speeds, causing normal shockwaves and wave drag.
              </li>
              <li>
                <strong className="text-[#161A1D]">Supersonic (M &gt; 1.0):</strong> Pressure disturbances coalesce into an oblique <strong className="text-[#161A1D]">Mach Cone</strong> with angle μ = arcsin(1/M).
              </li>
            </ul>
          </div>

          {/* Section 4: Key Formulas */}
          <div className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
            <div className="flex items-center gap-2 text-[#1769AA] font-semibold mb-2">
              <Wind className="w-4 h-4" />
              <h3>4. Governing Aerodynamic Equations</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <span className="text-[#5C6670] block mb-1 font-sans">Lift Equation:</span>
                <span className="text-[#1769AA] font-bold">L = ½ · ρ · V² · S · CL</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <span className="text-[#5C6670] block mb-1 font-sans">Drag Polar:</span>
                <span className="text-amber-700 font-bold">CD = CD0 + (CL² / π·e·AR)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <span className="text-[#5C6670] block mb-1 font-sans">Kutta-Joukowski Circulation:</span>
                <span className="text-emerald-700 font-bold">Γ = ½ · V∞ · c · CL</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <span className="text-[#5C6670] block mb-1 font-sans">Bernoulli Pressure:</span>
                <span className="text-[#161A1D] font-bold">Cp = 1 - (V / V∞)²</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--border)] bg-[var(--surface)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#1769AA] hover:bg-[#145a92] text-white text-xs font-semibold transition-colors"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
