/** Follow-up queue grounded in owner-scoped holdings and latest user-authored plans.
 * No quotes, automatic trades, guessed thresholds, price alerts or inferred sectors.
 * Observed Tiger-only exposure is a comparison reference, never compliance proof.
 */
import type {JournalPlan,RiskFactorRevision} from "./saas-trades-api";
import type {TigerPersonalRead} from "./tiger-api";
import {assessPortfolioOverviewRisk,hasHoldingsReadWarnings} from "./portfolio-overview-risk";

type Plans=readonly JournalPlan[]|null;
type Factors=readonly Pick<RiskFactorRevision,"ticker"|"factors">[]|null;
export type PortfolioReviewInput=Readonly<{personal:TigerPersonalRead;plans:Plans;factors:Factors}>;
export type PortfolioReviewAction=Readonly<{
 id:string;kind:"CHECK"|"PLAN"|"FACTOR"|"COMPARE"|"REVIEW";
 priority:"FIRST"|"NEXT"|"OPTIONAL";ticker:string|null;
 title:string;description:string;href:string;actionLabel:string;
 observedTigerPct:string|null;personalMaxAllocationPct:string|null;
}>;
export type PortfolioReviewQueue=Readonly<{
 actions:readonly PortfolioReviewAction[];
 holdingCount:number|null;plannedCount:number|null;classifiedCount:number|null;
 comparisonReady:boolean;asOf:string|null;currency:string|null;
}>;
const SAFE_TICKER=/^[A-Z0-9.:-]{1,32}$/;
const POSITIVE=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/;
const missing=(value:string|null|undefined)=>!value||!value.trim();
const priorityOrder={FIRST:0,NEXT:1,OPTIONAL:2};

export function portfolioReviewQueue({personal,plans,factors}:PortfolioReviewInput,at=new Date()):PortfolioReviewQueue{
 const holdings=[...new Set(personal.accounts.flatMap(a=>a.positions)
   .filter(p=>SAFE_TICKER.test(p.symbol)&&POSITIVE.test(p.quantity)&&
     p.quantity.split(".").some(part=>/[1-9]/.test(part)))
   .map(p=>p.symbol))].sort();
 const now=at.getTime();
 const stale=personal.accounts.some(a=>{
   const observed=a.asOf===null?NaN:Date.parse(a.asOf);
   return !Number.isFinite(observed)||observed>now||
     now-observed>7*24*60*60*1000;
 });
 const missingScope=personal.coverage!=="SNAPSHOT_ONLY"||personal.verified!==false||
   personal.accounts.length===0||personal.accounts.length>5||
   new Set(personal.accounts.map(a=>a.alias)).size!==personal.accounts.length||
   personal.accounts.some(a=>!a.alias);
 const blocked=missingScope||hasHoldingsReadWarnings(personal.readWarnings)||
   personal.accounts.some(a=>a.positions.length>=100)||stale;
 const planReady=plans!==null&&plans.length<200;
 const factorReady=factors!==null&&factors.length<=100&&
   new Set(factors.map(f=>f.ticker)).size===factors.length;
 const latest=new Map<string,JournalPlan>();
 if(planReady)for(const plan of [...plans].sort((a,b)=>
   b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))){
   if(!latest.has(plan.ticker))latest.set(plan.ticker,plan);
 }
 const factorMap=new Map(factorReady?factors.map(f=>[f.ticker,f.factors] as const):[]);
 const risk=blocked?null:assessPortfolioOverviewRisk(personal,planReady?plans:null,at);
 const comparable=risk?.state==="READY"?risk:null;
 const exposures=new Map(comparable?.positions.map((p,index)=>[p.ticker,{...p,index}])??[]);
 const actions:PortfolioReviewAction[]=[];
 const add=(input:Omit<PortfolioReviewAction,"observedTigerPct"|"personalMaxAllocationPct">)=>{
   const exposure=input.ticker?exposures.get(input.ticker):null;
   actions.push({...input,observedTigerPct:exposure?.observedTigerPct??null,
     personalMaxAllocationPct:exposure?.personalMaxAllocationPct??null});
 };
 if(blocked){
   add({id:missingScope?"holdings-scope":hasHoldingsReadWarnings(personal.readWarnings)?"partial":stale?"holdings-stale":"holdings-limit",
     kind:"CHECK",priority:"FIRST",ticker:null,title:"보유종목 조회 범위를 먼저 확인하세요",
     description:missingScope?"계좌 스냅샷의 범위·계좌 식별 또는 출처를 확인할 수 없습니다. 보유 종목이 없거나 투자계획이 누락됐다고 판단하지 않습니다.":stale?"보유종목 관측 시각이 없거나 7일을 초과했거나 미래 시각입니다. 최신 보유 여부를 확인하기 전에는 미작성 계획이나 위험분류를 단정하지 않습니다.":"보유자산 자료가 제외되었거나 종목 조회 상한에 도달했습니다. 누락 여부를 확인하기 전에는 미작성 계획이나 위험분류를 단정하지 않습니다.",
     href:"/private/brokers",actionLabel:"계좌 연결 점검"});
   return {actions,holdingCount:null,plannedCount:null,classifiedCount:null,
     comparisonReady:false,asOf:null,currency:null};
 }
 if(!planReady){
   add({id:"plan-unavailable",kind:"CHECK",priority:"FIRST",ticker:null,
     title:"투자계획 조회 범위를 확인하세요",
     description:"최신 계획을 완전하게 불러오지 못했습니다. 계획이 없거나 빠졌다고 판단하지 않습니다.",
     href:"/private/journal",actionLabel:"투자계획 확인"});
 }
 if(!factorReady){
   add({id:"factor-unavailable",kind:"CHECK",priority:"NEXT",ticker:null,
     title:"위험분류 자료를 확인하세요",
     description:"저장된 사용자 분류가 불완전합니다. 미분류 종목 수를 추정하지 않습니다.",
     href:"/private/portfolio/risk-groups/edit",actionLabel:"분류 확인"});
 }
 for(const ticker of holdings){
   const plan=latest.get(ticker);
   const exposure=exposures.get(ticker);
   if(planReady){
     if(exposure?.aboveObservedTigerReference===true){
       add({id:"cap:"+ticker,kind:"COMPARE",priority:"FIRST",ticker,
         title:ticker+" · 작성한 최대 비중과 관측 비중 비교",
         description:"Tiger 계좌 기준 관측 비중이 직접 설정한 최대 비중보다 높습니다. 외부 자산을 제외한 참고 비교이며 투자계획 위반 또는 매도 신호는 아닙니다.",
         href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker),
         actionLabel:"계획 기준 재검토"});
     }
     if(!plan){
       add({id:"plan:"+ticker,kind:"PLAN",priority:"NEXT",ticker,
         title:ticker+" · 투자 이유와 대응 기준 기록",
         description:"보유종목에 작성된 투자계획이 없습니다. 투자 이유, 판단이 달라지는 조건과 점검 방법을 먼저 적어 두세요.",
         href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker),
         actionLabel:"투자계획 작성"});
     }else{
       if(missing(plan.invalidationCondition)){
         add({id:"condition:"+ticker,kind:"PLAN",priority:"NEXT",ticker,
           title:ticker+" · 투자 판단을 다시 볼 조건 정하기",
           description:"기존 계획은 보존합니다. 기업·사업·시장 가정 중 무엇이 달라지면 투자 논리를 재검토할지 기록해 보세요. 손절가 입력이 필수라는 뜻은 아닙니다.",
           href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker),
           actionLabel:"재검토 조건 기록"});
       }
       if(!plan.reviewCadence){
         add({id:"cadence:"+ticker,kind:"REVIEW",priority:"OPTIONAL",ticker,
           title:ticker+" · 점검 주기 선택",
           description:"정기 점검 또는 사건 발생 시 점검 중 본인의 전략에 맞는 방식을 정해 둘 수 있습니다. 자동 시세 감시나 매매 알림은 생성하지 않습니다.",
           href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker),
           actionLabel:"점검 주기 설정"});
       }
     }
   }
   if(factorReady&&!factorMap.get(ticker)?.length){
     add({id:"factor:"+ticker,kind:"FACTOR",priority:"OPTIONAL",ticker,
       title:ticker+" · 함께 움직일 수 있는 위험 직접 분류",
       description:"다른 보유종목과 공유할 수 있는 위험 요인을 본인이 선택하세요. 업종·상관계수를 자동 판정한 결과가 아닙니다.",
       href:"/private/portfolio/risk-groups/edit?ticker="+encodeURIComponent(ticker),
       actionLabel:"위험 요인 분류"});
   }
 }
 actions.sort((a,b)=>{
   const p=priorityOrder[a.priority]-priorityOrder[b.priority];
   if(p)return p;
   const ai=a.ticker?exposures.get(a.ticker)?.index:undefined;
   const bi=b.ticker?exposures.get(b.ticker)?.index:undefined;
   if(ai!==undefined&&bi!==undefined&&ai!==bi)return ai-bi;
   if(ai!==undefined&&bi===undefined)return -1;
   if(ai===undefined&&bi!==undefined)return 1;
   const ticker=(a.ticker??"").localeCompare(b.ticker??"");
   return ticker||a.id.localeCompare(b.id);
 });
 return {actions,holdingCount:holdings.length,
   plannedCount:planReady?holdings.filter(t=>latest.has(t)).length:null,
   classifiedCount:factorReady?holdings.filter(t=>(factorMap.get(t)?.length??0)>0).length:null,
   comparisonReady:comparable!==null,asOf:comparable?.asOf??null,
   currency:comparable?.currency??null};
}

/** Backwards-compatible read-only suggestion list for the critical alert strip. */
export function portfolioReviewActions(input:PortfolioReviewInput):PortfolioReviewAction[]{
 return [...portfolioReviewQueue(input).actions];
}
