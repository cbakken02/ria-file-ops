export type ProductNavPath =
  | "/dashboard"
  | "/intake"
  | "/data-intelligence"
  | "/clean-up"
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
    href: "/intake",
    label: "Intake",
    hint: "New Files",
  },
  {
    href: "/clean-up",
    label: "Clean Up",
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
