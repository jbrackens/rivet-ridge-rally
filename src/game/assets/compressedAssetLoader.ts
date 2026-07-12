import {
  DefaultLoadingManager,
  type LoadingManager,
  type WebGLRenderer,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export const FESTIVAL_TRAIL_BIKE_URL = "/assets/3d/festival-trail-bike.glb";
export const BASIS_TRANSCODER_PATH = "/assets/transcoders/basis/";

export interface CompressedAssetLoaderOptions {
  manager?: LoadingManager;
  transcoderPath?: string;
  workerLimit?: number;
}

export interface CompressedAssetLoader {
  load(url: string): Promise<GLTF>;
  dispose(): void;
}

/**
 * Creates the required Three.js loader stack for GLBs using both
 * EXT_meshopt_compression and KHR_texture_basisu.
 */
export function createCompressedAssetLoader(
  renderer: WebGLRenderer,
  options: CompressedAssetLoaderOptions = {},
): CompressedAssetLoader {
  const manager = options.manager ?? DefaultLoadingManager;
  const ktx2Loader = new KTX2Loader(manager)
    .setTranscoderPath(options.transcoderPath ?? BASIS_TRANSCODER_PATH)
    .setWorkerLimit(options.workerLimit ?? 2)
    .detectSupport(renderer);
  const gltfLoader = new GLTFLoader(manager)
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(ktx2Loader);
  let pendingLoads = 0;
  let disposeRequested = false;
  let loaderDisposed = false;

  const disposeWhenIdle = (): void => {
    if (!disposeRequested || loaderDisposed || pendingLoads > 0) return;
    loaderDisposed = true;
    ktx2Loader.dispose();
  };

  return {
    load: async (url: string) => {
      if (disposeRequested) throw new Error("Compressed asset loader has been disposed.");
      pendingLoads += 1;
      try {
        return await gltfLoader.loadAsync(url);
      } finally {
        pendingLoads -= 1;
        disposeWhenIdle();
      }
    },
    dispose: () => {
      disposeRequested = true;
      disposeWhenIdle();
    },
  };
}
