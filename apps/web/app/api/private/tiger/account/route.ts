import { tigerCall, checkSameOrigin, safeTigerRedirect } from "../../../../../lib/tiger-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!checkSameOrigin(request)) return new Response("Forbidden",{status:403});
  try {
    const form = await request.formData();
    const action = form.get("action");
    const connectionId = form.get("connectionId");
    const accountNumber = form.get("accountNumber");
    const accountId = form.get("accountId");
    if (action === "bind" && typeof connectionId === "string" && typeof accountNumber === "string") {
      await tigerCall("bind", {connectionId, accountNumber});
    } else if (action === "read" && typeof accountId === "string") {
      await tigerCall("read", {accountId});
    } else if (action === "disconnect" && typeof connectionId === "string") {
      await tigerCall("disconnect", {connectionId});
    } else {
      return new Response("Invalid action",{status:400});
    }
    return Response.redirect(safeTigerRedirect("/private/tiger?updated=1"),303);
  } catch {
    return Response.redirect(safeTigerRedirect("/private/tiger?error=account"),303);
  }
}
