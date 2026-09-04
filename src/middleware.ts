import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];
// Vanak Drop bölümü admin login gerektirmez; erişim vanak_key ile page/route
// içinde denetlenir. Bu yüzden /vanak ve /api/vanak session zorunluluğundan muaf.
const PUBLIC_PAGE_PREFIXES = ["/vanak"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/cron", "/api/vanak"];
const COOKIE_NAME = "thorsmm_session";
const VANAK_COOKIE = "vanak_key";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// vanak-key kullanıcısının erişebileceği tek alan.
function isVanakScope(pathname: string): boolean {
  return pathname === "/vanak" || pathname.startsWith("/vanak/") || pathname.startsWith("/api/vanak");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // Eski yol: /dashboard/vanak → /vanak (login'e sokmadan yönlendir).
  if (pathname === "/dashboard/vanak" || pathname.startsWith("/dashboard/vanak/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/vanak";
    return NextResponse.redirect(url);
  }

  const hasCookie = Boolean(req.cookies.get(COOKIE_NAME)?.value);
  const hasVanakKey = Boolean(req.cookies.get(VANAK_COOKIE)?.value);
  const isPublicPage =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  // Vanak-key kullanıcısı (admin session YOK): SADECE /vanak + /api/vanak.
  // Diğer sayfalar /vanak'a yönlenir, diğer API'ler 401. ANCAK admin girişine
  // izin verilir (/login + /api/auth) — yoksa vanak_key cookie'si olan admin
  // panele hiç giremez. Girişten sonra admin session olur, confinement kalkar.
  if (hasVanakKey && !hasCookie) {
    const isLoginFlow = pathname === "/login" || pathname.startsWith("/api/auth");
    if (isVanakScope(pathname) || isLoginFlow) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

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
