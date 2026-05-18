import { auth } from "@/auth";
import { getSafeStorageConnectionsByOwnerEmail } from "@/lib/storage-connections";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerEmail = session.user.email;
  const connections = getSafeStorageConnectionsByOwnerEmail(ownerEmail, {
    source: "api-storage-connections",
  });
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
