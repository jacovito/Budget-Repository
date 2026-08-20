import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMoneyExpression } from "../app/math-expression.ts";

test("evaluates calculator-style money expressions", () => {
  assert.equal(evaluateMoneyExpression("=1200+350"), 1550);
  assert.equal(evaluateMoneyExpression("(100+25)*2"), 250);
  assert.equal(evaluateMoneyExpression("$2,000 / 4"), 500);
  assert.equal(evaluateMoneyExpression("100-25.55"), 74.45);
});

test("rejects unsafe or invalid money expressions", () => {
  assert.equal(evaluateMoneyExpression("alert(1)"), null);
  assert.equal(evaluateMoneyExpression("100/0"), null);
  assert.equal(evaluateMoneyExpression("25-100"), null);
  assert.equal(evaluateMoneyExpression(""), null);
});
