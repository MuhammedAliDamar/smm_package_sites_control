import Script from "next/script";

// Bağımsız Vanak Drop bölümü — admin login GEREKTİRMEZ. Erişim yalnızca
// access-key (vanak_key cookie) ile. Header YOK, dark mode YOK (her zaman light).
export default function VanakLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      {/* Dark mode kapalı: bu bölümde her zaman light tema zorla */}
      <Script id="vanak-force-light" strategy="beforeInteractive">
        {`try{document.documentElement.setAttribute('data-theme','light');document.documentElement.style.colorScheme='light';}catch(e){}`}
      </Script>
      <main className="app-main" style={{ padding: "16px", maxWidth: 1400, margin: "0 auto", width: "100%" }}>
        {children}
      </main>
    </div>
  );
}
