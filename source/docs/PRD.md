# Paycheck Budget Planner — Product Requirements Document

**Status:** Version 2.0 — actual spending and monthly balance
**Primary audience:** Any person or household using an independent local budget
**Distribution:** Public installable web app plus downloadable local package
**Data model:** Local-first; no shared financial database in version 1

## 1. Product summary

Paycheck is an actual-spending-first household budgeting application connecting monthly income, transactions, remaining bills, optional targets, debt, savings goals, investing, and net worth. When a user changes income, imports spending, or marks a bill paid, every affected dashboard total updates immediately.

The product must work without an OpenAI account and without sending financial information to a collective server. Each browser or locally installed copy stores its own information independently. Users can move a budget by exporting and restoring a `.paycheck` backup.

## Product direction change (September 2026)

This version supersedes v1's emphasis on planned spending, assigned money, and planned-versus-recorded comparison. The primary question is: **What has been spent, which bills are still coming, and will the month finish above or below income?** This is a change in product behavior and requirements, not a rearrangement of dashboard cards.

Category targets remain optional in Monthly Plan. They do not create spending or reduce the projected balance. Debt balances, investment plans, and savings targets likewise never become actual spending merely because they have been entered.

The former exclusion of automatic transaction importing is narrowed: **user-initiated CSV import and local merchant categorization are in scope**. Live bank connections, bank credentials, server-side statement processing, and cloud financial storage remain out of scope. PDF or AI-assisted extraction is a possible future capability requiring a separate design decision; it is not implied by adding CSV import.

## 2. Problem statement

Spreadsheets can contain the right categories but are difficult to navigate, easy to break, and require manual synchronization. Many budgeting products require accounts, cloud storage, subscriptions, or bank access. Paycheck should provide a modern connected experience while preserving the privacy, portability, and ownership of a spreadsheet.

## 3. Goals

1. Make actual spending, unpaid bills, and the projected monthly balance understandable at a glance.
2. Keep financial information on the user's device by default.
3. Support independent users without server accounts.
4. Work offline after installation.
5. Provide an Excel-like portable save file through `.paycheck` export and restore.
6. Offer public and downloadable distributions without OpenAI hosting.
7. Keep initial operating cost at or near $0 per month.
8. Preserve a safe path to optional cloud synchronization.

## 4. Version 1 non-goals

- No shared financial database.
- No live bank connection or credential storage.
- No mandatory account or subscription.
- No real-time collaboration between devices.
- No storage of backup encryption passwords.
- No tax, investment, lending, or financial advice.

## 5. Users

- **Household planner:** a person or couple tracking spending, checking bills paid, and protecting a monthly savings goal.
- **Independent user:** a person opening the public application and receiving a blank workspace stored in their browser.
- **Local-package user:** a person downloading the ZIP and running Paycheck without internet or OpenAI.

## 6. Functional requirements

### Dashboard and monthly plan

- Display income received, income still expected, actual spending, remaining bills, and projected monthly balance.
- Calculate `income - actual spending - remaining bills = projected balance`.
- Label a positive balance as under income/money left over and a negative balance as over income/overspent.
- Recalculate immediately after related changes.
- Support multiple income sources and ownership labels.
- Keep optional category targets in one Monthly Plan area rather than throughout the dashboard.
- Compare the projection with editable minimum and ideal monthly savings targets.

### Daily interaction and responsive design

- Desktop: persistent navigation, a compact period toolbar, a balance summary, actual-spending breakdown, and bill checklist.
- Phone: four labeled tabs (Overview, Spending, Bills, More), vertically stacked content, visible merchant/date/account information, and action sheets for entry.
- Provide a spending ring and category rows using actual amounts only; either opens itemized category detail, including paid bills and direct category totals.
- Make income, statement import, and spending entry available without traversing the planning tools.
- Search spending by merchant/account and filter by category or Review Needed.
- A review queue supports confirming a category and remembering the merchant rule locally.
- CSV import supports file selection and desktop drag/drop, followed by a review step with a full transaction preview.

### Bills and calendar

- Display monthly and annual recurring expenses.
- Track paid/unpaid status and whether each unpaid bill is included in the projection.
- Move paid bills into actual spending without double-counting them.
- Use a real checkbox for paid/unpaid status and offer Undo for manual status changes.
- Offer To pay, Paid, and All recurring lists, plus a calendar view.
- Put amount, due date, frequency, category, and inclusion controls in an edit panel rather than on every list row.
- Detail edits can apply to this month only or this and future months. Payment status and projection inclusion stay month-specific.
- Linked imported payments remain counted once. Clear their recorded transaction before resetting paid status.
- New months clear payment links and paid states, and keep the recurring schedule.

### Debt, savings, and investing

- Track balance, APR, minimum payment, extra payment, and estimated payoff.
- Keep minimum and extra payment details in the debt planner. They enter the projection only through recorded spending or a known unpaid bill.
- Track savings balances, targets, dates, monthly contributions, and progress.
- Keep contribution goals distinct from money already saved.
- Allocate one monthly investing resource among configurable percentage buckets.
- Keep investment planning separate from the monthly actual-spending calculation.

### Transactions, imports, and net worth

- Record transaction date, description, amount, category, and account/payment method.
- Import common bank and credit-card CSV exports locally.
- Apply built-in and user-created merchant rules, prevent duplicates, and collect unmatched items in Review Needed.
- Keep Groceries, Gas, Fast Food, Restaurants, Bills, Subscriptions, Car / Transportation, Personal, Shopping, Other / Uncategorized, Giving, and Tax separate.
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

## 13. Current acceptance criteria

1. A person with no OpenAI account can open the public URL.
2. Two browsers can enter different values without sharing records.
3. Income, actual spending, and unpaid included bills produce the same projected balance in monthly and yearly views; optional plans do not change that formula.
4. Refresh and offline reopen preserve the local workspace.
5. Standard and encrypted backups round-trip correctly.
6. An incorrect password changes no saved information.
7. The ZIP starts on Windows, macOS, or Linux with Node.js 22+ and no npm installation.
8. The local service binds only to `127.0.0.1`.
9. The release includes a matching SHA-256 checksum.
10. GitHub download and Cloudflare application URLs are publicly reachable.

11. Checking a bill paid moves the amount from remaining bills to actual spending without changing the projection; Undo restores the prior state.
12. Matching an imported payment to a bill never counts the payment twice, and a new month clears the previous payment link.
13. Local CSV imports group spending by date/month, detect repeat imports, and expose unrecognized merchants for review.
14. Desktop and phone layouts preserve essential transaction details and primary actions, with keyboard-accessible dialogs and reduced-motion support.
15. Category drilldowns reconcile to the displayed total, including unitemized amounts and manually paid bills.

## 14. Success measures

- At least 95% of test users can start a budget without instructions.
- No server receives plan content in version 1.
- Backup and restore tests pass for every release.
- The application remains within free hosting allowances initially.
- Users can leave with both their data backup and application download.

## 15. Decision log

- Actual spending and projected monthly balance supersede the original planning-led philosophy.
- Local-first storage remains the authority.
- User-selected CSV imports are permitted; they do not introduce bank access or cloud finance storage.
- Public hosting distributes code only.
- GitHub Releases is the initial independent download location.
- Cloudflare is the initial independent web host.
- Tauri desktop installers are deferred until platform-specific demand exists.
- Cloud accounts and financial aggregation are deferred beyond version 1.
