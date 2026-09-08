"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { backupNeedsPassword, createBackup, readBackup } from "./backup";
import { deleteProfile, listProfiles, loadPlan, putProfile, requestPersistentStorage, savePlan, type LocalProfile } from "./local-store";
import { evaluateMoneyExpression } from "./math-expression";
import { ActionDialog, Icon, PaidCheckbox, SpendingRing } from "./interface";
import {
  categorizeMerchant,
  defaultMerchantRules,
  parseStatementCsv,
  suggestedMerchantPattern,
  transactionFingerprint,
  type ImportAmountMode,
  type MerchantRule,
} from "./statement-import";

import {
  initialPlan, LEGACY_STORAGE_KEY, ACTIVE_PROFILE_KEY, spendingCategories,
  normalizePlan, normalizeMonth, freshPlan, monthSnapshot, nextMonthSnapshot, setExpectedOnSnapshot,
  summarizeMonth, billIsVisible, allocationSpendingCategory, canonicalSpendingCategory,
  reconcileBillTransactions, setBillPayment, patchBillInMonth,
  type Plan, type MonthSnapshot, type Bill, type Debt, type Goal, type Transaction,
  type Allocation, type ImportPreviewTransaction,
} from "./budget-model";

const navItems = [
  ["dashboard", "dashboard", "Overview"],
  ["activity", "activity", "Spending"],
  ["calendar", "calendar", "Bills & subscriptions"],
  ["budget", "budget", "Monthly plan"],
  ["goals", "goals", "Savings goals"],
  ["debt", "debt", "Debt planner"],
  ["investing", "investing", "Investing"],
  ["worth", "worth", "Net worth"],
  ["learn", "learn", "Saving & help"],
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
    <span className={disabled ? "money-input disabled" : "money-input"} title="You can enter a number or calculation, such as =1200+350">
      <span>$</span>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        type="text"
        disabled={disabled}
        value={draft}
        placeholder="0.00"
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
    </span>
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
    <span className="money-input actual-input" title="Enter the total actually spent, or a calculation such as =100+25">
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
    </span>
  );
}

function NumberInput({ value, onChange, ariaLabel, suffix }: { value: number; onChange: (next: number) => void; ariaLabel: string; suffix?: string }) {
  return (
    <span className="number-input">
      <input aria-label={ariaLabel} inputMode="decimal" min="0" type="number" value={value || ""} placeholder="0" onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} />
      {suffix && <span>{suffix}</span>}
    </span>
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
  const [dialog, setDialog] = useState<"transaction" | "import" | "income" | "more" | "bill" | null>(null);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [activityTab, setActivityTab] = useState<"all" | "review">("all");
  const [billTab, setBillTab] = useState<"unpaid" | "paid" | "all">("unpaid");
  const [billView, setBillView] = useState<"list" | "calendar">("list");
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [billEditScope, setBillEditScope] = useState<"month" | "future">("month");
  const [categoryDetail, setCategoryDetail] = useState<string | null>(null);
  const [allCategoriesVisible, setAllCategoriesVisible] = useState(false);
  const [undoBill, setUndoBill] = useState<{ month: string; bill: Bill; message: string } | null>(null);
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
  const filteredTransactions = plan.transactions
    .filter((transaction) => transactionCategoryFilter === "all" || canonicalSpendingCategory(transaction.categoryId) === transactionCategoryFilter)
    .filter((transaction) => activityTab !== "review" || transaction.reviewNeeded)
    .filter((transaction) => `${transaction.description} ${transaction.account || transaction.owner || ""}`.toLowerCase().includes(transactionSearch.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const sortedCategories = [...dashboardCategories].sort((a, b) => b.spent - a.spent);
  const shownCategories = allCategoriesVisible ? sortedCategories : sortedCategories.slice(0, 6);
  const unpaidBills = visibleBills.filter((bill) => !bill.paid).sort((a, b) => a.dueDay - b.dueDay);
  const paidBills = visibleBills.filter((bill) => bill.paid).sort((a, b) => a.dueDay - b.dueDay);
  const listedBills = billTab === "all" ? [...plan.bills].sort((a, b) => a.dueDay - b.dueDay) : billTab === "paid" ? paidBills : unpaidBills;
  const editingBill = plan.bills.find((bill) => bill.id === editingBillId);
  const detailCategory = spendingCategories.find((category) => category.id === categoryDetail);
  const categorySnapshots = dashboardView === "yearly" && active === "dashboard"
    ? yearlyMonths.filter((item) => item.hasData).map((item) => ({ month: item.key, snapshot: item.key === plan.month ? monthSnapshot(plan) : plan.months[item.key] }))
    : [{ month: plan.month, snapshot: monthSnapshot(plan) }];
  const detailEntries = categorySnapshots.flatMap(({ month, snapshot }) => [
    ...snapshot.transactions.filter((transaction) => canonicalSpendingCategory(transaction.categoryId) === categoryDetail).map((transaction) => ({ id: transaction.id, description: transaction.description, date: transaction.date, amount: transaction.amount, note: transaction.account || transaction.owner || "Transaction" })),
    ...snapshot.bills.filter((bill) => bill.paid && !bill.matchedTransactionId && billIsVisible(bill, month) && canonicalSpendingCategory(bill.categoryId) === categoryDetail).map((bill) => ({ id: `${month}-${bill.id}`, description: bill.name, date: `${month}-${String(Math.min(bill.dueDay, new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate())).padStart(2, "0")}`, amount: bill.paidAmount ?? bill.amount, note: "Paid bill" })),
    ...snapshot.allocations.filter((item) => allocationSpendingCategory(item) === categoryDetail && item.actual).map((item) => ({ id: `${month}-${item.id}`, description: "Unitemized spending", date: `${month}-01`, amount: item.actual || 0, note: "Category total entered manually" })),
  ]).sort((a, b) => b.date.localeCompare(a.date));

  function navigate(section: string) {
    setActive(section);
    setDialog(null);
    setCategoryDetail(null);
    window.scrollTo({ top: 0 });
  }

  function openBill(id: string | null) {
    setEditingBillId(id);
    setBillEditScope("month");
    setDialog("bill");
  }

  function editBill(patch: Partial<Bill>) {
    if (!editingBill) return;
    if (billEditScope === "future") updateBill(editingBill.id, patch);
    else updateBillForThisMonth(editingBill.id, {
      ...patch,
      ...(patch.amount !== undefined && editingBill.paid && !editingBill.matchedTransactionId ? { paidAmount: patch.amount } : {}),
    });
  }

  function billDueLabel(bill: Bill) {
    const month = bill.frequency === "Annual" ? bill.dueMonth || selectedMonth : selectedMonth;
    const day = Math.min(bill.dueDay, new Date(selectedYear, month, 0).getDate());
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(selectedYear, month - 1, day));
  }

  function renderBill(bill: Bill) {
    const category = spendingCategories.find((item) => item.id === canonicalSpendingCategory(bill.categoryId));
    return <article className={bill.paid ? "checklist-row is-paid" : "checklist-row"} id={bill.id} key={bill.id}>
      <PaidCheckbox name={bill.name} paid={Boolean(bill.paid)} onChange={() => toggleBillPaid(bill.id)} disabled={Boolean(bill.matchedTransactionId)} />
      <button className="bill-identity" onClick={() => openBill(bill.id)}><span className="category-icon" style={{ color: category?.color, background: category?.soft }}><Icon name={category?.id || "bills"} /></span><span><strong>{bill.name}</strong><small>{bill.paid ? (bill.matchedTransactionId ? "Matched payment" : "Paid") : `Due ${billDueLabel(bill)}`}<span className="bill-projection-label"> · {bill.paid ? "In actual spending" : bill.includedInProjection === false ? "Not in balance" : "In projected balance"}</span></small></span></button>
      <button className="bill-amount" aria-label={`Edit ${bill.name} amount`} onClick={() => openBill(bill.id)}>{money.format(bill.paid ? bill.paidAmount ?? bill.amount : bill.amount)}<Icon name="chevron" size={16} /></button>
    </article>;
  }

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
    setPlan((current) => ({ ...current, ...patchBillInMonth(current, id, patch) }));
  }

  function toggleBillPaid(id: string) {
    const bill = plan.bills.find((item) => item.id === id);
    if (!bill) return;
    if (bill.matchedTransactionId) { setNotice("This bill is matched to a transaction. Edit that transaction to change its payment."); return; }
    const message = `${bill.name} marked ${bill.paid ? "unpaid" : "paid"}.`;
    setUndoBill({ month: plan.month, bill: { ...bill }, message });
    setNotice(message);
    setPlan((current) => ({ ...current, ...setBillPayment(current, id, !bill.paid) }));
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
    setDialog(null);
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
    if (!transactionDraft.description.trim() || transactionDraft.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDraft.date)) { setNotice("Add a date, merchant, and amount first."); return; }
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
    setTransactionDraft((current) => ({ ...current, description: "", amount: 0, categoryId: "other-uncategorized" }));
    setDialog(null);
    setNotice(`Transaction added to ${transaction.date.slice(0, 7)}.`);
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
        const fingerprint = transactionFingerprint(transaction.date, transaction.description, transaction.amount, account.trim() || "Imported statement");
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
    if (file) await readStatementFile(file);
  }

  async function readStatementFile(file: File) {
    setImportPreview([]);
    setStatementText("");
    setStatementName("");
    if (file.size > 10 * 1024 * 1024) { setImportError("Choose a CSV smaller than 10 MB, or export a shorter date range."); return; }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Download a CSV statement from your bank or card account. PDF statements are not supported in the private local importer.");
      return;
    }
    try {
      const text = await file.text();
      setStatementText(text);
      setStatementName(file.name);
      setImportMode("auto");
      prepareStatement(text, "auto");
    } catch { setImportError("The file could not be read. Please choose it again."); }
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
    const importedMonths = [...new Set(readyTransactions.map((item) => item.date.slice(0, 7)))].sort();
    if (!importedMonths.includes(plan.month)) changeMonth(importedMonths[importedMonths.length - 1]);
    const reviewCount = readyTransactions.filter((item) => item.reviewNeeded).length;
    setDialog(null);
    setActive("activity");
    setActivityTab(reviewCount ? "review" : "all");
    setTransactionCategoryFilter("all");
    setTransactionSearch("");
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
    <a className="skip-link" href="#workspace">Skip to content</a>
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive("dashboard")}>
          <span className="brand-mark">P</span>
          <span>
            <strong>Paycheck</strong>
            <small>Your money, clearer</small>
          </span>
        </button>

        <nav aria-label="Primary navigation">
          <p className="nav-label">YOUR MONTH</p>
          {navItems.slice(0, 3).map(([id, icon, label]) => (
            <button
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              aria-current={active === id ? "page" : undefined}
              title={label}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} /><span className="nav-text">{label}</span>
            </button>
          ))}
          <p className="nav-label second">MORE TOOLS</p>
          {navItems.slice(3).map(([id, icon, label]) => (
            <button
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              aria-current={active === id ? "page" : undefined}
              title={label}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} /><span className="nav-text">{label}</span>
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

      <section className="workspace" id="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeProfile?.name || "MY HOUSEHOLD"}</p>
            <h1>{active === "dashboard" ? "Your month at a glance" : navItems.find((item) => item[0] === active)?.[2]}</h1>
          </div>
          <button className="mobile-settings icon-button" aria-label="Save and restore" onClick={() => setSettingsOpen(true)}><Icon name="lock" /></button>
        </header>
        {active !== "learn" && <div className="workspace-toolbar">
          {active === "dashboard" ? (
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
          ) : <MonthNavigator value={plan.month} onChange={changeMonth} />}
          <div className="quick-actions"><button className="button-secondary" onClick={() => setDialog("import")}><Icon name="upload" size={18} /><span>Import CSV</span></button><button className="button-primary" onClick={() => setDialog("transaction")}><Icon name="plus" size={18} /><span>Add spending</span></button></div>
        </div>}

        {active === "dashboard" && (
          <div className="dashboard">
            <div className="overview-grid">
              <section className={dashboardTotals.projectedBalance < 0 ? "month-balance negative" : "month-balance"}>
                <div className="balance-topline"><span><Icon name="worth" size={18} /> {dashboardView === "monthly" ? "Projected monthly balance" : "Projected yearly balance"}</span><span className="period-caption">{dashboardPeriodLabel}</span></div>
                <div className="balance-number" aria-live="polite"><strong>{money.format(dashboardTotals.projectedBalance)}</strong><span>{dashboardTotals.projectedBalance > 0 ? "Under income · money left over" : dashboardTotals.projectedBalance < 0 ? "Over income · overspent" : "Income and spending are balanced"}</span></div>
                <div className="money-path" aria-label="Projected balance calculation">
                  <button onClick={() => { if (dashboardView === "monthly") setDialog("income"); else navigate("budget"); }}><span>Total income</span><strong>{money.format(dashboardTotals.income)}</strong><small>{money.format(dashboardTotals.incomeReceived)} received<br />{money.format(dashboardTotals.expectedIncome)} expected</small></button><span aria-hidden="true">−</span>
                  <button onClick={() => navigate("activity")}><span>Actual spending</span><strong>{money.format(dashboardTotals.spent)}</strong><small>What has been spent</small></button><span aria-hidden="true">−</span>
                  <button onClick={() => navigate("calendar")}><span>Remaining bills</span><strong>{money.format(dashboardTotals.remainingBills)}</strong><small>Unpaid & included</small></button>
                </div>
                <div className="balance-footnote"><Icon name="learn" size={15} /><span>Based on entered income, recorded spending, and known bills.</span></div>
              </section>
              <section className="surface savings-focus">
                <div className="section-heading"><span className="section-icon"><Icon name="goals" /></span><h2>Room for savings</h2><button className="icon-button" aria-label="Edit monthly savings goals" onClick={() => navigate("budget")}><Icon name="more" /></button></div>
                <p className="savings-lead">{savingsTargetsConfigured ? "Your projected balance toward your goal" : "Give the money left over a purpose"}</p>
                <strong className="savings-amount">{money.format(projectedForSavings)}<small>projected, not yet saved</small></strong>
                <div className="savings-progress" role="progressbar" aria-label="Projected savings toward ideal goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(savingsProgress)}><span style={{ width: `${savingsProgress}%` }} />{idealSavingsTarget > 0 && <i style={{ left: `${Math.min(100, minimumSavingsTarget / idealSavingsTarget * 100)}%` }} />}</div>
                <div className="savings-labels"><span>Minimum<strong>{money.format(minimumSavingsTarget)}</strong></span><span>Ideal<strong>{money.format(idealSavingsTarget)}</strong></span></div>
                <div className="savings-guidance">{!savingsTargetsConfigured ? <button onClick={() => navigate("budget")}>Set your goals in Monthly Plan <Icon name="arrow" size={16} /></button> : targetMonths === 0 ? "Open a month to see your savings pace." : dashboardTotals.projectedBalance >= idealSavingsTarget ? <><Icon name="check" size={18} /> Your ideal goal is covered.</> : <>{money.format(Math.max(0, (dashboardTotals.projectedBalance >= minimumSavingsTarget ? idealSavingsTarget : minimumSavingsTarget) - dashboardTotals.projectedBalance))} to close the gap to your {dashboardTotals.projectedBalance >= minimumSavingsTarget ? "ideal" : "minimum"}.</>}</div>
              </section>
            </div>

            <div className="spending-bills-grid">
              <section className="surface spending-breakdown">
                <div className="section-heading"><div><p className="eyebrow">ACTUAL SPENDING SUMMARY</p><h2>Where your money went</h2></div><button className="text-button" onClick={() => navigate("activity")}>All spending <Icon name="arrow" size={16} /></button></div>
                <div className="spending-visual"><SpendingRing categories={dashboardCategories} total={dashboardTotals.spent} money={(amount) => money.format(amount)} onSelect={setCategoryDetail} /><div className="spending-summary-note"><span>{dashboardTotals.spent ? "Largest category" : "Make the first update"}</span><strong>{dashboardTotals.spent ? sortedCategories[0].name : "Import your spending"}</strong><p>{dashboardTotals.spent ? `${money.format(sortedCategories[0].spent)} · ${Math.round(sortedCategories[0].spent / dashboardTotals.spent * 100)}% of all spending` : "A bank CSV fills in the categories for you."}</p>{!dashboardTotals.spent && <button className="text-button" onClick={() => setDialog("import")}>Choose a file <Icon name="arrow" size={16} /></button>}</div></div>
                <div className="category-list">{shownCategories.map((category) => <button className="category-list-row" key={category.id} onClick={() => setCategoryDetail(category.id)}><span className="category-icon" style={{ color: category.color, background: category.soft }}><Icon name={category.id} /></span><span className="category-list-name"><strong>{category.name}</strong><span className="category-mini-track"><i style={{ width: `${dashboardTotals.spent ? category.spent / dashboardTotals.spent * 100 : 0}%`, background: category.color }} /></span></span><strong>{money.format(category.spent)}</strong><Icon name="chevron" size={16} /></button>)}</div>
                <button className="panel-footer-button" onClick={() => setAllCategoriesVisible((value) => !value)}>{allCategoriesVisible ? "Show fewer categories" : `Show all ${spendingCategories.length} categories`}</button>
              </section>
              <section className="surface bills-focus">
                <div className="section-heading"><div><p className="eyebrow">{dashboardView === "monthly" ? "REMAINING BILLS THIS MONTH" : "YEAR TO DATE"}</p><h2>{dashboardView === "monthly" ? "Your bill checklist" : "Monthly picture"}</h2></div><button className="icon-button" aria-label="Add a bill or subscription" onClick={() => openBill(null)}><Icon name="plus" /></button></div>
                {dashboardView === "monthly" ? <><div className="checklist-summary"><strong>{money.format(totals.remainingBills)}<small>left to pay</small></strong><span>{paidBills.length} of {visibleBills.length} paid</span></div>
                <div className="segmented-tabs" aria-label="Bills status"><button aria-pressed={billTab !== "paid"} className={billTab !== "paid" ? "active" : ""} onClick={() => setBillTab("unpaid")}>To pay <span>{unpaidBills.length}</span></button><button aria-pressed={billTab === "paid"} className={billTab === "paid" ? "active" : ""} onClick={() => setBillTab("paid")}>Paid <span>{paidBills.length}</span></button></div>
                <div className="checklist">{(billTab === "paid" ? paidBills : unpaidBills).slice(0, 6).map(renderBill)}</div>
                {(billTab === "paid" ? paidBills : unpaidBills).length === 0 && <div className="calm-empty"><Icon name="check" size={28} /><strong>{billTab === "paid" ? "No paid bills yet" : "Your checklist is clear"}</strong><p>{billTab === "paid" ? "Check a bill when you have paid it." : "Add a bill if something is still coming up."}</p></div>}
                <button className="panel-footer-button" onClick={() => navigate("calendar")}>Manage bills & subscriptions <Icon name="arrow" size={16} /></button></> : <><div className="checklist-summary"><strong>{yearlyTotals.monthsWithData}<small>months with data</small></strong></div><div className="year-totals"><span>Income received</span><strong>{money.format(yearlyTotals.incomeReceived)}</strong><span>Still expected</span><strong>{money.format(yearlyTotals.expectedIncome)}</strong><span>Actual spending</span><strong>{money.format(yearlyTotals.spent)}</strong><span>Unpaid bills</span><strong>{money.format(yearlyTotals.remainingBills)}</strong></div></>}
                {dashboardView === "monthly" && dashboardTotals.reviewNeeded > 0 && <button className="review-nudge" onClick={() => { navigate("activity"); setActivityTab("review"); }}><span className="review-nudge-icon"><Icon name="review" /></span><span><strong>{dashboardTotals.reviewNeeded} transactions need review</strong><small>A few categories need your help.</small></span><Icon name="chevron" size={16} /></button>}
              </section>
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
          <div className="module-page bills-page">
            <div className="page-summary"><div><p className="eyebrow">STILL COMING UP</p><h2>{money.format(totals.remainingBills)}</h2><p>{unpaidBills.length} unpaid bills · {paidBills.length} paid this month</p></div><button className="button-primary" onClick={() => openBill(null)}><Icon name="plus" size={18} /> Add bill or subscription</button></div>
            <div className="bill-workspace-controls"><div className="segmented-tabs" aria-label="Bills status">{([["unpaid", "To pay"], ["paid", "Paid"], ["all", "All recurring"]] as const).map(([id, label]) => <button key={id} className={billTab === id ? "active" : ""} aria-pressed={billTab === id} onClick={() => setBillTab(id)}>{label}</button>)}</div><div className="view-toggle" aria-label="Bills display"><button className={billView === "list" ? "active" : ""} aria-pressed={billView === "list"} onClick={() => setBillView("list")}><Icon name="activity" size={16} /> List</button><button className={billView === "calendar" ? "active" : ""} aria-pressed={billView === "calendar"} onClick={() => setBillView("calendar")}><Icon name="calendar" size={16} /> Calendar</button></div></div>
            {billView === "calendar" && <section className="surface calendar-panel"><div className="section-heading"><h2>{monthLabel}</h2><span className="muted">Tap a bill to edit</span></div><div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((day, index) => { const bills = day ? listedBills.filter((bill) => billIsVisible(bill, plan.month) && Math.min(bill.dueDay, new Date(selectedYear, selectedMonth, 0).getDate()) === day) : []; return <div className={bills.length ? "calendar-day has-bill" : "calendar-day"} key={`${day}-${index}`}>{day && <><span className="day-number">{day}</span>{bills.map((bill) => <button key={bill.id} aria-label={`${bill.name}, ${bill.paid ? "paid" : "unpaid"}, ${money.format(bill.amount)}, due ${billDueLabel(bill)}`} className={bill.paid ? "paid" : ""} onClick={() => openBill(bill.id)}>{bill.paid ? "✓ " : ""}{bill.name}<small>{money.format(bill.amount)}</small></button>)}</>}</div>; })}</div></section>}
            <section className="surface bill-agenda"><div className="section-heading"><h2>{billTab === "paid" ? "Paid this month" : billTab === "all" ? "Recurring bills & subscriptions" : "To pay this month"}</h2><span className="muted">{listedBills.length} items</span></div><div className="checklist">{listedBills.map(renderBill)}</div>{listedBills.length === 0 && <div className="calm-empty"><Icon name="calendar" size={32} /><strong>{billTab === "paid" ? "No bills marked paid" : "Nothing on this list"}</strong><p>Use the checkbox when you pay a bill, or add another recurring expense.</p></div>}</section>
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
            <section className="connection-note"><span>↔</span><div><strong>Debt details stay together</strong><p>Payment amounts are saved with your debt plan. Record a paid payment or add a known bill to include it in the monthly balance.</p></div></section>
          </div>
        )}

        {active === "goals" && (
          <div className="module-page">
            <section className="module-stats">
              <article><span>Saved toward goals</span><strong>{money.format(plan.goals.reduce((sum, goal) => sum + goal.current, 0))}</strong><small>Current balances</small></article>
              <article><span>Monthly contribution</span><strong>{money.format(plan.goals.reduce((sum, goal) => sum + goal.monthly, 0))}</strong><small>Optional contribution goal</small></article>
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
              <div><p className="eyebrow">MONTHLY RESOURCE</p><h2>Invest from the paycheck, on purpose.</h2><span>Set an optional contribution amount here. Planning an investment does not count it as actual spending.</span></div>
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
                {bucketPercent !== 100 && <p className="allocation-warning">Adjust the percentages to total 100% of the contribution amount.</p>}
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
          <div className="module-page spending-page">
            <div className="page-summary"><div><p className="eyebrow">ACTUAL SPENDING</p><h2>{money.format(totals.spent)}</h2><p>{plan.transactions.length} transactions, paid bills, and category totals</p></div><span className="local-summary"><Icon name="lock" size={16} /> Stored on this device</span></div>
            <button className="import-banner" onClick={() => setDialog("import")}><span className="import-banner-icon"><Icon name="upload" size={24} /></span><span><strong>Bring your spending into focus</strong><small>Import a bank CSV. Review only what needs your help.</small></span><span className="import-banner-action">Import statement <Icon name="arrow" size={18} /></span></button>
            <section className="surface spending-ledger">
              <div className="ledger-toolbar"><div className="segmented-tabs" aria-label="Transaction view"><button className={activityTab === "all" ? "active" : ""} aria-pressed={activityTab === "all"} onClick={() => setActivityTab("all")}>All transactions</button><button className={activityTab === "review" ? "active" : ""} aria-pressed={activityTab === "review"} onClick={() => setActivityTab("review")}>Review needed <span>{reviewTransactions.length}</span></button></div><span className="muted">{filteredTransactions.length} shown</span></div>
              <div className="ledger-filters"><label className="search-field"><Icon name="search" size={18} /><input aria-label="Search transactions" placeholder="Search merchant or account" value={transactionSearch} onChange={(event) => setTransactionSearch(event.target.value)} />{transactionSearch && <button className="icon-button" aria-label="Clear search" onClick={() => setTransactionSearch("")}><Icon name="close" size={16} /></button>}</label><select aria-label="Filter spending category" value={transactionCategoryFilter} onChange={(event) => setTransactionCategoryFilter(event.target.value)}><option value="all">All categories</option>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></div>
              {activityTab === "review" && reviewTransactions.length > 0 && <p className="review-help">Choose a category, then confirm. “Remember” also categorizes similar merchants next time.</p>}
              <div className="ledger-list">{filteredTransactions.map((transaction) => { const category = spendingCategories.find((item) => item.id === canonicalSpendingCategory(transaction.categoryId)); return <article className={transaction.reviewNeeded ? "ledger-item needs-review" : "ledger-item"} key={transaction.id}><div className="ledger-primary"><span className="category-icon" style={{ color: category?.color, background: category?.soft }}><Icon name={category?.id || "activity"} /></span><div className="ledger-merchant"><strong>{transaction.description}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${transaction.date}T12:00:00`))} · {transaction.account || transaction.owner || "Household"}{transaction.billId ? " · Matched bill" : ""}</small></div><strong className="ledger-amount">{money.format(transaction.amount)}</strong><button className="icon-button delete-transaction" aria-label={`Delete ${transaction.description}`} onClick={() => { if (window.confirm(`Delete ${transaction.description}? This removes ${money.format(transaction.amount)} from spending.`)) deleteTransaction(transaction.id); }}><Icon name="close" size={16} /></button></div><div className="ledger-secondary"><select aria-label={`Category for ${transaction.description}`} value={transaction.categoryId} onChange={(event) => updateTransactionCategory(transaction.id, event.target.value, false, transaction.reviewNeeded)}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{transaction.reviewNeeded ? <div className="review-actions"><button disabled={transaction.categoryId === "other-uncategorized"} onClick={() => updateTransactionCategory(transaction.id, transaction.categoryId)}><Icon name="check" size={16} /> Confirm</button><button disabled={transaction.categoryId === "other-uncategorized"} onClick={() => updateTransactionCategory(transaction.id, transaction.categoryId, true)}>Remember</button></div> : <span className="ledger-status"><Icon name="check" size={14} /> {transaction.source === "import" ? "Imported" : "Recorded"}</span>}</div></article>; })}</div>
              {filteredTransactions.length === 0 && <div className="calm-empty"><Icon name={activityTab === "review" ? "check" : "activity"} size={32} /><strong>{activityTab === "review" && !transactionSearch && transactionCategoryFilter === "all" ? "You’re all caught up" : "No transactions here"}</strong><p>{activityTab === "review" ? "Only items needing a category will appear here." : "Import a statement, add spending, or adjust your filters."}</p>{activityTab === "all" && !plan.transactions.length && <button className="button-primary" onClick={() => setDialog("import")}><Icon name="upload" size={18} /> Import CSV</button>}</div>}
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
                <p className="section-note">Update balances here to see what you own after debt.</p>
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
    <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.slice(0, 3).map(([id, icon, label]) => <button key={id} className={active === id ? "active" : ""} aria-current={active === id ? "page" : undefined} onClick={() => navigate(id)}><Icon name={icon} /><span>{id === "calendar" ? "Bills" : label}</span>{id === "activity" && reviewTransactions.length > 0 && <b>{reviewTransactions.length}</b>}</button>)}<button className={!navItems.slice(0, 3).some(([id]) => id === active) ? "active" : ""} onClick={() => setDialog("more")}><Icon name="more" /><span>More</span></button></nav>
    <ActionDialog open={dialog === "more"} onClose={() => setDialog(null)} title="More tools"><div className="more-tools">{navItems.slice(3).map(([id, icon, label]) => <button key={id} onClick={() => navigate(id)}><Icon name={icon} /><span>{label}</span><Icon name="chevron" size={16} /></button>)}<button onClick={() => { setDialog(null); setSettingsOpen(true); }}><Icon name="lock" /><span>Save & restore</span><Icon name="chevron" size={16} /></button></div></ActionDialog>
    <ActionDialog notice={notice} open={dialog === "transaction"} onClose={() => setDialog(null)} title="Add spending" subtitle="A quick entry for a purchase or expense.">
              <div className="transaction-form">
                <label><span>Date</span><input type="date" value={transactionDraft.date} onChange={(event) => setTransactionDraft((current) => ({ ...current, date: event.target.value }))} /></label>
                <label className="description-field"><span>Description / merchant</span><input placeholder="Example: Publix" value={transactionDraft.description} onBlur={() => setTransactionDraft((current) => current.categoryId === "other-uncategorized" ? { ...current, categoryId: categorizeMerchant(current.description, plan.merchantRules) } : current)} onChange={(event) => setTransactionDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <label><span>Category</span><select value={transactionDraft.categoryId} onChange={(event) => setTransactionDraft((current) => ({ ...current, categoryId: event.target.value }))}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                <label><span>Account</span><input value={transactionDraft.account} placeholder="Checking" onChange={(event) => setTransactionDraft((current) => ({ ...current, account: event.target.value }))} /></label>
                <label><span>Amount</span><CurrencyInput value={transactionDraft.amount} onChange={(amount) => setTransactionDraft((current) => ({ ...current, amount }))} ariaLabel="Transaction amount" /></label>
                <button className="primary-button" onClick={addTransaction}>Add transaction</button>
              </div>

    </ActionDialog>
    <ActionDialog open={dialog === "import"} onClose={() => setDialog(null)} title="Import your spending" subtitle="Your file stays on this device." wide>
            <section className="statement-import-panel">
              <div className="import-steps"><span className={!statementText ? "active" : ""}>1. Choose file</span><span className={statementText ? "active" : ""}>2. Check & import</span></div>
              <p className="section-note">Download a CSV from your bank or card account. Choose the account below so repeat imports can be recognized.</p><button className="import-dropzone" onClick={() => statementInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void readStatementFile(file); }}><Icon name="upload" size={30} /><strong>{statementName || "Drop a CSV here, or choose a file"}</strong><span>CSV only · up to 10 MB · processed on your device</span></button>
              <div className="statement-actions">
                <button className="primary-button" onClick={() => statementInputRef.current?.click()}>Upload CSV statement</button>
                <input ref={statementInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={handleStatementFile} />
                <label><span>Account or payment method</span><input value={importAccount} placeholder="Checking or Visa" onChange={(event) => { setImportAccount(event.target.value); if (statementText) prepareStatement(statementText, importMode, event.target.value); }} /></label>
                {statementText && <label><span>Charges appear as</span><select value={importMode} onChange={(event) => { const mode = event.target.value as ImportAmountMode; setImportMode(mode); prepareStatement(statementText, mode); }}><option value="negative">Negative amounts</option><option value="positive">Positive amounts</option></select></label>}
              </div>
              {importError && <p className="import-error">{importError}</p>}
              {importPreview.length > 0 && <div className="import-preview">
                <div className="import-preview-heading"><div><strong>{statementName}</strong><small>{importPreview.filter((item) => !item.duplicate).length} new · {importPreview.filter((item) => item.duplicate).length} duplicate · {importPreview.filter((item) => item.reviewNeeded && !item.duplicate).length} need review</small></div><button className="primary-button" onClick={importStatementTransactions}>Import new transactions</button></div>
                <div className="import-preview-list">{importPreview.map((item) => <div className={item.duplicate ? "import-preview-row duplicate" : "import-preview-row"} key={item.id}>
                  <span>{item.date}</span><strong>{item.description}</strong><b>{money.format(item.amount)}</b>
                  <select aria-label={`Category for ${item.description}`} value={item.categoryId} disabled={item.duplicate} onChange={(event) => setImportPreview((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, categoryId: event.target.value, reviewNeeded: event.target.value === "other-uncategorized" } : candidate))}>{spendingCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
                  <small>{item.duplicate ? "Already imported" : item.reviewNeeded ? "Review needed" : "Ready"}</small>
                </div>)}</div>

              </div>}
            </section>


    </ActionDialog>
    <ActionDialog open={dialog === "income"} onClose={() => setDialog(null)} title="Monthly income" subtitle={monthLabel}>
      <div className="income-detail-total"><span>Total monthly income</span><strong>{money.format(totals.income)}</strong></div>
      <div className="income-editor">{plan.incomes.map((income) => <section key={income.id}><h3>{income.name}<small>{income.owner}</small></h3><div className="form-pair"><label><span>Received</span><CurrencyInput value={income.amount} onChange={(amount) => updateIncome(income.id, amount)} ariaLabel={`${income.name} received`} /></label><label><span>Still expected</span><CurrencyInput value={income.expectedRemaining || 0} onChange={(amount) => updateExpectedIncome(income.id, amount)} ariaLabel={`${income.name} still expected`} /></label></div></section>)}</div><button className="button-primary dialog-done" onClick={() => setDialog(null)}>Done</button>
    </ActionDialog>
    <ActionDialog notice={notice} open={dialog === "bill"} onClose={() => setDialog(null)} title={editingBill ? editingBill.name : "Add a bill or subscription"} subtitle={editingBill ? "Changes save as you go." : "Set it up once, then check it off each month."}>
      {editingBill ? <div className="bill-editor"><div className="bill-edit-status"><PaidCheckbox name={editingBill.name} paid={Boolean(editingBill.paid)} disabled={Boolean(editingBill.matchedTransactionId)} onChange={() => toggleBillPaid(editingBill.id)} /><strong>{editingBill.paid ? "Paid" : "Not paid yet"}</strong><span>{editingBill.matchedTransactionId ? "Matched to a transaction" : monthLabel}</span></div><div className="field-label">Apply detail changes to</div><div className="segmented-tabs"><button className={billEditScope === "month" ? "active" : ""} aria-pressed={billEditScope === "month"} onClick={() => setBillEditScope("month")}>This month only</button><button className={billEditScope === "future" ? "active" : ""} aria-pressed={billEditScope === "future"} onClick={() => setBillEditScope("future")}>This & future months</button></div><div className="form-pair"><label><span>Amount</span><CurrencyInput value={editingBill.amount} disabled={Boolean(editingBill.matchedTransactionId)} onChange={(amount) => editBill({ amount })} ariaLabel={`${editingBill.name} amount`} /></label><label><span>Due day</span><input aria-label={`${editingBill.name} due day`} type="number" min="1" max="31" value={editingBill.dueDay} onChange={(event) => editBill({ dueDay: Math.max(1, Math.min(31, Number(event.target.value) || 1)) })} /></label></div><label><span>Category</span><select value={editingBill.categoryId} disabled={Boolean(editingBill.matchedTransactionId)} onChange={(event) => editBill({ categoryId: event.target.value })}>{spendingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><div className="form-pair"><label><span>Repeats</span><select value={editingBill.frequency} onChange={(event) => editBill({ frequency: event.target.value as Bill["frequency"], dueMonth: selectedMonth })}><option>Monthly</option><option>Annual</option></select></label>{editingBill.frequency === "Annual" && <label><span>Due month</span><select value={editingBill.dueMonth || selectedMonth} onChange={(event) => editBill({ dueMonth: Number(event.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2026, i, 1))}</option>)}</select></label>}</div>{!editingBill.paid && <label className="include-balance"><input type="checkbox" checked={editingBill.includedInProjection !== false} onChange={() => toggleBillProjection(editingBill.id)} /><span>Include in this month’s projected balance</span></label>}<div className="dialog-footer"><button className="text-danger" onClick={() => { if (window.confirm(`Remove ${editingBill.name} from this and future months? Earlier months are kept.`)) { deleteBill(editingBill.id); setDialog(null); } }}>Remove recurring bill</button><button className="button-primary" onClick={() => setDialog(null)}>Done</button></div></div> : <div className="bill-editor"><label><span>Bill or subscription name</span><input value={billDraft.name} placeholder="Rent, electricity, Netflix…" onChange={(event) => setBillDraft((current) => ({ ...current, name: event.target.value }))} /></label><div className="form-pair"><label><span>Amount</span><CurrencyInput value={billDraft.amount} onChange={(amount) => setBillDraft((current) => ({ ...current, amount }))} ariaLabel="New recurring expense amount" /></label><label><span>Due day</span><input aria-label="New recurring expense due day" type="number" min="1" max="31" value={billDraft.dueDay} onChange={(event) => setBillDraft((current) => ({ ...current, dueDay: Math.max(1, Math.min(31, Number(event.target.value) || 1)) }))} /></label></div><div className="form-pair"><label><span>Category</span><select value={billDraft.categoryId} onChange={(event) => setBillDraft((current) => ({ ...current, categoryId: event.target.value }))}>{spendingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>Repeats</span><select value={billDraft.frequency} onChange={(event) => setBillDraft((current) => ({ ...current, frequency: event.target.value as Bill["frequency"] }))}><option>Monthly</option><option>Annual</option></select></label></div>{billDraft.frequency === "Annual" && <p className="section-note">Due in {monthLabel.split(" ")[0]} each year. You can change the month after adding it.</p>}<button className="button-primary dialog-done" onClick={addBill}>Add bill</button></div>}
    </ActionDialog>
    <ActionDialog open={Boolean(detailCategory)} onClose={() => setCategoryDetail(null)} title={detailCategory?.name || "Spending category"} subtitle={dashboardView === "yearly" && active === "dashboard" ? String(dashboardYear) : monthLabel}>
      <div className="category-detail-total"><span>Actual spending</span><strong>{money.format(detailEntries.reduce((sum, item) => sum + item.amount, 0))}</strong></div><div className="category-detail-list">{detailEntries.map((item) => <article key={item.id}><span><strong>{item.description}</strong><small>{item.date} · {item.note}</small></span><b>{money.format(item.amount)}</b></article>)}</div>{detailEntries.length === 0 && <div className="calm-empty"><Icon name={detailCategory?.id || "activity"} size={32} /><strong>No spending in this category yet</strong><p>Import a statement or add an expense to start.</p></div>}<button className="button-primary dialog-done" onClick={() => { setTransactionDraft((current) => ({ ...current, categoryId: detailCategory?.id || "other-uncategorized" })); setCategoryDetail(null); setDialog("transaction"); }}><Icon name="plus" size={18} /> Add spending</button>
    </ActionDialog>
    {notice && <div className="app-notice" role="status">{notice}{undoBill && notice === undoBill.message && undoBill.month === plan.month && <button className="undo-button" onClick={() => { updateBillForThisMonth(undoBill.bill.id, undoBill.bill); setUndoBill(null); setNotice("Payment change undone."); }}>Undo</button>}<button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
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
