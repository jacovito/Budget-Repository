# Paycheck architecture and expansion guide

Paycheck is a **local-first progressive web app (PWA)**. The hosted website contains application code; each person’s financial data stays in that person’s browser.

## Current design

1. React renders the interface and calculates every view from one connected `Plan`, so an income, bill, debt, goal, or investment change immediately updates the dashboard.
2. IndexedDB stores independent profiles and plans. `localStorage` holds only the last-opened profile ID; an older `paycheck-plan-v1` record is migrated once and removed only after the new write succeeds.
3. A web manifest makes the site installable, while the service worker caches the application shell for offline reopening.
4. A portable `.paycheck` file acts like an Excel save file. Restore is non-destructive and creates a new workspace.
5. Each saved month has its own snapshot. The active month remains the editable view, while earlier snapshots feed the yearly dashboard. The plan records every added year so people can move between multiple years without replacing earlier data.

Local profiles organize records on one browser; they are not password-protected user accounts. Anyone with access to the same operating-system/browser profile may be able to open them. Users should export backups before clearing browser data or replacing a device.

## Connected calculations

- `available = income - allocations`.
- Recurring bills update linked budget categories. Users may still override a category in Monthly Budget for the selected month.
- Giving and Tax are separate protected categories throughout monthly and yearly calculations.
- Calendar supports monthly and annual recurring expenses. Annual expenses contribute one-twelfth of their amount to the monthly plan and remain identified by their selected due month.
- Debt minimum and extra payments update linked debt allocations.
- Goal contributions update Savings.
- Monthly investing updates Stocks & investing.
- Assets minus connected debt produce net worth.
- `safe to spend = income - recorded spending - remaining protected allocations` for bills, giving, tax, debt, goals, and investing.
- Yearly totals aggregate only months that have been opened and saved in the selected year; the latest saved month supplies the year-end net-worth snapshot.

The dashboard category wheel is a visualization of these same derived values, not a second data store. Clicking a wheel segment or category row changes the highlighted detail without changing the budget.

Money inputs pass through `app/math-expression.ts`. Its small arithmetic parser supports decimal numbers, currency separators, parentheses, and `+`, `-`, `*`, `/`; it does not execute JavaScript or arbitrary formulas.

Do not create duplicate totals that users must synchronize manually. Add a field once, then derive every view that consumes it.

## Backup security

Standard backups are readable JSON with a format and schema version. Encrypted backups use the browser Web Crypto implementation: PBKDF2-SHA-256 with 250,000 iterations and a random salt derives an AES-256-GCM key; a random initialization vector is used for authenticated encryption. The password is never saved or uploaded, so a lost password cannot be recovered.

## Costs

This release needs only static/PWA hosting and fits on many free tiers. IndexedDB and PWA installation have no fee. A custom domain is optional and usually has an annual registration cost. Costs appear when adding authentication, cloud databases, bank-data connections, messages, monitoring, and support.

## Cloud expansion path

### Phase 1 — local-first

Keep IndexedDB as the source of truth. Test backup/restore and learn which features people use.

### Phase 2 — optional account and sync

Add a cloud adapter rather than replacing the interface. A practical model includes users, households/memberships, versioned plans, devices, and audit/recovery records. Every server query must enforce ownership or household membership.

Keep IndexedDB as the offline cache. Push changes with an expected revision; if local and server revisions differ, apply explicit merge rules or let the user choose. Never silently overwrite.

### Phase 3 — household collaboration

Add invitations and owner/editor/viewer roles. Record who changed what and when. Clear conflict and undo behavior matter more than instant updates.

### Phase 4 — bank connections and notifications

Keep bank tokens on the server, never in browser code or backup files. Imported transactions need deduplication, pending/posted handling, review, disconnection, and deletion. Make reminders optional and avoid sensitive amounts on lock screens by default.

## Cloud security checklist

- proven authentication with recovery and multi-factor options;
- database/API authorization tests for every record type;
- HTTPS, encryption at rest, server-side secret storage, and rate limits;
- minimal personal-data collection plus export and deletion paths;
- tested backups, schema versions, and reversible migrations;
- monitoring that never logs balances, transactions, passwords, or bank tokens;
- privacy, retention, and incident-response policies.

## Release test checklist

1. Verify all linked calculations.
2. Refresh and confirm persistence.
3. Create a second profile and confirm separation.
4. Export/restore standard and encrypted backups; reject a wrong password safely.
5. Reopen the installed app offline.
6. Test mobile and keyboard layouts.

Remain local-first unless users clearly need cross-device sync or live sharing. If cloud is added, keep it optional and preserve portable export so users are never locked in.
