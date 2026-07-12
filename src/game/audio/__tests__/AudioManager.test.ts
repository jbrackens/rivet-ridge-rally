import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioManager } from "../AudioManager";

class FakeAudioParam {
  value = 0;
  readonly setTargetAtTime = vi.fn();
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  connect(): this { return this; }
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;
  readonly gains: FakeGain[] = [];
  readonly destination = {};
  readonly currentTime = 4;
  readonly state = "running";
  readonly close = vi.fn(async () => undefined);

  constructor() {
    FakeAudioContext.latest = this;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

describe("AudioManager mix buses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudioContext.latest = null;
  });

  it("creates separate master, SFX, and music buses and applies live volume changes", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const audio = new AudioManager({ master: 0.8, music: 0.55, sfx: 0.7 });
    await audio.unlock();

    const context = FakeAudioContext.latest;
    expect(context?.gains.map((gain) => gain.gain.value)).toEqual([0.8, 0.7, 0.55]);
    audio.updateSettings({ master: 0.35, music: 0.2, sfx: 0.65 });

    expect(context?.gains[0]?.gain.setTargetAtTime).toHaveBeenCalledWith(0.35, 4, 0.03);
    expect(context?.gains[1]?.gain.setTargetAtTime).toHaveBeenCalledWith(0.65, 4, 0.03);
    expect(context?.gains[2]?.gain.setTargetAtTime).toHaveBeenCalledWith(0.2, 4, 0.03);
    audio.dispose();
    expect(context?.close).toHaveBeenCalledOnce();
  });

  it("keeps the game usable when Web Audio is unavailable", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const audio = new AudioManager({ master: 1, music: 1, sfx: 1 });
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => audio.play("crash")).not.toThrow();
    audio.dispose();
  });
});
