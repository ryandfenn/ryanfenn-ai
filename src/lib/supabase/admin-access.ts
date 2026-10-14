import type { User } from "@supabase/supabase-js";
import { adminEmails } from "./env";

/**
 * Server-side admin gate. Both are required on every check:
 * 1. A Supabase user from `auth.getUser()` (validates the JWT with the Auth server).
 * 2. That user's confirmed email is on ADMIN_EMAILS.
 *
 * A stored `profiles.role = admin` flag, or ADMIN_EMAILS with no session, is not enough.
 */
export function sessionIsAdmin(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  if (!user.email_confirmed_at) return false;
  const allowed = adminEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(user.email.toLowerCase());
}
