import { auth } from "@/auth";
import { getPrimaryStorageConnectionByOwnerEmail, getStorageConnectionsByOwnerEmail } from "@/lib/db";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerEmail = session.user.email;
  const activeConnection = getPrimaryStorageConnectionByOwnerEmail(ownerEmail) ?? null;
  const connections = getStorageConnectionsByOwnerEmail(ownerEmail);

  return Response.json({
    activeConnection: activeConnection
      ? {
          accountEmail: activeConnection.accountEmail,
          accountName: activeConnection.accountName,
          id: activeConnection.id,
          isPrimary: activeConnection.isPrimary,
          provider: activeConnection.provider,
        }
      : null,
    connections: connections.map((connection) => ({
      accountEmail: connection.accountEmail,
      accountName: connection.accountName,
      id: connection.id,
      isPrimary: connection.isPrimary,
      provider: connection.provider,
    })),
  });
}
