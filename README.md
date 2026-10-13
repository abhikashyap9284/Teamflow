# TeamFlow — Vercel-ready full-stack portfolio project

TeamFlow is one of Abhi's four portfolio apps. This edition runs on **Next.js 16, React 19, TypeScript, CSS/Tailwind-compatible styling, PostgreSQL (Neon), and server-side email/password sessions**. Task planning, Kanban workflows, role-checked team collaboration, task discussions, file uploads, analytics.

> This package does not rely on ChatGPT Sites, Cloudflare D1/R2, or temporary server files. Server-side data persists in a PostgreSQL database you configure. These are independent applications; each needs a separate Vercel project and its own PostgreSQL database (or isolated schema/database) to avoid app state conflicts.

## 1. Requirements and environment

- Install Node.js 24 LTS.
- Create a Neon database at https://console.neon.tech/ and copy the **PostgreSQL** connection string.
- Extract this ZIP and open its `teamflow` directory in VS Code.

In PowerShell:

```powershell
npm ci
Copy-Item .env.example .env.local
notepad .env.local
```

Fill in `DATABASE_URL` with your Neon URL. Generate a unique session secret in the local terminal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `SESSION_SECRET`. Never put `.env.local` in Git or share your credentials. `RESEND_API_KEY`, `MAIL_FROM`, and `APP_URL` are optional only if you do not need email verification, invitations to other accounts, or reset links. For email invitations to work, verify your email/sender domain with Resend and set all three.

## 2. Run and test locally

```powershell
npm run db:migrate
npm run typecheck
npm test
npm run build
npm run dev -- --port 3000
```

Open http://localhost:3000 and select **Sign in → Create account**. Use a password of 12+ characters. Create, edit, refresh and delete records; ensure your changes persist after reloading. To sign out, use the account menu.

**Troubleshooting:** `Database connection failed` means either Neon URL/network is incorrect or migration was not run. `SESSION_SECRET` must have at least 32 characters. `npm ci` must finish before building. Do not use Cloudflare Wrangler in the Vercel edition.

## 3. Deploy on Vercel

From this specific app folder in Windows PowerShell:

```powershell
npx vercel login
npx vercel link
npx vercel env add DATABASE_URL production
npx vercel env add SESSION_SECRET production
npx vercel --prod
```

Paste secret values when prompted, **not** as command-line arguments. Use project root `.` and framework **Next.js**. The migration must already have succeeded against the same database. Set any optional email environment variables in Vercel and redeploy if necessary. **A deployed URL is not automatic:** you must finish these steps in your own account.

Each project has `app/` for pages/components, `lib/service.ts` for server authorization/business logic, `lib/postgres.ts` for persistence, `lib/auth.ts` for authentication, `db/` and `scripts/` for SQL migrations, and `tests/` for backend checks.

## Product and testing notes

- The starter content is sample data, not real impact, uptime guarantees, production usage, or customers. Replace it with your actual records.
- Shared updates use polling (every ~2.5 seconds), not WebSockets.
- Team roles are checked by the backend. Invitation acceptance requires a verified account email.
- A separate trusted sender is required for verification/reset emails.
- Tests run using the embedded PGlite PostgreSQL engine; a live Neon connection and browser/deployment checks still have to be completed by you.

### Professional resume description (use only after running/test-driving it)

Built a Next.js collaboration workspace with Kanban task workflows, server-authorized team roles, comments, file attachments, and edit-version conflict handling.

**Do not claim measured uptime, active users, payment processing, or production reliability without evidence.**
