export type MerchantRule = {
  id: string;
  pattern: string;
  categoryId: string;
};

export type StatementTransaction = {
  date: string;
  description: string;
  amount: number;
};

export type ImportAmountMode = "auto" | "negative" | "positive";

export const defaultMerchantRules: MerchantRule[] = [
  { id: "publix", pattern: "publix", categoryId: "groceries" },
  { id: "walmart-grocery", pattern: "walmart grocery", categoryId: "groceries" },
  { id: "walmart-neighborhood", pattern: "walmart neighborhood", categoryId: "groceries" },
  { id: "aldi", pattern: "aldi", categoryId: "groceries" },
  { id: "shell", pattern: "shell", categoryId: "gas" },
  { id: "chevron", pattern: "chevron", categoryId: "gas" },
  { id: "exxon", pattern: "exxon", categoryId: "gas" },
  { id: "chick-fil-a", pattern: "chick fil a", categoryId: "fast-food" },
  { id: "mcdonalds", pattern: "mcdonald", categoryId: "fast-food" },
  { id: "taco-bell", pattern: "taco bell", categoryId: "fast-food" },
  { id: "netflix", pattern: "netflix", categoryId: "subscriptions" },
  { id: "spotify", pattern: "spotify", categoryId: "subscriptions" },
  { id: "apple", pattern: "apple", categoryId: "subscriptions" },
  { id: "amazon", pattern: "amazon", categoryId: "shopping" },
  { id: "uber", pattern: "uber", categoryId: "car-transportation" },
  { id: "lyft", pattern: "lyft", categoryId: "car-transportation" },
];

export function normalizeMerchant(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function categorizeMerchant(description: string, customRules: MerchantRule[] = []) {
  const merchant = normalizeMerchant(description);
  const rule = [...customRules, ...defaultMerchantRules]
    .filter((item) => normalizeMerchant(item.pattern).length > 1)
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .find((item) => merchant.includes(normalizeMerchant(item.pattern)));
  return rule?.categoryId ?? "other-uncategorized";
}

export function suggestedMerchantPattern(description: string) {
  return normalizeMerchant(description)
    .replace(/\b(?:debit|credit|purchase|card|pos|online|payment|pending)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

export function transactionFingerprint(date: string, description: string, amount: number, account: string) {
  return [date, normalizeMerchant(description), amount.toFixed(2), normalizeMerchant(account)].join("|");
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.includes("-");
  const parsed = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function headerIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

export function parseStatementCsv(text: string, mode: ImportAmountMode = "auto") {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("This CSV does not contain transaction rows.");
  const headers = rows[0].map((header) => normalizeMerchant(header));
  const dateIndex = headerIndex(headers, ["transaction date", "posting date", "posted date", "date"]);
  const descriptionIndex = headerIndex(headers, ["description", "merchant", "payee", "details", "memo", "name"]);
  const debitIndex = headerIndex(headers, ["debit", "withdrawal", "withdrawals", "charge"]);
  const amountIndex = headerIndex(headers, ["amount"]);
  if (dateIndex < 0 || descriptionIndex < 0 || (debitIndex < 0 && amountIndex < 0)) {
    throw new Error("Could not find Date, Description, and Amount or Debit columns.");
  }

  const raw = rows.slice(1).map((columns) => ({
    date: normalizeDate(columns[dateIndex] ?? ""),
    description: (columns[descriptionIndex] ?? "").trim(),
    value: parseAmount(columns[debitIndex >= 0 ? debitIndex : amountIndex] ?? ""),
  })).filter((item) => item.date && item.description && item.value !== null && item.value !== 0);

  const positives = raw.filter((item) => (item.value ?? 0) > 0).length;
  const negatives = raw.filter((item) => (item.value ?? 0) < 0).length;
  const resolvedMode = debitIndex >= 0
    ? "positive"
    : mode === "auto"
      ? negatives > 0 ? "negative" : "positive"
      : mode;

  const transactions = raw
    .filter((item) => resolvedMode === "negative" ? (item.value ?? 0) < 0 : (item.value ?? 0) > 0)
    .map((item) => ({
      date: item.date!,
      description: item.description,
      amount: Math.abs(item.value!),
    }));

  return {
    transactions,
    detectedMode: resolvedMode as Exclude<ImportAmountMode, "auto">,
    skippedRows: rows.length - 1 - transactions.length,
    signSummary: { positives, negatives },
  };
}
