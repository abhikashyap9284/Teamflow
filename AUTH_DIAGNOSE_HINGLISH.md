# Authentication service error — diagnosis

This edition does not bypass authentication or fake database state.

1. `npm ci`
2. Copy `.env.example` to `.env.local` if missing and replace credentials with a real Neon DATABASE_URL and a 32+ character SESSION_SECRET.
3. `npm run auth:diagnose`
4. If missing tables, `npm run db:migrate`, then run `npm run auth:diagnose` again.
5. Run `npm run dev` and reproduce sign up. The terminal now logs a shortened error code and message without secrets.

If Vercel fails but local passes: verify both environment variables in Vercel production and perform a new deployment. The local .env.local is not uploaded to Vercel.

Never share DATABASE_URL, passwords, API keys or SESSION_SECRET.
