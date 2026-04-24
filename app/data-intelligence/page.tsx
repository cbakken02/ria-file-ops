import { DataIntelligenceChat } from "@/components/data-intelligence-chat";
import { ProductShell } from "@/components/product-shell";
import { requireSession } from "@/lib/session";
import styles from "./page.module.css";

export default async function DataIntelligencePage() {
  const session = await requireSession();

  return (
    <ProductShell currentPath="/data-intelligence" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Data Intelligence</p>
          </div>
        </header>

        <section className={styles.chatSection}>
          <DataIntelligenceChat />
        </section>
      </main>
    </ProductShell>
  );
}
