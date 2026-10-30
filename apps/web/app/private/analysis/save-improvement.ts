"use server";

import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchPlanCheckinContext,submitPlanCheckin,type PlanSelfAssessment} from "../../../lib/saas-trades-api";

export type AiImprovementSaveState=Readonly<{
  status:"idle"|"error"|"saved";message:string;
}>;
export const initialAiImprovementSaveState:AiImprovementSaveState={status:"idle",message:""};
const error=(message:string):AiImprovementSaveState=>({status:"error",message});
const field=(form:FormData,name:string)=>{
  const value=form.get(name);
  return typeof value==="string"?value.trim():"";
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKER=/^[A-Z0-9.:-]{1,32}$/;
const assessments=new Set<PlanSelfAssessment>(["FOLLOWED","PARTIAL","DEVIATED","UNCERTAIN"]);

/**
 * Explicitly user-approved AI suggestion -> ordinary immutable, authored
 * plan check-in. It is NOT a separate AI-generated plan revision and it does
 * not infer the user's adherence, place orders or send any data to an LLM.
 */
export async function saveAiImprovement(
  _prior:AiImprovementSaveState,form:FormData,
):Promise<AiImprovementSaveState>{
  if(field(form,"approval")!=="USER_REVIEWED_AND_APPROVED")
    return error("AI 제안을 직접 검토하고 채택 여부를 확인해 주세요.");
  const ticker=field(form,"ticker");
  const planId=field(form,"expectedPlanRevisionId");
  const idempotencyKey=field(form,"idempotencyKey");
  const selfAssessment=field(form,"selfAssessment") as PlanSelfAssessment;
  const content=field(form,"content");
  const nextAction=field(form,"nextAction");
  if(!TICKER.test(ticker)||!UUID.test(planId)||!UUID.test(idempotencyKey)||
     !assessments.has(selfAssessment)||!content||content.length>6000||
     !nextAction||nextAction.length>1500)
    return error("종목, 기존 계획 또는 자기평가 입력을 다시 확인해 주세요.");
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  const subject=session?.user?.id;
  if(!workspace||!subject||!/^[0-9]{3,255}$/.test(subject))
    return error("로그인과 개인 워크스페이스 확인이 필요합니다.");
  try{
    const context=await fetchPlanCheckinContext(subject,ticker);
    if(!context.currentPlan||context.currentPlan.id!==planId)
      return error("투자계획이 변경됐거나 현재 계획을 확인하지 못했습니다. 최신 계획을 먼저 검토해 주세요.");
    await submitPlanCheckin(subject,{
      idempotencyKey,ticker,expectedPlanRevisionId:planId,
      selfAssessment,content,nextAction,
    });
    return {status:"saved",message:"내가 승인한 개선 행동을 투자 자기평가와 다음 점검에 기록했습니다."};
  }catch{
    return error("저장 결과를 확인하지 못했습니다. 투자 점검에서 저장 여부를 먼저 확인해 주세요.");
  }
}
