import { NextRequest, NextResponse } from "next/server";
import { prepareReadyItemsFilingRedirect } from "@/app/preview/actions";

export async function GET(request: NextRequest) {
  const location = await prepareReadyItemsFilingRedirect("auto");
  return NextResponse.redirect(new URL(location, request.url));
}
