import type { ControlSettings } from "../../app/types";
import type { LaneChange, SimulationInput } from "../simulation";
import {
  recordInputSuspension,
  setHeldInputCount,
  startLifecycleResource,
  stopLifecycleResource,
} from "../qa/lifecycleDiagnostics";
import { firstConnectedGamepad } from "./gamepad";

export type InputDevice = "keyboard" | "gamepad" | "touch";

interface TouchState {
  throttle: boolean;
  turbo: boolean;
  laneChange: LaneChange;
  pitch: number;
  recover: boolean;
}

const LANE_AXIS_THRESHOLD = 0.55;
const PITCH_AXIS_THRESHOLD = 0.2;
const THROTTLE_TRIGGER_THRESHOLD = 0.2;
const TURBO_TRIGGER_THRESHOLD = 0.35;

export function isInteractiveInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest("button, input, select, textarea, [contenteditable]:not([contenteditable='false'])") !== null;
}

export class InputManager {
  private readonly keys = new Set<string>();
  private pendingKeyboardLane: LaneChange = 0;
  private settings: ControlSettings;
  private readonly touch: TouchState = {
    throttle: false,
    turbo: false,
    laneChange: 0,
    pitch: 0,
    recover: false,
  };
  private device: InputDevice;
  private fallbackDevice: Exclude<InputDevice, "gamepad">;
  private connected = false;

  constructor(settings: ControlSettings, initialDevice: InputDevice = "keyboard") {
    this.settings = settings;
    this.device = initialDevice;
    this.fallbackDevice = initialDevice === "touch" ? "touch" : "keyboard";
  }

  connect(): void {
    if (this.connected) return;
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp, { passive: false });
    window.addEventListener("blur", this.clearInputState);
    this.connected = true;
    startLifecycleResource("inputListenerGroups");
    this.updateHeldInputCount();
  }

  disconnect(): void {
    if (!this.connected) return;
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInputState);
    this.clearInputState();
    this.connected = false;
    stopLifecycleResource("inputListenerGroups");
  }

  suspend(): void {
    this.clearInputState();
    recordInputSuspension();
  }

  get activeDevice(): InputDevice {
    return this.device;
  }

  updateSettings(settings: ControlSettings): void {
    this.settings = settings;
    this.pendingKeyboardLane = 0;
  }

  markGamepadCommand(): void {
    if (firstConnectedGamepad()) this.device = "gamepad";
  }

  setTouchControl(control: keyof TouchState, value: boolean | number): void {
    this.device = "touch";
    this.fallbackDevice = "touch";
    if (control === "laneChange") {
      this.touch.laneChange = value === -1 || value === 1 ? value : 0;
    } else if (control === "pitch") {
      this.touch.pitch = typeof value === "number" ? Math.max(-1, Math.min(1, value)) : 0;
    } else {
      this.touch[control] = Boolean(value);
    }
    this.updateHeldInputCount();
  }

  sample(): SimulationInput {
    const binding = this.settings.keyBindings;
    const heldKeyboardLane: LaneChange = this.keys.has(binding.laneLeft ?? "ArrowLeft")
      ? -1
      : this.keys.has(binding.laneRight ?? "ArrowRight")
        ? 1
        : 0;
    const keyboardLane = heldKeyboardLane || this.pendingKeyboardLane;
    const keyboardPitch = this.keys.has(binding.pitchUp ?? "ArrowUp")
      ? 1
      : this.keys.has(binding.pitchDown ?? "ArrowDown")
        ? -1
        : 0;
    const keyboardInput: SimulationInput = {
      throttle: this.keys.has(binding.throttle ?? "KeyW"),
      turbo: this.keys.has(binding.turbo ?? "ShiftLeft"),
      laneChange: keyboardLane,
      pitch: keyboardPitch,
      recover: this.keys.has(binding.recover ?? "Space"),
    };
    const keyboardActive = keyboardInput.throttle
      || keyboardInput.turbo
      || keyboardInput.laneChange !== 0
      || keyboardInput.pitch !== 0
      || keyboardInput.recover;

    const touchActive =
      this.touch.throttle ||
      this.touch.turbo ||
      this.touch.laneChange !== 0 ||
      this.touch.pitch !== 0 ||
      this.touch.recover;
    if (touchActive) {
      this.device = "touch";
      return { ...this.touch };
    }

    const connectedPad = firstConnectedGamepad();
    if (!connectedPad && this.device === "gamepad") this.device = this.fallbackDevice;
    const gamepad = connectedPad ? this.sampleGamepad(connectedPad) : null;
    if (gamepad) return gamepad;

    if (keyboardActive) {
      this.pendingKeyboardLane = 0;
      this.device = "keyboard";
      this.fallbackDevice = "keyboard";
      return keyboardInput;
    }

    if (this.device === "touch") return { ...this.touch };
    return keyboardInput;
  }

  async warnOverheat(): Promise<void> {
    if (!this.settings.vibration) return;
    const pad = firstConnectedGamepad();
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;
    try {
      await actuator.playEffect("dual-rumble", {
        duration: 120,
        strongMagnitude: 0.25,
        weakMagnitude: 0.55,
      });
    } catch {
      // Haptics are optional and some connected pads reject unsupported effects.
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isInteractiveInputTarget(event.target)) return;
    const binding = this.settings.keyBindings;
    const pauseKey = binding.pause ?? "Escape";
    const mappedGameplayKeys = [
      binding.throttle ?? "KeyW",
      binding.turbo ?? "ShiftLeft",
      binding.laneLeft ?? "ArrowLeft",
      binding.laneRight ?? "ArrowRight",
      binding.pitchUp ?? "ArrowUp",
      binding.pitchDown ?? "ArrowDown",
      binding.recover ?? "Space",
    ];
    if (event.ctrlKey || event.metaKey || event.altKey) {
      this.keys.clear();
      this.pendingKeyboardLane = 0;
      this.updateHeldInputCount();
      return;
    }
    if (event.code === pauseKey) {
      event.preventDefault();
      return;
    }
    if (!mappedGameplayKeys.includes(event.code)) return;
    event.preventDefault();
    if (!event.repeat && !this.keys.has(event.code)) {
      if (event.code === (binding.laneLeft ?? "ArrowLeft")) {
        this.pendingKeyboardLane = -1;
      } else if (event.code === (binding.laneRight ?? "ArrowRight")) {
        this.pendingKeyboardLane = 1;
      }
    }
    this.keys.add(event.code);
    this.device = "keyboard";
    this.fallbackDevice = "keyboard";
    this.updateHeldInputCount();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.updateHeldInputCount();
  };

  private readonly clearInputState = (): void => {
    this.keys.clear();
    this.pendingKeyboardLane = 0;
    this.touch.throttle = false;
    this.touch.turbo = false;
    this.touch.laneChange = 0;
    this.touch.pitch = 0;
    this.touch.recover = false;
    this.updateHeldInputCount();
  };

  private updateHeldInputCount(): void {
    const touchInputs = Number(this.touch.throttle)
      + Number(this.touch.turbo)
      + Number(this.touch.laneChange !== 0)
      + Number(this.touch.pitch !== 0)
      + Number(this.touch.recover);
    setHeldInputCount(this.keys.size + touchInputs);
  }

  private sampleGamepad(pad: Gamepad): SimulationInput | null {
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const laneChange: LaneChange =
      pad.buttons[14]?.pressed || axisX < -LANE_AXIS_THRESHOLD
        ? -1
        : pad.buttons[15]?.pressed || axisX > LANE_AXIS_THRESHOLD
          ? 1
          : 0;
    const throttle = Boolean(
      pad.buttons[0]?.pressed
      || (pad.buttons[7]?.value ?? 0) > THROTTLE_TRIGGER_THRESHOLD,
    );
    const turbo = Boolean(
      pad.buttons[1]?.pressed
      || (pad.buttons[6]?.value ?? 0) > TURBO_TRIGGER_THRESHOLD,
    );
    const pitch = Math.abs(axisY) > PITCH_AXIS_THRESHOLD ? -axisY : 0;
    const recover = Boolean(pad.buttons[0]?.pressed);
    const hasInput = throttle || turbo || laneChange !== 0 || pitch !== 0 || recover;
    if (!hasInput) return null;

    this.device = "gamepad";
    return {
      throttle,
      turbo,
      laneChange,
      pitch,
      recover,
    };
  }
}
