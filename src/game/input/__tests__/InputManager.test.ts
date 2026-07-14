import { afterEach, describe, expect, it, vi } from "vitest";

import type { ControlSettings } from "../../../app/types";
import { InputManager } from "../InputManager";

const settings: ControlSettings = {
  mirroredTouch: false,
  retroRecovery: false,
  vibration: true,
  keyBindings: {
    throttle: "KeyW",
    turbo: "ShiftLeft",
    laneLeft: "ArrowLeft",
    laneRight: "ArrowRight",
    pitchUp: "ArrowUp",
    pitchDown: "ArrowDown",
    recover: "Space",
  },
};

const originalGetGamepads = navigator.getGamepads;

afterEach(() => {
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: originalGetGamepads,
  });
});

function button(pressed = false, value = pressed ? 1 : 0): GamepadButton {
  return { pressed, touched: pressed, value };
}

function gamepad(overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button()),
    connected: true,
    id: "QA standard pad",
    index: 0,
    mapping: "standard",
    timestamp: 1,
    vibrationActuator: null,
    hapticActuators: [],
    ...overrides,
  } as Gamepad;
}

describe("InputManager", () => {
  it("samples live-remapped keyboard controls and clears them on keyup", () => {
    const manager = new InputManager(settings);
    manager.connect();
    manager.updateSettings({ ...settings, keyBindings: { ...settings.keyBindings, throttle: "KeyQ" } });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));

    expect(manager.sample()).toMatchObject({ throttle: true, laneChange: 1 });
    expect(manager.activeDevice).toBe("keyboard");

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyQ" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    expect(manager.sample()).toMatchObject({ throttle: false, laneChange: 0 });
    manager.disconnect();
  });

  it("falls back to arrow lane controls without reserving A or D", () => {
    const keyBindings = { ...settings.keyBindings };
    delete keyBindings.laneLeft;
    delete keyBindings.laneRight;
    const manager = new InputManager({ ...settings, keyBindings });
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    expect(manager.sample().laneChange).toBe(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(manager.sample().laneChange).toBe(-1);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(manager.sample().laneChange).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    manager.disconnect();
  });

  it("keeps labeled touch actions independent and records the active device", () => {
    const manager = new InputManager(settings);
    manager.setTouchControl("throttle", true);
    manager.setTouchControl("pitch", -1);

    expect(manager.sample()).toMatchObject({ throttle: true, pitch: -1 });
    expect(manager.activeDevice).toBe("touch");
  });

  it("maps the standard gamepad layout and analog triggers", () => {
    const buttons = Array.from({ length: 17 }, () => button());
    buttons[6] = button(false, 0.8);
    buttons[7] = button(false, 0.7);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({ axes: [0.8, -0.65, 0, 0], buttons })],
    });
    const manager = new InputManager(settings);

    expect(manager.sample()).toMatchObject({
      throttle: true,
      turbo: true,
      laneChange: 1,
      pitch: 0.65,
    });
    expect(manager.activeDevice).toBe("gamepad");
  });

  it("uses a short optional warning pulse when a vibration actuator exists", async () => {
    const playEffect = vi.fn().mockResolvedValue("complete");
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({ vibrationActuator: { playEffect, reset: vi.fn() } as unknown as GamepadHapticActuator })],
    });
    const manager = new InputManager(settings);

    await manager.warnOverheat();

    expect(playEffect).toHaveBeenCalledWith("dual-rumble", expect.objectContaining({ duration: 120 }));
  });
});
