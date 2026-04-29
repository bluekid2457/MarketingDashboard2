# Marketing Dashboard

An AI-powered marketing content management dashboard built with **Next.js 14**, **FastAPI**, and **Firebase**.

## Tech Stack

| Layer     | Technology                          |
|-----------|--------------------------------------|
| Frontend  | Next.js 14, React 18, TypeScript, Tailwind CSS, Zustand |
| Backend   | FastAPI, Python 3.10+, Pydantic, Firebase Admin, Fernet encryption |
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

#### Frontend Firebase Auth configuration

1. Enable **Email/Password** sign-in in Firebase Console:
	- `Authentication` -> `Sign-in method` -> enable `Email/Password`.
2. In `frontend/`, create `.env.local` with your Firebase web app credentials:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The frontend login flow uses Firebase `signInWithEmailAndPassword`, redirects to `/dashboard` on success, and route-guards app screens under `src/app/(app)`.

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

#### Provider auth foundation

The backend now includes a provider-connection layer for future direct publishing:

- `POST /api/v1/auth/linkedin/start` returns a LinkedIn OAuth URL for a specific app user.
- `GET /api/v1/auth/linkedin/callback` completes the LinkedIn OAuth exchange and stores a publish-capable connection.
- `GET /api/v1/integrations/providers` lists supported provider capabilities.
- `GET /api/v1/integrations/status?userId=<uid>` lists connection state for LinkedIn, X/Twitter, Instagram, Facebook, WordPress, Ghost, and Substack.
- `POST /api/v1/integrations/{provider}/tokens` stores encrypted tokens for providers that are not wired to OAuth yet.
- `POST /api/v1/integrations/{provider}/disconnect` removes the stored secret and marks the provider disconnected.

LinkedIn is the first provider with a full OAuth flow. Other providers are registry-backed so the app can store auth material now and add publish execution later without changing the storage model.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and update values:

```env
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-encryption-key-here
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:8000
DEBUG=false

FIREBASE_PROJECT_ID=your-project-id
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# FIREBASE_CREDENTIALS_PATH=C:/path/to/service-account.json
# FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
# Optional override. Defaults to http://localhost:8000/api/v1/auth/linkedin/callback
# LINKEDIN_REDIRECT_URI=http://localhost:8000/api/v1/auth/linkedin/callback
LINKEDIN_SCOPES="openid profile email w_member_social"
```

The provider auth layer stores browser-safe connection summaries under `users/{uid}/integrationConnections/{provider}` and keeps encrypted token material in the backend-only `integrationSecrets` collection.

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request
