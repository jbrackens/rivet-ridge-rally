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
    pause: "Escape",
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
  it("keeps an initial touch label until a real keyboard command takes over", () => {
    const manager = new InputManager(settings, "touch");
    expect(manager.activeDevice).toBe("touch");
    expect(manager.sample()).toMatchObject({ throttle: false, turbo: false });

    manager.connect();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(manager.sample().throttle).toBe(true);
    expect(manager.activeDevice).toBe("keyboard");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    manager.disconnect();
  });

  it("samples live-remapped keyboard controls and clears them on keyup", () => {
    const manager = new InputManager(settings);
    manager.connect();
    manager.updateSettings({ ...settings, keyBindings: { ...settings.keyBindings, throttle: "PageDown" } });
    const pageDown = new KeyboardEvent("keydown", { cancelable: true, code: "PageDown" });
    window.dispatchEvent(pageDown);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));

    expect(pageDown.defaultPrevented).toBe(true);
    expect(manager.sample()).toMatchObject({ throttle: true, laneChange: 1 });
    expect(manager.activeDevice).toBe("keyboard");

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "PageDown" }));
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

  it("delivers a quick keyboard lane tap to the next sample", () => {
    const manager = new InputManager(settings);
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));

    expect(manager.sample().laneChange).toBe(-1);
    expect(manager.sample().laneChange).toBe(0);
    manager.disconnect();
  });

  it("clears an unsampled lane tap when input is suspended", () => {
    const manager = new InputManager(settings);
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    manager.suspend();

    expect(manager.sample().laneChange).toBe(0);
    manager.disconnect();
  });

  it("does not consume gameplay keys from an interactive control", () => {
    const manager = new InputManager(settings);
    const retry = document.createElement("button");
    document.body.append(retry);
    manager.connect();

    const spaceDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
    });
    expect(retry.dispatchEvent(spaceDown)).toBe(true);
    expect(spaceDown.defaultPrevented).toBe(false);
    expect(manager.sample().recover).toBe(false);

    manager.disconnect();
    retry.remove();
  });

  it("prevents browser defaults for every configured gameplay binding only", () => {
    const manager = new InputManager(settings);
    manager.connect();

    for (const code of Object.values(settings.keyBindings)) {
      const keyDown = new KeyboardEvent("keydown", { cancelable: true, code });
      window.dispatchEvent(keyDown);
      expect(keyDown.defaultPrevented).toBe(true);
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    }

    const unrelatedKey = new KeyboardEvent("keydown", { cancelable: true, code: "KeyZ" });
    window.dispatchEvent(unrelatedKey);
    expect(unrelatedKey.defaultPrevented).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyZ" }));
    manager.disconnect();
  });

  it("does not claim keyboard prompts for unrelated keys", () => {
    const manager = new InputManager(settings, "touch");
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }));

    expect(manager.activeDevice).toBe("touch");
    expect(manager.sample()).toMatchObject({ throttle: false, laneChange: 0 });
    manager.disconnect();
  });

  it("does not retain the UI-handled pause key as gameplay input", () => {
    const manager = new InputManager(settings);
    manager.connect();

    const pause = new KeyboardEvent("keydown", { cancelable: true, code: "Escape", repeat: true });
    window.dispatchEvent(pause);
    expect(pause.defaultPrevented).toBe(true);

    manager.updateSettings({
      ...settings,
      keyBindings: { ...settings.keyBindings, throttle: "Escape", pause: "KeyP" },
    });
    expect(manager.sample().throttle).toBe(false);
    manager.disconnect();
  });

  it("rejects mapped gameplay commands while Control, Meta, or Alt is held", () => {
    const manager = new InputManager(settings);
    manager.connect();

    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", [modifier]: true }));
      expect(manager.sample().throttle).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    }

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(manager.sample().throttle).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ControlLeft", ctrlKey: true }));
    expect(manager.sample().throttle).toBe(false);
    manager.disconnect();
  });

  it("keeps labeled touch actions independent and records the active device", () => {
    const manager = new InputManager(settings);
    manager.setTouchControl("throttle", true);
    manager.setTouchControl("pitch", -1);

    expect(manager.sample()).toMatchObject({ throttle: true, pitch: -1 });
    expect(manager.activeDevice).toBe("touch");
  });

  it("clears every held touch action when the window loses focus", () => {
    const manager = new InputManager(settings);
    manager.connect();
    manager.setTouchControl("throttle", true);
    manager.setTouchControl("turbo", true);
    manager.setTouchControl("laneChange", 1);
    manager.setTouchControl("pitch", -1);
    manager.setTouchControl("recover", true);

    window.dispatchEvent(new Event("blur"));

    expect(manager.sample()).toMatchObject({
      throttle: false,
      turbo: false,
      laneChange: 0,
      pitch: 0,
      recover: false,
    });
    manager.disconnect();
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

  it("uses the first connected gamepad even when browser slot zero is empty", () => {
    const buttons = Array.from({ length: 17 }, () => button());
    buttons[0] = button(true);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [null, gamepad({ index: 1, buttons })],
    });
    const manager = new InputManager(settings);

    expect(manager.sample()).toMatchObject({ throttle: true });
    expect(manager.activeDevice).toBe("gamepad");
  });

  it("marks a gamepad command and restores keyboard prompts after disconnect", () => {
    let connected = true;
    const pad = gamepad();
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => connected ? [pad] : [],
    });
    const manager = new InputManager(settings);

    manager.markGamepadCommand();
    expect(manager.activeDevice).toBe("gamepad");

    connected = false;
    expect(manager.sample()).toMatchObject({ throttle: false, laneChange: 0 });
    expect(manager.activeDevice).toBe("keyboard");
  });

  it("restores the last touch prompt after a gamepad disconnects", () => {
    let connected = true;
    const pad = gamepad();
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => connected ? [pad] : [],
    });
    const manager = new InputManager(settings, "touch");

    manager.markGamepadCommand();
    expect(manager.activeDevice).toBe("gamepad");

    connected = false;
    manager.sample();
    expect(manager.activeDevice).toBe("touch");
  });

  it("does not let sub-command stick drift suppress keyboard or touch input", () => {
    const buttons = Array.from({ length: 17 }, () => button());
    buttons[6] = button(false, 0.3);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({ axes: [0.3, 0, 0, 0], buttons })],
    });
    const manager = new InputManager(settings);
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(manager.sample()).toMatchObject({ throttle: true, laneChange: 0 });
    expect(manager.activeDevice).toBe("keyboard");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));

    manager.setTouchControl("throttle", true);
    expect(manager.sample()).toMatchObject({ throttle: true, laneChange: 0 });
    expect(manager.activeDevice).toBe("touch");
    manager.disconnect();
  });

  it("keeps held touch commands ahead of active gamepad input", () => {
    const buttons = Array.from({ length: 17 }, () => button());
    buttons[0] = button(true);
    buttons[6] = button(false, 0.8);
    buttons[7] = button(false, 0.7);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({ axes: [0.8, 0.65, 0, 0], buttons })],
    });
    const manager = new InputManager(settings);
    manager.setTouchControl("throttle", true);
    manager.setTouchControl("turbo", true);
    manager.setTouchControl("laneChange", -1);
    manager.setTouchControl("pitch", 0.6);
    manager.setTouchControl("recover", true);

    expect(manager.sample()).toEqual({
      throttle: true,
      turbo: true,
      laneChange: -1,
      pitch: 0.6,
      recover: true,
    });
    expect(manager.activeDevice).toBe("touch");

    manager.setTouchControl("throttle", false);
    manager.setTouchControl("turbo", false);
    manager.setTouchControl("laneChange", 0);
    manager.setTouchControl("pitch", 0);
    manager.setTouchControl("recover", false);
    expect(manager.sample()).toMatchObject({ laneChange: 1, pitch: -0.65 });
    expect(manager.activeDevice).toBe("gamepad");
  });

  it("resumes an already-held keyboard command after a touch action is released", () => {
    const manager = new InputManager(settings);
    manager.connect();

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    manager.setTouchControl("laneChange", 1);
    expect(manager.sample()).toMatchObject({ throttle: false, laneChange: 1 });
    expect(manager.activeDevice).toBe("touch");

    manager.setTouchControl("laneChange", 0);
    expect(manager.sample()).toMatchObject({ throttle: true, laneChange: 0 });
    expect(manager.activeDevice).toBe("keyboard");

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    manager.disconnect();
  });

  it("activates gamepad throttle at the same trigger threshold used for sampling", () => {
    const buttons = Array.from({ length: 17 }, () => button());
    buttons[7] = button(false, 0.22);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({ buttons })],
    });
    const manager = new InputManager(settings);

    expect(manager.sample()).toMatchObject({ throttle: true });
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

  it("treats rejected optional vibration as a nonfatal capability failure", async () => {
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad({
        vibrationActuator: {
          playEffect: vi.fn().mockRejectedValue(new Error("unsupported")),
          reset: vi.fn(),
        } as unknown as GamepadHapticActuator,
      })],
    });
    const manager = new InputManager(settings);

    await expect(manager.warnOverheat()).resolves.toBeUndefined();
  });
});
