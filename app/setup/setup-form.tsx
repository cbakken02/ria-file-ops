"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddStorageConnectionButton } from "@/components/add-storage-connection-button";
import type { GoogleDriveFile } from "@/lib/google-drive";
import {
  getDefaultNamingConventionSummary,
  serializeNamingRules,
  type NamingRulesConfig,
} from "@/lib/naming-rules";
import {
  REVIEW_RULE_OPTIONS,
  type ReviewRuleValue,
} from "@/lib/setup-config";
import { serializeFolderTemplate } from "@/lib/setup-config";
import {
  removeStorageConnectionAction,
  saveFirmSettings,
  type SaveSettingsState,
} from "./actions";
import { NamingRulesEditor } from "./naming-rules-editor";
import styles from "./page.module.css";

type Props = {
  driveConnected: boolean;
  driveFolders: GoogleDriveFile[];
  initialDialog: "data-handling" | null;
  initialSection: SettingsSectionId;
  initialSettings: {
    firmName: string;
    namingRules: NamingRulesConfig;
    sourceFolderValue: string;
    destinationFolderValue: string;
    folderTemplate: string[];
    reviewRule: ReviewRuleValue;
  };
  notice: string | null;
  activeStorageConnection: {
    accountEmail: string | null;
    accountName: string | null;
    connectedDriveLabel: string;
    id: string;
    isPrimary: boolean;
    provider: string;
    providerLabel: string;
    statusLabel: string;
    writableLabel: string;
  } | null;
  storageConnections: Array<{
    accountEmail: string | null;
    accountName: string | null;
    id: string;
    isPrimary: boolean;
    provider: string;
  }>;
};

type SettingsSectionId =
  | "general"
  | "storage"
  | "naming"
  | "intake"
  | "cleanup"
  | "security";

type SettingsEditorId =
  | "firm"
  | "destination"
  | "folderTemplate"
  | "source"
  | "reviewRule"
  | "dataHandling";

const initialActionState: SaveSettingsState = {
  status: "idle",
  message: "",
};

const sectionDefinitions: Array<{
  id: SettingsSectionId;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "storage", label: "Storage connections" },
  { id: "naming", label: "Naming conventions" },
  { id: "intake", label: "Intake" },
  { id: "cleanup", label: "Cleanup" },
  { id: "security", label: "Security" },
];

export function SetupForm({
  driveConnected,
  driveFolders,
  initialDialog,
  initialSection,
  initialSettings,
  notice,
  activeStorageConnection,
  storageConnections,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastSubmittedSnapshotRef = useRef<string>("");
  const [isAutoSaving, startAutoSaveTransition] = useTransition();
  const [isRemovingStorage, startStorageRemovalTransition] = useTransition();
  const [actionState, formAction] = useActionState(
    saveFirmSettings,
    initialActionState,
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [firmName, setFirmName] = useState(initialSettings.firmName);
  const [namingRules, setNamingRules] = useState(initialSettings.namingRules);
  const [sourceFolderValue, setSourceFolderValue] = useState(
    initialSettings.sourceFolderValue,
  );
  const [destinationFolderValue, setDestinationFolderValue] = useState(
    initialSettings.destinationFolderValue,
  );
  const [folderTemplate, setFolderTemplate] = useState(
    initialSettings.folderTemplate,
  );
  const [reviewRule, setReviewRule] = useState<ReviewRuleValue>(
    initialSettings.reviewRule,
  );
  const [activeEditor, setActiveEditor] = useState<SettingsEditorId | null>(null);
  const [pendingStorageRemoval, setPendingStorageRemoval] = useState<
    Props["activeStorageConnection"]
  >(null);
  const [storageRemovalError, setStorageRemovalError] = useState<string | null>(
    null,
  );

  const sourceFolderName = getFolderLabel(sourceFolderValue) || "Not set";
  const destinationFolderName = getFolderLabel(destinationFolderValue) || "Not set";
  const folderTemplateSummary = summarizeFolderTemplate(folderTemplate);
  const activeSectionMeta = sectionDefinitions.find(
    (section) => section.id === activeSection,
  );
  const currentSnapshot = useMemo(
    () => ({
      destinationFolderValue,
      firmName: firmName.trim(),
      folderTemplate: serializeFolderTemplate(folderTemplate),
      namingRules: serializeNamingRules(namingRules),
      reviewRule,
      sourceFolderValue,
    }),
    [
      destinationFolderValue,
      firmName,
      folderTemplate,
      namingRules,
      reviewRule,
      sourceFolderValue,
    ],
  );
  const savedSnapshot = useMemo(
    () => ({
      destinationFolderValue:
        actionState.savedSettings?.destinationFolderValue ??
        initialSettings.destinationFolderValue,
      firmName:
        actionState.savedSettings?.firmName?.trim() ??
        initialSettings.firmName.trim(),
      folderTemplate: serializeFolderTemplate(
        actionState.savedSettings?.folderTemplate ?? initialSettings.folderTemplate,
      ),
      namingRules: serializeNamingRules(
        actionState.savedSettings?.namingRules ?? initialSettings.namingRules,
      ),
      reviewRule:
        actionState.savedSettings?.reviewRule ?? initialSettings.reviewRule,
      sourceFolderValue:
        actionState.savedSettings?.sourceFolderValue ??
        initialSettings.sourceFolderValue,
    }),
    [
      actionState.savedSettings,
      initialSettings.destinationFolderValue,
      initialSettings.firmName,
      initialSettings.folderTemplate,
      initialSettings.namingRules,
      initialSettings.reviewRule,
      initialSettings.sourceFolderValue,
    ],
  );
  const currentSnapshotKey = JSON.stringify(currentSnapshot);
  const savedSnapshotKey = JSON.stringify(savedSnapshot);
  const isDirty = currentSnapshotKey !== savedSnapshotKey;

  useEffect(() => {
    if (!isDirty) {
      lastSubmittedSnapshotRef.current = savedSnapshotKey;
      return;
    }

    if (!formRef.current || isAutoSaving) {
      return;
    }

    if (lastSubmittedSnapshotRef.current === currentSnapshotKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!formRef.current) {
        return;
      }

      lastSubmittedSnapshotRef.current = currentSnapshotKey;
      startAutoSaveTransition(() => {
        formAction(new FormData(formRef.current!));
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [currentSnapshotKey, formAction, isAutoSaving, isDirty, savedSnapshotKey]);

  function closeSettings() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/dashboard");
  }

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (initialDialog === "data-handling") {
      setActiveEditor("dataHandling");
    }
  }, [initialDialog]);

  return (
    <form action={formAction} className={styles.settingsOverlay} ref={formRef}>
      <button
        aria-label="Close settings"
        className={styles.settingsBackdrop}
        onClick={closeSettings}
        type="button"
      />

      <div
        className={styles.settingsShell}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className={styles.settingsSidebar}>
          <div className={styles.settingsSidebarHeader}>
            <button
              className={styles.settingsCloseButton}
              onClick={closeSettings}
              type="button"
            >
              ×
            </button>
          </div>

          <nav className={styles.settingsNav}>
            {sectionDefinitions.map((section) => {
              const isActive = section.id === activeSection;

              return (
                <button
                  key={section.id}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? styles.activeSettingsNavItem
                      : styles.settingsNavItem
                  }
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className={styles.settingsPane}>
        <header className={styles.settingsPaneHeader}>
          <div className={styles.settingsPaneHeaderContent}>
            <h2>{activeSectionMeta?.label ?? "Settings"}</h2>
            <p>{getSectionDescription(activeSection)}</p>
          </div>
          {activeSection === "storage" ? (
            <div className={styles.settingsPaneHeaderActions}>
              <AddStorageConnectionButton
                activeConnection={
                  activeStorageConnection
                    ? {
                        accountEmail: activeStorageConnection.accountEmail,
                        accountName: activeStorageConnection.accountName,
                        id: activeStorageConnection.id,
                        isPrimary: activeStorageConnection.isPrimary,
                        provider: activeStorageConnection.provider,
                      }
                    : null
                }
                existingConnections={storageConnections}
                variant="ghost"
              />
            </div>
          ) : null}
        </header>

        <div className={styles.settingsPaneBody}>
          {notice ? (
            <div className={styles.settingsNotice}>{notice}</div>
          ) : null}

          {activeSection === "general" ? (
            <div className={styles.sectionStack}>
              <div className={styles.settingsList}>
                <SettingsRowButton
                  label="Firm name"
                  onClick={() => setActiveEditor("firm")}
                  value={firmName || "Not set"}
                />
                <SettingsRowButton
                  label="Destination root"
                  onClick={() => setActiveEditor("destination")}
                  value={destinationFolderName}
                />
                <SettingsRowButton
                  label="Standard household folder structure"
                  onClick={() => setActiveEditor("folderTemplate")}
                  value={folderTemplateSummary}
                />
              </div>
            </div>
          ) : null}

          {activeSection === "storage" ? (
            <div className={styles.sectionStack}>
              <StorageConnectionsSection
                activeConnection={activeStorageConnection}
                onRemove={() => {
                  setStorageRemovalError(null);
                  setPendingStorageRemoval(activeStorageConnection);
                }}
              />
            </div>
          ) : null}

          {activeSection === "naming" ? (
            <div className={styles.sectionStack}>
              <NamingRulesEditor onChange={setNamingRules} value={namingRules} />
            </div>
          ) : null}

          {activeSection === "intake" ? (
            <div className={styles.sectionStack}>
              <div className={styles.settingsList}>
                <SettingsRowButton
                  label="Source folder"
                  onClick={() => setActiveEditor("source")}
                  value={sourceFolderName}
                />
                <SettingsRowButton
                  label="Auto-file rule"
                  onClick={() => setActiveEditor("reviewRule")}
                  value={reviewRuleOptionLabel(reviewRule)}
                />
              </div>
            </div>
          ) : null}

          {activeSection === "cleanup" ? (
            <div className={styles.sectionStack}>
              <div className={styles.settingsList}>
                <SettingsRowStatic
                  label="Shared conventions"
                  value="Uses the same naming conventions as Intake"
                />
                <SettingsRowStatic
                  label="Preview first"
                  value="Show the plan before anything changes"
                />
                <SettingsRowStatic
                  label="Shared structure"
                  value="Uses the same household folder structure for existing files"
                />
                <SettingsRowLink href="/cleanup" label="Cleanup tool" value="Open" />
              </div>
            </div>
          ) : null}

          {activeSection === "security" ? (
            <div className={styles.sectionStack}>
              <div className={styles.settingsList}>
                <SettingsRowButton
                  label="Data handling"
                  onClick={() => setActiveEditor("dataHandling")}
                  value="Open"
                />
                <SettingsRowLink
                  href="/history"
                  label="Audit history"
                  value="Open"
                />
              </div>
            </div>
          ) : null}
        </div>

        <input name="firmName" type="hidden" value={firmName} />
        <input name="reviewRule" type="hidden" value={reviewRule} />
        <input name="sourceFolder" type="hidden" value={sourceFolderValue} />
        <input
          name="destinationFolder"
          type="hidden"
          value={destinationFolderValue}
        />
        <input
          name="namingConvention"
          type="hidden"
          value={getDefaultNamingConventionSummary(namingRules)}
        />
        <input
          name="namingRules"
          type="hidden"
          value={serializeNamingRules(namingRules)}
        />
        <input
          name="folderTemplate"
          type="hidden"
          value={serializeFolderTemplate(folderTemplate)}
        />

        <footer className={styles.settingsPaneFooter}>
          {actionState.status === "error" ? (
            <div className={styles.errorMessage}>{actionState.message}</div>
          ) : (
            <div className={styles.footerHint}>
              <span>
                {isAutoSaving
                  ? "Saving changes..."
                  : isDirty
                    ? "Changes save automatically"
                    : "All changes saved"}
              </span>
              <strong>{activeSectionMeta?.label}</strong>
            </div>
          )}
        </footer>
        </section>

        {activeEditor === "firm" ? (
          <FirmNameEditorModal
            initialValue={firmName}
            onApply={setFirmName}
            onClose={() => setActiveEditor(null)}
          />
        ) : null}

        {activeEditor === "destination" ? (
          <FolderSelectionEditorModal
            description="Choose where organized client records should live."
            emptyLabel="No destination root selected yet"
            folders={driveFolders}
            label="Destination root"
            onApply={setDestinationFolderValue}
            onClose={() => setActiveEditor(null)}
            selectedValue={destinationFolderValue}
            showDisabledState={!driveConnected}
          />
        ) : null}

        {activeEditor === "source" ? (
          <FolderSelectionEditorModal
            description="Choose the folder where new client uploads arrive."
            emptyLabel="No source folder selected yet"
            folders={driveFolders}
            label="Source folder"
            onApply={setSourceFolderValue}
            onClose={() => setActiveEditor(null)}
            selectedValue={sourceFolderValue}
            showDisabledState={!driveConnected}
          />
        ) : null}

        {activeEditor === "folderTemplate" ? (
          <FolderTemplateEditorModal
            initialValue={folderTemplate}
            onApply={setFolderTemplate}
            onClose={() => setActiveEditor(null)}
          />
        ) : null}

        {activeEditor === "reviewRule" ? (
          <ReviewRuleEditorModal
            initialValue={reviewRule}
            onApply={setReviewRule}
            onClose={() => setActiveEditor(null)}
          />
        ) : null}

        {activeEditor === "dataHandling" ? (
          <DataHandlingModal onClose={() => setActiveEditor(null)} />
        ) : null}

        {pendingStorageRemoval ? (
          <StorageRemovalEditorModal
            connection={pendingStorageRemoval}
            errorMessage={storageRemovalError}
            isRemoving={isRemovingStorage}
            onClose={() => {
              if (isRemovingStorage) {
                return;
              }

              setStorageRemovalError(null);
              setPendingStorageRemoval(null);
            }}
            onConfirm={() => {
              setStorageRemovalError(null);
              startStorageRemovalTransition(async () => {
                const result = await removeStorageConnectionAction(
                  pendingStorageRemoval.id,
                );

                if (result.status === "error") {
                  setStorageRemovalError(result.message);
                  return;
                }

                setPendingStorageRemoval(null);
                router.refresh();
              });
            }}
          />
        ) : null}
      </div>
    </form>
  );
}

type FolderPickerProps = {
  description: string;
  emptyLabel: string;
  folders: GoogleDriveFile[];
  label: string;
  onSelect: (value: string) => void;
  selectedValue: string;
  showDisabledState: boolean;
};

function FolderPicker({
  description,
  emptyLabel,
  folders,
  label,
  onSelect,
  selectedValue,
  showDisabledState,
}: FolderPickerProps) {
  const [query, setQuery] = useState("");
  const selectedFolderName = selectedValue.split("::")[1] ?? "";
  const filteredFolders = useMemo(() => filterFolders(folders, query), [folders, query]);

  return (
    <div className={styles.field}>
      <div className={styles.pickerHeader}>
        <span>{label}</span>
        <p>{description}</p>
      </div>

      <div className={styles.pickerShell}>
        <div className={styles.selectedFolderCard}>
          <strong>{selectedFolderName || emptyLabel}</strong>
          <p>
            {selectedFolderName
              ? "This selection will be used the next time the app runs."
              : "Pick a folder from the searchable list below."}
          </p>
        </div>

        {showDisabledState ? (
          <div className={styles.disabledPicker}>
            Connect storage first to browse folders here.
          </div>
        ) : (
          <>
            <input
              className={styles.searchInput}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search folders"
              type="text"
              value={query}
            />
            <div className={styles.folderList}>
              {filteredFolders.slice(0, 12).map((folder) => {
                const folderValue = `${folder.id}::${folder.name}`;
                const isSelected = folderValue === selectedValue;

                return (
                  <button
                    key={folder.id}
                    className={`${styles.folderOption} ${
                      isSelected ? styles.folderOptionActive : ""
                    }`}
                    onClick={() => onSelect(folderValue)}
                    type="button"
                  >
                    <span>{folder.name}</span>
                    <small>{isSelected ? "Selected" : "Choose"}</small>
                  </button>
                );
              })}

              {!filteredFolders.length ? (
                <div className={styles.emptyFolders}>
                  No folders match that search.
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function moveItem(list: string[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;

  if (nextIndex < 0 || nextIndex >= list.length) {
    return list;
  }

  const cloned = [...list];
  const [item] = cloned.splice(index, 1);
  cloned.splice(nextIndex, 0, item);
  return cloned;
}

function SettingsRowButton({
  label,
  onClick,
  value,
}: {
  label: string;
  onClick: () => void;
  value: string;
}) {
  return (
    <button className={styles.settingsRowButton} onClick={onClick} type="button">
      <span className={styles.settingsRowLabel}>{label}</span>
      <span className={styles.settingsRowValue}>{value}</span>
      <span className={styles.settingsRowChevron}>›</span>
    </button>
  );
}

function SettingsRowStatic({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.settingsRowStatic}>
      <span className={styles.settingsRowLabel}>{label}</span>
      <span className={styles.settingsRowValue}>{value}</span>
    </div>
  );
}

function SettingsRowLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  return (
    <Link className={styles.settingsRowLink} href={href}>
      <span className={styles.settingsRowLabel}>{label}</span>
      <span className={styles.settingsRowValue}>{value}</span>
      <span className={styles.settingsRowChevron}>›</span>
    </Link>
  );
}

function StorageConnectionsSection({
  activeConnection,
  onRemove,
}: {
  activeConnection: Props["activeStorageConnection"];
  onRemove: () => void;
}) {
  if (!activeConnection) {
    return (
      <div className={styles.settingsList}>
        <div className={styles.storageEmptyState}>
          <strong>No storage connected</strong>
          <p>Add a storage connection to browse folders, run Intake, and clean up files.</p>
        </div>
      </div>
    );
  }

  const connectedAccount =
    activeConnection.accountEmail ??
    activeConnection.accountName ??
    "Connected account";

  return (
    <div className={styles.settingsList}>
      <details className={styles.storageConnectionDetails}>
        <summary className={styles.storageConnectionSummary}>
          <div className={styles.storageConnectionPrimary}>
            <strong>{activeConnection.providerLabel}</strong>
            <span>Active workspace</span>
          </div>

          <div className={styles.storageConnectionSecondary}>
            <strong>{activeConnection.connectedDriveLabel}</strong>
            <span>{activeConnection.statusLabel}</span>
          </div>

          <span className={styles.storageConnectionChevron}>›</span>
        </summary>

        <div className={styles.storageConnectionExpanded}>
          <div className={styles.settingsList}>
            <SettingsRowStatic label="Status" value={activeConnection.statusLabel} />
            <SettingsRowStatic label="Connected drive" value={activeConnection.connectedDriveLabel} />
            <SettingsRowStatic label="Connected account" value={connectedAccount} />
            <button
              className={styles.settingsDangerRowButton}
              onClick={onRemove}
              type="button"
            >
              <span className={styles.settingsRowLabel}>Remove storage</span>
              <span className={styles.settingsDangerValue}>Delete</span>
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function StorageRemovalEditorModal({
  connection,
  errorMessage,
  isRemoving,
  onClose,
  onConfirm,
}: {
  connection: NonNullable<Props["activeStorageConnection"]>;
  errorMessage: string | null;
  isRemoving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <EditorModalShell onClose={onClose} title="Remove storage">
      <div className={styles.confirmationCopy}>
        <p>Are you sure you want to remove access to this storage?</p>
        <strong>{connection.providerLabel}</strong>
        <span>{connection.connectedDriveLabel}</span>
      </div>

      {errorMessage ? (
        <div className={styles.errorMessage}>{errorMessage}</div>
      ) : null}

      <div className={styles.editorActions}>
        <button
          className={styles.secondaryAction}
          disabled={isRemoving}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className={styles.destructiveAction}
          disabled={isRemoving}
          onClick={onConfirm}
          type="button"
        >
          {isRemoving ? "Removing..." : "Yes, remove"}
        </button>
      </div>
    </EditorModalShell>
  );
}

function FirmNameEditorModal({
  initialValue,
  onApply,
  onClose,
}: {
  initialValue: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const [draftValue, setDraftValue] = useState(initialValue);

  return (
    <EditorModalShell onClose={onClose} title="Firm name">
      <label className={styles.field}>
        <span>Firm name</span>
        <input
          onChange={(event) => setDraftValue(event.target.value)}
          placeholder="Legacy Link"
          type="text"
          value={draftValue}
        />
      </label>
      <div className={styles.editorActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={styles.primaryAction}
          onClick={() => {
            onApply(draftValue);
            onClose();
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </EditorModalShell>
  );
}

function FolderSelectionEditorModal({
  description,
  emptyLabel,
  folders,
  label,
  onApply,
  onClose,
  selectedValue,
  showDisabledState,
}: Omit<FolderPickerProps, "onSelect"> & {
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(selectedValue);

  return (
    <EditorModalShell onClose={onClose} title={label}>
      <FolderPicker
        description={description}
        emptyLabel={emptyLabel}
        folders={folders}
        label={label}
        onSelect={setDraftValue}
        selectedValue={draftValue}
        showDisabledState={showDisabledState}
      />
      <div className={styles.editorActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={styles.primaryAction}
          onClick={() => {
            onApply(draftValue);
            onClose();
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </EditorModalShell>
  );
}

function FolderTemplateEditorModal({
  initialValue,
  onApply,
  onClose,
}: {
  initialValue: string[];
  onApply: (value: string[]) => void;
  onClose: () => void;
}) {
  const [draftValue, setDraftValue] = useState(initialValue);

  return (
    <EditorModalShell
      onClose={onClose}
      title="Standard household folder structure"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h3>Household folder structure</h3>
        </div>
        <button
          className={styles.addRowButton}
          onClick={() => setDraftValue((current) => [...current, "New Folder"])}
          type="button"
        >
          Add folder
        </button>
      </div>

      <div className={styles.folderTree}>
        {draftValue.map((folderName, index) => (
          <div key={`${index}-${folderName}`} className={styles.folderRow}>
            <div className={styles.folderGlyph} aria-hidden="true">
              /
            </div>
            <input
              className={styles.folderInput}
              onChange={(event) =>
                setDraftValue((current) =>
                  current.map((value, valueIndex) =>
                    valueIndex === index ? event.target.value : value,
                  ),
                )
              }
              type="text"
              value={folderName}
            />
            <div className={styles.rowActions}>
              <button
                className={styles.rowAction}
                disabled={index === 0}
                onClick={() => setDraftValue((current) => moveItem(current, index, -1))}
                type="button"
              >
                Up
              </button>
              <button
                className={styles.rowAction}
                disabled={index === draftValue.length - 1}
                onClick={() => setDraftValue((current) => moveItem(current, index, 1))}
                type="button"
              >
                Down
              </button>
              <button
                className={styles.rowAction}
                disabled={draftValue.length <= 1}
                onClick={() =>
                  setDraftValue((current) =>
                    current.filter((_, valueIndex) => valueIndex !== index),
                  )
                }
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.editorActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={styles.primaryAction}
          onClick={() => {
            onApply(draftValue);
            onClose();
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </EditorModalShell>
  );
}

function ReviewRuleEditorModal({
  initialValue,
  onApply,
  onClose,
}: {
  initialValue: ReviewRuleValue;
  onApply: (value: ReviewRuleValue) => void;
  onClose: () => void;
}) {
  const [draftValue, setDraftValue] = useState<ReviewRuleValue>(initialValue);

  return (
    <EditorModalShell
      modalClassName={styles.editorModalWide}
      onClose={onClose}
      title="Auto-file rule"
    >
      <div className={styles.editorIntro}>
        Choose whether Intake should move files automatically or send them to
        review first.
      </div>
      <div className={styles.settingsList}>
        {REVIEW_RULE_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={styles.modalRowButton}
            onClick={() => setDraftValue(option.value)}
            type="button"
          >
            <span className={styles.modalRowCopy}>
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </span>
            <span
              className={
                draftValue === option.value
                  ? `${styles.modalRowState} ${styles.modalRowStateActive}`
                  : styles.modalRowState
              }
            >
              {draftValue === option.value ? "Selected" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.editorActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={styles.primaryAction}
          onClick={() => {
            onApply(draftValue);
            onClose();
          }}
          type="button"
        >
          Done
        </button>
      </div>
    </EditorModalShell>
  );
}

function DataHandlingModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <EditorModalShell onClose={onClose} title="Data handling">
      <div className={styles.infoSectionList}>
        <section className={styles.infoSection}>
          <strong>Files stay in connected storage</strong>
          <p>
            Source documents remain in the connected storage system. The app renames
            or moves them there in place.
          </p>
        </section>

        <section className={styles.infoSection}>
          <strong>Access is controlled by storage OAuth</strong>
          <p>
            Read-only access supports preview and inspection. Writable access is
            required before the app can rename, move, or create folders.
          </p>
        </section>

        <section className={styles.infoSection}>
          <strong>The app stores operational metadata</strong>
          <p>
            Firm settings, review decisions, learned aliases, and audit history are
            stored by the app to support review, filing, and export.
          </p>
        </section>

        <section className={styles.infoSection}>
          <strong>Current state</strong>
          <p>
            This is still an MVP. It should not yet be represented as a finished
            enterprise security posture.
          </p>
        </section>

        <section className={styles.infoSection}>
          <strong>Planned production controls</strong>
          <p>
            The roadmap still includes stronger permissions, retention controls,
            hardened secret management, and formal security review.
          </p>
        </section>
      </div>

      <div className={styles.editorActions}>
        <button className={styles.primaryAction} onClick={onClose} type="button">
          Done
        </button>
      </div>
    </EditorModalShell>
  );
}

function EditorModalShell({
  children,
  modalClassName,
  onClose,
  title,
}: {
  children: React.ReactNode;
  modalClassName?: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className={styles.editorOverlay} onClick={onClose} role="presentation">
      <div
        className={
          modalClassName
            ? `${styles.editorModal} ${modalClassName}`
            : styles.editorModal
        }
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.editorHeader}>
          <h3>{title}</h3>
        </div>
        <div className={styles.editorBody}>{children}</div>
      </div>
    </div>
  );
}

function filterFolders(folders: GoogleDriveFile[], query: string) {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return folders;
  }

  return folders.filter((folder) =>
    folder.name.toLowerCase().includes(trimmed),
  );
}

function getFolderLabel(value: string) {
  return value.split("::")[1] ?? "";
}

function summarizeFolderTemplate(folderTemplate: string[]) {
  if (!folderTemplate.length) {
    return "No folders";
  }

  if (folderTemplate.length <= 3) {
    return folderTemplate.join(", ");
  }

  return `${folderTemplate.slice(0, 3).join(", ")} +${folderTemplate.length - 3}`;
}

function reviewRuleOptionLabel(reviewRule: ReviewRuleValue) {
  return (
    REVIEW_RULE_OPTIONS.find((option) => option.value === reviewRule)?.title ??
    REVIEW_RULE_OPTIONS[0].title
  );
}

function getSectionDescription(section: SettingsSectionId) {
  if (section === "general") {
    return "Firm and shared structure.";
  }

  if (section === "storage") {
    return "Connected accounts and active workspace.";
  }

  if (section === "naming") {
    return "Set a default filename pattern, then override it by document type.";
  }

  if (section === "intake") {
    return "How new uploads should behave.";
  }

  if (section === "cleanup") {
    return "Defaults for existing files and folders.";
  }

  return "Data handling and audit references.";
}
