import crypto from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Browser-Test-123";
export const ADMIN = { email: "e2e-admin@regradar.test", password: "E2E-Admin-Pass-2026" };

let n = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}.${Date.now()}.${++n}@bank.test`;

/** Sign up through the real form, then sign in, ending on the dashboard. */
export async function signUpAndIn(page: Page, opts: { company?: string; name?: string; email?: string } = {}) {
  const email = opts.email ?? uniqueEmail();
  await page.goto("/signup");
  await page.getByLabel("Company name").fill(opts.company ?? "Browser Test Bank");
  await page.getByLabel("Your name").fill(opts.name ?? "Tobi Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created. Sign in to continue.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

/** The 6-digit authenticator code for a base32 secret (same algorithm as Google Authenticator). */
export function totp(secret: string, time = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/\s/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const h = crypto.createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
}

/** Fail the test if the page logs a JavaScript error. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors, "JavaScript errors on the page").toEqual([]);
}
