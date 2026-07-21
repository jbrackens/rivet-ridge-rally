import { describe, expect, it } from "vitest";

import {
  FIXED_DT,
  RaceSimulation,
  type SimulationState,
} from "../../simulation";
import {
  decodeReplay,
  encodeReplaySample,
  REPLAY_HEADER_BYTES,
  REPLAY_MAX_STEP_COUNT,
  REPLAY_SAMPLE_BYTES,
  ReplayRecorder,
} from "../replayCodec";

function stateAt(stepCount: number, forwardPosition: number): SimulationState {
  const state = new RaceSimulation().snapshot;
  return {
    ...state,
    stepCount,
    timeSeconds: stepCount * FIXED_DT,
    bike: {
      ...state.bike,
      forwardPosition,
      lane: 3,
      lanePosition: 4.25,
      speed: 19.4,
      heat: 73,
      pitch: -0.4821,
      height: 12.34,
      phase: "airborne",
      surface: "ramp",
      wheelie: true,
      overheated: false,
    },
  };
}

function completeReplay(): Uint8Array {
  const recorder = new ReplayRecorder(512_000);
  recorder.capture(stateAt(0, 0));
  recorder.capture(stateAt(6, 10));
  if (!recorder.finalize(stateAt(12, 20))) {
    throw new Error("Expected the replay fixture to finalize.");
  }
  return recorder.toUint8Array();
}

describe("replay codec v2", () => {
  it("round-trips long custom-race positions and an explicit terminal sample", () => {
    const recorder = new ReplayRecorder(512_000);
    recorder.capture(stateAt(0, 0));
    expect(recorder.finalize(stateAt(6, 179_999.99))).toBe(true);

    const frames = decodeReplay(recorder.toUint8Array());
    const frame = frames.at(-1);
    if (!frame) throw new Error("Expected one decoded terminal replay frame.");

    expect(frame).toMatchObject({
      stepCount: 6,
      forwardPosition: 179_999.99,
      lane: 3,
      lanePosition: 4.25,
      speed: 19.4,
      pitch: -0.4821,
      height: 12.34,
      phase: "airborne",
      surface: "ramp",
      wheelie: true,
      overheated: false,
      terminal: true,
    });
    expect(frame.heat).toBeCloseTo(73, 0);
    expect(recorder.status).toMatchObject({
      complete: true,
      finalized: true,
      truncated: false,
      terminalStep: 6,
    });
  });

  it("compacts cadence before capacity while reserving the terminal sample", () => {
    const recorder = new ReplayRecorder(REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES * 4);

    for (let step = 0; step < 30; step += 1) {
      recorder.capture(stateAt(step, step));
    }
    expect(recorder.finalize(stateAt(30, 30))).toBe(true);

    expect(recorder.status).toMatchObject({
      complete: true,
      capacityExhausted: false,
      sampleCount: 4,
      sampleCapacity: 4,
      sampleIntervalSteps: 12,
      compactionCount: 1,
      byteLength: REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES * 4,
    });
    expect(decodeReplay(recorder.toUint8Array()).map(({ stepCount }) => stepCount)).toEqual([
      0,
      12,
      24,
      30,
    ]);
  });

  it("fails closed after a missed cadence and reset restores a fresh lifecycle", () => {
    const recorder = new ReplayRecorder(512_000);

    expect(recorder.capture(stateAt(0, 0))).toBe(true);
    expect(recorder.capture(stateAt(7, 7))).toBe(false);
    expect(recorder.status).toMatchObject({
      complete: false,
      truncated: true,
      failureReason: "cadence",
    });
    expect(recorder.finalize(stateAt(7, 7))).toBe(false);
    expect(() => decodeReplay(recorder.toUint8Array())).toThrow("Replay is truncated");

    recorder.reset();
    expect(recorder.capture(stateAt(0, 0))).toBe(true);
    expect(recorder.finalize(stateAt(1, 1))).toBe(true);
    expect(decodeReplay(recorder.toUint8Array()).map(({ stepCount }) => stepCount)).toEqual([0, 1]);
  });

  it("exposes fail-closed capacity exhaustion at the uint32 cadence boundary", () => {
    const recorder = new ReplayRecorder(REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES * 2);
    recorder.capture(stateAt(0, 0));

    for (let exponent = 0; exponent <= 29; exponent += 1) {
      recorder.capture(stateAt(6 * (2 ** exponent), 0));
    }

    expect(recorder.status).toMatchObject({
      complete: false,
      truncated: true,
      capacityExhausted: true,
      failureReason: "capacity",
      compactionCount: 29,
    });
    expect(recorder.finalize(stateAt(REPLAY_MAX_STEP_COUNT, 0))).toBe(false);
    expect(() => decodeReplay(recorder.toUint8Array())).toThrow("Replay is truncated");
  });

  it("rejects incomplete, malformed, unsupported, and non-monotonic streams", () => {
    const valid = completeReplay();

    expect(() => decodeReplay(new ReplayRecorder(512_000).toUint8Array())).toThrow(
      "contains no samples",
    );
    expect(() => decodeReplay(valid.subarray(0, 7))).toThrow("header is truncated");

    const badMagic = valid.slice();
    badMagic[0] = 0;
    expect(() => decodeReplay(badMagic)).toThrow("magic is invalid");

    const unsupportedCadence = valid.slice();
    unsupportedCadence[6] = 30;
    expect(() => decodeReplay(unsupportedCadence)).toThrow("cadence is unsupported");

    const unsupportedHeaderFlags = valid.slice();
    unsupportedHeaderFlags[7] = 2;
    expect(() => decodeReplay(unsupportedHeaderFlags)).toThrow("header flags are unsupported");

    const explicitlyTruncated = valid.slice();
    explicitlyTruncated[7] = 1;
    expect(() => decodeReplay(explicitlyTruncated)).toThrow("Replay is truncated");

    const truncatedPayload = valid.slice(0, -1);
    expect(() => decodeReplay(truncatedPayload)).toThrow("payload is truncated");

    const invalidLane = valid.slice();
    invalidLane[REPLAY_HEADER_BYTES + 10] = 4;
    expect(() => decodeReplay(invalidLane)).toThrow("lane is invalid");

    const duplicate = valid.slice();
    new DataView(duplicate.buffer).setUint32(
      REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES,
      0,
      true,
    );
    expect(() => decodeReplay(duplicate)).toThrow("steps are not strictly increasing");

    const invalidCadence = valid.slice();
    new DataView(invalidCadence.buffer).setUint32(
      REPLAY_HEADER_BYTES + REPLAY_SAMPLE_BYTES,
      7,
      true,
    );
    expect(() => decodeReplay(invalidCadence)).toThrow("sample cadence is invalid");

    const earlyTerminal = valid.slice();
    const firstFlagsOffset = REPLAY_HEADER_BYTES + 17;
    earlyTerminal[firstFlagsOffset] = (earlyTerminal[firstFlagsOffset] ?? 0) | 0b1000_0000;
    expect(() => decodeReplay(earlyTerminal)).toThrow("terminal sample is not last");

    const missingTerminal = valid.slice();
    const finalFlagsOffset = missingTerminal.byteLength - 1;
    missingTerminal[finalFlagsOffset] = (missingTerminal[finalFlagsOffset] ?? 0) & 0b0111_1111;
    expect(() => decodeReplay(missingTerminal)).toThrow("does not end with a terminal sample");
  });

  it("rejects numeric values that would overflow fixed-width fields", () => {
    expect(() => encodeReplaySample(stateAt(0, REPLAY_MAX_STEP_COUNT / 100 + 0.01))).toThrow(
      "forward position",
    );
    expect(() => encodeReplaySample({
      ...stateAt(0, 0),
      stepCount: REPLAY_MAX_STEP_COUNT + 1,
    })).toThrow("step count");
  });
});
