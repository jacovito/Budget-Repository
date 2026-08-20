"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { backupNeedsPassword, createBackup, readBackup } from "./backup";
import { deleteProfile, listProfiles, loadPlan, putProfile, requestPersistentStorage, savePlan, type LocalProfile } from "./local-store";
import { evaluateMoneyExpression } from "./math-expression";

type Income = { id: string; name: string; owner: string; amount: number };
type Allocation = {
  id: string;
  name: string;
  group: string;
  amount: number;
  linked?: "calendar" | "debt" | "goals" | "investing";
};
type Bill = { id: string; name: string; categoryId: string; amount: number; dueDay: number; frequency: "Monthly" | "Annual"; dueMonth?: number };
type Debt = { id: string; name: string; categoryId: string; balance: number; apr: number; minimum: number; extra: number };
type Goal = { id: string; name: string; current: number; target: number; monthly: number; targetDate: string };
type InvestmentBucket = { id: string; name: string; percent: number };
type Asset = { id: string; name: string; type: string; balance: number };
type Transaction = { id: string; date: string; description: string; categoryId: string; owner: string; amount: number };

type MonthSnapshot = {
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
};

const LEGACY_STORAGE_KEY = "paycheck-plan-v1";
const ACTIVE_PROFILE_KEY = "paycheck-active-profile-v1";

const initialPlan: Plan = {
  month: "2026-08",
  incomes: [
    { id: "palau", name: "Palau", owner: "Jacobo", amount: 0 },
    { id: "hawkeye", name: "Hawkeye", owner: "Jacobo", amount: 0 },
    { id: "partner", name: "Partner income", owner: "Partner", amount: 0 },
    { id: "extra", name: "Extra income", owner: "Household", amount: 0 },
  ],
  allocations: [
    { id: "tithe", name: "Tithe", group: "Giving", amount: 0 },
    { id: "tax", name: "Tax reserve", group: "Tax", amount: 0 },
    { id: "rent", name: "Rent", group: "Home & bills", amount: 0, linked: "calendar" },
    { id: "fpl", name: "Electricity / FPL", group: "Home & bills", amount: 0, linked: "calendar" },
    { id: "car-insurance", name: "Car insurance", group: "Home & bills", amount: 0, linked: "calendar" },
    { id: "subscriptions", name: "Subscriptions", group: "Home & bills", amount: 0, linked: "calendar" },
    { id: "fun", name: "Fun", group: "Lifestyle", amount: 0 },
    { id: "health", name: "Dentist & health", group: "Lifestyle", amount: 0 },
    { id: "misc", name: "Miscellaneous", group: "Lifestyle", amount: 0 },
    { id: "credit-card", name: "Credit card payment", group: "Debt", amount: 0, linked: "debt" },
    { id: "car-payment", name: "Vehicle payment", group: "Debt", amount: 0, linked: "debt" },
    { id: "saving", name: "Savings", group: "Goals", amount: 0, linked: "goals" },
    { id: "stocks", name: "Stocks & investing", group: "Investing", amount: 0, linked: "investing" },
    { id: "funded", name: "Funded-account fees", group: "Investing", amount: 0 },
  ],
  bills: [
    { id: "bill-rent", name: "Rent", categoryId: "rent", amount: 0, dueDay: 1, frequency: "Monthly" },
    { id: "bill-fpl", name: "Electricity / FPL", categoryId: "fpl", amount: 0, dueDay: 12, frequency: "Monthly" },
    { id: "bill-insurance", name: "Car insurance", categoryId: "car-insurance", amount: 0, dueDay: 18, frequency: "Monthly" },
    { id: "natural-cycles", name: "Natural Cycles", categoryId: "subscriptions", amount: 0, dueDay: 3, frequency: "Monthly" },
    { id: "oura", name: "Oura Ring", categoryId: "subscriptions", amount: 0, dueDay: 5, frequency: "Monthly" },
    { id: "coinbase", name: "Coinbase", categoryId: "subscriptions", amount: 0, dueDay: 8, frequency: "Monthly" },
    { id: "chatgpt", name: "ChatGPT", categoryId: "subscriptions", amount: 0, dueDay: 10, frequency: "Monthly" },
    { id: "kindle", name: "Kindle Unlimited", categoryId: "subscriptions", amount: 0, dueDay: 14, frequency: "Monthly" },
    { id: "apple-n", name: "Apple Storage — Partner", categoryId: "subscriptions", amount: 0, dueDay: 16, frequency: "Monthly" },
    { id: "apple-j", name: "Apple Storage — Jacobo", categoryId: "subscriptions", amount: 0, dueDay: 16, frequency: "Monthly" },
    { id: "spotify-n", name: "Spotify — Partner", categoryId: "subscriptions", amount: 0, dueDay: 22, frequency: "Monthly" },
    { id: "spotify-j", name: "Spotify — Jacobo", categoryId: "subscriptions", amount: 0, dueDay: 22, frequency: "Monthly" },
    { id: "sircon", name: "Vertafore / Sircon", categoryId: "subscriptions", amount: 0, dueDay: 27, frequency: "Annual", dueMonth: 1 },
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
    { id: "tam", name: "Tam Company", type: "Business", balance: 0 },
    { id: "coinbase-asset", name: "Coinbase", type: "Crypto", balance: 0 },
    { id: "bluefin", name: "Bluefin", type: "Investments", balance: 0 },
    { id: "vehicle", name: "Vehicle", type: "Property", balance: 0 },
  ],
  transactions: [],
  months: {},
  years: [2026],
};

function normalizeMonth(raw?: Partial<MonthSnapshot> | null): MonthSnapshot {
  return {
    incomes: initialPlan.incomes.map((seed) => ({ ...seed, ...(raw?.incomes || []).find((item) => item.id === seed.id) })),
    allocations: initialPlan.allocations.map((seed) => {
      const saved = (raw?.allocations || []).find((item) => item.id === seed.id);
      return { ...seed, ...saved, group: seed.group, linked: seed.linked };
    }),
    bills: raw?.bills || structuredClone(initialPlan.bills),
    debts: raw?.debts || structuredClone(initialPlan.debts),
    goals: raw?.goals || structuredClone(initialPlan.goals),
    investmentMonthly: raw?.investmentMonthly || 0,
    investmentBuckets: raw?.investmentBuckets || structuredClone(initialPlan.investmentBuckets),
    assets: raw?.assets || structuredClone(initialPlan.assets),
    transactions: raw?.transactions || [],
  };
}

function normalizePlan(raw?: Partial<Plan> | null): Plan {
  const month = raw?.month || initialPlan.month;
  const months = Object.fromEntries(
    Object.entries(raw?.months || {}).map(([key, value]) => [key, normalizeMonth(value)]),
  );
  const years = [...new Set([
    ...(raw?.years || []),
    Number(month.slice(0, 4)),
    ...Object.keys(months).map((key) => Number(key.slice(0, 4))),
  ])].filter(Number.isFinite).sort((a, b) => a - b);
  return { month, ...normalizeMonth(raw), months, years };
}

function monthSnapshot(plan: MonthSnapshot): MonthSnapshot { return normalizeMonth(plan); }

function nextMonthSnapshot(plan: MonthSnapshot): MonthSnapshot {
  return { ...monthSnapshot(plan), transactions: [] };
}

function summarizeMonth(plan: MonthSnapshot) {
  const income = plan.incomes.reduce((sum, item) => sum + item.amount, 0);
  const allocated = plan.allocations.reduce((sum, item) => sum + item.amount, 0);
  const groups = plan.allocations.reduce<Record<string, number>>((all, item) => {
    all[item.group] = (all[item.group] || 0) + item.amount;
    return all;
  }, {});
  const spentGroups = plan.transactions.reduce<Record<string, number>>((all, transaction) => {
    const group = plan.allocations.find((item) => item.id === transaction.categoryId)?.group || "Lifestyle";
    all[group] = (all[group] || 0) + transaction.amount;
    return all;
  }, {});
  const spent = plan.transactions.reduce((sum, item) => sum + item.amount, 0);
  const protectedGroups = ["Giving", "Tax", "Home & bills", "Debt", "Goals", "Investing"];
  const remainingProtected = protectedGroups.reduce(
    (sum, group) => sum + Math.max(0, (groups[group] || 0) - (spentGroups[group] || 0)),
    0,
  );
  const debt = plan.debts.reduce((sum, item) => sum + item.balance, 0);
  const assets = plan.assets.reduce((sum, item) => sum + item.balance, 0);
  return {
    income,
    allocated,
    available: income - allocated,
    safeToSpend: income - spent - remainingProtected,
    groups,
    spentGroups,
    spent,
    debt,
    assets,
    netWorth: assets - debt,
  };
}
function freshPlan(): Plan { return structuredClone(initialPlan); }

const navItems = [
  ["dashboard", "⌂", "Dashboard"],
  ["budget", "▦", "Monthly budget"],
  ["calendar", "□", "Bills & calendar"],
  ["debt", "↘", "Debt planner"],
  ["goals", "◎", "Savings goals"],
  ["investing", "↗", "Investing"],
  ["activity", "≡", "Transactions"],
  ["worth", "◇", "Net worth"],
  ["learn", "i", "Saving & help"],
] as const;

const groupMeta: Record<string, { color: string; soft: string; icon: string }> = {
  Giving: { color: "#ef7a32", soft: "#fff0e6", icon: "♡" },
  Tax: { color: "#9b6ee0", soft: "#f1e9fb", icon: "%" },
  "Home & bills": { color: "#3aa7df", soft: "#e4f4fb", icon: "⌂" },
  Lifestyle: { color: "#d5be38", soft: "#f8f3d9", icon: "☕" },
  Debt: { color: "#ed4f34", soft: "#fde8e3", icon: "↔" },
  Goals: { color: "#39bf70", soft: "#e3f6ea", icon: "◎" },
  Investing: { color: "#079e90", soft: "#def3ef", icon: "↗" },
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
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
  const [selectedDashboardGroup, setSelectedDashboardGroup] = useState("Home & bills");
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const planRef = useRef(plan);
  const [transactionDraft, setTransactionDraft] = useState({
    date: "2026-08-01",
    description: "",
    categoryId: "misc",
    owner: "Jacobo",
    amount: 0,
  });
  const [billDraft, setBillDraft] = useState({
    name: "",
    categoryId: "subscriptions",
    amount: 0,
    dueDay: 1,
    frequency: "Monthly" as Bill["frequency"],
  });

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

  const totals = useMemo(() => summarizeMonth(plan), [plan]);

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
      totals: snapshot ? summarizeMonth(snapshot) : summarizeMonth(normalizeMonth()),
      hasData: Boolean(snapshot),
    };
  }), [dashboardYear, savedMonths]);

  const yearlyTotals = useMemo(() => {
    const activeMonths = yearlyMonths.filter((item) => item.hasData);
    const groups = Object.fromEntries(Object.keys(groupMeta).map((group) => [
      group,
      activeMonths.reduce((sum, item) => sum + (item.totals.groups[group] || 0), 0),
    ]));
    const spentGroups = Object.fromEntries(Object.keys(groupMeta).map((group) => [
      group,
      activeMonths.reduce((sum, item) => sum + (item.totals.spentGroups[group] || 0), 0),
    ]));
    const income = activeMonths.reduce((sum, item) => sum + item.totals.income, 0);
    const allocated = activeMonths.reduce((sum, item) => sum + item.totals.allocated, 0);
    const spent = activeMonths.reduce((sum, item) => sum + item.totals.spent, 0);
    const protectedGroups = ["Giving", "Tax", "Home & bills", "Debt", "Goals", "Investing"];
    const remainingProtected = protectedGroups.reduce(
      (sum, group) => sum + Math.max(0, (groups[group] || 0) - (spentGroups[group] || 0)),
      0,
    );
    const latest = [...activeMonths].reverse().find((item) => item.hasData)?.totals;
    return {
      income,
      allocated,
      available: income - allocated,
      safeToSpend: income - spent - remainingProtected,
      groups,
      spentGroups,
      spent,
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
  const subscriptionMonthly = plan.bills.filter((bill) => bill.categoryId === "subscriptions").reduce((sum, bill) => sum + (bill.frequency === "Annual" ? bill.amount / 12 : bill.amount), 0);
  const visibleBills = plan.bills.filter((bill) => bill.frequency === "Monthly" || bill.dueMonth === selectedMonth);
  const debtMonthly = plan.debts.reduce((sum, debt) => sum + debt.minimum + debt.extra, 0);
  const bucketPercent = plan.investmentBuckets.reduce((sum, bucket) => sum + bucket.percent, 0);

  const dashboardBudget = dashboardTotals.allocated || dashboardTotals.income;
  const dashboardPeriodLabel = dashboardView === "monthly" ? monthLabel : `${dashboardYear} YEAR`;
  const dashboardCategories = Object.keys(groupMeta).map((group) => ({
    group,
    budget: dashboardTotals.groups[group] || 0,
    spent: dashboardTotals.spentGroups[group] || 0,
  }));
  const selectedDashboardCategory = dashboardCategories.find((item) => item.group === selectedDashboardGroup) ?? dashboardCategories[0];
  const wheelWeightFloor = Math.max(dashboardCategories.reduce((sum, item) => sum + item.budget, 0) * 0.035, 1);
  const wheelWeightTotal = dashboardCategories.reduce((sum, item) => sum + Math.max(item.budget, wheelWeightFloor), 0);
  let wheelCursor = 0;
  const wheelSegments = dashboardCategories.map((item) => {
    const length = 350 * Math.max(item.budget, wheelWeightFloor) / wheelWeightTotal;
    const segment = { ...item, offset: wheelCursor, length: Math.max(8, length - 4) };
    wheelCursor += length;
    return segment;
  });

  function changeMonth(nextMonth: string) {
    if (!nextMonth || nextMonth === plan.month) return;
    setPlan((current) => {
      const months = { ...current.months, [current.month]: monthSnapshot(current) };
      const next = months[nextMonth] ? monthSnapshot(months[nextMonth]) : nextMonthSnapshot(current);
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

  function updateAllocation(id: string, amount: number) {
    setPlan((current) => {
      const matchingBills = current.bills.filter((bill) => bill.categoryId === id);
      const bills = matchingBills.length === 1
        ? current.bills.map((bill) => bill.id === matchingBills[0].id
          ? { ...bill, amount: bill.frequency === "Annual" ? amount * 12 : amount }
          : bill)
        : current.bills;
      return {
        ...current,
        bills,
        allocations: current.allocations.map((item) => item.id === id ? { ...item, amount } : item),
      };
    });
  }

  function updateBill(id: string, patch: Partial<Bill>) {
    setPlan((current) => {
      const previous = current.bills.find((bill) => bill.id === id);
      const bills = current.bills.map((bill) => (bill.id === id ? { ...bill, ...patch } : bill));
      const affected = new Set([previous?.categoryId, patch.categoryId].filter(Boolean));
      return {
        ...current,
        bills,
        allocations: current.allocations.map((item) => affected.has(item.id)
          ? { ...item, amount: bills.filter((bill) => bill.categoryId === item.id).reduce((sum, bill) => sum + (bill.frequency === "Annual" ? bill.amount / 12 : bill.amount), 0) }
          : item),
      };
    });
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
      ...(billDraft.frequency === "Annual" ? { dueMonth: selectedMonth } : {}),
    };
    setPlan((current) => {
      const bills = [...current.bills, bill];
      const categoryTotal = bills.filter((item) => item.categoryId === bill.categoryId).reduce((sum, item) => sum + (item.frequency === "Annual" ? item.amount / 12 : item.amount), 0);
      return {
        ...current,
        bills,
        allocations: current.allocations.map((item) => item.id === bill.categoryId ? { ...item, amount: categoryTotal } : item),
      };
    });
    setBillDraft({ name: "", categoryId: "subscriptions", amount: 0, dueDay: 1, frequency: "Monthly" });
    setNotice(`${bill.name} was added to ${monthLabel}.`);
  }

  function deleteBill(id: string) {
    setPlan((current) => {
      const removed = current.bills.find((bill) => bill.id === id);
      if (!removed) return current;
      const bills = current.bills.filter((bill) => bill.id !== id);
      const categoryTotal = bills.filter((bill) => bill.categoryId === removed.categoryId).reduce((sum, bill) => sum + (bill.frequency === "Annual" ? bill.amount / 12 : bill.amount), 0);
      return {
        ...current,
        bills,
        allocations: current.allocations.map((item) => item.id === removed.categoryId ? { ...item, amount: categoryTotal } : item),
      };
    });
  }

  function updateDebt(id: string, patch: Partial<Debt>) {
    setPlan((current) => {
      const debts = current.debts.map((debt) => (debt.id === id ? { ...debt, ...patch } : debt));
      return { ...current, debts, allocations: current.allocations.map((item) => {
        const linkedDebt = debts.find((debt) => debt.categoryId === item.id);
        return linkedDebt ? { ...item, amount: linkedDebt.minimum + linkedDebt.extra } : item;
      }) };
    });
  }

  function updateGoal(id: string, patch: Partial<Goal>) {
    setPlan((current) => {
      const goals = current.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal));
      const monthly = goals.reduce((sum, goal) => sum + goal.monthly, 0);
      return { ...current, goals, allocations: current.allocations.map((item) => item.id === "saving" ? { ...item, amount: monthly } : item) };
    });
  }

  function updateInvestmentMonthly(amount: number) {
    setPlan((current) => ({
      ...current,
      investmentMonthly: amount,
      allocations: current.allocations.map((item) => item.id === "stocks" ? { ...item, amount } : item),
    }));
  }

  function addTransaction() {
    if (!transactionDraft.description.trim() || transactionDraft.amount <= 0) return;
    setPlan((current) => ({
      ...current,
      transactions: [{ ...transactionDraft, id: `transaction-${Date.now()}` }, ...current.transactions],
    }));
    setTransactionDraft((current) => ({ ...current, description: "", amount: 0 }));
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
            <h1>{active === "dashboard" ? "Know what’s safe to spend." : navItems.find((item) => item[0] === active)?.[2]}</h1>
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
            <section className={dashboardTotals.safeToSpend < 0 ? "safe-spend-card danger" : "safe-spend-card"}>
              <div className="safe-card-heading">
                <div><p className="eyebrow">{dashboardPeriodLabel.toUpperCase()}</p><h2>Your most important number—at a glance.</h2></div>
                <button onClick={() => setActive("budget")}>{dashboardView === "monthly" ? "Edit this month" : "Open monthly plan"} →</button>
              </div>
              <div className="spend-overview">
                <div className="gauge-column">
                  <div className="category-wheel">
                    <svg viewBox="0 0 200 200" aria-label="Interactive budget category wheel">
                      <circle className="wheel-track" cx="100" cy="100" r="74" pathLength="464" strokeDasharray="350 114" transform="rotate(135 100 100)" />
                      {wheelSegments.map((segment) => (
                        <circle
                          aria-label={`${segment.group}: ${money.format(segment.spent)} spent of ${money.format(segment.budget)}`}
                          className={selectedDashboardCategory.group === segment.group ? "wheel-segment selected" : "wheel-segment"}
                          cx="100"
                          cy="100"
                          fill="none"
                          key={segment.group}
                          onClick={() => setSelectedDashboardGroup(segment.group)}
                          onFocus={() => setSelectedDashboardGroup(segment.group)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedDashboardGroup(segment.group); }}
                          onMouseEnter={() => setSelectedDashboardGroup(segment.group)}
                          pathLength="464"
                          r="74"
                          role="button"
                          stroke={groupMeta[segment.group].color}
                          strokeDasharray={`${segment.length} ${464 - segment.length}`}
                          strokeDashoffset={-segment.offset}
                          tabIndex={0}
                          transform="rotate(135 100 100)"
                        ><title>{segment.group}</title></circle>
                      ))}
                    </svg>
                    <div className="wheel-center" aria-live="polite">
                      <span>Safe to spend</span>
                      <strong>{money.format(dashboardTotals.safeToSpend)}</strong>
                      <small>{money.format(dashboardTotals.spent)} spent of {money.format(dashboardBudget)} planned</small>
                      <b style={{ color: groupMeta[selectedDashboardCategory.group].color }}>{groupMeta[selectedDashboardCategory.group].icon} {selectedDashboardCategory.group}</b>
                    </div>
                  </div>
                  <div className="wheel-key">{dashboardCategories.map(({ group }) => <button className={selectedDashboardCategory.group === group ? "active" : ""} style={{ "--category-color": groupMeta[group].color } as CSSProperties} key={group} onClick={() => setSelectedDashboardGroup(group)}><span>{groupMeta[group].icon}</span>{group}</button>)}</div>
                  <p>Every segment is live. Select one to highlight it; changing income, rent, bills, giving, tax, or transactions recalculates the wheel immediately.</p>
                </div>
                <div className="spending-categories">
                  <div className="spending-head"><span>Spending categories</span><span>Spent</span><span>Budget</span></div>
                  {dashboardCategories.map(({ group, budget, spent }) => {
                    const progress = budget ? Math.min(100, spent / budget * 100) : 0;
                    const rowClass = `${spent > budget && budget > 0 ? "spending-row over" : "spending-row"}${selectedDashboardCategory.group === group ? " selected" : ""}`;
                    return <button className={rowClass} key={group} onClick={() => setSelectedDashboardGroup(group)} onMouseEnter={() => setSelectedDashboardGroup(group)}>
                      <div className="spending-line"><span className="category-badge" style={{ color: groupMeta[group].color, background: groupMeta[group].soft }}>{groupMeta[group].icon}</span><strong>{group}</strong><b>{money.format(spent)}</b><span>/ {money.format(budget)}</span></div>
                      <div className="category-track"><span style={{ width: `${progress}%`, background: groupMeta[group].color }} /></div>
                    </button>;
                  })}
                </div>
              </div>
            </section>

            <section className="stat-grid">
              <article>
                <span className="stat-icon income">↓</span>
                <div><p>{dashboardView === "monthly" ? "Monthly income" : "Yearly income"}</p><strong>{money.format(dashboardTotals.income)}</strong></div>
                <button onClick={() => setActive("budget")}>Open</button>
              </article>
              <article>
                <span className="stat-icon planned">▦</span>
                <div><p>Planned outflow</p><strong>{money.format(dashboardTotals.allocated)}</strong></div>
                <small>{dashboardTotals.income ? `${Math.min(100, dashboardTotals.allocated / dashboardTotals.income * 100).toFixed(0)}% of income` : "Not planned yet"}</small>
              </article>
              <article>
                <span className="stat-icon invest">↗</span>
                <div><p>{dashboardView === "monthly" ? "Investing this month" : "Investing this year"}</p><strong>{money.format(dashboardTotals.groups.Investing || 0)}</strong></div>
                <button onClick={() => setActive("investing")}>Open</button>
              </article>
              <article>
                <span className="stat-icon worth">◇</span>
                <div><p>{dashboardView === "monthly" ? "Net worth" : "Latest net worth"}</p><strong>{money.format(dashboardTotals.netWorth)}</strong></div>
                <button onClick={() => setActive("worth")}>Open</button>
              </article>
            </section>

            {dashboardView === "yearly" ? (
              <section className="panel year-overview">
                <div className="panel-heading"><div><p className="eyebrow">JANUARY–DECEMBER</p><h2>{dashboardYear} month-by-month</h2></div><span className="live-pill">{yearlyTotals.monthsWithData} months saved</span></div>
                <div className="year-month-grid">{yearlyMonths.map((item) => {
                  const max = Math.max(item.totals.income, item.totals.allocated, item.totals.spent, 1);
                  return <button className={item.key === plan.month ? "year-month-card active" : "year-month-card"} key={item.key} onClick={() => { changeMonth(item.key); setDashboardView("monthly"); }}>
                    <div><strong>{item.label}</strong><span>{item.hasData ? money.format(item.totals.safeToSpend) : "Not started"}</span></div>
                    <div className="year-bars"><i style={{ width: `${item.totals.income / max * 100}%` }} /><i style={{ width: `${item.totals.allocated / max * 100}%` }} /><i style={{ width: `${item.totals.spent / max * 100}%` }} /></div>
                  </button>;
                })}</div>
                <div className="year-legend"><span><i className="income" /> Income</span><span><i className="planned" /> Planned</span><span><i className="spent" /> Spent</span></div>
              </section>
            ) : (
              <div className="dashboard-grid">
                <section className="panel month-details"><p className="eyebrow">THIS MONTH</p><h2>{monthLabel} snapshot</h2><div><span>Income</span><strong>{money.format(totals.income)}</strong><span>Spent</span><strong>{money.format(totals.spent)}</strong><span>Still unassigned</span><strong>{money.format(totals.available)}</strong></div></section>
                <aside className="panel next-panel"><p className="eyebrow">NEXT BEST MOVE</p><h2>{totals.income ? (totals.safeToSpend < 0 ? "Bring spending back on track." : "Keep your plan current.") : "Start with your income."}</h2><p>{totals.income ? (totals.safeToSpend < 0 ? `You are ${money.format(Math.abs(totals.safeToSpend))} beyond what is currently safe to spend.` : `You can safely spend ${money.format(totals.safeToSpend)} after the rest of your plan is protected.`) : "Enter each paycheck once. The balance and every dashboard total will update instantly."}</p><button className="secondary-button" onClick={() => setActive("budget")}>{totals.income ? "Review monthly plan" : "Add income"} <span>→</span></button></aside>
              </div>
            )}
          </div>
        )}

        {active === "budget" && (
          <div className="budget-page">
            <section className="budget-summary">
              <div><span>Income</span><strong>{money.format(totals.income)}</strong></div>
              <span className="summary-operator">−</span>
              <div><span>Planned</span><strong>{money.format(totals.allocated)}</strong></div>
              <span className="summary-operator">=</span>
              <div className={totals.available < 0 ? "negative" : "positive"}><span>Available</span><strong>{money.format(totals.available)}</strong></div>
            </section>

            <div className="budget-columns">
              <section className="panel input-panel">
                <div className="panel-heading"><div><p className="eyebrow">MONEY IN</p><h2>Income sources</h2></div><span className="live-pill">Live</span></div>
                <p className="section-note">Change an earning and the dashboard balance updates immediately.</p>
                <div className="input-list">
                  {plan.incomes.map((item) => (
                    <div className="input-row" key={item.id}>
                      <div><strong>{item.name}</strong><small>{item.owner}</small></div>
                      <CurrencyInput value={item.amount} onChange={(amount) => updateIncome(item.id, amount)} ariaLabel={`${item.name} monthly income`} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel category-panel">
                <div className="panel-heading"><div><p className="eyebrow">MONEY OUT</p><h2>Monthly plan</h2></div><strong>{money.format(totals.allocated)}</strong></div>
                <p className="section-note">Every amount is editable for this month—even rent and calendar-linked bills. Past months stay unchanged.</p>
                {Object.keys(groupMeta).map((group) => (
                  <div className="category-group" key={group}>
                    <div className="category-title" style={{ background: groupMeta[group].soft }}>
                      <span className="group-dot" style={{ background: groupMeta[group].color }} />
                      <strong>{group}</strong>
                      <span>{money.format(totals.groups[group] || 0)}</span>
                    </div>
                    {plan.allocations.filter((item) => item.group === group).map((item) => (
                      <div className="category-row" key={item.id}>
                        <span>
                          {item.name}
                          {item.linked && <button className="linked-label" onClick={() => setActive(item.linked!)}>Also shown in {item.linked === "calendar" ? "calendar" : item.linked} →</button>}
                        </span>
                        <CurrencyInput value={item.amount} onChange={(amount) => updateAllocation(item.id, amount)} ariaLabel={`${item.name} monthly allocation`} />
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            </div>
          </div>
        )}

        {active === "calendar" && (
          <div className="module-page">
            <section className="module-stats">
              <article><span>Monthly bill plan</span><strong>{money.format(monthlyBillTotal)}</strong><small>Rolls into the budget</small></article>
              <article><span>Subscriptions</span><strong>{money.format(subscriptionMonthly)}</strong><small>{plan.bills.filter((bill) => bill.categoryId === "subscriptions").length} items from your workbook</small></article>
              <article><span>Due this month</span><strong>{visibleBills.length}</strong><small>{monthLabel}</small></article>
            </section>
            <div className="module-grid calendar-layout">
              <section className="panel calendar-panel">
                <div className="panel-heading"><div><p className="eyebrow">PAYMENT CALENDAR</p><h2>{monthLabel}</h2></div><span className="live-pill">Budget linked</span></div>
                <div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
                <div className="calendar-grid">
                  {calendarDays.map((day, index) => {
                    const bills = day ? visibleBills.filter((bill) => bill.dueDay === day) : [];
                    return <div className={bills.length ? "calendar-day has-bill" : "calendar-day"} key={`${day}-${index}`}>
                      {day && <><span className="day-number">{day}</span>{bills.slice(0, 3).map((bill) => <button key={bill.id} onClick={() => document.getElementById(bill.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{bill.name}<small>{money.format(bill.amount)}</small></button>)}{bills.length > 3 && <small>+{bills.length - 3} more</small>}</>}
                    </div>;
                  })}
                </div>
              </section>
              <section className="panel bill-list-panel">
                <div className="panel-heading"><div><p className="eyebrow">RECURRING</p><h2>Bills & subscriptions</h2></div><span className="live-pill">Editable</span></div>
                <p className="section-note">Add a subscription or bill here. Changes apply to {monthLabel}; annual items appear in the selected month and contribute one-twelfth to the monthly plan.</p>
                <div className="recurring-form">
                  <label className="recurring-name"><span>Name</span><input value={billDraft.name} placeholder="New subscription" onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label><span>Category</span><select value={billDraft.categoryId} onChange={(event) => setBillDraft((current) => ({ ...current, categoryId: event.target.value }))}><option value="subscriptions">Subscriptions</option><option value="rent">Rent</option><option value="fpl">Electricity / FPL</option><option value="car-insurance">Car insurance</option></select></label>
                  <label><span>Frequency</span><select value={billDraft.frequency} onChange={(event) => setBillDraft((current) => ({ ...current, frequency: event.target.value as Bill["frequency"] }))}><option value="Monthly">Monthly</option><option value="Annual">Annual</option></select></label>
                  <label className="compact-field"><span>Due</span><input aria-label="New recurring expense due day" type="number" min="1" max="28" value={billDraft.dueDay} onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: Math.min(28, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
                  <CurrencyInput value={billDraft.amount} onChange={(amount) => setBillDraft((current) => ({ ...current, amount }))} ariaLabel="New recurring expense amount" />
                  <button className="add-recurring-button" onClick={addBill}>+ Add</button>
                </div>
                <div className="bill-list">
                  {plan.bills.map((bill) => <div className="bill-row" id={bill.id} key={bill.id}>
                    <div><strong>{bill.name}</strong><small>{plan.allocations.find((item) => item.id === bill.categoryId)?.name} · {bill.frequency}</small></div>
                    <label className="compact-field"><span>Due</span><input aria-label={`${bill.name} due day`} type="number" min="1" max="28" value={bill.dueDay} onChange={(event) => updateBill(bill.id, { dueDay: Math.min(28, Math.max(1, Number(event.target.value) || 1)) })} /></label>
                    <CurrencyInput value={bill.amount} onChange={(amount) => updateBill(bill.id, { amount })} ariaLabel={`${bill.name} amount`} />
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
            <div className="debt-grid">
              {plan.debts.map((debt) => {
                const months = payoffMonths(debt);
                const percent = totals.debt ? (debt.balance / totals.debt) * 100 : 0;
                return <section className="panel debt-card" key={debt.id}>
                  <div className="debt-card-head"><div><span className="debt-badge">{debt.name.slice(0, 2).toUpperCase()}</span><div><p>DEBT ACCOUNT</p><h2>{debt.name}</h2></div></div><strong>{money.format(debt.balance)}</strong></div>
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
            <section className="transaction-entry panel">
              <div className="panel-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Add a transaction</h2></div><span className="live-pill">Browser only</span></div>
              <div className="transaction-form">
                <label><span>Date</span><input type="date" value={transactionDraft.date} onChange={(event) => setTransactionDraft((current) => ({ ...current, date: event.target.value }))} /></label>
                <label className="description-field"><span>Description</span><input placeholder="Merchant or note" value={transactionDraft.description} onChange={(event) => setTransactionDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <label><span>Category</span><select value={transactionDraft.categoryId} onChange={(event) => setTransactionDraft((current) => ({ ...current, categoryId: event.target.value }))}>{plan.allocations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                <label><span>Who</span><select value={transactionDraft.owner} onChange={(event) => setTransactionDraft((current) => ({ ...current, owner: event.target.value }))}><option>Jacobo</option><option>Partner</option><option>Household</option></select></label>
                <label><span>Amount</span><CurrencyInput value={transactionDraft.amount} onChange={(amount) => setTransactionDraft((current) => ({ ...current, amount }))} ariaLabel="Transaction amount" /></label>
                <button className="primary-button" onClick={addTransaction}>Add transaction</button>
              </div>
            </section>
            <section className="module-stats transaction-stats">
              <article><span>Recorded spending</span><strong>{money.format(totals.spent)}</strong><small>{plan.transactions.length} transactions</small></article>
              <article><span>Planned spending</span><strong>{money.format(totals.allocated)}</strong><small>Includes saving and investing</small></article>
              <article><span>Plan remaining</span><strong>{money.format(totals.allocated - totals.spent)}</strong><small>Against recorded activity</small></article>
            </section>
            <section className="panel transaction-panel">
              <div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Household transactions</h2></div></div>
              {plan.transactions.length === 0 ? <div className="empty-state"><span>≡</span><h3>No transactions yet</h3><p>Add the first expense above. It will be saved on this device.</p></div> : <div className="transaction-table"><div className="transaction-head"><span>Date</span><span>Description</span><span>Category</span><span>Owner</span><span>Amount</span><span /></div>{plan.transactions.map((transaction) => <div className="transaction-row" key={transaction.id}><span>{transaction.date}</span><strong>{transaction.description}</strong><span>{plan.allocations.find((item) => item.id === transaction.categoryId)?.name}</span><span>{transaction.owner}</span><strong>{money.format(transaction.amount)}</strong><button aria-label={`Delete ${transaction.description}`} onClick={() => setPlan((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== transaction.id) }))}>×</button></div>)}</div>}
            </section>
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
                <article><span>1</span><strong>Enter or change an amount</strong><small>Add income, bills, debt, savings, or investing.</small></article><b>→</b>
                <article><span>2</span><strong>Your dashboard updates</strong><small>Connected balances and totals recalculate together.</small></article><b>→</b>
                <article><span>3</span><strong>Your device saves it</strong><small>Return with the same browser and device to continue.</small></article>
              </div>
            </section>
            <div className="learn-grid">
              <section className="panel explainer-card"><span className="explainer-icon">✓</span><p className="eyebrow">EVERYDAY USE</p><h2>Saving is automatic</h2><p>You do not need to download a new file after every change. Paycheck saves entries in this browser on this device.</p></section>
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
