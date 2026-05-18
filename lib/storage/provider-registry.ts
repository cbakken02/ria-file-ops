import type { StorageConnection } from "@/lib/db";
import { googleDriveStorageProviderAdapter } from "@/lib/storage/google-drive-adapter";
import type {
  StorageProviderAdapter,
  StorageProviderId,
} from "@/lib/storage/provider-types";

const storageProviderAdapters = {
  google_drive: googleDriveStorageProviderAdapter,
} satisfies Record<StorageProviderId, StorageProviderAdapter>;

export class UnsupportedStorageProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`Unsupported storage provider: ${provider}`);
    this.name = "UnsupportedStorageProviderError";
    this.provider = provider;
  }
}

export function getStorageProviderAdapter(
  provider: string,
): StorageProviderAdapter {
  if (isSupportedStorageProvider(provider)) {
    return storageProviderAdapters[provider];
  }

  throw new UnsupportedStorageProviderError(provider);
}

export function getStorageProviderAdapterForConnection(
  connection: StorageConnection,
) {
  return getStorageProviderAdapter(connection.provider);
}

export function isSupportedStorageProvider(
  provider: string,
): provider is StorageProviderId {
  return provider in storageProviderAdapters;
}

export function listSupportedStorageProviders() {
  return Object.values(storageProviderAdapters);
}
