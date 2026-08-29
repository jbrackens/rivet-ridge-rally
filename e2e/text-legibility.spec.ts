import { expect, test, type Page } from "@playwright/test";

/**
 * Valve's Steam Deck compatibility criteria: "the smallest on-screen font
 * character should never fall below 9 pixels in height at 1280x800". That is
 * written about *character* height, and the shipped display face is Barlow
 * Condensed, whose cap height runs about 0.7x its font-size — so a 9 px cap
 * needs roughly a 13 px font-size and the 12 px floor asserted here is the
 * conservative reading applied to defaults.
 *
 * Asserted against shipped defaults deliberately. The game offers a UI scale
 * setting reaching 140%, but Deck Verified judges the configuration a player
 * gets without opening settings.
 */
const FLOOR_PX = 12;
const DECK_VIEWPORT = { width: 1280, height: 800 };

interface MeasuredText {
  px: number;
  text: string;
  selector: string;
}

async function textBelowFloor(page: Page): Promise<MeasuredText[]> {
  return page.evaluate((floor) => {
    const found: MeasuredText[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      const element = node.parentElement;
      if (!element) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (Number(style.opacity) === 0) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Screen-reader-only copy is never rendered for sighted players.
      if (element.closest(".sr-only")) continue;
      const px = Number.parseFloat(style.fontSize);
      if (px >= floor) continue;
      found.push({ px: Number(px.toFixed(2)), text: text.slice(0, 60), selector: element.className || element.tagName });
    }
    return found;
  }, FLOOR_PX);
}

test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium",
    "The legibility floor is a CSS measurement and runs once in Chromium at the Deck viewport",
  );
});

test.describe("default text legibility at the Steam Deck viewport", () => {
  test.use({ viewport: DECK_VIEWPORT });

  test("no default screen renders visible text below the floor", async ({ page }) => {
    await page.goto("/?qa-fast-race=1");

    // Rider School — a fresh profile boots straight into it, so it is the first
    // text a new player reads.
    const skip = page.getByRole("button", { name: "Skip training" });
    await expect(skip).toBeVisible({ timeout: 30_000 });
    expect(await textBelowFloor(page), "Rider School intro").toEqual([]);

    // Title screen.
    await skip.click();
    const ride = page.getByRole("button", { name: "Ride", exact: true });
    await expect(ride).toBeVisible();
    expect(await textBelowFloor(page), "title screen").toEqual([]);

    // Track and mode select — carries "Solo best", the personal-best string the
    // whole time-trial loop is read from.
    await ride.click();
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    expect(await textBelowFloor(page), "track and mode select").toEqual([]);

    // Live race HUD.
    await page.evaluate(() => {
      if (!window.__RRR_QA__) throw new Error("The legibility gate requires a VITE_QA_MODE=1 build.");
      window.__RRR_QA__.startTrack("canyon-kickoff", "practice");
    });
    await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    expect(await textBelowFloor(page), "race HUD").toEqual([]);
  });
});
