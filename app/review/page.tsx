import { redirect } from "next/navigation";

export default async function ReviewRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  if (resolvedSearchParams?.notice) {
    redirect(`/intake?notice=${encodeURIComponent(resolvedSearchParams.notice)}`);
  }

  redirect("/intake");
}
