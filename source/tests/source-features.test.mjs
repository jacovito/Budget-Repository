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
  assert.doesNotMatch(source, /disabled=\{Boolean\(item\.linked\)\}/);
});
