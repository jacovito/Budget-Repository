# Statement to CSV — Cloudflare deployment

This independent app converts PDF bank and credit-card statements into a CSV for Paycheck. The public web interface works on phones and computers. PDF reading, English scan recognition, password entry, review, and CSV generation happen in the visitor's browser. No bank credentials, statement uploads to a server, financial database, or OpenAI account is required on the Cloudflare deployment.

## One-time browser setup

In Cloudflare **Workers & Pages**, create a new Worker and import the existing GitHub repository `jacovito/Budget-Repository`. Use these settings for the converter:

| Setting | Value |
| --- | --- |
| Worker name | `statement-to-csv` |
| Production branch | `main` |
| Root directory | `statement-to-csv` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Non-production branch deploy command, if shown | `npm run deploy:preview` |

Cloudflare installs the pinned dependencies before the build. Save and deploy, then use the exact `workers.dev` address shown by Cloudflare. This creates a separate Worker; leave the existing Paycheck Worker's settings as they are. Once the Git connection is established, commits to this converter's source can deploy automatically.

Official references: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/get-started/), [Git build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Maintaining the app

The files in `dist/`, except generated `dist/vendor/`, are editable source. `scripts/prepare-assets.mjs` installs the exact pinned reader assets from npm packages into the published folder. All runtime files are served by this Worker; no third-party CDN is required. Keep the PDF library and worker versions together.

```sh
npm ci
npm run build
npm test
npm run validate
npm run deploy
```

`validate` is a dry run and does not publish. Actual command-line deployment requires authorization in your own Cloudflare account. The browser-based Git connection does not require installing software on your computer.

## Input and output limits

- One PDF at a time, up to 25 MB and 100 pages; up to 20 scanned pages.
- English scanned text; USD-style decimal amounts. Different statement layouts can need corrections.
- Review flagged rows and compare with the original statement before export. Summary balances are excluded; possible duplicates are flagged, not silently deleted.
- Paycheck output includes selected spending only: Date, Description, Amount. Income, refunds, and transfers are excluded because Paycheck's CSV importer currently handles spending.
- Spreadsheet output preserves selected transaction types, categories, and optional account names with separate Debit, Credit, and Transfer Amount columns.

The converter is a separate app and has no access to anyone's saved Paycheck budget. No financial data belongs in this repository.
