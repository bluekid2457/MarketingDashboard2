# Backend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard backend (Python 3.10+, FastAPI, Firebase NoSQL DB).

---

## Stack

- **Framework**: FastAPI 0.111.0
- **Server**: Uvicorn 0.29.0 (with standard extras)
- **Language**: Python 3.10+
- **Config**: pydantic-settings 2.2.1 (reads from `.env`)
- **Validation**: Pydantic 2.7.1
- **Env loading**: python-dotenv 1.0.1

---

## Folder Structure

```
backend/
  requirements.txt          # pinned dependencies
  .env.example              # template for environment variables
  app/
    __init__.py
    main.py                 # FastAPI app, CORS, /health endpoint
    config.py               # Settings via pydantic-settings
    routers/
      __init__.py           # router registration (empty at init)
```

---

## Environment Variables

| Variable         | Default                   | Description              |
|------------------|---------------------------|--------------------------|
| `SECRET_KEY`     | `changeme`                | App secret key           |
| `ENCRYPTION_KEY` | `changeme`                | Encryption key           |
| `FRONTEND_URL`   | `http://localhost:3000`   | Allowed CORS origin      |
| `DEBUG`          | `false`                   | Debug mode               |

Copy `backend/.env.example` → `backend/.env` before running.

---

## Endpoints

### `GET /health`
- **Tags**: Health
- **Response**: `{"status": "healthy"}`
- **Auth**: None
- **Purpose**: Service liveness check

---

## CORS

- Allowed origins: `FRONTEND_URL` env var + `http://localhost:3000`
- Credentials: allowed
- Methods: all
- Headers: all

---

## Running the Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## Security

- All secrets via environment variables — never hardcoded
- CORS restricted to known frontend origins
- All endpoints return structured JSON
- Future: rate limiting, OAuth/token auth for third-party platforms

