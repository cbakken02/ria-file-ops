"use client";

import { useMemo, useState } from "react";
import { saveReviewDecisionAction } from "./actions";
import styles from "./page.module.css";

type ReviewItemFormProps = {
  detectedClient: string | null;
  fileId: string;
  sourceName: string;
  mimeType: string;
  modifiedTime: string | null;
  detectedDocumentType: string;
  originalClientFolder: string | null;
  originalTopLevelFolder: string;
  originalFilename: string;
  initialClientFolder: string;
  initialTopLevelFolder: string;
  initialFilename: string;
  folderTemplate: string[];
  existingClientFolders: string[];
};

function buildFilenameForClient(
  currentClientFolder: string,
  currentFilename: string,
  knownClientFolders: string[],
) {
  const nextPrefix = currentClientFolder.trim() || "Needs_Client_Match";
  const extensionMatch = currentFilename.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const baseName = extension ? currentFilename.slice(0, -extension.length) : currentFilename;
  const candidatePrefixes = [
    "Needs_Client_Match",
    ...knownClientFolders,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);

  for (const prefix of candidatePrefixes) {
    if (baseName === prefix) {
      return `${nextPrefix}${extension}`;
    }

    if (baseName.startsWith(`${prefix}_`)) {
      return `${nextPrefix}${baseName.slice(prefix.length)}${extension}`;
    }
  }

  const parts = baseName.split("_");
  const clientNameTokens = new Set(
    candidatePrefixes.flatMap((prefix) => {
      const segments = prefix.split("_").filter(Boolean);
      return segments.length ? [segments[0], segments[segments.length - 1]] : [];
    }),
  );

  if (parts.length >= 2 && clientNameTokens.has(parts[0])) {
    return `${nextPrefix}_${parts.slice(1).join("_")}${extension}`;
  }

  if (parts.length >= 3) {
    return `${nextPrefix}_${parts.slice(1).join("_")}${extension}`;
  }

  return `${nextPrefix}_${baseName}${extension}`;
}

export function ReviewItemForm({
  detectedClient,
  fileId,
  sourceName,
  mimeType,
  modifiedTime,
  detectedDocumentType,
  originalClientFolder,
  originalTopLevelFolder,
  originalFilename,
  initialClientFolder,
  initialTopLevelFolder,
  initialFilename,
  folderTemplate,
  existingClientFolders,
}: ReviewItemFormProps) {
  const [clientFolder, setClientFolder] = useState(initialClientFolder);
  const [topLevelFolder, setTopLevelFolder] = useState(initialTopLevelFolder);
  const [filename, setFilename] = useState(initialFilename);
  const suggestionListId = useMemo(
    () => `client-folders-${fileId.replace(/[^A-Za-z0-9_-]/g, "")}`,
    [fileId],
  );
  const normalizedClientFolder = clientFolder.trim();
  const looksLikeNewClient =
    Boolean(normalizedClientFolder) &&
    !existingClientFolders.includes(normalizedClientFolder);

  return (
    <form action={saveReviewDecisionAction} className={styles.reviewForm}>
      <input name="fileId" type="hidden" value={fileId} />
      <input name="sourceName" type="hidden" value={sourceName} />
      <input name="mimeType" type="hidden" value={mimeType} />
      <input name="modifiedTime" type="hidden" value={modifiedTime ?? ""} />
      <input name="detectedClient" type="hidden" value={detectedClient ?? ""} />
      <input name="detectedDocumentType" type="hidden" value={detectedDocumentType} />
      <input
        name="originalClientFolder"
        type="hidden"
        value={originalClientFolder ?? ""}
      />
      <input
        name="originalTopLevelFolder"
        type="hidden"
        value={originalTopLevelFolder}
      />
      <input name="originalFilename" type="hidden" value={originalFilename} />

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Client folder</span>
          <input
            list={suggestionListId}
            name="reviewedClientFolder"
            onChange={(event) => {
              const nextClientFolder = event.target.value;
              setClientFolder(nextClientFolder);
              setFilename((currentFilename) =>
                buildFilenameForClient(
                  nextClientFolder,
                  currentFilename || originalFilename,
                  existingClientFolders,
                ),
              );
            }}
            placeholder="LastName_FirstName"
            type="text"
            value={clientFolder}
          />
          <datalist id={suggestionListId}>
            {existingClientFolders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          {looksLikeNewClient ? (
            <p className={styles.fieldHint}>
              This does not match an existing client folder. Filing it will create a
              new client folder.
            </p>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>Top-level folder</span>
          <select
            name="reviewedTopLevelFolder"
            onChange={(event) => setTopLevelFolder(event.target.value)}
            value={topLevelFolder}
          >
            {folderTemplate.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.field} ${styles.filenameField}`}>
          <span>Final filename</span>
          <input
            name="reviewedFilename"
            onChange={(event) => setFilename(event.target.value)}
            type="text"
            value={filename}
          />
        </label>
      </div>

      <div className={styles.formActions}>
        <button
          className={styles.secondaryButton}
          name="decisionStatus"
          type="submit"
          value="draft"
        >
          Save draft
        </button>
        <button
          className={styles.primaryButton}
          name="decisionStatus"
          type="submit"
          value="approved"
        >
          Approve for staging
        </button>
      </div>
    </form>
  );
}
