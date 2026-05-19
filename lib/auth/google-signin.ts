export const EXPLICIT_LOGOUT_REASON = "logged_out";
export const GOOGLE_ACCOUNT_SELECTION_PROMPT = "select_account";

export function shouldForceGoogleAccountSelection(
  reason: string | null | undefined,
) {
  return reason === EXPLICIT_LOGOUT_REASON;
}

export function getGoogleSignInAuthorizationParams({
  forceAccountSelection,
}: {
  forceAccountSelection?: boolean;
}) {
  return forceAccountSelection
    ? { prompt: GOOGLE_ACCOUNT_SELECTION_PROMPT }
    : undefined;
}
