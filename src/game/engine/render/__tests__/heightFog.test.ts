import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fog is installed by replacing Three's shared `fog_*` chunks, so the
 * contract is about the chunk strings: every fog-enabled material compiles
 * against them. Each test gets a fresh module (the install is one-shot per
 * module instance) and the stock chunks are restored afterwards so no other
 * suite sees the authored fog.
 */
const CHUNK_KEYS = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment"] as const;
type ChunkKey = (typeof CHUNK_KEYS)[number];

const stock: Record<ChunkKey, string> = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment,
};

function restoreStockChunks(): void {
  for (const key of CHUNK_KEYS) THREE.ShaderChunk[key] = stock[key];
}

async function freshModule() {
  vi.resetModules();
  return import("../heightFog");
}

beforeEach(restoreStockChunks);
afterEach(restoreStockChunks);

describe("installHeightFog", () => {
  it("replaces all four fog chunks with the preset's bodies", async () => {
    const fog = await freshModule();
    expect(fog.installHeightFog("medium")).toBe("medium");
    expect(THREE.ShaderChunk.fog_pars_vertex).toBe(fog.HEIGHT_FOG_CHUNKS.parsVertex);
    expect(THREE.ShaderChunk.fog_vertex).toBe(fog.HEIGHT_FOG_CHUNKS.vertex);
    expect(THREE.ShaderChunk.fog_pars_fragment).toBe(fog.HEIGHT_FOG_CHUNKS.parsFragment);
    expect(THREE.ShaderChunk.fog_fragment).toBe(fog.fogFragmentChunk(fog.FOG_PRESETS.medium));
    expect(fog.installedFogPreset()).toBe("medium");
  });

  it("is one-shot: a later call with a different preset keeps the first", async () => {
    const fog = await freshModule();
    fog.installHeightFog("light");
    expect(fog.installHeightFog("heavy")).toBe("light");
    expect(THREE.ShaderChunk.fog_fragment).toBe(fog.fogFragmentChunk(fog.FOG_PRESETS.light));
  });

  it("bakes each preset's own strength into the fragment", async () => {
    const fog = await freshModule();
    const bodies = (["light", "medium", "heavy"] as const).map((name) => fog.fogFragmentChunk(fog.FOG_PRESETS[name]));
    expect(new Set(bodies).size).toBe(3);
    // Presets are ordered by how close the haze starts and how hard it pools.
    expect(fog.FOG_PRESETS.light.nearScale).toBeGreaterThan(fog.FOG_PRESETS.medium.nearScale);
    expect(fog.FOG_PRESETS.medium.nearScale).toBeGreaterThan(fog.FOG_PRESETS.heavy.nearScale);
    expect(fog.FOG_PRESETS.light.groundDensity).toBeLessThan(fog.FOG_PRESETS.medium.groundDensity);
    expect(fog.FOG_PRESETS.medium.groundDensity).toBeLessThan(fog.FOG_PRESETS.heavy.groundDensity);
  });

  it("scales the near plane in, keeps fogFar as full fog, and adds height and sun terms", async () => {
    const fog = await freshModule();
    const fragment = fog.fogFragmentChunk(fog.FOG_PRESETS.medium);
    expect(fragment).toContain("float rrrFogNear = fogNear * ");
    expect(fragment).toContain("max( vFogDepth - rrrFogNear, 0.0 )");
    expect(fragment).toContain("max( fogFar - rrrFogNear, 1.0 )");
    expect(fragment).toContain("vRrrFogWorldPosition.y");
    expect(fragment).toContain("cameraPosition");
    expect(fragment).toContain("pow( max( dot( rrrFogView");
    // Still honours FOG_EXP2 if a scene ever uses it.
    expect(fragment).toContain("#ifdef FOG_EXP2");
  });

  it("carries world position through the vertex stage with instancing applied", async () => {
    const fog = await freshModule();
    expect(fog.HEIGHT_FOG_CHUNKS.parsVertex).toContain("varying vec3 vRrrFogWorldPosition;");
    expect(fog.HEIGHT_FOG_CHUNKS.vertex).toContain("#ifdef USE_INSTANCING");
    expect(fog.HEIGHT_FOG_CHUNKS.vertex).toContain("instanceMatrix * rrrFogWorld");
    expect(fog.HEIGHT_FOG_CHUNKS.vertex).toContain("modelMatrix * rrrFogWorld");
    // The stock depth varying is preserved so nothing else in Three breaks.
    expect(fog.HEIGHT_FOG_CHUNKS.vertex).toContain("vFogDepth = - mvPosition.z;");
  });

  it("emits well-formed GLSL float literals for every baked constant, in every preset", async () => {
    const fog = await freshModule();
    for (const name of ["light", "medium", "heavy"] as const) {
      const fragment = fog.fogFragmentChunk(fog.FOG_PRESETS[name]);
      // A bare integer inside vec3()/mix()/exp() would fail to compile on
      // strict GLSL ES drivers; every baked number must carry a decimal point.
      const bakedNumbers = fragment.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) ?? [];
      for (const literal of bakedNumbers) expect(literal).toMatch(/\./);
    }
  });

  it("resolves the shipped preset by default and honours the ?fog= capture switch", async () => {
    const fog = await freshModule();
    expect(fog.resolveFogModel("")).toBe("medium");
    expect(fog.resolveFogModel("?tone=cine-night")).toBe("medium");
    expect(fog.resolveFogModel("?fog=light")).toBe("light");
    expect(fog.resolveFogModel("?fog=heavy")).toBe("heavy");
    expect(fog.resolveFogModel("?fog=linear")).toBe("linear");
    expect(fog.resolveFogModel("?qa-visual-freeze=1&fog=linear")).toBe("linear");
    // Not a validated input: unknown or malformed values fall back, never throw.
    expect(fog.resolveFogModel("?fog=exp2")).toBe("medium");
    expect(fog.resolveFogModel("?fog=")).toBe("medium");
  });

  it("fails soft when a stock chunk does not have the expected shape", async () => {
    THREE.ShaderChunk.fog_fragment = "// reshaped by a hypothetical Three upgrade";
    const fog = await freshModule();
    expect(fog.installHeightFog("medium")).toBeNull();
    expect(fog.installedFogPreset()).toBeNull();
    // Nothing was touched, including the chunks that did match.
    expect(THREE.ShaderChunk.fog_pars_vertex).toBe(stock.fog_pars_vertex);
    expect(THREE.ShaderChunk.fog_vertex).toBe(stock.fog_vertex);
  });
});
