import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { saasAuthConfigured } from "./saas-auth-policy";
import type {MonthlyProcessReport} from "./monthly-process";

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
      "/internal/v1/journal/list" | "/internal/v1/journal/create" | "/internal/v1/journal/export" | "/internal/v1/journal/monthly-process" | "/internal/v1/journal/weekly-process" | "/internal/v1/risk-factors/list" | "/internal/v1/risk-factors/create" |
      "/internal/v1/journal/plans" | "/internal/v1/journal/plan/create" |
      "/internal/v1/journal/checkin/context" | "/internal/v1/journal/checkin/create" |
      "/internal/v1/journal/broker-note/create" | "/internal/v1/journal/observation-note/create" | "/internal/v1/ai/claim" |
      "/internal/v1/account/delete" | "/internal/v1/trades/detail",
                      subject: string, payload?: ManualEventInput | JournalEntryInput | JournalPlanInput | BrokerFillNoteInput | TigerObservationNoteInput | AiClaimInput | PlanCheckinInput | RiskFactorInput | "DELETE_MY_ACCOUNT" | string): Promise<unknown> {
  const env = process.env;
  if (!saasAuthConfigured(env, env.NODE_ENV === "development")
      || !/^[0-9]{3,255}$/.test(subject)) {
    throw new Error("Authenticated financial API not configured");
  }
  const body = JSON.stringify(path === "/internal/v1/trades/create" ? {subject, trade:payload} :
    path === "/internal/v1/journal/create" ? {subject, entry:payload} :
    path === "/internal/v1/journal/broker-note/create" ? {subject, brokerNote:payload} :
    path === "/internal/v1/journal/observation-note/create" ? {subject, observationNote:payload} :
    path === "/internal/v1/journal/monthly-process" ? {subject,month:payload} :
    path === "/internal/v1/journal/weekly-process" ? {subject,week:payload} :
    path === "/internal/v1/risk-factors/create" ? {subject,riskFactors:payload} :
    path === "/internal/v1/journal/checkin/context" ? {subject,ticker:payload} :
    path === "/internal/v1/journal/checkin/create" ? {subject,checkin:payload} :
    path === "/internal/v1/ai/claim" ? {subject,...(payload as AiClaimInput)} :
    path === "/internal/v1/journal/plan/create" ? {subject, plan:payload} :
    path === "/internal/v1/account/delete" ? {subject, confirmation:payload} :
    path === "/internal/v1/trades/detail" ? {subject, tradeId:payload} : {subject});
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", env.SAAS_INTERNAL_SECRET!)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`).digest("hex");
  const response = await fetch(new URL(path, env.SAAS_INTERNAL_API_URL), {
    method: "POST", cache: "no-store",
    signal: AbortSignal.timeout((path === "/internal/v1/journal/broker-note/create" ||
      path === "/internal/v1/journal/observation-note/create") ? 14000 : 5000),
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
  brokerRef:{accountId:string;sourceRef:string;reviewVersion:number}|null;
  observationRef:{accountId:string;sourceRef:string;kind:"ORDER"|"FILL";status:"OBSERVED_NOT_VERIFIED"}|null;
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
/** Aggregated by the scoped service DB over a complete NZ calendar month.
 * No recent-feed truncation and no raw financial/AI payload in the response.
 */
export const RISK_FACTOR_LABELS={
 AI_INFRA:"AI 인프라·반도체",HIGH_GROWTH:"고성장 기대",
 US_TECH:"미국 기술주",CONSUMER_CYCLICAL:"경기민감 소비",
 SPACE_DEFENSE:"우주·방산",INTEREST_RATE:"금리 민감",
 CHINA:"중국 시장 노출",OTHER:"기타 공통 요인",
} as const;
export type UserRiskFactor=keyof typeof RISK_FACTOR_LABELS;
export type RiskFactorInput=Readonly<{
 idempotencyKey:string;ticker:string;factors:UserRiskFactor[];rationale:string;
}>;
export type RiskFactorRevision=Readonly<{
 id:string;ticker:string;factors:UserRiskFactor[];
 rationale:string;createdAt:string;
}>;
export async function fetchUserRiskFactors(subject:string):Promise<readonly RiskFactorRevision[]>{
 const r=await postS2("/internal/v1/risk-factors/list",subject) as {
   complete?:boolean;source?:string;riskFactors?:RiskFactorRevision[];
 };
 const valid=new Set(Object.keys(RISK_FACTOR_LABELS));
 if(r?.complete!==true||r.source!=="USER_CLASSIFIED_ONLY"||
    !Array.isArray(r.riskFactors)||r.riskFactors.length>100||
    !r.riskFactors.every(x=>x&&/^[A-Z0-9.:-]{1,32}$/.test(x.ticker)&&
       /^[a-f0-9-]{36}$/i.test(x.id)&&typeof x.rationale==="string"&&
       x.rationale.length>=1&&x.rationale.length<=1500&&
       Number.isFinite(Date.parse(x.createdAt))&&Array.isArray(x.factors)&&
       x.factors.length<=3&&new Set(x.factors).size===x.factors.length&&
       x.factors.every(a=>valid.has(a))))
   throw new Error("Risk factor history incomplete");
 return r.riskFactors;
}
export async function submitRiskFactors(subject:string,input:RiskFactorInput):Promise<string>{
 const r=await postS2("/internal/v1/risk-factors/create",subject,input) as {id?:string;source?:string};
 if(!r||r.source!=="USER_CLASSIFIED_ONLY"||typeof r.id!=="string"||
   !/^[a-f0-9-]{36}$/i.test(r.id))throw new Error("Risk factor confirmation invalid");
 return r.id;
}

export type WeeklyProcessReport=Readonly<{
  week:string;timezone:"Pacific/Auckland";start:string;end:string;
  checkedAsOf:string;partial:boolean;source:"USER_AUTHORED_PROCESS_ONLY";
  coverage:"WEEK_WINDOW_DB_AGGREGATED";complete:true;
  noteCount:number;reviewCount:number;planRevisionCount:number;
  selfReviewCount:number;activePlans:number;duePlans:number;
  symbols:readonly {ticker:string;notes:number;reviews:number;plans:number;selfReviews:number}[];
  tasks:readonly {ticker:string;cadence:string;nextDueAt:string;state:"DUE"|"UPCOMING";
    lastAssessment:string|null;lastNextAction:string|null;lastSelfReviewAt:string|null}[];
}>;
export async function fetchWeeklyProcessReport(subject:string,week:string):Promise<WeeklyProcessReport>{
 if(!/^20[2-9][0-9]-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(week))
   throw new Error("Invalid week");
 const x=await postS2("/internal/v1/journal/weekly-process",subject,week) as WeeklyProcessReport;
 const count=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
 if(x?.week!==week||x.timezone!=="Pacific/Auckland"||
   x.source!=="USER_AUTHORED_PROCESS_ONLY"||x.coverage!=="WEEK_WINDOW_DB_AGGREGATED"||
   x.complete!==true||typeof x.partial!=="boolean"||
   !Number.isFinite(Date.parse(x.start))||!Number.isFinite(Date.parse(x.end))||
   !Number.isFinite(Date.parse(x.checkedAsOf))||
   Date.parse(x.start)>=Date.parse(x.end)||
   Date.parse(x.checkedAsOf)<Date.parse(x.start)||
   Date.parse(x.checkedAsOf)>Date.parse(x.end)||
   ![x.noteCount,x.reviewCount,x.planRevisionCount,x.selfReviewCount,
     x.activePlans,x.duePlans].every(count)||
   x.reviewCount>x.noteCount||x.selfReviewCount>x.reviewCount||
   !Array.isArray(x.tasks)||x.tasks.length>100||
   !Array.isArray(x.symbols)||x.symbols.length>100||
   !x.symbols.every(r=>/^[A-Z0-9.:-]{1,32}$/.test(r.ticker)&&
      [r.notes,r.reviews,r.plans,r.selfReviews].every(count))||
   !x.tasks.every(t=>/^[A-Z0-9.:-]{1,32}$/.test(t.ticker)&&
      ["WEEKLY","MONTHLY","QUARTERLY","SEMIANNUAL","ANNUAL"].includes(t.cadence)&&
      ["DUE","UPCOMING"].includes(t.state)&&
      Number.isFinite(Date.parse(t.nextDueAt))&&
      (t.lastAssessment===null||["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"].includes(t.lastAssessment))&&
      (t.lastNextAction===null||(typeof t.lastNextAction==="string"&&t.lastNextAction.length<=1500))&&
      (t.lastSelfReviewAt===null||Number.isFinite(Date.parse(t.lastSelfReviewAt))))||
   x.duePlans!==x.tasks.filter(t=>t.state==="DUE").length)
   throw new Error("Incomplete or invalid weekly review report");
 return x;
}

export async function fetchMonthlyProcessReport(subject:string,month:string):Promise<MonthlyProcessReport>{
 if(!/^20[2-9][0-9]-(?:0[1-9]|1[0-2])$/.test(month))throw new Error("Invalid report month");
 const result=await postS2("/internal/v1/journal/monthly-process",subject,month) as
   MonthlyProcessReport&{coverage?:string;complete?:boolean};
 const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
 const symbols=result?.symbols;
 if(result?.month!==month || result?.source!=="USER_AUTHORED_PROCESS_ONLY" ||
    result?.coverage!=="MONTH_WINDOW_DB_AGGREGATED" || result?.complete!==true ||
    result?.timezone!=="Pacific/Auckland" ||
    !Number.isFinite(Date.parse(result.start)) || !Number.isFinite(Date.parse(result.end)) ||
    !Number.isFinite(Date.parse(result.checkedAsOf)) ||
    !Array.isArray(symbols) || symbols.length>100 ||
    !symbols.every(s=>s&&/^[A-Z0-9.:-]{1,32}$/.test(s.ticker)&&
      [s.notes,s.reviews,s.plans,s.manualRecords].every(count)) ||
    result.adherenceBasis!=="USER_SELF_ASSESSED_NOT_BROKER_VERIFIED" ||
    !result.selfReviewBreakdown ||
    !["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"].every(k=>
      count(result.selfReviewBreakdown[k as keyof typeof result.selfReviewBreakdown])) ||
    Object.values(result.selfReviewBreakdown).reduce<number>((total,val)=>total+Number(val),0)!==result.selfReviewCount ||
    ![result.selfReviewCount,result.noteCount,result.reviewCount,result.planRevisionCount,
      result.userTradeRecordCount,result.voidCount,result.uniqueSymbols,
      result.plannedSymbols,result.completeStrategySymbols,
      result.dueAsOfCutoff].every(count))
    throw new Error("Incomplete or invalid monthly process report");
 return result;
}

export async function submitJournal(subject: string, entry: JournalEntryInput): Promise<string> {
  const result = await postS2("/internal/v1/journal/create",subject,entry) as { id?: string };
  if (!result?.id || !/^[0-9a-f-]{36}$/i.test(result.id)) throw new Error("Invalid journal confirmation");
  return result.id;
}
export async function exportFullJournal(subject: string): Promise<unknown> {
  const result = await postS2("/internal/v1/journal/export",subject) as {
    complete?: boolean; format?: string; journal?:unknown;
    trades?:unknown;plans?:unknown;planSelfReviews?:unknown;riskFactors?:unknown;
  };
  if (result?.complete !== true || result?.format !== "stock-journal-ai.v1"
      || !Array.isArray(result.journal) || !Array.isArray(result.trades)
      || !Array.isArray(result.plans) || !Array.isArray(result.planSelfReviews)
      || !Array.isArray(result.riskFactors))
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

export type PlanSelfAssessment="FOLLOWED"|"PARTIAL"|"DEVIATED"|"UNCERTAIN";
export type PlanCheckinInput={
  idempotencyKey:string; ticker:string; expectedPlanRevisionId:string;
  selfAssessment:PlanSelfAssessment;content:string;nextAction:string;
};
export type PlanCheckinContext={
  ticker:string;currentPlan:JournalPlan|null;
  recent:readonly {id:string;planRevisionId:string;selfAssessment:PlanSelfAssessment;
    nextAction:string;createdAt:string;content:string}[];
  recentLimit:10;source:"USER_SELF_ASSESSED_ONLY";
};
export async function fetchPlanCheckinContext(subject:string,ticker:string):Promise<PlanCheckinContext>{
 if(!/^[A-Z0-9.:-]{1,32}$/.test(ticker))throw new Error("Invalid ticker");
 const result=await postS2("/internal/v1/journal/checkin/context",subject,ticker) as PlanCheckinContext;
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(result?.ticker!==ticker||result.source!=="USER_SELF_ASSESSED_ONLY"||
    result.recentLimit!==10||!Array.isArray(result.recent)||result.recent.length>10||
    (result.currentPlan!==null&&(!result.currentPlan||
      result.currentPlan.ticker!==ticker||!uuid.test(result.currentPlan.id)||
      result.currentPlan.provenance!=="USER_AUTHORED"||
      result.currentPlan.isBrokerOrder!==false))||
    !result.recent.every(c=>uuid.test(c.id)&&uuid.test(c.planRevisionId)&&
      ["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"].includes(c.selfAssessment)&&
      Number.isFinite(Date.parse(c.createdAt))&&
      typeof c.content==="string"&&typeof c.nextAction==="string"))
   throw new Error("Invalid self-review context");
 return result;
}
export async function submitPlanCheckin(subject:string,review:PlanCheckinInput):Promise<string>{
 const result=await postS2("/internal/v1/journal/checkin/create",subject,review) as
   {id?:string;provenance?:string};
 if(!result?.id||!/^[a-f0-9-]{36}$/i.test(result.id)||
    result.provenance!=="USER_SELF_ASSESSED")
   throw new Error("Self-review was not confirmed");
 return result.id;
}

/** Full user-authored plan revision, NEVER a brokerage or price-triggered order.
 * Legacy six-field snapshots have unset strategy values.
 */
export type InvestmentStrategyType="LONG_TERM"|"TECHNICAL"|"EVENT_DRIVEN"|"OTHER";
export type InvestmentHorizon="UNDER_3_MONTHS"|"THREE_TO_TWELVE_MONTHS"|
  "ONE_TO_THREE_YEARS"|"OVER_THREE_YEARS"|"OPEN_ENDED";
export type ReviewCadence="WEEKLY"|"MONTHLY"|"QUARTERLY"|
  "SEMIANNUAL"|"ANNUAL"|"EVENT_DRIVEN";
export type JournalStrategyFields={
  strategyType?:InvestmentStrategyType|null;
  investmentHorizon?:InvestmentHorizon|null;
  invalidationCondition?:string|null;
  maxAllocationPct?:string|null;
  reviewCadence?:ReviewCadence|null;
};
export type JournalPlan = Readonly<{
  id:string; ticker:string; targetPrice:string|null; stopPrice:string|null;
  priceCurrency:string|null; rationale:string; createdAt:string;
  provenance:"USER_AUTHORED"; isBrokerOrder:false;
} & JournalStrategyFields>;
export type JournalPlanInput = {
  idempotencyKey:string; ticker:string; targetPrice:string|null;
  stopPrice:string|null; priceCurrency:string|null; rationale:string;
} & JournalStrategyFields;
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
       (p.priceCurrency===null || typeof p.priceCurrency==="string") &&
       (p.strategyType==null || ["LONG_TERM","TECHNICAL","EVENT_DRIVEN","OTHER"].includes(p.strategyType)) &&
       (p.investmentHorizon==null || ["UNDER_3_MONTHS","THREE_TO_TWELVE_MONTHS",
          "ONE_TO_THREE_YEARS","OVER_THREE_YEARS","OPEN_ENDED"].includes(p.investmentHorizon)) &&
       (p.invalidationCondition==null || (typeof p.invalidationCondition==="string" &&
          p.invalidationCondition.length>0 && p.invalidationCondition.length<=1500)) &&
       (p.maxAllocationPct==null || (typeof p.maxAllocationPct==="string" &&
          /^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/.test(p.maxAllocationPct) &&
          Number(p.maxAllocationPct)>0 && Number(p.maxAllocationPct)<=100)) &&
       (p.reviewCadence==null || ["WEEKLY","MONTHLY","QUARTERLY",
          "SEMIANNUAL","ANNUAL","EVENT_DRIVEN"].includes(p.reviewCadence))))
    throw new Error("Invalid plan history response");
  return result.plans;
}
export async function submitJournalPlan(subject:string,plan:JournalPlanInput):Promise<string> {
  const result=await postS2("/internal/v1/journal/plan/create",subject,plan) as {id?:string};
  if(!result?.id || !/^[0-9a-f-]{36}$/i.test(result.id))
    throw new Error("Invalid plan confirmation");
  return result.id;
}

/** User-written note attached to one independently verified Tiger fill.
 *  A broker note cannot be created for a staged/blocked/partial source.
 */
export type BrokerFillNoteInput = {
  idempotencyKey:string;
  ticker:string;
  content:string;
  accountId:string;
  sourceRef:string;
};
export async function submitBrokerFillNote(subject:string, note:BrokerFillNoteInput):Promise<string>{
  const result=await postS2("/internal/v1/journal/broker-note/create",subject,note) as {
    id?:string; source?:string;
  };
  if(!result || typeof result.id!=="string" ||
     !/^[0-9a-f-]{36}$/i.test(result.id) || result.source!=="USER_AUTHORED")
    throw new Error("Broker fill note not confirmed");
  return result.id;
}

/** Owner-authored rationale bound to an actually observed (unverified) Tiger
 * order/fill. The server rechecks owner-only source evidence under RLS.
 * This cannot create a manual trade, verified fill, or broker order.
 */
export type TigerObservationNoteInput={
  idempotencyKey:string;ticker:string;content:string;
  sourceRef:string;observationKind:"ORDER"|"FILL";page:number;
};
export async function submitTigerObservationNote(subject:string,note:TigerObservationNoteInput):Promise<string>{
  const result=await postS2("/internal/v1/journal/observation-note/create",subject,note) as {id?:string;source?:string};
  if(!result || typeof result.id!=="string" ||
     !/^[0-9a-f-]{36}$/i.test(result.id) || result.source!=="USER_AUTHORED")
    throw new Error("Tiger observation note not confirmed");
  return result.id;
}

/** Atomic, identity-verified, tenant-scoped daily/monthly AI quota.
 * No private notes or financial data ever go to the quota endpoint.
 */
export type AiClaimInput={mode:"STOCK_REVIEW"|"HABITS"|"COACHING";consented:true};
export async function claimAiAnalysis(subject:string,mode:AiClaimInput["mode"]):Promise<{
  remainingDay:number;remainingMonth:number
}>{
  const result=await postS2("/internal/v1/ai/claim",subject,{mode,consented:true}) as
    {claimed?:boolean;remainingDay?:number;remainingMonth?:number};
  if(result?.claimed!==true || !Number.isInteger(result.remainingDay) ||
     !Number.isInteger(result.remainingMonth))throw new Error("AI_QUOTA_FAILED");
  return {remainingDay:result.remainingDay!,remainingMonth:result.remainingMonth!};
}
