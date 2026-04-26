export type ProductNavPath =
  | "/dashboard"
  | "/preview"
  | "/data-intelligence"
  | "/cleanup"
  | "/history"
  | "/security"
  | "/setup";

export const PRODUCT_NAV_ITEMS: Array<{
  href: ProductNavPath;
  label: string;
  hint: string;
}> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    hint: "Overview",
  },
  {
    href: "/preview",
    label: "Intake",
    hint: "New Files",
  },
  {
    href: "/cleanup",
    label: "Cleanup",
    hint: "Existing Files",
  },
  {
    href: "/data-intelligence",
    label: "Data Intelligence",
    hint: "AI Chat",
  },
  {
    href: "/history",
    label: "Filing history",
    hint: "Audit",
  },
];
