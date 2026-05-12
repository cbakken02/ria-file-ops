"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ProductNavItem, ProductNavPath } from "@/lib/product-navigation";
import styles from "./product-shell.module.css";

type ProductNavProps = {
  bottomItems: ProductNavItem[];
  currentPath: ProductNavPath;
  primaryItems: ProductNavItem[];
};

export function ProductNav({
  bottomItems,
  currentPath,
  primaryItems,
}: ProductNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [optimisticPath, setOptimisticPath] = useState<ProductNavPath | null>(null);
  const items = useMemo(
    () => [...primaryItems, ...bottomItems],
    [bottomItems, primaryItems],
  );
  const pendingPath = optimisticPath !== pathname ? optimisticPath : null;
  const activePath = pendingPath ?? normalizeProductPath(pathname, currentPath);

  useEffect(() => {
    for (const item of items) {
      if (item.href !== pathname) {
        router.prefetch(item.href);
      }
    }
  }, [items, pathname, router]);

  function prefetch(href: ProductNavPath) {
    router.prefetch(href);
  }

  return (
    <>
      <nav className={styles.navSection}>
        {primaryItems.map((item) => (
          <ProductNavLink
            key={item.href}
            activePath={activePath}
            isPending={pendingPath === item.href}
            item={item}
            onIntent={prefetch}
            onNavigate={setOptimisticPath}
          />
        ))}
      </nav>

      <div className={styles.sidebarSpacer} />

      <nav className={`${styles.navSection} ${styles.bottomNavSection}`}>
        {bottomItems.map((item) => (
          <ProductNavLink
            key={item.href}
            activePath={activePath}
            isPending={pendingPath === item.href}
            item={item}
            onIntent={prefetch}
            onNavigate={setOptimisticPath}
          />
        ))}
      </nav>

      {pendingPath ? (
        <div className={styles.routeProgress} aria-hidden="true">
          <span />
        </div>
      ) : null}
    </>
  );
}

function ProductNavLink({
  activePath,
  isPending,
  item,
  onIntent,
  onNavigate,
}: {
  activePath: ProductNavPath;
  isPending: boolean;
  item: ProductNavItem;
  onIntent: (href: ProductNavPath) => void;
  onNavigate: (href: ProductNavPath) => void;
}) {
  const isActive = item.href === activePath;

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={isActive ? styles.activeNavLink : styles.navLink}
      data-pending={isPending ? "true" : undefined}
      href={item.href}
      onFocus={() => onIntent(item.href)}
      onMouseEnter={() => onIntent(item.href)}
      onNavigate={() => onNavigate(item.href)}
      prefetch={true}
    >
      <span>{item.label}</span>
      <span className={styles.navHint}>{item.hint}</span>
    </Link>
  );
}

function normalizeProductPath(
  pathname: string | null,
  fallback: ProductNavPath,
): ProductNavPath {
  const value = pathname?.trim();

  if (
    value === "/dashboard" ||
    value === "/intake" ||
    value === "/clean-up" ||
    value === "/data-intelligence" ||
    value === "/history" ||
    value === "/security" ||
    value === "/setup"
  ) {
    return value;
  }

  return fallback;
}
