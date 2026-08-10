# Paycheck Budget Planner

A private, local-first budgeting application for individuals and couples. Income, bills, debts, savings goals, transactions, net worth, and monthly investing allocations update one connected dashboard.

## Download version 1.0.0

- [Download Paycheck-Local-v1.0.0.zip](downloads/Paycheck-Local-v1.0.0.zip)
- [Verify the SHA-256 checksum](downloads/Paycheck-Local-v1.0.0.zip.sha256)
- [Read the Product Requirements Document](docs/PRD.md)

## Run locally

1. Download and unzip `Paycheck-Local-v1.0.0.zip`.
2. On Windows, double-click `START-WINDOWS.bat`.
3. On macOS or Linux, run `START-MAC-LINUX.sh` from Terminal.
4. Open the local address shown in the terminal.

The included server runs only on your own computer. No OpenAI account or API key is required.

## Privacy model

- Financial information is stored in IndexedDB inside each browser profile.
- The application does not send financial records to the website host.
- Each browser or device has independent data.
- Portable `.paycheck` backups can be downloaded and restored.
- Backups may be protected with client-side PBKDF2/AES-GCM encryption.
- Backup passwords are never stored or uploaded.

Clearing browser storage can erase the active workspace, so download regular encrypted backups.

## Current status

Version 1.0.0 is the local-first foundation. A separate Cloudflare deployment is planned to provide an OpenAI-independent public web address while preserving browser-only financial storage.

