import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../../app/store";
import { createDefaultProgress } from "../../../game/persistence/database";
import type { StorageDurability } from "../../../game/persistence/storageDurability";
import { SupportScreen } from "../MenuScreens";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

// The support screen prints build identity from Vite-injected globals, which only the
// bundler defines. Supplying them here keeps this component renderable under Vitest
// without adding a global `define` that every other suite would inherit.
const buildEnvironment = globalThis as typeof globalThis & {
  __APP_VERSION__: string;
  __RRR_BUILD_IDENTITY__: Readonly<{ commit: string; dirty: boolean }>;
};
buildEnvironment.__APP_VERSION__ = "1.0.0-test";
buildEnvironment.__RRR_BUILD_IDENTITY__ = { commit: "0123456789abcdef0123", dirty: false };

describe("Support screen storage disclosure", () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderWith = (storageDurability: StorageDurability): string => {
    act(() => {
      useAppStore.setState({ storageDurability });
      root.render(<SupportScreen />);
    });
    return container.querySelector(".support-durability")?.textContent ?? "";
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useAppStore.setState({
      screen: "support",
      progress: createDefaultProgress(),
      storageDurability: "unknown",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("warns that unprotected saves are deletable and names the seven-day rule", () => {
    const text = renderWith("best-effort");

    expect(text).toContain("Saves are best-effort on this device.");
    expect(text).toContain("may delete progress, tracks, and replays to reclaim space");
    expect(text).toContain("seven days without a visit");
  });

  it("confirms protection only once the browser has granted it", () => {
    const text = renderWith("persisted");

    expect(text).toContain("Saves are protected on this device.");
    expect(text).not.toContain("seven days without a visit");
  });

  it("tells a player on an unreporting browser to treat saves as temporary", () => {
    expect(renderWith("unsupported")).toContain("Treat local saves as temporary");
  });

  it("stays silent until durability has actually been read", () => {
    renderWith("unknown");

    expect(container.querySelector(".support-durability")).toBeNull();
  });

  it("exposes the state as a data attribute for support and browser evidence", () => {
    renderWith("best-effort");

    expect(
      container.querySelector(".support-durability")?.getAttribute("data-storage-durability"),
    ).toBe("best-effort");
  });

  it("keeps the existing manual site-data warning alongside the new disclosure", () => {
    renderWith("best-effort");

    expect(container.textContent).toContain(
      "Clearing browser site data permanently removes local progress and tracks.",
    );
  });

  it("omits the Home Screen hint on a desktop browser", () => {
    // jsdom reports a desktop user agent with no touch points, so the iOS-only guidance
    // must not appear; the platform predicate itself is covered in the durability unit tests.
    expect(renderWith("best-effort")).not.toContain("Home Screen");
  });
});
