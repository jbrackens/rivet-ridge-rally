/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __RRR_BUILD_IDENTITY__: Readonly<{
  commit: string;
  dirty: boolean;
}>;

interface Window {
  __RRR_BUILD__: Readonly<{
    commit: string;
    dirty: boolean;
  }>;
  __RRR_QA__?: {
    startTrack: (trackId: string, mode?: import("./app/types").RaceMode) => void;
    openEditor: () => void;
    unlockCampaign: () => void;
    lifecycle: () => import("./game/qa/lifecycleDiagnostics").LifecycleDiagnostics;
  };
}
