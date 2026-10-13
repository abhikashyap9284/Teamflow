# TeamFlow: Start here

1. Node.js 24 LTS install karo. ZIP extract karo aur `teamflow` folder VS Code mein open karo.
2. `npm ci` run karo.
3. `Copy-Item .env.example .env.local` aur `notepad .env.local`.
4. Neon.tech par apna PostgreSQL URL `DATABASE_URL` mein daalo.
5. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` se secret generate karke `SESSION_SECRET` mein daalo.
6. `npm run db:migrate`
7. `npm run typecheck`, `npm test`, `npm run build`
8. `npm run dev -- --port 3000`
9. `http://localhost:3000` kholo. Sign in -> Create account.
10. CRUD features browser mein verify karke phir README ke Vercel commands follow karo.

**Important:** Vercel par bhi DATABASE_URL, SESSION_SECRET set karna zaroori hai. Sahi secrets ke bina live site ka sign-in crash/error de sakta hai. Sample data production proof nahi hai.
