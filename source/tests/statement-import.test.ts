import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeMerchant,
  parseStatementCsv,
  transactionFingerprint,
} from "../app/statement-import.ts";

test("categorizes the requested common merchants locally", () => {
  assert.equal(categorizeMerchant("PUBLIX #1234"), "groceries");
  assert.equal(categorizeMerchant("SHELL OIL 00912"), "gas");
  assert.equal(categorizeMerchant("CHICK-FIL-A 0312"), "fast-food");
  assert.equal(categorizeMerchant("NETFLIX.COM"), "subscriptions");
  assert.equal(categorizeMerchant("Unknown merchant"), "other-uncategorized");
});

test("parses checking-account CSV expenses and ignores deposits", () => {
  const csv = [
    "Date,Description,Amount",
    "08/01/2026,Publix,-45.32",
    "08/02/2026,Payroll,2750.00",
  ].join("\n");
  const parsed = parseStatementCsv(csv, "auto");
  assert.equal(parsed.detectedMode, "negative");
  assert.deepEqual(parsed.transactions, [{ date: "2026-08-01", description: "Publix", amount: 45.32 }]);
});

test("parses credit-card CSV files when charges are positive", () => {
  const csv = [
    "Transaction Date,Description,Amount",
    "08/03/2026,Taco Bell,12.45",
    "08/04/2026,Payment,-100.00",
  ].join("\n");
  const parsed = parseStatementCsv(csv, "positive");
  assert.deepEqual(parsed.transactions, [{ date: "2026-08-03", description: "Taco Bell", amount: 12.45 }]);
});

test("creates stable duplicate fingerprints", () => {
  assert.equal(
    transactionFingerprint("2026-08-01", "PUBLIX #123", 45.32, "Checking"),
    transactionFingerprint("2026-08-01", "Publix #123", 45.32, "checking"),
  );
});
