/** Investor action proposals based on scoped snapshot metadata and authored intent.
 * No trading thresholds, price polling, quote history, cross-FX inference or risk score.
 */
import type {JournalPlan,RiskFactorRevision} from "./saas-trades-api";
import type {TigerPersonalRead} from "./tiger-api";
import {hasHoldingsReadWarnings} from "./portfolio-overview-risk";

type Plans=readonly Pick<JournalPlan,"ticker"|"createdAt"|"id">[]|null;
type Factors=readonly Pick<RiskFactorRevision,"ticker"|"factors">[]|null;
export type PortfolioReviewInput=Readonly<{
 personal:TigerPersonalRead;
 plans:Plans;factors:Factors;
}>;
export type PortfolioReviewAction=Readonly<{
 id:string;title:string;description:string;href:string;kind:"CHECK"|"PLAN"|"FACTOR";
}>;
const SAFE_TICKER=/^[A-Z0-9.:-]{1,32}$/;

export function portfolioReviewActions({personal,plans,factors}:PortfolioReviewInput):PortfolioReviewAction[]{
 const actions:PortfolioReviewAction[]=[];
 const add=(item:PortfolioReviewAction)=>{if(!actions.some(a=>a.id===item.id))actions.push(item);};
 // Only holdings-related validation failures suppress decisions about missing plans
 // and shared risks. Historical orders can be incomplete without hiding stocks.
 if(hasHoldingsReadWarnings(personal.readWarnings)){
   add({id:"partial",kind:"CHECK",title:"보유 자산 원본 조회를 확인하세요",
    description:"보유종목·계좌자산·기준 시각의 일부 자료가 제외됐습니다. 전체 비중이나 미작성 종목을 확정하지 않습니다.",
    href:"/private/brokers"});
   return actions;
 }
 if(personal.accounts.some(a=>a.positions.length>=100)){
   add({id:"holdings-limit",kind:"CHECK",title:"보유 종목 목록의 완전성을 확인하세요",
    description:"조회 상한에 도달해 빠진 종목이 있을 수 있습니다. 현재 목록을 전체 보유 내역으로 판단하지 않습니다.",
    href:"/private/brokers"});
   return actions;
 }
 const names=[...new Set(personal.accounts.flatMap(a=>a.positions)
   .filter(p=>p.quantity!=="0"&&SAFE_TICKER.test(p.symbol)).map(p=>p.symbol))].sort();
 if(plans===null||plans.length>=200){
   add({id:"plan-unavailable",kind:"CHECK",title:"내 투자계획 조회를 확인하세요",
    description:"계획 기록을 완전하게 확인하지 못해 미작성 종목을 추정하지 않습니다.",
    href:"/private/journal"});
 }else{
   const planned=new Set(plans.map(p=>p.ticker));
   for(const ticker of names.filter(t=>!planned.has(t)).slice(0,2)){
     add({id:"plan:"+ticker,kind:"PLAN",title:ticker+" 투자계획을 기록하세요",
       description:"관측된 보유 종목에 현재 작성한 계획이 없습니다. 투자 이유와 재검토 조건부터 적어 보세요.",
       href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(ticker)});
   }
 }
 if(factors===null||factors.length>100){
   add({id:"factor-unavailable",kind:"CHECK",title:"내 위험 요인 분류를 확인하세요",
     description:"저장된 분류 기록을 모두 확인하지 못해 위험군 미분류를 추정하지 않습니다.",
     href:"/private/portfolio"});
 }else if(names.length){
   const latest=new Map(factors.map(f=>[f.ticker,f.factors]));
   const ticker=names.find(t=>!latest.get(t)?.length);
   if(ticker){
     add({id:"factor:"+ticker,kind:"FACTOR",title:ticker+" 공통 위험 요인을 분류해 보세요",
       description:"이 종목이 다른 보유 종목과 같은 위험에 노출됐는지 직접 기록할 수 있습니다. 자동 업종 판정은 아닙니다.",
       href:"/private/portfolio/risk-groups/edit?ticker="+encodeURIComponent(ticker)});
   }
 }
 return actions.slice(0,3);
}
