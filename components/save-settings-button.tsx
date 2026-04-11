"use client";

import { useFormStatus } from "react-dom";

type Props = {
  className: string;
};

export function SaveSettingsButton({ className }: Props) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? "Saving..." : "Save settings"}
    </button>
  );
}
