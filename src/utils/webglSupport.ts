import * as THREE from 'three';

export interface WebGLProbeResult {
  supported: boolean;
  preferLowSpec: boolean;
}

/**
 * Safely probes whether a WebGL2 context (required by Three.js r163+) can be created
 * without triggering Three.js console.error spam or uncaught exceptions.
 */
export function probeWebGL2Support(): WebGLProbeResult {
  if (typeof document === 'undefined') {
    return { supported: false, preferLowSpec: false };
  }

  const tryCreate = (attrs: WebGLContextAttributes): boolean => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
      if (!gl) return false;
      const loseExt = gl.getExtension('WEBGL_lose_context');
      if (loseExt) {
        loseExt.loseContext();
      }
      return true;
    } catch {
      return false;
    }
  };

  if (
    tryCreate({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
  ) {
    return { supported: true, preferLowSpec: false };
  }

  if (
    tryCreate({
      antialias: false,
      alpha: true,
      powerPreference: 'default',
      preserveDrawingBuffer: true,
      failIfMajorPerformanceCaveat: false,
    })
  ) {
    return { supported: true, preferLowSpec: true };
  }

  return { supported: false, preferLowSpec: false };
}

/**
 * Attempts to construct a THREE.WebGLRenderer safely.
 * Returns null instead of throwing if WebGL2 context creation fails.
 */
export function createSafeWebGLRenderer(
  options: {
    antialias?: boolean;
    alpha?: boolean;
    powerPreference?: WebGLPowerPreference;
    preserveDrawingBuffer?: boolean;
  } = {}
): THREE.WebGLRenderer | null {
  const probe = probeWebGL2Support();
  if (!probe.supported) {
    return null;
  }

  try {
    return new THREE.WebGLRenderer({
      antialias: probe.preferLowSpec ? false : (options.antialias ?? true),
      alpha: options.alpha ?? true,
      powerPreference: probe.preferLowSpec ? 'default' : (options.powerPreference ?? 'high-performance'),
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    // Final relaxed retry in case high-spec options failed during Three.js init
    try {
      return new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: 'default',
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      return null;
    }
  }
}
