# T-Tech Connect

A store financial management system: sales & income tracking, expenses & purchases,
inventory-linked costing, inventory levels, and a reports/dashboard. Multi-user with
role-based access (admin / manager / cashier). Multi-tenant — each registered
business (company) can set its own business name, shown in the sidebar and on
receipts alongside the T-Tech Connect product branding.

## Stack
- Backend: FastAPI + SQLAlchemy + SQLite, JWT auth
- Frontend: vanilla HTML/CSS/JS, served by FastAPI (no build step)

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://localhost:8000 in your browser.

## Default login

On first run a default admin is seeded:

- username: `admin`
- password: `admin123`

Change this password immediately after first login (Users page).

## Roles
- **admin** — full access, including user management
- **manager** — products, suppliers, purchases, expenses, reports, dashboard
- **cashier** — record sales, view inventory (read-only), view own sales, dashboard

## Deployment (Docker)

A `Dockerfile` at the repo root builds and runs the whole app (backend + frontend)
as a single container, listening on the `PORT` env var (defaults to 8000) — this is
what Render/Fly/Railway-style platforms expect.

Set these environment variables in production:
- `SECRET_KEY` — required. Any long random string; used to sign JWT login tokens.
  Without it the app falls back to an insecure default, fine for local dev only.
- `DATABASE_PATH` — required for the database to survive a redeploy. See below.

### Persisting the database (Render Disks)

The database is a local SQLite file. Container filesystems on Render (and
similar platforms) are ephemeral — anything written to disk is lost on the
next deploy — unless you attach a persistent disk.

1. In the Render dashboard, open the service → **Disks** tab → **Add Disk**.
2. Give it a name and size (1 GB is plenty for SQLite at small-business scale).
3. Set **Mount Path** to something *outside* the app's code directory, e.g.
   `/var/data` — do **not** mount it at `/app/backend` (where the Dockerfile
   puts the code): a disk mount replaces that directory's contents, which
   would hide the application code the image just built.
4. Set the `DATABASE_PATH` env var to a file inside that mount, e.g.
   `/var/data/store.db`. The app creates the file (and any missing parent
   directories) automatically on startup — you don't need to create it
   yourself.
5. Redeploy. From then on, `store.db` lives on the disk and survives future
   deploys instead of resetting.

Without `DATABASE_PATH` set, the app falls back to a local file next to the
code (`backend/store.db`), which is fine for local dev but gets wiped on
every Render redeploy.
