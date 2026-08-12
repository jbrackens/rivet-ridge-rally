/**
 * Durable-storage negotiation for the local rider database.
 *
 * Browsers treat IndexedDB as best-effort by default. Chromium evicts least-recently-used
 * origins under storage pressure, and WebKit deletes all script-writable storage —
 * IndexedDB included — after seven days of browser use without a visit to the site. Because
 * this product keeps every save on the device by design, that default silently converts a
 * returning player's campaign progress, personal bests, and custom tracks into data loss.
 *
 * Requesting the persistent bucket is the documented opt-out. On iOS the documented
 * alternative is a Home Screen installation, which is not part of Safari and therefore
 * carries its own use counter.
 *
 * These helpers never throw and never prompt unnecessarily: `readStorageDurability` only
 * inspects the existing grant, and `requestStorageDurability` skips `persist()` when the
 * grant already exists so browsers that gate it behind a permission prompt are not asked
 * twice. Callers treat every result as advisory; no save path depends on the outcome.
 */

/** Advisory durability of the local rider database in the current browser. */
export type StorageDurability = "unknown" | "persisted" | "best-effort" | "unsupported";

interface DurabilityStorage {
  readonly persist?: () => Promise<boolean>;
  readonly persisted?: () => Promise<boolean>;
}

export interface DurabilityHost {
  readonly storage?: DurabilityStorage;
}

interface ResolvedStorage {
  readonly persist: () => Promise<boolean>;
  readonly persisted: () => Promise<boolean>;
}

function defaultHost(): DurabilityHost | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

/**
 * Returns callable, correctly bound accessors, or `null` when this environment does not
 * expose the Storage API. Older browsers, non-secure contexts, and test environments all
 * land on `null` rather than throwing.
 */
function resolveStorage(host: DurabilityHost | undefined): ResolvedStorage | null {
  const storage = host?.storage;
  if (!storage) return null;
  const { persist, persisted } = storage;
  if (typeof persist !== "function" || typeof persisted !== "function") return null;
  return {
    persist: () => persist.call(storage),
    persisted: () => persisted.call(storage),
  };
}

/** Reports the current grant without requesting one, so it can run during boot silently. */
export async function readStorageDurability(
  host: DurabilityHost | undefined = defaultHost(),
): Promise<StorageDurability> {
  const storage = resolveStorage(host);
  if (!storage) return "unsupported";
  try {
    return (await storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/**
 * Requests the persistent bucket once the player has something worth keeping. Chromium
 * decides from site engagement without prompting, Firefox may prompt, and WebKit resolves
 * `false` unless the site is installed — so a `false` result is an expected outcome rather
 * than a failure.
 */
export async function requestStorageDurability(
  host: DurabilityHost | undefined = defaultHost(),
): Promise<StorageDurability> {
  const storage = resolveStorage(host);
  if (!storage) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

export interface InstallEnvironment {
  /** WebKit-backed iOS/iPadOS, where the seven-day deletion rule applies to every browser. */
  readonly iosLike: boolean;
  /** Already launched from the Home Screen, which carries its own use counter. */
  readonly standalone: boolean;
}

interface InstallNavigator {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly standalone?: unknown;
}

interface InstallWindow {
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

/** Older browsers reject unknown media queries by throwing rather than returning false. */
function matchesStandaloneDisplay(win: InstallWindow | undefined): boolean {
  try {
    return win?.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * iPadOS 13 and later report a desktop platform string, so a touch-capable "MacIntel" is
 * treated as iOS-like. This only ever selects an extra sentence of guidance; nothing
 * gameplay- or storage-related branches on it.
 */
export function readInstallEnvironment(
  nav: InstallNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
  win: InstallWindow | undefined = typeof window === "undefined" ? undefined : window,
): InstallEnvironment {
  const userAgent = nav?.userAgent ?? "";
  const platform = nav?.platform ?? "";
  const maxTouchPoints = nav?.maxTouchPoints ?? 0;
  const iosLike = /iPad|iPhone|iPod/.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);

  return {
    iosLike,
    standalone: matchesStandaloneDisplay(win) || nav?.standalone === true,
  };
}

/**
 * The Home Screen hint is worth showing only when it would change the outcome: the grant is
 * absent, the platform enforces the seven-day rule, and the player is not already installed.
 */
export function shouldSuggestHomeScreenInstall(
  durability: StorageDurability,
  environment: InstallEnvironment,
): boolean {
  if (durability !== "best-effort" && durability !== "unsupported") return false;
  return environment.iosLike && !environment.standalone;
}
