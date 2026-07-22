// Admin allowlist. The app itself is gated to the imagine.art domain by sign-in; "admin" is a
// smaller set allowed to do powerful things like send AS another teammate. Configured via the
// ADMIN_EMAILS env (comma-separated); defaults to abdullah.zubair@imagine.art when unset.
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim() || "abdullah.zubair@imagine.art";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
