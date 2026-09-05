import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { GameEngine } from "../GameEngine";

type HeroBikeFallbackMethods = {
  activateBuiltInBikeFallback: (caption: string, reason: string) => void;
  clearHeroBikeMetrics: () => void;
  settleLoadedHeroBike: (gltf: GLTF) => void;
};

const heroBikeFallbackMethods = GameEngine.prototype as unknown as HeroBikeFallbackMethods;

describe("hero bike fallback feedback", () => {
  it("keeps the fallback caption visible for six simulation seconds", () => {
    const canvas = document.createElement("canvas");
    canvas.dataset.heroBikeRoot = "HeroBikeRider";
    const snapshot = { timeSeconds: 41 };
    const emitHud = vi.fn();
    const harness = {
      disposed: false,
      canvas,
      simulation: { snapshot },
      caption: "",
      captionUntil: 0,
      emitHud,
      clearHeroBikeMetrics() {
        heroBikeFallbackMethods.clearHeroBikeMetrics.call(this);
      },
    };

    heroBikeFallbackMethods.activateBuiltInBikeFallback.call(
      harness,
      "Bike load timed out — safe built-in model active",
      "timeout",
    );

    expect(canvas.dataset.bikeAsset).toBe("fallback");
    expect(canvas.dataset.bikeFallbackReason).toBe("timeout");
    expect(canvas.dataset.heroBikeRoot).toBeUndefined();
    expect(harness.captionUntil).toBe(47);
    expect(emitHud).toHaveBeenCalledOnce();
    expect(emitHud).toHaveBeenCalledWith(snapshot);
  });

  it("disposes every decoded resource when a late model settles after its engine", () => {
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    const disposeTexture = vi.spyOn(texture, "dispose");
    const scene = new Group();
    scene.add(new Mesh(geometry, material));
    const disposeLoader = vi.fn();

    heroBikeFallbackMethods.settleLoadedHeroBike.call({
      disposed: true,
      compressedAssetLoader: { dispose: disposeLoader },
    }, { scene } as GLTF);

    expect(disposeLoader).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeTexture).toHaveBeenCalledOnce();
  });
});
