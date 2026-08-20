import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("includes editable recurring expenses and separated categories", async () => {
  const source = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /New subscription/);
  assert.match(source, /function addBill\(/);
  assert.match(source, /function deleteBill\(/);
  assert.match(source, /group: "Giving"/);
  assert.match(source, /group: "Tax"/);
  assert.match(source, /name: "Miscellaneous"/);
  assert.match(source, /name: "Unexpected"/);
  assert.doesNotMatch(source, /disabled=\{Boolean\(item\.linked\)\}/);
});

test("uses expected and actual totals without requiring transactions", async () => {
  const source = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /function usesAutomaticActual\(/);
  assert.match(source, /item\.linked === "calendar" \|\| item\.linked === "debt"/);
  assert.match(source, /Expected vs\. actual/);
  assert.match(source, /This month only/);
  assert.match(source, /This & future months/);
  assert.match(source, /transactions: \[\{ \.\.\.transactionDraft/);
  assert.match(source, /actual: \(item\.actual \?\? 0\) \+ transactionDraft\.amount/);
});

test("supports adding and archiving liabilities while preserving past months", async () => {
  const source = await fs.readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /function addDebt\(/);
  assert.match(source, /function archiveDebt\(/);
  assert.match(source, /key >= current\.month \? removeFromSnapshot/);
  assert.match(source, /Earlier months were preserved/);
});
