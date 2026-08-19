PAYCHECK LOCAL
==============

This package runs the Paycheck Budget Planner privately on one computer.
It does not require OpenAI, ChatGPT, an account, an API key, npm install, or
an internet connection after download.

REQUIREMENT
-----------
Node.js 22 or newer: https://nodejs.org/

WINDOWS
-------
Double-click START-WINDOWS.bat.

MACOS OR LINUX
--------------
Open Terminal in this folder and run:

  ./START-MAC-LINUX.sh

Then open http://localhost:4173/ if the browser does not open automatically.
Keep the terminal open while using Paycheck. Press Ctrl+C to stop it.

YOUR DATA
---------
Budget data is stored in the browser profile used to open localhost:4173.
Export a .paycheck backup regularly. The application ZIP does not contain your
personal budget, and a .paycheck backup does not contain the application.

SECURITY
--------
The local server listens only on 127.0.0.1, so other computers on the network
cannot open it. An encrypted backup password cannot be recovered if lost.
