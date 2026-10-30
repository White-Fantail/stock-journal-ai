/** Only explicit, tenant-scoped and user-authored operations may be exposed to MCP.
 * The Railway API independently validates subject/membership/RLS on every call.
 */
import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { parsePersonalRead } from "./tiger-personal-parse";
import { requireMcpWriteFields } from "./positionary-mcp-write-validation";
import {
  fetchManualTrades, fetchJournal, fetchJournalPlans, fetchInvestorPrinciples,
  fetchUserRiskFactors, fetchIndicatorRules, fetchIndicatorRecords,
  fetchReviewActions, fetchWeeklyProcessReport, fetchMonthlyProcessReport,
  submitJournal, submitJournalPlan, submitManualTrade,
  submitInvestorPrinciples, submitRiskFactors, saveIndicatorRule, saveIndicatorRecord,
  submitPlanCheckin, submitReviewAction, submitTigerObservationNote,
} from "./saas-trades-api";

type Args = Record<string, unknown>;
type Shape = Record<string, unknown>;
export type Tool = {
  name: string; description: string; write: boolean;
  inputSchema: Shape;
  invoke: (subject: string, args: Args) => Promise<unknown>;
};
const TICKER = /^[A-Z0-9.:-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function obj(x: unknown): Args {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Expected an object");
  return x as Args;
}
function field(x: Args, name: string): string {
  const raw = x[name];
  if (typeof raw !== "string") throw new Error("Missing string field: " + name);
  return raw;
}
function payload(args: Args): Args {
  const p = obj(args.payload);
  if (!UUID.test(field(p, "idempotencyKey"))) throw new Error("A stable UUID idempotencyKey is required");
  return p;
}
function only(args: Args, allowed: string[]): void {
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error("Unexpected tool arguments");
}
function read(name: string, description: string, properties: Shape, required: string[],
  invoke: Tool["invoke"]): Tool {
  return { name, description, write: false, inputSchema: {
    type: "object", properties, required, additionalProperties: false }, invoke };
}
function write(name: string, description: string, properties: Shape, required: string[],
  invoke: (sub: string, p: Args) => Promise<unknown>): Tool {
  return { name, description: description + " Requires explicit user approval. This writes only user-authored records, not a brokerage order.",
    write: true,
    inputSchema: { type: "object", properties: {
      confirm: { type: "boolean", const: true, description: "Only true after the user explicitly approves the particular update." },
      payload: { type: "object", properties: {
        idempotencyKey: { type: "string", description: "Stable UUID for this single write, reused on retries." },
        ...properties,
      }, required: ["idempotencyKey", ...required], additionalProperties: false },
    }, required: ["confirm", "payload"], additionalProperties: false },
    invoke: async (sub, args) => {
      only(args, ["confirm", "payload"]);
      if (args.confirm !== true) throw new Error("Explicit user confirmation required");
      const p = payload(args);
      only(p, ["idempotencyKey", ...Object.keys(properties)]);
      requireMcpWriteFields(p, required, properties);
      return invoke(sub, p);
    },
  };
}
const str = (description: string, maxLength=1500): Shape =>
  ({ type: "string", description, maxLength });
const optionalStr = (description: string, maxLength=1500): Shape =>
  ({ type: ["string", "null"], description, maxLength });
const ticker = { type: "string", pattern: "^[A-Z0-9.:-]{1,32}$", description: "Uppercase ticker." };
const option = (items: string[]) => ({ type: "string", enum: items });
const JOURNAL_FORMAT_GUIDANCE = [
  "For a new substantial investment note drafted from the conversation, use readable plain text with real newline characters and blank lines between sections, never a single dense paragraph.",
  "Use brief, applicable section labels such as 판단 요약, 근거, 진입·보류 조건, 위험, 다음 확인. Put A/B/C scenarios and their conditions on separate lines.",
  "Preserve the user's facts, prices, dates, conditions, uncertainty, and actual-versus-proposed trade status exactly; never invent or imply an execution. Do not rewrite previously stored notes.",
  "For a short verbatim note from the user, preserve their wording instead of adding unrequested sections. Do not use HTML or Markdown tables.",
].join(" ");
const note = str("User's original notes. Never invent their intent. " + JOURNAL_FORMAT_GUIDANCE, 6000);
const date = str("ISO-8601 datetime with timezone", 64);
const uuid = str("Existing Positionary record UUID", 36);
const nullableUuid = { type: ["string", "null"], description: "Existing user's UUID or null" };
const decimal = optionalStr("Exact decimal as a string; null if unset.", 32);

async function tiger(subject: string, action: "personal-view"|"status"|"ledger-read"|"personal-refresh"|"personal-refresh-status", page?: number): Promise<unknown> {
  const path = "/internal/v1/tiger/" + action;
  const body = JSON.stringify(action === "personal-view" ? {subject, page: String(page ?? 0)} : {subject});
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac("sha256", process.env.SAAS_INTERNAL_SECRET!)
    .update(timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + body).digest("hex");
  const response = await fetch(new URL(path, process.env.SAAS_INTERNAL_API_URL), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(14000),
    headers: { "Content-Type": "application/json", "X-Saas-Timestamp": timestamp,
      "X-Saas-Nonce": nonce, "X-Saas-Signature": signature }, body
  });
  if (!response.ok) throw new Error(response.status === 403 ? "BROKER_NOT_AUTHORIZED" : "BROKER_READ_UNAVAILABLE");
  return response.json();
}
async function personal(subject: string, page: number) {
  const parsed = parsePersonalRead(await tiger(subject, "personal-view", page));
  if (!parsed.value) throw new Error("Account observation invalid or unavailable");
  return parsed.value;
}
const planFields: Shape = {
  ticker, targetPrice: decimal, stopPrice: decimal,
  priceCurrency: optionalStr("Currency for target and stop values", 3),
  rationale: str("User-authored investment thesis and plan", 6000),
  strategyType: { type: ["string", "null"], enum: ["LONG_TERM", "TECHNICAL", "EVENT_DRIVEN", "OTHER", null] },
  investmentHorizon: { type: ["string", "null"], enum:
    ["UNDER_3_MONTHS","THREE_TO_TWELVE_MONTHS","ONE_TO_THREE_YEARS","OVER_THREE_YEARS","OPEN_ENDED",null] },
  invalidationCondition: optionalStr("Plan invalidation trigger; not an automatic order", 1500),
  maxAllocationPct: decimal,
  reviewCadence: { type: ["string", "null"], enum: ["WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "EVENT_DRIVEN", null] },
  riskDecisionNote: optionalStr("Personal scenario-risk judgement", 1200),
};
export const MCP_TOOLS: readonly Tool[] = [
  read("get_tiger_connection_status", "Read this user's Tiger connection state; never implies account approval or verified transactions.", {}, [],
    async sub => tiger(sub, "status")),
  read("get_account_snapshot", "Owner-authorized Tiger observed assets, positions and market-value estimates, with timestamps and partial-coverage warnings. Not audited performance or trading advice.", {}, [],
    async sub => {
      const data = await personal(sub, 0);
      return {coverage:data.coverage,verified:false,readWarnings:data.readWarnings??[],
        accounts:data.accounts.map(a => ({alias:a.alias,asOf:a.asOf,assets:a.assets,
          positions:a.positions,marketObservations:a.marketObservations,
          partial:a.partial,truncated:a.truncated,hasMore:a.hasMore,windowCount:a.windowCount}))};
    }),
  read("get_tiger_order_observations", "Read owner-authorized order, partial-fill and fee observations by page (0 to 20). They are NOT independently verified trades.", {
    page: {type:"integer",minimum:0,maximum:20}
  }, ["page"], async (sub,a) => {
    only(a, ["page"]); const p=a.page;
    if(!Number.isInteger(p)||Number(p)<0||Number(p)>20)throw new Error("Invalid page");
    const data=await personal(sub,Number(p));
    return {coverage:"SNAPSHOT_ONLY",verified:false,page:Number(p),readWarnings:data.readWarnings??[],
      accounts:data.accounts.map(a=>({alias:a.alias,asOf:a.asOf,orders:a.orders,
        fillObservations:a.fillObservations,feeObservations:a.feeObservations,
        partial:a.partial,truncated:a.truncated,hasMore:a.hasMore,totalOrders:a.totalOrders,
        fillProbePartial:a.fillProbePartial,fillProbeTruncated:a.fillProbeTruncated}))};
  }),
  read("request_tiger_order_refresh",
    "User-triggered read-only Tiger RSA sync for the current owner: request recent 30-day order and partial-fill observation refresh. No broker orders are placed or modified. If state is RUNNING, use get_tiger_order_refresh_status until COMPLETED before searching observed orders. COOLDOWN means a recent request is already rate-limited, not a fresh synchronization. Never claim a broker execution from this result.",
    {},[],async sub=>{
      const state=await tiger(sub,"personal-refresh") as {state?:string};
      if(!state || typeof state.state!=="string" || state.state==="UNAVAILABLE")throw new Error("TIGER_REFRESH_UNAVAILABLE");
      return {...state,source:"PERSONAL_REFRESH_ONLY",verified:false};
    }),
  read("get_tiger_order_refresh_status",
    "Check the current read-only Tiger refresh job without triggering it. After state COMPLETED, call get_tiger_order_observations(page=0) and identify the exact order; a refresh is NOT proof of execution, settled fees or complete broker history.",
    {},[],async sub=>{
      const state=await tiger(sub,"personal-refresh-status") as {state?:string};
      if(!state || typeof state.state!=="string" || state.state==="UNAVAILABLE")throw new Error("TIGER_REFRESH_UNAVAILABLE");
      return {...state,source:"PERSONAL_REFRESH_ONLY",verified:false};
    }),
  read("get_verified_broker_ledger", "Read independently released, still-valid broker facts only. Empty/unverified results are not zeros.", {}, [],
    async sub=>tiger(sub,"ledger-read")),
  read("list_manual_trades", "Read self-entered manual execution and correction records; never confuse with broker fills.", {}, [],
    async sub=>fetchManualTrades(sub)),
  read("list_investment_journal", "Read investment theses, plan notes and legacy stored notes. TRADE_NOTE records with observationRef, brokerRef or tradeEventId belong to the linked TRADE detail and must not be repeated as separate strategy decisions. For a user asking why a specific order was placed, use the trade note tools.",{},[],
    async sub=>fetchJournal(sub)),
  read("list_investment_plans", "Read versioned user-defined target, stop, strategy, horizon and review cadence; not live orders.",{},[],
    async sub=>fetchJournalPlans(sub)),
  read("get_investor_principles", "Read user-authored portfolio-wide goals, risk limits and review preferences.",{},[],
    async sub=>fetchInvestorPrinciples(sub)),
  read("list_risk_factors", "Read user-classified overlapping portfolio risk exposures.",{},[],
    async sub=>fetchUserRiskFactors(sub)),
  read("list_indicator_rules", "Read manually defined RSI/other indicator criteria and revision history.",{},[],
    async sub=>fetchIndicatorRules(sub)),
  read("list_indicator_observations", "Read user-entered indicator snapshots. No live indicator calculation.",{
    ticker: optionalStr("Ticker filter or null",32),
    tradeEventId: nullableUuid,journalId:nullableUuid,
  },["ticker","tradeEventId","journalId"],async (sub,a)=>{
    only(a,["ticker","tradeEventId","journalId"]);
    if(a.ticker!==null && (typeof a.ticker!=="string" || !TICKER.test(a.ticker)))throw new Error("Invalid ticker");
    for(const k of ["tradeEventId","journalId"])if(a[k]!==null && (typeof a[k]!=="string"||!UUID.test(a[k] as string)))throw new Error("Invalid filter");
    return fetchIndicatorRecords(sub,a as Parameters<typeof fetchIndicatorRecords>[1]);
  }),
  read("list_review_actions", "Read self-reported pending and resolved next actions.",{},[],
    async sub=>fetchReviewActions(sub)),
  read("get_weekly_review", "Read bounded user-authored weekly investment process review; no verified financial return.",{
    week:str("ISO week, e.g. 2026-W44",8)
  },["week"],async (sub,a)=>fetchWeeklyProcessReport(sub,field(a,"week"))),
  read("get_monthly_review", "Read bounded user-authored monthly investment process review, not verified performance.",{
    month:str("YYYY-MM",7)
  },["month"],async (sub,a)=>fetchMonthlyProcessReport(sub,field(a,"month"))),
  write("add_investment_journal", "Append a user-approved ticker-level investment thesis, strategy or general review. Do NOT use this tool when the user asks to record the reason for a specific Tiger order; use add_tiger_order_note instead after identifying the exact sourceRef. Generic unlinked historical TRADE_NOTE is permitted for legacy recovery only. " + JOURNAL_FORMAT_GUIDANCE, {
    kind:option(["THESIS","STRATEGY","REVIEW","TRADE_NOTE","WATCHLIST_ADD","WATCHLIST_REMOVE"]),
    ticker,content:note,tradeEventId:nullableUuid,
  },["kind","ticker","content","tradeEventId"],
    (sub,p)=>submitJournal(sub,p as Parameters<typeof submitJournal>[1]).then(id=>({id,source:"USER_AUTHORED"}))),
  write("add_tiger_order_note",
    "PRIMARY tool when the user says 기록해줘/거래 이유 저장/매수·매도 이유 기록 for a particular Tiger order. Attach a user-approved TRADE_NOTE to that exact owner-authorized Tiger ORDER observation. The trade detail is the canonical presentation; journal shows only a summary link. Never also create a second add_investment_journal record with the same rationale. For a new order mentioned in chat: request_tiger_order_refresh, check status until COMPLETED, get_tiger_order_observations(page=0), match actual order sourceRef by symbol, BUY/SELL, orderType, trigger price, quantity and status. If multiple candidates or missing evidence, ask the user to select the right order; NEVER guess based on ticker alone. SUBMITTED/0 shares is a pending order, NOT a fill. Preserve the user's original facts, including stop/limit conditions and session scope. This does not submit or cancel trades. " + JOURNAL_FORMAT_GUIDANCE,{
      ticker, sourceRef:{type:"string",pattern:"^[0-9a-f]{64}$",description:"Exact sourceRef of an observed Tiger ORDER, obtained from get_tiger_order_observations; never invent."},
      page:{type:"integer",minimum:0,maximum:20,description:"Page containing this sourceRef at note creation."},
      content:note,
    },["ticker","sourceRef","page","content"],async (sub,p)=>{
      if(typeof p.ticker!=="string"||!TICKER.test(p.ticker) ||
         typeof p.sourceRef!=="string"||!/^[0-9a-f]{64}$/.test(p.sourceRef) ||
         !Number.isInteger(p.page)||Number(p.page)<0||Number(p.page)>20)
        throw new Error("INVALID_TIGER_ORDER_REFERENCE");
      // Backend additionally verifies that this exact reference exists for the
      // active owner and ticker under RLS before accepting an append-only note.
      const id=await submitTigerObservationNote(sub,{
        idempotencyKey:field(p,"idempotencyKey"),ticker:p.ticker,
        sourceRef:p.sourceRef,observationKind:"ORDER",page:p.page as number,
        content:field(p,"content")});
      return {id,source:"USER_AUTHORED",linkedTo:"TIGER_ORDER_OBSERVATION",verifiedExecution:false};
    }),
  write("revise_investment_plan", "Create a new plan revision; never modify broker orders or overwrite history.",planFields,
    ["ticker","targetPrice","stopPrice","priceCurrency","rationale","strategyType","investmentHorizon",
      "invalidationCondition","maxAllocationPct","reviewCadence"],
    (sub,p)=>submitJournalPlan(sub,p as Parameters<typeof submitJournalPlan>[1]).then(id=>({id,source:"USER_AUTHORED"}))),
  write("set_investor_principles", "Append a new user-authored portfolio policy revision.",{
    objective:optionalStr("Investment objective",1500),horizon:optionalStr("Time horizon",100),
    baseCurrency:optionalStr("Preferred reporting currency",3),
    maxSinglePct:decimal,riskLimitPct:decimal,
    reviewCadence:optionalStr("Review cadence",32),note:optionalStr("Investor note",3000),
  },["objective","horizon","baseCurrency","maxSinglePct","riskLimitPct","reviewCadence","note"],
    (sub,p)=>submitInvestorPrinciples(sub,p as Parameters<typeof submitInvestorPrinciples>[1]).then(id=>({id,source:"USER_AUTHORED"}))),
  write("record_manual_trade", "Record a USER_ASSERTED execution or VOID correction only; does not place broker trades.",{
    kind:option(["EXECUTION","VOID"]),ticker,side:option(["BUY","SELL"]),
    quantity:str("Exact share quantity string",32),price:str("Price per share decimal string",32),
    currency:str("Execution currency",3),fee:decimal,
    executedAt:date,rationale:str("Reason or correction explanation",3000),
    voidsEventId:nullableUuid,
  },["kind","rationale"],async (sub,p)=>{
    // Backend independently enforces execution/void shapes and explicit confirm.
    const trade=p.kind==="EXECUTION"?
      {idempotencyKey:p.idempotencyKey,kind:"EXECUTION" as const,confirm:true,
       ticker:p.ticker,side:p.side,quantity:p.quantity,price:p.price,
       currency:p.currency,fee:p.fee??null,executedAt:p.executedAt,rationale:p.rationale}:
      {idempotencyKey:p.idempotencyKey,kind:"VOID" as const,confirm:true,
       voidsEventId:p.voidsEventId,rationale:p.rationale};
    return submitManualTrade(sub,trade as Parameters<typeof submitManualTrade>[1]);
  }),
  write("save_indicator_rule", "Create or revise a user-defined indicator rule; server checks expected revision.",{
    ruleId:nullableUuid,expectedRevisionId:nullableUuid,
    name:str("Indicator e.g. RSI",100),parameters:str("Parameters e.g. 14",200),
    timeframe:str("Timeframe e.g. daily or 5m",100),side:option(["BUY","SELL"]),
    stage:option(["CONTEXT","TIMING"]),operator:option(["LTE","GTE","BETWEEN","MANUAL"]),
    lower:decimal,upper:decimal,condition:str("Manual condition / rationale",1500),
    active:{type:"boolean"}
  },["ruleId","expectedRevisionId","name","parameters","timeframe","side","stage",
    "operator","lower","upper","condition","active"],
    (sub,p)=>saveIndicatorRule(sub,p as Parameters<typeof saveIndicatorRule>[1]).then(id=>({id,source:"USER_AUTHORED"}))),
  write("record_indicator_observation", "Append user-entered indicator measurements and judgement; not market feed.",{
    ticker,side:option(["BUY","SELL"]),observedAt:date,
    tradeEventId:nullableUuid,journalId:nullableUuid,
    note:str("Reason and interpretation",2000),
    observations:{type:"array",minItems:1,maxItems:20,items:{type:"object",
      properties:{revisionId:uuid,value:decimal,assessment:option(["MET","NOT_MET","UNCERTAIN"])},
      required:["revisionId","value","assessment"],additionalProperties:false}},
  },["ticker","side","observedAt","tradeEventId","journalId","note","observations"],
    (sub,p)=>saveIndicatorRecord(sub,p as Parameters<typeof saveIndicatorRecord>[1]).then(id=>({id,source:"USER_AUTHORED"}))),
  write("revise_risk_factors", "Save the user's own risk classifications for one ticker.",{
    ticker, factors:{type:"array",minItems:0,maxItems:3,items:{type:"string"}},
    rationale:str("Reason for classification",1500),
  },["ticker","factors","rationale"],
    (sub,p)=>submitRiskFactors(sub,p as Parameters<typeof submitRiskFactors>[1]).then(id=>({id,source:"USER_CLASSIFIED_ONLY"}))),
  write("add_plan_checkin", "Record a user-confirmed plan review for a specific current revision.",{
    ticker,expectedPlanRevisionId:uuid,
    selfAssessment:option(["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"]),
    content:str("User's self-review",6000),nextAction:str("User-approved next action",1500),
  },["ticker","expectedPlanRevisionId","selfAssessment","content","nextAction"],
    (sub,p)=>submitPlanCheckin(sub,p as Parameters<typeof submitPlanCheckin>[1]).then(id=>({id,source:"USER_SELF_ASSESSED_ONLY"}))),
  write("resolve_review_action", "Mark a prior self-review action with an explicit user-reported outcome.",{
    checkinId:uuid,state:option(["DONE","NOT_DONE","NOT_APPLICABLE","UNCERTAIN"]),
    note:optionalStr("Outcome detail",1000),
  },["checkinId","state","note"],
    (sub,p)=>submitReviewAction(sub,p as Parameters<typeof submitReviewAction>[1]).then(id=>({id,source:"USER_REPORTED_ACTION_ONLY"}))),
];
export function toolsForScope(scope: string) {
  return MCP_TOOLS.filter(t => !t.write || scope.split(" ").includes("positionary:write"));
}
export async function invokeTool(subject: string, scope: string, name: string, args: unknown): Promise<unknown> {
  const tool = toolsForScope(scope).find(t => t.name === name);
  if (!tool) throw new Error("Tool unavailable or scope insufficient");
  return tool.invoke(subject, obj(args ?? {}));
}
