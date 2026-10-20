import { expect, test } from "@playwright/test";
import { failOnPageErrors, signUpAndIn } from "../helpers";

async function ask(page: import("@playwright/test").Page, question: string) {
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

test("ask Remi, keep the conversation, rename and export it", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signUpAndIn(page);
  await page.getByRole("link", { name: "Ask Remi" }).click();
  await expect(page.getByText(/How can I help with compliance today/)).toBeVisible();

  await ask(page, "hi, how are you doing?");
  await expect(page.getByText(/I'm Remi, your RegRadar compliance assistant/)).toBeVisible();
  await expect(page).toHaveURL(/\/ask\?c=\d+/);

  // The conversation is saved: it reopens after a reload and is listed in the sidebar.
  await page.reload();
  await expect(page.getByText("hi, how are you doing?").first()).toBeVisible();
  const row = page.locator("aside").getByRole("link", { name: "hi, how are you doing?" });
  await expect(row).toBeVisible();

  // Rename from the ⋯ menu
  await page.locator("aside").getByRole("button", { name: /Options for/ }).first().click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.locator("aside").getByLabel("Conversation name");
  await input.fill("Greeting chat");
  await input.press("Enter");
  await expect(page.locator("aside").getByRole("link", { name: "Greeting chat" })).toBeVisible();

  // Export as text downloads a file containing the conversation
  await page.getByRole("button", { name: "Export chat" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Export as text" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Remi - .*\.txt$/);

  // New chat starts empty
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText(/How can I help with compliance today/)).toBeVisible();
  noErrors();
});

test("archive and delete a conversation", async ({ page }) => {
  await signUpAndIn(page);
  await page.goto("/ask");
  await ask(page, "what can you do?");
  await expect(page.getByText(/I'm Remi/)).toBeVisible();

  await page.locator("aside").getByRole("button", { name: /Options for/ }).first().click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByText("Conversation archived")).toBeVisible();
  await page.goto("/settings?tab=chats");
  await expect(page.getByText("what can you do?")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Nothing archived")).toBeVisible();
});
