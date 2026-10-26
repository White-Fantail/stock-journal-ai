"use server";

import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {fetchJournal,fetchJournalPlans,fetchManualTrades,claimAiAnalysis} from "../../../lib/saas-trades-api";
import {tigerPersonalRead} from "../../../lib/tiger-api";
import {aiConfigured} from "../../../lib/ai-configuration";
import {aiRequestBody,evidenceForAnalysis,parseAiResult,safeAnalysisSymbol,
  type AiResult,type AnalysisEvidence,type AnalysisMode} from "../../../lib/ai-analysis";

export type AiState={
  status:"idle"|"error"|"success";message:string;result:AiResult|null;
  evidence:AnalysisEvidence[];asOf:string|null;model:string|null;
  remainingDay:number|null;
};
const initialAiState:AiState={
  status:"idle",message:"",result:null,evidence:[],asOf:null,
  model:null,remainingDay:null,
};

const error=(message:string):AiState=>({...initialAiState,status:"error",message});
export async function runAiAnalysis(_previous:AiState,form:FormData):Promise<AiState>{
  // This explicit opt-in is unique to EACH request. No automatic refresh,
  // scheduler, implicit saved consent, prefetch or model calls on page load.
  if(form.get("consent")!=="SEND_SELECTED_JOURNAL_TO_OPENROUTER")
    return error("외부 AI 분석을 위해 이번 요청의 데이터 전송에 동의해야 합니다.");
  const mode=form.get("mode");
  const symbol=form.get("symbol");
  if(mode!=="STOCK_REVIEW" && mode!=="HABITS")
    return error("분석 종류를 선택해 주세요.");
  if(mode==="STOCK_REVIEW" && !safeAnalysisSymbol(symbol))
    return error("분석할 종목을 선택해 주세요.");
  if(!aiConfigured())return error("AI 분석 API가 아직 운영 설정되지 않았습니다.");
  const [workspace,session]=await Promise.all([currentWorkspace(),auth()]);
  const subject=session?.user?.id;
  if(!workspace || !subject || !/^[0-9]{3,255}$/.test(subject))
    return error("로그인과 개인 워크스페이스 확인이 필요합니다.");

  const [notes,plans,trades,personal]=await Promise.allSettled([
    fetchJournal(subject),fetchJournalPlans(subject),fetchManualTrades(subject),
    tigerPersonalRead(),
  ]);
  // Never submit empty or partially retrieved financial context to the model:
  // it could mistake a backend failure for lack of investing discipline.
  if(notes.status!=="fulfilled" || plans.status!=="fulfilled" ||
     trades.status!=="fulfilled")
    return error("투자일지를 온전히 불러오지 못해 분석을 중단했습니다.");
  // Owner Tiger pilot is optional; unavailable observations must not remove
  // the ability to reflect on user-authored notes and manual transactions.
  const orders=personal.status==="fulfilled"&&personal.value
    ? personal.value.accounts.flatMap(a=>a.orders):[];
  const envelope=evidenceForAnalysis(mode as AnalysisMode,
    mode==="STOCK_REVIEW" ? symbol as string : null,
    notes.value,plans.value,trades.value.events,orders);
  if(envelope.evidence.length===0)
    return error("선택한 범위에 분석할 기록이 없습니다. 투자일지를 먼저 작성해 주세요.");

  try{
    const claim=await claimAiAnalysis(subject,mode as AnalysisMode);
    // Source notes and broker snapshots never travel through our quota API.
    // Only bounded user-authored excerpts/coarse events go to the ZDR model.
    const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",cache:"no-store",signal:AbortSignal.timeout(22000),
      headers:{"Authorization":"Bearer "+process.env.OPENROUTER_API_KEY!,
        "Content-Type":"application/json",
        "HTTP-Referer":process.env.AUTH_URL||"https://positionary.vercel.app",
        "X-OpenRouter-Title":"Positionary"},
      body:JSON.stringify(aiRequestBody(process.env.OPENROUTER_MODEL!,envelope)),
    });
    if(!response.ok) return error("OpenRouter 제공자의 비보관(ZDR) 경로를 사용할 수 없거나 AI 요청이 거절됐습니다. 데이터가 다른 제공자에게 우회 전송되지는 않습니다.");
    const raw=await response.text();
    if(raw.length>24000)throw new Error("PROVIDER_RESPONSE_OVERSIZE");
    const output=JSON.parse(raw) as {choices?:Array<{message?:{content?:unknown}}>};
    const content=output?.choices?.[0]?.message?.content;
    if(typeof content!=="string")throw new Error("PROVIDER_CONTENT_INVALID");
    const result=parseAiResult(content,envelope);
    return {status:"success",message:"AI 분석 결과 · 자동 저장하지 않음",
      result,evidence:envelope.evidence,asOf:envelope.asOf,
      model:process.env.OPENROUTER_MODEL!,remainingDay:claim.remainingDay};
  }catch{
    // Never log provider response, private note content or API credentials.
    return error("분석 요청을 완료할 수 없었습니다. 전송 오류나 제공자 응답 형식을 확인해 주세요. 요청 한도는 차감될 수 있습니다.");
  }
}
