import { redirect } from "next/navigation";

export default async function GoogleDriveSetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();
  params.set("section", "workspace");

  const notice = resolvedSearchParams?.notice?.trim();
  if (notice) {
    params.set("notice", notice);
  }

  redirect(`/setup?${params.toString()}`);
}
