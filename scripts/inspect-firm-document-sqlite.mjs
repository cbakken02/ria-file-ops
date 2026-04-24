import nextEnv from "@next/env";

import {
  findFirmDocumentPartiesByName,
  findLatestDriverLicenseStatusForParty,
  findLatestAccountSnapshotsForParty,
  findLatestContactsForAccount,
  findLatestDocumentForAccount,
  findLatestIdentityAddressForParty,
  findLatestIdentityDobForParty,
  inspectFirmDocumentBySourceFileId,
  findLatestIdentityDocumentForParty,
  findLatestIdentityExpirationForParty,
  findLatestIdentityFactsForParty,
  resolveFirmDocumentPartyByName,
} from "../lib/firm-document-sqlite-query.ts";
import { getFirmDocumentSqlitePath } from "../lib/firm-document-sqlite.ts";

nextEnv.loadEnvConfig(process.cwd(), false);

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "help";

const handlers = {
  "party-find": handlePartyFind,
  "latest-snapshots": handleLatestSnapshots,
  "latest-document": handleLatestDocument,
  "latest-contacts": handleLatestContacts,
  "latest-id-document": handleLatestIdentityDocument,
  "latest-id-dob": handleLatestIdentityDob,
  "latest-id-address": handleLatestIdentityAddress,
  "latest-id-facts": handleLatestIdentityFacts,
  "latest-id-expiration": handleLatestIdentityExpiration,
  "check-unexpired-license": handleCheckUnexpiredLicense,
  "document-dump": handleDocumentDump,
  help: handleHelp,
};

const handler = handlers[command] ?? handleHelp;

Promise.resolve(handler(args)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function handlePartyFind(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const name = requireArg(args, "name");
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const matches = findFirmDocumentPartiesByName({
    ownerEmail,
    name,
    dbPath,
  });

  printResult(args, {
    command: "party-find",
    ownerEmail,
    dbPath,
    name,
    count: matches.length,
    matches,
  });
}

async function handleLatestSnapshots(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const accountType = optionalArg(args, "account-type");
  const limit = parseOptionalInt(args.limit);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const snapshots = findLatestAccountSnapshotsForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    normalizedAccountType: accountType,
    limit,
  });

  printResult(args, {
    command: "latest-snapshots",
    ownerEmail,
    dbPath,
    party,
    accountType,
    count: snapshots.length,
    snapshots,
  });
}

async function handleLatestDocument(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const accountId = resolveAccountIdFromArgs(args, ownerEmail, dbPath);
  const latestDocument = findLatestDocumentForAccount({
    ownerEmail,
    dbPath,
    accountId,
  });

  printResult(args, {
    command: "latest-document",
    ownerEmail,
    dbPath,
    accountId,
    latestDocument,
  });
}

async function handleLatestContacts(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const accountId = resolveAccountIdFromArgs(args, ownerEmail, dbPath);
  const contacts = findLatestContactsForAccount({
    ownerEmail,
    dbPath,
    accountId,
    purpose: optionalArg(args, "purpose"),
    method: optionalArg(args, "method"),
    limit: parseOptionalInt(args.limit),
  });

  printResult(args, {
    command: "latest-contacts",
    ownerEmail,
    dbPath,
    accountId,
    purpose: optionalArg(args, "purpose"),
    method: optionalArg(args, "method"),
    count: contacts.length,
    contacts,
  });
}

async function handleLatestIdentityDocument(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const latestIdentityDocument = findLatestIdentityDocumentForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    idKind: optionalArg(args, "id-kind"),
    idType: optionalArg(args, "id-type"),
  });

  printResult(args, {
    command: "latest-id-document",
    ownerEmail,
    dbPath,
    party,
    latestIdentityDocument,
  });
}

async function handleLatestIdentityDob(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const latestDob = findLatestIdentityDobForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
  });

  printResult(args, {
    command: "latest-id-dob",
    ownerEmail,
    dbPath,
    party,
    latestDob,
  });
}

async function handleLatestIdentityAddress(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const latestAddress = findLatestIdentityAddressForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
  });

  printResult(args, {
    command: "latest-id-address",
    ownerEmail,
    dbPath,
    party,
    latestAddress,
  });
}

async function handleLatestIdentityFacts(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const latestIdentityFacts = findLatestIdentityFactsForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    idKind: optionalArg(args, "id-kind"),
    idType: optionalArg(args, "id-type"),
  });

  printResult(args, {
    command: "latest-id-facts",
    ownerEmail,
    dbPath,
    party,
    latestIdentityFacts,
  });
}

async function handleLatestIdentityExpiration(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const latestExpiration = findLatestIdentityExpirationForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    idKind: optionalArg(args, "id-kind"),
    idType: optionalArg(args, "id-type"),
  });

  printResult(args, {
    command: "latest-id-expiration",
    ownerEmail,
    dbPath,
    party,
    latestExpiration,
  });
}

async function handleCheckUnexpiredLicense(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const party = resolvePartyFromArgs(args, ownerEmail);
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const driverLicenseStatus = findLatestDriverLicenseStatusForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    asOfDate: optionalArg(args, "as-of"),
  });

  printResult(args, {
    command: "check-unexpired-license",
    ownerEmail,
    dbPath,
    party,
    driverLicenseStatus,
  });
}

async function handleDocumentDump(args) {
  const ownerEmail = requireArg(args, "owner-email");
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const sourceFileId =
    optionalArg(args, "source-file-id") ?? requireArg(args, "case-id");
  const inspection = inspectFirmDocumentBySourceFileId({
    ownerEmail,
    dbPath,
    sourceFileId,
  });

  printResult(args, {
    command: "document-dump",
    ownerEmail,
    dbPath,
    sourceFileId,
    inspection,
  });
}

async function handleHelp() {
  const lines = [
    "Usage:",
    "  npm run inspect:firm-db -- party-find --owner-email you@example.com --name \"Christopher T Bakken\" [--json]",
    "  npm run inspect:firm-db -- latest-snapshots --owner-email you@example.com --party-name \"Christopher T Bakken\" --account-type \"401(k)\" [--json]",
    "  npm run inspect:firm-db -- latest-document --owner-email you@example.com --party-name \"Christopher T Bakken\" --account-type \"IRA\" [--json]",
    "  npm run inspect:firm-db -- latest-contacts --owner-email you@example.com --party-name \"Christopher T Bakken\" --account-type \"401(k)\" --purpose rollover_support --method phone [--json]",
    "  npm run inspect:firm-db -- latest-id-document --owner-email you@example.com --party-name \"Christopher T Bakken\" [--json]",
    "  npm run inspect:firm-db -- latest-id-dob --owner-email you@example.com --party-name \"Christopher T Bakken\" [--json]",
    "  npm run inspect:firm-db -- latest-id-address --owner-email you@example.com --party-name \"Christopher T Bakken\" [--json]",
    "  npm run inspect:firm-db -- latest-id-facts --owner-email you@example.com --party-name \"Christopher T Bakken\" --id-kind driver_license [--json]",
    "  npm run inspect:firm-db -- latest-id-expiration --owner-email you@example.com --party-name \"Christopher T Bakken\" [--json]",
    "  npm run inspect:firm-db -- check-unexpired-license --owner-email you@example.com --party-name \"Christopher T Bakken\" --as-of 2026-04-21 [--json]",
    "  npm run inspect:firm-db -- document-dump --owner-email you@example.com --case-id case-01-us-bank-smartly-checking-single --json",
    "",
    "Alternative selectors:",
    "  --db-path /full/path/to/db.sqlite",
    "  --party-id stable-party-id",
    "  --account-id stable-account-id",
    "  --source-file-id source-file-id",
  ];
  console.log(lines.join("\n"));
}

function resolvePartyFromArgs(args, ownerEmail) {
  const dbPath = args["db-path"] ?? getFirmDocumentSqlitePath(ownerEmail);
  const partyId = optionalArg(args, "party-id");
  if (partyId) {
    return {
      partyId,
      canonicalDisplayName: null,
    };
  }

  const partyName = requireArg(args, "party-name");
  const resolution = resolveFirmDocumentPartyByName({
    ownerEmail,
    dbPath,
    name: partyName,
  });

  if (resolution.status === "not_found") {
    throw new Error(`No party matched "${partyName}" in ${dbPath}.`);
  }

  if (resolution.status === "ambiguous") {
    throw new Error(
      `Party lookup for "${partyName}" is ambiguous: ${resolution.matches
        .map((match) => `${match.canonicalDisplayName} (${match.partyId})`)
        .join(", ")}`,
    );
  }

  return resolution.party;
}

function resolveAccountIdFromArgs(args, ownerEmail, dbPath) {
  const directAccountId = optionalArg(args, "account-id");
  if (directAccountId) {
    return directAccountId;
  }

  const party = resolvePartyFromArgs(args, ownerEmail);
  const accountType = requireArg(args, "account-type");
  const snapshots = findLatestAccountSnapshotsForParty({
    ownerEmail,
    dbPath,
    partyId: party.partyId,
    normalizedAccountType: accountType,
    limit: 10,
  });

  if (snapshots.length === 0) {
    throw new Error(
      `No latest account snapshot matched ${party.canonicalDisplayName ?? party.partyId} with account type "${accountType}".`,
    );
  }

  if (snapshots.length > 1) {
    throw new Error(
      `Account lookup is ambiguous for ${party.canonicalDisplayName ?? party.partyId} and "${accountType}": ${snapshots
        .map((snapshot) => `${snapshot.accountId} (${snapshot.institutionName ?? "Unknown institution"} x${snapshot.accountLast4 ?? "?"})`)
        .join(", ")}`,
    );
  }

  return snapshots[0]?.accountId ?? null;
}

function printResult(args, value) {
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function requireArg(args, key) {
  const value = optionalArg(args, key);
  if (!value) {
    throw new Error(`Missing required argument --${key}.`);
  }

  return value;
}

function optionalArg(args, key) {
  const value = args[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseOptionalInt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
