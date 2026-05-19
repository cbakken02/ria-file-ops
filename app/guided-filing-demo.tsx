"use client";

import type { DragEvent, ReactNode } from "react";
import { useState } from "react";
import styles from "./page.module.css";

const guidedDemoSteps = [
  {
    action: "Upload sample file",
    copy: "A client uploads a document with a generic name.",
    id: "upload",
    label: "Upload",
    title: "A messy upload lands in the folder.",
  },
  {
    action: "Identify document",
    copy: "RIA File Ops detects the new file and prepares it for identification.",
    id: "detect",
    label: "Detect",
    title: "RIA File Ops sees the new upload.",
  },
  {
    action: "Review filing details",
    copy: "The document is read and the key filing details are pulled forward.",
    id: "identify",
    label: "Identify",
    title: "The document type and account details are identified.",
  },
  {
    action: "Approve & File",
    copy: "Your team reviews the suggested name and folder before anything moves.",
    id: "review",
    label: "Review",
    title: "Review the prepared filing details.",
  },
  {
    action: "Replay demo",
    copy: "The file is renamed and placed in the right client folder.",
    id: "filed",
    label: "Filed",
    title: "The upload becomes a clean filed document.",
  },
] as const;

const detectedDetails = [
  ["Detected", "Schwab IRA Statement"],
  ["Client", "Jane Miller"],
  ["Custodian", "Schwab"],
  ["Account type", "IRA"],
  ["Account ending", "1234"],
  ["Period", "April 2026"],
] as const;

const suggestedFilename =
  "Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf";
const suggestedDestination =
  "Clients / Jane Miller / Investments / Statements / Schwab";

export function GuidedFilingDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [uploadDropped, setUploadDropped] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [showEditNote, setShowEditNote] = useState(false);
  const [isEditingReview, setIsEditingReview] = useState(false);
  const [editedFilename, setEditedFilename] = useState(suggestedFilename);
  const [editedDestination, setEditedDestination] =
    useState(suggestedDestination);
  const step = guidedDemoSteps[activeStep];
  const isUploadStep = step.id === "upload";
  const isReviewStep = step.id === "review";
  const isFiledStep = step.id === "filed";
  const filingFilename = editedFilename.trim() || suggestedFilename;
  const filingDestination = editedDestination.trim() || suggestedDestination;
  const stepTitle =
    isUploadStep && !uploadDropped
      ? "Drag statement.pdf into Client Uploads."
      : step.title;
  const stepCopy =
    isUploadStep && !uploadDropped
      ? "Move the sample file into the upload folder. This is a simulated drop, not a real upload."
      : step.copy;
  const stepStatus = isFiledStep
    ? "Filed cleanly"
    : isUploadStep && uploadDropped
      ? "File landed"
      : step.id === "detect"
        ? "New upload detected"
        : "Simulated demo";
  const primaryActionLabel =
    isUploadStep
      ? uploadDropped
        ? "Detect upload"
        : "Drop sample file"
      : step.action;

  function resetDemo() {
    setActiveStep(0);
    setUploadDropped(false);
    setUploadDragActive(false);
    setShowEditNote(false);
    setIsEditingReview(false);
    setEditedFilename(suggestedFilename);
    setEditedDestination(suggestedDestination);
  }

  function advanceDemo() {
    if (isFiledStep) {
      resetDemo();
      return;
    }

    if (isUploadStep && !uploadDropped) {
      setUploadDropped(true);
      setUploadDragActive(false);
      return;
    }

    setActiveStep((currentStep) =>
      Math.min(currentStep + 1, guidedDemoSteps.length - 1),
    );
    setShowEditNote(false);
    setIsEditingReview(false);
  }

  function toggleEditableState() {
    if (isEditingReview) {
      setIsEditingReview(false);
      setShowEditNote(true);
      return;
    }

    setIsEditingReview(true);
    setShowEditNote(false);
  }

  function handleUploadDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "statement.pdf");
  }

  function handleUploadDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setUploadDragActive(true);
  }

  function handleUploadDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setUploadDragActive(false);
  }

  function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setUploadDropped(true);
    setUploadDragActive(false);
  }

  return (
    <section
      className={styles.guidedDemoSection}
      id="guided-demo"
      aria-labelledby="guided-demo-heading"
    >
      <div className={styles.guidedDemoHeader}>
        <p className={styles.eyebrow}>Guided filing demo</p>
        <h2 id="guided-demo-heading">See how one upload gets filed.</h2>
        <p>
          Walk through how RIA File Ops detects a messy upload, prepares the
          filing details, and lets your team approve the final move.
        </p>
      </div>

      <div className={styles.guidedDemoShell}>
        <ol className={styles.guidedDemoProgress} aria-label="Filing demo steps">
          {guidedDemoSteps.map((progressStep, index) => (
            <li
              className={
                index === activeStep
                  ? styles.guidedDemoProgressActive
                  : index < activeStep
                    ? styles.guidedDemoProgressComplete
                    : undefined
              }
              aria-current={index === activeStep ? "step" : undefined}
              key={progressStep.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{progressStep.label}</strong>
            </li>
          ))}
        </ol>

        <div className={styles.guidedDemoStage}>
          <div className={styles.guidedDemoCopy}>
            <p className={styles.panelKicker}>Step {activeStep + 1}</p>
            <h3>{stepTitle}</h3>
            <p>{stepCopy}</p>
            <span className={styles.guidedDemoStatus}>{stepStatus}</span>
          </div>

          <div className={styles.guidedDemoVisual} aria-live="polite">
            {step.id === "upload" ? (
              <UploadStepVisual
                isDragActive={uploadDragActive}
                isDropped={uploadDropped}
                onDragEnd={() => setUploadDragActive(false)}
                onDragLeave={handleUploadDragLeave}
                onDragOver={handleUploadDragOver}
                onDragStart={handleUploadDragStart}
                onDrop={handleUploadDrop}
              />
            ) : null}
            {step.id === "detect" ? <DetectStepVisual /> : null}
            {step.id === "identify" ? <IdentifyStepVisual /> : null}
            {step.id === "review" ? (
              <ReviewStepVisual
                destination={editedDestination}
                filename={editedFilename}
                isEditing={isEditingReview}
                onDestinationChange={setEditedDestination}
                onFilenameChange={setEditedFilename}
                showEditNote={showEditNote}
              />
            ) : null}
            {step.id === "filed" ? (
              <FiledStepVisual
                destination={filingDestination}
                filename={filingFilename}
              />
            ) : null}
          </div>
        </div>

        <div className={styles.guidedDemoActions}>
          <button
            className={styles.guidedDemoPrimaryAction}
            type="button"
            onClick={advanceDemo}
          >
            {primaryActionLabel}
          </button>
          {isReviewStep ? (
            <button
              className={styles.guidedDemoSecondaryAction}
              type="button"
              onClick={toggleEditableState}
            >
              {isEditingReview ? "Save Details" : "Edit Details"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function UploadStepVisual({
  isDragActive,
  isDropped,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
}: {
  isDragActive: boolean;
  isDropped: boolean;
  onDragEnd: () => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={styles.guidedUploadScene}>
      <div className={styles.guidedUploadSource}>
        <p className={styles.panelKicker}>Client side</p>
        <div
          aria-label="statement.pdf sample file. Drag it into the Client Uploads folder."
          className={`${styles.guidedFileCard} ${
            isDropped ? styles.guidedFileCardDimmed : styles.guidedFileCardPulse
          }`}
          draggable={!isDropped}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          role="img"
        >
          <span className={styles.fileIcon} aria-hidden="true" />
          <div>
            <strong>statement.pdf</strong>
            <span>{isDropped ? "Sent to upload folder" : "Drag into folder"}</span>
          </div>
        </div>
      </div>

      <span className={styles.guidedUploadArrow} aria-hidden="true" />

      <FolderShell title="Client Uploads" badge="ShareFile-style folder">
        <div
          aria-label="Client Uploads drop zone"
          className={`${styles.guidedDropZone} ${
            isDragActive ? styles.guidedDropZoneActive : ""
          } ${isDropped ? styles.guidedDropZoneFilled : ""}`}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          role="region"
        >
          {isDropped ? (
            <div className={`${styles.guidedFileCard} ${styles.guidedFileCardLanded}`}>
              <span className={styles.fileIcon} aria-hidden="true" />
              <div>
                <strong>statement.pdf</strong>
                <span>Now in Client Uploads</span>
              </div>
            </div>
          ) : (
            <div className={styles.guidedDropHint}>
              <span className={styles.fileIcon} aria-hidden="true" />
              <strong>Drop statement.pdf here</strong>
              <span>Client upload folder</span>
            </div>
          )}
        </div>
      </FolderShell>
    </div>
  );
}

function DetectStepVisual() {
  return (
    <div className={styles.guidedDetectScene}>
      <FolderShell title="Client Uploads" badge="1 new file">
        <div className={styles.guidedFileCard}>
          <span className={styles.fileIcon} aria-hidden="true" />
          <div>
            <strong>statement.pdf</strong>
            <span>Waiting for filing prep</span>
          </div>
        </div>
      </FolderShell>
      <div className={styles.guidedScanCard}>
        <span className={styles.guidedScanBeam} aria-hidden="true" />
        <p className={styles.panelKicker}>RIA File Ops</p>
        <strong>New upload detected.</strong>
        <span>Ready to identify document type.</span>
      </div>
    </div>
  );
}

function IdentifyStepVisual() {
  return (
    <div className={styles.guidedIdentifyCard}>
      <p className={styles.panelKicker}>Detected details</p>
      <div className={styles.guidedDetailsGrid}>
        {detectedDetails.map(([label, value]) => (
          <div className={styles.guidedDetailItem} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewStepVisual({
  destination,
  filename,
  isEditing,
  onDestinationChange,
  onFilenameChange,
  showEditNote,
}: {
  destination: string;
  filename: string;
  isEditing: boolean;
  onDestinationChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  showEditNote: boolean;
}) {
  return (
    <div className={styles.guidedReviewMockup}>
      <div className={styles.guidedDocumentPreview}>
        <div className={styles.guidedDocumentChrome}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.guidedDocumentPage}>
          <div className={styles.guidedStatementBrand}>
            <strong>Schwab</strong>
            <span>IRA Account Statement</span>
          </div>

          <div className={styles.guidedStatementMeta}>
            <span>Statement period</span>
            <strong>April 1-30, 2026</strong>
          </div>

          <div className={styles.guidedStatementBlock}>
            <span>Account owner</span>
            <div className={styles.guidedHighlight}>Jane Miller</div>
          </div>

          <div className={styles.guidedStatementBlock}>
            <span>Account number</span>
            <div className={styles.guidedHighlight}>IRA ending 1234</div>
          </div>

          <div className={styles.guidedStatementTable} aria-hidden="true">
            <div>
              <span>Opening value</span>
              <strong>$248,450.28</strong>
            </div>
            <div>
              <span>Contributions</span>
              <strong>$0.00</strong>
            </div>
            <div>
              <span>Ending value</span>
              <strong>$251,982.44</strong>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.guidedReviewDetails}>
        <p className={styles.panelKicker}>Review before filing</p>
        <div className={styles.guidedReviewFields}>
          {detectedDetails.map(([label, value]) => (
            <div className={styles.guidedReviewField} key={label}>
              <span>{label === "Account ending" ? "Account" : label}</span>
              <strong>
                {label === "Account ending" ? "IRA ending 1234" : value}
              </strong>
            </div>
          ))}
        </div>

        {isEditing ? (
          <div className={styles.guidedReviewEditFields}>
            <label className={styles.guidedReviewEditable}>
              <span>Suggested filename</span>
              <textarea
                aria-label="Suggested filename"
                onChange={(event) => onFilenameChange(event.target.value)}
                rows={2}
                value={filename}
              />
            </label>
            <label className={styles.guidedReviewEditable}>
              <span>Suggested destination</span>
              <textarea
                aria-label="Suggested destination"
                onChange={(event) => onDestinationChange(event.target.value)}
                rows={2}
                value={destination}
              />
            </label>
          </div>
        ) : (
          <>
            <div className={styles.guidedReviewSuggestion}>
              <span>Suggested filename</span>
              <strong>{filename.trim() || suggestedFilename}</strong>
            </div>
            <div className={styles.guidedReviewSuggestion}>
              <span>Suggested destination</span>
              <strong>{destination.trim() || suggestedDestination}</strong>
            </div>
          </>
        )}

        {showEditNote ? (
          <div className={styles.guidedEditNote} role="status">
            Fields can be adjusted before filing. Your team still approves the
            final move.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FiledStepVisual({
  destination,
  filename,
}: {
  destination: string;
  filename: string;
}) {
  const folderTree = [
    ...destination
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean),
    filename,
  ];

  return (
    <div className={styles.guidedFiledCard}>
      <div className={styles.guidedFiledHeader}>
        <p className={styles.panelKicker}>Clean client folder</p>
        <span>Filed cleanly</span>
      </div>
      <ol className={styles.guidedFolderTree} aria-label="Filed document location">
        {folderTree.map((item, index) => (
          <li
            className={
              index === folderTree.length - 1
                ? styles.guidedFolderFile
                : undefined
            }
            data-depth={Math.min(index, 4)}
            key={`${item}-${index}`}
          >
            <span className={styles.folderGlyph} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FolderShell({
  badge,
  children,
  title,
}: {
  badge: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className={styles.guidedFolderShell}>
      <div className={styles.guidedFolderHeader}>
        <p className={styles.panelKicker}>{title}</p>
        <span>{badge}</span>
      </div>
      <div className={styles.guidedFolderBody}>{children}</div>
    </div>
  );
}
