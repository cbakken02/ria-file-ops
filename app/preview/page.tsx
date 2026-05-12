import { redirect } from "next/navigation";

export default async function LegacyPreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string; tab?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();

  if (resolvedSearchParams?.notice) {
    params.set("notice", resolvedSearchParams.notice);
  }

  if (resolvedSearchParams?.tab) {
    params.set("tab", resolvedSearchParams.tab);
  }

  redirect(params.size ? `/intake?${params.toString()}` : "/intake");
}
