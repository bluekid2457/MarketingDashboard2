# Marketing Dashboard

An AI-powered marketing content management dashboard built with **Next.js 14**, **FastAPI**, and **Firebase**.

## Tech Stack

| Layer     | Technology                          |
|-----------|--------------------------------------|
| Frontend  | Next.js 14, React 18, TypeScript, Tailwind CSS, Zustand |
| Backend   | FastAPI, Python 3.10+, Pydantic      |
| Database  | Firebase (Firestore)                 |

---

## Project Structure

```
MarketingDashboard2/
├── frontend/          # Next.js 14 App Router frontend
├── backend/           # FastAPI backend
├── specs/             # Feature specs and screen references
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- npm or yarn

---

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The app will be available at **http://localhost:3000**.

#### Available scripts

| Script        | Description                  |
|---------------|------------------------------|
| `npm run dev` | Start development server     |
| `npm run build` | Build for production       |
| `npm run start` | Start production server    |
| `npm run lint`  | Run ESLint                 |

---

### Backend Setup

```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment variables
cp .env.example .env

# Start the development server
uvicorn app.main:app --reload
```

The API will be available at **http://localhost:8000**.  
Interactive docs: **http://localhost:8000/docs**  
Health check: **http://localhost:8000/health**

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and update values:

```env
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-encryption-key-here
FRONTEND_URL=http://localhost:3000
DEBUG=false
```

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request
