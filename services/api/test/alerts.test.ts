import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, matchesAlert, type NewDoc } from "../src/alerts.ts";

const doc: NewDoc = {
  id: "r1",
  title: "Revised Tiered KYC Requirements for Deposit Money Banks",
  regulator: "CBN",
  ref_no: "FPR/DIR/GEN/CIR/07/001",
  published_at: "2026-10-10",
  url: "https://www.cbn.gov.ng/Out/2026/x.pdf",
};
const base = { emails: ["cco@bank.ng"], regulators: [], keywords: [], enabled: true };

test("alerts match everything by default", () => {
  assert.equal(matchesAlert(base, doc), true);
});

test("alerts respect disabled and empty recipients", () => {
  assert.equal(matchesAlert({ ...base, enabled: false }, doc), false);
  assert.equal(matchesAlert({ ...base, emails: [] }, doc), false);
});

test("alerts filter by regulator (case-insensitive)", () => {
  assert.equal(matchesAlert({ ...base, regulators: ["cbn"] }, doc), true);
  assert.equal(matchesAlert({ ...base, regulators: ["SEC"] }, doc), false);
});

test("alerts filter by keyword in title", () => {
  assert.equal(matchesAlert({ ...base, keywords: ["kyc"] }, doc), true);
  assert.equal(matchesAlert({ ...base, keywords: ["forex", " "] }, doc), false);
});

test("digest lists docs with findings ordered by severity", () => {
  const { subject, text } = buildDigest(
    [doc],
    [
      { regulation_id: "r1", severity: "low", summary: "Wording" },
      { regulation_id: "r1", severity: "high", summary: "Tier 1 limit exceeds new cap" },
      { regulation_id: "other", severity: "high", summary: "unrelated" },
    ],
    "https://app.regradar.io",
  );
  assert.equal(subject, "RegRadar: 1 new regulation · 2 high-impact findings");
  assert.ok(text.indexOf("[HIGH] Tier 1") < text.indexOf("[LOW] Wording"));
  assert.ok(text.includes("CBN · FPR/DIR/GEN/CIR/07/001 · 2026-10-10"));
  assert.ok(!text.includes("unrelated"));
});
