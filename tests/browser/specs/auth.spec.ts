import { expect, test } from "@playwright/test";
import { failOnPageErrors, PASSWORD, signUpAndIn, uniqueEmail } from "../helpers";

test("sign up, sign in and land on the dashboard", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signUpAndIn(page, { name: "Ngozi Eze" });
  await expect(page.getByRole("heading", { name: /Ngozi/ })).toBeVisible();
  noErrors();
});

test("sign-up shows a clear message for an email that's already registered", async ({ page, browser }) => {
  const email = await signUpAndIn(page);
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto("/signup");
  await fresh.getByLabel("Company name").fill("Second Co");
  await fresh.getByLabel("Your name").fill("Someone");
  await fresh.getByLabel("Work email").fill(email);
  await fresh.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await fresh.getByLabel("Confirm password").fill(PASSWORD);
  await fresh.getByRole("button", { name: "Create account" }).click();
  await expect(fresh.getByText("An account with this email already exists.")).toBeVisible();
  await fresh.getByRole("link", { name: "Sign in instead?" }).click();
  await expect(fresh.getByLabel("Email")).toHaveValue(email);
});

test("wrong password offers a reset; unknown email offers sign-up", async ({ page }) => {
  const email = await signUpAndIn(page);
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/login");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-Pass-999");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Forgot your password? Reset it with a code" })).toBeVisible();

  await page.getByLabel("Email").fill("nobody.here@bank.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("There's no account with this email.")).toBeVisible();
  await expect(page.getByRole("alert").getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("forgot password: code page, wrong code counts down", async ({ page }) => {
  const email = await signUpAndIn(page);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page).toHaveURL(/reset-password/);
  await expect(page.getByText("We've sent a 6-digit code to your email.")).toBeVisible();
  await expect(page.getByText(/resend the code in \d+s/)).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByLabel("New password", { exact: true }).fill("Another-Pass-123");
  await page.getByLabel("Confirm new password").fill("Another-Pass-123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("That code is wrong. 4 attempts left.")).toBeVisible();
});

test("an expired session goes back to sign-in with a message", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("regradar.token", "not-a-real-session"));
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/login?expired=1");
  await expect(page.getByText("Your session expired. Please sign in again.")).toBeVisible();
});

test("remember me keeps the session after the browser closes", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndIn(page, { email });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel(/Remember me/).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("regradar.token"))).toBeTruthy();
});
