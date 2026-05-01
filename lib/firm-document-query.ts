import { isSupabasePersistence } from "@/lib/persistence/backend";
import * as sqliteDocumentQueryStore from "@/lib/firm-document-sqlite-query";
import * as supabaseDocumentQueryStore from "@/lib/persistence/supabase-document-query-store";

export type {
  FirmDocumentAccountValue,
  FirmDocumentIdentityAddress,
  FirmDocumentInspection,
  FirmDocumentLatestAccountDocument,
  FirmDocumentLatestAccountIdentifier,
  FirmDocumentLatestAccountSnapshot,
  FirmDocumentLatestContact,
  FirmDocumentLatestDriverLicenseStatus,
  FirmDocumentLatestIdentityAddressRecord,
  FirmDocumentLatestIdentityDob,
  FirmDocumentLatestIdentityDocument,
  FirmDocumentLatestIdentityExpiration,
  FirmDocumentLatestIdentityFacts,
  FirmDocumentPartyMatch,
  FirmDocumentResolvedParty,
  FirmDocumentTaxDocument,
  FirmDocumentTaxFact,
} from "@/lib/firm-document-sqlite-query";

type SqliteDocumentQueryStoreModule = typeof import("@/lib/firm-document-sqlite-query");

function getActiveDocumentQueryStore() {
  if (isSupabasePersistence()) {
    return supabaseDocumentQueryStore;
  }

  return sqliteDocumentQueryStore as SqliteDocumentQueryStoreModule;
}

export const listFirmDocumentParties = (...args: Parameters<SqliteDocumentQueryStoreModule["listFirmDocumentParties"]>) =>
  getActiveDocumentQueryStore().listFirmDocumentParties(...args);

export const resolveFirmDocumentPartyByName = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["resolveFirmDocumentPartyByName"]>
) => getActiveDocumentQueryStore().resolveFirmDocumentPartyByName(...args);

export const findLatestAccountSnapshotsForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestAccountSnapshotsForParty"]>
) => getActiveDocumentQueryStore().findLatestAccountSnapshotsForParty(...args);

export const findLatestDocumentForAccount = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestDocumentForAccount"]>
) => getActiveDocumentQueryStore().findLatestDocumentForAccount(...args);

export const findLatestAccountIdentifierForAccount = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestAccountIdentifierForAccount"]>
) => getActiveDocumentQueryStore().findLatestAccountIdentifierForAccount(...args);

export const findLatestContactsForAccount = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestContactsForAccount"]>
) => getActiveDocumentQueryStore().findLatestContactsForAccount(...args);

export const findAccountValuesForDocumentSnapshot = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findAccountValuesForDocumentSnapshot"]>
) => getActiveDocumentQueryStore().findAccountValuesForDocumentSnapshot(...args);

export const findLatestIdentityDocumentForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestIdentityDocumentForParty"]>
) => getActiveDocumentQueryStore().findLatestIdentityDocumentForParty(...args);

export const findLatestIdentityDobForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestIdentityDobForParty"]>
) => getActiveDocumentQueryStore().findLatestIdentityDobForParty(...args);

export const findLatestIdentityAddressForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestIdentityAddressForParty"]>
) => getActiveDocumentQueryStore().findLatestIdentityAddressForParty(...args);

export const findLatestIdentityExpirationForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestIdentityExpirationForParty"]>
) => getActiveDocumentQueryStore().findLatestIdentityExpirationForParty(...args);

export const findLatestDriverLicenseStatusForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findLatestDriverLicenseStatusForParty"]>
) => getActiveDocumentQueryStore().findLatestDriverLicenseStatusForParty(...args);

export const findTaxDocumentsForParty = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findTaxDocumentsForParty"]>
) => getActiveDocumentQueryStore().findTaxDocumentsForParty(...args);

export const findTaxFactsForDocument = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["findTaxFactsForDocument"]>
) => getActiveDocumentQueryStore().findTaxFactsForDocument(...args);

export const inspectFirmDocumentBySourceFileId = (
  ...args: Parameters<SqliteDocumentQueryStoreModule["inspectFirmDocumentBySourceFileId"]>
) => getActiveDocumentQueryStore().inspectFirmDocumentBySourceFileId(...args);
