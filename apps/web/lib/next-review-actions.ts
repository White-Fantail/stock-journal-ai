import type {JournalPlan,JournalEntry,InvestorPrinciples,ReviewAction} from "./saas-trades-api";
import type {TigerPersonalRead} from "./tiger-api";
import {dueInvestmentReviews} from "./review-schedule";

export type NextReviewAction=Readonly<{id:string;title:string;detail:string;href:string;priority:number}>;
export type NextReviewInput=Readonly<{
  principles:InvestorPrinciples|null;principlesAvailable:boolean;
  notes:readonly JournalEntry[]|null;plans:readonly JournalPlan[]|null;
  personal:TigerPersonalRead|null;followups?:readonly ReviewAction[]|null;now?:Date;
}>;
/** User-authored cadence and observed holdings ONLY; no quotes, trades or price triggers. */
export function deriveNextReviewActions(input:NextReviewInput):NextReviewAction[]{
  const actions:NextReviewAction[]=[];
  if(!input.principlesAvailable){
    actions.push({id:"principles-unavailable",priority:2,title:"내 투자 원칙을 확인하지 못했습니다",
      detail:"저장된 원칙을 확인할 수 없으므로 새로운 설정이 없다고 판단하지 않습니다.",
      href:"/private/principles"});
  }else if(!input.principles){
    actions.push({id:"principles",priority:10,title:"나의 투자 원칙부터 정해 보세요",
      detail:"목표와 위험 한도, 점검 주기를 선택적으로 기록할 수 있습니다. 증권사 연결은 필요하지 않습니다.",
      href:"/private/getting-started"});
  }
  if(input.followups===null){
    actions.push({id:"followups-unavailable",priority:4,title:"이전 점검 행동을 확인하지 못했습니다",
      detail:"지난 점검의 실행 여부가 확인되지 않았습니다. 점검 화면에서 다시 확인해 주세요.",
      href:"/private/review"});
  }else if(input.followups?.length){
    const pending=input.followups.filter(f=>f.state!=="DONE"&&f.state!=="NOT_APPLICABLE")
      .sort((a,b)=>b.checkinAt.localeCompare(a.checkinAt))[0];
    if(pending) actions.push({id:"followup:"+pending.checkinId,priority:15,
      title:pending.ticker+" · 지난 점검의 다음 행동 확인",
      detail:"내가 적은 행동의 실행 여부를 직접 확인하고 기록해 주세요.",
      href:"/private/review/action/new?checkin="+encodeURIComponent(pending.checkinId)});
  }
  if(input.notes===null||input.plans===null||
     input.notes.length>=200||input.plans.length>=200){
    actions.push({id:"notes-unavailable",priority:1,title:"투자 기록을 모두 확인하지 못했습니다",
      detail:"일지 조회가 불완전하여 점검 누락을 추정하지 않습니다.",
      href:"/private/journal"});
  }else{
    const now=input.now??new Date();
    for(const review of dueInvestmentReviews(input.plans,input.notes,now)
       .filter(x=>x.state==="DUE").slice(0,2)){
      actions.push({id:"review:"+review.ticker,priority:20,
        title:review.ticker+" 투자 계획을 점검할 때입니다",
        detail:"내가 정한 정기 점검 주기가 도래했습니다. 투자 논리가 유효한지 직접 확인하세요.",
        href:"/private/journal/review/new?ticker="+encodeURIComponent(review.ticker)});
    }
    if(input.personal?.readWarnings?.length){
      actions.push({id:"broker-partial",priority:3,title:"계좌 조회에서 일부 정보가 제외됐습니다",
        detail:"현재 자료가 불완전합니다. 잔고나 보유 종목 전체로 해석하지 마세요.",
        href:"/private/tiger/diagnostics"});
    }else if(input.personal?.accounts?.length){
      const planned=new Set(input.plans.map(x=>x.ticker));
      const unplanned=[...new Set(input.personal.accounts.flatMap(a=>a.positions.map(p=>p.symbol)))]
        .filter(symbol=>!planned.has(symbol)&&/^[A-Z0-9.:-]{1,32}$/.test(symbol))
        .sort();
      if(unplanned.length){
        actions.push({id:"plan:"+unplanned[0],priority:30,
          title:unplanned[0]+" 투자 계획을 기록해 보세요",
          detail:"최근 관측된 보유 종목이지만 현재 조회한 투자 계획은 없습니다. 관측 자료는 확정 원장이 아닙니다.",
          href:"/private/journal/new?mode=plan&ticker="+encodeURIComponent(unplanned[0])});
      }
    }
    if(!input.notes.length&&!input.plans.length&&!input.personal?.accounts?.length){
      actions.push({id:"first-plan",priority:40,title:"첫 투자 판단을 남겨 보세요",
        detail:"종목을 선택하고 투자 이유를 기록하세요. 거래를 먼저 입력할 필요는 없습니다.",
        href:"/private/journal/new?mode=plan"});
    }
  }
  return actions.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id)).slice(0,3);
}
