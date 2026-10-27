import {redirect} from "next/navigation";
import {currentWorkspace} from "../../../lib/require-workspace";
export const dynamic="force-dynamic";
/** Preserve old bookmarks while keeping authoring and risk checks on one page. */
export default async function RiskPage(){
 if(!await currentWorkspace())redirect("/login");
 redirect("/private/journal/new?mode=plan");
}
