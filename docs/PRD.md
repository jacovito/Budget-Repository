# Paycheck Budget Planner — Product Requirements Document

**Status:** Version 1.0 deployment plan  
**Primary audience:** Jacobo and partner initially; later, any person or household using an independent local budget  
**Distribution:** Public installable web app plus downloadable local package  
**Data model:** Local-first; no shared financial database in version 1

## 1. Product summary

Paycheck is an interactive household budgeting application connecting monthly income, planned spending, bills, debt, savings goals, investing, transactions, and net worth. When a user changes an earning or linked financial amount, every affected dashboard total updates immediately.

The product must work without an OpenAI account and without sending financial information to a collective server. Each browser or locally installed copy stores its own information independently. Users can move a budget by exporting and restoring a `.paycheck` backup.

## 2. Problem statement

Spreadsheets can contain the right categories but are difficult to navigate, easy to break, and require manual synchronization. Many budgeting products require accounts, cloud storage, subscriptions, or bank access. Paycheck should provide a modern connected experience while preserving the privacy, portability, and ownership of a spreadsheet.

## 3. Goals

1. Connect all major household-budgeting tools to one monthly plan.
2. Keep financial information on the user's device by default.
3. Support independent users without server accounts.
4. Work offline after installation.
5. Provide an Excel-like portable save file through `.paycheck` export and restore.
6. Offer public and downloadable distributions without OpenAI hosting.
7. Keep initial operating cost at or near $0 per month.
8. Preserve a safe path to optional cloud synchronization.

## 4. Version 1 non-goals

- No shared financial database.
- No bank connection or automatic transaction importing.
- No mandatory account or subscription.
- No real-time collaboration between devices.
- No storage of backup encryption passwords.
- No tax, investment, lending, or financial advice.

## 5. Users

- **Household planner:** a person or couple planning a full paycheck, bills, goals, and available money.
- **Independent user:** a person opening the public application and receiving a blank workspace stored in their browser.
- **Local-package user:** a person downloading the ZIP and running Paycheck without internet or OpenAI.

## 6. Functional requirements

### Dashboard and budget

- Display income, assigned money, available money, investing, debt, and net worth.
- Recalculate immediately after related changes.
- Warn when allocations exceed income.
- Support multiple income sources and ownership labels.
- Organize allocations into giving/tax, home/bills, lifestyle, debt, goals, and investing.

### Bills and calendar

- Display monthly and annual recurring expenses.
- Convert annual expenses into monthly planning amounts.
- Update connected budget categories.

### Debt, savings, and investing

- Track balance, APR, minimum payment, extra payment, and estimated payoff.
- Add debt payments automatically to the monthly budget.
- Track savings balances, targets, dates, monthly contributions, and progress.
- Add savings contributions automatically to the Savings allocation.
- Allocate one monthly investing resource among configurable percentage buckets.
- Reflect investing on the dashboard and budget.

### Transactions and net worth

- Record transaction date, description, category, owner, and amount.
- Compare recorded with planned spending.
- Track cash, savings, business, crypto, investment, and property assets.
- Subtract debt balances controlled by the debt planner.

## 7. Local data and privacy

- Store financial data in IndexedDB under an independent local workspace ID.
- Store only the active-workspace pointer in localStorage.
- Do not transmit financial records to the application host.
- Explain that local workspaces organize information but are not password-protected OS accounts.
- Request persistent browser storage when supported.
- Continue operating offline.
- Warn users to export backups before clearing browser data or changing devices.

## 8. Backup requirements

- Download a workspace as a `.paycheck` file.
- Support readable standard and password-encrypted backups.
- Use Web Crypto with PBKDF2-SHA-256 and AES-256-GCM.
- Never store or upload passwords.
- Restore into a new workspace rather than overwriting existing data.
- Continue accepting the earlier JSON export format.

## 9. Distribution requirements

### Public web application

- Deploy from GitHub to Cloudflare.
- Use a public HTTPS URL requiring no OpenAI or ChatGPT account.
- Remain installable as a progressive web application.
- Host application files only; do not add a financial database.

### Downloadable local application

- Publish `Paycheck-Local-vX.Y.Z.zip` as a versioned release.
- Include the production application, local server, launchers, instructions, PRD, and SHA-256 checksum.
- Require only Node.js 22+; no OpenAI account, API key, npm installation, or internet after download.
- Serve through `localhost`; service workers should not use `file://` URLs.

## 10. Accessibility and quality

- Support current Chrome, Edge, Safari, and Firefox releases.
- Provide keyboard-accessible controls, visible focus, and accessible input labels.
- Maintain responsive desktop, tablet, and phone layouts.
- Respect reduced-motion preferences.
- Avoid relying on color alone for financial status.

## 11. Security

- Include no secrets or personal financial records in source or releases.
- Validate backup format before restore.
- Prevent path traversal in the local server.
- Bind local service only to `127.0.0.1`.
- Publish release checksums.
- Keep dependencies and Node.js updated.

## 12. Deployment phases

### Phase 1 — deployment-ready package

- Create the PRD and self-hosting guide.
- Add a tested local runner and launchers.
- Produce and verify `Paycheck-Local-v1.0.0.zip`.

### Phase 2 — independent source and downloads

- Create a GitHub repository and push reviewed source without secrets.
- Create a public GitHub v1.0.0 release with the ZIP and checksum.
- Confirm public download access.

### Phase 3 — public Cloudflare application

- Connect the repository to Cloudflare and deploy on the free tier.
- Verify HTTPS, installation, offline reopening, and local persistence.
- Publish the Cloudflare URL alongside the GitHub download.

### Phase 4 — optional cloud sync

- Add authentication and a versioned database only after cross-device demand is demonstrated.
- Keep IndexedDB as offline cache and `.paycheck` export as an exit path.
- Enforce household ownership and explicit conflict resolution.

## 13. Version 1 acceptance criteria

1. A person with no OpenAI account can open the public URL.
2. Two browsers can enter different values without sharing records.
3. Income, bills, debt, savings, and investing update the dashboard correctly.
4. Refresh and offline reopen preserve the local workspace.
5. Standard and encrypted backups round-trip correctly.
6. An incorrect password changes no saved information.
7. The ZIP starts on Windows, macOS, or Linux with Node.js 22+ and no npm installation.
8. The local service binds only to `127.0.0.1`.
9. The release includes a matching SHA-256 checksum.
10. GitHub download and Cloudflare application URLs are publicly reachable.

## 14. Success measures

- At least 95% of test users can start a budget without instructions.
- No server receives plan content in version 1.
- Backup and restore tests pass for every release.
- The application remains within free hosting allowances initially.
- Users can leave with both their data backup and application download.

## 15. Decision log

- Local-first storage remains the version 1 authority.
- Public hosting distributes code only.
- GitHub Releases is the initial independent download location.
- Cloudflare is the initial independent web host.
- Tauri desktop installers are deferred until platform-specific demand exists.
- Cloud accounts and financial aggregation are deferred beyond version 1.
