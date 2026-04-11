export const GOOGLE_DRIVE_READ_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

const googleDriveAccessFailurePatterns = [
  "insufficient authentication scopes",
  "invalid authentication credentials",
  "login required",
  "permission denied",
  "does not have permission",
  "forbidden",
  "unauthenticated",
  "access denied",
] as const;

type GoogleDriveFilesResponse = {
  files?: GoogleDriveFile[];
  error?: {
    code?: number;
    message?: string;
  };
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  fileExtension?: string;
  parents?: string[];
  size?: string;
};

type GoogleDriveFileResponse = {
  id?: string;
  name?: string;
  driveId?: string;
  mimeType?: string;
  modifiedTime?: string;
  fileExtension?: string;
  parents?: string[];
  size?: string;
  error?: {
    code?: number;
    message?: string;
  };
};

type GoogleDriveAboutResponse = {
  user?: {
    displayName?: string;
    emailAddress?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
};

type GoogleSharedDriveResponse = {
  id?: string;
  name?: string;
  error?: {
    code?: number;
    message?: string;
  };
};

export function getDriveConnectionMessage(isConnected: boolean) {
  if (isConnected) {
    return "Google Drive is connected. The app can now read file metadata and download document contents for smarter document processing.";
  }

  return "Drive access has not been granted yet. The next step is asking Google for permission so the app can inspect folders and read document contents from the intake source you want to automate.";
}

export async function listRecentDriveFiles(accessToken: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "8");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,fileExtension,size,parents)",
  );
  url.searchParams.set("orderBy", "modifiedTime desc");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveFilesResponse;

  if (!response.ok) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while listing files.";
    throw new Error(message);
  }

  return data.files ?? [];
}

export async function listDriveFolders(accessToken: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "fields",
    "files(id,name,modifiedTime,fileExtension,size,parents)",
  );
  url.searchParams.set("orderBy", "name_natural");
  url.searchParams.set(
    "q",
    "mimeType='application/vnd.google-apps.folder' and trashed=false",
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveFilesResponse;

  if (!response.ok) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while listing folders.";
    throw new Error(message);
  }

  return data.files ?? [];
}

export async function listFilesInFolder(accessToken: string, folderId: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,fileExtension,size,parents)",
  );
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set(
    "q",
    `'${folderId}' in parents and trashed=false`,
  );
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveFilesResponse;

  if (!response.ok) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while listing files in the selected folder.";
    throw new Error(message);
  }

  return data.files ?? [];
}

export async function verifyDriveBrowserAccess(accessToken: string) {
  await listFilesInFolder(accessToken, "root");
}

export function isGoogleDriveAccessFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return googleDriveAccessFailurePatterns.some((pattern) =>
    message.includes(pattern),
  );
}

export async function listDriveBrowserItems(
  accessToken: string,
  folderId = "root",
) {
  const items = await listFilesInFolder(accessToken, folderId);

  return [...items].sort((left, right) => {
    const leftIsFolder = left.mimeType === "application/vnd.google-apps.folder";
    const rightIsFolder = right.mimeType === "application/vnd.google-apps.folder";

    if (leftIsFolder && !rightIsFolder) {
      return -1;
    }

    if (!leftIsFolder && rightIsFolder) {
      return 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export async function getDriveFolderTrail(
  accessToken: string,
  folderId: string,
) {
  if (!folderId || folderId === "root") {
    return [] as Array<{ id: string; name: string }>;
  }

  const trail: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  let currentFolderId: string | null = folderId;

  while (currentFolderId && currentFolderId !== "root" && !seen.has(currentFolderId)) {
    seen.add(currentFolderId);
    const metadata = await getDriveFileMetadata(accessToken, currentFolderId);
    trail.unshift({ id: metadata.id, name: metadata.name });
    currentFolderId = metadata.parents?.[0] ?? "root";
  }

  return trail;
}

export async function buildDriveItemPath(input: {
  accessToken: string;
  parentFolderId: string | null | undefined;
  itemName?: string | null;
  rootLabel?: string;
}) {
  const trail =
    input.parentFolderId && input.parentFolderId !== "root"
      ? await getDriveFolderTrail(input.accessToken, input.parentFolderId)
      : [];

  const segments = [
    input.rootLabel?.trim() || "My Drive",
    ...trail.map((segment) => segment.name).filter(Boolean),
    input.itemName?.trim() || null,
  ].filter((segment): segment is string => Boolean(segment && segment.trim()));

  return normalizeDriveDisplayPath(segments.join(" / "));
}

export function normalizeDriveDisplayPath(value: string | null | undefined) {
  const segments = (value ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return value ?? "";
  }

  const normalized = [segments[0] as string];

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    const previous = normalized[normalized.length - 1];

    // Keep accidental repeated root labels from showing up as "My Drive / My Drive / ..."
    if (index === 1 && previous.toLowerCase() === segment.toLowerCase()) {
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join(" / ");
}

export async function downloadDriveFile(accessToken: string, fileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set("alt", "media");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      message || "Google Drive returned an unexpected response while downloading a file.",
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function getDriveFileMetadata(accessToken: string, fileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set(
    "fields",
    "id,name,mimeType,modifiedTime,fileExtension,size,parents",
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveFileResponse;

  if (!response.ok || !data.id || !data.name || !data.mimeType) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while loading file metadata.";
    throw new Error(message);
  }

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    modifiedTime: data.modifiedTime,
    fileExtension: data.fileExtension,
    size: data.size,
    parents: data.parents,
  } satisfies GoogleDriveFile;
}

export async function getDriveConnectionContext(input: {
  accessToken: string;
  destinationFolderId?: string | null;
  sourceFolderId?: string | null;
  fallbackDisplayName?: string | null;
}) {
  const about = await getDriveAbout(input.accessToken).catch(() => null);
  const sourceLocation = input.sourceFolderId
    ? await getFolderDriveLocation(input.accessToken, input.sourceFolderId).catch(
        () => null,
      )
    : null;
  const destinationLocation = input.destinationFolderId
    ? await getFolderDriveLocation(
        input.accessToken,
        input.destinationFolderId,
      ).catch(() => null)
    : null;

  const uniqueLocations = [...new Set([sourceLocation, destinationLocation].filter(Boolean))];
  const fallbackMyDriveLabel = buildMyDriveLabel(
    about?.user?.displayName ?? input.fallbackDisplayName ?? null,
  );

  return {
    connectedDriveLabel:
      uniqueLocations.length === 1
        ? uniqueLocations[0]!
        : uniqueLocations.length > 1
          ? "Multiple Google Drive locations"
          : fallbackMyDriveLabel,
    sourceLocationLabel: sourceLocation ?? fallbackMyDriveLabel,
    destinationLocationLabel: destinationLocation ?? fallbackMyDriveLabel,
    accountDisplayName:
      about?.user?.displayName ?? input.fallbackDisplayName ?? null,
    accountEmail: about?.user?.emailAddress ?? null,
  };
}

export async function ensureDriveFolder(
  accessToken: string,
  parentFolderId: string,
  folderName: string,
) {
  const existingFolders = await listFilesInFolder(accessToken, parentFolderId);
  const existing = existingFolders.find(
    (file) =>
      file.mimeType === "application/vnd.google-apps.folder" && file.name === folderName,
  );

  if (existing) {
    return existing;
  }

  const response = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      mimeType: "application/vnd.google-apps.folder",
      name: folderName,
      parents: [parentFolderId],
    }),
  });

  const data = (await response.json()) as GoogleDriveFileResponse;

  if (!response.ok || !data.id || !data.name || !data.mimeType) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while creating a folder.";
    throw new Error(message);
  }

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    modifiedTime: data.modifiedTime,
    fileExtension: data.fileExtension,
    size: data.size,
    parents: data.parents,
  } satisfies GoogleDriveFile;
}

export async function moveAndRenameDriveFile(
  accessToken: string,
  fileId: string,
  input: {
    newName: string;
    targetParentId: string;
    previousParentIds: string[];
  },
) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  const isSameParent =
    input.previousParentIds.length === 1 &&
    input.previousParentIds[0] === input.targetParentId;

  if (!isSameParent) {
    url.searchParams.set("addParents", input.targetParentId);
  }

  if (input.previousParentIds.length && !isSameParent) {
    url.searchParams.set("removeParents", input.previousParentIds.join(","));
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      name: input.newName,
    }),
  });

  const data = (await response.json()) as GoogleDriveFileResponse;

  if (!response.ok || !data.id || !data.name || !data.mimeType) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while moving a file.";
    throw new Error(message);
  }

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    modifiedTime: data.modifiedTime,
    fileExtension: data.fileExtension,
    size: data.size,
    parents: data.parents,
  } satisfies GoogleDriveFile;
}

async function getDriveAbout(accessToken: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/about");
  url.searchParams.set("fields", "user(displayName,emailAddress)");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveAboutResponse;

  if (!response.ok) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while loading account details.";
    throw new Error(message);
  }

  return data;
}

async function getFolderDriveLocation(accessToken: string, folderId: string) {
  const fileUrl = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}`);
  fileUrl.searchParams.set("fields", "id,name,driveId");
  fileUrl.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleDriveFileResponse;

  if (!response.ok) {
    const message =
      data.error?.message ??
      "Google Drive returned an unexpected response while loading folder details.";
    throw new Error(message);
  }

  if (!data.driveId) {
    return "My Drive";
  }

  const sharedDriveUrl = new URL(
    `https://www.googleapis.com/drive/v3/drives/${data.driveId}`,
  );
  sharedDriveUrl.searchParams.set("fields", "id,name");

  const sharedDriveResponse = await fetch(sharedDriveUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const sharedDriveData = (await sharedDriveResponse.json()) as GoogleSharedDriveResponse;

  if (!sharedDriveResponse.ok || !sharedDriveData.name) {
    const message =
      sharedDriveData.error?.message ??
      "Google Drive returned an unexpected response while loading shared drive details.";
    throw new Error(message);
  }

  return sharedDriveData.name;
}

function buildMyDriveLabel(displayName: string | null) {
  if (!displayName?.trim()) {
    return "My Drive";
  }

  return `${displayName.trim()}'s My Drive`;
}
