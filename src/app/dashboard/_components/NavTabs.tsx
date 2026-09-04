"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Orders" },
  { href: "/vanak", label: "Vanak Drop" },
];

export default function NavTabs() {
  const pathname = usePathname();
  return (
    <nav style={{ display: "flex", gap: 4 }}>
      {TABS.map((t) => {
        const active = t.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={active ? "btn btn-sm btn-primary" : "btn btn-sm"}
            style={{ textDecoration: "none" }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
