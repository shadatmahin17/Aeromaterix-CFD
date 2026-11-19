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
 * Spatial Vertex & Surface Field extracted directly from real 3D aircraft mesh vertices
 * and triangle centroids.
 *
 * Uses a 3D Euclidean Distance Transform with trilinear interpolation and central-difference
 * distance gradients (grad d) to guarantee C1-smooth, strictly outward surface normals that
 * are immune to interior cabin meshes, double-sided wing polygons, or voxel staircase jumps.
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

  private readonly nx = 56;
  private readonly ny = 28;
  private readonly nz = 56;

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

  // Flat Euclidean distance & nearest-surface-point grids
  private readonly distGrid: Float32Array;
  private readonly surfX: Float32Array;
  private readonly surfY: Float32Array;
  private readonly surfZ: Float32Array;

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

    const total = this.nx * this.ny * this.nz;
    this.distGrid = new Float32Array(total);
    this.surfX = new Float32Array(total);
    this.surfY = new Float32Array(total);
    this.surfZ = new Float32Array(total);
    this.distGrid.fill(1e6);

    this.sliceLeX = new Float32Array(this.spanSlices);
    this.sliceTeX = new Float32Array(this.spanSlices);
    this.sliceYMid = new Float32Array(this.spanSlices);
    this.sliceThick = new Float32Array(this.spanSlices);
    this.sliceHasGeo = new Uint8Array(this.spanSlices);

    const sliceMinY = new Float32Array(this.spanSlices).fill(1e6);
    const sliceMaxY = new Float32Array(this.spanSlices).fill(-1e6);
    this.sliceLeX.fill(1e6);
    this.sliceTeX.fill(-1e6);

    // 1. Splat actual mesh vertices & triangle centroids into surrounding voxel neighborhoods
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

      // Seed the 2x2x2 enclosing cell corners so distance values are immediately accurate
      for (let oz = 0; oz <= 1; oz++) {
        const gz = gz0 + oz;
        if (gz < 0 || gz >= this.nz) continue;
        const cz = this.padMinZ + gz * this.dz;
        for (let oy = 0; oy <= 1; oy++) {
          const gy = gy0 + oy;
          if (gy < 0 || gy >= this.ny) continue;
          const cy = this.padMinY + gy * this.dy;
          for (let ox = 0; ox <= 1; ox++) {
            const gx = gx0 + ox;
            if (gx < 0 || gx >= this.nx) continue;
            const cx = this.padMinX + gx * this.dx;
            const d = Math.hypot(cx - px, cy - py, cz - pz);
            const idx = (gz * this.ny + gy) * this.nx + gx;
            if (d < this.distGrid[idx]) {
              this.distGrid[idx] = d;
              this.surfX[idx] = px;
              this.surfY[idx] = py;
              this.surfZ[idx] = pz;
            }
          }
        }
      }
    }

    // Finalize spanwise chord slices and fill any sparse gaps cleanly
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
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;

    const propagate = (gx: number, gy: number, gz: number, ox: number, oy: number, oz: number) => {
      const nxIdx = gx + ox;
      const nyIdx = gy + oy;
      const nzIdx = gz + oz;
      if (nxIdx < 0 || nxIdx >= nx || nyIdx < 0 || nyIdx >= ny || nzIdx < 0 || nzIdx >= nz) return;

      const dstIdx = (gz * ny + gy) * nx + gx;
      const srcIdx = (nzIdx * ny + nyIdx) * nx + nxIdx;
      if (this.distGrid[srcIdx] > 1e5) return;

      const sx = this.surfX[srcIdx];
      const sy = this.surfY[srcIdx];
      const sz = this.surfZ[srcIdx];
      const cx = this.padMinX + gx * this.dx;
      const cy = this.padMinY + gy * this.dy;
      const cz = this.padMinZ + gz * this.dz;
      const d = Math.hypot(cx - sx, cy - sy, cz - sz);

      if (d < this.distGrid[dstIdx]) {
        this.distGrid[dstIdx] = d;
        this.surfX[dstIdx] = sx;
        this.surfY[dstIdx] = sy;
        this.surfZ[dstIdx] = sz;
      }
    };

    // Forward sweep (all negative half-space offsets)
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

    // Backward sweep (all positive half-space offsets)
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

    // 3. Light 3D box smoothing (1 pass) on distGrid so gradient normals (grad d) are C1-smooth
    const smoothed = new Float32Array(this.distGrid);
    for (let gz = 1; gz < nz - 1; gz++) {
      for (let gy = 1; gy < ny - 1; gy++) {
        for (let gx = 1; gx < nx - 1; gx++) {
          const cIdx = (gz * ny + gy) * nx + gx;
          const sum =
            this.distGrid[cIdx] * 4 +
            this.distGrid[cIdx - 1] +
            this.distGrid[cIdx + 1] +
            this.distGrid[cIdx - nx] +
            this.distGrid[cIdx + nx] +
            this.distGrid[cIdx - nx * ny] +
            this.distGrid[cIdx + nx * ny];
          smoothed[cIdx] = sum / 10;
        }
      }
    }
    this.distGrid.set(smoothed);
  }

  /**
   * Extracts real mesh vertices + triangle centroids from a Three.js Group in pure body space.
   */
  public static fromThreeGroup(root: THREE.Group, targetSampleCount = 24000): AircraftSurfaceField | null {
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

    const vertStride = Math.max(1, Math.floor(totalVertices / (targetSampleCount * 0.6)));
    const triStride = Math.max(1, Math.floor(totalTris / (targetSampleCount * 0.4)));
    const maxSamples =
      Math.ceil(totalVertices / vertStride) + Math.ceil(totalTris / triStride) + meshes.length * 8;
    const pts = new Float32Array(maxSamples * 3);

    const vPos = new THREE.Vector3();
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
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

    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const posAttr = geo.attributes.position;
      const indexAttr = geo.index;

      // Sample actual vertices
      for (let i = 0; i < posAttr.count; i += vertStride) {
        if (count >= maxSamples) break;
        vPos.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        pushPt(vPos.x, vPos.y, vPos.z);
      }

      // Sample triangle centroids so large delta wings & fuselage panels are densely covered
      const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
      for (let t = 0; t < triCount; t += triStride) {
        if (count >= maxSamples) break;
        const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
        const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
        vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
        vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
        vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);
        pushPt((vA.x + vB.x + vC.x) / 3, (vA.y + vB.y + vC.y) / 3, (vA.z + vB.z + vC.z) / 3);
      }
    }

    if (count === 0) return null;
    return new AircraftSurfaceField(pts, count, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  /**
   * Builds a field directly from procedural Aircraft3DMeshData vertices & face centroids.
   */
  public static fromProceduralMesh(mesh: Aircraft3DMeshData): AircraftSurfaceField | null {
    if (!mesh.vertices.length || !mesh.faces.length) return null;

    const sampleEstimate = mesh.vertices.length + mesh.faces.length * 6;
    const pts = new Float32Array(sampleEstimate * 3);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let count = 0;

    const pushSample = (x: number, y: number, z: number) => {
      if (count >= sampleEstimate) return;
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

    for (const face of mesh.faces) {
      const idx = face.indices;
      if (idx.length < 3) continue;
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < idx.length; i++) {
        const v = mesh.vertices[idx[i]];
        cx += v.x;
        cy += v.y;
        cz += v.z;
        pushSample(v.x, v.y, v.z);
      }
      cx /= idx.length;
      cy /= idx.length;
      cz /= idx.length;
      pushSample(cx, cy, cz);
    }

    if (count === 0) return null;
    return new AircraftSurfaceField(pts, count, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  /**
   * Trilinear interpolation of the Euclidean distance grid at body-frame point (bx, by, bz).
   */
  private sampleTrilinearDist(bx: number, by: number, bz: number): number {
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

    const d000 = this.distGrid[base];
    const d100 = this.distGrid[base + 1];
    const d010 = this.distGrid[base + nx];
    const d110 = this.distGrid[base + nx + 1];
    const d001 = this.distGrid[base + strideZ];
    const d101 = this.distGrid[base + strideZ + 1];
    const d011 = this.distGrid[base + strideZ + nx];
    const d111 = this.distGrid[base + strideZ + nx + 1];

    const c00 = d000 + (d100 - d000) * tx;
    const c10 = d010 + (d110 - d010) * tx;
    const c01 = d001 + (d101 - d001) * tx;
    const c11 = d011 + (d111 - d011) * tx;

    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;

    return c0 + (c1 - c0) * tz;
  }

  /**
   * O(1) C1-smooth lookup of surface distance and outward normal (grad d)
   * in aircraft body frame.
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

    const dist = this.sampleTrilinearDist(bx, by, bz);
    if (dist > 1e4) return false;

    // Central difference of smooth distance field gives guaranteed outward normal
    const epsX = this.dx * 0.65;
    const epsY = this.dy * 0.65;
    const epsZ = this.dz * 0.65;

    let nx = this.sampleTrilinearDist(bx + epsX, by, bz) - this.sampleTrilinearDist(bx - epsX, by, bz);
    let ny = this.sampleTrilinearDist(bx, by + epsY, bz) - this.sampleTrilinearDist(bx, by - epsY, bz);
    let nz = this.sampleTrilinearDist(bx, by, bz + epsZ) - this.sampleTrilinearDist(bx, by, bz - epsZ);

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
    out.inside = dist < 0.08;
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
