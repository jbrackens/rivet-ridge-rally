import type { AudioSettings } from "../../app/types";
import type { SurfaceKind } from "../simulation";
import {
  startLifecycleResource,
  stopLifecycleResource,
} from "../qa/lifecycleDiagnostics";

export type AudioCue =
  | "ui-move"
  | "ui-confirm"
  | "landing"
  | "rough-landing"
  | "crash"
  | "cooling"
  | "overheat"
  | "checkpoint"
  | "finish"
  | "crowd";

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private terrainSource: AudioBufferSourceNode | null = null;
  private terrainGain: GainNode | null = null;
  private terrainFilter: BiquadFilterNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private settings: AudioSettings;
  private paused = false;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  async unlock(): Promise<boolean> {
    if (!this.context) {
      if (typeof AudioContext === "undefined") return false;
      try {
        this.context = new AudioContext();
        startLifecycleResource("audioContexts");
      } catch {
        this.context = null;
        return false;
      }
      this.master = this.context.createGain();
      this.master.gain.value = this.paused ? 0 : this.settings.master;
      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = this.settings.sfx;
      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = this.settings.music;
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(this.context.destination);
    }
    const context = this.context;
    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    return this.context === context && context.state === "running";
  }

  updateSettings(settings: AudioSettings): void {
    this.settings = settings;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.paused ? 0 : settings.master, this.context.currentTime, 0.03);
      this.sfxBus?.gain.setTargetAtTime(settings.sfx, this.context.currentTime, 0.03);
      this.musicBus?.gain.setTargetAtTime(settings.music, this.context.currentTime, 0.03);
    }
  }

  startEngine(): void {
    const context = this.context;
    const sfxBus = this.sfxBus;
    if (!context || context.state !== "running" || !sfxBus || this.engineOscillator) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = 58;
    filter.type = "lowpass";
    filter.frequency.value = 420;
    gain.gain.value = 0;
    oscillator.connect(filter).connect(gain).connect(sfxBus);
    oscillator.start();
    this.engineOscillator = oscillator;
    this.engineGain = gain;
    this.startAmbience(context, sfxBus);
    this.startMusicTimer();
  }

  updateEngine(speed: number, turbo: boolean, surface: SurfaceKind): void {
    const context = this.context;
    if (!context || !this.engineOscillator || !this.engineGain) return;
    const normalized = Math.min(1, speed / 20);
    this.engineOscillator.frequency.setTargetAtTime(
      58 + normalized * 130 + (turbo ? 28 : 0),
      context.currentTime,
      0.035,
    );
    this.engineGain.gain.setTargetAtTime(
      0.015 + normalized * 0.04,
      context.currentTime,
      0.04,
    );
    this.windGain?.gain.setTargetAtTime(normalized * 0.026, context.currentTime, 0.08);
    const terrainLevel = speed <= 0.5 ? 0 : surface === "mud" ? 0.045 : surface === "grass" ? 0.032 : surface === "dirt" || surface === "ramp" ? 0.02 : 0.012;
    this.terrainGain?.gain.setTargetAtTime(terrainLevel * normalized, context.currentTime, 0.04);
    if (this.terrainFilter) {
      const frequency = surface === "mud" ? 190 : surface === "grass" ? 330 : 520;
      this.terrainFilter.frequency.setTargetAtTime(frequency, context.currentTime, 0.05);
    }
  }

  play(cue: AudioCue): void {
    const context = this.context;
    const sfxBus = this.sfxBus;
    if (!context || !sfxBus || this.settings.sfx <= 0) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const shape = this.cueShape(cue);
    oscillator.type = shape.wave;
    oscillator.frequency.setValueAtTime(shape.startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(shape.endFrequency, now + shape.duration);
    filter.type = "lowpass";
    filter.frequency.value = shape.filter;
    gain.gain.setValueAtTime(shape.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
    oscillator.connect(filter).connect(gain).connect(sfxBus);
    oscillator.start(now);
    oscillator.stop(now + shape.duration);
  }

  dispose(): void {
    this.engineOscillator?.stop();
    this.windSource?.stop();
    this.terrainSource?.stop();
    this.stopMusicTimer();
    this.engineOscillator = null;
    this.engineGain = null;
    this.windSource = null;
    this.windGain = null;
    this.terrainSource = null;
    this.terrainGain = null;
    this.terrainFilter = null;
    if (this.paused) stopLifecycleResource("pausedAudioManagers");
    this.paused = false;
    if (this.context) {
      stopLifecycleResource("audioContexts");
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) startLifecycleResource("pausedAudioManagers");
    else stopLifecycleResource("pausedAudioManagers");

    const context = this.context;
    if (context && this.master) {
      this.master.gain.setTargetAtTime(paused ? 0 : this.settings.master, context.currentTime, 0.03);
    }
    if (paused) {
      this.stopMusicTimer();
      if (context?.state === "running") void context.suspend().catch(() => undefined);
      return;
    }
    if (!context) return;
    void context.resume().then(() => {
      if (!this.paused && this.context === context) this.startMusicTimer();
    }).catch(() => undefined);
  }

  private startMusicTimer(): void {
    if (
      this.paused
      || this.context?.state !== "running"
      || !this.engineOscillator
      || this.musicTimer !== null
    ) return;
    this.playMusicPulse();
    this.musicTimer = window.setInterval(() => this.playMusicPulse(), 620);
    startLifecycleResource("audioIntervals");
  }

  private stopMusicTimer(): void {
    if (this.musicTimer === null) return;
    window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    stopLifecycleResource("audioIntervals");
  }

  private startAmbience(context: AudioContext, sfxBus: GainNode): void {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 0x5eeda11;
    for (let index = 0; index < samples.length; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      samples[index] = (seed / 0xffffffff) * 2 - 1;
    }

    const wind = context.createBufferSource();
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    windFilter.type = "highpass";
    windFilter.frequency.value = 720;
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(sfxBus);
    wind.start();

    const terrain = context.createBufferSource();
    const terrainFilter = context.createBiquadFilter();
    const terrainGain = context.createGain();
    terrain.buffer = buffer;
    terrain.loop = true;
    terrainFilter.type = "lowpass";
    terrainFilter.frequency.value = 520;
    terrainGain.gain.value = 0;
    terrain.connect(terrainFilter).connect(terrainGain).connect(sfxBus);
    terrain.start();

    this.windSource = wind;
    this.windGain = windGain;
    this.terrainSource = terrain;
    this.terrainGain = terrainGain;
    this.terrainFilter = terrainFilter;
  }

  private playMusicPulse(): void {
    const context = this.context;
    const musicBus = this.musicBus;
    if (!context || context.state !== "running" || !musicBus || this.settings.music <= 0) return;
    const notes = [110, 146.83, 164.81, 130.81, 196, 164.81, 146.83, 123.47];
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = this.musicStep % 4 === 0 ? "triangle" : "sine";
    oscillator.frequency.value = notes[this.musicStep % notes.length] ?? 110;
    filter.type = "lowpass";
    filter.frequency.value = 760;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.026, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.54);
    oscillator.connect(filter).connect(gain).connect(musicBus);
    oscillator.start(now);
    oscillator.stop(now + 0.56);
    this.musicStep += 1;
  }

  private cueShape(cue: AudioCue): {
    wave: OscillatorType;
    startFrequency: number;
    endFrequency: number;
    duration: number;
    volume: number;
    filter: number;
  } {
    switch (cue) {
      case "crash": return { wave: "sawtooth", startFrequency: 120, endFrequency: 34, duration: 0.55, volume: 0.16, filter: 900 };
      case "landing": return { wave: "triangle", startFrequency: 105, endFrequency: 58, duration: 0.16, volume: 0.1, filter: 500 };
      case "rough-landing": return { wave: "square", startFrequency: 92, endFrequency: 43, duration: 0.28, volume: 0.12, filter: 520 };
      case "cooling": return { wave: "sine", startFrequency: 620, endFrequency: 980, duration: 0.32, volume: 0.07, filter: 1_800 };
      case "overheat": return { wave: "square", startFrequency: 360, endFrequency: 210, duration: 0.48, volume: 0.08, filter: 1_100 };
      case "checkpoint": return { wave: "triangle", startFrequency: 520, endFrequency: 780, duration: 0.2, volume: 0.07, filter: 1_600 };
      case "finish": return { wave: "triangle", startFrequency: 420, endFrequency: 1_050, duration: 0.65, volume: 0.1, filter: 2_000 };
      case "crowd": return { wave: "sawtooth", startFrequency: 170, endFrequency: 110, duration: 0.7, volume: 0.035, filter: 380 };
      case "ui-confirm": return { wave: "triangle", startFrequency: 440, endFrequency: 660, duration: 0.12, volume: 0.055, filter: 1_400 };
      case "ui-move": return { wave: "sine", startFrequency: 310, endFrequency: 360, duration: 0.06, volume: 0.04, filter: 1_200 };
    }
  }
}
