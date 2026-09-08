import assert from "node:assert/strict";
import test from "node:test";
import { freshPlan, summarizeMonth, setBillPayment, patchBillInMonth, nextMonthSnapshot, reconcileBillTransactions, normalizePlan } from "../app/budget-model.ts";

function fixture() {
  const plan = freshPlan();
  plan.month = "2026-09";
  plan.incomes = [{ id: "primary", name: "Income", owner: "Household", amount: 4000, expectedRemaining: 1000 }];
  plan.bills = [{ id: "rent", name: "Rent", categoryId: "bills", amount: 1800, dueDay: 1, frequency: "Monthly", paid: false }];
  plan.transactions = [{ id: "groceries", date: "2026-09-02", description: "Groceries", amount: 120, categoryId: "groceries" }];
  return plan;
}

test("checking and unchecking a bill moves the payment without changing the projection", () => {
  const plan = fixture();
  const before = summarizeMonth(plan, plan.month);
  const paid = setBillPayment(plan, "rent", true);
  const after = summarizeMonth(paid, plan.month);
  assert.equal(before.projectedBalance, 3080);
  assert.equal(after.spent, 1920);
  assert.equal(after.remainingBills, 0);
  assert.equal(after.projectedBalance, before.projectedBalance);
  assert.deepEqual(summarizeMonth(setBillPayment(paid, "rent", false), plan.month), before);
  assert.equal(plan.bills[0].paid, false, "updates do not mutate previous state");
});

test("monthly bill amount overrides affect the right figure and keep previous snapshots", () => {
  const plan = fixture();
  const updated = patchBillInMonth(plan, "rent", { amount: 1850 });
  assert.equal(summarizeMonth(updated, plan.month).remainingBills, 1850);
  const paid = patchBillInMonth(setBillPayment(plan, "rent", true), "rent", { amount: 1850 });
  assert.equal(summarizeMonth(paid, plan.month).spent, 1970);
  assert.equal(plan.bills[0].amount, 1800);
});

test("monthly targets, debt balances, and investing plans never masquerade as spending", () => {
  const plan = fixture();
  const before = summarizeMonth(plan, plan.month);
  plan.allocations = plan.allocations.map((item) => ({ ...item, amount: 900 }));
  plan.investmentMonthly = 700;
  plan.debts[0].balance = 5000;
  const after = summarizeMonth(plan, plan.month);
  assert.equal(after.spent, before.spent);
  assert.equal(after.projectedBalance, before.projectedBalance);
});

test("a matched imported payment is counted once and is reset for a new month", () => {
  const plan = fixture();
  plan.transactions.push({ id: "rent-payment", description: "Rent", date: "2026-09-01", amount: 1800, categoryId: "bills" });
  const matched = reconcileBillTransactions(plan, plan.month);
  assert.equal(matched.bills[0].matchedTransactionId, "rent-payment");
  assert.equal(summarizeMonth(matched, plan.month).spent, 1920);
  assert.equal(summarizeMonth(setBillPayment(matched, "rent", false), plan.month).remainingBills, 0);
  const next = nextMonthSnapshot(matched, {});
  assert.equal(next.bills[0].paid, false);
  assert.equal(next.bills[0].matchedTransactionId, undefined);
  assert.equal(summarizeMonth(next, "2026-10").spent, 0);
  assert.equal(summarizeMonth(next, "2026-10").remainingBills, 1800);
});

test("saved income sources and actual amounts survive normalization and restore", () => {
  const plan = fixture();
  plan.incomes.push({ id: "custom-source", name: "Freelance", owner: "Me", amount: 315 });
  const paid = { ...plan, ...setBillPayment(plan, "rent", true) };
  const restored = normalizePlan(JSON.parse(JSON.stringify(paid)));
  assert.equal(restored.incomes[1].name, "Freelance");
  assert.deepEqual(summarizeMonth(restored, plan.month), summarizeMonth(paid, plan.month));
});
