import { redirect } from "next/navigation";

export default function SecurityPage() {
  redirect("/setup?section=privacy&dialog=data-handling");
}
