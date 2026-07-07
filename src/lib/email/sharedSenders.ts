// Shared/team sending identities — an alternative to "your own email" when scheduling a
// send. Whoever configured the identity's Gmail app password (in user_email_config, same
// as any per-user config) owns the actual sending credentials; the person who clicks Send
// is tracked separately as sent_by_email so attribution isn't lost.
export interface SharedSender {
  email: string;
  label: string;
}

export const SHARED_SENDERS: SharedSender[] = [
  { email: "zain.abedien@imagine.art", label: "Zain" },
];

export function findSharedSender(email: string): SharedSender | undefined {
  return SHARED_SENDERS.find((s) => s.email === email);
}
