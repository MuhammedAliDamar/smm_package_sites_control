import { env } from "./env";

// thorsmmprovider.com (Yii2/Perfect Panel) /updates sayfasını izler.
// Login: GET / -> hidden _csrf + PHPSESSID -> POST / (LoginForm) -> oturum -> GET /updates.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export type UpdateRow = { service: string; date: string; update: string; key: string };

type Jar = Map<string, string>;

function absorb(res: Response, jar: Jar) {
  // Node fetch: getSetCookie() tüm Set-Cookie header'larını verir
  const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const sc of cookies) {
    const pair = sc.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(): Promise<Jar | null> {
  const base = env.THOR_UPDATES_BASE;
  if (!env.THOR_UPDATES_USER || !env.THOR_UPDATES_PASS) return null;
  const jar: Jar = new Map();

  const r1 = await fetch(`${base}/`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(25_000),
  });
  absorb(r1, jar);
  const html = await r1.text();
  const m = html.match(/name="_csrf"[^>]*value="([^"]+)"/);
  if (!m) return null;

  const body = new URLSearchParams();
  body.set("_csrf", m[1]);
  body.set("LoginForm[username]", env.THOR_UPDATES_USER);
  body.set("LoginForm[password]", env.THOR_UPDATES_PASS);

  const r2 = await fetch(`${base}/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: `${base}/`,
      Origin: base,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(25_000),
  });
  absorb(r2, jar);
  // Başarılı login 302 redirect döner (200 = form tekrar geldi = başarısız)
  if (r2.status !== 302) return null;
  return jar;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRows(html: string): UpdateRow[] {
  const rows: UpdateRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let mt: RegExpExecArray | null;
  while ((mt = trRe.exec(html))) {
    const cells = [...mt[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 3) continue;
    const [service, date, update] = cells;
    // Sadece geçerli tarihli (YYYY-MM-DD) satırlar — header/diğer tabloları ele
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ service, date, update, key: `${service}||${date}||${update}` });
  }
  return rows;
}

/**
 * Login olup /updates satırlarını döndürür. Geçici hatalara (timeout, login hiccup)
 * karşı 3 deneme yapar. Hepsi başarısızsa null.
 */
export async function fetchUpdateRows(): Promise<UpdateRow[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const jar = await login();
      if (jar) {
        const res = await fetch(`${env.THOR_UPDATES_BASE}/updates`, {
          headers: { "User-Agent": UA, Cookie: cookieHeader(jar) },
          signal: AbortSignal.timeout(25_000),
        });
        if (res.ok) {
          const rows = parseRows(await res.text());
          // rows boşsa muhtemelen login sayfasına düştük (oturum yok) — tekrar dene
          if (rows.length > 0) return rows;
        }
      }
    } catch {
      /* retry */
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
