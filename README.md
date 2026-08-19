# Paycheck Budget Planner

A private, local-first budgeting Progressive Web App for individuals and couples. Income, bills, debt, savings goals, transactions, net worth, and investing allocations update one connected dashboard.

## Use the app

- [Open the Cloudflare app](https://paycheck-budget-planner.jacobocanot.workers.dev/)
- [Open the current preview](https://paycheck-budget-planner.jacobocanot.chatgpt.site)
- [Download Paycheck-Local-v1.0.0.zip](downloads/Paycheck-Local-v1.0.0.zip)
- [Verify the SHA-256 checksum](downloads/Paycheck-Local-v1.0.0.zip.sha256)

The app is a PWA, not a Chrome extension. It can run as a normal website or be installed from Chrome or Edge as a standalone app.

## Editable source code

The complete maintainable project is in [source/](source/).

Developer quick start:

```bash
cd source
npm ci
npm run dev
```

Then open the local address shown in the terminal. See [source/README.md](source/README.md) for testing, architecture, packaging, and deployment instructions.

## Run the packaged app locally

1. Download and unzip `Paycheck-Local-v1.0.0.zip`.
2. On Windows, double-click `START-WINDOWS.bat`.
3. On macOS or Linux, run `START-MAC-LINUX.sh` from Terminal.
4. Open the local address shown in the terminal.

The included server binds to your own computer. No OpenAI account or API key is required.

## Privacy and backups

- Financial information is stored in IndexedDB inside the current browser profile.
- Each browser, device, and browser profile has independent data.
- The host receives the application files, not your financial records.
- Monthly history and multiple years stay in that local workspace.
- Portable `.paycheck` backups can be downloaded and restored.
- Backups may be protected with client-side PBKDF2/AES-GCM encryption.
- Backup passwords are never stored or uploaded.

Changes save automatically in the same browser profile, but clearing browser data, losing the device, or uninstalling the browser can remove the workspace. Download regular encrypted backups.
