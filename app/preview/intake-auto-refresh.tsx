"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type Props = {
  activeTab: "all" | "filed" | "ready" | "review";
  enabled: boolean;
};

export function IntakeAutoRefresh({ activeTab, enabled }: Props) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || activeTab === "filed" || startedRef.current) {
      return;
    }

    const navigationEntry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    if (navigationEntry?.type !== "reload") {
      return;
    }

    const guardKey = [
      "ria-file-ops:intake-auto-refresh",
      window.location.pathname,
      window.location.search,
      Math.round(performance.timeOrigin),
    ].join(":");

    if (sessionStorage.getItem(guardKey)) {
      return;
    }

    startedRef.current = true;
    sessionStorage.setItem(guardKey, "started");
    const controller = new AbortController();

    void fetch("/api/preview/refresh", {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error || "Intake could not be refreshed.");
        }

        sessionStorage.setItem(guardKey, "done");
        router.refresh();
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          sessionStorage.setItem(guardKey, "failed");
        }
      });

    return () => controller.abort();
  }, [activeTab, enabled, router]);

  return null;
}
