"use client";

import { useFormStatus } from "react-dom";
import { refreshIntakeAction } from "./actions";
import styles from "./page.module.css";

type Props = {
  activeTab: "all" | "review" | "ready" | "filed";
  disabled?: boolean;
};

export function RefreshIntakeButton({ activeTab, disabled = false }: Props) {
  return (
    <form action={refreshIntakeAction}>
      <input name="tab" type="hidden" value={activeTab} />
      <SubmitButton disabled={disabled} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className={styles.primaryAction}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Refreshing..." : "Refresh Intake"}
    </button>
  );
}
