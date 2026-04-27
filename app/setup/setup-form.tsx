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
    status: "connected" | "needs_reauth";
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
  | "workspace"
  | "rules"
  | "workflow"
  | "privacy";

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

type FolderLoadState = "idle" | "loading" | "loaded" | "error";
type WorkspaceOverviewTone = "ready" | "attention";

const sectionDefinitions: Array<{
  id: SettingsSectionId;
  label: string;
}> = [
  { id: "workspace", label: "Workspace Setup" },
  { id: "rules", label: "File Rules" },
  { id: "workflow", label: "Workflow" },
  { id: "privacy", label: "Privacy & Audit" },
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
  const [folderOptions, setFolderOptions] = useState<GoogleDriveFile[]>(driveFolders);
  const [folderLoadState, setFolderLoadState] = useState<FolderLoadState>(
    driveFolders.length > 0 ? "loaded" : "idle",
  );
  const [folderLoadError, setFolderLoadError] = useState<string | null>(null);
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

  const sourceFolderName = driveConnected
    ? getFolderLabel(sourceFolderValue) || "Not set"
    : "Reconnect storage";
  const destinationFolderName = driveConnected
    ? getFolderLabel(destinationFolderValue) || "Not set"
    : "Reconnect storage";
  const folderTemplateSummary = summarizeFolderTemplate(folderTemplate);
  const workspaceOverviewItems = [
    {
      detail: activeStorageConnection
        ? activeStorageConnection.connectedDriveLabel
        : "Connect storage to browse and file documents.",
      label: "Storage",
      status:
        activeStorageConnection?.status === "connected"
          ? "Connected"
          : "Needs setup",
      tone:
        activeStorageConnection?.status === "connected"
          ? ("ready" as const)
          : ("attention" as const),
      value: activeStorageConnection?.providerLabel ?? "No storage connected",
    },
    {
      detail: sourceFolderValue
        ? "New client uploads are read from this folder."
        : "Choose where new client uploads arrive.",
      label: "Upload source",
      status: driveConnected && sourceFolderValue ? "Set" : "Needs setup",
      tone:
        driveConnected && sourceFolderValue
          ? ("ready" as const)
          : ("attention" as const),
      value: sourceFolderName,
    },
    {
      detail: destinationFolderValue
        ? "Filed records are organized under this root."
        : "Choose where client records should live.",
      label: "Records destination",
      status: driveConnected && destinationFolderValue ? "Set" : "Needs setup",
      tone:
        driveConnected && destinationFolderValue
          ? ("ready" as const)
          : ("attention" as const),
      value: destinationFolderName,
    },
  ];
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

    const referrer = document.referrer ? new URL(document.referrer) : null;
    const isInternalReferrer =
      referrer && referrer.origin === window.location.origin;

    if (window.history.length > 1 && isInternalReferrer) {
      router.back();
      return;
    }

    router.push("/dashboard");
  }

  async function loadDriveFolders() {
    if (!driveConnected || folderLoadState === "loading") {
      return;
    }

    setFolderLoadState("loading");
    setFolderLoadError(null);

    try {
      const response = await fetch("/api/storage/folders");
      const payload = (await response.json()) as {
        error?: string;
        folders?: GoogleDriveFile[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Drive folders could not be loaded.");
      }

      setFolderOptions(Array.isArray(payload.folders) ? payload.folders : []);
      setFolderLoadState("loaded");
    } catch (error) {
      setFolderLoadState("error");
      setFolderLoadError(
        error instanceof Error ? error.message : "Drive folders could not be loaded.",
      );
    }
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
        </header>

        <div className={styles.settingsPaneBody}>
          {notice ? (
            <div className={styles.settingsNotice}>{notice}</div>
          ) : null}

          {activeSection === "workspace" ? (
            <div className={styles.sectionStack}>
              <WorkspaceOverview items={workspaceOverviewItems} />

              <SettingsGroup
                description="Name the firm or workspace shown throughout RIA File Ops."
                title="Firm profile"
              >
                <div className={styles.settingsList}>
                  <SettingsRowButton
                    label="Firm name"
                    onClick={() => setActiveEditor("firm")}
                    value={firmName || "Not set"}
                  />
                </div>
              </SettingsGroup>

              <SettingsGroup
                action={
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
                }
                description="Manage the storage account RIA File Ops reads from and files into."
                title="Connected storage"
              >
                <StorageConnectionsSection
                  activeConnection={activeStorageConnection}
                  onRemove={() => {
                    setStorageRemovalError(null);
                    setPendingStorageRemoval(activeStorageConnection);
                  }}
                />
              </SettingsGroup>

              <SettingsGroup
                description="Choose where new uploads arrive and where organized records should live."
                title="Folder locations"
              >
                <div className={styles.settingsList}>
                  <SettingsRowButton
                    label="Client upload source"
                    onClick={() => setActiveEditor("source")}
                    value={sourceFolderName}
                  />
                  <SettingsRowButton
                    label="Client records destination"
                    onClick={() => setActiveEditor("destination")}
                    value={destinationFolderName}
                  />
                </div>
              </SettingsGroup>
            </div>
          ) : null}

          {activeSection === "rules" ? (
            <div className={styles.sectionStack}>
              <SettingsGroup
                description="Create the standard folder set for each household."
                title="Folder structure"
              >
                <div className={styles.settingsList}>
                  <SettingsRowButton
                    label="Household folder structure"
                    onClick={() => setActiveEditor("folderTemplate")}
                    value={folderTemplateSummary}
                  />
                </div>
              </SettingsGroup>

              <SettingsGroup
                description="Set a default filename pattern, then override it by document type."
                title="Filename patterns"
              >
                <NamingRulesEditor onChange={setNamingRules} value={namingRules} />
              </SettingsGroup>
            </div>
          ) : null}

          {activeSection === "workflow" ? (
            <div className={styles.sectionStack}>
              <SettingsGroup
                description="Decide when new uploads can file automatically."
                title="Intake"
              >
                <div className={styles.settingsList}>
                  <SettingsRowButton
                    label="Intake review behavior"
                    onClick={() => setActiveEditor("reviewRule")}
                    value={reviewRuleOptionLabel(reviewRule)}
                  />
                </div>
              </SettingsGroup>

              <SettingsGroup
                description="Cleanup uses the same file rules, then shows a plan before changes."
                title="Cleanup"
              >
                <div className={styles.settingsList}>
                  <SettingsRowStatic
                    label="Cleanup safety"
                    value="Preview before changes"
                  />
                  <SettingsRowStatic
                    label="Shared filing rules"
                    value="Uses File Rules settings"
                  />
                  <SettingsRowLink href="/cleanup" label="Cleanup tool" value="Open" />
                </div>
              </SettingsGroup>
            </div>
          ) : null}

          {activeSection === "privacy" ? (
            <div className={styles.sectionStack}>
              <SettingsGroup
                description="Review how files, metadata, and audit records are handled."
                title="Privacy & audit"
              >
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
              </SettingsGroup>
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
            folderLoadError={folderLoadError}
            folderLoadState={folderLoadState}
            folders={folderOptions}
            label="Client records destination"
            onLoadFolders={loadDriveFolders}
            onApply={setDestinationFolderValue}
            onClose={() => setActiveEditor(null)}
            selectedValue={destinationFolderValue}
            showDisabledState={!driveConnected}
            showStoredSelection={driveConnected}
          />
        ) : null}

        {activeEditor === "source" ? (
          <FolderSelectionEditorModal
            description="Choose the folder where new client uploads arrive."
            emptyLabel="No source folder selected yet"
            folderLoadError={folderLoadError}
            folderLoadState={folderLoadState}
            folders={folderOptions}
            label="Client upload source"
            onLoadFolders={loadDriveFolders}
            onApply={setSourceFolderValue}
            onClose={() => setActiveEditor(null)}
            selectedValue={sourceFolderValue}
            showDisabledState={!driveConnected}
            showStoredSelection={driveConnected}
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
  folderLoadError: string | null;
  folderLoadState: FolderLoadState;
  folders: GoogleDriveFile[];
  label: string;
  onLoadFolders: () => void;
  onSelect: (value: string) => void;
  selectedValue: string;
  showDisabledState: boolean;
  showStoredSelection: boolean;
};

function WorkspaceOverview({
  items,
}: {
  items: Array<{
    detail: string;
    label: string;
    status: string;
    tone: WorkspaceOverviewTone;
    value: string;
  }>;
}) {
  return (
    <section className={styles.workspaceOverview} aria-label="Workspace setup status">
      {items.map((item) => (
        <div className={styles.workspaceOverviewItem} key={item.label}>
          <div className={styles.workspaceOverviewTopRow}>
            <span className={styles.workspaceOverviewLabel}>{item.label}</span>
            <span
              className={
                item.tone === "ready"
                  ? `${styles.workspaceStatus} ${styles.workspaceStatusReady}`
                  : `${styles.workspaceStatus} ${styles.workspaceStatusAttention}`
              }
            >
              {item.status}
            </span>
          </div>
          <strong>{item.value}</strong>
          <p>{item.detail}</p>
        </div>
      ))}
    </section>
  );
}

function SettingsGroup({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className={styles.settingsGroup}>
      <div className={styles.settingsGroupHeader}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {action ? <div className={styles.settingsGroupAction}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function FolderPicker({
  description,
  emptyLabel,
  folderLoadError,
  folderLoadState,
  folders,
  label,
  onLoadFolders,
  onSelect,
  selectedValue,
  showDisabledState,
  showStoredSelection,
}: FolderPickerProps) {
  const [query, setQuery] = useState("");
  const selectedFolderName = selectedValue.split("::")[1] ?? "";
  const visibleSelectedFolderName = showStoredSelection ? selectedFolderName : "";
  const filteredFolders = useMemo(() => filterFolders(folders, query), [folders, query]);

  return (
    <div className={styles.field}>
      <div className={styles.pickerHeader}>
        <span>{label}</span>
        <p>{description}</p>
      </div>

      <div className={styles.pickerShell}>
        <div className={styles.selectedFolderCard}>
          <strong>
            {visibleSelectedFolderName ||
              (showDisabledState ? "Reconnect storage" : emptyLabel)}
          </strong>
          <p>
            {visibleSelectedFolderName
              ? "This selection will be used the next time the app runs."
              : showDisabledState
                ? "Reconnect storage to browse folders here."
                : "Pick a folder from the searchable list below."}
          </p>
        </div>

        {showDisabledState ? (
          <div className={styles.disabledPicker}>
            Connect storage first to browse folders here.
          </div>
        ) : folderLoadState !== "loaded" && folders.length === 0 ? (
          <div className={styles.disabledPicker}>
            <p>
              Folder browsing is loaded only when you ask for it, so opening
              Settings stays fast.
            </p>
            {folderLoadError ? (
              <p className={styles.errorMessage}>{folderLoadError}</p>
            ) : null}
            <button
              className={styles.primaryAction}
              disabled={folderLoadState === "loading"}
              onClick={onLoadFolders}
              type="button"
            >
              {folderLoadState === "loading" ? "Loading folders..." : "Load folders"}
            </button>
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
            <SettingsRowStatic label="Connected drive" value={activeConnection.connectedDriveLabel} />
            <SettingsRowStatic label="Connected account" value={connectedAccount} />
            {activeConnection.status === "needs_reauth" ? (
              <>
                <SettingsRowStatic label="Status" value={activeConnection.statusLabel} />
                <SettingsRowLink
                  href={getStorageReconnectHref(activeConnection.provider)}
                  label="Reconnect storage"
                  value="Open"
                />
              </>
            ) : (
              <SettingsRowStatic label="Status" value={activeConnection.statusLabel} />
            )}
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
  folderLoadError,
  folderLoadState,
  folders,
  label,
  onLoadFolders,
  onApply,
  onClose,
  selectedValue,
  showDisabledState,
  showStoredSelection,
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
        folderLoadError={folderLoadError}
        folderLoadState={folderLoadState}
        folders={folders}
        label={label}
        onLoadFolders={onLoadFolders}
        onSelect={setDraftValue}
        selectedValue={draftValue}
        showDisabledState={showDisabledState}
        showStoredSelection={showStoredSelection}
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
      title="Household folder structure"
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
      title="Intake review behavior"
    >
      <div className={styles.editorIntro}>
        Choose whether Intake should file high-confidence items automatically or
        send them to review first.
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
  if (section === "workspace") {
    return "Firm profile, storage, and folder locations.";
  }

  if (section === "rules") {
    return "How filed documents are named and organized.";
  }

  if (section === "workflow") {
    return "Review behavior and cleanup defaults.";
  }

  return "Data handling and audit references.";
}

function getStorageReconnectHref(provider: string) {
  if (provider === "google_drive") {
    return "/api/storage/google/start";
  }

  return "/setup?section=workspace";
}
