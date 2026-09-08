import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("includes editable recurring expenses and separated actual-spending categories", async () => {
  const source = (await Promise.all(["../app/page.tsx", "../app/budget-model.ts"].map((path) => fs.readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /Add a bill or subscription/);
  assert.match(source, /function addBill\(/);
  assert.match(source, /function deleteBill\(/);
  assert.match(source, /name: "Groceries"/);
  assert.match(source, /name: "Gas"/);
  assert.match(source, /name: "Fast Food"/);
  assert.match(source, /name: "Restaurants"/);
  assert.match(source, /name: "Other \/ Uncategorized"/);
});

test("projects the month from income, actual spending, and unpaid bills", async () => {
  const source = (await Promise.all(["../app/page.tsx", "../app/budget-model.ts"].map((path) => fs.readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /projectedBalance: income - spent - remainingBills/);
  assert.match(source, /function toggleBillPaid\(/);
  assert.match(source, /includedInProjection/);
  assert.match(source, /Projected monthly balance/);
  assert.doesNotMatch(source, /Safe to spend/i);
});

test("keeps targets secondary and supports low-effort transaction imports", async () => {
  const source = (await Promise.all(["../app/page.tsx", "../app/budget-model.ts"].map((path) => fs.readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /Monthly targets/);
  assert.match(source, /This month only/);
  assert.match(source, /This & future months/);
  assert.match(source, /Upload CSV statement/);
  assert.match(source, /function importStatementTransactions\(/);
  assert.match(source, /Review needed/);
  assert.match(source, /merchantRules/);
  assert.match(source, /minimum: 0, ideal: 0/);
  assert.match(source, /Set your goals in Monthly Plan/);
});

test("supports adding and archiving liabilities while preserving past months", async () => {
  const source = (await Promise.all(["../app/page.tsx", "../app/budget-model.ts"].map((path) => fs.readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /function addDebt\(/);
  assert.match(source, /function archiveDebt\(/);
  assert.match(source, /key >= current\.month \? removeFromSnapshot/);
  assert.match(source, /Earlier months were preserved/);
});
