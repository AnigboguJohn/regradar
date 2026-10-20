/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules). Fails on "critical" and
 * "serious" problems such as missing form labels, unlabeled buttons or unreadable contrast.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndIn } from "../helpers";

async function check(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}x) e.g. ${v.nodes[0]?.target}`), "accessibility problems").toEqual([]);
}

test("sign-in and sign-up pages", async ({ page }) => {
  await page.goto("/login");
  await check(page);
  await page.goto("/signup");
  await check(page);
});

test("dashboard, Ask Remi and settings", async ({ page }) => {
  await signUpAndIn(page);
  await check(page);
  await page.goto("/ask");
  await expect(page.getByLabel("Your question")).toBeVisible();
  await check(page);
  await page.goto("/settings?tab=account");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await check(page);
});
