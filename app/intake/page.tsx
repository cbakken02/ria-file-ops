import { IntakeWorkspacePage } from "@/app/preview/intake-workspace-page";

export default function IntakePage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string; scanStatus?: string; tab?: string }>;
}) {
  return <IntakeWorkspacePage currentPath="/intake" searchParams={searchParams} />;
}
