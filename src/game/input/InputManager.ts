import type { ControlSettings } from "../../app/types";
import type { LaneChange, SimulationInput } from "../simulation";
import {
  recordInputSuspension,
  setHeldInputCount,
  startLifecycleResource,
  stopLifecycleResource,
} from "../qa/lifecycleDiagnostics";

export type InputDevice = "keyboard" | "gamepad" | "touch";

interface TouchState {
  throttle: boolean;
  turbo: boolean;
  laneChange: LaneChange;
  pitch: number;
  recover: boolean;
}

const BUTTON_EPSILON = 0.25;

export class InputManager {
  private readonly keys = new Set<string>();
  private settings: ControlSettings;
  private readonly touch: TouchState = {
    throttle: false,
    turbo: false,
    laneChange: 0,
    pitch: 0,
    recover: false,
  };
  private device: InputDevice = "keyboard";
  private connected = false;

  constructor(settings: ControlSettings) {
    this.settings = settings;
  }

  connect(): void {
    if (this.connected) return;
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp, { passive: false });
    window.addEventListener("blur", this.clearKeys);
    this.connected = true;
    startLifecycleResource("inputListenerGroups");
    this.updateHeldInputCount();
  }

  disconnect(): void {
    if (!this.connected) return;
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearKeys);
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
  }

  setTouchControl(control: keyof TouchState, value: boolean | number): void {
    this.device = "touch";
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
    const gamepad = this.sampleGamepad();
    const binding = this.settings.keyBindings;
    const keyboardLane: LaneChange = this.keys.has(binding.laneLeft ?? "KeyA")
      ? -1
      : this.keys.has(binding.laneRight ?? "KeyD")
        ? 1
        : 0;
    const keyboardPitch = this.keys.has(binding.pitchUp ?? "ArrowUp")
      ? 1
      : this.keys.has(binding.pitchDown ?? "ArrowDown")
        ? -1
        : 0;

    if (gamepad) return gamepad;

    const touchActive =
      this.touch.throttle ||
      this.touch.turbo ||
      this.touch.laneChange !== 0 ||
      this.touch.pitch !== 0 ||
      this.touch.recover;
    if (touchActive || this.device === "touch") {
      return { ...this.touch };
    }

    return {
      throttle: this.keys.has(binding.throttle ?? "KeyW"),
      turbo: this.keys.has(binding.turbo ?? "ShiftLeft"),
      laneChange: keyboardLane,
      pitch: keyboardPitch,
      recover: this.keys.has(binding.recover ?? "Space"),
    };
  }

  async warnOverheat(): Promise<void> {
    if (!this.settings.vibration) return;
    const pad = navigator.getGamepads?.()[0];
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;
    await actuator.playEffect("dual-rumble", {
      duration: 120,
      strongMagnitude: 0.25,
      weakMagnitude: 0.55,
    });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    this.keys.add(event.code);
    this.device = "keyboard";
    this.updateHeldInputCount();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.updateHeldInputCount();
  };

  private readonly clearKeys = (): void => {
    this.keys.clear();
    this.updateHeldInputCount();
  };

  private clearInputState(): void {
    this.keys.clear();
    this.touch.throttle = false;
    this.touch.turbo = false;
    this.touch.laneChange = 0;
    this.touch.pitch = 0;
    this.touch.recover = false;
    this.updateHeldInputCount();
  }

  private updateHeldInputCount(): void {
    const touchInputs = Number(this.touch.throttle)
      + Number(this.touch.turbo)
      + Number(this.touch.laneChange !== 0)
      + Number(this.touch.pitch !== 0)
      + Number(this.touch.recover);
    setHeldInputCount(this.keys.size + touchInputs);
  }

  private sampleGamepad(): SimulationInput | null {
    const pad = navigator.getGamepads?.()[0];
    if (!pad?.connected) return null;

    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const laneChange: LaneChange =
      pad.buttons[14]?.pressed || axisX < -0.55
        ? -1
        : pad.buttons[15]?.pressed || axisX > 0.55
          ? 1
          : 0;
    const hasInput = pad.buttons.some((button) => button.pressed || button.value > BUTTON_EPSILON)
      || Math.abs(axisX) > 0.2
      || Math.abs(axisY) > 0.2;
    if (!hasInput && this.device !== "gamepad") return null;

    this.device = "gamepad";
    return {
      throttle: Boolean(pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.2),
      turbo: Boolean(pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.35),
      laneChange,
      pitch: Math.abs(axisY) > 0.2 ? -axisY : 0,
      recover: Boolean(pad.buttons[0]?.pressed),
    };
  }
}
