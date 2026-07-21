import { useEffect, useRef, useState } from "react";

import type { GameSettings, RaceMode } from "../../app/types";
import {
  getMasteryGoal,
  isMasteryUnlocked,
  isTrackUnlocked,
  MASTERY_TRACK_ID,
  useAppStore,
} from "../../app/store";
import { TRACKS, getTrack } from "../../game/content/tracks";
import { formatKeyCode, getKeyBindingRejectionReason } from "../../game/input/keyLabels";
import { formatTime } from "../format";
import { RallyIcon } from "../icons/RallyIcon";

const CONTROL_ACTION_LABELS: Readonly<Record<string, string>> = {
  throttle: "Ride",
  turbo: "Turbo",
  laneLeft: "Lane left",
  laneRight: "Lane right",
  pitchUp: "Pitch up",
  pitchDown: "Pitch down",
  recover: "Recover",
  pause: "Pause",
};

function getControlActionLabel(action: string): string {
  return CONTROL_ACTION_LABELS[action] ?? action.replace(/([A-Z])/g, " $1");
}

function formatPriorBestDelta(currentMs: number, priorBestMs: number): string {
  const delta = currentMs - priorBestMs;
  if (delta === 0) return "±00:00.00";
  return `${delta < 0 ? "−" : "+"}${formatTime(Math.abs(delta))}`;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <rect x="5" y="10" width="14" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HelmetIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="helmet-icon">
      <path d="M7 25C7 13 15 6 27 6c8 0 14 4 17 10l-13 2 9 8-7 13H17L7 31Z" fill="currentColor" />
      <path d="m12 27 18-7 6 5-15 5Z" fill="var(--navy)" opacity=".82" />
    </svg>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="Rivet Ridge Rally">
      <span>Rivet</span>
      <span className="brand-ridge">Ridge</span>
      <span className="brand-rally">Rally</span>
    </div>
  );
}

interface BootScreenProps {
  message?: string;
}

export function BootScreen({ message }: BootScreenProps) {
  const bootMessage = useAppStore((state) => state.bootMessage);
  const statusMessage = message ?? bootMessage;
  return (
    <main className="boot-screen" aria-live="polite">
      <div className="boot-mark" aria-hidden="true"><span>R</span></div>
      <p>{statusMessage}</p>
      <div className="loading-track"><span /></div>
    </main>
  );
}

export function TitleScreen() {
  const progress = useAppStore((state) => state.progress);
  const selectTrack = useAppStore((state) => state.selectTrack);
  const navigate = useAppStore((state) => state.navigate);
  const openSettings = useAppStore((state) => state.openSettings);
  const recoveredSave = useAppStore((state) => state.recoveredSave);
  const selected = getTrack(progress.selectedTrackId);
  const unlockedCount = TRACKS.filter((track) => isTrackUnlocked(progress, track.id)).length;

  return (
    <main className="title-screen">
      <div className="menu-sky" aria-hidden="true">
        <div className="mesa mesa-one" />
        <div className="mesa mesa-two" />
        <div className="festival-track"><span /><span /><span /><span /></div>
        <div className="cooling-arch" />
        <div className="menu-bike"><span className="bike-wheel wheel-a" /><span className="bike-wheel wheel-b" /><span className="bike-body" /></div>
      </div>

      <section className="title-panel" aria-labelledby="game-title">
        <h1 id="game-title" className="sr-only">Rivet Ridge Rally</h1>
        <BrandMark />
        <nav className="main-actions" aria-label="Main menu">
          <button className="menu-action primary" onClick={() => navigate("mode-select")}>
            <span>Ride</span><ChevronIcon />
          </button>
          <button className="menu-action" onClick={() => navigate("editor")}>
            <span>Track Builder</span><ChevronIcon />
          </button>
          <button className="menu-action" onClick={() => navigate("tutorial")}>
            <span>Rider School</span><ChevronIcon />
          </button>
          <button className="menu-action" onClick={openSettings}>
            <span>Settings</span><ChevronIcon />
          </button>
        </nav>
      </section>

      <aside className="rider-summary" aria-label="Local rider progress">
        <HelmetIcon />
        <div><strong>Rider 01</strong><span>{unlockedCount} / 5 tracks</span></div>
      </aside>

      <section className="campaign-rail" aria-label="Campaign tracks">
        <div className="rail-line" aria-hidden="true" />
        {TRACKS.map((track) => {
          const unlocked = isTrackUnlocked(progress, track.id);
          const active = track.id === selected.id;
          return (
            <button
              key={track.id}
              className={`campaign-stop ${active ? "active" : ""} ${unlocked ? "" : "locked"}`}
              disabled={!unlocked}
              aria-pressed={active}
              aria-label={`${track.name}${unlocked ? "" : ", locked"}`}
              onClick={() => selectTrack(track.id)}
            >
              <span className={`stop-shape shape-${track.order}`}>
                {unlocked ? track.order : <LockIcon />}
              </span>
              <strong>{track.name}</strong>
              <small>{active ? track.skillFocus : unlocked ? track.tagline : "Finish third to unlock"}</small>
            </button>
          );
        })}
      </section>

      {recoveredSave ? <p className="save-recovery" role="status">A damaged local save was recovered safely.</p> : null}
      <footer className="menu-footer">
        <span><kbd>Tab</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Select</span>
        <button className="menu-support-link" onClick={() => navigate("support")}>Support · Privacy · Accessibility</button>
        <span>v{__APP_VERSION__} · Local play · No account · No in-game tracking</span>
      </footer>
    </main>
  );
}

interface ModeDefinition {
  id: RaceMode;
  name: string;
  description: string;
  stat: string;
}

const MODES: readonly ModeDefinition[] = [
  { id: "solo", name: "Solo Challenge", description: "Beat the third-place target without rider contact.", stat: "Precision" },
  { id: "rival", name: "Rival Main Race", description: "Read the pack, protect your rear wheel, and finish top three.", stat: "6 riders" },
  { id: "practice", name: "Practice", description: "Learn every lane with no target and immediate restarts.", stat: "No pressure" },
];

export function ModeScreen() {
  const progress = useAppStore((state) => state.progress);
  const navigate = useAppStore((state) => state.navigate);
  const startRace = useAppStore((state) => state.startRace);
  const track = getTrack(progress.selectedTrackId);
  const trackProgress = progress.tracks[track.id];
  const masteryUnlocked = isMasteryUnlocked(progress);
  const masteryGoal = getMasteryGoal(trackProgress.masteryLevel);
  const modes: readonly ModeDefinition[] = track.id === MASTERY_TRACK_ID
    ? [
        ...MODES,
        {
          id: "mastery",
          name: "Summit Mastery",
          description: masteryGoal.isMaxTierReplay
            ? `Max-tier replay: finish top three by ${formatTime(masteryGoal.targetMs)} from ${masteryGoal.startingHeat}% heat.`
            : `Tier ${masteryGoal.tier}: finish top three by ${formatTime(masteryGoal.targetMs)}. ${masteryGoal.modifier} begins at ${masteryGoal.startingHeat}% heat.`,
          stat: masteryGoal.isMaxTierReplay
            ? "Mastered"
            : `Tier ${masteryGoal.tier} / ${masteryGoal.tierCount}`,
        },
      ]
    : MODES;

  return (
    <main className="panel-screen mode-screen">
      <header className="screen-header">
        <button className="back-button" onClick={() => navigate("title")} aria-label="Back to main menu"><RallyIcon kind="back" /></button>
        <div><p>Selected track</p><h1>{track.name}</h1></div>
        <div className="target-block">
          <span>Third-place target</span>
          <strong>{formatTime(track.soloTargetMs)}</strong>
          <small>Solo best · {trackProgress.bestSoloMs === undefined ? "No run" : formatTime(trackProgress.bestSoloMs)}</small>
        </div>
      </header>
      <section className="mode-layout">
        <div className="track-poster" style={{ "--track-accent": `#${track.palette.accent.toString(16).padStart(6, "0")}` } as React.CSSProperties}>
          <span className="track-number">0{track.order}</span>
          <div className="poster-ramp" aria-hidden="true" />
          <h2>{track.tagline}</h2>
          <p>{track.theme}</p>
          <dl><div><dt>Focus</dt><dd>{track.skillFocus}</dd></div><div><dt>Course</dt><dd>{track.courseLength} m × 2</dd></div></dl>
        </div>
        <div className="mode-list" aria-label="Race modes">
          {modes.map((mode, index) => {
            const locked = mode.id === "rival"
              ? !trackProgress.rivalUnlocked
              : mode.id === "mastery"
                ? !masteryUnlocked
                : false;
            const description = locked
              ? mode.id === "mastery"
                ? "Finish top three in the Summit Rival Main Race to unlock mastery."
                : "Beat the Solo Challenge target to unlock."
              : mode.description;
            return (
              <button
                key={mode.id}
                className={`mode-row ${locked ? "locked" : ""}`}
                disabled={locked}
                onClick={() => startRace(mode.id)}
              >
                <span className="mode-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="mode-copy"><strong>{mode.name}</strong><small>{description}</small></span>
                <span className="mode-stat">{locked ? <LockIcon /> : mode.stat}</span>
                <ChevronIcon />
              </button>
            );
          })}
        </div>
      </section>
      <footer className="panel-footer"><button onClick={() => navigate("title")}>Back</button><span>Immediate retry is available after every run.</span></footer>
    </main>
  );
}

export function SupportScreen() {
  const navigate = useAppStore((state) => state.navigate);
  const resetLocalProgress = useAppStore((state) => state.resetLocalProgress);
  const [resetPending, setResetPending] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const buildLabel = `${__RRR_BUILD_IDENTITY__.commit.slice(0, 12)}${__RRR_BUILD_IDENTITY__.dirty ? " · working tree" : ""}`;

  return (
    <main className="panel-screen support-screen">
      <header className="screen-header">
        <button className="back-button" onClick={() => navigate("title")} aria-label="Back to main menu"><RallyIcon kind="back" /></button>
        <div><p>Local-first release information</p><h1>Support &amp; privacy</h1></div>
      </header>

      <section className="support-layout" aria-label="Product support, privacy, accessibility, and release information">
        <div className="support-lede">
          <div>
            <span>Rider service board</span>
            <h2>Your game data stays on this device</h2>
            <p>Rivet Ridge Rally runs without an account, ads, payments, analytics SDKs, or behavioral tracking in the game. The commercial operator, public support channel, hosting policy, and retention commitments still require owner decisions before launch.</p>
          </div>
          <dl className="support-build" aria-label="Installed build identity">
            <div><dt>Version</dt><dd>{__APP_VERSION__}</dd></div>
            <div><dt>Source build</dt><dd>{buildLabel}</dd></div>
            <div><dt>Release state</dt><dd>Candidate · acceptance pending</dd></div>
          </dl>
        </div>

        <div className="support-grid">
          <article className="support-card" aria-labelledby="support-heading">
            <span>01 · Help</span>
            <h2 id="support-heading">Support</h2>
            <p><strong>Public support contact: not published.</strong> The release owner must add a verified support address or URL before commercial launch. There is currently no authorized inbox for support, safety, privacy, or accessibility requests.</p>
            <p>When a verified channel is published, include the version and source build shown above, browser and operating system, input method, and exact reproduction steps. Do not send passwords, identifying information, or private track files to an unverified contact.</p>
          </article>

          <article className="support-card" aria-labelledby="privacy-heading">
            <span>02 · On-device data</span>
            <h2 id="privacy-heading">Privacy</h2>
            <p>Progress, settings, personal race replays, custom tracks, and recoverable damaged-track records are stored in this browser on this device. A service worker caches game files for offline play. The game does not intentionally upload those saved records.</p>
            <p>The eventual hosting provider may process ordinary web-request information such as an IP address and user agent. The operator identity, host, request-log policy, retention period, and deletion-response commitment have not been selected or published.</p>
            <p><strong>Clearing browser site data permanently removes local progress and tracks.</strong> Export any custom tracks you need from Track Builder before clearing it.</p>
          </article>

          <article className="support-card" aria-labelledby="accessibility-heading">
            <span>03 · Rider access</span>
            <h2 id="accessibility-heading">Accessibility</h2>
            <p>Settings include reduced motion, reduced screen shake, high contrast, gameplay captions, colorblind-safe indicators, UI scaling, remappable keyboard controls, separate audio levels, mirrored touch controls, and optional vibration.</p>
            <p>Formal assistive-technology, cross-browser, and physical-device acceptance is still pending for this candidate. <strong>Accessibility contact: not published.</strong> The release owner must provide the verified reporting channel before launch.</p>
          </article>

          <article className="support-card" aria-labelledby="about-heading">
            <span>04 · Product</span>
            <h2 id="about-heading">About</h2>
            <p>Rivet Ridge Rally is an original local-first 3D arcade motocross game. It includes five campaign tracks, Rider School, solo and rival racing, Practice, and an on-device Track Builder.</p>
            <p>This screen identifies a working release candidate, not final commercial approval. The product operator identity and top-level product license remain owner decisions and must be published before release.</p>
          </article>

          <article className="support-card device-data-controls" aria-labelledby="device-data-heading">
            <span>05 · Device controls</span>
            <h2 id="device-data-heading">Reset race progress</h2>
            <p>This resets Rider School completion, campaign unlocks, best times, and mastery progress. Settings, custom tracks, recoverable damaged-track records, and cached game files stay on this device.</p>
            {resetPending ? (
              <div className="support-reset-confirmation" role="group" aria-labelledby="reset-confirmation-heading">
                <strong id="reset-confirmation-heading">Reset all race progress now?</strong>
                <p>This cannot be undone. Exporting custom tracks is not required because this action does not delete them.</p>
                <div className="support-reset-actions">
                  <button type="button" onClick={() => {
                    resetLocalProgress();
                    setResetPending(false);
                    setResetNotice("Race progress was reset. Device persistence will save the reset when available.");
                  }}>Reset progress now</button>
                  <button type="button" onClick={() => setResetPending(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setResetNotice(""); setResetPending(true); }}>Reset race progress…</button>
            )}
            <p className="support-reset-notice" role="status" aria-live="polite">{resetNotice}</p>
          </article>
        </div>

        <aside className="support-owner-actions" aria-labelledby="owner-actions-heading">
          <div><span>Launch blockers</span><h2 id="owner-actions-heading">Owner-supplied public information required</h2></div>
          <dl>
            <div><dt>Support and accessibility contact</dt><dd>Blocked · verified public address or URL not supplied</dd></div>
            <div><dt>Operator / data-controller identity</dt><dd>Blocked · legal public identity not supplied</dd></div>
            <div><dt>Host and request-log policy</dt><dd>Blocked · provider and public policy not selected</dd></div>
            <div><dt>Retention and deletion-response periods</dt><dd>Blocked · owner commitments not defined</dd></div>
          </dl>
        </aside>
      </section>

      <footer className="panel-footer"><button onClick={() => navigate("title")}>Back to menu</button><span>Do not replace owner decisions with invented contact or retention details.</span></footer>
    </main>
  );
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}

export function SettingsScreen() {
  const settings = useAppStore((state) => state.settings);
  const persistenceStatus = useAppStore((state) => state.persistenceStatus);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const closeOverlay = useAppStore((state) => state.closeOverlay);
  const [activeTab, setActiveTab] = useState<"accessibility" | "audio" | "play">("accessibility");
  const [remapping, setRemapping] = useState<string | null>(null);
  const [remapError, setRemapError] = useState("");
  const captureRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const updateAccessibility = (patch: Partial<GameSettings["accessibility"]>) => updateSettings({ ...settings, accessibility: { ...settings.accessibility, ...patch } });
  const updateAudio = (patch: Partial<GameSettings["audio"]>) => updateSettings({ ...settings, audio: { ...settings.audio, ...patch } });
  const updateControls = (patch: Partial<GameSettings["controls"]>) => updateSettings({ ...settings, controls: { ...settings.controls, ...patch } });

  useEffect(() => {
    if (remapping) captureRef.current?.focus();
  }, [remapping]);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (remapping) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setRemapping(null);
      setRemapError("");
      closeOverlay();
    };
    window.addEventListener("keydown", closeWithEscape, { capture: true });
    return () => window.removeEventListener("keydown", closeWithEscape, { capture: true });
  }, [closeOverlay, remapping]);

  return (
    <main className="panel-screen settings-screen">
      <header className="screen-header"><button ref={closeButtonRef} className="back-button" aria-label="Close settings" onClick={closeOverlay}><RallyIcon kind="back" /></button><div><p>Rider setup</p><h1>Settings</h1></div></header>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {(["accessibility", "audio", "play"] as const).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              aria-pressed={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          {activeTab === "accessibility" ? (
            <>
              <h2>Make every cue readable</h2>
              <SettingToggle label="Reduced motion" description="Removes camera speed lift and nonessential movement." checked={settings.accessibility.reducedMotion} onChange={(value) => updateAccessibility({ reducedMotion: value })} />
              <SettingToggle label="Reduced screen shake" description="Keeps impact feedback visual and audible without camera shake." checked={settings.accessibility.reducedShake} onChange={(value) => updateAccessibility({ reducedShake: value })} />
              <SettingToggle label="High contrast" description="Strengthens HUD, focus, track-edge, and hazard separation." checked={settings.accessibility.highContrast} onChange={(value) => updateAccessibility({ highContrast: value })} />
              <SettingToggle label="Gameplay captions" description="Shows landing, heat, collision, and cooling sound cues as text." checked={settings.accessibility.captions} onChange={(value) => updateAccessibility({ captions: value })} />
              <SettingToggle label="Colorblind-safe indicators" description="Adds shapes and patterns wherever color carries meaning." checked={settings.accessibility.colorblindSafe} onChange={(value) => updateAccessibility({ colorblindSafe: value })} />
              <label className="range-row"><span><strong>UI scale</strong><small>{Math.round(settings.accessibility.uiScale * 100)}%</small></span><input type="range" min="0.8" max="1.4" step="0.1" value={settings.accessibility.uiScale} onChange={(event) => updateAccessibility({ uiScale: Number(event.target.value) })} /></label>
            </>
          ) : null}
          {activeTab === "audio" ? (
            <>
              <h2>Mix</h2>
              {(["master", "music", "sfx"] as const).map((channel) => <label className="range-row" key={channel}><span><strong>{channel}</strong><small>{Math.round(settings.audio[channel] * 100)}%</small></span><input aria-label={`${channel} volume`} type="range" min="0" max="1" step="0.05" value={settings.audio[channel]} onChange={(event) => updateAudio({ [channel]: Number(event.target.value) })} /></label>)}
              <p className="settings-note">Engine, landing, crash, terrain, wind, crowd, and UI cues are generated locally by the browser. No audio is streamed.</p>
            </>
          ) : null}
          {activeTab === "play" ? (
            <>
              <h2>Controls and performance</h2>
              <label className="select-row"><span><strong>Quality</strong><small>Auto chooses a safe renderer preset.</small></span><select value={settings.quality} onChange={(event) => updateSettings({ ...settings, quality: event.target.value as GameSettings["quality"] })}><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <label className="select-row"><span><strong>Difficulty</strong><small>Changes route planning, consistency, decisions, and recovery.</small></span><select value={settings.difficulty} onChange={(event) => updateSettings({ ...settings, difficulty: event.target.value as GameSettings["difficulty"] })}><option value="rookie">Rookie</option><option value="rider">Rider</option><option value="ace">Ace</option></select></label>
              <SettingToggle label="Mirror touch controls" description="Swaps steering/pitch and throttle/turbo sides." checked={settings.controls.mirroredTouch} onChange={(value) => updateControls({ mirroredTouch: value })} />
              <SettingToggle label="Gamepad vibration" description="Uses a short warning pulse before overheating where supported." checked={settings.controls.vibration} onChange={(value) => updateControls({ vibration: value })} />
              <SettingToggle label="Retro recovery tapping" description="Optional only. Hold-to-recover always remains available." checked={settings.controls.retroRecovery} onChange={(value) => updateControls({ retroRecovery: value })} />
              <div className="key-grid" aria-label="Keyboard bindings">
                {Object.entries(settings.controls.keyBindings).map(([action, code]) => (
                  <div key={action}>
                    <span>{action.replace(/([A-Z])/g, " $1")}</span>
                    <button
                      ref={remapping === action ? captureRef : undefined}
                      aria-label={remapping === action
                        ? `Choose a key for ${getControlActionLabel(action)}`
                        : `Remap ${getControlActionLabel(action)}, currently ${formatKeyCode(code)}`}
                      onClick={() => { setRemapError(""); setRemapping(action); }}
                      onKeyDown={(event) => {
                        if (remapping !== action) return;
                        event.preventDefault();
                        const rejectionReason = getKeyBindingRejectionReason(event.code);
                        if (rejectionReason) {
                          setRemapError(rejectionReason);
                          return;
                        }
                        const conflict = Object.entries(settings.controls.keyBindings).find(([otherAction, otherCode]) => otherAction !== action && otherCode === event.code);
                        if (conflict) {
                          setRemapError(`${formatKeyCode(event.code)} is already assigned to ${getControlActionLabel(conflict[0])}. Choose another key.`);
                          return;
                        }
                        updateControls({ keyBindings: { ...settings.controls.keyBindings, [action]: event.code } });
                        setRemapError("");
                        setRemapping(null);
                      }}
                    >
                      {remapping === action ? "Press a key…" : formatKeyCode(code)}
                    </button>
                  </div>
                ))}
              </div>
              {remapError ? <p className="control-error" role="alert">{remapError}</p> : null}
            </>
          ) : null}
        </section>
      </div>
      <footer className="panel-footer"><button onClick={closeOverlay}>Done</button><span>{persistenceStatus.mode === "session" ? "Changes remain active for this session while device saving recovers." : "Settings save automatically to this device."}</span></footer>
    </main>
  );
}

export function ResultsScreen() {
  const result = useAppStore((state) => state.latestResult);
  const replayFailureReason = useAppStore((state) => state.latestReplayFailureReason);
  const retryRace = useAppStore((state) => state.retryRace);
  const navigate = useAppStore((state) => state.navigate);
  if (!result) return <TitleScreen />;
  const trackName = result.trackName ?? getTrack(result.trackId).name;
  const gap = result.targetMs === undefined ? null : result.finishTimeMs - result.targetMs;
  const masteryGoal = result.masteryGoal;
  const hasCompetitiveField = (result.mode === "rival" || result.mode === "mastery")
    && result.fieldSize > 1
    && result.classification.length > 1;
  const heading = masteryGoal
    ? result.masteryGoalMet
      ? masteryGoal.isMaxTierReplay ? "Mastery replay cleared" : "Mastery tier cleared"
      : "Mastery goal missed"
    : gap !== null && gap <= 0
      ? "Target cleared"
      : hasCompetitiveField && result.position <= 3
        ? "Podium finish"
        : "Run complete";
  const coachLabel = masteryGoal
    ? `Mastery ${masteryGoal.tier} / ${masteryGoal.tierCount}`
    : "Coach";
  const coachCopy = masteryGoal
    ? result.masteryGoalMet
      ? masteryGoal.isMaxTierReplay
        ? "Max-tier replay cleared. Keep refining the Summit line."
        : masteryGoal.tier === masteryGoal.tierCount
          ? "Final mastery tier cleared. The maximum challenge remains replayable."
          : `Tier ${masteryGoal.tier} cleared. The next goal starts hotter and tightens the target.`
      : `Finish top three by ${formatTime(masteryGoal.targetMs)} from ${masteryGoal.startingHeat}% starting heat.`
    : result.coachingHint;
  const winnerTimeMs = result.classification[0]?.finishTimeMs;
  const replayFailureDetail = replayFailureReason === "capacity"
    ? "the recorder reached its byte capacity"
    : replayFailureReason === "cadence"
      ? "the fixed-step recording cadence was interrupted"
      : "the recorder did not reach a complete terminal sample";

  return (
    <main className="results-screen">
      <div className="results-stripe" aria-hidden="true" />
      <header><p>{masteryGoal ? `Summit Mastery · Tier ${masteryGoal.tier}` : result.mode === "rival" ? `Position ${result.position} / ${result.fieldSize}` : trackName}</p><h1>{heading}</h1><span className="final-time-label">Final time</span><strong className="final-time">{formatTime(result.finishTimeMs)}</strong>{result.personalBest ? <span className="personal-best">★ New personal best</span> : null}</header>
      <section className="result-grid" aria-label="Race breakdown">
        {result.lapTimesMs.map((lapTime, index) => {
          const priorBestLap = result.mode === "solo"
            ? result.previousBestLapTimesMs?.[index]
            : undefined;
          return (
            <div key={`${index}-${lapTime}`}>
              <span>Lap {index + 1}</span>
              <strong>{formatTime(lapTime)}</strong>
              {priorBestLap === undefined ? null : (
                <small className="prior-best-comparison">
                  Prior PB {formatTime(priorBestLap)} · {formatPriorBestDelta(lapTime, priorBestLap)}
                </small>
              )}
            </div>
          );
        })}
        {result.targetMs !== undefined ? <div><span>Target</span><strong>{formatTime(result.targetMs)}</strong></div> : null}
        <div><span>Target gap</span><strong>{gap === null ? result.mode === "practice" || result.mode === "custom" ? "Free ride" : "Not applicable" : `${gap <= 0 ? "−" : "+"}${formatTime(Math.abs(gap))}`}</strong></div>
        {result.mode === "solo" ? <div><span>Saved best before run</span><strong>{result.previousBestMs === undefined ? "No prior time" : formatTime(result.previousBestMs)}</strong></div> : null}
        {result.mode === "solo" ? <div><span>Best time</span><strong>{formatTime(result.bestTimeMs ?? result.finishTimeMs)}</strong></div> : null}
        <div><span>Crashes</span><strong>{result.crashes}</strong></div>
        <div><span>Overheats</span><strong>{result.overheats}</strong></div>
      </section>
      {result.classification.length > 1 ? (
        <section className="race-classification" aria-labelledby="classification-title">
          <h2 id="classification-title">Official classification</h2>
          <table aria-label={`Official ${result.fieldSize}-rider classification`}>
            <thead><tr><th scope="col">Pos</th><th scope="col">Rider</th><th scope="col">Finish time</th><th scope="col">Gap</th></tr></thead>
            <tbody>
              {result.classification.map((entry) => (
                <tr key={entry.riderId} data-player={entry.isPlayer || undefined}>
                  <td className="classification-position">{entry.position}</td>
                  <th scope="row">{entry.riderName}</th>
                  <td className="classification-time">{formatTime(entry.finishTimeMs)}</td>
                  <td>{winnerTimeMs === undefined || entry.position === 1 ? "—" : `+${formatTime(entry.finishTimeMs - winnerTimeMs)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {result.splitTimesMs.length > 0 ? (
        <section className="split-breakdown" aria-label="Checkpoint split times">
          <h2>Checkpoint splits</h2>
          <ol>
            {result.splitTimesMs.map((split, index) => {
              const priorBestSplit = result.mode === "solo"
                ? result.previousBestSplitTimesMs?.[index]
                : undefined;
              return (
                <li key={`${index}-${split}`}>
                  <span>Lap {Math.floor(index / result.checkpointCount) + 1} · CP {(index % result.checkpointCount) + 1}</span>
                  <strong>{formatTime(split)}</strong>
                  {priorBestSplit === undefined ? null : (
                    <small className="prior-best-comparison">
                      Prior PB {formatTime(priorBestSplit)} · {formatPriorBestDelta(split, priorBestSplit)}
                    </small>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      {replayFailureReason ? (
        <p className="replay-unavailable-notice" role="status">
          <span>Replay unavailable</span>
          Your official result and progress were kept, but no replay was saved because {replayFailureDetail}.
        </p>
      ) : null}
      <p className="coach-note"><span>{coachLabel}</span>{coachCopy}</p>
      <nav className="result-actions"><button className="button-primary" onClick={retryRace}>Retry now</button>{result.mode === "custom" ? <button onClick={() => navigate("editor")}>Return to Track Builder</button> : <button onClick={() => navigate("mode-select")}>Change mode</button>}<button onClick={() => navigate("title")}>Festival menu</button></nav>
    </main>
  );
}
