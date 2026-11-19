import { AircraftModelType } from '../types/aerodynamics';
import { Vertex3D } from '../utils/aircraft3DGeometry';
import { AircraftSurfaceField, SpanSectionInfo, SurfaceSample } from './AircraftSurfaceField';

export interface Fluid3DParams {
  modelType: AircraftModelType;
  aoaDeg: number;
  airspeed_kts: number;
  mach: number;
  altitude_ft: number;
  flapsDeg: number;
  viscosity?: number;
  isStalled: boolean;
  cl: number;
  cd: number;
  timeSec?: number;
  surfaceField?: AircraftSurfaceField | null;
}

export interface Velocity3DResult {
  u: number; // downstream (+X)
  v: number; // vertical (+Y)
  w: number; // spanwise (+Z)
  speed: number;
  pressureCoeff: number; // Cp = 1 - (V / V_inf)^2
  vorticity: number; // induced vortex magnitude
  isSeparated: boolean;
}

// Reusable scratch objects to prevent per-frame GC allocations in 60fps particle loops
const _surfSample: SurfaceSample = { dist: 0, nx: 0, ny: 1, nz: 0, inside: false };
const _spanInfo: SpanSectionInfo = { leX: 0, teX: 0, quarterChordX: 0, chord: 1, yMid: 0, thickness: 0.3 };
const _bsOut = { u: 0, v: 0, w: 0 };

/**
 * Evaluates the analytical Biot-Savart induced velocity of a finite straight vortex filament A -> B
 * with Vatistas/Lamb-Oseen viscous core regularization (coreRadius).
 *
 *   V_ind = (Gamma / (4 * pi)) * ((r1 x r2) / (|r1 x r2|^2 + rc^2 * |dl|^2)) * (dl . r1/|r1| - dl . r2/|r2|)
 */
function addBiotSavartSegment(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  gamma: number,
  coreRadius: number,
  out: { u: number; v: number; w: number }
): number {
  const r1x = px - ax;
  const r1y = py - ay;
  const r1z = pz - az;

  const r2x = px - bx;
  const r2y = py - by;
  const r2z = pz - bz;

  const r1 = Math.hypot(r1x, r1y, r1z);
  const r2 = Math.hypot(r2x, r2y, r2z);
  if (r1 < 1e-4 || r2 < 1e-4) return 0;

  const dlx = bx - ax;
  const dly = by - ay;
  const dlz = bz - az;
  const dlSq = dlx * dlx + dly * dly + dlz * dlz;
  if (dlSq < 1e-6) return 0;

  // Cross product r1 x r2
  const cx = r1y * r2z - r1z * r2y;
  const cy = r1z * r2x - r1x * r2z;
  const cz = r1x * r2y - r1y * r2x;
  const crossSq = cx * cx + cy * cy + cz * cz;

  const denom = crossSq + coreRadius * coreRadius * dlSq;
  if (denom < 1e-6) return 0;

  const dot1 = (dlx * r1x + dly * r1y + dlz * r1z) / r1;
  const dot2 = (dlx * r2x + dly * r2y + dlz * r2z) / r2;
  const factor = (gamma / (4 * Math.PI)) * ((dot1 - dot2) / denom);

  const du = cx * factor;
  const dv = cy * factor;
  const dw = cz * factor;

  out.u += du;
  out.v += dv;
  out.w += dw;

  return Math.hypot(du, dv, dw);
}

/**
 * 3D Aerodynamic Fluid Dynamics Engine (Vortex Flow Law + Real Vertex Boundary Law)
 *
 * Combines:
 *  1. Biot-Savart 3D Horseshoe Vortex Lattice (Kutta-Joukowski bound circulation,
 *     trailing vortex sheet, Lamb-Oseen diffused wingtip vortices, and delta leading-edge vortices).
 *  2. C1-Smooth Real Mesh Vertex Surface Field (no-penetration tangential slip along grad d).
 *  3. Viscous boundary layer separation, stall wake shedding, and Mach oblique shock deflection.
 */
export class FluidDynamics3D {
  public static getVelocity(
    p: Vertex3D,
    params: Fluid3DParams
  ): Velocity3DResult {
    const {
      modelType,
      aoaDeg,
      airspeed_kts,
      mach,
      flapsDeg,
      viscosity = 0.1,
      isStalled,
      cl,
      timeSec = 0,
      surfaceField = null,
    } = params;

    // Free-stream speed normalized to wind tunnel simulation scale
    const vInf = Math.max(0.4, (airspeed_kts / 350) * 1.2);
    const aoaRad = (aoaDeg * Math.PI) / 180;
    const sinA = Math.sin(aoaRad);
    const cosA = Math.cos(aoaRad);

    // Body-frame coordinates matching rendered rotation.z = -aoaRad:
    // Forward (body -> world): wx = bx*cosA + by*sinA, wy = -bx*sinA + by*cosA
    // Inverse (world -> body): bx = p.x*cosA - p.y*sinA, by = p.x*sinA + p.y*cosA
    const bx = p.x * cosA - p.y * sinA;
    const by = p.x * sinA + p.y * cosA;
    const bz = p.z;

    let u = vInf;
    let v = 0;
    let w = 0;
    let vorticity = 0;
    let isSeparated = false;

    // -------------------------------------------------------------------------
    // 1. BLUFF BODY CYLINDER (Doublet + von Kármán Vortex Street)
    // -------------------------------------------------------------------------
    if (modelType === 'cylinder') {
      const R = 1.8;
      const rSq = p.x * p.x + p.y * p.y;
      const r = Math.sqrt(rSq);

      if (r > 0.05) {
        const factor = (R * R) / Math.max(R * R * 0.92, rSq);
        const cos2th = (p.x * p.x - p.y * p.y) / rSq;
        const sin2th = (2 * p.x * p.y) / rSq;

        u = vInf * (1 - factor * cos2th);
        v = -vInf * factor * sin2th;

        // Smooth tangential boundary slip around cylinder
        if (r < R * 1.15) {
          const nx = p.x / r;
          const ny = p.y / r;
          const vn = u * nx + v * ny;
          if (vn < 0) {
            u -= vn * nx;
            v -= vn * ny;
          }
          if (r < R * 1.04) {
            const push = ((R * 1.04 - r) / (R * 0.14)) * 1.1 * vInf;
            u += nx * push;
            v += ny * push;
          }
        }

        // Biot-Savart alternating von Kármán vortex street shedding downstream
        if (p.x > R * 0.65) {
          const strouhal = 0.21 * (vInf / (2 * R));
          const wakeSpeed = vInf * 0.78;
          const spacing = wakeSpeed / Math.max(0.25, strouhal);
          const gammaKarman = vInf * R * (1.8 + viscosity * 1.2);
          const coreR = 0.45 + viscosity * 0.8 + Math.max(0, p.x - R) * 0.03;

          _bsOut.u = 0;
          _bsOut.v = 0;
          _bsOut.w = 0;

          const phaseShift = (timeSec * wakeSpeed) % spacing;
          for (let k = 0; k < 5; k++) {
            const sign = k % 2 === 0 ? 1 : -1;
            const vxPos = R * 1.1 + k * (spacing * 0.5) + phaseShift;
            const vyPos = sign * 0.65;
            vorticity += addBiotSavartSegment(
              p.x, p.y, p.z,
              vxPos, vyPos, -5.0,
              vxPos, vyPos, 5.0,
              sign * gammaKarman * 0.65,
              coreR,
              _bsOut
            );
          }

          u += _bsOut.u;
          v += _bsOut.v;
          if (Math.abs(p.y) < 2.2) {
            u -= 0.22 * vInf * Math.exp(-Math.abs(p.y) / 1.1);
            isSeparated = true;
          }
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // 2. WINGED AIRCRAFT: BIOT-SAVART HORSESHOE VORTEX LATTICE + VERTEX LAW
      // -----------------------------------------------------------------------
      let halfSpan = 6.8;
      let rootChord = 7.5;
      let sweepDeg = 35;
      let defaultLeX = -2.2;
      let defaultTeX = 4.6;

      if (modelType === 'f22') {
        halfSpan = surfaceField ? surfaceField.halfSpan : 5.4;
        rootChord = surfaceField ? surfaceField.meanChord : 7.8;
        sweepDeg = 42;
        defaultLeX = -2.0;
        defaultTeX = 4.8;
      } else if (modelType === 'airliner') {
        halfSpan = surfaceField ? surfaceField.halfSpan : 7.2;
        rootChord = surfaceField ? surfaceField.meanChord : 6.8;
        sweepDeg = 32;
        defaultLeX = -1.6;
        defaultTeX = 4.2;
      } else if (modelType === 'concorde') {
        halfSpan = surfaceField ? surfaceField.halfSpan : 4.2;
        rootChord = surfaceField ? surfaceField.meanChord : 10.5;
        sweepDeg = 64;
        defaultLeX = -5.5;
        defaultTeX = 5.5;
      } else {
        halfSpan = surfaceField ? surfaceField.halfSpan : 5.5;
        rootChord = surfaceField ? surfaceField.meanChord : 6.2;
        sweepDeg = 0;
        defaultLeX = -3.1;
        defaultTeX = 3.1;
      }

      // Kutta-Joukowski bound circulation strength: Gamma_0 = (2 / pi) * V_inf * c * C_L
      const flapGammaBoost = 1 + (flapsDeg / 40) * 0.35;
      const effectiveCl = isStalled ? cl * 0.58 : cl;
      const gamma0 = (2 / Math.PI) * vInf * rootChord * effectiveCl * flapGammaBoost * 0.72;

      // Viscous Lamb-Oseen core radius grows downstream with kinematic viscosity
      const baseCore = 0.38 + viscosity * 1.15;

      // --- A. BIOT-SAVART 3D HORSESHOE VORTEX SYSTEM (Elliptic Spanwise Loading) ---
      const panels = 6;
      const panelWidth = (2 * halfSpan) / panels;
      _bsOut.u = 0;
      _bsOut.v = 0;
      _bsOut.w = 0;

      for (let i = 0; i < panels; i++) {
        const z1 = -halfSpan + i * panelWidth;
        const z2 = z1 + panelWidth;
        const zMid = 0.5 * (z1 + z2);

        const zNorm = Math.min(0.96, Math.abs(zMid) / halfSpan);
        const panelGamma = gamma0 * Math.sqrt(Math.max(0.08, 1 - zNorm * zNorm));

        let qcX1: number, teX1: number, y1: number;
        let qcX2: number, teX2: number, y2: number;

        if (surfaceField && surfaceField.getSpanSection(z1 * 0.92, _spanInfo)) {
          qcX1 = _spanInfo.quarterChordX;
          teX1 = _spanInfo.teX;
          y1 = _spanInfo.yMid;
        } else {
          const sw1 = Math.tan((sweepDeg * Math.PI) / 180) * Math.abs(z1) * 0.52;
          qcX1 = defaultLeX + 0.25 * rootChord + sw1;
          teX1 = defaultTeX + sw1 * 0.35;
          y1 = 0;
        }

        if (surfaceField && surfaceField.getSpanSection(z2 * 0.92, _spanInfo)) {
          qcX2 = _spanInfo.quarterChordX;
          teX2 = _spanInfo.teX;
          y2 = _spanInfo.yMid;
        } else {
          const sw2 = Math.tan((sweepDeg * Math.PI) / 180) * Math.abs(z2) * 0.52;
          qcX2 = defaultLeX + 0.25 * rootChord + sw2;
          teX2 = defaultTeX + sw2 * 0.35;
          y2 = 0;
        }

        // Convert bound vortex endpoints to world space (rotation.z = -aoaRad)
        const wAx = qcX1 * cosA + y1 * sinA;
        const wAy = -qcX1 * sinA + y1 * cosA;
        const wBx = qcX2 * cosA + y2 * sinA;
        const wBy = -qcX2 * sinA + y2 * cosA;

        // 1) Bound vortex (-Z -> +Z): negative gamma gives +u above wing (suction), -u below, -v downwash aft
        vorticity += addBiotSavartSegment(
          p.x, p.y, p.z,
          wAx, wAy, z1,
          wBx, wBy, z2,
          -panelGamma,
          baseCore * 1.25,
          _bsOut
        );

        // 2) Trailing horseshoe legs rolling into tip downwash
        const dGammaFactor = 0.35 + 0.65 * zNorm;
        const wTe1x = teX1 * cosA + y1 * sinA;
        const wTe1y = -teX1 * sinA + y1 * cosA;
        const wTe2x = teX2 * cosA + y2 * sinA;
        const wTe2y = -teX2 * sinA + y2 * cosA;

        const dxDown = Math.max(0, p.x - 0.5 * (wTe1x + wTe2x));
        const wakeCore = baseCore * 0.8 + Math.sqrt(Math.max(0, 0.14 * viscosity * dxDown));

        // Left (-Z) trailing leg: +gamma gives downwash inboard
        vorticity += addBiotSavartSegment(
          p.x, p.y, p.z,
          wAx, wAy, z1,
          wTe1x + 24.0, wTe1y - 1.4 * sinA, z1 * 0.96,
          panelGamma * dGammaFactor * 0.55,
          wakeCore,
          _bsOut
        );

        // Right (+Z) trailing leg: -gamma gives downwash inboard
        vorticity += addBiotSavartSegment(
          p.x, p.y, p.z,
          wBx, wBy, z2,
          wTe2x + 24.0, wTe2y - 1.4 * sinA, z2 * 0.96,
          -panelGamma * dGammaFactor * 0.55,
          wakeCore,
          _bsOut
        );
      }

      // --- B. LAMB-OSEEN COUNTER-ROTATING WINGTIP VORTEX PAIR ---
      if (Math.abs(effectiveCl) > 0.05) {
        const tipStartX = surfaceField && surfaceField.getSpanSection(halfSpan * 0.9, _spanInfo)
          ? _spanInfo.teX * 0.85
          : defaultTeX * 0.85;
        const wTipX = tipStartX * cosA;
        const wTipY = -tipStartX * sinA;
        const tipDx = Math.max(0, p.x - wTipX);
        const tipCore = 0.28 + viscosity * 0.85 + Math.sqrt(Math.max(0, 0.12 * viscosity * tipDx));
        const tipGamma = gamma0 * 1.15;

        for (const sign of [-1, 1]) {
          const tipZ = sign * halfSpan * 0.97;
          const endZ = sign * halfSpan * 0.92;
          // -sign * tipGamma ensures inboard downwash & upward/inward wingtip roll-up
          vorticity += addBiotSavartSegment(
            p.x, p.y, p.z,
            wTipX, wTipY, tipZ,
            wTipX + 26.0, wTipY - 1.6 * sinA, endZ,
            -sign * tipGamma,
            tipCore,
            _bsOut
          );
        }
      }

      // --- C. DELTA LEADING-EDGE & CHINE VORTEX FILAMENTS (F-22 & Concorde) ---
      if ((modelType === 'concorde' || modelType === 'f22') && aoaDeg > 2.0) {
        const levGamma = (aoaDeg / 18) * vInf * (modelType === 'concorde' ? 2.6 : 1.7);
        const levCore = 0.28 + viscosity * 0.65;
        const apexX = modelType === 'concorde' ? -6.5 : -5.0;
        const apexZ = modelType === 'concorde' ? 0.35 : 0.75;
        const rearX = defaultTeX;
        const rearZ = halfSpan * 0.84;

        for (const sign of [-1, 1]) {
          const ax = apexX * cosA;
          const ay = -apexX * sinA + 0.22;
          const bxEnd = rearX * cosA;
          const byEnd = -rearX * sinA + 0.45 * Math.sin(aoaRad) + 0.22;
          vorticity += addBiotSavartSegment(
            p.x, p.y, p.z,
            ax, ay, sign * apexZ,
            bxEnd, byEnd, sign * rearZ,
            -sign * levGamma,
            levCore,
            _bsOut
          );
        }
      }

      // Apply Biot-Savart induced velocity field (clamped smoothly against singular spikes)
      const bsMag = Math.hypot(_bsOut.u, _bsOut.v, _bsOut.w);
      const maxBs = vInf * 1.45;
      if (bsMag > maxBs) {
        const s = maxBs / bsMag;
        u += _bsOut.u * s;
        v += _bsOut.v * s;
        w += _bsOut.w * s;
      } else {
        u += _bsOut.u;
        v += _bsOut.v;
        w += _bsOut.w;
      }

      // --- D. SMOOTH C1 VERTEX SURFACE BOUNDARY LAW (Tangential Slip & No-Penetration) ---
      if (surfaceField && surfaceField.sample(bx, by, bz, _surfSample)) {
        const dist = _surfSample.dist;
        const bHalo = 0.85 + viscosity * 0.45;

        if (dist < bHalo) {
          // Rotate smooth outward normal (grad d) from body frame to world frame (rotation.z = -aoaRad)
          const wnx = _surfSample.nx * cosA + _surfSample.ny * sinA;
          const wny = -_surfSample.nx * sinA + _surfSample.ny * cosA;
          const wnz = _surfSample.nz;

          // Smoothstep proximity blend in [0, 1] -> zero discontinuities across field boundaries
          const t = Math.max(0, Math.min(1, 1 - dist / bHalo));
          const wBlend = t * t * (3 - 2 * t);

          const vDotN = u * wnx + v * wny + w * wnz;
          if (vDotN < 0) {
            u -= vDotN * wnx * wBlend;
            v -= vDotN * wny * wBlend;
            w -= vDotN * wnz * wBlend;
          }

          // Gentle, bounded thin-skin outward deflection so tubes glide cleanly around fuselage & wings
          if (dist < 0.26) {
            const skinT = (0.26 - dist) / 0.26;
            const cushion = skinT * skinT * 0.95 * vInf;
            u += wnx * cushion;
            v += wny * cushion;
            w += wnz * cushion;
          }

          // Smooth nose stagnation deceleration without flow reversal
          if (wnx < -0.4) {
            const stag = Math.min(0.45, (-wnx - 0.4) * wBlend * 0.75);
            u *= 1 - stag;
          }
        }
      } else {
        const absZ = Math.abs(bz);
        if (absZ < halfSpan && bx > defaultLeX && bx < defaultTeX) {
          const distY = Math.abs(by);
          if (distY < 0.42) {
            const push = ((0.42 - distY) / 0.42) * 0.85 * vInf;
            v += (by >= 0 ? push : -push) * cosA;
          }
        }
      }

      // --- E. BOUNDARY LAYER SEPARATION & STALL VORTEX SHEDDING ---
      if (isStalled && Math.abs(bz) <= halfSpan * 1.05) {
        const localChordStart = surfaceField && surfaceField.getSpanSection(bz, _spanInfo)
          ? _spanInfo.leX
          : defaultLeX;
        const stallStartX = localChordStart + 1.1;

        if (bx > stallStartX && by > -0.35 && by < 3.6) {
          const wakeProx = Math.exp(-Math.max(0, by) / (1.4 + viscosity * 1.5));
          const shedSpacing = 2.4;
          const shedSpeed = vInf * 0.65;
          const phase = (timeSec * shedSpeed) % shedSpacing;

          _bsOut.u = 0;
          _bsOut.v = 0;
          _bsOut.w = 0;
          for (let s = 0; s < 3; s++) {
            const edX = stallStartX + 1.0 + s * shedSpacing + phase;
            const edY = 0.65 + s * 0.25 + Math.sin(timeSec * 3.5 + s * 2.1 + Math.abs(bz)) * 0.35;
            const edSign = s % 2 === 0 ? 1 : -1;
            vorticity += addBiotSavartSegment(
              p.x, p.y, p.z,
              edX, edY, bz - 1.5,
              edX, edY, bz + 1.5,
              edSign * vInf * 1.25,
              0.52 + viscosity * 0.7,
              _bsOut
            );
          }

          u += _bsOut.u * wakeProx - 0.35 * vInf * wakeProx;
          v += _bsOut.v * wakeProx;
          w += Math.sin(timeSec * 5.0 + bx * 1.4 + bz) * 0.25 * vInf * wakeProx;
          isSeparated = true;
        }
      }

      // --- F. SUPERSONIC OBLIQUE SHOCKWAVE DEFLECTION (Mach >= 1.0) ---
      if (mach >= 1.0) {
        const noseX = surfaceField ? surfaceField.minX : -6.5;
        const wNoseX = noseX * cosA;
        const wNoseY = -noseX * sinA;
        const dxNose = p.x - wNoseX;
        if (dxNose > 0) {
          const mu = Math.asin(1 / Math.max(1.001, mach));
          const coneR = dxNose * Math.tan(mu);
          const radial = Math.hypot(p.y - wNoseY, p.z);
          const distToShock = Math.abs(radial - coneR);
          if (distToShock < 0.7 && radial > 0.08) {
            const shockPulse = Math.exp(-distToShock / 0.3) * 0.4 * vInf;
            v += ((p.y - wNoseY) / radial) * shockPulse;
            w += (p.z / radial) * shockPulse;
            u *= 0.92;
          }
        }
      }

      // --- G. ENGINE EXHAUST JET MOMENTUM (F-22 & Boeing 787) ---
      if (modelType === 'f22' && bx > 5.0) {
        const jetPower = airspeed_kts >= 450 ? (airspeed_kts / 380) * 1.15 : 0.42;
        for (const nz of [-0.67, 0.67]) {
          const rJet = Math.hypot(bz - nz, by + 0.38);
          if (rJet < 1.35) {
            u += jetPower * vInf * Math.exp(-rJet / 0.55);
          }
        }
      } else if (modelType === 'airliner' && bx > -0.6) {
        for (const nz of [-3.6, 3.6]) {
          const rJet = Math.hypot(bz - nz, by + 1.45);
          const jetLen = bx + 0.6;
          const jetWidth = 0.8 + jetLen * 0.045;
          if (rJet < jetWidth * 1.7) {
            u += 0.8 * vInf * Math.exp(-rJet / jetWidth) * Math.exp(-jetLen / 18.0);
          }
        }
      }
    }

    // Prevent upstream flow reversal artifacts while keeping separated stall wakes realistic
    if (!isSeparated && u < vInf * 0.25) {
      u = vInf * 0.25;
    }

    // -------------------------------------------------------------------------
    // 3. BERNOULLI PRESSURE COEFFICIENT (Cp = 1 - (V / V_inf)^2)
    // -------------------------------------------------------------------------
    const speed = Math.hypot(u, v, w);
    let cp = 1 - Math.pow(speed / vInf, 2);
    cp = Math.max(-3.5, Math.min(1.0, cp));

    return { u, v, w, speed, pressureCoeff: cp, vorticity, isSeparated };
  }

  /**
   * Numerically integrates a 3D vortex streamline using 2nd-order Runge-Kutta (RK2 / Midpoint Method).
   */
  public static traceStreamline(
    start: Vertex3D,
    params: Fluid3DParams,
    steps = 136,
    ds = 0.28
  ): (Vertex3D & { speed: number; pressureCoeff: number; vorticity: number; isSeparated: boolean })[] {
    const points: (Vertex3D & { speed: number; pressureCoeff: number; vorticity: number; isSeparated: boolean })[] = [];
    let cur: Vertex3D = { ...start };

    for (let i = 0; i < steps; i++) {
      const v1 = FluidDynamics3D.getVelocity(cur, params);
      points.push({
        x: cur.x,
        y: cur.y,
        z: cur.z,
        speed: v1.speed,
        pressureCoeff: v1.pressureCoeff,
        vorticity: v1.vorticity,
        isSeparated: v1.isSeparated,
      });

      if (cur.x > 22 || Math.abs(cur.y) > 9 || Math.abs(cur.z) > 14) break;

      const len1 = v1.speed || 1;
      const mid: Vertex3D = {
        x: cur.x + (v1.u / len1) * (ds * 0.5),
        y: cur.y + (v1.v / len1) * (ds * 0.5),
        z: cur.z + (v1.w / len1) * (ds * 0.5),
      };

      const v2 = FluidDynamics3D.getVelocity(mid, params);
      const len2 = v2.speed || 1;

      cur = {
        x: cur.x + (v2.u / len2) * ds,
        y: cur.y + (v2.v / len2) * ds,
        z: cur.z + (v2.w / len2) * ds,
      };
    }

    return points;
  }
}
