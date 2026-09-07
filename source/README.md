# Paycheck Budget Planner

Paycheck is a local-first household budgeting Progressive Web App (PWA). It connects income, monthly budgets, bills, debt, savings goals, investing, transactions, net worth, and monthly/yearly dashboards without sending financial records to a shared application database.

It is **not a Chrome extension**. It is a website that can also be installed from Chrome or Edge and opened in its own app window. The same application can be run from the downloadable local ZIP.

## Data model

- IndexedDB stores independent household budgets in the current browser profile.
- Every month is saved separately. New months reuse the current budget structure and recurring settings, while starting with an empty transaction list.
- The yearly dashboard totals the saved months for the selected year.
- Previous/next arrows move one month at a time; the month field still supports direct selection.
- The dashboard leads with `total monthly income - actual spending - remaining known bills = projected monthly balance`.
- Income separates money already received from income still expected during the month.
- Actual spending is grouped into Groceries, Gas, Fast Food, Restaurants, Bills, Subscriptions, Car / Transportation, Personal, Shopping, Other / Uncategorized, Giving, and Tax.
- Monthly Plan is the only place category targets appear. Targets are optional and do not change actual spending or the projected balance.
- Monthly targets can change only the selected month or the selected month plus future months.
- Recurring bills and subscriptions can be added, edited, or removed from Calendar independently of optional Monthly Plan targets.
- An unpaid bill is included in the projection by default. Marking it paid moves the same amount into actual spending without double-counting it.
- Liabilities can be added or archived. Archiving removes them from the selected and future months without rewriting earlier monthly history.
- Transactions need only date, merchant, amount, category, and account/payment method.
- CSV statement import detects common bank columns, separates expenses from credits, skips duplicates, and routes unknown merchants to Review Needed.
- Built-in and user-created merchant rules categorize repeated purchases locally. No financial data is sent to an AI service.
- Monthly savings targets are optional, editable, and compared with the projected month-end balance without being published as part of the app.
- Money inputs accept a number or a simple expression such as `=1200+350`, `(100+25)*2`, or `$2,000/4`.
- A `.paycheck` export is a portable manual backup. Standard and password-protected backups are supported, and restore always creates a separate budget.
- There is no account system, bank connection, or automatic cloud sync in this version.

## Development

Requirements: Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Useful checks:

```sh
npm run lint
npm test
npm run build
```

The main product code is in `app/page.tsx`, `app/globals.css`, `app/local-store.ts`, `app/math-expression.ts`, and `app/backup.ts`. PWA files live in `public/`. Tests live in `tests/`.

## Build and deployment

- `npm run build` creates the Cloudflare Worker-compatible production output in `dist/`.
- `npm run deploy:cloudflare` deploys the source using `wrangler.selfhost.jsonc`.
- `npm run package:standalone` builds a ZIP containing the local server and production application.
- OpenAI is not required to develop, build, host, or use the application.

See [Self-hosting](docs/SELF-HOSTING.md), [Architecture](docs/ARCHITECTURE.md), and [Product requirements](docs/PRD.md) for the full maintenance notes.
