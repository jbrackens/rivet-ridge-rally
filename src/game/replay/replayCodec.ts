import {
  FIXED_DT,
  type BikePhase,
  type SimulationState,
  type SurfaceKind,
} from "../simulation";

export const REPLAY_FORMAT_VERSION = 2;
export const REPLAY_HEADER_BYTES = 8;
export const REPLAY_SAMPLE_BYTES = 18;
export const REPLAY_SAMPLE_INTERVAL_STEPS = 6;
export const REPLAY_MAX_STEP_COUNT = 0xffff_ffff;

const MAGIC = [0x52, 0x52, 0x52, 0x50] as const; // RRRP
const HEADER_TRUNCATED_FLAG = 1 << 0;
const SAMPLE_TERMINAL_FLAG = 1 << 7;
const MAX_CADENCE_EXPONENT = 29;
const PHASES = ["grounded", "airborne", "crashed", "recovering"] as const;
const SURFACES = ["dirt", "grass", "mud", "cooling", "ramp"] as const;

export interface ReplayFrame {
  readonly stepCount: number;
  readonly timeSeconds: number;
  readonly forwardPosition: number;
  readonly lanePosition: number;
  readonly lane: 0 | 1 | 2 | 3;
  readonly speed: number;
  readonly heat: number;
  readonly pitch: number;
  readonly height: number;
  readonly phase: BikePhase;
  readonly surface: SurfaceKind;
  readonly wheelie: boolean;
  readonly overheated: boolean;
  readonly terminal: boolean;
}

export type ReplayRecorderFailureReason = "capacity" | "cadence";

export interface ReplayRecorderStatus {
  readonly complete: boolean;
  readonly finalized: boolean;
  readonly truncated: boolean;
  readonly capacityExhausted: boolean;
  readonly failureReason: ReplayRecorderFailureReason | null;
  readonly sampleCount: number;
  readonly sampleCapacity: number;
  readonly sampleIntervalSteps: number;
  readonly compactionCount: number;
  readonly byteLength: number;
  readonly maximumBytes: number;
  readonly remainingBytes: number;
  readonly terminalStep: number | null;
}

interface RecordedSample {
  readonly stepCount: number;
  readonly bytes: Uint8Array;
}

function assertFiniteRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside the replay format range.`);
  }
}

function assertStepCount(stepCount: number): void {
  if (!Number.isSafeInteger(stepCount)) {
    throw new RangeError("Replay step count must be an integer.");
  }
  assertFiniteRange(stepCount, 0, REPLAY_MAX_STEP_COUNT, "Replay step count");
}

function sampleIntervalSteps(cadenceExponent: number): number {
  return REPLAY_SAMPLE_INTERVAL_STEPS * (2 ** cadenceExponent);
}

function createHeader(cadenceExponent: number, truncated: boolean): Uint8Array {
  return Uint8Array.of(
    ...MAGIC,
    REPLAY_FORMAT_VERSION,
    REPLAY_SAMPLE_BYTES,
    cadenceExponent,
    truncated ? HEADER_TRUNCATED_FLAG : 0,
  );
}

function encodeSample(state: SimulationState, terminal: boolean): Uint8Array {
  const { bike } = state;
  assertStepCount(state.stepCount);
  if (!Number.isInteger(bike.lane) || bike.lane < 0 || bike.lane > 3) {
    throw new RangeError("Replay lane is outside the replay format range.");
  }
  assertFiniteRange(
    bike.forwardPosition,
    0,
    REPLAY_MAX_STEP_COUNT / 100,
    "Replay forward position",
  );
  assertFiniteRange(bike.lanePosition, -327.68, 327.67, "Replay lane position");
  assertFiniteRange(bike.speed, 0, 25.5, "Replay speed");
  assertFiniteRange(bike.heat, 0, 100, "Replay heat");
  assertFiniteRange(bike.pitch, -3.2768, 3.2767, "Replay pitch");
  assertFiniteRange(bike.height, 0, 655.35, "Replay height");

  const phase = PHASES.indexOf(bike.phase);
  const surface = SURFACES.indexOf(bike.surface);
  if (phase < 0 || surface < 0) {
    throw new Error("Replay state contains an unsupported enum value.");
  }

  const bytes = new Uint8Array(REPLAY_SAMPLE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, state.stepCount, true);
  view.setUint32(4, Math.round(bike.forwardPosition * 100), true);
  view.setInt16(8, Math.round(bike.lanePosition * 100), true);
  view.setUint8(10, bike.lane);
  view.setUint8(11, Math.round(bike.speed * 10));
  view.setUint8(12, Math.round(bike.heat * 2.55));
  view.setInt16(13, Math.round(bike.pitch * 10_000), true);
  view.setUint16(15, Math.round(bike.height * 100), true);
  view.setUint8(
    17,
    phase
      | (bike.wheelie ? 1 << 2 : 0)
      | (bike.overheated ? 1 << 3 : 0)
      | (surface << 4)
      | (terminal ? SAMPLE_TERMINAL_FLAG : 0),
  );
  return bytes;
}

export function encodeReplaySample(state: SimulationState): Uint8Array {
  return encodeSample(state, false);
}

export function decodeReplay(bytes: Uint8Array): readonly ReplayFrame[] {
  if (bytes.byteLength < REPLAY_HEADER_BYTES) {
    throw new Error("Replay header is truncated.");
  }
  const header = bytes.subarray(0, REPLAY_HEADER_BYTES);
  if (MAGIC.some((value, index) => header[index] !== value)) {
    throw new Error("Replay magic is invalid.");
  }
  if (header[4] !== REPLAY_FORMAT_VERSION) {
    throw new Error("Replay version is unsupported.");
  }
  if (header[5] !== REPLAY_SAMPLE_BYTES) {
    throw new Error("Replay sample width is invalid.");
  }
  const cadenceExponent = header[6];
  if (cadenceExponent === undefined || cadenceExponent > MAX_CADENCE_EXPONENT) {
    throw new Error("Replay sample cadence is unsupported.");
  }
  const headerFlags = header[7];
  if (headerFlags === undefined || (headerFlags & ~HEADER_TRUNCATED_FLAG) !== 0) {
    throw new Error("Replay header flags are unsupported.");
  }
  if ((headerFlags & HEADER_TRUNCATED_FLAG) !== 0) {
    throw new Error("Replay is truncated.");
  }

  const payloadBytes = bytes.byteLength - REPLAY_HEADER_BYTES;
  if (payloadBytes % REPLAY_SAMPLE_BYTES !== 0) {
    throw new Error("Replay payload is truncated.");
  }
  if (payloadBytes === 0) throw new Error("Replay contains no samples.");

  const intervalSteps = sampleIntervalSteps(cadenceExponent);
  const frames: ReplayFrame[] = [];
  let previousStep = -1;
  let foundTerminal = false;
  for (
    let offset = REPLAY_HEADER_BYTES;
    offset < bytes.byteLength;
    offset += REPLAY_SAMPLE_BYTES
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, REPLAY_SAMPLE_BYTES);
    const stepCount = view.getUint32(0, true);
    const lane = view.getUint8(10);
    const flags = view.getUint8(17);
    const terminal = (flags & SAMPLE_TERMINAL_FLAG) !== 0;
    const isLastSample = offset + REPLAY_SAMPLE_BYTES === bytes.byteLength;
    const phaseIndex = flags & 0b11;
    const surfaceIndex = (flags >> 4) & 0b111;

    if (previousStep < 0) {
      if (stepCount !== 0) throw new Error("Replay does not begin at step zero.");
    } else {
      const stepGap = stepCount - previousStep;
      if (stepGap <= 0) throw new Error("Replay steps are not strictly increasing.");
      if (terminal) {
        if (stepGap > intervalSteps) {
          throw new Error("Replay terminal cadence is invalid.");
        }
      } else if (stepGap !== intervalSteps) {
        throw new Error("Replay sample cadence is invalid.");
      }
    }
    if (terminal && !isLastSample) {
      throw new Error("Replay terminal sample is not last.");
    }
    if (lane > 3) throw new Error("Replay lane is invalid.");
    const phase = PHASES[phaseIndex];
    const surface = SURFACES[surfaceIndex];
    if (!phase || !surface) throw new Error("Replay sample enum is invalid.");

    previousStep = stepCount;
    foundTerminal ||= terminal;
    frames.push(Object.freeze({
      stepCount,
      timeSeconds: stepCount * FIXED_DT,
      forwardPosition: view.getUint32(4, true) / 100,
      lanePosition: view.getInt16(8, true) / 100,
      lane: lane as 0 | 1 | 2 | 3,
      speed: view.getUint8(11) / 10,
      heat: view.getUint8(12) / 2.55,
      pitch: view.getInt16(13, true) / 10_000,
      height: view.getUint16(15, true) / 100,
      phase,
      surface,
      wheelie: (flags & (1 << 2)) !== 0,
      overheated: (flags & (1 << 3)) !== 0,
      terminal,
    }));
  }
  if (!foundTerminal) throw new Error("Replay does not end with a terminal sample.");
  return Object.freeze(frames);
}

export function validateReplay(bytes: Uint8Array): readonly ReplayFrame[] {
  return decodeReplay(bytes);
}

/**
 * Records step-zero and a fixed 10 Hz cadence. When the byte budget fills, the
 * recorder keeps every other sample and doubles the declared cadence. The
 * uint32 step field, rather than the 512 KB byte budget, is therefore the
 * practical duration boundary. A terminal sample is always reserved.
 */
export class ReplayRecorder {
  private readonly maximumBytes: number;
  private samples: RecordedSample[] = [];
  private cadenceExponent = 0;
  private lastObservedStep = -1;
  private finalizedValue = false;
  private completeValue = false;
  private failureReasonValue: ReplayRecorderFailureReason | null = null;

  constructor(maximumBytes: number) {
    if (
      !Number.isInteger(maximumBytes)
      || maximumBytes < REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES * 2
    ) {
      throw new RangeError("Replay byte budget is invalid.");
    }
    this.maximumBytes = maximumBytes;
  }

  get status(): ReplayRecorderStatus {
    const byteLength = REPLAY_HEADER_BYTES + this.samples.length * REPLAY_SAMPLE_BYTES;
    const terminalStep = this.completeValue
      ? (this.samples.at(-1)?.stepCount ?? null)
      : null;
    return Object.freeze({
      complete: this.completeValue,
      finalized: this.finalizedValue,
      truncated: this.failureReasonValue !== null,
      capacityExhausted: this.failureReasonValue === "capacity",
      failureReason: this.failureReasonValue,
      sampleCount: this.samples.length,
      sampleCapacity: Math.floor(
        (this.maximumBytes - REPLAY_HEADER_BYTES) / REPLAY_SAMPLE_BYTES,
      ),
      sampleIntervalSteps: sampleIntervalSteps(this.cadenceExponent),
      compactionCount: this.cadenceExponent,
      byteLength,
      maximumBytes: this.maximumBytes,
      remainingBytes: this.maximumBytes - byteLength,
      terminalStep,
    });
  }

  reset(): void {
    this.samples = [];
    this.cadenceExponent = 0;
    this.lastObservedStep = -1;
    this.finalizedValue = false;
    this.completeValue = false;
    this.failureReasonValue = null;
  }

  capture(state: SimulationState): boolean {
    if (this.finalizedValue) return false;
    this.observeStep(state.stepCount);
    if (this.failureReasonValue !== null) return false;

    if (this.samples.length === 0) {
      if (state.stepCount !== 0) {
        this.markFailure("cadence");
        return false;
      }
      this.samples.push({ stepCount: 0, bytes: encodeSample(state, false) });
      return true;
    }

    while (true) {
      const lastSample = this.samples.at(-1);
      if (!lastSample) {
        this.markFailure("cadence");
        return false;
      }
      const expectedStep = lastSample.stepCount + sampleIntervalSteps(this.cadenceExponent);
      if (state.stepCount < expectedStep) return false;
      if (state.stepCount > expectedStep) {
        this.markFailure("cadence");
        return false;
      }

      if (this.hasRoomForRegularSample()) {
        this.samples.push({
          stepCount: state.stepCount,
          bytes: encodeSample(state, false),
        });
        return true;
      }
      if (!this.compact()) {
        this.markFailure("capacity");
        return false;
      }
    }
  }

  finalize(state: SimulationState): boolean {
    if (this.finalizedValue) return this.completeValue;
    this.observeStep(state.stepCount);
    if (this.failureReasonValue !== null) return this.failFinalization();

    if (this.samples.length === 0) {
      if (state.stepCount !== 0) {
        this.markFailure("cadence");
        return this.failFinalization();
      }
      this.samples.push({ stepCount: 0, bytes: encodeSample(state, true) });
      return this.completeFinalization();
    }

    while (true) {
      const lastIndex = this.samples.length - 1;
      const lastSample = this.samples[lastIndex];
      if (!lastSample) {
        this.markFailure("cadence");
        return this.failFinalization();
      }
      const stepGap = state.stepCount - lastSample.stepCount;
      if (stepGap < 0) {
        throw new Error("Replay step count moved backwards without a reset.");
      }
      if (stepGap > sampleIntervalSteps(this.cadenceExponent)) {
        this.markFailure("cadence");
        return this.failFinalization();
      }
      if (stepGap === 0) {
        this.samples[lastIndex] = {
          stepCount: state.stepCount,
          bytes: encodeSample(state, true),
        };
        return this.completeFinalization();
      }
      if (this.samples.length < this.sampleCapacity()) {
        this.samples.push({
          stepCount: state.stepCount,
          bytes: encodeSample(state, true),
        });
        return this.completeFinalization();
      }
      if (!this.compact()) {
        this.markFailure("capacity");
        return this.failFinalization();
      }
    }
  }

  toUint8Array(): Uint8Array {
    const header = createHeader(
      this.cadenceExponent,
      this.failureReasonValue !== null,
    );
    const bytes = new Uint8Array(
      REPLAY_HEADER_BYTES + this.samples.length * REPLAY_SAMPLE_BYTES,
    );
    bytes.set(header);
    for (const [index, sample] of this.samples.entries()) {
      bytes.set(sample.bytes, REPLAY_HEADER_BYTES + index * REPLAY_SAMPLE_BYTES);
    }
    return bytes;
  }

  private observeStep(stepCount: number): void {
    assertStepCount(stepCount);
    if (stepCount < this.lastObservedStep) {
      throw new Error("Replay step count moved backwards without a reset.");
    }
    this.lastObservedStep = stepCount;
  }

  private sampleCapacity(): number {
    return Math.floor((this.maximumBytes - REPLAY_HEADER_BYTES) / REPLAY_SAMPLE_BYTES);
  }

  private hasRoomForRegularSample(): boolean {
    return this.samples.length + 1 < this.sampleCapacity();
  }

  private compact(): boolean {
    if (this.cadenceExponent >= MAX_CADENCE_EXPONENT) return false;
    this.samples = this.samples.filter((_, index) => index % 2 === 0);
    this.cadenceExponent += 1;
    return true;
  }

  private markFailure(reason: ReplayRecorderFailureReason): void {
    this.failureReasonValue ??= reason;
  }

  private completeFinalization(): boolean {
    this.finalizedValue = true;
    this.completeValue = true;
    return true;
  }

  private failFinalization(): boolean {
    this.finalizedValue = true;
    this.completeValue = false;
    return false;
  }
}
