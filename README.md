# ThorSMM Admin Panel

Next.js 15 + Prisma + PostgreSQL. Takip edilen her username için ThorSMM admin API'sinden siparişleri çeker, yerel DB'ye upsert eder, dashboard'da gösterir.

## Local kurulum

```bash
# 1) Postgres (zaten kuruluysa atla)
createdb thorsmm_admin

# 2) Bağımlılıklar
npm install

# 3) Prisma schema'yı DB'ye uygula
npm run db:push

# 4) Admin hesabını oluştur (şifre .env.local'den gelir)
npm run db:seed

# 5) Dev server
npm run dev
# http://localhost:3000 → /login

# 6) İkinci terminalde local cron (10 dakikada bir senkron)
npm run cron:local

# veya tek seferlik senkron:
npm run sync:once
```

## Dizinler

- `prisma/schema.prisma` — DB şeması (AdminUser, Session, TrackedUsername, Order, SyncRun, LoginAttempt)
- `src/lib/thorsmm.ts` — ThorSMM API client (X-Api-Key header)
- `src/lib/sync.ts` — sipariş çekme + upsert mantığı
- `src/lib/auth.ts` — bcrypt + DB-backed session + signed cookie + rate limit + lockout
- `src/middleware.ts` — `/dashboard` ve `/api` korumaları
- `src/app/api/cron/sync` — cron endpoint (Bearer secret veya admin oturumu)
- `scripts/cron-local.ts` — local development için 10dk interval runner

## Güvenlik

- bcrypt cost 12, hesap kilitleme (10 yanlış → 30dk)
- HttpOnly + SameSite=Lax + (prod'da) Secure cookie, HMAC imzalı session id
- CSP/HSTS/X-Frame-Options header'ları
- Login rate limit (15dk içinde kullanıcı başı 8 / IP başı 16)
- API key yalnızca sunucuda, client bundle'a sızmaz
- Cron endpoint CRON_SECRET ile korunur; timing-safe karşılaştırma

## Prod deploy (sonrası)

- Vercel: `vercel.json`'a cron eklenebilir: `{ "path": "/api/cron/sync", "schedule": "*/10 * * * *" }`
- Env'ler: `DATABASE_URL`, `THORSMM_API_KEY`, `SESSION_SECRET`, `CRON_SECRET`
