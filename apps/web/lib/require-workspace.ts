import "server-only";
import { auth } from "../auth";
import { resolveGoogleSubject } from "./saas-api";

/** Return verified tenant from the DB; never trust a client-supplied workspace ID. */
export async function currentWorkspace(): Promise<{
  userId: string; workspaceId: string; role: "OWNER"
} | null> {
  const session = await auth();
  const subject = session?.user?.id;
  if (!subject || !/^[0-9]{3,255}$/.test(subject)) return null;
  return resolveGoogleSubject(subject);
}
