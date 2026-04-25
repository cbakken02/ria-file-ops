import Link from "next/link";
import type { Session } from "next-auth";
import { AccountMenu } from "@/components/account-menu";
import { PRODUCT_NAV_ITEMS, type ProductNavPath } from "@/lib/product-navigation";
import styles from "./product-shell.module.css";

type ProductShellProps = {
  children: React.ReactNode;
  currentPath: ProductNavPath;
  session: Session;
};

export async function ProductShell({
  children,
  currentPath,
  session,
}: ProductShellProps) {
  const email = session.user?.email ?? "";
  const displayName = resolveDisplayName(session.user?.name, email);
  const initials = resolveInitials(displayName, email);
  const profileImage = session.user?.image?.trim() || null;
  const accountSubtitle = email;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>RF</span>
          <div className={styles.brandText}>
            <strong>RIA File Ops</strong>
            <span>Operations workspace</span>
          </div>
        </div>

        <div className={styles.navLabel}>Workspace</div>
        <nav className={styles.navSection}>
          {PRODUCT_NAV_ITEMS.map((item) => {
            const isActive = item.href === currentPath;

            return (
              <Link
                key={item.href}
                aria-current={isActive ? "page" : undefined}
                className={isActive ? styles.activeNavLink : styles.navLink}
                href={item.href}
                prefetch={false}
              >
                <span>{item.label}</span>
                <span className={styles.navHint}>{item.hint}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarSpacer} />

        <AccountMenu
          accountMeta={null}
          accountSubtitle={accountSubtitle}
        currentPath={currentPath}
        displayName={displayName}
        image={profileImage}
        initials={initials}
      />
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}

function resolveDisplayName(name: string | null | undefined, email: string) {
  const trimmed = name?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (!email) {
    return "Account";
  }

  const localPart = email.split("@")[0] ?? "Account";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveInitials(name: string, email: string) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }

  if (words.length === 1 && words[0]) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return (email.slice(0, 2) || "AC").toUpperCase();
}
