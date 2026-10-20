import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { ADMIN, failOnPageErrors, signUpAndIn, totp } from "../helpers";

test("admin console: two-step sign-in and every section loads", async ({ page, browser }) => {
  // A company signs up first so the console has something real to show.
  const company = `Console Check ${Date.now()}`;
  const user = await (await browser.newContext()).newPage();
  await signUpAndIn(user, { company });

  // Start from a clean authenticator so this test always walks through the QR-code setup.
  const root = decodeURIComponent(new URL("../../..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
  execSync(`${process.env.COMPOSE ?? "docker compose -p regradar-test -f docker-compose.test.yml"} exec -T api node dist/cli/admin.js reset-2fa --email ${ADMIN.email}`, { cwd: root });

  const noErrors = failOnPageErrors(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Continue" }).click();

  // First sign-in: scan the QR code (here: read the key under "Can't scan?") and enter a code.
  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
  await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();
  await page.getByText("Can't scan? Enter this key instead").click();
  const secret = (await page.locator("details code").innerText()).replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on and sign in" }).click();
  await expect(page.getByText("That code isn't right.")).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  for (const [link, heading] of [["Companies", "Companies"], ["Users", "Users"], ["Regulations & sync", "Regulations & sync"],
    ["System health", "System health"], ["Errors", "Errors"], ["Activity & audit", "Activity & audit"], ["My admin account", "My admin account"]]) {
    await page.locator("aside").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }

  await page.locator("aside").getByRole("link", { name: "Companies" }).click();
  await page.getByPlaceholder(/Search by company name/).fill(company);
  await page.getByRole("link", { name: company }).click();
  await expect(page.getByRole("heading", { name: company })).toBeVisible();

  await page.locator("aside").getByRole("link", { name: "System health" }).click();
  await expect(page.getByText("All clear").or(page.getByText(/Critical|Warning/).first())).toBeVisible();
  noErrors();
});

test("a company user can't open the admin console", async ({ page }) => {
  await signUpAndIn(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});
