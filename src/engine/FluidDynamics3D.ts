import { AircraftModelType, AeroTelemetry } from '../types/aerodynamics';
import { Vertex3D } from '../utils/aircraft3DGeometry';

export interface Fluid3DParams {
  modelType: AircraftModelType;
  aoaDeg: number;
  airspeed_kts: number;
  mach: number;
  altitude_ft: number;
  flapsDeg: number;
  isStalled: boolean;
  cl: number;
  cd: number;
  timeSec?: number;
}

export interface Velocity3DResult {
  u: number; // downstream (+X)
  v: number; // vertical (+Y)
  w: number; // spanwise (+Z)
  speed: number;
  pressureCoeff: number; // Cp
  isSeparated: boolean;
}

/**
 * 3D Aerodynamic Fluid Dynamics Engine
 *
 * Implements potential flow with boundary displacement, Kutta circulation,
 * Prandtl downwash, Lamb-Oseen wingtip vortices, Bernoulli pressure gradients,
 * and boundary layer separation with turbulent wake shedding.
 */
export class FluidDynamics3D {
  /**
   * Evaluates the local 3D fluid velocity vector (u, v, w) at point (x, y, z)
   * in the wind tunnel coordinate system:
   *   - X: along wind tunnel flow (-X is upstream inlet, +X is downstream outlet)
   *   - Y: vertical height (+Y is up towards ceiling, -Y is down towards floor)
   *   - Z: spanwise lateral (-Z is starboard/right, +Z is port/left)
   */
  public static getVelocity(
    p: Vertex3D,
    params: Fluid3DParams
  ): Velocity3DResult {
    const {
      modelType,
      aoaDeg,
      airspeed_kts,
      flapsDeg,
      isStalled,
      cl,
      timeSec = 0,
    } = params;

    // Free-stream speed normalized to wind tunnel simulation scale (1.0 = nominal)
    const vInf = Math.max(0.4, (airspeed_kts / 350) * 1.2);
    const aoaRad = (aoaDeg * Math.PI) / 180;
    const sinA = Math.sin(aoaRad);
    const cosA = Math.cos(aoaRad);

    // Initial uniform free-stream flow along +X
    let u = vInf;
    let v = 0;
    let w = 0;

    // Relative coordinates in body reference frame (pitch rotated around origin)
    // Model pitched nose-up: Nose (x < 0) rotates to +Y, tail (x > 0) rotates to -Y
    const bx = p.x * cosA + p.y * sinA;
    const by = -p.x * sinA + p.y * cosA;
    const bz = p.z;

    let isSeparated = false;
    let cp = 0;

    // -------------------------------------------------------------------------
    // 1. MODEL-SPECIFIC 3D GEOMETRY & BOUNDARY DISPLACEMENT FIELD
    // -------------------------------------------------------------------------
    if (modelType === 'cylinder') {
      // 3D Circular cylinder along Z-axis (cross-flow)
      // Radius R = 1.8, centered at origin
      const R = 1.8;
      const rSq = p.x * p.x + p.y * p.y;
      const r = Math.sqrt(rSq);

      if (r > 0.05) {
        // 2D Potential flow doublet past circular cylinder
        const factor = (R * R) / Math.max(R * R * 0.9, rSq);
        const cos2th = (p.x * p.x - p.y * p.y) / rSq;
        const sin2th = (2 * p.x * p.y) / rSq;

        u = vInf * (1 - factor * cos2th);
        v = -vInf * factor * sin2th;

        // Inside or at solid boundary: push out along radial normal
        if (r < R * 1.08) {
          const push = (R * 1.08 - r) * 2.5;
          u += (p.x / r) * push;
          v += (p.y / r) * push;
        }

        // Unsteady von Kármán vortex street shedding downstream (x > R)
        if (p.x > R * 0.8) {
          const strouhalFreq = 1.8 * vInf;
          const wakePhase = p.x * 1.2 - timeSec * strouhalFreq;
          const wakeDecay = Math.exp(-Math.abs(p.y) / 2.2) * Math.min(1.0, (p.x - R) / 2.0);
          const vortexSwirl = Math.sin(wakePhase) * vInf * 0.7 * wakeDecay;
          v += vortexSwirl;
          u -= Math.abs(vortexSwirl) * 0.45; // Viscous wake velocity deficit
          isSeparated = true;
        }
      }
    } else {
      // WINGED AIRCRAFT MODELS (F-22, Airliner B787, Concorde, NACA Airfoils)

      // Geometry characteristics by model
      let halfSpan = 6.8;
      let rootChord = 8.0;
      let noseX = -6.8;
      let tailX = 6.2;
      let fusRadius = 1.2;
      let sweepDeg = 42;
      let camberPeak = 0.0;

      if (modelType === 'f22') {
        halfSpan = 6.8;
        rootChord = 8.5;
        noseX = -6.8;
        tailX = 6.5;
        fusRadius = 1.1;
        sweepDeg = 42;
        camberPeak = 0.04;
      } else if (modelType === 'airliner') {
        halfSpan = 9.2;
        rootChord = 7.5;
        noseX = -7.5;
        tailX = 7.2;
        fusRadius = 1.7;
        sweepDeg = 32;
        camberPeak = 0.28 + (flapsDeg / 40) * 0.35; // Fowler flap camber increase
      } else if (modelType === 'concorde') {
        halfSpan = 4.8;
        rootChord = 12.0;
        noseX = -9.2;
        tailX = 6.5;
        fusRadius = 0.95;
        sweepDeg = 68; // Slender ogival delta
        camberPeak = 0.02;
      } else if (modelType === 'naca2412') {
        halfSpan = 7.0;
        rootChord = 6.5;
        noseX = -3.25;
        tailX = 3.25;
        fusRadius = 0.05;
        sweepDeg = 0;
        camberPeak = 0.22 + (flapsDeg / 40) * 0.25;
      } else if (modelType === 'naca0012') {
        halfSpan = 7.0;
        rootChord = 6.5;
        noseX = -3.25;
        tailX = 3.25;
        fusRadius = 0.05;
        sweepDeg = 0;
        camberPeak = (flapsDeg / 40) * 0.22;
      }

      // --- A. NOSE STAGNATION & FOREBODY SOURCE FIELD ---
      // Ahead of the aircraft nose, oncoming fluid smoothly parts radially around the radome
      if (bx < noseX && bx > noseX - 4.5) {
        const distNose = noseX - bx;
        const rTrans = Math.hypot(by, bz);
        const safeR = Math.max(0.08, rTrans);
        const stagFactor = Math.pow(Math.max(0, 1 - distNose / 4.2), 2);
        const deflSpeed = stagFactor * fusRadius * 0.42 * vInf;
        // Radial outward push
        v += ((by !== 0 ? by : 0.05) / safeR) * deflSpeed * cosA;
        w += (bz / safeR) * deflSpeed;
        u *= Math.max(0.2, 1.0 - stagFactor * 0.65); // Dynamic ram deceleration at stagnation point
      }

      // --- B. FUSELAGE DISPLACEMENT (Slender Body of Revolution with Boundary Enforcement) ---
      if (fusRadius > 0.1 && bx >= noseX && bx <= tailX) {
        const fusFrac = (bx - noseX) / (tailX - noseX);
        // Realistic fuselage profile: smooth radome dome -> cylindrical cabin -> tapered tail cone
        const localFusR = fusRadius * Math.sin(Math.pow(fusFrac, 0.45) * Math.PI) * 1.15;
        const rTrans = Math.hypot(by, bz);
        const safeR = Math.max(0.05, rTrans);

        if (rTrans < localFusR * 2.8) {
          const dispRatio = Math.min(1.0, Math.pow(localFusR / safeR, 2));
          const deflSpeed = dispRatio * 0.38 * vInf;
          v += ((by !== 0 ? by : 0.05) / safeR) * deflSpeed * cosA;
          w += (bz / safeR) * deflSpeed;
        }

        // Strict solid hull boundary layer repulsion: Prevents streamlines from piercing the cockpit/cabin
        if (rTrans < localFusR * 1.15) {
          const push = (localFusR * 1.15 - rTrans) * 4.5;
          v += ((by !== 0 ? by : 0.08) / safeR) * push * cosA;
          w += (bz / safeR) * push;
          u = Math.max(0.2 * vInf, u * 0.6);
        }
      }

      // --- C. WING LIFT, BERNOULLI ACCELERATION & CAMBER DEFLECTION ---
      // Wing bounds along span:
      const absZ = Math.abs(bz);
      if (absZ <= halfSpan * 1.18) {
        const spanFrac = Math.min(1.0, absZ / halfSpan);
        // Wing chord and leading edge position at this span station
        const sweepOffset = Math.tan((sweepDeg * Math.PI) / 180) * absZ * 0.55;
        const localLeX = (modelType.startsWith('naca') ? noseX : -1.8) + sweepOffset;
        const localTeX = (modelType.startsWith('naca') ? tailX : 4.5) + sweepOffset * 0.3;
        const localChord = Math.max(0.8, localTeX - localLeX);
        const chordFrac = (bx - localLeX) / localChord;

        // Wing thickness distribution (streamlined NACA envelope)
        let tHalf = 0.36 * (1 - spanFrac * 0.42);
        if (modelType === 'concorde' || modelType === 'f22') tHalf *= 0.65; // Razor-thin supersonic delta

        // Wing camberline height
        const wingY_camber = (camberPeak * Math.sin(Math.max(0, Math.min(1, chordFrac)) * Math.PI) - sinA * (bx - localLeX) * 0.45);
        const distFromWing = Math.abs(by - wingY_camber);

        // 1. Ahead of wing leading edge: Flow splits at stagnation line
        if (chordFrac < 0 && chordFrac > -0.55) {
          const leDist = -chordFrac * localChord;
          const leInfluence = Math.exp(-leDist / 0.9) * (1 - spanFrac * 0.25);
          const splitDir = by >= wingY_camber ? 1.0 : -1.0;
          v += splitDir * leInfluence * 0.38 * vInf * cosA;
          // Induced circulation upwash
          v += Math.max(0.1, cl) * vInf * 0.28 * leInfluence * cosA;
        }

        // 2. Over the wing surface: flow deflection & Bernoulli acceleration
        if (chordFrac >= 0 && chordFrac <= 1.0) {
          if (distFromWing < 2.8) {
            const proximity = Math.exp(-distFromWing / 0.85);

            if (by >= wingY_camber) {
              // UPPER SUCTION SURFACE:
              if (!isStalled || chordFrac < 0.26) {
                // Attached laminar flow: Bernoulli acceleration (higher speed, negative Cp)
                const suctionPeak = (Math.max(0.2, cl) * 0.72) / Math.sqrt(Math.max(0.07, chordFrac));
                const accel = Math.min(1.35 * vInf, suctionPeak * vInf * proximity);
                u += accel;
                // Flow conforms to upper convex camber contour
                const contourSlope = -Math.cos(chordFrac * Math.PI) * 0.42;
                v += contourSlope * vInf * proximity * 0.65;
              } else {
                // STALL: Boundary layer separation & turbulent wake eddies
                isSeparated = true;
                const stallPhase = timeSec * 6.5 + bx * 2.2;
                const eddy = Math.sin(stallPhase) * vInf * 0.75;
                u -= Math.abs(eddy) * 0.75; // Viscous wake velocity deficit
                v += eddy * 0.85;           // Severe vertical buffeting
                w += Math.cos(stallPhase * 0.85) * vInf * 0.4; // Spanwise turbulence
              }
            } else {
              // LOWER COMPRESSION SURFACE:
              const compression = Math.max(0, cl) * 0.28 * vInf * proximity;
              u -= compression;            // Deceleration (positive Cp)
              v -= 0.22 * vInf * proximity; // Deflected downwards
            }

            // Solid wing boundary: Never allow streamlines to pierce upper/lower wing skin
            if (distFromWing < tHalf * 1.12) {
              const pushY = (tHalf * 1.12 - distFromWing) * 4.8;
              v += (by >= wingY_camber ? pushY : -pushY) * cosA;
            }
          }
        }

        // 3. Aft of trailing edge: Downwash field (Prandtl lifting line theory)
        if (chordFrac > 1.0) {
          const aftDist = bx - localTeX;
          const aspectEff = Math.max(2.5, (halfSpan * 2) / rootChord);
          const downwashAngle = (2.4 * Math.max(0.12, cl)) / (Math.PI * aspectEff);
          const downwashDecay = Math.exp(-aftDist / 14.0) * (1 - spanFrac * 0.25);
          const dw = Math.tan(downwashAngle) * vInf * downwashDecay * 2.1;
          v -= dw * cosA;

          // Flaps extra downwash jet
          if (flapsDeg > 0 && absZ < halfSpan * 0.65) {
            const flapDrop = (flapsDeg / 40) * 0.65 * vInf * Math.exp(-aftDist / 9.0);
            v -= flapDrop * cosA;
          }

          // Viscous wake deficit behind trailing edge
          const wakeDistY = Math.abs(by - (wingY_camber - (chordFrac - 1.0) * 0.25));
          if (wakeDistY < 0.95) {
            const deficit = 0.32 * vInf * Math.exp(-wakeDistY / 0.42) / Math.sqrt(Math.max(1, aftDist * 0.8));
            u -= deficit;
          }
        }

        // --- D. 3D WINGTIP VORTICES (Lamb-Oseen Helical Vortex System) ---
        // Trailing downstream from both wingtips (z = ±halfSpan)
        const tipX0 = localLeX + (localTeX - localLeX) * 0.85;
        if (bx >= tipX0 - 0.5) {
          const distFromTipZ = absZ - halfSpan;
          const vortexCoreY = wingY_camber - (bx - tipX0) * 0.09 * sinA;
          const rVortex = Math.hypot(distFromTipZ, by - vortexCoreY);

          if (rVortex < 3.8 && rVortex > 0.04) {
            const coreRadius = 0.28 + (bx - tipX0) * 0.022; // Viscous core diffusion
            const gamma = Math.max(0.2, cl) * vInf * 2.2;  // Circulation strength
            // Lamb-Oseen tangential velocity profile
            const vTan = (gamma / (2 * Math.PI * rVortex)) * (1 - Math.exp(-(rVortex * rVortex) / (coreRadius * coreRadius)));

            const dy = by - vortexCoreY;
            const dz = distFromTipZ;

            // Port (left, +Z): flow rolls outward from bottom and wraps up/inward over the tip
            // Starboard (right, -Z): flow rolls outward from bottom and wraps up/inward over the tip
            const swirlSign = bz > 0 ? 1 : -1;
            const vInducedY = swirlSign * (-dz / rVortex) * vTan;
            const vInducedZ = swirlSign * (dy / rVortex) * vTan;

            v += vInducedY * cosA;
            w += vInducedZ;
          }
        }

        // --- E. MODEL-SPECIFIC VORTEX & JET ENGINES ---

        // 1. CONCORDE SST: Slender Ogival Gothic Delta Leading-Edge Vortex Roll-Up
        if (modelType === 'concorde' && aoaDeg > 1.0 && bx > -8.2 && bx < localTeX + 2.0) {
          const deltaProgress = Math.max(0, Math.min(1, (bx - (-8.2)) / (localTeX - (-8.2))));
          const deltaCoreZ = (0.45 + Math.pow(deltaProgress, 1.25) * (halfSpan - 0.45));
          const deltaCoreY = wingY_camber + 0.15 + deltaProgress * 0.35 * Math.sin(aoaRad);

          for (const sign of [-1, 1]) {
            const rDelta = Math.hypot(bz - sign * deltaCoreZ, by - deltaCoreY);
            if (rDelta < 2.4 && rDelta > 0.04) {
              const deltaGamma = (Math.max(2.0, aoaDeg) / 14.0) * vInf * 2.8;
              const coreRadius = 0.22 + deltaProgress * 0.25;
              const deltaVTan = (deltaGamma / (2 * Math.PI * rDelta)) * (1 - Math.exp(-(rDelta * rDelta) / (coreRadius * coreRadius)));

              // Intense leading-edge vortex swirl: rolls upward and over the delta upper surface
              v += sign * ((bz - sign * deltaCoreZ) / rDelta) * deltaVTan * cosA;
              w += -sign * ((by - deltaCoreY) / rDelta) * deltaVTan;
              u += deltaVTan * 0.55; // Axial core super-velocity (vortex core suction peak)
            }
          }
        }

        // 2. F-22 RAPTOR: Forebody Chine Vortices & Canted Twin Fin Channeling
        if (modelType === 'f22') {
          // Forebody chine vortices shed from sharp chines at AoA > 2.5 deg
          if (aoaDeg > 2.5 && bx > noseX + 1.2 && bx < localTeX) {
            const chineCoreZ = 1.15 + (bx - noseX) * 0.18;
            const chineCoreY = by - 0.28;
            for (const sign of [-1, 1]) {
              const rChine = Math.hypot(bz - sign * chineCoreZ, chineCoreY);
              if (rChine < 1.9 && rChine > 0.05) {
                const chineGamma = (aoaDeg / 16) * vInf * 1.35;
                const chineVTan = (chineGamma / (2 * Math.PI * rChine)) * (1 - Math.exp(-(rChine * rChine) / 0.14));
                v += sign * ((bz - sign * chineCoreZ) / rChine) * chineVTan * cosA;
                w += -sign * (chineCoreY / rChine) * chineVTan;
                u += chineVTan * 0.42;
              }
            }
          }

          // Canted vertical stabilizer wash (twin canted rudders at 28 deg)
          if (bx > 1.8 && bx < 5.8 && by > 0.2 && by < 3.2) {
            for (const sign of [-1, 1]) {
              const finZ = sign * (1.25 + (by - 0.2) * 0.53);
              const distFin = Math.abs(bz - finZ);
              if (distFin < 0.65) {
                // Flow deflection along fin cant angle
                w += sign * 0.25 * vInf * Math.exp(-distFin / 0.35);
              }
            }
          }

          // Twin afterburner exhaust plumes behind Pratt & Whitney F119 nozzles
          if (bx > 5.2) {
            const isReheat = airspeed_kts >= 450;
            const jetPower = isReheat ? (airspeed_kts / 380) * 1.2 : 0.45;
            for (const nz of [-0.67, 0.67]) {
              const rJet = Math.hypot(bz - nz, by + 0.38);
              if (rJet < 1.4) {
                u += jetPower * vInf * Math.exp(-rJet / 0.55);
              }
            }
          }
        }

        // 3. BOEING 787 AIRLINER: High-Bypass GEnx Turbofans & Raked Tip Wash
        if (modelType === 'airliner') {
          // Dual underslung turbofan nacelles at z = ±3.6, y = -1.45
          for (const nz of [-3.6, 3.6]) {
            // A. Intake suction zone ahead of fan face (bx between -3.2 and -0.8)
            if (bx >= -3.2 && bx < -0.8) {
              const distInlet = Math.hypot(bz - nz, by + 1.45, bx + 1.2);
              if (distInlet < 1.8) {
                // Suction draws fluid into the nacelle throat
                u += 0.45 * vInf * Math.exp(-distInlet / 1.1);
                w -= ((bz - nz) / (distInlet || 1)) * 0.2 * vInf;
                v -= ((by + 1.45) / (distInlet || 1)) * 0.2 * vInf;
              }
            }
            // B. High-velocity bypass fan and core exhaust jet (bx > -0.6)
            if (bx >= -0.6) {
              const rExhaust = Math.hypot(bz - nz, by + 1.45);
              const jetLength = bx - (-0.6);
              const jetWidth = 0.85 + jetLength * 0.045; // Core plume spreading
              if (rExhaust < jetWidth * 1.8) {
                const jetSpeed = 0.85 * vInf * Math.exp(-rExhaust / jetWidth) * Math.exp(-jetLength / 18.0);
                u += jetSpeed;
              }
            }
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. LOCAL SPEED & PRESSURE COEFFICIENT (Cp = 1 - (V / V_inf)^2)
    // -------------------------------------------------------------------------
    const speed = Math.hypot(u, v, w);
    cp = 1 - Math.pow(speed / vInf, 2);
    cp = Math.max(-3.5, Math.min(1.0, cp));

    return { u, v, w, speed, pressureCoeff: cp, isSeparated };
  }

  /**
   * Numerically integrates a 3D streamline through the velocity field
   * using 2nd-order Runge-Kutta (RK2 / Midpoint Method).
   */
  public static traceStreamline(
    start: Vertex3D,
    params: Fluid3DParams,
    steps = 40,
    ds = 0.85
  ): (Vertex3D & { speed: number; pressureCoeff: number; isSeparated: boolean })[] {
    const points: (Vertex3D & { speed: number; pressureCoeff: number; isSeparated: boolean })[] = [];
    let cur: Vertex3D = { ...start };

    for (let i = 0; i < steps; i++) {
      const v1 = FluidDynamics3D.getVelocity(cur, params);
      points.push({
        x: cur.x,
        y: cur.y,
        z: cur.z,
        speed: v1.speed,
        pressureCoeff: v1.pressureCoeff,
        isSeparated: v1.isSeparated,
      });

      if (cur.x > 22 || Math.abs(cur.y) > 9 || Math.abs(cur.z) > 14) break;

      // RK2 midpoint evaluation
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
