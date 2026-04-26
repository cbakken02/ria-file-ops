export const CANONICAL_PRODUCTION_HOST = "ria-file-ops.vercel.app";

export function normalizeRequestHost(host: string | null | undefined) {
  return (host ?? "").toLowerCase().split(":")[0];
}

export function shouldRedirectToCanonicalProductionHost(input: {
  host: string | null | undefined;
  vercelEnv?: string | null;
}) {
  const host = normalizeRequestHost(input.host);

  return (
    input.vercelEnv === "production" &&
    host.endsWith(".vercel.app") &&
    host !== CANONICAL_PRODUCTION_HOST
  );
}
