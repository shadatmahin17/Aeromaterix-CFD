import { Point2D, PolygonSurfacePoint, AircraftModelType, AircraftModelConfig } from '../types/aerodynamics';

export const AIRCRAFT_MODELS: Record<AircraftModelType, AircraftModelConfig> = {
  f22: {
    id: 'f22',
    name: 'F-22 Raptor (Fighter)',
    category: 'Fighter',
    description: 'Stealth air dominance fighter with chined forebody, razor-thin diamond wing section, and vortex lift at high AoA.',
    wingspan: 13.56,
    chord: 4.8,
    sweepDeg: 42,
    stallAngle: 22,
    cl0: 0.12,
    clMax: 1.85,
    cd0: 0.019,
    flapCapable: false,
    supersonicCapable: true,
    glbPath: '/models/f22_raptor.glb',
    hasGlbModel: true,
  },
  airliner: {
    id: 'airliner',
    name: 'Boeing 787 (Transport)',
    category: 'Commercial',
    description: 'Transonic widebody airliner with supercritical high-lift cambered wing section and underslung high-bypass turbofan.',
    wingspan: 60.1,
    chord: 6.5,
    sweepDeg: 32,
    stallAngle: 15,
    cl0: 0.38,
    clMax: 2.25,
    cd0: 0.024,
    flapCapable: true,
    supersonicCapable: false,
    glbPath: '/models/boeing_787.glb',
    hasGlbModel: true,
  },
  naca2412: {
    id: 'naca2412',
    name: 'Airfoil Section (NACA 2412)',
    category: 'Airfoil',
    description: 'Classic cambered aviation airfoil (Cessna 172). 2% max camber at 40% chord with 12% thickness. Positive lift at 0° AoA.',
    wingspan: 11.0,
    chord: 1.6,
    sweepDeg: 0,
    stallAngle: 16,
    // 2D section Cl0 ≈ 0.25 with α_{L=0} = -2.1°; 3D finite-wing CL(0) scales with CLα(AR, M) around α_{L=0}
    cl0: 0.25,
    alphaZeroLift: -2.1,
    clMax: 1.62,
    cd0: 0.008,
    flapCapable: true,
    supersonicCapable: false,
    glbPath: '/models/airfoil.glb',
    hasGlbModel: true,
  },
  naca0012: {
    id: 'naca0012',
    name: 'NACA 0012 (Symmetric)',
    category: 'Airfoil',
    description: 'Zero camber symmetrical airfoil used on aerobatic aircraft and helicopter rotor blades. 0 lift at 0° AoA.',
    wingspan: 10.0,
    chord: 1.5,
    sweepDeg: 0,
    stallAngle: 15,
    cl0: 0.0,
    alphaZeroLift: 0.0,
    clMax: 1.45,
    cd0: 0.007,
    flapCapable: true,
    supersonicCapable: false,
    glbPath: '/models/airfoil.glb',
    hasGlbModel: true,
  },
  concorde: {
    id: 'concorde',
    name: 'Concorde (SST Cruiser)',
    category: 'Supersonic',
    description: 'Slender ogival delta wing optimized for Mach 2.04 cruise. Sharp leading edge producing sharp Mach shockwaves.',
    wingspan: 25.6,
    chord: 9.2,
    sweepDeg: 55,
    stallAngle: 19,
    cl0: 0.05,
    clMax: 1.40,
    cd0: 0.015,
    flapCapable: false,
    supersonicCapable: true,
    glbPath: '/models/concorde_free_with_interior.glb',
    hasGlbModel: true,
  },
  cylinder: {
    id: 'cylinder',
    name: 'Circular Cylinder (Bluff Body)',
    category: 'Bluff Body',
    description: 'Classic fluid dynamics baseline object showcasing symmetric boundary layer separation and von Kármán vortex streets.',
    wingspan: 5.0,
    chord: 2.0,
    sweepDeg: 0,
    stallAngle: 0,
    cl0: 0.0,
    alphaZeroLift: 0.0,
    clMax: 0.2,
    cd0: 1.15,
    flapCapable: false,
    supersonicCapable: false,
  }
};

/**
 * International Standard Atmosphere (ISA) calculations at given altitude in feet,
 * including Sutherland's law dynamic viscosity μ(T).
 */
export function getAtmosphere(altitude_ft: number) {
  const alt_m = Math.max(0, Math.min(altitude_ft * 0.3048, 16000));
  const T0 = 288.15; // Sea level standard temp in K
  const P0 = 101325; // Sea level pressure in Pa
  const L = 0.0065; // Troposphere temperature lapse rate K/m
  const R = 287.058; // Specific gas constant J/(kg·K)
  const gamma = 1.4; // Adiabatic index
  const g0 = 9.80665; // Standard gravity m/s^2
  const tropopause_m = 11000;

  let T: number;
  let P: number;
  if (alt_m <= tropopause_m) {
    T = T0 - L * alt_m;
    P = P0 * Math.pow(T / T0, 5.25588);
  } else {
    const T11 = T0 - L * tropopause_m;
    const P11 = P0 * Math.pow(T11 / T0, 5.25588);
    T = T11;
    P = P11 * Math.exp((-g0 * (alt_m - tropopause_m)) / (R * T11));
  }

  const rho = P / (R * T); // kg/m^3
  const speedOfSound = Math.sqrt(gamma * R * T); // m/s

  // Sutherland's formula for dynamic viscosity of air (Pa·s)
  const mu0 = 1.7894e-5; // ISA sea-level reference viscosity at 288.15 K
  const sutherlandC = 110.4; // K
  const dynamicViscosity =
    mu0 * Math.pow(T / T0, 1.5) * ((T0 + sutherlandC) / (T + sutherlandC));

  return {
    altitude_m: alt_m,
    temperature_K: T,
    pressure_Pa: P,
    density_kg_m3: rho,
    dynamicViscosity_Pa_s: dynamicViscosity,
    speedOfSound_ms: speedOfSound,
    speedOfSound_kts: speedOfSound * 1.94384,
  };
}

/**
 * NACA 4-digit airfoil profile generator (normalized chord 0 to 1)
 */
function generateNaca4Digit(m: number, p: number, t: number, numPoints = 60, flapDeg = 0): Point2D[] {
  const upper: Point2D[] = [];
  const lower: Point2D[] = [];

  for (let i = 0; i <= numPoints; i++) {
    // Cosine spacing clustering points near leading edge
    const beta = (Math.PI * i) / numPoints;
    const x = 0.5 * (1 - Math.cos(beta));

    // Thickness distribution
    const yt = 5 * t * (
      0.2969 * Math.sqrt(Math.max(0.00001, x)) -
      0.1260 * x -
      0.3516 * Math.pow(x, 2) +
      0.2843 * Math.pow(x, 3) -
      0.1015 * Math.pow(x, 4)
    );

    // Camber and gradient
    let yc = 0;
    let dyc_dx = 0;

    if (p > 0 && m > 0) {
      if (x < p) {
        yc = (m / Math.pow(p, 2)) * (2 * p * x - Math.pow(x, 2));
        dyc_dx = ((2 * m) / Math.pow(p, 2)) * (p - x);
      } else {
        yc = (m / Math.pow(1 - p, 2)) * ((1 - 2 * p) + 2 * p * x - Math.pow(x, 2));
        dyc_dx = ((2 * m) / Math.pow(1 - p, 2)) * (p - x);
      }
    }

    // Apply trailing-edge flap deflection if active (> 70% chord)
    let flapYOffset = 0;
    if (flapDeg > 0 && x > 0.7) {
      const flapRad = (flapDeg * Math.PI) / 180;
      const flapHinge = 0.7;
      flapYOffset = -(x - flapHinge) * Math.sin(flapRad);
    }

    const theta = Math.atan(dyc_dx);
    const xu = x - yt * Math.sin(theta);
    const yu = yc + yt * Math.cos(theta) + flapYOffset;
    const xl = x + yt * Math.sin(theta);
    const yl = yc - yt * Math.cos(theta) + flapYOffset;

    upper.push({ x: xu, y: yu });
    lower.push({ x: xl, y: yl });
  }

  // Combine: from trailing edge along lower surface to leading edge, then along upper surface to trailing edge
  const polygon: Point2D[] = [];
  for (let i = lower.length - 1; i >= 0; i--) {
    polygon.push(lower[i]);
  }
  for (let i = 1; i < upper.length; i++) {
    polygon.push(upper[i]);
  }

  return polygon;
}

/**
 * F-22 Raptor Jet profile generator (normalized chord ~ -0.5 to 0.5)
 */
function generateF22Profile(): Point2D[] {
  // Authentic side cross-section coordinates with chined nose, canopy, dorsal spine, twin engines, afterburner nozzle
  const rawPoints: [number, number][] = [
    [-0.50, 0.00],   // Pitot nose tip
    [-0.44, 0.025],  // Chined forebody
    [-0.35, 0.05],   // Cockpit canopy start
    [-0.24, 0.09],   // Cockpit apex
    [-0.14, 0.075],  // Canopy aft blend
    [-0.05, 0.065],  // Dorsal fuselage
    [0.10, 0.055],   // Wing root blend
    [0.25, 0.045],   // Engine hump
    [0.40, 0.035],   // Tailcone
    [0.48, 0.030],   // 2D Thrust vectoring nozzle upper
    [0.50, 0.000],   // Nozzle center
    [0.48, -0.025],  // Nozzle lower
    [0.38, -0.035],  // Engine lower bay
    [0.18, -0.045],  // Main weapon bay belly
    [-0.02, -0.060], // Lower inlet duct
    [-0.15, -0.070], // Caret inlet lip
    [-0.28, -0.040], // Forward lower chine
    [-0.42, -0.015], // Lower radome
  ];

  return rawPoints.map(([x, y]) => ({ x: x + 0.5, y }));
}

/**
 * Boeing 787 Airliner profile generator with flap capability
 */
function generateAirlinerProfile(flapDeg = 0): Point2D[] {
  const flapRad = (Math.max(0, flapDeg) * Math.PI) / 180;
  const flapDY = flapDeg > 0 ? Math.sin(flapRad) * 0.08 : 0;
  const flapDX = flapDeg > 0 ? (1 - Math.cos(flapRad)) * 0.03 : 0;

  const rawPoints: [number, number][] = [
    [-0.50, 0.01],
    [-0.46, 0.04],
    [-0.38, 0.08],  // Flight deck cockpit
    [-0.28, 0.095], // Forward cabin roof
    [-0.10, 0.09],  // Mid fuselage
    [0.05, 0.12],   // Wing-to-body fairing / wing crest
    [0.22, 0.07],   // Aft wing fairing
    [0.35 - flapDX, 0.04 - flapDY], // Upper trailing edge / flap
    [0.48 - flapDX, 0.01 - flapDY], // Flap tip
    [0.44 - flapDX, -0.03 - flapDY],// Flap bottom
    [0.25, -0.04],  // Lower wing root
    [0.10, -0.12],  // Engine pylon / nacelle bottom
    [-0.02, -0.14], // Engine inlet bottom
    [-0.05, -0.09], // Engine cowl inside
    [-0.15, -0.05], // Forward belly
    [-0.32, -0.05], // Nose gear well
    [-0.45, -0.02], // Radome lower
  ];

  return rawPoints.map(([x, y]) => ({ x: x + 0.5, y }));
}

/**
 * Concorde Supersonic Ogive profile generator
 */
function generateConcordeProfile(): Point2D[] {
  const rawPoints: [number, number][] = [
    [-0.52, 0.00],  // Needle probe
    [-0.46, 0.015], // Droop nose cap
    [-0.34, 0.035], // Visor windshield
    [-0.18, 0.042], // Slender fuselage
    [0.02, 0.038],  // Ogival wing root
    [0.22, 0.030],  // Delta wing deck
    [0.42, 0.020],  // Elevon trailing edge
    [0.50, 0.015],  // Tail nozzle
    [0.48, -0.015], // Lower nozzle
    [0.26, -0.035], // Olympus engine box
    [0.08, -0.040], // Double engine intake ramp
    [-0.08, -0.025],// Lower fuselage
    [-0.26, -0.022],// Forward fuselage
    [-0.44, -0.012],// Lower nose
  ];

  return rawPoints.map(([x, y]) => ({ x: x + 0.5, y }));
}

/**
 * Circular Cylinder profile
 */
function generateCylinderProfile(numPoints = 36): Point2D[] {
  const pts: Point2D[] = [];
  const radius = 0.22;
  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;
    pts.push({
      x: 0.5 + Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return pts;
}

/**
 * Get base polygon for model type
 */
export function getBasePolygon(type: AircraftModelType, flapDeg = 0): Point2D[] {
  switch (type) {
    case 'f22':
      return generateF22Profile();
    case 'airliner':
      return generateAirlinerProfile(flapDeg);
    case 'naca2412':
      return generateNaca4Digit(0.02, 0.4, 0.12, 60, flapDeg);
    case 'naca0012':
      return generateNaca4Digit(0.0, 0.0, 0.12, 60, flapDeg);
    case 'concorde':
      return generateConcordeProfile();
    case 'cylinder':
      return generateCylinderProfile();
    default:
      return generateNaca4Digit(0.02, 0.4, 0.12, 60, flapDeg);
  }
}

/**
 * Scale and rotate model polygon by Angle of Attack in canvas screen coordinates
 */
export function transformModelPolygon(
  basePolygon: Point2D[],
  cx: number,
  cy: number,
  chordLengthPx: number,
  aoaDeg: number
): Point2D[] {
  // In aerodynamics, positive AoA pitches the nose UP.
  // In canvas, screen Y is inverted (0 at top, height at bottom).
  const aoaRad = (aoaDeg * Math.PI) / 180;
  const cosA = Math.cos(aoaRad);
  const sinA = Math.sin(aoaRad);

  // Aerodynamic center / pivot is at 25% chord (x = 0.25)
  const pivotX = 0.25;
  const pivotY = 0.0;

  return basePolygon.map((p) => {
    // Relative to pivot (Cartesian: x right, y up)
    const rx = (p.x - pivotX) * chordLengthPx;
    const ry = (p.y - pivotY) * chordLengthPx;

    // Rotate pitch: AoA > 0 pitches nose up (rotY > 0)
    const rotX = rx * cosA + ry * sinA;
    const rotY = -rx * sinA + ry * cosA;

    return {
      x: cx + rotX,
      y: cy - rotY, // Canvas screen Y increases downwards
    };
  });
}

/**
 * Calculate outward surface normal vectors and chord fraction for pressure visualization
 */
export function getSurfacePointsWithNormals(polygon: Point2D[]): PolygonSurfacePoint[] {
  const result: PolygonSurfacePoint[] = [];
  const n = polygon.length;
  if (n < 3) return result;

  // Find min/max X to compute chord fraction
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const chord = Math.max(1, maxX - minX);

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    // Tangent vector
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;

    // Outward normal in screen space (pointing away from interior)
    const nx = dy / len;
    const ny = -dx / len;

    const chordFraction = Math.max(0, Math.min(1, (curr.x - minX) / chord));
    const isUpper = ny < 0; // Negative Y in canvas is UP

    result.push({
      x: curr.x,
      y: curr.y,
      nx,
      ny,
      isUpper,
      chordFraction,
    });
  }

  return result;
}

/**
 * Fast Point-in-Polygon test (Ray casting algorithm)
 */
export function isPointInPolygon(px: number, py: number, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns positive and negative critical stall angles (as positive magnitudes in degrees).
 * Symmetric zero-camber sections (e.g. NACA 0012 with 0 flaps) have symmetric stall angles.
 */
export function getEffectiveStallAngles(
  type: AircraftModelType,
  flapDeg = 0
): { posStallAngle: number; negStallAngle: number } {
  const config = AIRCRAFT_MODELS[type];
  if (config.stallAngle <= 0) {
    return { posStallAngle: 0, negStallAngle: 0 };
  }
  const effectiveFlap = config.flapCapable ? flapDeg : 0;
  const posStallAngle = Math.max(4, config.stallAngle - (effectiveFlap > 15 ? 2.5 : 0));
  const isSymmetric = config.cl0 === 0 && effectiveFlap === 0;
  const negStallAngle = isSymmetric
    ? posStallAngle
    : Number((posStallAngle * 0.8).toFixed(1));
  return { posStallAngle, negStallAngle };
}

/**
 * Finite-wing lift curve slope CLα (per degree) incorporating aspect ratio,
 * quarter-chord sweep, and compressibility (Helmbold + Prandtl-Glauert subsonic,
 * smooth transonic blend, and Ackeret finite-wing supersonic theory).
 */
export function calculateFiniteWingLiftSlopePerDeg(
  aspectRatio: number,
  sweepDeg: number,
  mach: number
): number {
  const ar = Math.max(1.5, aspectRatio);
  const tanSweep = Math.tan((sweepDeg * Math.PI) / 180);

  const helmboldSubsonicRad = (m: number) => {
    const beta = Math.sqrt(Math.max(0.1, 1 - m * m));
    const sweepTerm = 1 + (tanSweep * tanSweep) / (beta * beta);
    return (
      (2 * Math.PI * ar) /
      (2 + Math.sqrt(4 + ar * ar * beta * beta * sweepTerm))
    );
  };

  const ackeretSupersonicRad = (m: number) => {
    const betaSup = Math.sqrt(Math.max(0.05, m * m - 1));
    const arBeta = ar * betaSup;
    const tipFactor = arBeta >= 1 ? 1 - 1 / (2 * arBeta) : 0.5 * arBeta;
    return (4 / betaSup) * Math.max(0.25, tipFactor);
  };

  let slopePerRad: number;
  if (mach <= 0.82) {
    slopePerRad = helmboldSubsonicRad(mach);
  } else if (mach >= 1.2) {
    slopePerRad = ackeretSupersonicRad(mach);
  } else {
    const t = (mach - 0.82) / (1.2 - 0.82);
    const w = 0.5 - 0.5 * Math.cos(Math.PI * t);
    slopePerRad =
      (1 - w) * helmboldSubsonicRad(0.82) + w * ackeretSupersonicRad(1.2);
  }

  return slopePerRad * (Math.PI / 180);
}

/**
 * Calculate Aerodynamic Lift, Drag, and Flow coefficients
 */
export function calculateAeroTelemetry(
  type: AircraftModelType,
  aoaDeg: number,
  airspeedKts: number,
  altitudeFt: number,
  flapDeg: number
): import('../types/aerodynamics').AeroTelemetry {
  const config = AIRCRAFT_MODELS[type];
  const atmo = getAtmosphere(altitudeFt);
  const v_ms = airspeedKts * 0.514444; // kts to m/s
  const mach = v_ms / atmo.speedOfSound_ms;
  const rho = atmo.density_kg_m3;
  const dynP = 0.5 * rho * v_ms * v_ms; // dynamic pressure q (Pa)

  // Reynolds number based on mean chord and Sutherland viscosity at altitude
  const reynolds = (rho * v_ms * config.chord) / atmo.dynamicViscosity_Pa_s;

  // Flap lift & parasite drag increments
  const effectiveFlap = config.flapCapable ? Math.max(0, flapDeg) : 0;
  const flapLiftBonus = config.flapCapable ? (effectiveFlap / 40) * 0.45 : 0;
  const flapDragBonus = config.flapCapable ? Math.pow(effectiveFlap / 40, 2) * 0.08 : 0;

  const { posStallAngle, negStallAngle } = getEffectiveStallAngles(type, effectiveFlap);
  const isStalled =
    config.stallAngle > 0 &&
    (aoaDeg >= posStallAngle || aoaDeg <= -negStallAngle);
  const degPastStall = isStalled
    ? Math.max(0, aoaDeg >= 0 ? aoaDeg - posStallAngle : -aoaDeg - negStallAngle)
    : 0;
  const stallMargin =
    config.stallAngle > 0
      ? Math.min(posStallAngle - aoaDeg, aoaDeg - -negStallAngle)
      : 90;

  let cl = 0;
  let cd = config.cd0 + flapDragBonus;

  // Cylinder special handling
  if (type === 'cylinder') {
    cl = 0.05 * Math.sin((aoaDeg * Math.PI) / 180);
    cd = 1.15 + 0.1 * Math.sin(Math.abs(aoaDeg * 0.1));
  } else {
    const aspectRatio = config.wingspan / config.chord;
    const sweepDeg = config.sweepDeg ?? 0;
    const liftSlopePerDeg = calculateFiniteWingLiftSlopePerDeg(aspectRatio, sweepDeg, mach);

    // 2D thin-airfoil incompressible slope ~ 2*pi rad^-1 = 0.10966 / deg
    const thinAirfoilSlopePerDeg = (2 * Math.PI * Math.PI) / 180;
    const alphaZeroLift =
      config.alphaZeroLift ?? -(config.cl0 / thinAirfoilSlopePerDeg);

    const linearCl = (aoa: number) =>
      liftSlopePerDeg * (aoa - alphaZeroLift) + flapLiftBonus;

    const clMaxEff = config.clMax + flapLiftBonus;
    const isSymmetric = config.cl0 === 0 && effectiveFlap === 0;
    const clMinEff = isSymmetric ? -config.clMax : -config.clMax * 0.85 + flapLiftBonus * 0.5;

    if (!isStalled) {
      cl = Math.max(clMinEff, Math.min(clMaxEff, linearCl(aoaDeg)));
    } else if (aoaDeg >= 0) {
      // Positive stall lift breakdown (continuous from attached peak at posStallAngle)
      const clPeak = Math.min(clMaxEff, Math.max(0.2, linearCl(posStallAngle)));
      cl =
        clPeak *
        Math.exp(-degPastStall * 0.08) *
        Math.max(0, Math.cos((degPastStall * Math.PI) / 60));
      cl = Math.max(0.15, cl);
    } else {
      // Negative stall lift breakdown (continuous from negative peak; always strictly negative)
      const clNegPeak = Math.max(clMinEff, Math.min(-0.2, linearCl(-negStallAngle)));
      cl =
        clNegPeak *
        Math.exp(-degPastStall * 0.08) *
        Math.max(0, Math.cos((degPastStall * Math.PI) / 60));
      cl = Math.min(-0.15, cl);
    }

    // Induced drag: Cdi = Cl^2 / (pi * e * AR)
    const oswaldEfficiency = 0.82;
    const cdi = Math.pow(cl, 2) / (Math.PI * oswaldEfficiency * Math.max(2, aspectRatio));

    // Separation drag in stall (degPastStall is guaranteed >= 0)
    const separationDrag = isStalled
      ? Math.min(0.85, Math.pow(degPastStall / 10, 1.8) * 0.35)
      : 0;

    // Transonic / Supersonic wave drag
    let waveDrag = 0;
    const mCrit = config.supersonicCapable ? 0.92 : 0.78;
    if (mach > mCrit) {
      if (mach <= 1.05) {
        waveDrag = 0.04 * Math.pow((mach - mCrit) / (1.05 - mCrit), 2);
      } else {
        waveDrag = 0.035 / Math.sqrt(Math.max(0.01, Math.pow(mach, 2) - 1));
      }
    }

    cd = config.cd0 + flapDragBonus + cdi + separationDrag + waveDrag;
  }

  // Lift and drag in Newtons: F = q * S * C
  const wingArea = config.wingspan * config.chord;
  const lift_N = cl * dynP * wingArea;
  const drag_N = cd * dynP * wingArea;
  const ldRatio = cd > 0.0001 ? cl / cd : 0;

  // Determine flow state classification
  let flowState: import('../types/aerodynamics').AeroTelemetry['flowState'] = 'Laminar';
  if (mach >= 1.2) {
    flowState = 'Supersonic Wave';
  } else if (mach >= 0.85) {
    flowState = 'Transonic Shock';
  } else if (isStalled && degPastStall > 4) {
    flowState = 'Deep Stall';
  } else if (isStalled) {
    flowState = 'Incipient Stall';
  } else if (reynolds > 500000) {
    flowState = 'Attached Turbulent';
  } else {
    flowState = 'Laminar';
  }

  return {
    cl: Number(cl.toFixed(3)),
    cd: Number(cd.toFixed(3)),
    ldRatio: Number(ldRatio.toFixed(2)),
    lift_N: Math.round(lift_N),
    drag_N: Math.round(drag_N),
    reynolds: Math.round(reynolds),
    mach: Number(mach.toFixed(2)),
    dynamic_pressure_pa: Math.round(dynP),
    air_density_kg_m3: Number(rho.toFixed(4)),
    isStalled,
    stallMargin: Number(stallMargin.toFixed(1)),
    flowState,
  };
}
