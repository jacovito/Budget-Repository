# Paycheck Budget Planner

Paycheck is a local-first household budgeting Progressive Web App (PWA). It connects income, monthly budgets, bills, debt, savings goals, investing, transactions, net worth, and monthly/yearly dashboards without sending financial records to a shared application database.

It is **not a Chrome extension**. It is a website that can also be installed from Chrome or Edge and opened in its own app window. The same application can be run from the downloadable local ZIP.

## Data model

- IndexedDB stores independent household budgets in the current browser profile.
- Every month is saved separately. New months reuse the current budget structure and recurring settings, while starting with an empty transaction list.
- The yearly dashboard totals the saved months for the selected year.
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

The main product code is in `app/page.tsx`, `app/globals.css`, `app/local-store.ts`, and `app/backup.ts`. PWA files live in `public/`. Tests live in `tests/`.

## Build and deployment

- `npm run build` creates the Cloudflare Worker-compatible production output in `dist/`.
- `npm run deploy:cloudflare` deploys the source using `wrangler.selfhost.jsonc`.
- `npm run package:standalone` builds a ZIP containing the local server and production application.
- OpenAI is not required to develop, build, host, or use the application.

See [Self-hosting](docs/SELF-HOSTING.md), [Architecture](docs/ARCHITECTURE.md), and [Product requirements](docs/PRD.md) for the full maintenance notes.
