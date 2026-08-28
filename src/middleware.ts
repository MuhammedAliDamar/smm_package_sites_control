import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/cron"];
const COOKIE_NAME = "thorsmm_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  const hasCookie = Boolean(req.cookies.get(COOKIE_NAME)?.value);
  const isPublicPage = PUBLIC_PATHS.includes(pathname);
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  // CSRF: cross-origin state-changing requests with cookies are rejected.
  // SameSite=Lax already blocks most browser CSRF, but origin pinning closes
  // edge cases (subdomain takeover, browser bugs).
  if (
    pathname.startsWith("/api/") &&
    !SAFE_METHODS.has(req.method) &&
    !pathname.startsWith("/api/cron")
  ) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin) {
      try {
        const o = new URL(origin).host;
        if (o !== host) {
          return NextResponse.json(
            { error: "Cross-origin request blocked" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
      }
    }
  }

  if (isPublicPage || isPublicApi) {
    // NOT: Eskiden burada cookie varsa /login → /dashboard yönlendirmesi vardı.
    // Middleware (edge) DB'ye bakamadığı için oturumun geçerli olup olmadığını
    // bilemez; geçersiz-ama-mevcut bir cookie sonsuz redirect döngüsüne yol
    // açıyordu (dashboard geçersiz oturumu /login'e atıyor, burası geri atıyordu).
    // "Zaten girişli kullanıcıyı dashboard'a al" işini login sayfası devralır.
    return NextResponse.next();
  }

  if (!hasCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
