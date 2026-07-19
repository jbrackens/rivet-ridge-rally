import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../../app/store";
import type { RaceResult } from "../../../app/types";
import { createDefaultProgress } from "../../../game/persistence/database";
import { ResultsScreen } from "../../screens/MenuScreens";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const soloResult: RaceResult = {
  mode: "solo",
  trackId: "canyon-kickoff",
  trackName: "Canyon Kickoff",
  finishTimeMs: 83_000,
  position: 1,
  fieldSize: 1,
  checkpointCount: 3,
  lapTimesMs: [41_000, 42_000],
  splitTimesMs: [13_000, 27_000, 41_000, 55_000, 69_000, 83_000],
  targetMs: 148_000,
  personalBest: false,
  previousBestMs: 82_000,
  previousBestLapTimesMs: [42_000, 41_000],
  previousBestSplitTimesMs: [14_000, 28_000, 42_000, 54_000, 68_000, 82_000],
  bestTimeMs: 82_000,
  classification: [{
    riderId: "player",
    riderName: "You",
    position: 1,
    finishTimeMs: 83_000,
    isPlayer: true,
  }],
  crashes: 0,
  overheats: 0,
  coachingHint: "Keep refining the line.",
};

describe("Results presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderResult = (result: RaceResult): string | null => {
    act(() => {
      useAppStore.setState({ latestResult: result });
      root.render(<ResultsScreen />);
    });
    return container.querySelector("h1")?.textContent ?? null;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useAppStore.setState({
      screen: "results",
      progress: createDefaultProgress(),
      latestResult: soloResult,
      latestResultAttempt: 1,
      latestReplayFailureReason: null,
      raceAttempt: 1,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps current splits visible beside signed comparisons with the prior PB", () => {
    act(() => root.render(<ResultsScreen />));

    expect(container.querySelector(".result-grid")?.textContent).toContain("00:41.00");
    expect(container.querySelector(".split-breakdown")?.textContent).toContain("00:13.00");

    const lapComparisons = Array.from(
      container.querySelectorAll(".result-grid .prior-best-comparison"),
      (element) => element.textContent,
    );
    expect(lapComparisons).toEqual([
      "Prior PB 00:42.00 · −00:01.00",
      "Prior PB 00:41.00 · +00:01.00",
    ]);

    const checkpointComparisons = Array.from(
      container.querySelectorAll(".split-breakdown .prior-best-comparison"),
      (element) => element.textContent,
    );
    expect(checkpointComparisons[0]).toBe("Prior PB 00:14.00 · −00:01.00");
    expect(checkpointComparisons.at(-1)).toBe("Prior PB 01:22.00 · +00:01.00");
  });

  it("discloses an unavailable replay without changing the result presentation", () => {
    act(() => {
      useAppStore.setState({ latestReplayFailureReason: "capacity" });
      root.render(<ResultsScreen />);
    });

    expect(container.querySelector(".final-time")?.textContent).toBe("01:23.00");
    expect(container.querySelector(".replay-unavailable-notice")?.textContent).toContain(
      "Your official result and progress were kept, but no replay was saved",
    );
    expect(container.querySelector(".replay-unavailable-notice")?.textContent).toContain(
      "byte capacity",
    );
  });

  it("uses neutral completion copy for runs without a competitive field", () => {
    const noncompetitiveResults: RaceResult[] = [
      {
        ...soloResult,
        finishTimeMs: 149_000,
      },
      {
        ...soloResult,
        mode: "practice",
        targetMs: undefined,
      },
      {
        ...soloResult,
        mode: "custom",
        targetMs: undefined,
      },
      {
        ...soloResult,
        mode: "rival",
        targetMs: undefined,
      },
    ];

    for (const result of noncompetitiveResults) {
      expect(renderResult(result)).toBe("Run complete");
    }
  });

  it("reserves podium copy for a competitive multi-rider result", () => {
    const rivalResult: RaceResult = {
      ...soloResult,
      mode: "rival",
      position: 2,
      fieldSize: 2,
      targetMs: undefined,
      classification: [
        {
          riderId: "copper-comet",
          riderName: "Copper Comet",
          position: 1,
          finishTimeMs: 82_000,
          isPlayer: false,
        },
        {
          riderId: "player",
          riderName: "You",
          position: 2,
          finishTimeMs: 83_000,
          isPlayer: true,
        },
      ],
    };

    expect(renderResult(rivalResult)).toBe("Podium finish");
  });
});
