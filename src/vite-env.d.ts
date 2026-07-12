/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  __RRR_QA__?: {
    startTrack: (trackId: string, mode?: import("./app/types").RaceMode) => void;
    unlockCampaign: () => void;
    lifecycle: () => import("./game/qa/lifecycleDiagnostics").LifecycleDiagnostics;
  };
}
