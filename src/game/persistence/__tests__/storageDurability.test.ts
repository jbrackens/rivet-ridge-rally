import { describe, expect, it, vi } from "vitest";

import {
  readInstallEnvironment,
  readStorageDurability,
  requestStorageDurability,
  shouldSuggestHomeScreenInstall,
  type DurabilityHost,
  type StorageDurability,
} from "../storageDurability";

function host(
  persisted: () => Promise<boolean>,
  persist: () => Promise<boolean>,
): DurabilityHost {
  return { storage: { persisted, persist } };
}

describe("readStorageDurability", () => {
  it("reports the existing grant without ever requesting one", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => true);

    await expect(readStorageDurability(host(persisted, persist))).resolves.toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports best-effort storage when no grant exists", async () => {
    await expect(
      readStorageDurability(host(async () => false, async () => true)),
    ).resolves.toBe("best-effort");
  });

  it("treats a browser without the Storage API as unsupported", async () => {
    await expect(readStorageDurability({})).resolves.toBe("unsupported");
    await expect(readStorageDurability(undefined)).resolves.toBe("unsupported");
    await expect(readStorageDurability({ storage: {} })).resolves.toBe("unsupported");
  });

  it("never rejects when the browser throws", async () => {
    const rejecting = host(
      async () => {
        throw new Error("denied");
      },
      async () => true,
    );
    await expect(readStorageDurability(rejecting)).resolves.toBe("unsupported");
  });
});

describe("requestStorageDurability", () => {
  it("skips the request when the grant already exists so no second prompt appears", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => true);

    await expect(requestStorageDurability(host(persisted, persist))).resolves.toBe("persisted");
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("requests the persistent bucket when the grant is absent", async () => {
    const persist = vi.fn(async () => true);

    await expect(
      requestStorageDurability(host(async () => false, persist)),
    ).resolves.toBe("persisted");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("treats a declined request as an expected best-effort outcome", async () => {
    await expect(
      requestStorageDurability(host(async () => false, async () => false)),
    ).resolves.toBe("best-effort");
  });

  it("never rejects when the request throws", async () => {
    const rejecting = host(
      async () => false,
      async () => {
        throw new Error("denied");
      },
    );
    await expect(requestStorageDurability(rejecting)).resolves.toBe("unsupported");
  });
});

describe("readInstallEnvironment", () => {
  const desktopWindow = { matchMedia: () => ({ matches: false }) };

  it("detects iPhone and iPad user agents", () => {
    expect(readInstallEnvironment({ userAgent: "iPhone" }, desktopWindow).iosLike).toBe(true);
    expect(readInstallEnvironment({ userAgent: "iPad" }, desktopWindow).iosLike).toBe(true);
  });

  it("detects touch-capable iPadOS reporting a desktop platform string", () => {
    const environment = readInstallEnvironment(
      { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
      desktopWindow,
    );
    expect(environment.iosLike).toBe(true);
  });

  it("does not treat a real desktop Mac as iOS-like", () => {
    const environment = readInstallEnvironment(
      { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 },
      desktopWindow,
    );
    expect(environment.iosLike).toBe(false);
  });

  it("recognizes both standalone signals", () => {
    expect(
      readInstallEnvironment({ userAgent: "iPhone" }, { matchMedia: () => ({ matches: true }) }).standalone,
    ).toBe(true);
    expect(
      readInstallEnvironment({ userAgent: "iPhone", standalone: true }, desktopWindow).standalone,
    ).toBe(true);
    expect(readInstallEnvironment({ userAgent: "iPhone" }, desktopWindow).standalone).toBe(false);
  });

  it("survives an environment without navigator or window", () => {
    expect(readInstallEnvironment(undefined, undefined)).toEqual({ iosLike: false, standalone: false });
  });

  it("survives a matchMedia implementation that throws", () => {
    const throwing = {
      matchMedia: () => {
        throw new Error("unsupported query");
      },
    };
    expect(readInstallEnvironment({ userAgent: "iPhone" }, throwing).standalone).toBe(false);
  });
});

describe("shouldSuggestHomeScreenInstall", () => {
  const iosBrowser = { iosLike: true, standalone: false };

  it("suggests installation only where it changes the outcome", () => {
    expect(shouldSuggestHomeScreenInstall("best-effort", iosBrowser)).toBe(true);
    expect(shouldSuggestHomeScreenInstall("unsupported", iosBrowser)).toBe(true);
  });

  it("stays silent once the saves are already protected", () => {
    expect(shouldSuggestHomeScreenInstall("persisted", iosBrowser)).toBe(false);
  });

  it("stays silent before durability has been read", () => {
    expect(shouldSuggestHomeScreenInstall("unknown", iosBrowser)).toBe(false);
  });

  it("stays silent when already installed or on another platform", () => {
    expect(shouldSuggestHomeScreenInstall("best-effort", { iosLike: true, standalone: true })).toBe(false);
    expect(shouldSuggestHomeScreenInstall("best-effort", { iosLike: false, standalone: false })).toBe(false);
  });

  it("covers every durability state without throwing", () => {
    const states: StorageDurability[] = ["unknown", "persisted", "best-effort", "unsupported"];
    for (const state of states) {
      expect(typeof shouldSuggestHomeScreenInstall(state, iosBrowser)).toBe("boolean");
    }
  });
});
