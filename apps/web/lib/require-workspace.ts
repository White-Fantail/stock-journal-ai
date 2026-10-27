import "server-only";
import {cache} from "react";
import { auth } from "../auth";
import { resolveGoogleSubject } from "./saas-api";

/** Fresh per-HTTP-request membership check. React cache deduplicates only within
 * the same server render/action, never between requests, tenants or users.
 * This avoids exhausting the signed identity endpoint rate limit when both
 * a private layout and its page recheck workspace membership concurrently.
 */
export const currentWorkspace=cache(async (): Promise<{
  userId: string; workspaceId: string; role: "OWNER"
} | null> => {
  const session = await auth();
  const subject = session?.user?.id;
  if (!subject || !/^[0-9]{3,255}$/.test(subject)) return null;
  return resolveGoogleSubject(subject);
});
