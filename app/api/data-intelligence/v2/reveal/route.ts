import { auth } from "@/auth";
import {
  buildDataIntelligenceV2AuthContext,
} from "@/lib/data-intelligence-v2/auth-context";
import { getDataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import {
  handleRevealApiRequest,
  REVEAL_API_NO_CACHE_HEADERS,
} from "@/lib/data-intelligence-v2/reveal-api-handler";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const config = getDataIntelligenceV2Config(process.env);
    const session = await auth();
    const authContext = buildDataIntelligenceV2AuthContext({
      session,
      config,
    });

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        {
          status: 400,
          headers: REVEAL_API_NO_CACHE_HEADERS,
        },
      );
    }

    const result = await handleRevealApiRequest({
      requestBody,
      authContext,
      config,
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Reveal request failed." },
      {
        status: 500,
        headers: REVEAL_API_NO_CACHE_HEADERS,
      },
    );
  }
}
