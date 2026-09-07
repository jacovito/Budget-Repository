"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { backupNeedsPassword, createBackup, readBackup } from "./backup";
import { deleteProfile, listProfiles, loadPlan, putProfile, requestPersistentStorage, savePlan, type LocalProfile } from "./local-store";
import { evaluateMoneyExpression } from "./math-expression";
import {
  categorizeMerchant,
  defaultMerchantRules,
  normalizeMerchant,
  parseStatementCsv,
  suggestedMerchantPattern,
  transactionFingerprint,
  type ImportAmountMode,
  type MerchantRule,
  type StatementTransaction,
} from "./statement-import";

type Income = { id: string; name: string; owner: string; amount: number; expectedRemaining?: number };
type Allocation = {
  id: string;
  name: string;
  group: string;
  amount: number;
  actual?: number | null;
  actualMode?: "auto" | "manual";
  linked?: "calendar" | "debt" | "goals" | "investing";
};
type Bill = {
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
type Debt = { id: string; name: string; categoryId: string; balance: number; apr: number; minimum: number; extra: number };
type Goal = { id: string; name: string; current: number; target: number; monthly: number; targetDate: string };
type InvestmentBucket = { id: string; name: string; percent: number };
type Asset = { id: string; name: string; type: string; balance: number };
type Transaction = {
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
type ImportPreviewTransaction = StatementTransaction & {
  id: string;
  categoryId: string;
  reviewNeeded: boolean;
  duplicate: boolean;
};

type MonthSnapshot = {
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

type Plan = MonthSnapshot & {
  month: string;
  months: Record<string, MonthSnapshot>;
  years: number[];
  expectedDefaults: Record<string, number>;
  merchantRules: MerchantRule[];
  savingsTargets: { minimum: number; ideal: number };
};

const LEGACY_STORAGE_KEY = "paycheck-plan-v1";
const ACTIVE_PROFILE_KEY = "paycheck-active-profile-v1";
const DATA_VERSION = 3;

const spendingCategories = [
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

const spendingCategoryIds = new Set<string>(spendingCategories.map((category) => category.id));
const legacyAllocationMap: Record<string, string> = {
  tithe: "giving",
  rent: "bills",
  fpl: "bills",
  "car-insurance": "car-transportation",
  fun: "personal",
  health: "personal",
  misc: "other-uncategorized",
  unexpected: "other-uncategorized",
};

function canonicalSpendingCategory(id: string) {
  if (spendingCategoryIds.has(id)) return id;
  if (legacyAllocationMap[id]) return legacyAllocationMap[id];
  if (id === "car-payment") return "car-transportation";
  if (id === "credit-card" || id.startsWith("debt-")) return "bills";
  return "other-uncategorized";
}

const initialPlan: Plan = {
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

function normalizeAllocation(item: Allocation): Allocation {
  return {
    ...item,
    actual: Object.prototype.hasOwnProperty.call(item, "actual") ? item.actual ?? null : null,
    actualMode: "manual",
  };
}

function normalizeMonth(raw?: Partial<MonthSnapshot> | null): MonthSnapshot {
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

function normalizePlan(raw?: Partial<Plan> | null): Plan {
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

function monthSnapshot(plan: MonthSnapshot): MonthSnapshot { return normalizeMonth(plan); }

function setExpectedOnSnapshot(raw: MonthSnapshot, id: string, amount: number): MonthSnapshot {
  const snapshot = monthSnapshot(raw);
  const target = snapshot.allocations.find((item) => item.id === id);
  if (!target) return snapshot;
  return {
    ...snapshot,
    allocations: snapshot.allocations.map((item) => item.id === id ? { ...item, amount } : item),
  };
}

function nextMonthSnapshot(plan: MonthSnapshot, expectedDefaults: Record<string, number>): MonthSnapshot {
  let next = monthSnapshot(plan);
  for (const [id, amount] of Object.entries(expectedDefaults)) next = setExpectedOnSnapshot(next, id, amount);
  return {
    ...next,
    incomes: next.incomes.map((item) => ({ ...item, amount: 0, expectedRemaining: item.amount + (item.expectedRemaining || 0) })),
    allocations: next.allocations.map((item) => ({ ...item, actual: null, actualMode: "manual" })),
    bills: next.bills.map((bill) => ({ ...bill, paid: false, paidAmount: undefined })),
    transactions: [],
  };
}

function billIsVisible(bill: Bill, monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return bill.frequency === "Monthly" || bill.dueMonth === month;
}

function reconcileBillTransactions(snapshot: MonthSnapshot, monthKey: string): MonthSnapshot {
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

function allocationSpendingCategory(item: Allocation) {
  if (spendingCategoryIds.has(item.id)) return item.id;
  if (legacyAllocationMap[item.id]) return legacyAllocationMap[item.id];
  if (item.linked === "debt") return item.id === "car-payment" ? "car-transportation" : "bills";
  if (item.id === "funded") return "other-uncategorized";
  return null;
}

function summarizeMonth(plan: MonthSnapshot, monthKey: string) {
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
function freshPlan(): Plan { return normalizePlan(structuredClone(initialPlan)); }

const navItems = [
  ["dashboard", "⌂", "Dashboard"],
  ["budget", "▦", "Monthly plan"],
  ["calendar", "□", "Bills & calendar"],
  ["debt", "↘", "Debt planner"],
  ["goals", "◎", "Savings goals"],
  ["investing", "↗", "Investing"],
  ["activity", "≡", "Transactions"],
  ["worth", "◇", "Net worth"],
  ["learn", "i", "Saving & help"],
] as const;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function CurrencyInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value ? String(value) : "");
  }, [value]);

  function commit(nextDraft: string) {
    const parsed = evaluateMoneyExpression(nextDraft);
    if (parsed === null) {
      setDraft(value ? String(value) : "");
      return;
    }
    setDraft(parsed ? String(parsed) : "");
    onChange(parsed);
  }

  return (
    <label className={disabled ? "money-input disabled" : "money-input"} title="You can enter a number or calculation, such as =1200+350">
      <span>$</span>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        type="text"
        disabled={disabled}
        value={draft}
        placeholder="0 or =100+25"
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(draft); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          if (!nextDraft.trim()) onChange(0);
          else {
            const parsed = evaluateMoneyExpression(nextDraft);
            if (parsed !== null) onChange(parsed);
          }
        }}
      />
      <small aria-hidden="true">fx</small>
    </label>
  );
}

function ActualCurrencyInput({ value, onChange, ariaLabel }: { value: number | null | undefined; onChange: (next: number | null) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  function commit(nextDraft: string) {
    if (!nextDraft.trim()) {
      setDraft("");
      onChange(null);
      return;
    }
    const parsed = evaluateMoneyExpression(nextDraft);
    if (parsed === null) {
      setDraft(value === null || value === undefined ? "" : String(value));
      return;
    }
    setDraft(String(parsed));
    onChange(parsed);
  }

  return (
    <label className="money-input actual-input" title="Enter the total actually spent, or a calculation such as =100+25">
      <span>$</span>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        type="text"
        value={draft}
        placeholder="Actual"
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(draft); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          if (!nextDraft.trim()) onChange(null);
          else {
            const parsed = evaluateMoneyExpression(nextDraft);
            if (parsed !== null) onChange(parsed);
          }
        }}
      />
      <small aria-hidden="true">fx</small>
    </label>
  );
}

function NumberInput({ value, onChange, ariaLabel, suffix }: { value: number; onChange: (next: number) => void; ariaLabel: string; suffix?: string }) {
  return (
    <label className="number-input">
      <input aria-label={ariaLabel} inputMode="decimal" min="0" type="number" value={value || ""} placeholder="0" onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

function MonthNavigator({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  function shift(delta: number) {
    const [year, month] = value.split("-").map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    onChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="month-navigator">
      <button aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
      <label className="month-picker"><span>Month</span><input type="month" value={value} onChange={(event) => onChange(event.target.value)} /></label>
      <button aria-label="Next month" onClick={() => shift(1)}>›</button>
    </div>
  );
}

function payoffMonths(debt: Debt) {
  if (debt.balance <= 0) return 0;
  const payment = debt.minimum + debt.extra;
  const monthlyRate = debt.apr / 1200;
  if (payment <= debt.balance * monthlyRate) return Infinity;
  if (monthlyRate === 0) return payment ? Math.ceil(debt.balance / payment) : Infinity;
  return Math.ceil(-Math.log(1 - (monthlyRate * debt.balance) / payment) / Math.log(1 + monthlyRate));
}

export default function Home() {
  const [active, setActive] = useState("dashboard");
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [dashboardView, setDashboardView] = useState<"monthly" | "yearly">("monthly");
  const [dashboardYear, setDashboardYear] = useState(Number(initialPlan.month.slice(0, 4)));
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expectedScope, setExpectedScope] = useState<"month" | "future">("month");
  const [newProfileName, setNewProfileName] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statementInputRef = useRef<HTMLInputElement>(null);
  const planRef = useRef(plan);
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("all");
  const [transactionDraft, setTransactionDraft] = useState({
    date: "2026-08-01",
    description: "",
    categoryId: "other-uncategorized",
    account: "Household",
    amount: 0,
  });
  const [statementText, setStatementText] = useState("");
  const [statementName, setStatementName] = useState("");
  const [importMode, setImportMode] = useState<ImportAmountMode>("auto");
  const [importAccount, setImportAccount] = useState("Checking");
  const [importPreview, setImportPreview] = useState<ImportPreviewTransaction[]>([]);
  const [importError, setImportError] = useState("");
  const [billDraft, setBillDraft] = useState({
    name: "",
    categoryId: "subscriptions",
    amount: 0,
    dueDay: 1,
    frequency: "Monthly" as Bill["frequency"],
  });
  const [debtDraft, setDebtDraft] = useState({ name: "", balance: 0, apr: 0, minimum: 0, extra: 0 });

  useEffect(() => {
    let cancelled = false;
    const loadSavedPlan = window.setTimeout(() => {
      void (async () => {
        try {
          let savedProfiles = await listProfiles();
          if (savedProfiles.length === 0) {
            const now = new Date().toISOString();
            const firstProfile: LocalProfile = { id: crypto.randomUUID(), name: "My household", createdAt: now, updatedAt: now };
            let migratedPlan = freshPlan();
            const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
            if (legacy) migratedPlan = normalizePlan(JSON.parse(legacy) as Partial<Plan>);
            await putProfile(firstProfile);
            await savePlan(firstProfile.id, migratedPlan);
            if (legacy) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
            savedProfiles = [firstProfile];
          }
          const preferredId = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
          const selected = savedProfiles.find((profile) => profile.id === preferredId) ?? savedProfiles[0];
          const nextPlan = normalizePlan(await loadPlan<Plan>(selected.id));
          if (cancelled) return;
          planRef.current = nextPlan;
          setProfiles(savedProfiles);
          setActiveProfileId(selected.id);
          setPlan(nextPlan);
          setDashboardYear(Number(nextPlan.month.slice(0, 4)));
          setTransactionDraft((current) => ({ ...current, date: `${nextPlan.month}-01` }));
          window.localStorage.setItem(ACTIVE_PROFILE_KEY, selected.id);
          // Persistence is a best-effort browser hint; IndexedDB saving still works without it.
          await requestPersistentStorage().catch(() => undefined);
        } catch {
          if (cancelled) return;
          setStorageAvailable(false);
          setNotice("Browser storage is unavailable. You can explore the planner, but changes may not survive a refresh.");
        } finally { if (!cancelled) setReady(true); }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(loadSavedPlan); };
  }, []);

  useEffect(() => {
    planRef.current = plan;
    if (!ready || !activeProfileId || !storageAvailable) return;
    const saveTimer = window.setTimeout(() => {
      void savePlan(activeProfileId, plan).catch(() => {
        setStorageAvailable(false);
        setNotice("This change could not be saved. Export a backup before closing the planner.");
      });
    }, 300);
    return () => window.clearTimeout(saveTimer);
  }, [activeProfileId, plan, ready, storageAvailable]);

  useEffect(() => {
    if (!notice) return;
    const noticeTimer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(noticeTimer);
  }, [notice]);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  const totals = useMemo(() => summarizeMonth(plan, plan.month), [plan]);
  const savedMonths = useMemo(
    () => ({ ...plan.months, [plan.month]: monthSnapshot(plan) }),
    [plan],
  );

  const yearlyMonths = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const key = `${dashboardYear}-${String(index + 1).padStart(2, "0")}`;
    const snapshot = savedMonths[key];
    return {
      key,
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(dashboardYear, index, 1)),
      totals: snapshot ? summarizeMonth(snapshot, key) : summarizeMonth(normalizeMonth(), key),
      hasData: Boolean(snapshot),
    };
  }), [dashboardYear, savedMonths]);

  const yearlyTotals = useMemo(() => {
    const activeMonths = yearlyMonths.filter((item) => item.hasData);
    const categoryActuals = Object.fromEntries(spendingCategories.map((category) => [
      category.id,
      activeMonths.reduce((sum, item) => sum + (item.totals.categoryActuals[category.id] || 0), 0),
    ]));
    const categoryTargets = Object.fromEntries(spendingCategories.map((category) => [
      category.id,
      activeMonths.reduce((sum, item) => sum + (item.totals.categoryTargets[category.id] || 0), 0),
    ]));
    const incomeReceived = activeMonths.reduce((sum, item) => sum + item.totals.incomeReceived, 0);
    const expectedIncome = activeMonths.reduce((sum, item) => sum + item.totals.expectedIncome, 0);
    const income = activeMonths.reduce((sum, item) => sum + item.totals.income, 0);
    const allocated = activeMonths.reduce((sum, item) => sum + item.totals.allocated, 0);
    const spent = activeMonths.reduce((sum, item) => sum + item.totals.spent, 0);
    const remainingBills = activeMonths.reduce((sum, item) => sum + item.totals.remainingBills, 0);
    const latest = [...activeMonths].reverse().find((item) => item.hasData)?.totals;
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
      spent,
      reviewNeeded: activeMonths.reduce((sum, item) => sum + item.totals.reviewNeeded, 0),
      debt: latest?.debt || 0,
      assets: latest?.assets || 0,
      netWorth: latest?.netWorth || 0,
      monthsWithData: activeMonths.length,
    };
  }, [yearlyMonths]);

  const dashboardTotals = dashboardView === "monthly" ? totals : yearlyTotals;

  const monthLabel = useMemo(() => {
    const [year, month] = plan.month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(year, month - 1, 1),
    );
  }, [plan.month]);

  const [selectedYear, selectedMonth] = plan.month.split("-").map(Number);
  const calendarDays = useMemo(() => {
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay();
    const count = new Date(selectedYear, selectedMonth, 0).getDate();
    return [...Array(firstDay).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [selectedMonth, selectedYear]);
  const monthlyBillTotal = plan.bills.reduce((sum, bill) => sum + (bill.frequency === "Annual" ? bill.amount / 12 : bill.amount), 0);
  const visibleBills = plan.bills.filter((bill) => billIsVisible(bill, plan.month));
  const debtMonthly = plan.debts.reduce((sum, debt) => sum + debt.minimum + debt.extra, 0);
  const bucketPercent = plan.investmentBuckets.reduce((sum, bucket) => sum + bucket.percent, 0);

  const dashboardPeriodLabel = dashboardView === "monthly" ? monthLabel : `${dashboardYear} YEAR`;
  const dashboardCategories = spendingCategories.map((category) => ({
    ...category,
    spent: dashboardTotals.categoryActuals[category.id] || 0,
    target: dashboardTotals.categoryTargets[category.id] || 0,
  }));
  const targetMonths = dashboardView === "monthly" ? 1 : yearlyTotals.monthsWithData;
  const minimumSavingsTarget = plan.savingsTargets.minimum * targetMonths;
  const idealSavingsTarget = Math.max(plan.savingsTargets.minimum, plan.savingsTargets.ideal) * targetMonths;
  const savingsTargetsConfigured = plan.savingsTargets.minimum > 0 || plan.savingsTargets.ideal > 0;
  const projectedForSavings = Math.max(0, dashboardTotals.projectedBalance);
  const savingsProgress = idealSavingsTarget ? Math.min(100, projectedForSavings / idealSavingsTarget * 100) : 0;
  const reviewTransactions = plan.transactions.filter((transaction) => transaction.reviewNeeded);
  const filteredTransactions = transactionCategoryFilter === "all"
    ? plan.transactions
    : plan.transactions.filter((transaction) => canonicalSpendingCategory(transaction.categoryId) === transactionCategoryFilter);

  function changeMonth(nextMonth: string) {
    if (!nextMonth || nextMonth === plan.month) return;
    setPlan((current) => {
      const months = { ...current.months, [current.month]: monthSnapshot(current) };
      const next = months[nextMonth] ? monthSnapshot(months[nextMonth]) : nextMonthSnapshot(current, current.expectedDefaults);
      const year = Number(nextMonth.slice(0, 4));
      return {
        ...current,
        ...next,
        month: nextMonth,
        months,
        years: [...new Set([...current.years, year])].sort((a, b) => a - b),
      };
    });
    const year = Number(nextMonth.slice(0, 4));
    setDashboardYear(year);
    setTransactionDraft((current) => ({ ...current, date: `${nextMonth}-01` }));
  }

  function addNextYear() {
    const nextYear = Math.max(...plan.years, Number(plan.month.slice(0, 4))) + 1;
    setPlan((current) => ({ ...current, years: [...new Set([...current.years, nextYear])].sort((a, b) => a - b) }));
    setDashboardYear(nextYear);
    setDashboardView("yearly");
    setNotice(`${nextYear} was added. Open any month in that year when you are ready to plan it.`);
  }

  function updateIncome(id: string, amount: number) {
    setPlan((current) => ({
      ...current,
      incomes: current.incomes.map((item) => (item.id === id ? { ...item, amount } : item)),
    }));
  }

  function updateExpectedIncome(id: string, expectedRemaining: number) {
    setPlan((current) => ({
      ...current,
      incomes: current.incomes.map((item) => (item.id === id ? { ...item, expectedRemaining } : item)),
    }));
  }

  function updateExpected(id: string, amount: number) {
    setPlan((current) => {
      const updated = setExpectedOnSnapshot(current, id, amount);
      const months = expectedScope === "future"
        ? Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [
          key,
          key >= current.month ? setExpectedOnSnapshot(snapshot, id, amount) : snapshot,
        ]))
        : current.months;
      return {
        ...current,
        ...updated,
        months,
        expectedDefaults: expectedScope === "future" ? { ...current.expectedDefaults, [id]: amount } : current.expectedDefaults,
      };
    });
  }

  function updateActual(id: string, actual: number | null) {
    setPlan((current) => ({
      ...current,
      allocations: current.allocations.map((item) => item.id === id ? { ...item, actual, actualMode: "manual" } : item),
    }));
  }

  function updateBill(id: string, patch: Partial<Bill>) {
    setPlan((current) => {
      const applyToSnapshot = (raw: MonthSnapshot): MonthSnapshot => {
        const snapshot = monthSnapshot(raw);
        return { ...snapshot, bills: snapshot.bills.map((bill) => {
          if (bill.id !== id) return bill;
          const next = { ...bill, ...patch };
          if (patch.amount !== undefined && bill.paid && (bill.paidAmount === undefined || bill.paidAmount === bill.amount)) next.paidAmount = patch.amount;
          return next;
        }) };
      };
      const updated = applyToSnapshot(current);
      return {
        ...current,
        ...updated,
        months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, key >= current.month ? applyToSnapshot(snapshot) : snapshot])),
      };
    });
  }

  function updateBillForThisMonth(id: string, patch: Partial<Bill>) {
    setPlan((current) => ({
      ...current,
      bills: current.bills.map((bill) => bill.id === id ? { ...bill, ...patch } : bill),
    }));
  }

  function toggleBillPaid(id: string) {
    const bill = plan.bills.find((item) => item.id === id);
    if (!bill) return;
    setPlan((current) => ({
      ...current,
      bills: current.bills.map((item) => item.id === id
        ? item.paid
          ? { ...item, paid: false, paidAmount: undefined, matchedTransactionId: undefined }
          : { ...item, paid: true, paidAmount: item.amount }
        : item),
      transactions: current.transactions.map((transaction) => transaction.billId === id ? { ...transaction, billId: undefined } : transaction),
    }));
  }

  function toggleBillProjection(id: string) {
    const bill = plan.bills.find((item) => item.id === id);
    if (!bill) return;
    updateBillForThisMonth(id, { includedInProjection: bill.includedInProjection === false });
  }

  function addBill() {
    if (!billDraft.name.trim() || billDraft.amount <= 0) {
      setNotice("Add a name and amount for the recurring expense.");
      return;
    }
    const bill: Bill = {
      id: `bill-${crypto.randomUUID()}`,
      name: billDraft.name.trim(),
      categoryId: billDraft.categoryId,
      amount: billDraft.amount,
      dueDay: billDraft.dueDay,
      frequency: billDraft.frequency,
      paid: false,
      includedInProjection: true,
      ...(billDraft.frequency === "Annual" ? { dueMonth: selectedMonth } : {}),
    };
    setPlan((current) => {
      const addToSnapshot = (raw: MonthSnapshot): MonthSnapshot => {
        const snapshot = monthSnapshot(raw);
        if (snapshot.bills.some((item) => item.id === bill.id)) return snapshot;
        return { ...snapshot, bills: [...snapshot.bills, bill] };
      };
      const updated = addToSnapshot(current);
      return {
        ...current,
        ...updated,
        months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, key >= current.month ? addToSnapshot(snapshot) : snapshot])),
      };
    });
    setBillDraft({ name: "", categoryId: "subscriptions", amount: 0, dueDay: 1, frequency: "Monthly" });
    setNotice(`${bill.name} was added to ${monthLabel}.`);
  }

  function deleteBill(id: string) {
    setPlan((current) => {
      const removed = current.bills.find((bill) => bill.id === id);
      if (!removed) return current;
      const removeFromSnapshot = (raw: MonthSnapshot): MonthSnapshot => {
        const snapshot = monthSnapshot(raw);
        return { ...snapshot, bills: snapshot.bills.filter((bill) => bill.id !== id) };
      };
      const updated = removeFromSnapshot(current);
      return {
        ...current,
        ...updated,
        months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, key >= current.month ? removeFromSnapshot(snapshot) : snapshot])),
      };
    });
  }

  function updateDebt(id: string, patch: Partial<Debt>) {
    setPlan((current) => {
      const debts = current.debts.map((debt) => (debt.id === id ? { ...debt, ...patch } : debt));
      const allocations = current.allocations.map((item) => {
        const linkedDebt = debts.find((debt) => debt.categoryId === item.id);
        if (!linkedDebt) return item;
        const amount = linkedDebt.minimum + linkedDebt.extra;
        return { ...item, amount };
      });
      return {
        ...current,
        debts,
        allocations,
        expectedDefaults: { ...current.expectedDefaults, ...Object.fromEntries(allocations.filter((item) => item.linked === "debt").map((item) => [item.id, item.amount])) },
      };
    });
  }

  function addDebt() {
    if (!debtDraft.name.trim()) { setNotice("Add a name for the liability."); return; }
    const id = `liability-${crypto.randomUUID()}`;
    const categoryId = `debt-${crypto.randomUUID()}`;
    const debt: Debt = { id, categoryId, name: debtDraft.name.trim(), balance: debtDraft.balance, apr: debtDraft.apr, minimum: debtDraft.minimum, extra: debtDraft.extra };
    const amount = debt.minimum + debt.extra;
    const allocation: Allocation = { id: categoryId, name: `${debt.name} payment`, group: "Debt", amount, actual: null, actualMode: "manual", linked: "debt" };
    const addToSnapshot = (raw: MonthSnapshot): MonthSnapshot => {
      const snapshot = monthSnapshot(raw);
      return { ...snapshot, debts: [...snapshot.debts, debt], allocations: [...snapshot.allocations, allocation] };
    };
    setPlan((current) => ({
      ...current,
      ...addToSnapshot(current),
      months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, key >= current.month ? addToSnapshot(snapshot) : snapshot])),
      expectedDefaults: { ...current.expectedDefaults, [categoryId]: amount },
    }));
    setDebtDraft({ name: "", balance: 0, apr: 0, minimum: 0, extra: 0 });
    setNotice(`${debt.name} was added to the debt plan.`);
  }

  function archiveDebt(id: string) {
    const debt = plan.debts.find((item) => item.id === id);
    if (!debt || !window.confirm(`Remove “${debt.name}” from this month and future months? Past months will keep their history.`)) return;
    const seededCategory = initialPlan.allocations.some((item) => item.id === debt.categoryId);
    const removeFromSnapshot = (raw: MonthSnapshot): MonthSnapshot => {
      const snapshot = monthSnapshot(raw);
      return {
        ...snapshot,
        debts: snapshot.debts.filter((item) => item.id !== id),
        allocations: seededCategory
          ? snapshot.allocations.map((item) => item.id === debt.categoryId ? { ...item, amount: 0, actual: null, actualMode: "manual" } : item)
          : snapshot.allocations.filter((item) => item.id !== debt.categoryId),
      };
    };
    setPlan((current) => {
      const expectedDefaults = { ...current.expectedDefaults };
      if (seededCategory) expectedDefaults[debt.categoryId] = 0;
      else delete expectedDefaults[debt.categoryId];
      return {
        ...current,
        ...removeFromSnapshot(current),
        months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, key >= current.month ? removeFromSnapshot(snapshot) : snapshot])),
        expectedDefaults,
      };
    });
    setTransactionDraft((current) => current.categoryId === debt.categoryId ? { ...current, categoryId: "other-uncategorized" } : current);
    setNotice(`${debt.name} was removed. Earlier months were preserved.`);
  }

  function updateGoal(id: string, patch: Partial<Goal>) {
    setPlan((current) => {
      const goals = current.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal));
      const monthly = goals.reduce((sum, goal) => sum + goal.monthly, 0);
      return { ...current, goals, expectedDefaults: { ...current.expectedDefaults, saving: monthly }, allocations: current.allocations.map((item) => item.id === "saving" ? { ...item, amount: monthly } : item) };
    });
  }

  function updateInvestmentMonthly(amount: number) {
    setPlan((current) => ({
      ...current,
      investmentMonthly: amount,
      expectedDefaults: { ...current.expectedDefaults, stocks: amount },
      allocations: current.allocations.map((item) => item.id === "stocks" ? { ...item, amount } : item),
    }));
  }

  function addTransaction() {
    if (!transactionDraft.description.trim() || transactionDraft.amount <= 0) return;
    const categoryId = transactionDraft.categoryId === "other-uncategorized"
      ? categorizeMerchant(transactionDraft.description, plan.merchantRules)
      : transactionDraft.categoryId;
    const account = transactionDraft.account.trim() || "Household";
    const transaction: Transaction = {
      ...transactionDraft,
      id: `transaction-${crypto.randomUUID()}`,
      categoryId,
      account,
      source: "manual",
      reviewNeeded: categoryId === "other-uncategorized",
      fingerprint: transactionFingerprint(transactionDraft.date, transactionDraft.description, transactionDraft.amount, account),
    };
    setPlan((current) => {
      const transactionMonth = transaction.date.slice(0, 7);
      if (transactionMonth === current.month) return {
        ...current,
        ...reconcileBillTransactions({ ...monthSnapshot(current), transactions: [transaction, ...current.transactions] }, current.month),
      };
      const base = current.months[transactionMonth] || {
        ...nextMonthSnapshot(current, current.expectedDefaults),
        incomes: current.incomes.map((income) => ({ ...income, amount: 0, expectedRemaining: 0 })),
      };
      return {
        ...current,
        months: { ...current.months, [transactionMonth]: reconcileBillTransactions({ ...base, transactions: [transaction, ...base.transactions] }, transactionMonth) },
        years: [...new Set([...current.years, Number(transactionMonth.slice(0, 4))])].sort((a, b) => a - b),
      };
    });
    setTransactionDraft((current) => ({ ...current, description: "", amount: 0 }));
  }

  function deleteTransaction(id: string) {
    setPlan((current) => {
      return {
        ...current,
        transactions: current.transactions.filter((item) => item.id !== id),
        bills: current.bills.map((bill) => bill.matchedTransactionId === id
          ? { ...bill, paid: false, paidAmount: undefined, matchedTransactionId: undefined }
          : bill),
      };
    });
  }

  function updateTransactionCategory(id: string, categoryId: string, remember = false, keepReview = false) {
    const transaction = plan.transactions.find((item) => item.id === id);
    if (!transaction) return;
    const pattern = suggestedMerchantPattern(transaction.description);
    const newRule: MerchantRule | null = remember && pattern
      ? { id: `rule-${crypto.randomUUID()}`, pattern, categoryId }
      : null;
    const updateSnapshot = (raw: MonthSnapshot, monthKey: string): MonthSnapshot => {
      const snapshot = monthSnapshot(raw);
      return reconcileBillTransactions({
        ...snapshot,
        transactions: snapshot.transactions.map((item) => {
          const shouldUpdate = item.id === id || (newRule && item.reviewNeeded && categorizeMerchant(item.description, [newRule]) === categoryId);
          return shouldUpdate ? { ...item, categoryId, reviewNeeded: keepReview || categoryId === "other-uncategorized" } : item;
        }),
      }, monthKey);
    };
    setPlan((current) => ({
      ...current,
      ...updateSnapshot(current, current.month),
      months: Object.fromEntries(Object.entries(current.months).map(([key, snapshot]) => [key, updateSnapshot(snapshot, key)])),
      merchantRules: newRule
        ? [...current.merchantRules.filter((rule) => rule.pattern !== newRule.pattern), newRule]
        : current.merchantRules,
    }));
    if (newRule) setNotice(`Future transactions containing “${pattern}” will use ${spendingCategories.find((item) => item.id === categoryId)?.name}.`);
  }

  function removeMerchantRule(id: string) {
    setPlan((current) => ({ ...current, merchantRules: current.merchantRules.filter((rule) => rule.id !== id) }));
  }

  function existingFingerprints() {
    const snapshots = [...Object.values(plan.months), monthSnapshot(plan)];
    return new Set(snapshots.flatMap((snapshot) => snapshot.transactions.map((transaction) => transaction.fingerprint || transactionFingerprint(
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.account || transaction.owner || "Household",
    ))));
  }

  function prepareStatement(text: string, mode: ImportAmountMode, account = importAccount) {
    try {
      const parsed = parseStatementCsv(text, mode);
      const fingerprints = existingFingerprints();
      const preview = parsed.transactions.map((transaction) => {
        const categoryId = categorizeMerchant(transaction.description, plan.merchantRules);
        const fingerprint = transactionFingerprint(transaction.date, transaction.description, transaction.amount, account);
        const duplicate = fingerprints.has(fingerprint);
        fingerprints.add(fingerprint);
        return {
          ...transaction,
          id: crypto.randomUUID(),
          categoryId,
          reviewNeeded: categoryId === "other-uncategorized",
          duplicate,
        };
      });
      setImportPreview(preview);
      setImportError("");
      if (mode === "auto") setImportMode(parsed.detectedMode);
    } catch (error) {
      setImportPreview([]);
      setImportError(error instanceof Error ? error.message : "That statement could not be read.");
    }
  }

  async function handleStatementFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Download a CSV statement from your bank or card account. PDF statements are not supported in the private local importer.");
      return;
    }
    const text = await file.text();
    setStatementText(text);
    setStatementName(file.name);
    setImportMode("auto");
    prepareStatement(text, "auto");
  }

  function importStatementTransactions() {
    const readyTransactions = importPreview.filter((item) => !item.duplicate);
    if (readyTransactions.length === 0) {
      setNotice("No new transactions were found in that statement.");
      return;
    }
    const account = importAccount.trim() || "Imported statement";
    setPlan((current) => {
      const snapshots: Record<string, MonthSnapshot> = { ...current.months, [current.month]: monthSnapshot(current) };
      readyTransactions.forEach((item) => {
        const key = item.date.slice(0, 7);
        const base = snapshots[key] || {
          ...nextMonthSnapshot(current, current.expectedDefaults),
          incomes: current.incomes.map((income) => ({ ...income, amount: 0, expectedRemaining: 0 })),
        };
        const transaction: Transaction = {
          id: `transaction-${item.id}`,
          date: item.date,
          description: item.description,
          amount: item.amount,
          categoryId: item.categoryId,
          account,
          source: "import",
          reviewNeeded: item.reviewNeeded,
          fingerprint: transactionFingerprint(item.date, item.description, item.amount, account),
        };
        snapshots[key] = { ...base, transactions: [transaction, ...base.transactions] };
      });
      [...new Set(readyTransactions.map((item) => item.date.slice(0, 7)))].forEach((key) => {
        snapshots[key] = reconcileBillTransactions(snapshots[key], key);
      });
      const activeSnapshot = snapshots[current.month];
      const years = [...new Set([...current.years, ...readyTransactions.map((item) => Number(item.date.slice(0, 4)))])].sort((a, b) => a - b);
      return { ...current, ...activeSnapshot, months: snapshots, years };
    });
    const reviewCount = readyTransactions.filter((item) => item.reviewNeeded).length;
    setImportPreview([]);
    setStatementText("");
    setStatementName("");
    setNotice(`${readyTransactions.length} transactions imported${reviewCount ? `; ${reviewCount} need a category review` : " and categorized"}.`);
  }

  async function switchProfile(profileId: string) {
    if (profileId === activeProfileId) { setSettingsOpen(false); return; }
    setReady(false);
    try {
      if (activeProfileId && storageAvailable) await savePlan(activeProfileId, planRef.current);
      const nextPlan = normalizePlan(await loadPlan<Plan>(profileId));
      planRef.current = nextPlan;
      setPlan(nextPlan);
      setDashboardYear(Number(nextPlan.month.slice(0, 4)));
      setTransactionDraft((current) => ({ ...current, date: `${nextPlan.month}-01` }));
      setActiveProfileId(profileId);
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
      setSettingsOpen(false);
    } catch { setNotice("That local workspace could not be opened."); }
    finally { setReady(true); }
  }

  async function createProfile() {
    const name = newProfileName.trim();
    if (!name) { setNotice("Give the new local workspace a name first."); return; }
    const now = new Date().toISOString();
    const profile: LocalProfile = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
    const nextPlan = freshPlan();
    setReady(false);
    try {
      if (activeProfileId && storageAvailable) await savePlan(activeProfileId, planRef.current);
      await putProfile(profile);
      await savePlan(profile.id, nextPlan);
      planRef.current = nextPlan;
      setProfiles((current) => [...current, profile]);
      setActiveProfileId(profile.id);
      setPlan(nextPlan);
      setDashboardYear(Number(nextPlan.month.slice(0, 4)));
      setTransactionDraft((current) => ({ ...current, date: `${nextPlan.month}-01` }));
      setNewProfileName("");
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
      setNotice(`${name} is ready with a separate, blank budget.`);
    } catch { setNotice("The new local workspace could not be created."); }
    finally { setReady(true); }
  }

  async function removeProfile(profileId: string) {
    if (profiles.length <= 1) { setNotice("Keep at least one local workspace. Create another before deleting this one."); return; }
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile || !window.confirm(`Delete “${profile.name}” from this browser? Export a backup first if you may need it later.`)) return;
    setReady(false);
    try {
      const remaining = profiles.filter((item) => item.id !== profileId);
      await deleteProfile(profileId);
      setProfiles(remaining);
      if (profileId === activeProfileId) {
        const replacement = remaining[0];
        const replacementPlan = normalizePlan(await loadPlan<Plan>(replacement.id));
        planRef.current = replacementPlan;
        setActiveProfileId(replacement.id);
        setPlan(replacementPlan);
        setDashboardYear(Number(replacementPlan.month.slice(0, 4)));
        setTransactionDraft((current) => ({ ...current, date: `${replacementPlan.month}-01` }));
        window.localStorage.setItem(ACTIVE_PROFILE_KEY, replacement.id);
      }
      setNotice(`${profile.name} was removed from this browser.`);
    } catch { setNotice("That local workspace could not be deleted."); }
    finally { setReady(true); }
  }

  function downloadBackup(text: string, profileName: string) {
    const blob = new Blob([text], { type: "application/vnd.paycheck+json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeName = profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "budget";
    anchor.download = `${safeName}-${plan.month}.paycheck`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportBackup(encrypted: boolean) {
    if (encrypted && backupPassword.length < 8) { setNotice("Use at least 8 characters for an encrypted backup password."); return; }
    try {
      const profileName = activeProfile?.name ?? "My budget";
      downloadBackup(await createBackup({ profileName, plan }, encrypted ? backupPassword : ""), profileName);
      const backedUpAt = new Date().toISOString();
      if (activeProfile) {
        const updated = { ...activeProfile, lastBackupAt: backedUpAt, updatedAt: backedUpAt };
        await putProfile(updated);
        setProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
      }
      setNotice(encrypted ? "Encrypted backup downloaded. Keep its password somewhere safe." : "Backup downloaded. Store it somewhere you control.");
    } catch { setNotice("The backup could not be created on this browser."); }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      if (backupNeedsPassword(text) && !backupPassword) { setNotice("This backup is encrypted. Enter its password, then choose the file again."); return; }
      const restored = await readBackup<Partial<Plan>>(text, backupPassword);
      const baseName = `${restored.profileName} (restored)`;
      let name = baseName;
      let copy = 2;
      while (profiles.some((profile) => profile.name === name)) name = `${baseName} ${copy++}`;
      const now = new Date().toISOString();
      const profile: LocalProfile = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
      const restoredPlan = normalizePlan(restored.plan);
      setReady(false);
      if (activeProfileId && storageAvailable) await savePlan(activeProfileId, planRef.current);
      await putProfile(profile);
      await savePlan(profile.id, restoredPlan);
      planRef.current = restoredPlan;
      setProfiles((current) => [...current, profile]);
      setActiveProfileId(profile.id);
      setPlan(restoredPlan);
      setDashboardYear(Number(restoredPlan.month.slice(0, 4)));
      setTransactionDraft((current) => ({ ...current, date: `${restoredPlan.month}-01` }));
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
      setSettingsOpen(false);
      setNotice(`${name} was restored as a new, separate workspace.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "That backup could not be restored."); }
    finally { setReady(true); }
  }

  return (
    <>
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("dashboard")}>
          <span className="brand-mark">P</span>
          <span>
            <strong>Paycheck</strong>
            <small>Household planner</small>
          </span>
        </button>

        <nav aria-label="Primary navigation">
          <p className="nav-label">PLAN</p>
          {navItems.slice(0, 6).map(([id, icon, label]) => (
            <button
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              onClick={() => setActive(id)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
          <p className="nav-label second">TRACK</p>
          {navItems.slice(6).map(([id, icon, label]) => (
            <button
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              onClick={() => setActive(id)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="privacy-card">
          <span className="privacy-icon">✓</span>
          <div>
            <strong>Private by design</strong>
            <p>{!ready ? "Opening local workspace…" : storageAvailable ? "Auto-saved on this device." : "Saving is unavailable."}</p>
            <button onClick={() => setSettingsOpen(true)}>Save & restore</button>
          </div>
        </div>
        <div className="household-card">
          <div className="avatars"><span>{activeProfile?.name.slice(0, 1).toUpperCase() || "P"}</span><span>✓</span></div>
          <div><strong>{activeProfile?.name ?? "My household"}</strong><small>{storageAvailable ? "Saved on this device" : "Saving unavailable"}</small></div>
          <button aria-label="Local workspace settings" onClick={() => setSettingsOpen(true)}>•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">HOUSEHOLD PLAN</p>
            <h1>{active === "dashboard" ? "Spending and monthly balance." : navItems.find((item) => item[0] === active)?.[2]}</h1>
          </div>
          {active === "dashboard" && (
            <div className="period-controls">
              <div className="view-toggle" aria-label="Dashboard period">
                <button className={dashboardView === "monthly" ? "active" : ""} onClick={() => setDashboardView("monthly")}>Monthly</button>
                <button className={dashboardView === "yearly" ? "active" : ""} onClick={() => setDashboardView("yearly")}>Yearly</button>
              </div>
              {dashboardView === "monthly" ? (
                <MonthNavigator value={plan.month} onChange={changeMonth} />
              ) : (
                <div className="year-picker">
                  <label><span>Year</span><select value={dashboardYear} onChange={(event) => setDashboardYear(Number(event.target.value))}>{plan.years.map((year) => <option value={year} key={year}>{year}</option>)}</select></label>
                  <button className="add-year-button" onClick={addNextYear}>+ Add year</button>
                </div>
              )}
            </div>
          )}
          {active !== "dashboard" && active !== "learn" && <MonthNavigator value={plan.month} onChange={changeMonth} />}
        </header>

        {active === "dashboard" && (
          <div className="dashboard">
            <section className={dashboardTotals.projectedBalance < 0 ? "balance-card danger" : "balance-card"}>
              <div className="balance-card-heading">
                <div><p className="eyebrow">{dashboardPeriodLabel.toUpperCase()}</p><h2>{dashboardView === "monthly" ? "Projected monthly balance" : "Projected yearly balance"}</h2></div>
                <button onClick={() => setActive("activity")}>Add or import spending →</button>
              </div>
              <div className="balance-card-body">
                <div className="balance-result" aria-live="polite">
                  <span>Expected at the end of {dashboardView === "monthly" ? "the month" : "the selected year"}</span>
                  <strong>{money.format(dashboardTotals.projectedBalance)}</strong>
                  <b>{dashboardTotals.projectedBalance >= 0 ? "Under income · money left over" : "Over income · overspent"}</b>
                </div>
                <div className="balance-equation" aria-label="Projected balance calculation">
                  <div><span>Total income</span><strong>{money.format(dashboardTotals.income)}</strong></div>
                  <i>−</i>
                  <div><span>Actual spending</span><strong>{money.format(dashboardTotals.spent)}</strong></div>
                  <i>−</i>
                  <div><span>Remaining bills</span><strong>{money.format(dashboardTotals.remainingBills)}</strong></div>
                  <i>=</i>
                  <div className="equation-total"><span>Projected balance</span><strong>{money.format(dashboardTotals.projectedBalance)}</strong></div>
                </div>
              </div>
            </section>

            <section className="dashboard-summary-grid">
              <article className="panel income-summary-card">
                <div className="panel-heading"><div><p className="eyebrow">MONTHLY INCOME SUMMARY</p><h2>Money coming in</h2></div><button onClick={() => setActive("budget")}>Update</button></div>
                <div className="three-line-summary"><span>Received</span><strong>{money.format(dashboardTotals.incomeReceived)}</strong><span>Expected remaining</span><strong>{money.format(dashboardTotals.expectedIncome)}</strong><span>Total monthly income</span><strong>{money.format(dashboardTotals.income)}</strong></div>
              </article>
              <article className="panel savings-target-card">
                <div className="panel-heading"><div><p className="eyebrow">SAVINGS TARGET</p><h2>{dashboardView === "monthly" ? "Protect monthly savings" : "Savings pace"}</h2></div><button onClick={() => setActive("budget")}>Edit</button></div>
                <div className="target-amounts"><span>Minimum <b>{money.format(minimumSavingsTarget)}</b></span><span>Ideal <b>{money.format(idealSavingsTarget)}</b></span></div>
                <div className="savings-track"><span style={{ width: `${savingsProgress}%` }} /></div>
                <strong className={savingsTargetsConfigured && targetMonths > 0 && projectedForSavings >= minimumSavingsTarget ? "target-status on-track" : "target-status short"}>{targetMonths === 0 ? "Open a month to start the yearly view" : !savingsTargetsConfigured ? "Set your goals in Monthly Plan" : projectedForSavings >= idealSavingsTarget ? "Ideal goal covered" : projectedForSavings >= minimumSavingsTarget ? `${money.format(idealSavingsTarget - projectedForSavings)} from the ideal goal` : `${money.format(minimumSavingsTarget - projectedForSavings)} short of the minimum goal`}</strong>
              </article>
            </section>

            <div className="dashboard-main-grid">
              <section className="panel actual-spending-card">
                <div className="panel-heading"><div><p className="eyebrow">ACTUAL SPENDING SUMMARY</p><h2>{money.format(dashboardTotals.spent)} spent</h2></div><button onClick={() => setActive("activity")}>{dashboardTotals.reviewNeeded ? `${dashboardTotals.reviewNeeded} need review` : "View transactions"}</button></div>
                <p className="section-note">Categories show what was actually spent. Monthly targets do not affect these totals.</p>
                <div className="actual-category-grid">{dashboardCategories.map((category) => {
                  const share = dashboardTotals.spent ? category.spent / dashboardTotals.spent * 100 : 0;
                  return <button key={category.id} onClick={() => { setTransactionCategoryFilter(category.id); setActive("activity"); }}>
                    <span className="actual-category-dot" style={{ background: category.color }} />
                    <div><strong>{category.name}</strong><small>{share ? `${share.toFixed(0)}% of spending` : "No spending yet"}</small><i><b style={{ width: `${share}%`, background: category.color }} /></i></div>
                    <b>{money.format(category.spent)}</b>
                  </button>;
                })}</div>
              </section>

              {dashboardView === "monthly" ? <section className="panel remaining-bills-card">
                <div className="panel-heading"><div><p className="eyebrow">REMAINING BILLS THIS MONTH</p><h2>{money.format(totals.remainingBills)} left</h2></div><button onClick={() => setActive("calendar")}>Calendar</button></div>
                <p className="section-note">Mark a bill paid to move it into actual spending. The projection will not count it twice.</p>
                <div className="dashboard-bill-list">{visibleBills.filter((bill) => !bill.paid).sort((a, b) => a.dueDay - b.dueDay).map((bill) => <article key={bill.id}>
                  <button className="bill-check" aria-label={`Mark ${bill.name} paid`} onClick={() => toggleBillPaid(bill.id)}>○</button>
                  <div><strong>{bill.name}</strong><small>Due {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(selectedYear, selectedMonth - 1, bill.dueDay))}</small></div>
                  <b>{money.format(bill.amount)}</b>
                  <button className={bill.includedInProjection === false ? "projection-toggle excluded" : "projection-toggle"} onClick={() => toggleBillProjection(bill.id)}>{bill.includedInProjection === false ? "Not included" : "Included"}</button>
                </article>)}</div>
                {visibleBills.filter((bill) => !bill.paid).length === 0 && <div className="compact-empty"><strong>All known bills are paid.</strong><span>Add another bill in the calendar if something is missing.</span></div>}
              </section> : <section className="panel yearly-snapshot-card">
                <p className="eyebrow">YEAR-TO-DATE</p><h2>{yearlyTotals.monthsWithData} months with data</h2>
                <div className="three-line-summary"><span>Actual spending</span><strong>{money.format(yearlyTotals.spent)}</strong><span>Known bills remaining</span><strong>{money.format(yearlyTotals.remainingBills)}</strong><span>Projected balance</span><strong>{money.format(yearlyTotals.projectedBalance)}</strong></div>
              </section>}
            </div>

            {dashboardView === "yearly" && <section className="panel year-overview">
              <div className="panel-heading"><div><p className="eyebrow">JANUARY–DECEMBER</p><h2>{dashboardYear} month-by-month</h2></div><span className="live-pill">{yearlyTotals.monthsWithData} months saved</span></div>
              <div className="year-month-grid">{yearlyMonths.map((item) => {
                const max = Math.max(item.totals.income, item.totals.spent, item.totals.remainingBills, 1);
                return <button className={item.key === plan.month ? "year-month-card active" : "year-month-card"} key={item.key} onClick={() => { changeMonth(item.key); setDashboardView("monthly"); }}>
                  <div><strong>{item.label}</strong><span>{item.hasData ? money.format(item.totals.projectedBalance) : "Not started"}</span></div>
                  <div className="year-bars"><i style={{ width: `${item.totals.income / max * 100}%` }} /><i style={{ width: `${item.totals.spent / max * 100}%` }} /><i style={{ width: `${item.totals.remainingBills / max * 100}%` }} /></div>
                </button>;
              })}</div>
              <div className="year-legend"><span><i className="income" /> Income</span><span><i className="spent" /> Actual spending</span><span><i className="bills" /> Remaining bills</span></div>
            </section>}
          </div>
        )}

        {active === "budget" && (
          <div className="budget-page">
            <section className="budget-summary">
              <div><span>Total income</span><strong>{money.format(totals.income)}</strong></div>
              <div><span>Optional targets</span><strong>{money.format(spendingCategories.reduce((sum, category) => sum + (totals.categoryTargets[category.id] || 0), 0))}</strong></div>
              <div><span>Minimum savings</span><strong>{money.format(plan.savingsTargets.minimum)}</strong></div>
              <div><span>Ideal savings</span><strong>{money.format(plan.savingsTargets.ideal)}</strong></div>
            </section>

            <div className="budget-columns">
              <section className="panel input-panel">
                <div className="panel-heading"><div><p className="eyebrow">MONTHLY INCOME</p><h2>Income received and expected</h2></div><span className="live-pill">Updates balance</span></div>
                <p className="section-note">Enter what has arrived and only the income still expected this month. Both feed the projected balance.</p>
                <div className="income-plan-head"><span>Source</span><span>Received</span><span>Still expected</span></div>
                <div className="income-plan-list">
                  {plan.incomes.map((item) => (
                    <div className="income-plan-row" key={item.id}>
                      <div><strong>{item.name}</strong><small>{item.owner}</small></div>
                      <CurrencyInput value={item.amount} onChange={(amount) => updateIncome(item.id, amount)} ariaLabel={`${item.name} income received`} />
                      <CurrencyInput value={item.expectedRemaining || 0} onChange={(amount) => updateExpectedIncome(item.id, amount)} ariaLabel={`${item.name} income expected remaining`} />
                    </div>
                  ))}
                </div>
                <section className="savings-goal-editor">
                  <div><strong>Monthly savings goal</strong><small>Your projected balance is compared with both amounts.</small></div>
                  <label><span>Minimum</span><CurrencyInput value={plan.savingsTargets.minimum} onChange={(minimum) => setPlan((current) => ({ ...current, savingsTargets: { ...current.savingsTargets, minimum } }))} ariaLabel="Minimum monthly savings target" /></label>
                  <label><span>Ideal</span><CurrencyInput value={plan.savingsTargets.ideal} onChange={(ideal) => setPlan((current) => ({ ...current, savingsTargets: { ...current.savingsTargets, ideal } }))} ariaLabel="Ideal monthly savings target" /></label>
                </section>
              </section>

              <section className="panel category-panel">
                <div className="panel-heading"><div><p className="eyebrow">OPTIONAL PLANNING</p><h2>Monthly targets</h2></div><div className="scope-toggle" role="group" aria-label="Monthly target change scope"><button className={expectedScope === "month" ? "active" : ""} onClick={() => setExpectedScope("month")}>This month only</button><button className={expectedScope === "future" ? "active" : ""} onClick={() => setExpectedScope("future")}>This & future months</button></div></div>
                <p className="section-note">Targets live only here. They are optional and never change actual spending or the projected balance.</p>
                <div className="target-list">{spendingCategories.map((category) => {
                  const allocation = plan.allocations.find((item) => item.id === category.id);
                  return <div className="target-row" key={category.id}>
                    <span className="actual-category-dot" style={{ background: category.color }} />
                    <div><strong>{category.name}</strong><small>Optional monthly target</small></div>
                    <CurrencyInput value={allocation?.amount || 0} onChange={(amount) => updateExpected(category.id, amount)} ariaLabel={`${category.name} monthly target`} />
                  </div>;
                })}</div>
              </section>
            </div>
          </div>
        )}

        {active === "calendar" && (
          <div className="module-page">
            <section className="module-stats">
              <article><span>Known monthly bills</span><strong>{money.format(monthlyBillTotal)}</strong><small>Recurring schedule</small></article>
              <article><span>Remaining this month</span><strong>{money.format(totals.remainingBills)}</strong><small>Included in projection</small></article>
              <article><span>Paid this month</span><strong>{visibleBills.filter((bill) => bill.paid).length}</strong><small>of {visibleBills.length} bills</small></article>
            </section>
            <div className="module-grid calendar-layout">
              <section className="panel calendar-panel">
                <div className="panel-heading"><div><p className="eyebrow">PAYMENT CALENDAR</p><h2>{monthLabel}</h2></div><span className="live-pill">Budget linked</span></div>
                <div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
                <div className="calendar-grid">
                  {calendarDays.map((day, index) => {
                    const bills = day ? visibleBills.filter((bill) => bill.dueDay === day) : [];
                    return <div className={bills.length ? "calendar-day has-bill" : "calendar-day"} key={`${day}-${index}`}>
                      {day && <><span className="day-number">{day}</span>{bills.slice(0, 3).map((bill) => <button className={bill.paid ? "paid" : ""} key={bill.id} onClick={() => document.getElementById(bill.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{bill.paid ? "✓ " : ""}{bill.name}<small>{money.format(bill.paid ? bill.paidAmount ?? bill.amount : bill.amount)}</small></button>)}{bills.length > 3 && <small>+{bills.length - 3} more</small>}</>}
                    </div>;
                  })}
                </div>
              </section>
              <section className="panel bill-list-panel">
                <div className="panel-heading"><div><p className="eyebrow">RECURRING</p><h2>Bills & subscriptions</h2></div><span className="live-pill">Editable</span></div>
                <p className="section-note">Recurring details continue into future months. Paid status and projection inclusion apply only to the selected month.</p>
                <div className="recurring-form">
                  <label className="recurring-name"><span>Name</span><input value={billDraft.name} placeholder="New subscription" onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>Category</span><select value={billDraft.categoryId} onChange={(event) => setBillDraft((current) => ({ ...current, categoryId: event.target.value }))}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                  <label><span>Frequency</span><select value={billDraft.frequency} onChange={(event) => setBillDraft((current) => ({ ...current, frequency: event.target.value as Bill["frequency"] }))}><option value="Monthly">Monthly</option><option value="Annual">Annual</option></select></label>
                  <label className="compact-field"><span>Due</span><input aria-label="New recurring expense due day" type="number" min="1" max="28" value={billDraft.dueDay} onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: Math.min(28, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
                  <CurrencyInput value={billDraft.amount} onChange={(amount) => setBillDraft((current) => ({ ...current, amount }))} ariaLabel="New recurring expense amount" />
                  <button className="add-recurring-button" onClick={addBill}>+ Add</button>
                </div>
                <div className="bill-list">
                  {plan.bills.map((bill) => <div className="bill-row" id={bill.id} key={bill.id}>
                    <button className={bill.paid ? "bill-status paid" : "bill-status"} onClick={() => toggleBillPaid(bill.id)}><span>{bill.paid ? "✓" : "○"}</span>{bill.paid ? "Paid" : "Unpaid"}</button>
                    <div><strong>{bill.name}</strong><small>{spendingCategories.find((item) => item.id === canonicalSpendingCategory(bill.categoryId))?.name} · {bill.frequency}</small></div>
                    <label className="compact-field"><span>Due</span><input aria-label={`${bill.name} due day`} type="number" min="1" max="28" value={bill.dueDay} onChange={(event) => updateBill(bill.id, { dueDay: Math.min(28, Math.max(1, Number(event.target.value) || 1)) })} /></label>
                    <CurrencyInput value={bill.amount} onChange={(amount) => updateBill(bill.id, { amount })} ariaLabel={`${bill.name} amount`} />
                    <button className={bill.includedInProjection === false ? "projection-toggle excluded" : "projection-toggle"} onClick={() => toggleBillProjection(bill.id)}>{bill.includedInProjection === false ? "Not included" : "In projection"}</button>
                    <button className="delete-bill-button" aria-label={`Delete ${bill.name}`} onClick={() => deleteBill(bill.id)}>×</button>
                  </div>)}
                </div>
              </section>
            </div>
          </div>
        )}

        {active === "debt" && (
          <div className="module-page">
            <section className="module-hero debt-hero">
              <div><p className="eyebrow">PAYOFF PLAN</p><h2>{money.format(totals.debt)} remaining</h2><span>{money.format(debtMonthly)} from the paycheck is assigned to debt each month.</span></div>
              <button className="primary-button" onClick={() => setActive("budget")}>See full paycheck →</button>
            </section>
            <section className="panel liability-add-panel">
              <div className="panel-heading"><div><p className="eyebrow">LIABILITIES</p><h2>Add a debt or loan</h2></div><span className="live-pill">Current & future</span></div>
              <p className="section-note">Add credit cards, personal loans, vehicle loans, or other liabilities. Removing one later preserves earlier months.</p>
              <div className="liability-form">
                <label className="liability-name"><span>Name</span><input value={debtDraft.name} placeholder="Example: Personal loan" onChange={(event) => setDebtDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label><span>Balance</span><CurrencyInput value={debtDraft.balance} onChange={(balance) => setDebtDraft((current) => ({ ...current, balance }))} ariaLabel="New liability balance" /></label>
                <label><span>APR</span><NumberInput value={debtDraft.apr} onChange={(apr) => setDebtDraft((current) => ({ ...current, apr }))} ariaLabel="New liability APR" suffix="%" /></label>
                <label><span>Minimum</span><CurrencyInput value={debtDraft.minimum} onChange={(minimum) => setDebtDraft((current) => ({ ...current, minimum }))} ariaLabel="New liability minimum payment" /></label>
                <label><span>Extra</span><CurrencyInput value={debtDraft.extra} onChange={(extra) => setDebtDraft((current) => ({ ...current, extra }))} ariaLabel="New liability extra payment" /></label>
                <button className="add-recurring-button" onClick={addDebt}>+ Add liability</button>
              </div>
            </section>
            <div className="debt-grid">
              {plan.debts.map((debt) => {
                const months = payoffMonths(debt);
                const percent = totals.debt ? (debt.balance / totals.debt) * 100 : 0;
                return <section className="panel debt-card" key={debt.id}>
                  <div className="debt-card-head"><div><span className="debt-badge">{debt.name.slice(0, 2).toUpperCase()}</span><div><p>DEBT ACCOUNT</p><h2>{debt.name}</h2></div></div><div className="debt-card-actions"><strong>{money.format(debt.balance)}</strong><button aria-label={`Remove ${debt.name}`} onClick={() => archiveDebt(debt.id)}>Remove</button></div></div>
                  <div className="debt-track"><span style={{ width: `${percent}%` }} /></div>
                  <div className="field-grid">
                    <label><span>Current balance</span><CurrencyInput value={debt.balance} onChange={(balance) => updateDebt(debt.id, { balance })} ariaLabel={`${debt.name} current balance`} /></label>
                    <label><span>APR</span><NumberInput value={debt.apr} onChange={(apr) => updateDebt(debt.id, { apr })} ariaLabel={`${debt.name} APR`} suffix="%" /></label>
                    <label><span>Minimum payment</span><CurrencyInput value={debt.minimum} onChange={(minimum) => updateDebt(debt.id, { minimum })} ariaLabel={`${debt.name} minimum payment`} /></label>
                    <label><span>Extra payment</span><CurrencyInput value={debt.extra} onChange={(extra) => updateDebt(debt.id, { extra })} ariaLabel={`${debt.name} extra payment`} /></label>
                  </div>
                  <div className="payoff-result"><div><span>Estimated payoff</span><strong>{months === Infinity ? "Increase payment" : months === 0 ? "Add balance" : `${months} months`}</strong></div><small>Payment: {money.format(debt.minimum + debt.extra)} / month</small></div>
                </section>;
              })}
            </div>
            <section className="connection-note"><span>↔</span><div><strong>Connected to your monthly budget</strong><p>Minimum and extra payments automatically update the Debt allocation and your available paycheck balance.</p></div></section>
          </div>
        )}

        {active === "goals" && (
          <div className="module-page">
            <section className="module-stats">
              <article><span>Saved toward goals</span><strong>{money.format(plan.goals.reduce((sum, goal) => sum + goal.current, 0))}</strong><small>Current balances</small></article>
              <article><span>Monthly contribution</span><strong>{money.format(plan.goals.reduce((sum, goal) => sum + goal.monthly, 0))}</strong><small>Linked to Savings</small></article>
              <article><span>Goal target</span><strong>{money.format(plan.goals.reduce((sum, goal) => sum + goal.target, 0))}</strong><small>Across {plan.goals.length} goals</small></article>
            </section>
            <div className="goal-grid">
              {plan.goals.map((goal) => {
                const progress = goal.target ? Math.min(100, (goal.current / goal.target) * 100) : 0;
                const remaining = Math.max(0, goal.target - goal.current);
                return <section className="panel goal-card" key={goal.id}>
                  <div className="goal-art"><span>{goal.id === "emergency" ? "✦" : "◎"}</span></div>
                  <div className="goal-content"><p className="eyebrow">SAVINGS GOAL</p><h2>{goal.name}</h2><strong>{money.format(goal.current)} <small>of {money.format(goal.target)}</small></strong>
                    <div className="goal-track"><span style={{ width: `${progress}%` }} /></div>
                    <div className="goal-meta"><span>{progress.toFixed(0)}% funded</span><span>{money.format(remaining)} remaining</span></div>
                    <div className="field-grid goal-fields">
                      <label><span>Current</span><CurrencyInput value={goal.current} onChange={(current) => updateGoal(goal.id, { current })} ariaLabel={`${goal.name} current savings`} /></label>
                      <label><span>Target</span><CurrencyInput value={goal.target} onChange={(target) => updateGoal(goal.id, { target })} ariaLabel={`${goal.name} target`} /></label>
                      <label><span>Monthly</span><CurrencyInput value={goal.monthly} onChange={(monthly) => updateGoal(goal.id, { monthly })} ariaLabel={`${goal.name} monthly contribution`} /></label>
                      <label className="date-field"><span>Target month</span><input type="month" value={goal.targetDate} onChange={(event) => updateGoal(goal.id, { targetDate: event.target.value })} /></label>
                    </div>
                  </div>
                </section>;
              })}
            </div>
          </div>
        )}

        {active === "investing" && (
          <div className="module-page investing-page">
            <section className="module-hero investing-hero">
              <div><p className="eyebrow">MONTHLY RESOURCE</p><h2>Invest from the paycheck, on purpose.</h2><span>This amount is subtracted from available income and added to your full-plan dashboard.</span></div>
              <div className="hero-input"><span>Invest each month</span><CurrencyInput value={plan.investmentMonthly} onChange={updateInvestmentMonthly} ariaLabel="Monthly investing allocation" /></div>
            </section>
            <div className="module-grid investing-layout">
              <section className="panel allocation-builder">
                <div className="panel-heading"><div><p className="eyebrow">ALLOCATION</p><h2>Monthly investing plan</h2></div><span className={bucketPercent === 100 ? "live-pill" : "warning-pill"}>{bucketPercent}% assigned</span></div>
                <p className="section-note">Set the percentage for each resource. The dollar amounts recalculate from the monthly investing budget.</p>
                {plan.investmentBuckets.map((bucket, index) => <div className="investment-row" key={bucket.id}>
                  <span className="investment-number">0{index + 1}</span><div><strong>{bucket.name}</strong><small>{money.format(plan.investmentMonthly * bucket.percent / 100)} / month</small></div>
                  <div className="investment-slider"><input aria-label={`${bucket.name} percent`} type="range" min="0" max="100" value={bucket.percent} onChange={(event) => setPlan((current) => ({ ...current, investmentBuckets: current.investmentBuckets.map((item) => item.id === bucket.id ? { ...item, percent: Number(event.target.value) } : item) }))} /><NumberInput value={bucket.percent} onChange={(percent) => setPlan((current) => ({ ...current, investmentBuckets: current.investmentBuckets.map((item) => item.id === bucket.id ? { ...item, percent: Math.min(100, percent) } : item) }))} ariaLabel={`${bucket.name} allocation percent`} suffix="%" /></div>
                </div>)}
                {bucketPercent !== 100 && <p className="allocation-warning">Adjust allocations to exactly 100%. The monthly budget still uses the total contribution above.</p>}
              </section>
              <aside className="panel paycheck-bridge">
                <p className="eyebrow">PAYCHECK BRIDGE</p><h2>{money.format(plan.investmentMonthly)}</h2><span>of {money.format(totals.income)} monthly income</span>
                <div className="bridge-ring" style={{ "--percent": `${totals.income ? Math.min(100, plan.investmentMonthly / totals.income * 100) : 0}%` } as CSSProperties}><strong>{totals.income ? (plan.investmentMonthly / totals.income * 100).toFixed(0) : 0}%</strong><small>of income</small></div>
                <button className="secondary-button" onClick={() => setActive("dashboard")}>View main dashboard →</button>
              </aside>
            </div>
          </div>
        )}

        {active === "activity" && (
          <div className="module-page">
            <section className="statement-import-panel panel">
              <div className="panel-heading"><div><p className="eyebrow">FASTEST WAY TO UPDATE SPENDING</p><h2>Import a bank or card statement</h2></div><span className="local-pill">Runs on this device</span></div>
              <p className="section-note">Download a CSV from your bank, then upload it here. Paycheck detects spending, applies merchant rules, skips duplicates, matches clear bill payments, and flags only exceptions.</p>
              <div className="statement-actions">
                <button className="primary-button" onClick={() => statementInputRef.current?.click()}>Upload CSV statement</button>
                <input ref={statementInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={handleStatementFile} />
                <label><span>Account or payment method</span><input value={importAccount} placeholder="Checking or Visa" onChange={(event) => { setImportAccount(event.target.value); if (statementText) prepareStatement(statementText, importMode, event.target.value); }} /></label>
                {statementText && <label><span>Charges appear as</span><select value={importMode} onChange={(event) => { const mode = event.target.value as ImportAmountMode; setImportMode(mode); prepareStatement(statementText, mode); }}><option value="negative">Negative amounts</option><option value="positive">Positive amounts</option></select></label>}
              </div>
              {importError && <p className="import-error">{importError}</p>}
              {importPreview.length > 0 && <div className="import-preview">
                <div className="import-preview-heading"><div><strong>{statementName}</strong><small>{importPreview.filter((item) => !item.duplicate).length} new · {importPreview.filter((item) => item.duplicate).length} duplicate · {importPreview.filter((item) => item.reviewNeeded && !item.duplicate).length} need review</small></div><button className="primary-button" onClick={importStatementTransactions}>Import new transactions</button></div>
                <div className="import-preview-list">{importPreview.slice(0, 8).map((item) => <div className={item.duplicate ? "import-preview-row duplicate" : "import-preview-row"} key={item.id}>
                  <span>{item.date}</span><strong>{item.description}</strong><b>{money.format(item.amount)}</b>
                  <select aria-label={`Category for ${item.description}`} value={item.categoryId} disabled={item.duplicate} onChange={(event) => setImportPreview((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, categoryId: event.target.value, reviewNeeded: event.target.value === "other-uncategorized" } : candidate))}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
                  <small>{item.duplicate ? "Already imported" : item.reviewNeeded ? "Review needed" : "Ready"}</small>
                </div>)}</div>
                {importPreview.length > 8 && <small className="preview-more">+ {importPreview.length - 8} more transactions will follow the same rules.</small>}
              </div>}
            </section>

            <section className="transaction-entry panel">
              <div className="panel-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Add one transaction</h2></div><span className="live-pill">Optional</span></div>
              <p className="section-note">Only the essentials. Leave the category as Other and Paycheck will try the merchant rules when you add it.</p>
              <div className="transaction-form">
                <label><span>Date</span><input type="date" value={transactionDraft.date} onChange={(event) => setTransactionDraft((current) => ({ ...current, date: event.target.value }))} /></label>
                <label className="description-field"><span>Description / merchant</span><input placeholder="Example: Publix" value={transactionDraft.description} onBlur={() => setTransactionDraft((current) => current.categoryId === "other-uncategorized" ? { ...current, categoryId: categorizeMerchant(current.description, plan.merchantRules) } : current)} onChange={(event) => setTransactionDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <label><span>Category</span><select value={transactionDraft.categoryId} onChange={(event) => setTransactionDraft((current) => ({ ...current, categoryId: event.target.value }))}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                <label><span>Account</span><input value={transactionDraft.account} placeholder="Checking" onChange={(event) => setTransactionDraft((current) => ({ ...current, account: event.target.value }))} /></label>
                <label><span>Amount</span><CurrencyInput value={transactionDraft.amount} onChange={(amount) => setTransactionDraft((current) => ({ ...current, amount }))} ariaLabel="Transaction amount" /></label>
                <button className="primary-button" onClick={addTransaction}>Add transaction</button>
              </div>
            </section>
            <section className="module-stats transaction-stats">
              <article><span>Actual spending</span><strong>{money.format(totals.spent)}</strong><small>Transactions and paid bills</small></article>
              <article><span>Transactions</span><strong>{plan.transactions.length}</strong><small>{monthLabel}</small></article>
              <article><span>Review needed</span><strong>{reviewTransactions.length}</strong><small>Unrecognized merchants</small></article>
            </section>

            {reviewTransactions.length > 0 && <section className="panel review-panel">
              <div className="panel-heading"><div><p className="eyebrow">EXCEPTIONS ONLY</p><h2>Review needed</h2></div><span className="review-count">{reviewTransactions.length}</span></div>
              <p className="section-note">Choose a category once. “Categorize & remember” creates a local merchant rule for similar transactions.</p>
              <div className="review-list">{reviewTransactions.map((transaction) => <div className="review-row" key={transaction.id}>
                <div><strong>{transaction.description}</strong><small>{transaction.date} · {transaction.account || transaction.owner || "Household"}</small></div>
                <b>{money.format(transaction.amount)}</b>
                <select value={transaction.categoryId} onChange={(event) => updateTransactionCategory(transaction.id, event.target.value, false, true)}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
                <div className="review-actions"><button disabled={transaction.categoryId === "other-uncategorized"} onClick={() => updateTransactionCategory(transaction.id, transaction.categoryId)}>Done</button><button disabled={transaction.categoryId === "other-uncategorized"} onClick={() => updateTransactionCategory(transaction.id, transaction.categoryId, true)}>Remember</button></div>
              </div>)}</div>
            </section>}

            <section className="panel transaction-panel">
              <div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Transactions</h2></div><label className="transaction-filter"><span>Show</span><select value={transactionCategoryFilter} onChange={(event) => setTransactionCategoryFilter(event.target.value)}><option value="all">All categories</option>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div>
              {filteredTransactions.length === 0 ? <div className="empty-state"><span>≡</span><h3>No transactions here yet</h3><p>Upload a CSV statement or add a single transaction above.</p></div> : <div className="transaction-table"><div className="transaction-head"><span>Date</span><span>Description</span><span>Category</span><span>Account</span><span>Amount</span><span /></div>{filteredTransactions.map((transaction) => <div className="transaction-row" key={transaction.id}><span>{transaction.date}</span><strong>{transaction.description}</strong><span>{spendingCategories.find((item) => item.id === canonicalSpendingCategory(transaction.categoryId))?.name}</span><span>{transaction.account || transaction.owner || "Household"}</span><strong>{money.format(transaction.amount)}</strong><button aria-label={`Delete ${transaction.description}`} onClick={() => deleteTransaction(transaction.id)}>×</button></div>)}</div>}
            </section>

            <details className="panel manual-totals-panel">
              <summary>Enter an unitemized category total</summary>
              <p>If you do not want to list transactions, enter only the extra total for a category here. Paid bills and imported transactions are added separately.</p>
              <div>{spendingCategories.map((category) => {
                const allocation = plan.allocations.find((item) => item.id === category.id);
                return <label key={category.id}><span>{category.name}</span><ActualCurrencyInput value={allocation?.actual} onChange={(amount) => updateActual(category.id, amount)} ariaLabel={`${category.name} unitemized actual amount`} /></label>;
              })}</div>
            </details>

            <details className="panel merchant-rules-panel">
              <summary>Merchant rules</summary>
              <p>Built-in examples include Publix and Aldi → Groceries; Shell and Exxon → Gas; Chick-fil-A and Taco Bell → Fast Food; Netflix, Spotify, and Apple → Subscriptions.</p>
              <div className="rule-list">{plan.merchantRules.length === 0 ? <small>No custom rules yet. Create one from Review Needed.</small> : plan.merchantRules.map((rule) => <span key={rule.id}><b>{rule.pattern}</b> → {spendingCategories.find((item) => item.id === rule.categoryId)?.name}<button aria-label={`Delete rule ${rule.pattern}`} onClick={() => removeMerchantRule(rule.id)}>×</button></span>)}</div>
              <small>{defaultMerchantRules.length} built-in rules run locally. No financial data is sent to an AI service.</small>
            </details>
          </div>
        )}

        {active === "worth" && (
          <div className="module-page">
            <section className="module-hero worth-hero"><div><p className="eyebrow">HOUSEHOLD NET WORTH</p><h2>{money.format(totals.netWorth)}</h2><span>{money.format(totals.assets)} assets minus {money.format(totals.debt)} connected debt.</span></div><button className="primary-button" onClick={() => setActive("debt")}>Review debt →</button></section>
            <div className="module-grid worth-layout">
              <section className="panel account-panel">
                <div className="panel-heading"><div><p className="eyebrow">WHAT YOU OWN</p><h2>Assets</h2></div><strong>{money.format(totals.assets)}</strong></div>
                <p className="section-note">Account categories are based on the checking, business, crypto, investment, and vehicle sections in your workbook.</p>
                {plan.assets.map((asset) => <div className="account-row" key={asset.id}><span className="account-icon">{asset.name.slice(0, 1)}</span><div><strong>{asset.name}</strong><small>{asset.type}</small></div><CurrencyInput value={asset.balance} onChange={(balance) => setPlan((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, balance } : item) }))} ariaLabel={`${asset.name} account balance`} /></div>)}
              </section>
              <section className="panel account-panel liability-panel">
                <div className="panel-heading"><div><p className="eyebrow">WHAT YOU OWE</p><h2>Liabilities</h2></div><strong>{money.format(totals.debt)}</strong></div>
                <p className="section-note">Balances are edited once in the debt planner and reflected here automatically.</p>
                {plan.debts.map((debt) => <button className="account-row account-button" key={debt.id} onClick={() => setActive("debt")}><span className="account-icon debt-icon">{debt.name.slice(0, 1)}</span><div><strong>{debt.name}</strong><small>Open payoff plan</small></div><strong>{money.format(debt.balance)}</strong></button>)}
                <div className="net-worth-equation"><span>Assets</span><strong>{money.format(totals.assets)}</strong><span>Debt</span><strong>− {money.format(totals.debt)}</strong><span>Net worth</span><strong>{money.format(totals.netWorth)}</strong></div>
              </section>
            </div>
          </div>
        )}

        {active === "learn" && (
          <div className="module-page learn-page">
            <section className="learn-hero">
              <div><p className="eyebrow">SIMPLE, PRIVATE SAVING</p><h2>Your budget saves automatically on this device.</h2><p>Come back using the same browser and device and your latest entries will be here. Download a backup when you want an extra copy or plan to move to another device.</p></div>
              <button className="primary-button" onClick={() => setSettingsOpen(true)}>Save or restore →</button>
            </section>
            <section className="panel architecture-panel">
              <div className="panel-heading"><div><p className="eyebrow">HOW IT WORKS</p><h2>Three things to remember</h2></div><span className="live-pill">Auto-save on</span></div>
              <div className="data-flow" aria-label="How changes are calculated and saved">
                <article><span>1</span><strong>Update income and known bills</strong><small>Mark each bill paid when it clears.</small></article><b>→</b>
                <article><span>2</span><strong>Upload spending or add one item</strong><small>Merchant rules categorize the familiar purchases.</small></article><b>→</b>
                <article><span>3</span><strong>Check the projected balance</strong><small>The dashboard recalculates and saves on this device.</small></article>
              </div>
            </section>
            <div className="learn-grid">
              <section className="panel explainer-card"><span className="explainer-icon">≡</span><p className="eyebrow">FAST ENTRY</p><h2>Import a statement</h2><p>Upload a bank or card CSV. Categorization rules run on this device, duplicates are skipped, and only unknown merchants need review.</p><button onClick={() => setActive("activity")}>Open transactions →</button></section>
              <section className="panel explainer-card"><span className="explainer-icon">⌂</span><p className="eyebrow">INSTALLABLE WEBSITE</p><h2>It is not a Chrome extension</h2><p>Paycheck is a Progressive Web App. You can use it as a website or install it from Chrome or Edge so it opens in its own app window.</p></section>
              <section className="panel explainer-card"><span className="explainer-icon">↓</span><p className="eyebrow">BACKUP FILE</p><h2>What is a `.paycheck` file?</h2><p>It is a backup made for this app. If Word shows code when you open it, nothing is wrong—return here and choose “Restore a backup.”</p><button onClick={() => setSettingsOpen(true)}>Download or restore →</button></section>
            </div>
            <section className="panel backup-guide">
              <div><p className="eyebrow">BACKUP RECOMMENDATION</p><h2>Auto-save is convenient. A backup is extra protection.</h2><p>Your automatic copy stays in this browser. It can be lost if browser data is cleared, the device is lost, or you switch browsers or computers.</p></div>
              <ul className="simple-list">
                <li><span>✓</span><div><strong>Download a backup at least monthly</strong><small>Also make one after important changes.</small></div></li>
                <li><span>✓</span><div><strong>Keep it somewhere you can find</strong><small>For example, Documents, a USB drive, or your own cloud drive.</small></div></li>
                <li><span>✓</span><div><strong>Download a fresh copy later</strong><small>A backup does not update itself after you download it.</small></div></li>
              </ul>
              <div className="backup-guide-action">
                <button className="primary-button" onClick={() => setSettingsOpen(true)}>Open save & restore</button>
                <small>Restoring a backup creates a separate budget and does not replace the one already on this device.</small>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
    {notice && <div className="app-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
    {settingsOpen && (
      <div className="modal-backdrop" role="presentation">
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><p className="eyebrow">YOUR BUDGETS</p><h2 id="settings-title">Save & restore</h2></div><button className="modal-close" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></header>
          <div className="storage-strip"><span className={storageAvailable ? "storage-dot" : "storage-dot error"} /><div><strong>{storageAvailable ? "Saved automatically in this browser" : "Automatic saving is unavailable"}</strong><small>{storageAvailable ? "Return with the same browser and device to continue where you left off." : "Download a backup before closing this page."}</small></div></div>
          <div className="settings-section">
            <div className="settings-heading"><div><h3>Your budgets</h3><p>Keep separate budgets for different people or households.</p></div><span>{profiles.length}</span></div>
            <div className="profile-list">{profiles.map((profile) => (
              <div className={profile.id === activeProfileId ? "profile-row active" : "profile-row"} key={profile.id}>
                <span className="profile-avatar">{profile.name.slice(0, 1).toUpperCase()}</span><div><strong>{profile.name}</strong><small>{profile.id === activeProfileId ? "Open now" : "Stored on this device"}{profile.lastBackupAt ? ` · Backed up ${new Date(profile.lastBackupAt).toLocaleDateString()}` : ""}</small></div>
                {profile.id === activeProfileId ? <span className="current-pill">Current</span> : <button onClick={() => void switchProfile(profile.id)}>Open</button>}
                <button className="danger-button" aria-label={`Delete ${profile.name}`} onClick={() => void removeProfile(profile.id)}>×</button>
              </div>
            ))}</div>
            <div className="create-profile"><input aria-label="New budget name" placeholder="Budget name" value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createProfile(); }} /><button className="secondary-button" onClick={() => void createProfile()}>Create another budget</button></div>
          </div>
          <div className="settings-section backup-section">
            <div className="settings-heading"><div><h3>Backup file</h3><p>Download an extra copy. It will not update itself after it is downloaded.</p></div></div>
            <label className="password-field"><span>Optional: enter a password before choosing the password-protected backup</span><input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} /></label>
            <div className="backup-actions"><button onClick={() => void exportBackup(false)}>Download backup</button><button className="secure-button" onClick={() => void exportBackup(true)}>Password-protect backup</button><button onClick={() => fileInputRef.current?.click()}>Restore a backup</button><input ref={fileInputRef} className="visually-hidden" type="file" accept=".paycheck,application/json" onChange={(event) => void restoreBackup(event)} /></div>
            <p className="backup-warning"><strong>A `.paycheck` file is opened inside Paycheck—not in Word.</strong> Seeing code or unreadable text in another program is normal. If you use a password, keep it safe; Paycheck cannot recover it.</p>
          </div>
        </section>
      </div>
    )}
    </>
  );
}
