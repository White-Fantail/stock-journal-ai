import "server-only";
import { auth } from "../auth";
import { isApprovedOwner, ownerAuthConfigured } from "./owner-policy";

/** A new authorization check is mandatory at each sensitive data boundary. */
export async function currentOwner(): Promise<boolean> {
  if (!ownerAuthConfigured(process.env)) return false;
  const session = await auth();
  return isApprovedOwner(session?.user?.id, process.env.OWNER_GITHUB_ID);
}
