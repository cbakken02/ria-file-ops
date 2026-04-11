type FileKind =
  | "folder"
  | "pdf"
  | "image"
  | "word"
  | "excel"
  | "presentation"
  | "generic";

type FileKindIconProps = {
  mimeType: string;
  name: string;
  className?: string;
};

export function FileKindIcon({
  mimeType,
  name,
  className,
}: FileKindIconProps) {
  const kind = inferFileKind(mimeType, name);

  if (kind === "folder") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3.5 7.5a2 2 0 0 1 2-2h4.1c.6 0 1.17.24 1.6.67l1.14 1.13c.19.19.44.3.7.3H18.5a2 2 0 0 1 2 2v6.75a2.25 2.25 0 0 1-2.25 2.25h-12.5A2.25 2.25 0 0 1 3.5 16.35V7.5Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  if (kind === "image") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M14.75 3.75v4h4"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <circle cx="9.5" cy="11" r="1.2" fill="currentColor" />
          <path
            d="m7.5 17.25 3.15-3.15a1 1 0 0 1 1.41 0l1.19 1.19a1 1 0 0 0 1.41 0l1.84-1.84a1 1 0 0 1 1.41 0l.59.59"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  if (kind === "pdf") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M14.75 3.75v4h4"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M7.75 15.75h8.5M7.75 12.75h8.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  if (kind === "word") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M14.75 3.75v4h4"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="m7.8 11.2 1.4 4.3 1.4-3.2 1.4 3.2 1.4-4.3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  if (kind === "excel") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M14.75 3.75v4h4"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="m8.3 15.6 5.4-6.2m-5.4 0 5.4 6.2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  if (kind === "presentation") {
    return (
      <span aria-hidden="true" className={className}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M14.75 3.75v4h4"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <path
            d="M8.25 16.2V10.2h5.1a2 2 0 1 1 0 4H8.25"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={className}>
      <svg
        fill="none"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M7.25 3.75h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-14a1.5 1.5 0 0 1 1.5-1.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M14.75 3.75v4h4"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M8 12h8M8 15h8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

export function inferFileKind(mimeType: string, name: string): FileKind {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedName = name.toLowerCase();
  const extension = normalizedName.includes(".")
    ? normalizedName.split(".").pop() ?? ""
    : "";

  if (normalizedMime === "application/vnd.google-apps.folder") {
    return "folder";
  }

  if (normalizedMime === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    normalizedMime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "heic", "webp", "tif", "tiff"].includes(extension)
  ) {
    return "image";
  }

  if (
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("msword") ||
    normalizedMime === "application/vnd.google-apps.document" ||
    ["doc", "docx", "rtf"].includes(extension)
  ) {
    return "word";
  }

  if (
    normalizedMime.includes("spreadsheetml") ||
    normalizedMime.includes("ms-excel") ||
    normalizedMime === "application/vnd.google-apps.spreadsheet" ||
    ["xls", "xlsx", "csv", "tsv"].includes(extension)
  ) {
    return "excel";
  }

  if (
    normalizedMime.includes("presentationml") ||
    normalizedMime.includes("ms-powerpoint") ||
    normalizedMime === "application/vnd.google-apps.presentation" ||
    ["ppt", "pptx", "key"].includes(extension)
  ) {
    return "presentation";
  }

  return "generic";
}
