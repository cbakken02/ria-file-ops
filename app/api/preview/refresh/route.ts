import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  IntakeRefreshError,
  refreshIntakeQueueForSession,
} from "@/lib/intake-refresh";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json(
      { error: "Sign in before refreshing Intake." },
      { status: 401 },
    );
  }

  try {
    const result = await refreshIntakeQueueForSession(session);
    revalidatePath("/preview");

    return Response.json(result);
  } catch (error) {
    const status = error instanceof IntakeRefreshError ? error.status : 500;
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Intake could not be refreshed.",
      },
      { status },
    );
  }
}
