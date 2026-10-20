/** Runs on a phone-sized screen (the "phone" project): no sideways scrolling, menu works. */
import { expect, test, type Page } from "@playwright/test";
import { signUpAndIn } from "../helpers";

const noSidewaysScroll = (page: Page) =>
  expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);

test("pages fit a phone screen and the menu opens", async ({ page }) => {
  await page.goto("/login");
  await noSidewaysScroll(page);
  await signUpAndIn(page);
  for (const path of ["/", "/ask", "/regulations", "/policies", "/settings"]) {
    await page.goto(path);
    await noSidewaysScroll(page);
  }
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Ask Remi" }).click();
  await expect(page).toHaveURL(/\/ask/);
});
