import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CRITICAL_HEAT_WARNING } from "../../../game/engine/GameEngine";
import { HeatMeter } from "../GameView";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("HeatMeter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("places the warning marker from the shared simulation threshold", () => {
    act(() => root.render(<HeatMeter heat={CRITICAL_HEAT_WARNING} overheated={false} />));

    const meter = container.querySelector<HTMLElement>('[role="meter"]');
    const track = container.querySelector<HTMLElement>(".heat-track");
    const fill = container.querySelector<HTMLElement>(".heat-track > span");

    expect(meter?.getAttribute("aria-valuenow")).toBe(String(CRITICAL_HEAT_WARNING));
    expect(track?.style.getPropertyValue("--heat-warning-threshold")).toBe(`${CRITICAL_HEAT_WARNING}%`);
    expect(fill?.style.width).toBe(`${CRITICAL_HEAT_WARNING}%`);
  });
});
