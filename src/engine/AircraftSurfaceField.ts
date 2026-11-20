import * as THREE from 'three';
import { Aircraft3DMeshData } from '../utils/aircraft3DGeometry';

export interface SpanSectionInfo {
  leX: number;
  teX: number;
  quarterChordX: number;
  chord: number;
  yMid: number;
  thickness: number;
}

export interface SurfaceSample {
  dist: number;
  nx: number;
  ny: number;
  nz: number;
  inside: boolean;
}

/**
 * Spatial Vertex & Signed Surface Distance Field (SDF) extracted directly from
 * 3D aircraft mesh triangles and vertices.
 *
 * Uses dense triangle surface sampling + 26-connected 3D Euclidean Distance
 * Transform + 6-connected exterior flood-fill (BFS) so `dist` is a true SIGNED
 * distance (`dist < 0` inside the solid body, `dist == 0` on the skin,
 * `dist > 0` in surrounding air). As a result, grad(sdf) points strictly
 * OUTWARD both outside and deep inside the aircraft/airfoil/cylinder.
 */
export class AircraftSurfaceField {
  public readonly minX: number;
  public readonly maxX: number;
  public readonly minY: number;
  public readonly maxY: number;
  public readonly minZ: number;
  public readonly maxZ: number;
  public readonly halfSpan: number;
  public readonly meanChord: number;

  private readonly nx = 72;
  private readonly ny = 40;
  private readonly nz = 72;

  private readonly padMinX: number;
  private readonly padMinY: number;
  private readonly padMinZ: number;
  private readonly padMaxX: number;
  private readonly padMaxY: number;
  private readonly padMaxZ: number;
  private readonly dx: number;
  private readonly dy: number;
  private readonly dz: number;
  private readonly invDx: number;
  private readonly invDy: number;
  private readonly invDz: number;

  // Signed distance grid: < 0 inside solid body, > 0 outside in air
  private readonly sdfGrid: Float32Array;

  // Spanwise leading/trailing edge profile (Z from -halfSpan to +halfSpan)
  private readonly spanSlices = 32;
  private readonly sliceLeX: Float32Array;
  private readonly sliceTeX: Float32Array;
  private readonly sliceYMid: Float32Array;
  private readonly sliceThick: Float32Array;
  private readonly sliceHasGeo: Uint8Array;

  private constructor(
    points: Float32Array,
    pointCount: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  ) {
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minY = bounds.minY;
    this.maxY = bounds.maxY;
    this.minZ = bounds.minZ;
    this.maxZ = bounds.maxZ;
    this.halfSpan = Math.max(1.0, Math.abs(bounds.minZ), Math.abs(bounds.maxZ));

    const pad = 1.8;
    this.padMinX = bounds.minX - pad;
    this.padMinY = bounds.minY - pad;
    this.padMinZ = bounds.minZ - pad;
    this.padMaxX = bounds.maxX + pad;
    this.padMaxY = bounds.maxY + pad;
    this.padMaxZ = bounds.maxZ + pad;

    const sizeX = Math.max(2, this.padMaxX - this.padMinX);
    const sizeY = Math.max(2, this.padMaxY - this.padMinY);
    const sizeZ = Math.max(2, this.padMaxZ - this.padMinZ);

    this.dx = sizeX / (this.nx - 1);
    this.dy = sizeY / (this.ny - 1);
    this.dz = sizeZ / (this.nz - 1);
    this.invDx = (this.nx - 1) / sizeX;
    this.invDy = (this.ny - 1) / sizeY;
    this.invDz = (this.nz - 1) / sizeZ;

    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    const total = nx * ny * nz;

    const distGrid = new Float32Array(total);
    const surfX = new Float32Array(total);
    const surfY = new Float32Array(total);
    const surfZ = new Float32Array(total);
    distGrid.fill(1e6);

    this.sdfGrid = new Float32Array(total);

    this.sliceLeX = new Float32Array(this.spanSlices);
    this.sliceTeX = new Float32Array(this.spanSlices);
    this.sliceYMid = new Float32Array(this.spanSlices);
    this.sliceThick = new Float32Array(this.spanSlices);
    this.sliceHasGeo = new Uint8Array(this.spanSlices);

    const sliceMinY = new Float32Array(this.spanSlices).fill(1e6);
    const sliceMaxY = new Float32Array(this.spanSlices).fill(-1e6);
    this.sliceLeX.fill(1e6);
    this.sliceTeX.fill(-1e6);

    // 1. Splat dense mesh surface points into surrounding 2x2x2 voxel corners
    for (let i = 0; i < pointCount; i++) {
      const px = points[i * 3];
      const py = points[i * 3 + 1];
      const pz = points[i * 3 + 2];

      const sNorm = (pz + this.halfSpan) / (2 * this.halfSpan);
      const sIdx = Math.max(0, Math.min(this.spanSlices - 1, Math.floor(sNorm * this.spanSlices)));
      this.sliceHasGeo[sIdx] = 1;
      if (px < this.sliceLeX[sIdx]) this.sliceLeX[sIdx] = px;
      if (px > this.sliceTeX[sIdx]) this.sliceTeX[sIdx] = px;
      if (py < sliceMinY[sIdx]) sliceMinY[sIdx] = py;
      if (py > sliceMaxY[sIdx]) sliceMaxY[sIdx] = py;

      const gx0 = Math.floor((px - this.padMinX) * this.invDx);
      const gy0 = Math.floor((py - this.padMinY) * this.invDy);
      const gz0 = Math.floor((pz - this.padMinZ) * this.invDz);

      for (let oz = 0; oz <= 1; oz++) {
        const gz = gz0 + oz;
        if (gz < 0 || gz >= nz) continue;
        const cz = this.padMinZ + gz * this.dz;
        for (let oy = 0; oy <= 1; oy++) {
          const gy = gy0 + oy;
          if (gy < 0 || gy >= ny) continue;
          const cy = this.padMinY + gy * this.dy;
          for (let ox = 0; ox <= 1; ox++) {
            const gx = gx0 + ox;
            if (gx < 0 || gx >= nx) continue;
            const cx = this.padMinX + gx * this.dx;
            const d = Math.hypot(cx - px, cy - py, cz - pz);
            const idx = (gz * ny + gy) * nx + gx;
            if (d < distGrid[idx]) {
              distGrid[idx] = d;
              surfX[idx] = px;
              surfY[idx] = py;
              surfZ[idx] = pz;
            }
          }
        }
      }
    }

    // Finalize spanwise chord slices
    let chordSum = 0;
    let chordCount = 0;
    for (let s = 0; s < this.spanSlices; s++) {
      if (this.sliceHasGeo[s]) {
        this.sliceYMid[s] = 0.5 * (sliceMinY[s] + sliceMaxY[s]);
        this.sliceThick[s] = Math.max(0.18, sliceMaxY[s] - sliceMinY[s]);
        const c = Math.max(0.5, this.sliceTeX[s] - this.sliceLeX[s]);
        chordSum += c;
        chordCount++;
      } else {
        this.sliceLeX[s] = bounds.minX * 0.4;
        this.sliceTeX[s] = bounds.maxX * 0.6;
        this.sliceYMid[s] = 0;
        this.sliceThick[s] = 0.25;
      }
    }
    this.meanChord = chordCount > 0 ? chordSum / chordCount : Math.max(2.0, (bounds.maxX - bounds.minX) * 0.55);

    // 2. Full 26-connected two-pass 3D Euclidean Distance Transform propagation
    const propagate = (gx: number, gy: number, gz: number, ox: number, oy: number, oz: number) => {
      const nxIdx = gx + ox;
      const nyIdx = gy + oy;
      const nzIdx = gz + oz;
      if (nxIdx < 0 || nxIdx >= nx || nyIdx < 0 || nyIdx >= ny || nzIdx < 0 || nzIdx >= nz) return;

      const dstIdx = (gz * ny + gy) * nx + gx;
      const srcIdx = (nzIdx * ny + nyIdx) * nx + nxIdx;
      if (distGrid[srcIdx] > 1e5) return;

      const sx = surfX[srcIdx];
      const sy = surfY[srcIdx];
      const sz = surfZ[srcIdx];
      const cx = this.padMinX + gx * this.dx;
      const cy = this.padMinY + gy * this.dy;
      const cz = this.padMinZ + gz * this.dz;
      const d = Math.hypot(cx - sx, cy - sy, cz - sz);

      if (d < distGrid[dstIdx]) {
        distGrid[dstIdx] = d;
        surfX[dstIdx] = sx;
        surfY[dstIdx] = sy;
        surfZ[dstIdx] = sz;
      }
    };

    for (let gz = 0; gz < nz; gz++) {
      for (let gy = 0; gy < ny; gy++) {
        for (let gx = 0; gx < nx; gx++) {
          propagate(gx, gy, gz, -1, 0, 0);
          propagate(gx, gy, gz, 0, -1, 0);
          propagate(gx, gy, gz, 0, 0, -1);
          propagate(gx, gy, gz, -1, -1, 0);
          propagate(gx, gy, gz, -1, 0, -1);
          propagate(gx, gy, gz, 0, -1, -1);
          propagate(gx, gy, gz, -1, 1, 0);
          propagate(gx, gy, gz, -1, 0, 1);
          propagate(gx, gy, gz, 0, -1, 1);
          propagate(gx, gy, gz, -1, -1, -1);
        }
      }
    }

    for (let gz = nz - 1; gz >= 0; gz--) {
      for (let gy = ny - 1; gy >= 0; gy--) {
        for (let gx = nx - 1; gx >= 0; gx--) {
          propagate(gx, gy, gz, 1, 0, 0);
          propagate(gx, gy, gz, 0, 1, 0);
          propagate(gx, gy, gz, 0, 0, 1);
          propagate(gx, gy, gz, 1, 1, 0);
          propagate(gx, gy, gz, 1, 0, 1);
          propagate(gx, gy, gz, 0, 1, 1);
          propagate(gx, gy, gz, 1, -1, 0);
          propagate(gx, gy, gz, 1, 0, -1);
          propagate(gx, gy, gz, 0, 1, -1);
          propagate(gx, gy, gz, 1, 1, 1);
        }
      }
    }

    // 3. Build 6-separating surface shell and flood-fill exterior air from outer boundary
    const shellThresh = 0.62 * Math.max(this.dx, this.dy, this.dz);
    const shell = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (distGrid[i] <= shellThresh) {
        shell[i] = 1;
      }
    }

    const exterior = new Uint8Array(total);
    const queue = new Int32Array(total);
    let qHead = 0;
    let qTail = 0;

    const enqueue = (idx: number) => {
      if (!exterior[idx] && !shell[idx]) {
        exterior[idx] = 1;
        queue[qTail++] = idx;
      }
    };

    // Seed all 6 faces of the padded bounding box
    for (let gz = 0; gz < nz; gz++) {
      for (let gy = 0; gy < ny; gy++) {
        enqueue((gz * ny + gy) * nx);
        enqueue((gz * ny + gy) * nx + (nx - 1));
      }
    }
    for (let gz = 0; gz < nz; gz++) {
      for (let gx = 0; gx < nx; gx++) {
        enqueue(gz * ny * nx + gx);
        enqueue((gz * ny + (ny - 1)) * nx + gx);
      }
    }
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < nx; gx++) {
        enqueue(gy * nx + gx);
        enqueue(((nz - 1) * ny + gy) * nx + gx);
      }
    }

    const strideZ = nx * ny;
    while (qHead < qTail) {
      const idx = queue[qHead++];
      const gz = Math.floor(idx / strideZ);
      const rem = idx - gz * strideZ;
      const gy = Math.floor(rem / nx);
      const gx = rem - gy * nx;

      if (gx > 0) enqueue(idx - 1);
      if (gx < nx - 1) enqueue(idx + 1);
      if (gy > 0) enqueue(idx - nx);
      if (gy < ny - 1) enqueue(idx + nx);
      if (gz > 0) enqueue(idx - strideZ);
      if (gz < nz - 1) enqueue(idx + strideZ);
    }

    // 6-axis shell span containment fallback for any mesh with tiny CAD seam openings
    const inX = new Uint8Array(total);
    const inY = new Uint8Array(total);
    for (let gz = 0; gz < nz; gz++) {
      for (let gy = 0; gy < ny; gy++) {
        const row = (gz * ny + gy) * nx;
        let first = -1;
        let last = -1;
        for (let gx = 0; gx < nx; gx++) {
          if (shell[row + gx]) {
            if (first === -1) first = gx;
            last = gx;
          }
        }
        if (first !== -1) {
          for (let gx = first; gx <= last; gx++) inX[row + gx] = 1;
        }
      }
    }
    for (let gz = 0; gz < nz; gz++) {
      for (let gx = 0; gx < nx; gx++) {
        let first = -1;
        let last = -1;
        for (let gy = 0; gy < ny; gy++) {
          if (shell[(gz * ny + gy) * nx + gx]) {
            if (first === -1) first = gy;
            last = gy;
          }
        }
        if (first !== -1) {
          for (let gy = first; gy <= last; gy++) inY[(gz * ny + gy) * nx + gx] = 1;
        }
      }
    }

    const solid = new Uint8Array(total);
    for (let gx = 0; gx < nx; gx++) {
      for (let gy = 0; gy < ny; gy++) {
        let first = -1;
        let last = -1;
        for (let gz = 0; gz < nz; gz++) {
          if (shell[(gz * ny + gy) * nx + gx]) {
            if (first === -1) first = gz;
            last = gz;
          }
        }
        for (let gz = 0; gz < nz; gz++) {
          const idx = (gz * ny + gy) * nx + gx;
          const enclosedAll3 = first !== -1 && gz >= first && gz <= last && inX[idx] === 1 && inY[idx] === 1;
          if (!exterior[idx] || enclosedAll3) {
            solid[idx] = 1;
          }
        }
      }
    }

    // 4. Construct Signed Distance Field (negative inside solid, positive outside in air)
    const rawSdf = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      rawSdf[i] = solid[i] ? -Math.max(distGrid[i], 0.05) : distGrid[i];
    }

    // 5. Light 3D box smoothing preserving solid interior sign (C1-smooth outward normals)
    this.sdfGrid.set(rawSdf);
    for (let gz = 1; gz < nz - 1; gz++) {
      for (let gy = 1; gy < ny - 1; gy++) {
        for (let gx = 1; gx < nx - 1; gx++) {
          const cIdx = (gz * ny + gy) * nx + gx;
          const sum =
            rawSdf[cIdx] * 4 +
            rawSdf[cIdx - 1] +
            rawSdf[cIdx + 1] +
            rawSdf[cIdx - nx] +
            rawSdf[cIdx + nx] +
            rawSdf[cIdx - strideZ] +
            rawSdf[cIdx + strideZ];
          const avg = sum / 10;
          this.sdfGrid[cIdx] = solid[cIdx] ? Math.min(-0.04, avg) : avg;
        }
      }
    }
  }

  /**
   * Samples a triangle densely onto a point buffer so large faces have zero surface gaps.
   */
  private static sampleTriangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    targetStep: number,
    pushPt: (x: number, y: number, z: number) => void
  ): void {
    const e0 = Math.hypot(bx - ax, by - ay, bz - az);
    const e1 = Math.hypot(cx - bx, cy - by, cz - bz);
    const e2 = Math.hypot(ax - cx, ay - cy, az - cz);
    const maxEdge = Math.max(e0, e1, e2);

    if (maxEdge <= targetStep) {
      pushPt((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
      return;
    }

    const steps = Math.min(16, Math.max(2, Math.ceil(maxEdge / targetStep)));
    const invSteps = 1 / steps;
    for (let i = 0; i <= steps; i++) {
      const u = i * invSteps;
      for (let j = 0; j <= steps - i; j++) {
        const v = j * invSteps;
        const w = 1 - u - v;
        pushPt(
          ax * w + bx * u + cx * v,
          ay * w + by * u + cy * v,
          az * w + bz * u + cz * v
        );
      }
    }
  }

  /**
   * Extracts real mesh vertices + densely sampled triangles from a Three.js Group in pure body space.
   */
  public static fromThreeGroup(root: THREE.Group): AircraftSurfaceField | null {
    root.updateMatrixWorld(true);

    const meshes: THREE.Mesh[] = [];
    let totalVertices = 0;
    let totalTris = 0;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const pos = mesh.geometry?.attributes?.position;
        if (pos && pos.count > 0) {
          meshes.push(mesh);
          totalVertices += pos.count;
          const idx = mesh.geometry.index;
          totalTris += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        }
      }
    });

    if (meshes.length === 0 || totalVertices === 0) return null;

    // First pass: exact world-space (body-frame) bounds
    const vPos = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const vertStride = Math.max(1, Math.floor(totalVertices / 65000));
    for (const mesh of meshes) {
      const posAttr = mesh.geometry.attributes.position;
      const step = posAttr.count <= 64 ? 1 : vertStride;
      for (let i = 0; i < posAttr.count; i += step) {
        vPos.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        if (vPos.x < minX) minX = vPos.x;
        if (vPos.x > maxX) maxX = vPos.x;
        if (vPos.y < minY) minY = vPos.y;
        if (vPos.y > maxY) maxY = vPos.y;
        if (vPos.z < minZ) minZ = vPos.z;
        if (vPos.z > maxZ) maxZ = vPos.z;
      }
    }

    if (!isFinite(minX)) return null;

    const estDx = (maxX - minX + 3.6) / 71;
    const estDy = (maxY - minY + 3.6) / 39;
    const estDz = (maxZ - minZ + 3.6) / 71;
    const targetStep = Math.max(0.08, Math.min(estDx, estDy, estDz) * 0.55);

    const maxSamples = 95000;
    const pts = new Float32Array(maxSamples * 3);
    let count = 0;

    const pushPt = (x: number, y: number, z: number) => {
      if (count >= maxSamples) return;
      pts[count * 3] = x;
      pts[count * 3 + 1] = y;
      pts[count * 3 + 2] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      count++;
    };

    const triStride = totalTris <= 45000 ? 1 : Math.floor(totalTris / 45000);
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    for (const mesh of meshes) {
      if (count >= maxSamples) break;
      const geo = mesh.geometry;
      const posAttr = geo.attributes.position;
      const indexAttr = geo.index;

      const vStep = posAttr.count <= 64 ? 1 : vertStride;
      for (let i = 0; i < posAttr.count && count < maxSamples; i += vStep) {
        vPos.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        pushPt(vPos.x, vPos.y, vPos.z);
      }

      const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
      const tStep = triCount <= 64 ? 1 : triStride;
      for (let t = 0; t < triCount && count < maxSamples; t += tStep) {
        const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
        const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
        vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
        vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);
        AircraftSurfaceField.sampleTriangle(
          vA.x, vA.y, vA.z,
          vB.x, vB.y, vB.z,
          vC.x, vC.y, vC.z,
          targetStep,
          pushPt
        );
      }
    }

    if (count === 0) return null;
    return new AircraftSurfaceField(pts, count, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  /**
   * Builds a signed surface field directly from procedural Aircraft3DMeshData polygons.
   */
  public static fromProceduralMesh(mesh: Aircraft3DMeshData): AircraftSurfaceField | null {
    if (!mesh.vertices.length || !mesh.faces.length) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const v of mesh.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }

    const estDx = (maxX - minX + 3.6) / 71;
    const estDy = (maxY - minY + 3.6) / 39;
    const estDz = (maxZ - minZ + 3.6) / 71;
    const targetStep = Math.max(0.08, Math.min(estDx, estDy, estDz) * 0.55);

    const maxSamples = 65000;
    const pts = new Float32Array(maxSamples * 3);
    let count = 0;

    const pushSample = (x: number, y: number, z: number) => {
      if (count >= maxSamples) return;
      pts[count * 3] = x;
      pts[count * 3 + 1] = y;
      pts[count * 3 + 2] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      count++;
    };

    for (const v of mesh.vertices) {
      pushSample(v.x, v.y, v.z);
    }

    for (const face of mesh.faces) {
      const idx = face.indices;
      if (idx.length < 3) continue;
      const v0 = mesh.vertices[idx[0]];
      for (let i = 1; i < idx.length - 1; i++) {
        const v1 = mesh.vertices[idx[i]];
        const v2 = mesh.vertices[idx[i + 1]];
        AircraftSurfaceField.sampleTriangle(
          v0.x, v0.y, v0.z,
          v1.x, v1.y, v1.z,
          v2.x, v2.y, v2.z,
          targetStep,
          pushSample
        );
      }
    }

    if (count === 0) return null;
    return new AircraftSurfaceField(pts, count, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  /**
   * Trilinear interpolation of the signed distance grid at body-frame point (bx, by, bz).
   */
  private sampleTrilinearSdf(bx: number, by: number, bz: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (bx - this.padMinX) * this.invDx));
    const fy = Math.max(0, Math.min(this.ny - 1.001, (by - this.padMinY) * this.invDy));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (bz - this.padMinZ) * this.invDz));

    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;

    const nx = this.nx;
    const ny = this.ny;
    const strideZ = nx * ny;
    const base = z0 * strideZ + y0 * nx + x0;

    const d000 = this.sdfGrid[base];
    const d100 = this.sdfGrid[base + 1];
    const d010 = this.sdfGrid[base + nx];
    const d110 = this.sdfGrid[base + nx + 1];
    const d001 = this.sdfGrid[base + strideZ];
    const d101 = this.sdfGrid[base + strideZ + 1];
    const d011 = this.sdfGrid[base + strideZ + nx];
    const d111 = this.sdfGrid[base + strideZ + nx + 1];

    const c00 = d000 + (d100 - d000) * tx;
    const c10 = d010 + (d110 - d010) * tx;
    const c01 = d001 + (d101 - d001) * tx;
    const c11 = d011 + (d111 - d011) * tx;

    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;

    return c0 + (c1 - c0) * tz;
  }

  /**
   * O(1) C1-smooth lookup of signed surface distance (dist < 0 inside, > 0 outside)
   * and strictly outward normal (grad sdf) in aircraft body frame.
   */
  public sample(bx: number, by: number, bz: number, out: SurfaceSample): boolean {
    if (
      bx < this.padMinX ||
      bx > this.padMaxX ||
      by < this.padMinY ||
      by > this.padMaxY ||
      bz < this.padMinZ ||
      bz > this.padMaxZ
    ) {
      return false;
    }

    const dist = this.sampleTrilinearSdf(bx, by, bz);
    if (dist > 1e4) return false;

    const epsX = this.dx * 0.7;
    const epsY = this.dy * 0.7;
    const epsZ = this.dz * 0.7;

    let nx = this.sampleTrilinearSdf(bx + epsX, by, bz) - this.sampleTrilinearSdf(bx - epsX, by, bz);
    let ny = this.sampleTrilinearSdf(bx, by + epsY, bz) - this.sampleTrilinearSdf(bx, by - epsY, bz);
    let nz = this.sampleTrilinearSdf(bx, by, bz + epsZ) - this.sampleTrilinearSdf(bx, by, bz - epsZ);

    const nLen = Math.hypot(nx, ny, nz);
    if (nLen > 1e-5) {
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
    } else {
      nx = 0;
      ny = by >= 0 ? 1 : -1;
      nz = 0;
    }

    out.dist = dist;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.inside = dist <= 0.02;
    return true;
  }

  /**
   * Returns real spanwise chord & leading/trailing edge coordinates extracted from mesh vertices.
   */
  public getSpanSection(bz: number, out: SpanSectionInfo): boolean {
    if (Math.abs(bz) > this.halfSpan * 1.05) return false;
    const sNorm = Math.max(0, Math.min(0.9999, (bz + this.halfSpan) / (2 * this.halfSpan)));
    const sIdx = Math.floor(sNorm * this.spanSlices);
    if (!this.sliceHasGeo[sIdx]) return false;

    const leX = this.sliceLeX[sIdx];
    const teX = this.sliceTeX[sIdx];
    const chord = Math.max(0.6, teX - leX);
    out.leX = leX;
    out.teX = teX;
    out.quarterChordX = leX + 0.25 * chord;
    out.chord = chord;
    out.yMid = this.sliceYMid[sIdx];
    out.thickness = this.sliceThick[sIdx];
    return true;
  }
}
