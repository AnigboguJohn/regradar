import { chromium } from "playwright";
import path from "node:path"; import { fileURLToPath } from "node:url"; import fs from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const S = here, D = path.join(here, "../../demo/");
fs.mkdirSync(path.join(S, "shots"), { recursive: true });
const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on("console", m => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", e => errors.push(String(e)));
const shot = n => page.screenshot({ path: `${S}/shots/${n}.png`, fullPage: true });
const step = (m) => console.log("✓", m);

await page.goto(WEB + "/");
await page.waitForURL("**/login"); await shot("01-login"); step("redirected to login");
await page.getByText("Create a workspace").click();
await page.fill("#org", "Demo Bank Plc"); await page.fill("#name", "Ada Obi");
await page.fill("#email", "ada@demobank.ng"); await page.fill("#pw", "Str0ngPassw0rd");
await page.getByRole("button", { name: "Create workspace" }).click();
await page.getByText("Good to see you, Ada").waitFor(); await shot("02-overview-empty"); step("registered + overview");

await page.getByRole("link", { name: "Regulations" }).click();
await page.getByText("Add a regulation manually").click();
await page.fill("input[name=title]", "Sample Circular: Revised Tiered KYC Requirements (demo)");
await page.fill("input[name=regulator]", "DEMO"); await page.fill("input[name=ref_no]", "DEMO/KYC/2026/001");
await page.fill("input[name=published_at]", "2026-10-15");
await page.setInputFiles("input[name=file]", D + "sample_circular.txt");
await page.getByRole("button", { name: "Add regulation" }).click();
await page.getByText("DEMO/KYC/2026/001").first().waitFor(); await shot("03-regulations"); step("regulation uploaded via UI");

await page.getByRole("link", { name: "Our policies" }).click();
await page.fill("#ptitle", "Customer Onboarding & KYC Policy v2.1");
await page.setInputFiles("#pfile", D + "sample_policy.pdf");
await page.getByRole("button", { name: "Upload" }).click();
await page.getByRole("cell", { name: "Customer Onboarding & KYC Policy v2.1" }).waitFor(); await shot("04-policies"); step("policy PDF uploaded via UI");

await page.getByRole("link", { name: "Ask" }).click();
await page.fill("input[placeholder^='Ask about']", "What is the maximum cumulative balance for Tier 1 accounts?");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText("Sources").waitFor({ timeout: 30000 });
await page.locator("button[title='Show source 1']").first().click();
await page.getByText("maximum cumulative balance of N300,000").first().waitFor(); await shot("05-ask-cited"); step("cited answer + source expanded");

await page.getByRole("link", { name: "Regulations" }).click();
await page.getByText("Sample Circular: Revised Tiered KYC").first().click();
await page.getByRole("button", { name: "Check impact on our policies" }).click();
await page.getByText("Impact on your policies").waitFor({ timeout: 60000 }); await shot("06-regulation-impact"); step("impact analysis from regulation page");

await page.getByRole("link", { name: "Impact" }).click();
await page.getByText("Show evidence").first().click(); await shot("07-impact"); step("impact page with evidence");
await page.getByRole("button", { name: "Mark resolved" }).first().click();
await page.getByRole("button", { name: "resolved", exact: true }).click(); await page.getByText("Reopen").first().waitFor(); step("finding resolved");

await page.getByRole("link", { name: "Settings" }).click();
await page.getByText("Audit log").waitFor(); await page.waitForTimeout(500); await shot("08-settings"); step("settings, team, audit");
await page.getByRole("link", { name: "Overview" }).click(); await page.getByText("Latest regulations").waitFor(); await page.waitForTimeout(500); await shot("09-overview"); step("overview with data");

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("link", { name: "Overview" }).isVisible();
await page.waitForTimeout(300); await page.screenshot({ path: `${S}/shots/10-mobile.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
step("mobile layout, horizontal overflow: " + overflow);
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
