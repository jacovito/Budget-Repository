# Running and hosting Paycheck without OpenAI

Paycheck has two independent distribution targets: a local ZIP and a public Cloudflare deployment. Neither needs an OpenAI account or API key. Financial data remains in each browser's IndexedDB.

## Local ZIP

The package contains a production build and a small local server. It requires Node.js 22+ but does not require `npm install` or internet after download.

1. Install Node.js 22+ from <https://nodejs.org/>.
2. Extract the entire ZIP.
3. On Windows, double-click `START-WINDOWS.bat`.
4. On macOS or Linux, run `./START-MAC-LINUX.sh` from Terminal.
5. Open <http://localhost:4173/> if the browser does not open.
6. Keep the terminal open while using Paycheck.

The service binds to `127.0.0.1`, so only that computer can reach it. Stop it with `Ctrl+C` or by closing the terminal.

## Public Cloudflare deployment

The public deployment serves application code through HTTPS; it does not store budgets.

1. Store source in GitHub.
2. Build with Node.js 22+, `npm ci`, and `npm run build`.
3. Validate with `npm test` and `npm run lint`.
4. Deploy with `wrangler.selfhost.jsonc`.
5. Test first visit, independent profiles, refresh persistence, encrypted backup, installation, and offline reopening.
6. Publish the Cloudflare URL and GitHub release URL together.

## Updating releases

1. Update the version and release notes.
2. Run `npm run package:standalone`.
3. Upload the ZIP and `.sha256` to the matching GitHub release.
4. Deploy the same source revision to Cloudflare.
5. Keep earlier releases available for recovery.

## Data ownership

- `Paycheck-Local-vX.Y.Z.zip` contains the application.
- A `.paycheck` file contains one user's financial workspace.

Users should keep both for a completely independent copy of the software and their data.
