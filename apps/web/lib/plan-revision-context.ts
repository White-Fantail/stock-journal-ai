/** Read-only temporal context for authored trade notes. No implied causal link. */
import type {JournalPlan} from "./saas-trades-api";

export function planAtAuthoredTime(
  plans:readonly JournalPlan[]|null,ticker:string,authoredAt:string,
):JournalPlan|null{
  if(!plans)return null;
  const at=Date.parse(authoredAt);
  if(!Number.isFinite(at))return null;
  return [...plans].filter(p=>p.ticker===ticker&&Number.isFinite(Date.parse(p.createdAt))&&
    Date.parse(p.createdAt)<=at).sort((a,b)=>
    Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id))[0]??null;
}
