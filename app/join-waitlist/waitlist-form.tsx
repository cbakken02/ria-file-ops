"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  WAITLIST_FILE_SYSTEM_OPTIONS,
  WAITLIST_HONEYPOT_FIELD_NAME,
  WAITLIST_INITIAL_FORM_STATE,
} from "@/lib/waitlist-signups";
import { submitWaitlistSignup } from "./actions";
import styles from "./page.module.css";

export function WaitlistForm() {
  const [state, formAction, isPending] = useActionState(
    submitWaitlistSignup,
    WAITLIST_INITIAL_FORM_STATE,
  );
  const [selectedFileSystems, setSelectedFileSystems] = useState<Set<string>>(
    () => new Set(),
  );
  const showOtherFileSystem =
    selectedFileSystems.has("other") || Boolean(state.fieldErrors.fileSystemOther);

  function updateSelectedFileSystems(value: string, checked: boolean) {
    setSelectedFileSystems((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(value);
      } else {
        next.delete(value);
      }

      return next;
    });
  }

  if (state.ok) {
    return (
      <section
        aria-labelledby="waitlist-success-heading"
        className={`${styles.formCard} ${styles.successCard}`}
      >
        <div className={styles.successIcon} aria-hidden="true">
          ✓
        </div>
        <p className={styles.eyebrow}>Waitlist received</p>
        <h2 id="waitlist-success-heading">You&apos;re on the waitlist.</h2>
        <p>
          We&apos;ll follow up when we&apos;re ready to onboard more firms.
        </p>
        <Link className={styles.secondaryAction} href="/">
          Back to Home
        </Link>
      </section>
    );
  }

  return (
    <form action={formAction} className={styles.formCard} noValidate>
      <label className={styles.honeypotField} aria-hidden="true">
        <span>Website</span>
        <input
          autoComplete="off"
          name={WAITLIST_HONEYPOT_FIELD_NAME}
          tabIndex={-1}
          type="text"
        />
      </label>

      <div className={styles.formHeader}>
        <p className={styles.eyebrow}>Waitlist signup</p>
        <h2>Let&apos;s get you on the waitlist.</h2>
      </div>

      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>Name</span>
          <input
            aria-describedby={state.fieldErrors.name ? "name-error" : undefined}
            aria-invalid={Boolean(state.fieldErrors.name)}
            autoComplete="name"
            maxLength={120}
            name="name"
            required
            type="text"
          />
          <FieldError id="name-error" message={state.fieldErrors.name} />
        </label>

        <label className={styles.field}>
          <span>Email</span>
          <input
            aria-describedby={
              state.fieldErrors.email ? "email-error" : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.email)}
            autoComplete="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
          <FieldError id="email-error" message={state.fieldErrors.email} />
        </label>

        <label className={styles.field}>
          <span>Firm</span>
          <input
            aria-describedby={state.fieldErrors.firm ? "firm-error" : undefined}
            aria-invalid={Boolean(state.fieldErrors.firm)}
            autoComplete="organization"
            maxLength={160}
            name="firm"
            required
            type="text"
          />
          <FieldError id="firm-error" message={state.fieldErrors.firm} />
        </label>

        <label className={styles.field}>
          <span>
            Phone <small>optional</small>
          </span>
          <input
            aria-describedby={
              state.fieldErrors.phone ? "phone-error" : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.phone)}
            autoComplete="tel"
            maxLength={40}
            name="phone"
            type="tel"
          />
          <FieldError id="phone-error" message={state.fieldErrors.phone} />
        </label>
      </div>

      <fieldset
        aria-describedby={
          state.fieldErrors.fileSystems ? "file-systems-error" : undefined
        }
        className={styles.optionSection}
      >
        <legend>Where do client files live today?</legend>
        <div className={styles.optionGrid}>
          {WAITLIST_FILE_SYSTEM_OPTIONS.map((option) => (
            <label className={styles.checkOption} key={option.value}>
              <input
                name="fileSystems"
                onChange={(event) =>
                  updateSelectedFileSystems(option.value, event.target.checked)
                }
                type="checkbox"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <FieldError
          id="file-systems-error"
          message={state.fieldErrors.fileSystems}
        />
      </fieldset>

      {showOtherFileSystem ? (
        <label className={`${styles.field} ${styles.fullField}`}>
          <span>
            Other file system <small>optional</small>
          </span>
          <input
            aria-describedby={
              state.fieldErrors.fileSystemOther
                ? "file-system-other-error"
                : undefined
            }
            aria-invalid={Boolean(state.fieldErrors.fileSystemOther)}
            maxLength={120}
            name="fileSystemOther"
            type="text"
          />
          <FieldError
            id="file-system-other-error"
            message={state.fieldErrors.fileSystemOther}
          />
        </label>
      ) : null}

      <label className={`${styles.field} ${styles.fullField}`}>
        <span>
          What would you like help improving? <small>optional</small>
        </span>
        <textarea
          aria-describedby={state.fieldErrors.notes ? "notes-error" : undefined}
          aria-invalid={Boolean(state.fieldErrors.notes)}
          maxLength={1000}
          name="notes"
          placeholder="Tell us about the filing workflow, naming conventions, folder structure, or upload cleanup you want to improve."
          rows={4}
        />
        <FieldError id="notes-error" message={state.fieldErrors.notes} />
      </label>

      <div className={styles.formActions}>
        <button className={styles.primaryAction} disabled={isPending} type="submit">
          {isPending ? "Joining..." : "Join Waitlist"}
        </button>
      </div>

      <p
        className={state.ok ? styles.successStatus : styles.formStatus}
        role="status"
      >
        {state.message}
      </p>
    </form>
  );
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  if (!message) {
    return null;
  }

  return (
    <span className={styles.fieldError} id={id}>
      {message}
    </span>
  );
}
