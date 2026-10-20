import { expect, test } from "@playwright/test";
import { PASSWORD, signUpAndIn, uniqueEmail } from "../helpers";

test("invite a member who joins from the link", async ({ page, browser }) => {
  await signUpAndIn(page, { company: "Invite Test Bank" });
  await page.goto("/settings?tab=team");
  const invitee = uniqueEmail("member");
  await page.getByLabel("Email address").fill(invitee);
  await page.getByRole("button", { name: "Send invite" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toContain("/invite/");
  await expect(page.getByRole("listitem").filter({ hasText: invitee })).toBeVisible();   // listed under Pending invites

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole("heading", { name: "Join Invite Test Bank" })).toBeVisible();
  await expect(guest.getByLabel("Email")).toHaveValue(invitee);
  await guest.getByLabel("Your name").fill("New Member");
  await guest.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await guest.getByLabel("Confirm password").fill(PASSWORD);
  await guest.getByRole("button", { name: "Join Invite Test Bank" }).click();
  await expect(guest.getByText("You've joined Invite Test Bank. Sign in to continue.")).toBeVisible();
  await guest.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await guest.getByRole("button", { name: "Sign in" }).click();
  await expect(guest).toHaveURL(/\/$/);   // signed in and on the dashboard
  await guest.goto("/settings");
  await expect(guest.getByRole("heading", { name: "Account settings" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Team" })).toHaveCount(0);   // members don't manage the team

  await guest.goto(new URL(link).pathname);
  await expect(guest.getByText("You're already signed in")).toBeVisible();
});

test("changing your name updates the sidebar", async ({ page }) => {
  await signUpAndIn(page, { name: "Old Name" });
  await page.goto("/settings?tab=account");
  await page.getByLabel("Full name").fill("Chiamaka Obi");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator("aside").getByText("Chiamaka Obi")).toBeVisible();
});
