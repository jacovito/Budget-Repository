# Interaction research — September 2026

This research informs interaction patterns; Paycheck retains its own visual design and local-first product requirements. Sources were reviewed September 8, 2026.

| Observed pattern | Source | Paycheck decision |
| --- | --- | --- |
| Recurring bill calendars with paid checkmarks and past/future navigation | [Monarch: recurring expenses](https://www.monarch.com/blog/track-recurring-bills-and-subscriptions) | Give paid/unpaid a real checkbox, a clear status, and an undo action. |
| List/calendar switching for recurring items | [Monarch: Bill Sync and recurring page](https://www.monarch.com/blog/introducing-bill-sync) | Default to an actionable list, with a separate calendar view. No bank/credit connection is introduced. |
| Focused transaction review and upcoming recurring items on the dashboard | [Copilot: dashboard overview](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview) | Surface the review count, and keep unpaid bills beside actual spending. |
| Search, category filters, and transaction detail | [Copilot: transactions overview](https://help.copilot.money/en/articles/9554412-transactions-tab-overview) | Keep merchant/date/account visible on phones, allow direct category correction, and provide search. |
| Downloaded transaction files as an alternative to direct bank import | [YNAB: file-based import](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo) | Keep CSV selection and drag/drop entirely in the browser, with preview, duplicate detection, and local rules. |

## Product judgment

Paycheck's central metric is total monthly income minus actual spending minus remaining included bills. Category targets appear only in Monthly Plan. A plan, a goal, and an actual transaction are distinct concepts; no estimate should silently become a payment.

The interface uses a compact dark balance surface, a category ring showing actual spending only, and an adjacent bill checklist. The phone layout uses four labeled bottom tabs and native dialog sheets instead of a horizontal strip of nine unlabeled icons. Amounts, due dates, and status are textual as well as color-coded. No external imagery, tracking script, live bank API, or AI service is required.
