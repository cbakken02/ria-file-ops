import Link from "next/link";
import { auth } from "@/auth";
import { POST_LOGOUT_SIGN_IN_URL } from "@/lib/auth/google-signin";
import { FAQAccordion } from "./faq-accordion";
import { GuidedFilingDemo } from "./guided-filing-demo";
import styles from "./page.module.css";

const heroUploadFiles = ["statement.pdf", "IMG_4821.pdf", "tax-return-upload.pdf"];

const heroDetectedDetails = [
  {
    label: "Detected",
    value: "Schwab IRA Statement",
  },
  {
    label: "Client",
    value: "Jane Miller",
  },
  {
    label: "Custodian",
    value: "Schwab",
  },
];

const heroFolderPath = [
  "Jane Miller",
  "Investments",
  "Statements",
  "Schwab",
];

const manualCleanupSteps = [
  "Open file",
  "Identify document",
  "Check naming rule",
  "Extract details",
  "Rename",
  "Find folder",
  "Move",
  "Repeat",
];

const fileOpsSteps = [
  "Detect upload",
  "Identify document",
  "Suggest name",
  "Suggest folder",
  "Confirm",
  "File cleanly",
];

const driftRisks = [
  "Dates formatted differently",
  "Client names vary",
  "Account details get missed",
];

const onboardingDocuments = [
  "Statements",
  "Forms",
  "Scans",
  "PDFs",
  "Insurance docs",
  "Retirement plan docs",
  "Account statements",
  "Tax documents",
];

const filingQuestions = [
  "What is this document?",
  "Who is it for?",
  "Which account or custodian is tied to it?",
  "What should it be called?",
  "Where should it go?",
];

const workflowSteps = [
  {
    title: "Detect",
    body: "A new file lands in the client upload folder.",
  },
  {
    title: "Identify",
    body: "RIA File Ops reads the upload and detects the document type.",
  },
  {
    title: "Suggest",
    body: "It prepares a filename and destination from the firm's convention.",
  },
  {
    title: "Confirm",
    body: "Your team confirms or edits before anything moves.",
  },
  {
    title: "File",
    body: "The confirmed document is renamed and moved into place.",
  },
];

const futureLayers = [
  {
    title: "Missing Document View",
    body: "See folders that still need statements, IDs, forms, or paperwork.",
  },
  {
    title: "Folder Readiness",
    body: "Know what is complete, stale, or missing.",
  },
  {
    title: "Task Prep",
    body: "Prepare service work from document context.",
  },
];

const faqItems = [
  {
    question: "What does RIA File Ops do today?",
    answer:
      "RIA File Ops helps advisory teams prepare the right filename and destination for client upload files.",
  },
  {
    question: "Does RIA File Ops move files automatically?",
    answer:
      "The current workflow is confirmation-first. RIA File Ops prepares the filing details, but your team reviews and confirms before the document is renamed and moved.",
  },
  {
    question: "Can I customize naming rules?",
    answer:
      "Yes. RIA File Ops is designed around firm-specific naming conventions, including details like client name, document type, custodian, account type, account number, dates, tax year, ID type, and entity name.",
  },
  {
    question: "Can I customize folder structures?",
    answer:
      "Yes. RIA File Ops uses a folder template for client destinations, and that template can be adjusted to match your firm's preferences. When your team confirms a filing move in Google Drive, missing client or top-level folders can be created as part of that move.",
  },
  {
    question: "What happens when RIA File Ops is unsure?",
    answer:
      "Unclear files should stay in review. The system can still propose a name and destination, but your team can edit the details before filing.",
  },
  {
    question: "Which file storage systems are supported?",
    answer:
      "Google Drive is the supported storage integration today. The waitlist helps prioritize support for systems like SharePoint / OneDrive, Box, Dropbox, ShareFile, Egnyte, SmartVault, and shared network drives.",
  },
  {
    question: "What document types can it recognize?",
    answer:
      "RIA File Ops is built for common advisory uploads such as account statements, tax documents, identity documents, planning files, insurance-related files, and other client-uploaded PDFs. Recognition depends on the file contents, so unclear files stay in review.",
  },
  {
    question: "What is coming next?",
    answer:
      "Clean filing is the first layer. Coming-next workflows may include missing-document views, folder readiness, and task prep using the information already inside client files.",
  },
];

type HomePageProps = {
  searchParams?: Promise<{
    signed_out?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const signedOut = readSingleSearchParam(resolvedSearchParams.signed_out);
  const session = await auth();
  const isAuthenticated = Boolean(session?.user);
  const showSignedOutNotice = !isAuthenticated && signedOut === "1";
  const waitlistHref = "/join-waitlist";
  const headerHref = isAuthenticated ? "/dashboard" : waitlistHref;
  const headerLabel = isAuthenticated ? "Go to App" : "Join Waitlist";

  return (
    <main className={styles.page}>
      <LandingHeader
        isAuthenticated={isAuthenticated}
        headerHref={headerHref}
        headerLabel={headerLabel}
      />
      {showSignedOutNotice ? <SignedOutNotice /> : null}
      <HeroSection waitlistHref={waitlistHref} />
      <GuidedFilingDemo />
      <ManualCleanupSection />
      <BatchDecisionsSection />
      <WorkflowSection />
      <FutureLayerSection />
      <FAQSection />
      <FinalCTASection waitlistHref={waitlistHref} />
    </main>
  );
}

function readSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type LandingHeaderProps = {
  isAuthenticated: boolean;
  headerHref: string;
  headerLabel: string;
};

type WaitlistLinkProps = {
  waitlistHref: string;
};

function SignedOutNotice() {
  return (
    <aside className={styles.signedOutNotice} aria-live="polite">
      <p>
        <strong>You&apos;re signed out.</strong>
        <span>Your RIA File Ops app session has ended.</span>
      </p>
      <Link href={POST_LOGOUT_SIGN_IN_URL}>Sign in again</Link>
    </aside>
  );
}

function LandingHeader({
  isAuthenticated,
  headerHref,
  headerLabel,
}: LandingHeaderProps) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="RIA File Ops home">
        <span className={styles.brandMark}>RF</span>
        <span>RIA File Ops</span>
      </Link>

      <nav className={styles.nav} aria-label="Landing page">
        <Link href="#product">Product</Link>
        <Link href="#guided-demo">Demo</Link>
        <Link href="#workflow">Workflow</Link>
        <Link href="#faq">FAQ</Link>
      </nav>

      <div className={styles.headerActions}>
        <Link
          className={
            isAuthenticated ? styles.headerAction : styles.headerPrimaryAction
          }
          href={headerHref}
        >
          {headerLabel}
        </Link>
      </div>
    </header>
  );
}

function HeroSection({ waitlistHref }: WaitlistLinkProps) {
  return (
    <section className={styles.hero} id="product">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Private MVP for advisory operations</p>
        <h1>Document intelligence for RIA operations</h1>
        <p className={styles.lead}>
          Clean up files. Extract client data. Prep advisor workflows. RIA File
          Ops turns messy client uploads from existing file storage into a clean
          review queue before anything moves.
        </p>

        <div className={styles.actions}>
          <Link className={styles.primaryAction} href={waitlistHref}>
            Join Waitlist
          </Link>
          <Link className={styles.heroTextLink} href="#guided-demo">
            See how it works
          </Link>
        </div>
      </div>

      <HeroProductPreview />
    </section>
  );
}

function HeroProductPreview() {
  return (
    <section
      className={styles.heroPreview}
      aria-label="RIA File Ops filing preview"
    >
      <div className={styles.heroPreviewGlow} aria-hidden="true" />

      <div className={styles.heroPreviewRail} aria-hidden="true">
        <span>Existing file storage</span>
        <span>Filing prep</span>
        <span>Clean review queue</span>
      </div>

      <article className={`${styles.heroPreviewCard} ${styles.uploadPreviewCard}`}>
        <div className={styles.heroPreviewCardHeader}>
          <div>
            <p className={styles.panelKicker}>Existing file storage</p>
            <h2>Messy uploads</h2>
          </div>
          <span className={styles.previewBadge}>New upload detected</span>
        </div>

        <div className={styles.heroFileStack} aria-label="Example uploaded files">
          {heroUploadFiles.map((fileName, index) => (
            <div
              className={`${styles.heroFileRow} ${
                index === 0 ? styles.heroFileRowActive : ""
              }`}
              key={fileName}
            >
              <span className={styles.fileIcon} aria-hidden="true" />
              <span>{fileName}</span>
            </div>
          ))}
        </div>
      </article>

      <span className={styles.heroPreviewFlow} aria-hidden="true" />

      <article className={`${styles.heroPreviewCard} ${styles.prepPreviewCard}`}>
        <div className={styles.heroPreviewCardHeader}>
          <div>
            <p className={styles.panelKicker}>RIA File Ops</p>
            <h2>Filing details prepared</h2>
          </div>
          <span className={styles.statusPill}>Review before filing</span>
        </div>

        <div className={styles.heroDetectedGrid}>
          {heroDetectedDetails.map((detail) => (
            <div className={styles.heroDetectedItem} key={detail.label}>
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </div>
          ))}
        </div>

        <div className={styles.heroSuggestion}>
          <span>Suggested name</span>
          <strong>Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf</strong>
        </div>

        <div className={styles.heroSuggestion}>
          <span>Destination</span>
          <strong>Clients / Jane Miller / Investments / Statements / Schwab</strong>
        </div>
      </article>

      <span className={styles.heroPreviewFlow} aria-hidden="true" />

      <article className={`${styles.heroPreviewCard} ${styles.folderPreviewCard}`}>
        <div className={styles.heroPreviewCardHeader}>
          <div>
            <p className={styles.panelKicker}>Clean Review Queue</p>
            <h2>Ready to approve</h2>
          </div>
        </div>

        <ol className={styles.heroFolderPath} aria-label="Clean client folder path">
          {heroFolderPath.map((folder, index) => (
            <li data-depth={index} key={folder}>
              <span className={styles.folderGlyph} aria-hidden="true" />
              <span>{folder}</span>
            </li>
          ))}
        </ol>
      </article>
    </section>
  );
}

function ManualCleanupSection() {
  return (
    <section className={styles.objectionSection} aria-labelledby="manual-cleanup">
      <div className={styles.objectionHeader}>
        <p className={styles.eyebrow}>Manual filing drag</p>
        <h2 id="manual-cleanup">
          Renaming every client upload takes time — and still drifts.
        </h2>
        <p>
          Every upload still has to be opened, identified, renamed, and moved.
          Done by hand, small variations creep in: dates get formatted
          differently, client names vary, account details get missed, and
          folders become harder to trust.
        </p>
      </div>

      <div className={styles.comparisonGrid}>
        <article className={`${styles.comparisonCard} ${styles.manualCard}`}>
          <div className={styles.comparisonCardHeader}>
            <div>
              <p className={styles.panelKicker}>Manual filing</p>
              <h3>One file becomes eight steps</h3>
            </div>
            <span className={styles.manualBadge}>Drift risk</span>
          </div>

          <ProcessSteps steps={manualCleanupSteps} tone="manual" />

          <div className={styles.driftGrid} aria-label="Manual inconsistency examples">
            {driftRisks.map((risk) => (
              <span key={risk}>{risk}</span>
            ))}
          </div>
        </article>

        <article className={`${styles.comparisonCard} ${styles.fileOpsCard}`}>
          <div className={styles.comparisonCardHeader}>
            <div>
              <p className={styles.panelKicker}>RIA File Ops</p>
              <h3>Name and folder prepared</h3>
            </div>
            <span className={styles.fileOpsBadge}>Team confirms</span>
          </div>

          <ProcessSteps steps={fileOpsSteps} tone="fileOps" />

          <div className={styles.confirmNote}>
            <span className={styles.confirmDot} aria-hidden="true" />
            <strong>Your team confirms the final move.</strong>
          </div>

          <div className={styles.namingPreview} aria-label="Before and suggested filename">
            <span>
              Before
              <strong>schwab-q2.pdf</strong>
            </span>
            <span>
              Suggested
              <strong>Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf</strong>
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}

function ProcessSteps({
  steps,
  tone,
}: {
  steps: string[];
  tone: "manual" | "fileOps";
}) {
  return (
    <ol className={styles.processList}>
      {steps.map((step, index) => (
        <li
          className={`${styles.processStep} ${
            tone === "manual" ? styles.manualStep : styles.fileOpsStep
          }`}
          key={step}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{step}</strong>
        </li>
      ))}
    </ol>
  );
}

function BatchDecisionsSection() {
  return (
    <section className={styles.batchSection} aria-labelledby="batch-decisions">
      <div className={styles.batchIntro}>
        <p className={styles.eyebrow}>Onboarding filing work</p>
        <h2 id="batch-decisions">
          One onboarding can create dozens of filing decisions.
        </h2>
        <p>
          New-client onboarding can bring in statements, forms, scans,
          insurance documents, plan paperwork, account statements, and tax
          files. Each upload needs the same filing answers.
        </p>

        <div className={styles.documentChips} aria-label="Example onboarding documents">
          {onboardingDocuments.map((documentType) => (
            <span key={documentType}>{documentType}</span>
          ))}
        </div>
      </div>

      <div className={styles.batchVisual}>
        <article className={styles.questionsCard}>
          <div className={styles.batchCardHeader}>
            <div>
              <p className={styles.panelKicker}>Each upload needs</p>
              <h3>Five filing answers</h3>
            </div>
            <span className={styles.batchCountBadge}>Per upload</span>
          </div>

          <ol className={styles.questionList}>
            {filingQuestions.map((question, index) => (
              <li className={styles.questionItem} key={question}>
                <span>Q{index + 1}</span>
                <strong>{question}</strong>
              </li>
            ))}
          </ol>
        </article>

        <article className={styles.estimateCard}>
          <div className={styles.estimateHeader}>
            <p className={styles.panelKicker}>Example scenario</p>
            <span>Example only</span>
          </div>

          <div className={styles.estimateMath} aria-label="30 documents times 2 to 4 minutes per file equals 1 to 2 hours">
            <span>30 documents</span>
            <strong>&times;</strong>
            <span>2&ndash;4 min each</span>
            <strong>=</strong>
            <span className={styles.estimateResult}>1&ndash;2 hours</span>
          </div>

          <p className={styles.estimateNote}>
            Example scenario only, not an industry statistic.
          </p>
        </article>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className={styles.workflowSection} id="workflow" aria-labelledby="workflow-heading">
      <div className={styles.workflowHeader}>
        <p className={styles.eyebrow}>Filing workflow</p>
        <h2 id="workflow-heading">From upload folder to clean client folder.</h2>
      </div>

      <div className={styles.workflowTrack} aria-label="RIA File Ops filing workflow steps">
        {workflowSteps.map((step, index) => (
          <article className={styles.workflowStep} key={step.title}>
            <span className={styles.workflowStepNumber}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FutureLayerSection() {
  return (
    <section
      className={styles.futureSection}
      id="coming-next"
      aria-labelledby="future-layer"
    >
      <div className={styles.futureIntro}>
        <p className={styles.eyebrow}>Coming next</p>
        <h2 id="future-layer">Clean filing is the first layer.</h2>
        <p>
          Once uploads are named, routed, and confirmed, RIA File Ops can help
          teams see what is missing, understand folder readiness, and prepare
          service work using details already inside the files.
        </p>
      </div>

      <div className={styles.futureCards}>
        {futureLayers.map((layer) => (
          <article className={styles.futureCard} key={layer.title}>
            <span className={styles.futureIcon} aria-hidden="true" />
            <h3>{layer.title}</h3>
            <p>{layer.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FAQSection() {
  return (
    <section className={styles.faqSection} id="faq" aria-labelledby="faq-heading">
      <div className={styles.faqIntro}>
        <p className={styles.eyebrow}>Operational FAQ</p>
        <h2 id="faq-heading">Practical answers before you join.</h2>
        <p>
          A short read on how filing works, what your team controls, and what is
          available now.
        </p>
      </div>

      <FAQAccordion items={faqItems} />
    </section>
  );
}

function FinalCTASection({ waitlistHref }: WaitlistLinkProps) {
  return (
    <section className={styles.finalCtaSection} aria-labelledby="final-cta">
      <div className={styles.finalCtaCard}>
        <p className={styles.eyebrow}>Ready to clean up uploads?</p>
        <h2 id="final-cta">Join the private RIA File Ops waitlist.</h2>
        <p className={styles.finalCtaSupport}>
          Help shape document intelligence for real RIA operations: messy
          uploads, file cleanup, client signals, and reviewable advisor workflow
          prep.
        </p>

        <div className={styles.finalCtaActions}>
          <Link className={styles.primaryAction} href={waitlistHref}>
            Join Waitlist
          </Link>
        </div>
      </div>
    </section>
  );
}
