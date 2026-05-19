"use client";

type Props = {
  className: string;
  disabled?: boolean;
};

const STORAGE_OAUTH_START_PATH = "/api/storage/google/start";

export function GoogleDriveConnectButton({
  className,
  disabled = false,
}: Props) {
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => {
        window.location.assign(STORAGE_OAUTH_START_PATH);
      }}
      type="button"
    >
      Grant Google Drive access
    </button>
  );
}
