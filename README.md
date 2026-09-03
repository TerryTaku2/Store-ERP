# Store Financial Management System

A store financial management system: sales & income tracking, expenses & purchases,
inventory-linked costing, inventory levels, and a reports/dashboard. Multi-user with
role-based access (admin / manager / cashier).

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

The database is a local SQLite file (`backend/store.db`). On most hosting
platforms the filesystem is ephemeral, so it resets on every redeploy unless you
attach a persistent disk mounted at the backend directory.
