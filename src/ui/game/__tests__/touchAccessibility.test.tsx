import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PitchTouchControls, RecoveryPrompt, TouchButton } from "../GameView";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function dispatchPointer(button: HTMLButtonElement, type: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  button.dispatchEvent(event);
}

describe("semantic touch controls", () => {
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
    vi.unstubAllGlobals();
  });

  it("turns a synthetic lane click into one sampled pulse", () => {
    let releasePulse: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      releasePulse = callback;
      return 17;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onChange = vi.fn();

    act(() => root.render(
      <TouchButton
        label="Move one lane left"
        className=""
        dataControl="lane-left"
        activation="pulse"
        onChange={onChange}
      />,
    ));
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    act(() => button?.click());
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true]);
    expect(button?.hasAttribute("aria-pressed")).toBe(false);

    act(() => releasePulse?.(0));
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false]);
  });

  it("toggles held controls for synthetic clicks and reports pressed state", () => {
    const onChange = vi.fn();
    act(() => root.render(
      <TouchButton
        label="Turbo"
        className="touch-turbo"
        dataControl="turbo"
        activation="hold"
        onChange={onChange}
      />,
    ));
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-pressed")).toBe("false");

    act(() => button?.click());
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true]);

    act(() => button?.click());
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false]);

    act(() => button?.click());
    act(() => window.dispatchEvent(new Event("blur")));
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false, true, false]);
  });

  it("releases a held control when the parent freezes post-ride training", () => {
    const onChange = vi.fn();
    const renderRide = (resetPressed: boolean) => (
      <TouchButton
        label="Ride"
        className="touch-ride"
        dataControl="ride"
        activation="hold"
        resetPressed={resetPressed}
        onChange={onChange}
      />
    );
    act(() => root.render(renderRide(false)));
    const button = container.querySelector("button");

    act(() => button?.click());
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    act(() => root.render(renderRide(true)));

    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false]);
  });

  it("does not replay a completed pointer hold through the following click", () => {
    const onChange = vi.fn();
    act(() => root.render(
      <TouchButton
        label="Ride"
        className="touch-ride"
        dataControl="ride"
        activation="hold"
        onChange={onChange}
      />,
    ));
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    act(() => {
      if (!button) return;
      dispatchPointer(button, "pointerdown");
      dispatchPointer(button, "pointerup");
      button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      }));
    });

    expect(onChange.mock.calls.map(([pressed]) => pressed)).toEqual([true, false]);
    expect(button?.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps pitch toggles exclusive and ignores the stale direction release", () => {
    const onChange = vi.fn();
    act(() => root.render(<PitchTouchControls onChange={onChange} />));
    const pitchUp = container.querySelector<HTMLButtonElement>('[data-control="pitch-up"]');
    const pitchDown = container.querySelector<HTMLButtonElement>('[data-control="pitch-down"]');

    act(() => pitchUp?.click());
    expect(pitchUp?.getAttribute("aria-pressed")).toBe("true");
    expect(pitchDown?.getAttribute("aria-pressed")).toBe("false");

    act(() => pitchDown?.click());
    expect(pitchUp?.getAttribute("aria-pressed")).toBe("false");
    expect(pitchDown?.getAttribute("aria-pressed")).toBe("true");
    expect(onChange.mock.calls.map(([direction]) => direction)).toEqual([1, -1]);

    act(() => pitchUp?.click());
    expect(pitchUp?.getAttribute("aria-pressed")).toBe("true");
    expect(pitchDown?.getAttribute("aria-pressed")).toBe("false");
    expect(onChange.mock.calls.map(([direction]) => direction)).toEqual([1, -1, 1]);
  });
});

describe("crash recovery prompt", () => {
  it("renders the adaptive control hint and bounded progressbar semantics", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<RecoveryPrompt hint="Hold RIDE to recover" progress={0.42} />));

    expect(container.textContent).toContain("Hold RIDE to recover");
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar?.getAttribute("aria-label")).toBe("Recovery progress");
    expect(progressbar?.getAttribute("aria-valuemin")).toBe("0");
    expect(progressbar?.getAttribute("aria-valuemax")).toBe("100");
    expect(progressbar?.getAttribute("aria-valuenow")).toBe("42");
    expect(progressbar?.getAttribute("aria-valuetext")).toBe("42% recovered");

    act(() => root.unmount());
  });
});
