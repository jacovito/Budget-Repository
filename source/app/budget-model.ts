import { normalizeMerchant, transactionFingerprint, type MerchantRule, type StatementTransaction } from "./statement-import.ts";

export type Income = { id: string; name: string; owner: string; amount: number; expectedRemaining?: number };
export type Allocation = {
  id: string;
  name: string;
  group: string;
  amount: number;
  actual?: number | null;
  actualMode?: "auto" | "manual";
  linked?: "calendar" | "debt" | "goals" | "investing";
};
export type Bill = {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  dueDay: number;
  frequency: "Monthly" | "Annual";
  dueMonth?: number;
  paid?: boolean;
  paidAmount?: number;
  includedInProjection?: boolean;
  matchedTransactionId?: string;
};
export type Debt = { id: string; name: string; categoryId: string; balance: number; apr: number; minimum: number; extra: number };
export type Goal = { id: string; name: string; current: number; target: number; monthly: number; targetDate: string };
export type InvestmentBucket = { id: string; name: string; percent: number };
export type Asset = { id: string; name: string; type: string; balance: number };
export type Transaction = {
  id: string;
  date: string;
  description: string;
  categoryId: string;
  owner?: string;
  account?: string;
  amount: number;
  source?: "manual" | "import";
  reviewNeeded?: boolean;
  fingerprint?: string;
  billId?: string;
};
export type ImportPreviewTransaction = StatementTransaction & {
  id: string;
  categoryId: string;
  reviewNeeded: boolean;
  duplicate: boolean;
};

export type MonthSnapshot = {
  dataVersion?: number;
  incomes: Income[];
  allocations: Allocation[];
  bills: Bill[];
  debts: Debt[];
  goals: Goal[];
  investmentMonthly: number;
  investmentBuckets: InvestmentBucket[];
  assets: Asset[];
  transactions: Transaction[];
};

export type Plan = MonthSnapshot & {
  month: string;
  months: Record<string, MonthSnapshot>;
  years: number[];
  expectedDefaults: Record<string, number>;
  merchantRules: MerchantRule[];
  savingsTargets: { minimum: number; ideal: number };
};

export const LEGACY_STORAGE_KEY = "paycheck-plan-v1";
export const ACTIVE_PROFILE_KEY = "paycheck-active-profile-v1";
export const DATA_VERSION = 3;

export const spendingCategories = [
  { id: "groceries", name: "Groceries", color: "#2f8f67", soft: "#e4f4ec" },
  { id: "gas", name: "Gas", color: "#cb7a2b", soft: "#fbefdf" },
  { id: "fast-food", name: "Fast Food", color: "#d65b45", soft: "#fbe8e4" },
  { id: "restaurants", name: "Restaurants", color: "#9a67c8", soft: "#f1e9f8" },
  { id: "bills", name: "Bills", color: "#397db5", soft: "#e6f0f8" },
  { id: "subscriptions", name: "Subscriptions", color: "#725dc1", soft: "#ece9f8" },
  { id: "car-transportation", name: "Car / Transportation", color: "#2f9aa0", soft: "#e1f3f3" },
  { id: "personal", name: "Personal", color: "#ba6d87", soft: "#f8e9ee" },
  { id: "shopping", name: "Shopping", color: "#b08a2e", soft: "#f7f0dd" },
  { id: "other-uncategorized", name: "Other / Uncategorized", color: "#71817d", soft: "#edf1ef" },
  { id: "giving", name: "Giving", color: "#e27739", soft: "#fcece2" },
  { id: "tax", name: "Tax", color: "#6f63a8", soft: "#eceaf5" },
] as const;

export const spendingCategoryIds = new Set<string>(spendingCategories.map((category) => category.id));
export const legacyAllocationMap: Record<string, string> = {
  tithe: "giving",
  rent: "bills",
  fpl: "bills",
  "car-insurance": "car-transportation",
  fun: "personal",
  health: "personal",
  misc: "other-uncategorized",
  unexpected: "other-uncategorized",
};

export function canonicalSpendingCategory(id: string) {
  if (spendingCategoryIds.has(id)) return id;
  if (legacyAllocationMap[id]) return legacyAllocationMap[id];
  if (id === "car-payment") return "car-transportation";
  if (id === "credit-card" || id.startsWith("debt-")) return "bills";
  return "other-uncategorized";
}

export const initialPlan: Plan = {
  dataVersion: DATA_VERSION,
  month: "2026-08",
  incomes: [
    { id: "income-primary", name: "Primary income", owner: "Me", amount: 0 },
    { id: "income-secondary", name: "Secondary income", owner: "Me", amount: 0 },
    { id: "income-partner", name: "Partner income", owner: "Partner", amount: 0 },
    { id: "income-other", name: "Other income", owner: "Household", amount: 0 },
  ],
  allocations: [
    { id: "groceries", name: "Groceries", group: "Spending", amount: 0 },
    { id: "gas", name: "Gas", group: "Spending", amount: 0 },
    { id: "fast-food", name: "Fast Food", group: "Spending", amount: 0 },
    { id: "restaurants", name: "Restaurants", group: "Spending", amount: 0 },
    { id: "bills", name: "Bills", group: "Spending", amount: 0 },
    { id: "subscriptions", name: "Subscriptions", group: "Spending", amount: 0 },
    { id: "car-transportation", name: "Car / Transportation", group: "Spending", amount: 0 },
    { id: "personal", name: "Personal", group: "Spending", amount: 0 },
    { id: "shopping", name: "Shopping", group: "Spending", amount: 0 },
    { id: "other-uncategorized", name: "Other / Uncategorized", group: "Spending", amount: 0 },
    { id: "giving", name: "Giving", group: "Giving", amount: 0 },
    { id: "tax", name: "Tax", group: "Tax", amount: 0 },
    { id: "credit-card", name: "Credit card payment", group: "Debt", amount: 0, linked: "debt" },
    { id: "car-payment", name: "Vehicle payment", group: "Debt", amount: 0, linked: "debt" },
    { id: "saving", name: "Savings", group: "Goals", amount: 0, linked: "goals" },
    { id: "stocks", name: "Stocks & investing", group: "Investing", amount: 0, linked: "investing" },
    { id: "funded", name: "Funded-account fees", group: "Investing", amount: 0 },
  ],
  bills: [
    { id: "bill-rent", name: "Rent", categoryId: "bills", amount: 0, dueDay: 1, frequency: "Monthly", paid: false, includedInProjection: true },
    { id: "bill-electricity", name: "Electricity", categoryId: "bills", amount: 0, dueDay: 12, frequency: "Monthly", paid: false, includedInProjection: true },
    { id: "bill-insurance", name: "Car insurance", categoryId: "car-transportation", amount: 0, dueDay: 18, frequency: "Monthly", paid: false, includedInProjection: true },
  ],
  debts: [
    { id: "credit-card-debt", name: "Credit card", categoryId: "credit-card", balance: 0, apr: 0, minimum: 0, extra: 0 },
    { id: "vehicle-debt", name: "Vehicle loan", categoryId: "car-payment", balance: 0, apr: 0, minimum: 0, extra: 0 },
  ],
  goals: [
    { id: "emergency", name: "Emergency fund", current: 0, target: 0, monthly: 0, targetDate: "2027-01" },
    { id: "general", name: "Major purchase / general savings", current: 0, target: 0, monthly: 0, targetDate: "2027-06" },
  ],
  investmentMonthly: 0,
  investmentBuckets: [
    { id: "market", name: "Stocks & ETFs", percent: 50 },
    { id: "crypto", name: "Crypto", percent: 30 },
    { id: "trading", name: "Funded trading", percent: 20 },
  ],
  assets: [
    { id: "checking", name: "Checking", type: "Cash", balance: 0 },
    { id: "savings-account", name: "Savings", type: "Cash", balance: 0 },
    { id: "business", name: "Business", type: "Business", balance: 0 },
    { id: "investments", name: "Investments", type: "Investments", balance: 0 },
    { id: "property", name: "Property", type: "Property", balance: 0 },
  ],
  transactions: [],
  months: {},
  years: [2026],
  expectedDefaults: {},
  merchantRules: [],
  savingsTargets: { minimum: 0, ideal: 0 },
};

export function normalizeAllocation(item: Allocation): Allocation {
  return {
    ...item,
    actual: Object.prototype.hasOwnProperty.call(item, "actual") ? item.actual ?? null : null,
    actualMode: "manual",
  };
}

export function normalizeMonth(raw?: Partial<MonthSnapshot> | null): MonthSnapshot {
  const savedAllocations = raw?.allocations || [];
  const isCurrentModel = raw?.dataVersion === DATA_VERSION;
  const seedIds = new Set(initialPlan.allocations.map((item) => item.id));
  const transactions = (raw?.transactions || []).map((transaction) => ({
    ...transaction,
    categoryId: canonicalSpendingCategory(transaction.categoryId),
    account: transaction.account || transaction.owner || "Household",
    source: transaction.source || "manual" as const,
    reviewNeeded: transaction.reviewNeeded ?? canonicalSpendingCategory(transaction.categoryId) === "other-uncategorized",
    fingerprint: transaction.fingerprint || transactionFingerprint(
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.account || transaction.owner || "Household",
    ),
  }));
  const bills = (raw?.bills || structuredClone(initialPlan.bills)).map((bill) => {
    const legacyAllocation = savedAllocations.find((item) => item.id === bill.categoryId);
    const inferredPaid = !isCurrentModel && legacyAllocation?.actualMode === "auto" && (legacyAllocation.actual ?? 0) > 0;
    const paid = bill.paid ?? inferredPaid;
    return {
      ...bill,
      categoryId: canonicalSpendingCategory(bill.categoryId),
      paid,
      paidAmount: paid ? bill.paidAmount ?? bill.amount : bill.paidAmount,
      includedInProjection: bill.includedInProjection ?? true,
    };
  });
  const transactionTotals = transactions.reduce<Record<string, number>>((totals, transaction) => {
    totals[transaction.categoryId] = (totals[transaction.categoryId] || 0) + transaction.amount;
    return totals;
  }, {});
  const paidBillTotals = bills.filter((bill) => bill.paid).reduce<Record<string, number>>((totals, bill) => {
    totals[bill.categoryId] = (totals[bill.categoryId] || 0) + (bill.paidAmount ?? bill.amount);
    return totals;
  }, {});
  const seeded = initialPlan.allocations.map((seed) => {
    const sources = savedAllocations.filter((item) => (legacyAllocationMap[item.id] || item.id) === seed.id);
    if (sources.length === 0) return normalizeAllocation(seed);
    if (isCurrentModel) {
      const saved = sources.find((item) => item.id === seed.id) || sources[0];
      return normalizeAllocation({ ...seed, ...saved, group: seed.group, linked: seed.linked });
    }
    const amount = sources.reduce((sum, item) => sum + (item.amount || 0), 0);
    const legacyActual = sources.reduce((sum, item) => sum + (item.actual ?? 0), 0);
    const isSpending = spendingCategoryIds.has(seed.id);
    const actual = isSpending
      ? Math.max(0, legacyActual - (transactionTotals[seed.id] || 0) - (paidBillTotals[seed.id] || 0))
      : legacyActual || null;
    return normalizeAllocation({ ...seed, amount, actual, group: seed.group, linked: seed.linked });
  });
  const custom = savedAllocations
    .filter((item) => !seedIds.has(item.id) && !legacyAllocationMap[item.id])
    .map((item) => normalizeAllocation(item));
  return {
    dataVersion: DATA_VERSION,
    incomes: raw?.incomes?.length
      ? raw.incomes.map((item) => ({ expectedRemaining: 0, ...item }))
      : structuredClone(initialPlan.incomes),
    allocations: [...seeded, ...custom],
    bills,
    debts: raw?.debts || structuredClone(initialPlan.debts),
    goals: raw?.goals || structuredClone(initialPlan.goals),
    investmentMonthly: raw?.investmentMonthly || 0,
    investmentBuckets: raw?.investmentBuckets || structuredClone(initialPlan.investmentBuckets),
    assets: raw?.assets || structuredClone(initialPlan.assets),
    transactions,
  };
}

export function normalizePlan(raw?: Partial<Plan> | null): Plan {
  const month = raw?.month || initialPlan.month;
  const current = normalizeMonth(raw);
  const months = Object.fromEntries(
    Object.entries(raw?.months || {}).map(([key, value]) => [key, normalizeMonth(value)]),
  );
  const years = [...new Set([
    ...(raw?.years || []),
    Number(month.slice(0, 4)),
    ...Object.keys(months).map((key) => Number(key.slice(0, 4))),
  ])].filter(Number.isFinite).sort((a, b) => a - b);
  const expectedDefaults = {
    ...Object.fromEntries(current.allocations.map((item) => [item.id, item.amount])),
    ...(raw?.expectedDefaults || {}),
  };
  return {
    month,
    ...current,
    months,
    years,
    expectedDefaults,
    merchantRules: raw?.merchantRules || [],
    savingsTargets: {
      minimum: raw?.savingsTargets?.minimum ?? initialPlan.savingsTargets.minimum,
      ideal: raw?.savingsTargets?.ideal ?? initialPlan.savingsTargets.ideal,
    },
  };
}

export function monthSnapshot(plan: MonthSnapshot): MonthSnapshot { return normalizeMonth(plan); }

export function setExpectedOnSnapshot(raw: MonthSnapshot, id: string, amount: number): MonthSnapshot {
  const snapshot = monthSnapshot(raw);
  const target = snapshot.allocations.find((item) => item.id === id);
  if (!target) return snapshot;
  return {
    ...snapshot,
    allocations: snapshot.allocations.map((item) => item.id === id ? { ...item, amount } : item),
  };
}

export function nextMonthSnapshot(plan: MonthSnapshot, expectedDefaults: Record<string, number>): MonthSnapshot {
  let next = monthSnapshot(plan);
  for (const [id, amount] of Object.entries(expectedDefaults)) next = setExpectedOnSnapshot(next, id, amount);
  return {
    ...next,
    incomes: next.incomes.map((item) => ({ ...item, amount: 0, expectedRemaining: item.amount + (item.expectedRemaining || 0) })),
    allocations: next.allocations.map((item) => ({ ...item, actual: null, actualMode: "manual" })),
    bills: next.bills.map((bill) => ({ ...bill, paid: false, paidAmount: undefined, matchedTransactionId: undefined })),
    transactions: [],
  };
}

export function billIsVisible(bill: Bill, monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return bill.frequency === "Monthly" || bill.dueMonth === month;
}

export function reconcileBillTransactions(snapshot: MonthSnapshot, monthKey: string): MonthSnapshot {
  let transactions = snapshot.transactions.map((transaction) => ({ ...transaction }));
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  let bills = snapshot.bills.map((bill) => bill.matchedTransactionId && !transactionIds.has(bill.matchedTransactionId)
    ? { ...bill, paid: false, paidAmount: undefined, matchedTransactionId: undefined }
    : { ...bill });
  const linkedIds = new Set(bills.map((bill) => bill.matchedTransactionId).filter(Boolean));
  transactions = transactions.map((transaction) => transaction.billId && !bills.some((bill) => bill.id === transaction.billId)
    ? { ...transaction, billId: undefined }
    : transaction);

  bills = bills.map((bill) => {
    if (!billIsVisible(bill, monthKey) || bill.matchedTransactionId) return bill;
    const billName = normalizeMerchant(bill.name);
    const candidates = transactions.filter((transaction) => {
      if (transaction.billId || linkedIds.has(transaction.id) || transaction.date.slice(0, 7) !== monthKey) return false;
      if (canonicalSpendingCategory(transaction.categoryId) !== canonicalSpendingCategory(bill.categoryId)) return false;
      if (Math.abs(transaction.amount - bill.amount) > 0.01) return false;
      const day = Number(transaction.date.slice(8, 10));
      const nameMatch = normalizeMerchant(transaction.description).includes(billName) || billName.includes(normalizeMerchant(transaction.description));
      return nameMatch || Math.abs(day - bill.dueDay) <= 5;
    });
    if (candidates.length !== 1) return bill;
    const match = candidates[0];
    linkedIds.add(match.id);
    transactions = transactions.map((transaction) => transaction.id === match.id ? { ...transaction, billId: bill.id } : transaction);
    return { ...bill, paid: true, paidAmount: match.amount, matchedTransactionId: match.id };
  });
  return { ...snapshot, bills, transactions };
}

export function allocationSpendingCategory(item: Allocation) {
  if (spendingCategoryIds.has(item.id)) return item.id;
  if (legacyAllocationMap[item.id]) return legacyAllocationMap[item.id];
  if (item.linked === "debt") return item.id === "car-payment" ? "car-transportation" : "bills";
  if (item.id === "funded") return "other-uncategorized";
  return null;
}

export function summarizeMonth(plan: MonthSnapshot, monthKey: string) {
  const incomeReceived = plan.incomes.reduce((sum, item) => sum + item.amount, 0);
  const expectedIncome = plan.incomes.reduce((sum, item) => sum + (item.expectedRemaining || 0), 0);
  const income = incomeReceived + expectedIncome;
  const allocated = plan.allocations.reduce((sum, item) => sum + item.amount, 0);
  const groups = plan.allocations.reduce<Record<string, number>>((all, item) => {
    all[item.group] = (all[item.group] || 0) + item.amount;
    return all;
  }, {});
  const categoryActuals = Object.fromEntries(spendingCategories.map((category) => [category.id, 0])) as Record<string, number>;
  const categoryTargets = Object.fromEntries(spendingCategories.map((category) => [category.id, 0])) as Record<string, number>;
  plan.allocations.forEach((item) => {
    const categoryId = allocationSpendingCategory(item);
    if (!categoryId) return;
    categoryTargets[categoryId] = (categoryTargets[categoryId] || 0) + item.amount;
    categoryActuals[categoryId] = (categoryActuals[categoryId] || 0) + (item.actual ?? 0);
  });
  plan.transactions.forEach((transaction) => {
    const categoryId = canonicalSpendingCategory(transaction.categoryId);
    categoryActuals[categoryId] = (categoryActuals[categoryId] || 0) + transaction.amount;
  });
  const visibleBills = plan.bills.filter((bill) => billIsVisible(bill, monthKey));
  visibleBills.filter((bill) => bill.paid && !bill.matchedTransactionId).forEach((bill) => {
    const categoryId = canonicalSpendingCategory(bill.categoryId);
    categoryActuals[categoryId] = (categoryActuals[categoryId] || 0) + (bill.paidAmount ?? bill.amount);
  });
  const spent = Object.values(categoryActuals).reduce((sum, amount) => sum + amount, 0);
  const remainingBills = visibleBills
    .filter((bill) => !bill.paid && bill.includedInProjection !== false)
    .reduce((sum, bill) => sum + bill.amount, 0);
  const debt = plan.debts.reduce((sum, item) => sum + item.balance, 0);
  const assets = plan.assets.reduce((sum, item) => sum + item.balance, 0);
  return {
    incomeReceived,
    expectedIncome,
    income,
    allocated,
    available: income - allocated,
    projectedBalance: income - spent - remainingBills,
    remainingBills,
    categoryActuals,
    categoryTargets,
    groups,
    spent,
    reviewNeeded: plan.transactions.filter((transaction) => transaction.reviewNeeded).length,
    debt,
    assets,
    netWorth: assets - debt,
  };
}
export function freshPlan(): Plan { return normalizePlan(structuredClone(initialPlan)); }


export function setBillPayment(snapshot: MonthSnapshot, id: string, paid: boolean): MonthSnapshot {
  const bill = snapshot.bills.find((item) => item.id === id);
  if (!bill || bill.matchedTransactionId) return snapshot;
  return {
    ...snapshot,
    bills: snapshot.bills.map((item) => item.id === id
      ? { ...item, paid, paidAmount: paid ? item.amount : undefined }
      : item),
  };
}

export function patchBillInMonth(snapshot: MonthSnapshot, id: string, patch: Partial<Bill>): MonthSnapshot {
  return {
    ...snapshot,
    bills: snapshot.bills.map((bill) => {
      if (bill.id !== id) return bill;
      return { ...bill, ...patch, ...(patch.amount !== undefined && (patch.paid ?? bill.paid) && !bill.matchedTransactionId ? { paidAmount: patch.amount } : {}) };
    }),
  };
}
