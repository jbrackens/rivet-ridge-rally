import { expect, test, type Page } from "@playwright/test";

function observeUnexpectedFailures(page: Page): () => void {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const httpFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpFailures.push(`${response.status()} ${response.url()}`);
  });
  return () => {
    expect(consoleErrors, "unexpected console errors").toEqual([]);
    expect(pageErrors, "unexpected page errors").toEqual([]);
    expect(requestFailures, "unexpected failed requests").toEqual([]);
    expect(httpFailures, "unexpected HTTP failures").toEqual([]);
  };
}

test("unsupported WebGL presents recovery and menu paths instead of crashing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Unsupported-renderer gate runs once in Chromium");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(
      contextId: string,
      ...options: unknown[]
    ) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(contextId)) return null;
      return original.call(this, contextId as "2d", ...options as []) as RenderingContext | null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Race paused at the gate" })).toBeVisible();
  await expect(page.getByText(/WebGL could not be initialized/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry loading" })).toBeVisible();
  await page.getByRole("button", { name: "Return to menu" }).click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
});

test.describe("compressed model network fallback", () => {
  test.use({ serviceWorkers: "block" });

  test("a failed same-origin compressed model request keeps the playable fallback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Asset fallback gate runs once in Chromium");
    const modelRequests: string[] = [];
    await page.route("**/assets/3d/festival-trail-bike.glb", async (route) => {
      modelRequests.push(route.request().url());
      await route.abort("failed");
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toBeVisible();
    await expect(page.getByText("Compressed bike unavailable — safe built-in model active")).toBeVisible({ timeout: 10_000 });
    expect(modelRequests).toEqual(["http://127.0.0.1:4173/assets/3d/festival-trail-bike.glb"]);

    await page.getByRole("button", { name: "Start lesson 1" }).click();
    await page.keyboard.down("w");
    await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.up("w");
  });
});

test("corrupt local progress is quarantined and replaced with a safe profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB recovery gate runs once in Chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("progress", "readwrite");
      transaction.objectStore("progress").put({
        id: "rider-01",
        schemaVersion: 1,
        value: { damaged: true },
        updatedAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await page.getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("status")).toHaveText("A damaged local save was recovered safely.");
  const quarantineCount = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction("quarantine", "readonly").objectStore("quarantine").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  });
  expect(quarantineCount).toBeGreaterThan(0);
});

test("unavailable IndexedDB discloses session mode while a race remains playable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/?qa-fast-race=1");
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  const notice = page.getByRole("alert");
  await expect(notice.getByRole("heading", { name: "Device saving unavailable" })).toBeVisible();
  await expect(notice).toContainText("new progress and settings may disappear");
  await expect(notice.getByRole("button", { name: "Retry device saving" })).toBeVisible();

  await notice.getByRole("button", { name: "Recovery steps" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Export accessible custom tracks first");
  await expect(page.getByRole("alert")).toContainText("reset site data only as a last resort");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /^03 Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  assertCleanRuntime();
});

test("quota write failure stays visible and retry flushes session settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      configurable: true,
      value(this: IDBObjectStore, ...args: unknown[]) {
        const controlledWindow = window as typeof window & { __rrrFailPersistenceWrites?: boolean };
        if (controlledWindow.__rrrFailPersistenceWrites) {
          throw new DOMException("QA storage quota reached.", "QuotaExceededError");
        }
        return Reflect.apply(originalPut, this, args) as IDBRequest<IDBValidKey>;
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = true;
  });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("High contrast").check();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await expect(page.getByRole("alert").getByRole("heading", { name: "Device storage is full" })).toBeVisible();
  await expect(page.getByText("Changes remain active for this session while device saving recovers.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Use Export for a valid draft");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = false;
  });
  await page.getByRole("alert").getByRole("button", { name: "Retry device saving" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Track saved locally.");
  await page.getByRole("button", { name: "Back to festival menu" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  assertCleanRuntime();
});

test("newer-version open failure preserves seeded data and shows upgrade recovery guidance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body>Persistence preservation fixture</body></html>",
  }), { times: 1 });
  await page.goto("/");

  const seed = await page.evaluate(async () => {
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      if ("onblocked" in request) {
        (request as unknown as IDBOpenDBRequest).onblocked = () => reject(new Error("IndexedDB request was blocked."));
      }
    });
    const databaseName = "rivet-ridge-rally";
    const record = {
      id: "future-save-probe",
      payload: "owner data must survive an older app open",
      updatedAt: 1_720_000_000_000,
    };

    await waitForRequest(indexedDB.deleteDatabase(databaseName));
    const openRequest = indexedDB.open(databaseName, 40);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore("futureData", { keyPath: "id" }).put(record);
    };
    const database = await waitForRequest(openRequest);
    const snapshot = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      record,
    };
    database.close();
    return snapshot;
  });
  expect(seed).toEqual({
    version: 40,
    stores: ["futureData"],
    record: {
      id: "future-save-probe",
      payload: "owner data must survive an older app open",
      updatedAt: 1_720_000_000_000,
    },
  });

  await page.addInitScript(() => {
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function open(name: string, version?: number): IDBOpenDBRequest {
      if (name === "rivet-ridge-rally") {
        throw new DOMException("A newer local schema requires an application upgrade.", "VersionError");
      }
      return version === undefined
        ? originalOpen.call(this, name)
        : originalOpen.call(this, name, version);
    };
    Object.defineProperty(window, "__RRR_RESTORE_IDB_OPEN__", {
      configurable: true,
      value() {
        IDBFactory.prototype.open = originalOpen;
      },
    });
  });

  await page.goto("/");
  const skipTraining = page.getByRole("button", { name: "Skip training" });
  const ride = page.getByRole("button", { name: "Ride", exact: true });
  await expect(skipTraining.or(ride)).toBeVisible({ timeout: 15_000 });
  if (await skipTraining.isVisible()) await skipTraining.click();
  await expect(ride).toBeVisible();
  const notice = page.getByRole("alert");
  await expect(notice.getByRole("heading", { name: "Save upgrade needs attention" })).toBeVisible();
  await expect(notice).toContainText("Existing data has not been deleted");
  await notice.getByRole("button", { name: "Recovery steps" }).click();
  await expect(page.getByRole("alert")).toContainText("reset site data only as a last resort");

  const preserved = await page.evaluate(async () => {
    (window as typeof window & { __RRR_RESTORE_IDB_OPEN__?: () => void }).__RRR_RESTORE_IDB_OPEN__?.();
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await waitForRequest(indexedDB.open("rivet-ridge-rally"));
    const record = await waitForRequest(
      database.transaction("futureData", "readonly").objectStore("futureData").get("future-save-probe"),
    );
    const snapshot = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      record,
    };
    database.close();
    return snapshot;
  });
  expect(preserved).toEqual(seed);
  assertCleanRuntime();
});
