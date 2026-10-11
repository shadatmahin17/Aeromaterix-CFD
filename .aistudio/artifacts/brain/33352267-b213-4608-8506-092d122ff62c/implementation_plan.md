# Aerodynamic CFD Fluid Dynamics & Model Realignment Plan

Comprehensive architectural and engineering plan to resolve the 3D model misalignments visible in the wind tunnel simulation and upgrade the aerodynamic fluid dynamics engine with authentic CFD principles (camber contouring, boundary layer deflection, trailing-edge downwash, and wingtip vortices).

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on your selections during Phase 1 clarification, the following architecture decisions are locked in for implementation:

- **Strict Unified Coordinate System**: All aircraft models (Boeing 787 Dreamliner, F-22 Raptor, Concorde SST, and NACA airfoils) will be re-aligned so that their nose points strictly upstream into the oncoming wind (`-X`), their tail points downstream (`+X`), wingspan extends along the lateral `Z` axis (starboard `-Z`, port `+Z`), and canopy/vertical stabilizers point vertically upwards (`+Y`).
- **Aerodynamic CFD Physics**: The flow calculation engine (`FluidDynamics3D.ts`) will be upgraded from basic heuristic offsets to a robust potential-flow with boundary-element deflection model featuring:
  1. **Solid Boundary Contour Advection**: Streamlines and particles wrap smoothly around fuselage and airfoils without penetrating solid geometry.
  2. **Bernoulli Suction Acceleration**: Air traveling over the upper cambered surface accelerates (`u > vInf`, negative $C_p$), while under-wing flow compresses ($C_p > 0$).
  3. **Trailing-Edge Downwash**: Kutta circulation induces a realistic downward deflection behind the wings proportional to the lift coefficient ($C_L$) and angle of attack.
  4. **Lamb-Oseen Wingtip Vortices**: Air rolls from high-pressure under-wing surfaces to low-pressure upper surfaces at the wingtips, forming authentic trailing helical vortex tubes.
  5. **Boundary Layer Separation & Stall Wake**: At high AoA or stall, flow detaches over the aft chord, shedding turbulent recirculating eddies into a widened wake deficit zone.

---

## 1. Root Cause Analysis of Visible Misalignment

```
CURRENT DEFECTS OBSERVED IN USER SCREENSHOTS:
─────────────────────────────────────────────────────────────────────────────
1. Boeing 787 Airliner (Screenshot 1):
   • Model was rotated by +90° along Y axis, placing the fuselage sideways/diagonal
     relative to the flow vectors.
   • Streamlines crossed laterally across the fuselage and pierced through the wing.
   • Force vectors (Lift/Drag) pointed at an awkward angle relative to the wing chord.

2. F-22 Raptor (Screenshot 2):
   • Model was loaded with 0° rotation offset, but the native GLTF CAD geometry had
     its nose pointing towards +X.
   • This caused the aircraft to face 180° backwards: oncoming wind hit the twin exhaust
     nozzles and vertical stabilizers first, leaving through the radome nose!

3. Streamline & Particle Field Behavior:
   • Streamline rake emitter did not match the geometry's leading-edge profile.
   • Particles floated in a uniform rectangular grid rather than concentrating along
     streamtubes and shedding off wingtips into the aerodynamic wake.
─────────────────────────────────────────────────────────────────────────────
```

---

## 2. Technical Architecture & Component Changes

### Component 1: Model Alignment Standardization (`aircraftGlbModels.ts` & `aircraft3DGeometry.ts`)

| Model | Native GLTF Orientation | Required Euler Correction `[X, Y, Z]` | Verified Outcome |
| :--- | :--- | :--- | :--- |
| **Boeing 787 Airliner** | Length along Z, Nose at +Z | `[0, -Math.PI / 2, 0]` | Nose at -X, Tail at +X, Wings along Z |
| **F-22 Raptor** | Length along X, Nose at +X | `[0, Math.PI, 0]` | Nose at -X, Tail at +X, Twin tails at +X |
| **Concorde SST** | Length along Z, Nose at -Z | `[0, Math.PI / 2, 0]` | Ogival delta nose at -X, Tail at +X |
| **NACA 2412 / 0012** | Chord along X, LE at +X | `[0, Math.PI, 0]` | Leading edge at -X, Trailing edge at +X |

We will also implement an automatic validation check on model load that verifies the bounding box extents and ensures the centroid and nose tip are situated on the negative X axis.

---

### Component 2: High-Fidelity CFD Engine Overhaul (`FluidDynamics3D.ts`)

```
             ┌──────────────────────────────────────────────────┐
             │       UPSTREAM INLET FLOW (u = vInf, -X)         │
             └────────────────────────┬─────────────────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│       UPPER CAMBER FLOW       │       │       LOWER CAMBER FLOW       │
│  - Acceleration (u > vInf)    │       │  - Deceleration / Compression │
│  - Negative pressure peak     │       │  - Positive pressure (Cp > 0) │
│  - Boundary layer thinning    │       │  - Trailing edge boundary     │
└───────────────┬───────────────┘       └───────────────┬───────────────┘
                │                                       │
                └───────────────────┬───────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        KUTTA CONDITION AT TE                          │
│  Downwash angle w = -vInf * (CL / (pi * AR * e))                      │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│     LAMB-OSEEN WINGTIP VORTICES │   │    TURBULENT WAKE DEFICIT       │
│  - Helical swirl (v_theta)      │   │  - Viscous drag momentum loss   │
│  - Roll-up from lower to upper  │   │  - Unsteady vortex shedding     │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

#### Mathematical Formulations:
1. **Solid Surface Boundary Avoidance (Ellipsoid + Cambered Surface)**:
   $$\vec{v}_{\text{deflected}} = \vec{v}_{\infty} - \frac{R^3}{r^3} \left[ \vec{v}_{\infty} - 3(\vec{v}_{\infty} \cdot \hat{n})\hat{n} \right]$$
   Prevents streamlines and particles from penetrating the fuselage or wing surfaces.

2. **Downwash Induced Angle**:
   $$w_{\text{downwash}} = -v_{\infty} \cdot \sin(\alpha) \cdot \left(0.5 + 0.5 \cdot \tanh\left(\frac{x - x_{\text{TE}}}{2.0}\right)\right)$$
   Smoothly deflects the flow downward behind the trailing edge, matching actual aerodynamic downwash.

3. **Lamb-Oseen Wingtip Vortex Velocity**:
   $$v_{\theta}(r) = \frac{\Gamma}{2\pi r} \left(1 - e^{-r^2 / r_c^2}\right)$$
   Where $\Gamma \propto C_L \cdot v_{\infty} \cdot c_{\text{mean}}$, curling the smoke filaments into distinct spiral vortices at both wingtips.

---

### Component 3: Wind Tunnel Visualization & Smoke Ribbon Rendering

- **Dual Visualization Modes**:
  1. **Continuous Streamlines**: 3D extruded tubes with scientific velocity colormap (Cyan = high speed / suction, Emerald = laminar free-stream, Amber = stagnation, Crimson = turbulent separation).
  2. **High-Density Particle Smoke**: Particles emitted from upstream rake needles at `x = -18`, carrying local streamline velocities, curling around wingtips, and exhibiting micro-turbulence in the wake.
- **Rake Positioning**: Multi-height rake grid spanning the wingspan and fuselage height, automatically scaled according to the active aircraft's wingspan and chord length.
- **Interactive Controls**: Users can toggle Streamlines, Smoke Particles, Force Vectors, and Pressure Heatmap seamlessly.

---

## 3. Verification & Validation Steps

1. **Orientation Audit**:
   - Verify Turkish Airlines Boeing 787 Dreamliner nose points upstream into the wind tunnel, wings extend symmetrically along the Z axis, and fuselage aligns with the floor rails.
   - Verify F-22 Raptor stealth fighter faces forward into the oncoming wind with twin vertical tails downstream.
   - Verify Concorde and NACA airfoil models are aligned consistently.
2. **CFD Physics Audit**:
   - Verify streamlines smoothly wrap over the nose and canopy without clipping.
   - Verify downwash clearly bends downward behind the wing trailing edge as angle of attack increases.
   - Verify wingtip vortices produce visible curling spirals at the wingtips.
   - Verify stall condition ($AoA > 16^\circ$) triggers separation and turbulent eddy shedding.
3. **Build & Performance**:
   - Run `compile_applet` and `lint_applet` to confirm clean compilation and smooth 60 FPS rendering in WebGL.
