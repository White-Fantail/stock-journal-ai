import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { saasAuthConfigured } from "./saas-auth-policy";

export type ManualTradeEvent = Readonly<{
  id: string;
  kind: "EXECUTION" | "VOID";
  voidsEventId: string | null;
  ticker: string | null;
  side: "BUY" | "SELL" | null;
  quantity: string | null;
  price: string | null;
  currency: string | null;
  fee: string | null;
  executedAt: string | null;
  rationale: string | null;
  provenance: "USER_ASSERTED";
  createdAt: string;
}>;

type JournalResult = Readonly<{ events: readonly ManualTradeEvent[]; source: "USER_ASSERTED_ONLY"; limit: number }>;
type CreateResult = Readonly<{ id: string; replayed: boolean; source: "USER_ASSERTED" }>;

export type ManualExecutionInput = {
  idempotencyKey: string;
  kind: "EXECUTION";
  confirm: true;
  ticker: string;
  side: string;
  quantity: string;
  price: string;
  currency: string;
  fee: string | null;
  executedAt: string;
  rationale: string;
};

export type ManualVoidInput = {
  idempotencyKey: string;
  kind: "VOID";
  confirm: true;
  voidsEventId: string;
  rationale: string;
};

export type ManualEventInput = ManualExecutionInput | ManualVoidInput;

/** Only callable from trusted Next.js server code, never the browser. */
async function postS2(path: "/internal/v1/trades/list" | "/internal/v1/trades/create" |
      "/internal/v1/journal/list" | "/internal/v1/journal/create" | "/internal/v1/journal/export" |
      "/internal/v1/journal/plans" | "/internal/v1/journal/plan/create" |
      "/internal/v1/account/delete" | "/internal/v1/trades/detail",
                      subject: string, payload?: ManualEventInput | JournalEntryInput | JournalPlanInput | "DELETE_MY_ACCOUNT" | string): Promise<unknown> {
  const env = process.env;
  if (!saasAuthConfigured(env, env.NODE_ENV === "development")
      || !/^[0-9]{3,255}$/.test(subject)) {
    throw new Error("Authenticated financial API not configured");
  }
  const body = JSON.stringify(path === "/internal/v1/trades/create" ? {subject, trade:payload} :
    path === "/internal/v1/journal/create" ? {subject, entry:payload} :
    path === "/internal/v1/journal/plan/create" ? {subject, plan:payload} :
    path === "/internal/v1/account/delete" ? {subject, confirmation:payload} :
    path === "/internal/v1/trades/detail" ? {subject, tradeId:payload} : {subject});
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", env.SAAS_INTERNAL_SECRET!)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`).digest("hex");
  const response = await fetch(new URL(path, env.SAAS_INTERNAL_API_URL), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json",
      "X-Saas-Timestamp": timestamp, "X-Saas-Nonce": nonce, "X-Saas-Signature": signature },
    body,
  });
  if (!response.ok) throw new Error(`Manual trade service unavailable (HTTP ${response.status})`);
  return response.json();
}

export async function fetchManualTrades(subject: string): Promise<JournalResult> {
  const result = await postS2("/internal/v1/trades/list", subject) as JournalResult;
  if (!result || !Array.isArray(result.events) || result.source !== "USER_ASSERTED_ONLY")
    throw new Error("Invalid manual trade response");
  return result;
}

export async function submitManualTrade(subject: string, trade: ManualEventInput): Promise<CreateResult> {
  const result = await postS2("/internal/v1/trades/create", subject, trade) as CreateResult;
  if (!result || typeof result.id !== "string" || result.source !== "USER_ASSERTED")
    throw new Error("Invalid manual trade confirmation");
  return result;
}

export type JournalEntry = Readonly<{
  id: string; kind: JournalKind; ticker: string; content: string;
  tradeEventId: string | null; createdAt: string; provenance: "USER_AUTHORED";
}>;
export type JournalKind = "THESIS" | "STRATEGY" | "REVIEW" | "TRADE_NOTE" |
  "WATCHLIST_ADD" | "WATCHLIST_REMOVE";
export type JournalEntryInput = {
  idempotencyKey: string; kind: JournalKind; ticker: string;
  content: string; tradeEventId: string | null;
};
export async function fetchJournal(subject: string): Promise<readonly JournalEntry[]> {
  const result = await postS2("/internal/v1/journal/list",subject) as {
    entries?: JournalEntry[]; source?: string
  };
  if (result?.source !== "USER_AUTHORED_ONLY" || !Array.isArray(result.entries))
    throw new Error("Invalid journal response");
  return result.entries;
}
export async function submitJournal(subject: string, entry: JournalEntryInput): Promise<string> {
  const result = await postS2("/internal/v1/journal/create",subject,entry) as { id?: string };
  if (!result?.id || !/^[0-9a-f-]{36}$/i.test(result.id)) throw new Error("Invalid journal confirmation");
  return result.id;
}
export async function exportFullJournal(subject: string): Promise<unknown> {
  const result = await postS2("/internal/v1/journal/export",subject) as { complete?: boolean; format?: string };
  if (result?.complete !== true || result?.format !== "stock-journal-ai.v1")
    throw new Error("Journal export is incomplete");
  return result;
}

export async function deleteMyAccount(subject:string, confirmation:"DELETE_MY_ACCOUNT"):Promise<void> {
  const response=await postS2("/internal/v1/account/delete",subject,confirmation) as {deleted?:boolean};
  if(response?.deleted!==true) throw new Error("Account deletion not confirmed");
}

export async function fetchTradeDetail(subject:string,id:string):Promise<ManualTradeEvent> {
  const result=await postS2("/internal/v1/trades/detail",subject,id) as {event?:ManualTradeEvent};
  if(!result?.event || result.event.id !== id) throw new Error("Trade detail unavailable");
  return result.event;
}

/** Prices are a full user-authored plan revision, NEVER a broker order. */
export type JournalPlan = Readonly<{
  id:string; ticker:string; targetPrice:string|null; stopPrice:string|null;
  priceCurrency:string|null; rationale:string; createdAt:string;
  provenance:"USER_AUTHORED"; isBrokerOrder:false;
}>;
export type JournalPlanInput = {
  idempotencyKey:string; ticker:string; targetPrice:string|null;
  stopPrice:string|null; priceCurrency:string|null; rationale:string;
};
export async function fetchJournalPlans(subject:string):Promise<readonly JournalPlan[]> {
  const result=await postS2("/internal/v1/journal/plans",subject) as {
    plans?:JournalPlan[]; source?:string;
  };
  if(result?.source!=="USER_AUTHORED_ONLY" || !Array.isArray(result.plans) ||
     result.plans.length>200 || !result.plans.every(p=>
       p && p.provenance==="USER_AUTHORED" && p.isBrokerOrder===false &&
       typeof p.id==="string" && typeof p.ticker==="string" &&
       typeof p.rationale==="string" && typeof p.createdAt==="string" &&
       (p.targetPrice===null || typeof p.targetPrice==="string") &&
       (p.stopPrice===null || typeof p.stopPrice==="string") &&
       (p.priceCurrency===null || typeof p.priceCurrency==="string")))
    throw new Error("Invalid plan history response");
  return result.plans;
}
export async function submitJournalPlan(subject:string,plan:JournalPlanInput):Promise<string> {
  const result=await postS2("/internal/v1/journal/plan/create",subject,plan) as {id?:string};
  if(!result?.id || !/^[0-9a-f-]{36}$/i.test(result.id))
    throw new Error("Invalid plan confirmation");
  return result.id;
}
