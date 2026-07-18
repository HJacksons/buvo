# BUVO POS

BUVO POS is a Uganda-focused supermarket counter and stock-management system. It is built with React, TypeScript, and a small local Node API that can run on SQLite for one counter or PostgreSQL for several counters sharing one shop database.

## Implemented modules

- Staff login/logout with role-specific navigation and automatic inactivity lock.
- Checkout barcode scanning with quantity controls and line discounts.
- Customer-facing display window for scanned items, selling prices, totals, paid amount, and change.
- Cash, MTN MoMo, Airtel Money, card, split-tender, and credit-account recording.
- Receipt preview plus browser print output for an 80 mm receipt layout.
- Product receiving by barcode, new-product creation, categories, suppliers, and EFRIS commodity-code fields.
- Supplier purchase orders with product search, invoice notes, partial/full receiving into stock, and audit trails.
- Internal barcode generation for locally packed products.
- Product catalogue with search, editing, deactivation, multiple barcodes, price-change audit logs, and printable shelf/product labels.
- Barcode scanner input for selling and receiving using any decoded barcode text stored on the product.
- Stock movements for opening balance, purchase, sale, stock count, damage, and returns.
- Stock count and adjustment workflow.
- Returns, refunds, receipt voids, and EFRIS credit-note/cancelled-receipt queueing.
- Debtor accounts with credit limits, credit sales, repayments, balances, and debt activity.
- Cashier shifts with opening float, expected cash, counted cash, and variance.
- Daily sales, gross profit, stock value, low-stock reports, and recent receipts.
- Users and roles for owner, manager, stock administrator, and cashier.
- Notifications for low stock, expiring products, open shifts, and EFRIS work.
- Collapsible sidebar and visible scanner/printer readiness status for the counter.
- Cashier monitoring for receipts, sales, discounts, returns, open shifts, and activity.
- Audit log for sales, receiving, returns, stock counts, shifts, users, EFRIS, and backups.
- Local SQLite persistence with schema migrations and browser fallback if the API is unavailable.
- Optional PostgreSQL store mode for multi-counter shared data, with save revision checks to prevent stale overwrite.
- Staff PIN verification through the backend with PBKDF2 hashes stored outside the frontend.
- Electron desktop shell and packaging scripts for an installable counter app.
- JSON backup download and restore.
- EFRIS-ready transaction queue with simulated submission and Fiscal Document Number storage.

## Development

```bash
npm install
npm run api
npm run dev
```

Run `npm run api` in one terminal and `npm run dev` in another. The SQLite API runs at `http://127.0.0.1:8787`. The app runs at the Vite URL shown in the terminal, usually `http://127.0.0.1:5173/`.

Run the desktop development app with:

```bash
npm run desktop:dev
```

## Customer display

From Checkout, click `Customer display` and move the opened window to the customer-facing monitor. The display updates live when the cashier scans items, changes quantities, records payments, or completes the sale.

The customer display intentionally shows only customer-safe information: item name, barcode, quantity, selling price, discount, VAT estimate, amount due, paid amount, change, and receipt number after payment. It does not show buying cost, profit, supplier cost, admin panels, debtor lists, or cashier controls.

## Demo logins

- Cashier: staff number `1001`, PIN `1234`
- Owner / super admin: staff number `0001`, PIN `0000`
- Stock administrator: staff number `2001`, PIN `2468`
- Manager: staff number `3001`, PIN `4321`

Cashiers see checkout, product lookup, returns, debtors, shifts, and notifications. Managers see monitoring and operations areas, including debtor collection. The owner / super admin can create staff accounts, staff numbers, PINs, and roles in Admin.

The first login uses staff number plus PIN. After 5 minutes of inactivity, the session locks to the same staff member and asks only for that staff member's PIN to unlock. The lock screen also allows switching user, which fully logs out.

## Persistence, sync, and security

The app now uses a local SQLite database when the API server is running. Sales, stock, debtors, purchase orders, shifts, users, audit logs, EFRIS queue items, and backup restores are saved automatically after every data change.

The database file is created at `data/buvo-pos.sqlite`. Runtime SQLite files are ignored by Git. Schema changes are tracked through `schema_migrations`; the current app schema is version `3`.

For multiple counters, run the API against PostgreSQL and point every counter frontend or desktop app to that same API/database:

```bash
BUVO_DATABASE=postgres \
DATABASE_URL=postgres://buvo_user:buvo_password@localhost:5432/buvo_pos \
npm run api
```

PostgreSQL mode stores the shop data in `store_snapshots` and staff credentials in `user_credentials`. The API returns a store revision on load and requires the same revision on save; if another counter has saved first, the stale save is rejected so one counter does not silently overwrite another counter's work.

Staff PINs are migrated away from plaintext into PBKDF2 hashes. The API verifies login and unlock requests and returns users with blank `pin` fields, so the frontend does not need to hold stored PINs when database mode is active.

If the SQLite API is not running, the frontend falls back to browser storage so the prototype remains usable. Admin includes a Backups panel that shows whether the active store is SQLite or browser fallback, the save status, and the last saved time. It can download a versioned JSON backup and restore either the new backup format or older raw app-data backups.

SQLite is still the simplest choice for one offline counter. PostgreSQL is the correct choice when two or more counters must see the same products, stock, debtors, shifts, users, and audit logs.

## Desktop app

Build the web app plus bundled local API:

```bash
npm run build
```

Create an unpacked desktop app for local testing:

```bash
npm run desktop:pack
```

Create installer artifacts in `release/`:

```bash
npm run desktop:dist
```

Build a specific platform installer:

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
npm run desktop:dist:linux
```

The packaged desktop app starts its own local API. By default it stores SQLite data in the app user-data folder. To use PostgreSQL from the desktop app, launch it with `BUVO_DATABASE=postgres` and `DATABASE_URL` set in the environment.

Windows uses an NSIS installer and the BUVO `.ico` logo. Because BUVO includes the native `better-sqlite3` module, the most reliable Windows installer should be produced on a Windows build machine or GitHub Actions Windows runner.

## Report exports

- Owner / super admin: sales CSV, shift CSV, debtors CSV, debt activity CSV, EFRIS CSV, product CSV, stock movement CSV, purchase orders CSV, low stock / expiry CSV, audit CSV, and full JSON backup.
- Manager: sales CSV, shift CSV, debtors CSV, debt activity CSV, EFRIS CSV, product CSV, stock movement CSV, purchase orders CSV, and low stock / expiry CSV.
- Stock administrator: product CSV, stock movement CSV, purchase orders CSV, and low stock / expiry CSV.
- Cashier: no cross-shop report export; cashier work remains in shifts, receipts, and normal counter screens.

CSV is used for accounting and spreadsheet work. JSON is reserved for full backup/restore.

## Real integration steps

1. Connect ESC/POS thermal receipt printing and barcode label printing after the target printer model is known.
2. Replace simulated EFRIS submission with the approved URA/EFRIS integration route and taxpayer credentials.
3. Replace pending mobile-money statuses with MTN MoMo and Airtel Money callbacks.
4. Move all write actions from whole-store saves to per-action backend endpoints with role checks and manager approvals.
5. Add a hosted PostgreSQL API deployment for owner access outside the shop network.
