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

const CYLINDER_RADIUS = 1.4;
const CYLINDER_HALF_HEIGHT = 3.8;

/**
 * Evaluates the analytical Biot-Savart induced velocity of a finite straight vortex filament A -> B
 * with Vatistas/Lamb-Oseen viscous core regularization (coreRadius).
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
 * 3D Aerodynamic Fluid Dynamics Engine (Vortex Flow Law + Signed Surface Boundary Law)
 *
 * Combines:
 *  1. Biot-Savart 3D Horseshoe Vortex Lattice (Kutta-Joukowski bound circulation,
 *     trailing vortex sheet, Lamb-Oseen diffused wingtip vortices, and delta leading-edge vortices).
 *  2. True 3D Signed Distance Field (SDF) Surface Boundary Law (strict no-penetration
 *     tangential slip along outward grad(sdf) with exterior constraint projection).
 *  3. Viscous boundary layer separation, stall wake shedding, and Mach oblique shock deflection.
 */
export class FluidDynamics3D {
  /**
   * Returns true if world-space point `p` lies inside or closer than `clearance`
   * to the solid model geometry.
   */
  public static isInsideSolid(
    p: Vertex3D,
    params: Fluid3DParams,
    clearance = 0.04
  ): boolean {
    const aoaRad = (params.aoaDeg * Math.PI) / 180;
    const sinA = Math.sin(aoaRad);
    const cosA = Math.cos(aoaRad);
    const bx = p.x * cosA - p.y * sinA;
    const by = p.x * sinA + p.y * cosA;
    const bz = p.z;

    if (params.modelType === 'cylinder') {
      if (Math.abs(by) <= CYLINDER_HALF_HEIGHT + clearance) {
        return Math.hypot(bx, bz) < CYLINDER_RADIUS + clearance;
      }
      return false;
    }

    if (params.surfaceField && params.surfaceField.sample(bx, by, bz, _surfSample)) {
      return _surfSample.dist < clearance;
    }
    return false;
  }

  /**
   * Projects world-space point `p` strictly outside the solid model surface
   * by at least `minClearance`, preventing discrete RK2 steps from entering
   * the cylinder, airfoil, fuselage, or engine nacelles.
   */
  public static constrainToExterior(
    p: Vertex3D,
    params: Fluid3DParams,
    minClearance = 0.08
  ): Vertex3D {
    const aoaRad = (params.aoaDeg * Math.PI) / 180;
    const sinA = Math.sin(aoaRad);
    const cosA = Math.cos(aoaRad);

    let bx = p.x * cosA - p.y * sinA;
    let by = p.x * sinA + p.y * cosA;
    let bz = p.z;

    if (params.modelType === 'cylinder') {
      const targetR = CYLINDER_RADIUS + minClearance;
      const capY = CYLINDER_HALF_HEIGHT + minClearance;
      if (Math.abs(by) < capY) {
        const rXZ = Math.hypot(bx, bz);
        if (rXZ < targetR) {
          // If near top/bottom cap edge and closer to end cap than side wall, push over cap
          const distToSide = targetR - rXZ;
          const distToCap = capY - Math.abs(by);
          if (distToCap < distToSide && distToCap < 0.25) {
            by = by >= 0 ? capY : -capY;
          } else if (rXZ > 1e-4) {
            const scale = targetR / rXZ;
            bx *= scale;
            bz *= scale;
          } else {
            bz = targetR;
          }
          return {
            x: bx * cosA + by * sinA,
            y: -bx * sinA + by * cosA,
            z: bz,
          };
        }
      }
      return p;
    }

    const sf = params.surfaceField;
    if (!sf) return p;

    let modified = false;
    for (let iter = 0; iter < 4; iter++) {
      if (!sf.sample(bx, by, bz, _surfSample)) break;
      if (_surfSample.dist >= minClearance) break;

      const push = minClearance - _surfSample.dist + 0.02;
      bx += _surfSample.nx * push;
      by += _surfSample.ny * push;
      bz += _surfSample.nz * push;
      modified = true;
    }

    if (!modified) return p;

    return {
      x: bx * cosA + by * sinA,
      y: -bx * sinA + by * cosA,
      z: bz,
    };
  }

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
    // 1. BLUFF BODY VERTICAL CYLINDER (Doublet in X-Z + von Kármán Vortex Street)
    //    Geometry is vertical along Y (|by| <= 3.8) with circular cross-section
    //    in X-Z (r = hypot(bx, bz) = 1.4).
    // -------------------------------------------------------------------------
    if (modelType === 'cylinder') {
      const R = CYLINDER_RADIUS;
      const Reff = R * 1.07; // slight viscous displacement thickness
      const halfH = CYLINDER_HALF_HEIGHT;
      const rXZSq = bx * bx + bz * bz;
      const rXZ = Math.sqrt(rXZSq);

      // Height attenuation: full 2D bluff-body deflection along cylinder, smooth fade past top/bottom ends
      const endMargin = Math.max(0, Math.abs(by) - halfH);
      const heightBlend = endMargin <= 0 ? 1.0 : Math.max(0, 1.0 - endMargin / 0.85);

      if (heightBlend > 0.001) {
        // Freestream vector in body frame
        const freestreamUb = vInf * cosA;
        const freestreamVb = vInf * sinA;

        let ub = freestreamUb;
        let vb = freestreamVb;
        let wb = 0;

        if (rXZ > 0.02) {
          const factor = (Reff * Reff) / Math.max(Reff * Reff * 0.92, rXZSq);
          const cos2th = (bx * bx - bz * bz) / rXZSq;
          const sin2th = (2 * bx * bz) / rXZSq;

          ub = freestreamUb * (1 - factor * cos2th);
          wb = -freestreamUb * factor * sin2th;

          // End-cap tip spillover over top/bottom of finite cylinder
          if (Math.abs(by) > halfH - 0.65 && rXZ < R * 1.45) {
            const capSign = by >= 0 ? 1 : -1;
            const capFactor = Math.max(0, 1 - Math.abs(Math.abs(by) - halfH) / 0.75);
            vb += capSign * 0.48 * vInf * capFactor * Math.max(0, 1 - rXZ / (R * 1.5));
          }
        }

        // Biot-Savart alternating von Kármán vortex street shedding downstream in X-Z
        if (bx > R * 0.5 && Math.abs(by) <= halfH + 0.55) {
          const strouhal = 0.21 * (vInf / (2 * R));
          const wakeSpeed = vInf * 0.78;
          const spacing = wakeSpeed / Math.max(0.25, strouhal);
          const gammaKarman = vInf * R * (1.65 + viscosity * 1.1);
          const coreR = 0.42 + viscosity * 0.75 + Math.max(0, bx - R) * 0.03;

          _bsOut.u = 0;
          _bsOut.v = 0;
          _bsOut.w = 0;

          const phaseShift = (timeSec * wakeSpeed) % spacing;
          for (let k = 0; k < 5; k++) {
            const sign = k % 2 === 0 ? 1 : -1;
            const vxPos = R * 1.15 + k * (spacing * 0.5) + phaseShift;
            const vzPos = sign * 0.72;
            vorticity += addBiotSavartSegment(
              bx, by, bz,
              vxPos, -halfH, vzPos,
              vxPos, halfH, vzPos,
              sign * gammaKarman * 0.65,
              coreR,
              _bsOut
            );
          }

          ub += _bsOut.u;
          vb += _bsOut.v;
          wb += _bsOut.w;

          if (Math.abs(bz) < R * 1.35) {
            ub -= 0.24 * vInf * Math.exp(-Math.abs(bz) / (R * 0.85));
            isSeparated = true;
          }
        }

        // Strict no-penetration boundary around vertical cylinder wall (X-Z) & end caps (Y)
        if (Math.abs(by) <= halfH + 0.28 && rXZ < R + 0.45) {
          if (Math.abs(by) > halfH - 0.12 && rXZ < R * 0.92) {
            // Top / bottom cap deflection
            const capNy = by >= 0 ? 1 : -1;
            const vDotCap = vb * capNy;
            if (vDotCap < 0) vb -= vDotCap * capNy;
            if (Math.abs(by) < halfH + 0.14) {
              vb += capNy * 0.85 * vInf;
            }
          } else {
            const nx = rXZ > 1e-4 ? bx / rXZ : 0;
            const nz = rXZ > 1e-4 ? bz / rXZ : 1;
            const vDotN = ub * nx + wb * nz;
            if (vDotN < 0) {
              ub -= vDotN * nx;
              wb -= vDotN * nz;
            }
            // Outward boundary cushion & front-stagnation split
            const clearance = R + 0.22 - rXZ;
            if (clearance > 0) {
              const push = Math.min(2.0 * vInf, (clearance / 0.22) * 1.35 * vInf);
              ub += nx * push;
              wb += nz * push;
            }
            // Break exact dead-center stagnation at front (nx ~ -1, bz ~ 0)
            if (nx < -0.75 && Math.hypot(ub, wb) < 0.22 * vInf) {
              wb += (bz >= 0 ? 1 : -1) * 0.35 * vInf;
            }
          }
        }

        // Convert body-frame velocity back to world frame & blend with freestream beyond ends
        const wu = ub * cosA + vb * sinA;
        const wv = -ub * sinA + vb * cosA;
        const ww = wb;

        u = vInf * (1 - heightBlend) + wu * heightBlend;
        v = wv * heightBlend;
        w = ww * heightBlend;
      }
    } else {
      // -----------------------------------------------------------------------
      // 2. WINGED AIRCRAFT: BIOT-SAVART HORSESHOE VORTEX LATTICE + SDF BOUNDARY
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

        const wAx = qcX1 * cosA + y1 * sinA;
        const wAy = -qcX1 * sinA + y1 * cosA;
        const wBx = qcX2 * cosA + y2 * sinA;
        const wBy = -qcX2 * sinA + y2 * cosA;

        vorticity += addBiotSavartSegment(
          p.x, p.y, p.z,
          wAx, wAy, z1,
          wBx, wBy, z2,
          -panelGamma,
          baseCore * 1.25,
          _bsOut
        );

        const dGammaFactor = 0.35 + 0.65 * zNorm;
        const wTe1x = teX1 * cosA + y1 * sinA;
        const wTe1y = -teX1 * sinA + y1 * cosA;
        const wTe2x = teX2 * cosA + y2 * sinA;
        const wTe2y = -teX2 * sinA + y2 * cosA;

        const dxDown = Math.max(0, p.x - 0.5 * (wTe1x + wTe2x));
        const wakeCore = baseCore * 0.8 + Math.sqrt(Math.max(0, 0.14 * viscosity * dxDown));

        vorticity += addBiotSavartSegment(
          p.x, p.y, p.z,
          wAx, wAy, z1,
          wTe1x + 24.0, wTe1y - 1.4 * sinA, z1 * 0.96,
          panelGamma * dGammaFactor * 0.55,
          wakeCore,
          _bsOut
        );

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

      // Prevent Biot-Savart upstream reversal BEFORE solid boundary projection
      if (!isStalled && u < vInf * 0.25) {
        u = vInf * 0.25;
      }

      // --- D. BOUNDARY LAYER SEPARATION & STALL VORTEX SHEDDING ---
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

      // --- E. SUPERSONIC OBLIQUE SHOCKWAVE DEFLECTION (Mach >= 1.0) ---
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

      // --- F. ENGINE EXHAUST JET MOMENTUM (F-22 & Boeing 787) ---
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

      // --- G. TRUE SIGNED-DISTANCE SURFACE BOUNDARY LAW (Applied LAST so nothing penetrates) ---
      if (surfaceField && surfaceField.sample(bx, by, bz, _surfSample)) {
        const dist = _surfSample.dist; // < 0 inside solid body, > 0 outside
        const bHalo = 0.78 + viscosity * 0.35;

        if (dist < bHalo) {
          // Rotate strictly outward normal (grad sdf) from body frame to world frame
          const wnx = _surfSample.nx * cosA + _surfSample.ny * sinA;
          const wny = -_surfSample.nx * sinA + _surfSample.ny * cosA;
          const wnz = _surfSample.nz;

          // 100% hard tangential slip at/inside surface (dist <= 0.14), smoothstep outside
          let wBlend = 1.0;
          if (dist > 0.14) {
            const t = Math.max(0, Math.min(1, (bHalo - dist) / (bHalo - 0.14)));
            wBlend = t * t * (3 - 2 * t);
          }

          const vDotN = u * wnx + v * wny + w * wnz;
          if (vDotN < 0) {
            u -= vDotN * wnx * wBlend;
            v -= vDotN * wny * wBlend;
            w -= vDotN * wnz * wBlend;
          }

          // Outward skin cushion / expulsion if close to or inside the solid mesh
          if (dist < 0.22) {
            const pen = 0.22 - dist;
            const cushion = Math.min(2.4 * vInf, (pen / 0.22) * 1.45 * vInf);
            u += wnx * cushion;
            v += wny * cushion;
            w += wnz * cushion;
          }

          // Cleanly split stagnation flow over/under leading edge or nose without getting stuck
          if (wnx < -0.5) {
            const tangSpeed = Math.hypot(u, v, w);
            if (tangSpeed < 0.28 * vInf) {
              const splitDirY = _surfSample.ny >= -0.05 ? 1 : -1;
              v += splitDirY * 0.32 * vInf;
            }
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
   * Numerically integrates a 3D vortex streamline using 2nd-order Runge-Kutta (RK2 / Midpoint Method)
   * with exterior surface projection so streamlines wrap smoothly around every body without penetrating.
   */
  public static traceStreamline(
    start: Vertex3D,
    params: Fluid3DParams,
    steps = 165,
    ds = 0.22
  ): (Vertex3D & { speed: number; pressureCoeff: number; vorticity: number; isSeparated: boolean })[] {
    const points: (Vertex3D & { speed: number; pressureCoeff: number; vorticity: number; isSeparated: boolean })[] = [];
    let cur: Vertex3D = FluidDynamics3D.constrainToExterior({ ...start }, params, 0.09);

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
      const midRaw: Vertex3D = {
        x: cur.x + (v1.u / len1) * (ds * 0.5),
        y: cur.y + (v1.v / len1) * (ds * 0.5),
        z: cur.z + (v1.w / len1) * (ds * 0.5),
      };
      const mid = FluidDynamics3D.constrainToExterior(midRaw, params, 0.09);

      const v2 = FluidDynamics3D.getVelocity(mid, params);
      const len2 = v2.speed || 1;

      const nextRaw: Vertex3D = {
        x: cur.x + (v2.u / len2) * ds,
        y: cur.y + (v2.v / len2) * ds,
        z: cur.z + (v2.w / len2) * ds,
      };
      cur = FluidDynamics3D.constrainToExterior(nextRaw, params, 0.09);
    }

    return points;
  }
}
