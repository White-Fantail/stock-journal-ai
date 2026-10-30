import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { auth } from "../auth";
import { currentWorkspace } from "./require-workspace";
import { saasAuthConfigured } from "./saas-auth-policy";
import { parsePersonalRead } from "./tiger-personal-parse";

export type TigerConnection = { id: string; status: string; expiresAt: string | null; lastSuccessAt: string | null };
export type TigerAccount = { id: string; connectionId: string; alias: string };
export type TigerStatus = { provider: "TIGER"; enabled: boolean; connections: TigerConnection[]; accounts: TigerAccount[] };
export type TigerSyncJob = {
  id:string; accountId:string; accountAlias:string; connectionStatus:string;
  state:string; startUtc:string | null; endUtc:string | null;
  updatedAt:string | null; totalWindows:number; processedWindows:number;
  certifiedWindows:number; pendingWindows:number; runningWindows:number;
  blockedWindows:number; pagesStaged:number; nextRetryAt:string | null;
  issueCodes:string[]; historyVerified:false; coverage:"UNVERIFIED";
};
export type TigerSyncStatus = {
  provider:"TIGER"; syncEnabled:false; coverage:"UNVERIFIED"; jobs:TigerSyncJob[];
};
export type TigerAction = "ledger-read" | "review-status" | "sync-status" | "status" | "start" | "callback" | "bind" | "read" | "disconnect" | "personal-view" | "personal-health-view" | "personal-diagnostics" | "personal-refresh" | "personal-refresh-status";

async function subjectForRequest(): Promise<string> {
  const [session, scope] = await Promise.all([auth(), currentWorkspace()]);
  const subject = session?.user?.id;
  if (!scope || !subject || !/^[0-9]{3,255}$/.test(subject))
    throw new Error("UNAUTHORIZED");
  return subject;
}

/** Gateway body is fixed by the server: never accept tenant/URL/token from browser. */
export async function tigerCall(action: TigerAction, extra: Record<string,string> = {}): Promise<unknown> {
  const env = process.env;
  if (!saasAuthConfigured(env, env.NODE_ENV === "development"))
    throw new Error("NOT_CONFIGURED");
  const subject = await subjectForRequest();
  const path = "/internal/v1/tiger/" + action;
  const body = JSON.stringify({ ...extra, subject }); // fresh Google subject cannot be overridden
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", env.SAAS_INTERNAL_SECRET!)
    .update(timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + body).digest("hex");
  const response = await fetch(new URL(path, env.SAAS_INTERNAL_API_URL), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(14000),
    headers: { "Content-Type": "application/json", "X-Saas-Timestamp": timestamp,
      "X-Saas-Nonce": nonce, "X-Saas-Signature": signature }, body,
  });
  if (!response.ok) throw new Error("TIGER_" + response.status);
  return response.json();
}

export async function tigerStatus(): Promise<TigerStatus> {
  const value = await tigerCall("status") as TigerStatus;
  if (!value || value.provider !== "TIGER" || !Array.isArray(value.connections) || !Array.isArray(value.accounts))
    throw new Error("INVALID_TIGER_STATUS");
  return value;
}

export function checkSameOrigin(request: Request): boolean {
  const expected = process.env.AUTH_URL;
  const origin = request.headers.get("origin");
  if (!expected || !origin) return false;
  try {
    return new URL(expected).origin === origin &&
      new URL(request.url).origin === origin;
  } catch { return false; }
}

export function safeTigerRedirect(path: string): URL {
  const base = process.env.AUTH_URL;
  if (!base || new URL(base).protocol !== "https:") throw new Error("AUTH_URL_REQUIRED");
  return new URL(path, base);
}

/** Signed internal read only. Actual broker history is NOT published. */
export async function tigerSyncStatus():Promise<TigerSyncStatus> {
  const value=await tigerCall("sync-status") as TigerSyncStatus;
  if (!value || value.provider!=="TIGER" || !Array.isArray(value.jobs) ||
      value.coverage!=="UNVERIFIED" || value.syncEnabled!==false ||
      value.jobs.length>25 ||
      !value.jobs.every(j=>j && typeof j.accountAlias==="string" &&
        typeof j.id==="string" && typeof j.pagesStaged==="number" &&
        Number.isInteger(j.pagesStaged) && j.pagesStaged>=0 &&
        typeof j.totalWindows==="number" && j.totalWindows>=0 &&
        typeof j.processedWindows==="number" && j.processedWindows>=0 &&
        j.processedWindows<=j.totalWindows &&
        j.historyVerified===false && j.coverage==="UNVERIFIED" &&
        Array.isArray(j.issueCodes)))
    throw new Error("INVALID_TIGER_SYNC_STATUS");
  return value;
}

/** Latest immutable reconciliation status; never exposes staged money or fills. */
export type TigerReviewIssue = {
  code:string;
  category:"COVERAGE"|"EXECUTION"|"FEES"|"CORPORATE_ACTION"|"CASH"|"SNAPSHOT"|"AUTHORIZATION"|"INTEGRITY";
  severity:"BLOCKER"|"REVIEW";
  scope:"ACCOUNT"|"WINDOW"|"EXECUTION"|"SNAPSHOT";
};
export type TigerReviewAccount = {
  accountId:string; alias:string; version:number;
  state:"BLOCKED"|"STAGED"; createdAt:string;
  issues:TigerReviewIssue[]; sourceEvidenceCount:number;
};
export type TigerReviewStatus = {
  provider:"TIGER"; published:false; accounts:TigerReviewAccount[];
};
export async function tigerReviewStatus():Promise<TigerReviewStatus> {
  const data=await tigerCall("review-status") as TigerReviewStatus;
  if(!data || data.provider!=="TIGER" || data.published!==false ||
     !Array.isArray(data.accounts) || data.accounts.length>50 ||
     !data.accounts.every(a=>a && typeof a.accountId==="string" &&
       typeof a.alias==="string" && Number.isInteger(a.version) && a.version>0 &&
       (a.state==="BLOCKED" || a.state==="STAGED") &&
       typeof a.createdAt==="string" && Array.isArray(a.issues) &&
       a.issues.length<=64 && Number.isInteger(a.sourceEvidenceCount) &&
       a.sourceEvidenceCount>=0 && a.sourceEvidenceCount<=5000 &&
       a.issues.every(i=>i && typeof i.code==="string" &&
         /^[A-Z][A-Z0-9_]{1,63}$/.test(i.code) &&
         ["COVERAGE","EXECUTION","FEES","CORPORATE_ACTION","CASH","SNAPSHOT",
          "AUTHORIZATION","INTEGRITY"].includes(i.category) &&
         ["BLOCKER","REVIEW"].includes(i.severity) &&
         ["ACCOUNT","WINDOW","EXECUTION","SNAPSHOT"].includes(i.scope))))
    throw new Error("INVALID_TIGER_REVIEW_STATUS");
  return data;
}

/** Released broker facts, always separate from user-authored journal events.
 *  The service returns an empty, UNVERIFIED state until Tiger + independent
 *  publication + read-only rollout are formally approved. Never mock balances.
 */
export type VerifiedBrokerExecution = Readonly<{
  sourceRef:string;accountId:string;symbol:string;side:"BUY"|"SELL";
  currency:string;quantity:string;price:string;fee:string;
  executedAt:string;reviewVersion:number;provenance:"BROKER_VERIFIED";
}>;
export type VerifiedBrokerPosition = Readonly<{
  accountId:string;symbol:string;currency:string;quantity:string;
  costBasis:string;realizedPnl:string;asOf:string;
  reviewVersion:number;provenance:"BROKER_VERIFIED";
}>;
export type TigerLedgerRead = Readonly<{
  provider:"TIGER";readEnabled:boolean;
  coverage:"UNVERIFIED"|"VERIFIED_ACCOUNTS_ONLY";
  accounts:ReadonlyArray<{
    accountId:string;alias:string;state:"NOT_AUTHORIZED"|"NOT_VERIFIED"|"VERIFIED";
    version?:number;asOf?:string;
  }>;
  executions:ReadonlyArray<VerifiedBrokerExecution>;
  positions:ReadonlyArray<VerifiedBrokerPosition>;
  truncated:boolean;
}>;

const ledgerDecimal=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const ledgerSymbol=/^[A-Z0-9.:-]{1,32}$/;
const ledgerUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validLedgerTime=(v:unknown)=>typeof v==="string" && v.length<=64 && Number.isFinite(Date.parse(v));

export async function tigerLedgerRead():Promise<TigerLedgerRead> {
  const data=await tigerCall("ledger-read") as TigerLedgerRead;
  if(!data || data.provider!=="TIGER" || typeof data.readEnabled!=="boolean" ||
     typeof data.truncated!=="boolean" ||
     !Array.isArray(data.accounts) || data.accounts.length>25 ||
     !Array.isArray(data.executions) || data.executions.length>100 ||
     !Array.isArray(data.positions) || data.positions.length>100 ||
     data.coverage!==(data.readEnabled?"VERIFIED_ACCOUNTS_ONLY":"UNVERIFIED") ||
     !data.accounts.every(a=>a && ledgerUuid.test(a.accountId) &&
       typeof a.alias==="string" && a.alias.length<=100 &&
       ["NOT_AUTHORIZED","NOT_VERIFIED","VERIFIED"].includes(a.state) &&
       (a.state!=="VERIFIED" || (Number.isInteger(a.version) && (a.version??0)>0 && validLedgerTime(a.asOf)))) ||
     !data.executions.every(e=>e && /^[0-9a-f]{64}$/.test(e.sourceRef) &&
       ledgerUuid.test(e.accountId) && ledgerSymbol.test(e.symbol) &&
       ["BUY","SELL"].includes(e.side) && /^[A-Z]{3}$/.test(e.currency) &&
       [e.quantity,e.price,e.fee].every(v=>typeof v==="string" && ledgerDecimal.test(v)) &&
       validLedgerTime(e.executedAt) && Number.isInteger(e.reviewVersion) &&
       e.reviewVersion>0 && e.provenance==="BROKER_VERIFIED" &&
       data.accounts.some(a=>a.accountId===e.accountId && a.state==="VERIFIED" && a.version===e.reviewVersion)) ||
     !data.positions.every(p=>p && ledgerUuid.test(p.accountId) &&
       ledgerSymbol.test(p.symbol) && /^[A-Z]{3}$/.test(p.currency) &&
       [p.quantity,p.costBasis].every(v=>typeof v==="string" && ledgerDecimal.test(v)) &&
       typeof p.realizedPnl==="string" && /^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/.test(p.realizedPnl) &&
       validLedgerTime(p.asOf) && Number.isInteger(p.reviewVersion) &&
       p.reviewVersion>0 && p.provenance==="BROKER_VERIFIED" &&
       data.accounts.some(a=>a.accountId===p.accountId && a.state==="VERIFIED" && a.version===p.reviewVersion)) ||
     (!data.readEnabled && (data.accounts.length!==0 || data.executions.length!==0 ||
                            data.positions.length!==0 || data.truncated)))
    throw new Error("INVALID_TIGER_LEDGER_READ");
  return data;
}

/** Owner-only personal Tiger observed data. Never claim verified fills/returns.
 * Server requires the immutable Google subject + tenant RLS for every request.
 * Other signed-in accounts get null and retain the official approval UI.
 */
export type TigerPersonalPosition = Readonly<{
  symbol:string;currency:string;quantity:string;averageCost:string|null;
  marketValue:string|null;unrealizedPnl:string|null
}>;
export type TigerPersonalOrder = Readonly<{
  sourceRef:string;symbol:string;currency:string;side:"BUY"|"SELL";
  status:string;filled:string|null;price:string|null;fee:string|null;
  feeCurrency:string|null;at:string|null
}>;
export type TigerPersonalFill = Readonly<{
  sourceRef:string;orderSourceRef?:string;symbol:string;currency:string;side:"BUY"|"SELL";
  quantity:string;price:string;timeRaw:string|null
}>;
export type TigerPersonalFee = Readonly<{
  sourceRef:string;symbol:string;status:"MATCHED"|"CURRENCY_UNKNOWN";
  total:string;currency:string|null;
  details:ReadonlyArray<{category:"TIGER"|"THIRD_PARTY";type:string;amount:string}>
}>;
export type TigerMarketObservation = Readonly<{
  symbol:string;currency:"USD";price:string;quoteAt:string;
  mode:"US_DELAYED_15M"|"REALTIME_PERMISSIONED";stale:boolean;
  estimatedValue:string|null;estimatedUnrealized:string|null;estimatedReturnPct:string|null;
}>;
export type TigerPersonalAccount = Readonly<{
  alias:string;asOf:string|null;
  assets:{netLiquidation:string|null;cashBalance:string|null;currency:string|null}|null;
  positions:TigerPersonalPosition[];
  marketObservations:TigerMarketObservation[];
  orders:TigerPersonalOrder[];
  fillObservations:TigerPersonalFill[];
  feeObservations:TigerPersonalFee[];
  fillProbeCount:number;fillProbeUnavailable:number;fillProbeDifference:number;
  fillProbePartial:number;fillProbeTruncated:boolean;
  feeProbeMatched:number;feeProbeCurrencyUnknown:number;
  feeProbeDifference:number;feeProbeUnavailable:number;
  windowCount:number;partial:boolean;truncated:boolean;hasMore:boolean;totalOrders:number
}>;
export type TigerPersonalRead = Readonly<{
  coverage:"SNAPSHOT_ONLY";verified:false;accounts:TigerPersonalAccount[];
  readWarnings?:readonly string[]
}>;
export async function tigerPersonalRead(page=0):Promise<TigerPersonalRead|null> {
  if(!Number.isInteger(page) || page<0 || page>20) return null;
  try {
    const raw=await tigerCall("personal-view",{page:String(page)});
    const parsed=parsePersonalRead(raw);
    if(!parsed.value){
      console.warn("[tiger-personal] invalid account response",parsed.warnings.join(","));
      return null;
    }
    if(parsed.warnings.length)
      console.warn("[tiger-personal] partial response retained",parsed.warnings.join(","));
    if(parsed.value.accounts.length===0)
      console.warn("[tiger-personal] authorized read returned no accounts");
    return parsed.value;
  } catch(error) {
    const code=error instanceof Error && /^TIGER_[0-9]{3}$/.test(error.message)
      ? error.message : "UNAVAILABLE";
    if(code!=="TIGER_403") console.warn("[tiger-personal] owner read failed",code);
    return null;
  }
}

/** Signed owner-only cron health. This does NOT attest brokerage transactions. */
export type TigerPersonalHealth=Readonly<{
  source:"PERSONAL_SYNC_HEALTH";coverageVerified:false;
  accounts:ReadonlyArray<{
    alias:string;lastAssetsAt:string|null;
    latest:null|{alias:string;latestRunAt:string;assets:"OK"|"FAILED";
       orders:"OK"|"PARTIAL"|"FAILED";fills:"OK"|"PARTIAL"|"UNAVAILABLE"};
  }>;
}>;
export async function tigerPersonalHealth():Promise<TigerPersonalHealth|null>{
  try{
    const result=await tigerCall("personal-health-view") as TigerPersonalHealth;
    const iso=(s:unknown)=>typeof s==="string" && !Number.isNaN(Date.parse(s));
    if(!result || result.source!=="PERSONAL_SYNC_HEALTH" || result.coverageVerified!==false ||
       !Array.isArray(result.accounts) || result.accounts.length>5 ||
       !result.accounts.every(a=>a && typeof a.alias==="string" && a.alias.length<=100 &&
         (a.lastAssetsAt===null||iso(a.lastAssetsAt)) &&
         (a.latest===null || (a.latest && a.latest.alias===a.alias &&
           iso(a.latest.latestRunAt) && ["OK","FAILED"].includes(a.latest.assets) &&
           ["OK","PARTIAL","FAILED"].includes(a.latest.orders) &&
           ["OK","PARTIAL","UNAVAILABLE"].includes(a.latest.fills)))))
      throw new Error("INVALID_TIGER_HEALTH");
    return result;
  }catch{
    return null;
  }
}

/** Only aggregate metadata for the authorized personal-Tiger owner. */
export type TigerPersonalDiagnostics=Readonly<{
  source:"PERSONAL_READ_DIAGNOSTIC";
  connections:ReadonlyArray<{mode:string;status:string;count:number}>;
  accountCount:number;
  pilotReadableAccountCount:number;
  snapshotCounts:ReadonlyArray<{kind:string;count:number}>;
}>;
export async function tigerPersonalDiagnostics():Promise<TigerPersonalDiagnostics|null>{
  try{
    const value=await tigerCall("personal-diagnostics") as TigerPersonalDiagnostics;
    const count=(n:unknown)=>Number.isSafeInteger(n) && (n as number)>=0;
    if(!value || value.source!=="PERSONAL_READ_DIAGNOSTIC" ||
       !count(value.accountCount) || !count(value.pilotReadableAccountCount) ||
       value.pilotReadableAccountCount>value.accountCount ||
       !Array.isArray(value.connections) || value.connections.length>20 ||
       !Array.isArray(value.snapshotCounts) || value.snapshotCounts.length>12 ||
       !value.connections.every(x=>x && typeof x.mode==="string" &&
         /^[A-Z_]{2,32}$/.test(x.mode) && typeof x.status==="string" &&
         /^[A-Z_]{2,32}$/.test(x.status) && count(x.count)) ||
       !value.snapshotCounts.every(x=>x && typeof x.kind==="string" &&
         /^[A-Z_]{2,32}$/.test(x.kind) && count(x.count))) return null;
    return value;
  }catch{return null;}
}


/** Personal RSA refresh state; never carries an account reference or broker data. */
export type TigerPersonalRefreshState = Readonly<{
  state:"IDLE"|"RUNNING"|"COMPLETED"|"FAILED"|"COOLDOWN"|"UNAVAILABLE";
  mode?:"MANUAL"|"HOURLY"|"DAILY"|null;
  startedAt?:string|null;finishedAt?:string|null;
  lastSuccessfulAt?:string|null;nextAllowedAt?:string|null;
}>;
export async function tigerPersonalRefresh(request=false):Promise<TigerPersonalRefreshState> {
  const value=await tigerCall(request?"personal-refresh":"personal-refresh-status") as TigerPersonalRefreshState;
  if(!value || !["IDLE","RUNNING","COMPLETED","FAILED","COOLDOWN","UNAVAILABLE"].includes(value.state))
    throw new Error("INVALID_REFRESH_STATE");
  const valid=(v:unknown)=>v===undefined || v===null ||
    typeof v==="string" && v.length<=48 && Number.isFinite(Date.parse(v));
  if(![value.startedAt,value.finishedAt,value.lastSuccessfulAt,value.nextAllowedAt].every(valid))
    throw new Error("INVALID_REFRESH_TIMESTAMP");
  return value;
}
