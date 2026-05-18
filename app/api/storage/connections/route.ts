import { requireApiPrincipal } from "@/lib/auth/principal";
import { getSafeStorageConnectionsByOwnerEmail } from "@/lib/storage-connections";

export async function GET() {
  const principalResult = await requireApiPrincipal();

  if (!principalResult.ok) {
    return principalResult.response;
  }

  const connections = getSafeStorageConnectionsByOwnerEmail(
    principalResult.principal.legacyOwnerEmail,
    {
      source: "api-storage-connections",
    },
  );
  const activeConnection =
    connections.find((connection) => connection.isPrimary) ?? null;
  const status = activeConnection
    ? activeConnection.status === "connected"
      ? "connected"
      : "needs_reconnect"
    : "not_connected";

  return Response.json({
    activeConnection: activeConnection
      ? {
          accountEmail: activeConnection.accountEmail,
          accountName: activeConnection.accountName,
          id: activeConnection.id,
          isPrimary: activeConnection.isPrimary,
          provider: activeConnection.provider,
          status: activeConnection.status,
        }
      : null,
    canReconnect: activeConnection?.status === "needs_reauth",
    canReplace: Boolean(activeConnection),
    connections: connections.map((connection) => ({
      accountEmail: connection.accountEmail,
      accountName: connection.accountName,
      id: connection.id,
      isPrimary: connection.isPrimary,
      provider: connection.provider,
      status: connection.status,
    })),
    status,
  });
}
