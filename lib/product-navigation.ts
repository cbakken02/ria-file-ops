export type ProductNavPath =
  | "/dashboard"
  | "/intake"
  | "/data-intelligence"
  | "/clean-up"
  | "/history"
  | "/security"
  | "/setup";

export type ProductNavItem = {
  href: ProductNavPath;
  label: string;
  hint: string;
};

export const PRODUCT_NAV_ITEMS: ProductNavItem[] = [
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
