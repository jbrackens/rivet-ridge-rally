import { expect, test, type Locator, type Page } from "@playwright/test";

type Rotation = [number, number, number];

type RiderActionState =
  | "neutral"
  | "tuck"
  | "lean-left"
  | "lean-right"
  | "wheelie"
  | "airborne-up"
  | "airborne-down"
  | "airborne-neutral"
  | "landing"
  | "crash"
  | "recovery-hold"
  | "recovery"
  | "reduced-motion";

interface PlayerMotionSnapshot {
  asset: string;
  fallbackReason: string | null;
  trackId: string;
  mode: string;
  courseLength: number;
  stepCount: number;
  timeSeconds: number;
  phase: "grounded" | "airborne" | "crashed" | "recovering";
  forwardPosition: number;
  speed: number;
  pitch: number;
  presentationPitch: number;
  height: number;
  verticalVelocity: number;
  wheelie: boolean;
  lastLanding: "clean" | "rough" | "crash" | null;
  crashCause: "wheelie-timeout" | "landing" | "obstacle" | "rider-contact" | "external" | null;
  recoveryProgress: number;
  inputDevice: string;
  steeringRoll: number;
  presentationRoll: number;
  steeringDirection: "left" | "right" | "none";
  reducedMotion: boolean;
  actionState: RiderActionState;
  landingAgeSeconds: number | null;
  landingCompression: number;
  suspensionCompression: { front: number; rear: number };
  playerScale: number;
  activeBikeName: string;
  activeRiderName: string;
  wheelNames: { front: string; rear: string };
  distinctWheelObjects: boolean;
  wheelX: { front: number; rear: number };
  riderRoot: {
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    positionX: number;
    positionY: number;
    positionZ: number;
  };
  rig: {
    torso: Rotation;
    head: Rotation;
    leftArm: Rotation;
    rightArm: Rotation;
    leftLeg: Rotation;
    rightLeg: Rotation;
  };
}

interface MotionHistoryWindow extends Window {
  __RRR_E2E_MOTION_HISTORY__?: PlayerMotionSnapshot[];
  __RRR_E2E_MOTION_OBSERVER__?: MutationObserver;
}

async function readMotionSnapshot(canvas: Locator): Promise<PlayerMotionSnapshot> {
  const serialized = await canvas.getAttribute("data-player-motion-snapshot");
  if (!serialized) throw new Error("QA player motion snapshot is unavailable.");
  return JSON.parse(serialized) as PlayerMotionSnapshot;
}

async function readDustDiagnostics(canvas: Locator): Promise<{ style: string | null; burstCount: number }> {
  const [style, serializedBurstCount] = await Promise.all([
    canvas.getAttribute("data-grounded-dust-style"),
    canvas.getAttribute("data-grounded-dust-burst-count"),
  ]);
  return {
    style,
    burstCount: Number(serializedBurstCount ?? "0"),
  };
}

async function armSteeringLeanCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    type LeanSnapshot = { steeringRoll?: unknown };
    const motionWindow = window as typeof window & {
      __RRR_STEERING_LEAN_SNAPSHOT__?: LeanSnapshot;
    };
    delete motionWindow.__RRR_STEERING_LEAN_SNAPSHOT__;
    const canvas = document.querySelector<HTMLCanvasElement>(".game-canvas");
    if (!canvas) throw new Error("Race canvas is unavailable.");
    const capture = () => {
      const serialized = canvas.dataset.playerMotionSnapshot;
      if (!serialized) return;
      const snapshot = JSON.parse(serialized) as LeanSnapshot;
      if (typeof snapshot.steeringRoll !== "number" || Math.abs(snapshot.steeringRoll) <= 0.08) return;
      motionWindow.__RRR_STEERING_LEAN_SNAPSHOT__ = snapshot;
      observer.disconnect();
    };
    const observer = new MutationObserver(capture);
    observer.observe(canvas, {
      attributes: true,
      attributeFilter: ["data-player-motion-snapshot"],
    });
    capture();
  });
}

async function readCapturedSteeringLean(page: Page): Promise<PlayerMotionSnapshot | null> {
  return page.evaluate(() => (
    (window as typeof window & {
      __RRR_STEERING_LEAN_SNAPSHOT__?: PlayerMotionSnapshot;
    }).__RRR_STEERING_LEAN_SNAPSHOT__ ?? null
  ));
}

async function armMotionHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const motionWindow = window as MotionHistoryWindow;
    motionWindow.__RRR_E2E_MOTION_OBSERVER__?.disconnect();
    motionWindow.__RRR_E2E_MOTION_HISTORY__ = [];
    const canvas = document.querySelector<HTMLCanvasElement>(".game-canvas");
    if (!canvas) throw new Error("Race canvas is unavailable.");
    const capture = () => {
      const serialized = canvas.dataset.playerMotionSnapshot;
      if (!serialized) return;
      const history = motionWindow.__RRR_E2E_MOTION_HISTORY__;
      if (!history) return;
      history.push(JSON.parse(serialized) as PlayerMotionSnapshot);
      if (history.length > 2_400) history.shift();
    };
    const observer = new MutationObserver(capture);
    observer.observe(canvas, {
      attributes: true,
      attributeFilter: ["data-player-motion-snapshot"],
    });
    motionWindow.__RRR_E2E_MOTION_OBSERVER__ = observer;
    capture();
  });
}

async function readMotionHistory(page: Page): Promise<PlayerMotionSnapshot[]> {
  return page.evaluate(() => [
    ...((window as MotionHistoryWindow).__RRR_E2E_MOTION_HISTORY__ ?? []),
  ]);
}

async function readPeakLandingSnapshot(page: Page): Promise<PlayerMotionSnapshot | null> {
  return page.evaluate(() => {
    const history = (window as MotionHistoryWindow).__RRR_E2E_MOTION_HISTORY__ ?? [];
    let peak: PlayerMotionSnapshot | null = null;
    for (const snapshot of history) {
      if (
        snapshot.actionState === "landing"
        && (!peak || snapshot.landingCompression > peak.landingCompression)
      ) {
        peak = snapshot;
      }
    }
    return peak;
  });
}

function expectedAmplifiedPitch(pitch: number): number {
  return Math.max(-0.72, Math.min(0.72, pitch * 1.45));
}

async function startPractice(page: Page): Promise<Locator> {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible({ timeout: 15_000 });
  const canvas = page.locator(".game-canvas");
  await expect(canvas).toHaveAttribute("data-bike-asset", "ready", { timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-hero-bike-root", "RRR_HeroBikeRider");
  await expect(canvas).toHaveAttribute("data-hero-bike-pose-pivot-count", "6");
  await expect(canvas).toHaveAttribute("data-hero-bike-vertical-offset", "-0.63");
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await expect(canvas).toHaveAttribute("data-player-motion-snapshot", /.+/);
  return canvas;
}

function expectNeutralPose(snapshot: PlayerMotionSnapshot): void {
  expect(snapshot.steeringRoll).toBe(0);
  expect(snapshot.riderRoot).toEqual({
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
  });
  expect(snapshot.rig).toEqual({
    torso: [0, 0, 0],
    head: [0, 0, 0],
    leftArm: [0, 0, 0],
    rightArm: [0, 0, 0],
    leftLeg: [0, 0, 0],
    rightLeg: [0, 0, 0],
  });
}

test.describe("authored hero motion integration", () => {
  test.use({ serviceWorkers: "block" });
  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    await page.goto("about:blank");
    await page.waitForTimeout(250);
  });

  test("drives the installed wheel and pose hooks and honors Reduced Motion", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Authored hero motion diagnostics run once in Chromium");
    test.setTimeout(120_000);

    const canvas = await startPractice(page);
    const neutral = await readMotionSnapshot(canvas);
    expect(neutral).toMatchObject({
      asset: "ready",
      fallbackReason: null,
      trackId: "canyon-kickoff",
      mode: "practice",
      phase: "grounded",
      reducedMotion: false,
      actionState: "neutral",
      playerScale: 1.46,
      activeBikeName: "RRR_BikeVisual",
      activeRiderName: "player-rider",
      wheelNames: { front: "FrontTire", rear: "RearTire" },
      distinctWheelObjects: true,
    });

    await canvas.focus();
    await page.keyboard.down("w");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).speed,
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(10);

    const moving = await readMotionSnapshot(canvas);
    const frontWheelTravel = moving.wheelX.front - neutral.wheelX.front;
    const rearWheelTravel = moving.wheelX.rear - neutral.wheelX.rear;
    expect(frontWheelTravel).toBeLessThan(-0.5);
    expect(rearWheelTravel).toBeLessThan(-0.5);
    expect(Math.abs(frontWheelTravel - rearWheelTravel)).toBeLessThan(0.02);
    expect(Math.abs(moving.riderRoot.rotationX)).toBeGreaterThan(0.001);
    expect(Math.abs(moving.rig.torso[0])).toBeGreaterThan(0.01);
    expect(Math.abs(moving.rig.head[0])).toBeGreaterThan(0.005);
    expect(moving.actionState).toBe("tuck");
    await expect.poll(async () => {
      const snapshot = await readMotionSnapshot(canvas);
      return Math.abs(snapshot.rig.leftArm[0] - snapshot.rig.rightArm[0]);
    }, { timeout: 3_000 }).toBeGreaterThan(0.002);

    await armSteeringLeanCapture(page);
    await page.keyboard.down("ArrowLeft");
    await expect.poll(
      async () => readCapturedSteeringLean(page),
      { timeout: 3_000 },
    ).not.toBeNull();
    const leaning = await readCapturedSteeringLean(page);
    if (!leaning) throw new Error("Steering lean was not captured.");
    expect(Math.abs(leaning.steeringRoll)).toBeGreaterThan(0.08);
    expect(leaning.actionState).toBe("lean-left");
    expect(Math.abs(leaning.rig.torso[2])).toBeGreaterThan(0.03);
    expect(Math.abs(leaning.rig.head[2])).toBeGreaterThan(0.02);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("w");

    await page.keyboard.press("Escape");
    const pauseDialog = page.getByRole("dialog", { name: "Race paused" });
    await expect(pauseDialog).toBeVisible();
    await pauseDialog.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("checkbox", { name: /^Reduced motion/ }).check();
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(pauseDialog).toBeVisible();
    await expect(pauseDialog.getByRole("button", { name: "Resume", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pauseDialog).toHaveCount(0);

    await canvas.focus();
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).reducedMotion,
      { timeout: 3_000 },
    ).toBe(true);
    const reducedBaseline = await readMotionSnapshot(canvas);
    expect(reducedBaseline.actionState).toBe("reduced-motion");
    expect(reducedBaseline.landingCompression).toBe(0);
    expect(reducedBaseline.suspensionCompression).toEqual({ front: 0, rear: 0 });
    expectNeutralPose(reducedBaseline);

    await page.keyboard.down("w");
    await page.keyboard.down("ArrowRight");
    await expect.poll(async () => {
      const snapshot = await readMotionSnapshot(canvas);
      return snapshot.wheelX.front - reducedBaseline.wheelX.front;
    }, { timeout: 3_000 }).toBeLessThan(-0.5);
    const reducedMoving = await readMotionSnapshot(canvas);
    expect(reducedMoving.reducedMotion).toBe(true);
    expect(reducedMoving.actionState).toBe("reduced-motion");
    expect(reducedMoving.wheelX.rear - reducedBaseline.wheelX.rear).toBeLessThan(-0.5);
    expectNeutralPose(reducedMoving);
    await page.keyboard.up("ArrowRight");

    await page.keyboard.down("ArrowUp");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).wheelie,
      { timeout: 3_000 },
    ).toBe(true);
    const reducedWheelie = await readMotionSnapshot(canvas);
    expect(reducedWheelie).toMatchObject({
      phase: "grounded",
      wheelie: true,
      reducedMotion: true,
      actionState: "reduced-motion",
      landingCompression: 0,
      suspensionCompression: { front: 0, rear: 0 },
    });
    expect(reducedWheelie.presentationPitch).toBe(reducedWheelie.pitch);
    expectNeutralPose(reducedWheelie);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.up("w");
  });

  test("reports wheelie, crash hold, and interpolated recovery through public Canyon controls", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Public Canyon rider action evidence runs once in Chromium");
    test.setTimeout(120_000);

    const canvas = await startPractice(page);
    await armMotionHistory(page);
    await canvas.focus();
    await page.keyboard.down("w");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).speed,
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(10);

    await page.keyboard.down("ArrowUp");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).actionState,
      { timeout: 3_000 },
    ).toBe("wheelie");
    const wheelie = await readMotionSnapshot(canvas);
    expect(wheelie).toMatchObject({
      trackId: "canyon-kickoff",
      mode: "practice",
      phase: "grounded",
      wheelie: true,
      actionState: "wheelie",
      crashCause: null,
      reducedMotion: false,
    });
    expect(wheelie.pitch).toBeGreaterThanOrEqual(0.28);
    expect(wheelie.presentationPitch).toBeCloseTo(expectedAmplifiedPitch(wheelie.pitch), 3);
    expect(wheelie.presentationPitch).toBeGreaterThan(wheelie.pitch);
    expect(wheelie.riderRoot.positionZ).toBeGreaterThan(0.1);
    expect(wheelie.rig.torso[0]).toBeLessThan(-0.25);
    expect(wheelie.rig.head[0]).toBeGreaterThan(0.15);
    expect(wheelie.rig.leftLeg[0]).toBeGreaterThan(0.07);

    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).phase,
      { timeout: 20_000, intervals: [100] },
    ).toBe("crashed");
    await page.keyboard.up("ArrowUp");
    await page.keyboard.up("w");
    const crashed = await readMotionSnapshot(canvas);
    const crashDust = await readDustDiagnostics(canvas);
    expect(crashDust.style).toBe("speed-reactive-twin-wheel-trail");
    expect(crashDust.burstCount).toBeGreaterThanOrEqual(1);
    expect(crashed).toMatchObject({
      phase: "crashed",
      wheelie: false,
      crashCause: "wheelie-timeout",
      recoveryProgress: 0,
      actionState: "crash",
      steeringRoll: -1.22,
      presentationRoll: -1.22,
      presentationPitch: 0,
      steeringDirection: "none",
      riderRoot: {
        rotationX: -0.12,
        rotationY: 0.18,
        rotationZ: 0.62,
        positionX: 0.72,
        positionY: 0.48,
        positionZ: -0.18,
      },
    });
    expect(crashed.rig).toEqual({
      torso: [-0.32, 0.18, 0.5],
      head: [0.38, -0.24, 0.28],
      leftArm: [0.62, -0.2, 0.82],
      rightArm: [-0.32, 0.18, -0.72],
      leftLeg: [-0.52, 0.16, 0.4],
      rightLeg: [0.44, -0.12, -0.34],
    });

    await page.keyboard.down("Space");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).recoveryProgress,
      { timeout: 2_000 },
    ).toBeGreaterThan(0.25);
    const crashHold = await readMotionSnapshot(canvas);
    expect(crashHold.phase).toBe("crashed");
    expect(crashHold.actionState).toBe("recovery-hold");
    expect(crashHold.recoveryProgress).toBeLessThan(1);
    expect(crashHold.presentationRoll).toBe(-1.22);
    expect(crashHold.presentationPitch).toBe(0);
    expect(crashHold.riderRoot.positionX).toBeLessThan(crashed.riderRoot.positionX);
    expect(crashHold.riderRoot.positionY).toBeGreaterThan(crashed.riderRoot.positionY);
    expect(crashHold.rig).not.toEqual(crashed.rig);

    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).phase,
      { timeout: 12_000 },
    ).toBe("grounded");
    await page.keyboard.up("Space");
    const recoveredDust = await readDustDiagnostics(canvas);
    expect(recoveredDust.style).toBe("speed-reactive-twin-wheel-trail");
    expect(recoveredDust.burstCount).toBeGreaterThan(crashDust.burstCount);

    const history = await readMotionHistory(page);
    const recoveryFrames = history
      .filter((snapshot) => snapshot.actionState === "recovery")
      .sort((first, second) => first.recoveryProgress - second.recoveryProgress);
    const earlyRecovery = recoveryFrames[0];
    const lateRecovery = recoveryFrames.at(-1);
    expect(earlyRecovery, "an early recovering frame should be recorded").toBeDefined();
    expect(lateRecovery, "a late recovering frame should be recorded").toBeDefined();
    if (!earlyRecovery || !lateRecovery) throw new Error("Recovery interpolation frames are unavailable.");
    expect(earlyRecovery.recoveryProgress).toBeLessThan(0.5);
    expect(lateRecovery.recoveryProgress).toBeGreaterThan(0.5);
    expect(lateRecovery.recoveryProgress - earlyRecovery.recoveryProgress).toBeGreaterThan(0.25);

    expect(Math.abs(earlyRecovery.presentationRoll)).toBeLessThanOrEqual(1.22);
    expect(Math.abs(earlyRecovery.presentationRoll)).toBeGreaterThan(0);
    expect(Math.abs(lateRecovery.presentationRoll)).toBeLessThan(Math.abs(earlyRecovery.presentationRoll));
    expect(earlyRecovery.presentationPitch).toBe(0);
    expect(lateRecovery.presentationPitch).toBe(0);
    expect(earlyRecovery.riderRoot.positionX).toBeGreaterThan(0.25);
    expect(earlyRecovery.riderRoot.positionY).toBeGreaterThan(1);
    expect(lateRecovery.riderRoot.positionX).toBeLessThan(earlyRecovery.riderRoot.positionX);
    expect(lateRecovery.riderRoot.positionY).toBeLessThan(earlyRecovery.riderRoot.positionY);
    expect(Math.abs(lateRecovery.riderRoot.rotationZ)).toBeLessThan(
      Math.abs(earlyRecovery.riderRoot.rotationZ),
    );
    expect(Math.abs(lateRecovery.rig.torso[2])).toBeLessThan(
      Math.abs(earlyRecovery.rig.torso[2]),
    );
  });

  test("reports airborne pitch states and a real landing pulse through public Canyon controls", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Public Canyon airborne evidence runs once in Chromium");
    test.setTimeout(180_000);

    const canvas = await startPractice(page);
    await armMotionHistory(page);
    await canvas.focus();
    await page.keyboard.down("w");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).speed,
      { timeout: 10_000, intervals: [100] },
    ).toBeGreaterThanOrEqual(10);
    await page.keyboard.down("Shift");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).phase,
      { timeout: 80_000, intervals: [100] },
    ).toBe("airborne");
    await page.keyboard.up("Shift");
    const launch = await readMotionSnapshot(canvas);
    const levelingKey = launch.pitch > 0.12
      ? "ArrowDown"
      : launch.pitch < -0.12
        ? "ArrowUp"
        : null;
    if (levelingKey) await page.keyboard.down(levelingKey);
    await expect.poll(
      async () => (await readMotionHistory(page)).some(
        (snapshot) => snapshot.actionState === "airborne-neutral",
      ),
      { timeout: 3_000, intervals: [100] },
    ).toBe(true);
    if (levelingKey) await page.keyboard.up(levelingKey);
    const airborneNeutral = [...await readMotionHistory(page)].reverse().find(
      (snapshot) => snapshot.actionState === "airborne-neutral",
    );
    if (!airborneNeutral) throw new Error("Airborne neutral frame is unavailable.");
    expect(airborneNeutral).toMatchObject({
      trackId: "canyon-kickoff",
      mode: "practice",
      phase: "airborne",
      actionState: "airborne-neutral",
      wheelie: false,
      lastLanding: null,
    });
    expect(airborneNeutral.height).toBeGreaterThan(0);
    expect(Math.abs(airborneNeutral.pitch)).toBeLessThanOrEqual(0.12);
    expect(airborneNeutral.presentationPitch).toBeCloseTo(
      expectedAmplifiedPitch(airborneNeutral.pitch),
      3,
    );

    await page.keyboard.press("ArrowUp", { delay: 120 });
    await expect.poll(
      async () => (await readMotionHistory(page)).some(
        (snapshot) => snapshot.actionState === "airborne-up",
      ),
      { timeout: 2_000 },
    ).toBe(true);
    const airborneUp = [...await readMotionHistory(page)].reverse().find(
      (snapshot) => snapshot.actionState === "airborne-up",
    );
    if (!airborneUp) throw new Error("Airborne nose-up frame is unavailable.");
    expect(airborneUp.phase).toBe("airborne");
    expect(airborneUp.pitch).toBeGreaterThan(0.12);
    expect(airborneUp.presentationPitch).toBeCloseTo(expectedAmplifiedPitch(airborneUp.pitch), 3);
    expect(airborneUp.rig.torso[0]).toBeLessThan(airborneNeutral.rig.torso[0]);
    expect(airborneUp.rig.head[0]).toBeGreaterThan(airborneNeutral.rig.head[0]);

    await expect.poll(
      async () => (await readPeakLandingSnapshot(page))?.landingCompression ?? 0,
      { timeout: 5_000 },
    ).toBeGreaterThan(0.6);
    const landing = await readPeakLandingSnapshot(page);
    if (!landing) throw new Error("Landing compression frame is unavailable.");
    expect(landing).toMatchObject({
      phase: "grounded",
      actionState: "landing",
      reducedMotion: false,
    });
    expect(["clean", "rough"]).toContain(landing.lastLanding);
    expect(landing.stepCount).toBeGreaterThan(airborneUp.stepCount);
    expect(landing.landingAgeSeconds).not.toBeNull();
    expect(landing.landingAgeSeconds ?? Number.POSITIVE_INFINITY).toBeLessThan(0.46);
    expect(landing.riderRoot.positionY).toBeLessThan(0);
    expect(landing.riderRoot.positionZ).toBeLessThan(-0.12);
    expect(landing.pitch - landing.presentationPitch).toBeCloseTo(
      landing.landingCompression * 0.14,
      3,
    );
    expect(landing.presentationPitch).toBeLessThan(landing.pitch - 0.08);
    expect(landing.suspensionCompression.front).toBeGreaterThan(0);
    expect(landing.suspensionCompression.rear).toBeGreaterThan(0);
    expect(landing.suspensionCompression.front).toBeGreaterThan(
      landing.suspensionCompression.rear * 3,
    );

    await expect.poll(
      async () => {
        await page.keyboard.down("Shift");
        const snapshot = await readMotionSnapshot(canvas);
        return snapshot.phase === "airborne" && snapshot.stepCount > landing.stepCount;
      },
      { timeout: 60_000, intervals: [100] },
    ).toBe(true);
    await page.keyboard.up("Shift");
    const secondJump = await readMotionSnapshot(canvas);

    await page.keyboard.press("ArrowDown", { delay: 120 });
    await expect.poll(
      async () => (await readMotionHistory(page)).some(
        (snapshot) => snapshot.stepCount >= secondJump.stepCount
          && snapshot.actionState === "airborne-down",
      ),
      { timeout: 2_000 },
    ).toBe(true);
    await page.keyboard.up("w");
    const airborneDown = [...await readMotionHistory(page)].reverse().find(
      (snapshot) => snapshot.stepCount >= secondJump.stepCount
        && snapshot.actionState === "airborne-down",
    );
    if (!airborneDown) throw new Error("Airborne nose-down frame is unavailable.");
    expect(airborneDown.phase).toBe("airborne");
    expect(airborneDown.stepCount).toBeGreaterThan(landing.stepCount);
    expect(airborneDown.pitch).toBeLessThan(-0.12);
    expect(airborneDown.presentationPitch).toBeCloseTo(
      expectedAmplifiedPitch(airborneDown.pitch),
      3,
    );
    expect(airborneDown.rig.torso[0]).toBeGreaterThan(airborneNeutral.rig.torso[0]);
    expect(airborneDown.rig.head[0]).toBeLessThan(airborneNeutral.rig.head[0]);
  });

  test("keeps the procedural fallback articulated when the authored model cannot load", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Fallback motion diagnostics run once in Chromium");
    test.setTimeout(120_000);
    await page.route("**/assets/3d/hero-bike-rider.glb", (route) => route.abort("failed"));

    await page.goto("/");
    await page.getByRole("button", { name: "Skip training" }).click();
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: /Practice/ }).click();

    const canvas = page.locator(".game-canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-bike-asset", "fallback", { timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-bike-fallback-reason", "load-failed");
    await expect(canvas).not.toHaveAttribute("data-hero-bike-root", /.+/);
    await expect(page.locator(".game-shell")).toHaveAttribute(
      "data-race-gate-phase",
      "racing",
      { timeout: 15_000 },
    );
    await expect(canvas).toHaveAttribute("data-player-motion-snapshot", /.+/);

    const neutral = await readMotionSnapshot(canvas);
    expect(neutral).toMatchObject({
      asset: "fallback",
      fallbackReason: "load-failed",
      phase: "grounded",
      playerScale: 1.46,
      activeBikeName: "procedural-bike-fallback",
      activeRiderName: "player-rider",
      wheelNames: {
        front: "fallback-front-wheel-assembly",
        rear: "fallback-rear-wheel-assembly",
      },
      distinctWheelObjects: true,
    });

    await canvas.focus();
    await page.keyboard.down("w");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).speed,
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(10);
    await expect.poll(async () => {
      const snapshot = await readMotionSnapshot(canvas);
      return Math.abs(snapshot.rig.leftArm[0] - snapshot.rig.rightArm[0]);
    }, { timeout: 3_000 }).toBeGreaterThan(0.002);
    await expect.poll(async () => {
      const snapshot = await readMotionSnapshot(canvas);
      return Math.max(Math.abs(snapshot.rig.leftLeg[0]), Math.abs(snapshot.rig.rightLeg[0]));
    }, { timeout: 3_000 }).toBeGreaterThan(0.005);
    const moving = await readMotionSnapshot(canvas);
    const frontWheelTravel = moving.wheelX.front - neutral.wheelX.front;
    const rearWheelTravel = moving.wheelX.rear - neutral.wheelX.rear;
    expect(frontWheelTravel).toBeLessThan(-0.5);
    expect(rearWheelTravel).toBeLessThan(-0.5);
    expect(Math.abs(frontWheelTravel - rearWheelTravel)).toBeLessThan(0.02);
    expect(Math.abs(moving.riderRoot.rotationX)).toBeGreaterThan(0.001);
    expect(Math.abs(moving.rig.torso[0])).toBeGreaterThan(0.01);
    expect(Math.abs(moving.rig.head[0])).toBeGreaterThan(0.005);
    await page.keyboard.up("w");
  });

  test("diagnostic only: keeps the crash pose active under Reduced Motion through QA setup", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Crash pose diagnostics run once in Chromium");
    test.setTimeout(90_000);

    await page.goto("/?qa-fast-race=1");
    await page.getByRole("button", { name: "Settings and controls", exact: true }).click();
    await page.getByRole("checkbox", { name: /^Reduced motion/ }).check();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.evaluate(() => {
      window.__RRR_QA__?.startTrack("foundry-flight", "practice");
    });

    const canvas = page.getByLabel("Live 3D race on Foundry Flight");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-bike-asset", "ready", { timeout: 20_000 });
    await expect(page.locator(".game-shell")).toHaveAttribute(
      "data-race-gate-phase",
      "racing",
      { timeout: 15_000 },
    );
    await canvas.focus();
    await page.keyboard.down("w");
    await expect.poll(
      async () => (await readMotionSnapshot(canvas)).phase,
      { timeout: 15_000 },
    ).toBe("crashed");
    await page.keyboard.up("w");

    await expect(page.getByText("Barrier hit")).toBeVisible();
    expect(await readMotionSnapshot(canvas)).toMatchObject({
      asset: "ready",
      fallbackReason: null,
      phase: "crashed",
      reducedMotion: true,
      steeringRoll: -1.22,
      presentationRoll: -1.22,
      presentationPitch: 0,
      actionState: "crash",
      riderRoot: {
        rotationX: -0.12,
        rotationY: 0.18,
        rotationZ: 0.62,
        positionX: 0.72,
        positionY: 0.48,
        positionZ: -0.18,
      },
      rig: {
        torso: [-0.32, 0.18, 0.5],
        head: [0.38, -0.24, 0.28],
        leftArm: [0.62, -0.2, 0.82],
        rightArm: [-0.32, 0.18, -0.72],
        leftLeg: [-0.52, 0.16, 0.4],
        rightLeg: [0.44, -0.12, -0.34],
      },
    });
  });
});
