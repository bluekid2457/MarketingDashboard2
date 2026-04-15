# Frontend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard frontend (Next.js 14, TypeScript, Zustand, Tailwind CSS).

---

## Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand v4
- **Linting**: ESLint (`next/core-web-vitals`)
- **Formatting**: Prettier

---

## Folder Structure

```
frontend/
  package.json          # dependencies + npm scripts
  tsconfig.json         # strict TypeScript + path aliases (@/*)
  tailwind.config.ts    # content: ./src/**/*.{ts,tsx}
  postcss.config.js     # tailwindcss + autoprefixer
  next.config.js        # reactStrictMode: true
  .eslintrc.json        # extends next/core-web-vitals
  .prettierrc           # semi, singleQuote, trailingComma es5
  src/
    app/
      layout.tsx        # Root layout, metadata, Inter font
      page.tsx          # Home / Marketing Dashboard landing page
      globals.css       # @tailwind base/components/utilities
    components/         # Shared UI components (empty at init)
    lib/                # Utility helpers (empty at init)
    store/              # Zustand stores (empty at init)
```

---

## npm Scripts

| Script           | Command           |
|------------------|-------------------|
| `npm run dev`    | `next dev`        |
| `npm run build`  | `next build`      |
| `npm run start`  | `next start`      |
| `npm run lint`   | `next lint`       |

---

## Pages

### `/` — Home / Dashboard (`src/app/page.tsx`)
- Header with nav links: Dashboard, Ideas, Drafts, Publish
- Hero section with gradient background and CTA buttons
- Stats overview grid (4 cards: Ideas Generated, Drafts in Progress, Posts Published, Total Reach)
- Quick Actions section (3 cards: New Idea, New Draft, Publish)
- Footer

---

## API Integration

- Next.js API routes at `/api/ai/*` for AI generation (to be implemented)
- `/api/v1/*` proxy to FastAPI backend (to be implemented)
- All API base URLs stored in `process.env.NEXT_PUBLIC_API_URL`

---

## Security

- Sensitive pages protected via authentication middleware (to be added)
- Secrets kept in server-side env vars or private Next.js env vars

