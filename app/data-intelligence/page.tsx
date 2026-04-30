import { DataIntelligenceChat } from "@/components/data-intelligence-chat";
import { DataIntelligenceV2CopilotChat } from "@/components/data-intelligence-v2/copilot-chat";
import { ProductShell } from "@/components/product-shell";
import { getDataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import { requireSession } from "@/lib/session";
import styles from "./page.module.css";

export default async function DataIntelligencePage() {
  const session = await requireSession();
  const v2Config = getDataIntelligenceV2Config(process.env);
  const useV2 =
    v2Config.enabled && v2Config.chatApiEnabled && v2Config.uiEnabled;

  return (
    <ProductShell currentPath="/data-intelligence" session={session}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Data Intelligence</p>
          </div>
        </header>

        <section className={styles.chatSection}>
          {useV2 ? <DataIntelligenceV2CopilotChat /> : <DataIntelligenceChat />}
        </section>
      </main>
    </ProductShell>
  );
}
