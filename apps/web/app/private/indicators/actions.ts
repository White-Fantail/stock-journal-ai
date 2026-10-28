"use server";
import {auth} from "../../../auth";
import {currentWorkspace} from "../../../lib/require-workspace";
import {saveIndicatorRule,saveIndicatorRecord} from "../../../lib/saas-trades-api";
import {readIndicatorRule,readIndicatorRecord} from "../../../lib/indicators";
import {redirect} from "next/navigation";
export type IndicatorActionState={error:string|null};
async function subject(){
  const [session,workspace]=await Promise.all([auth(),currentWorkspace()]);
  if(!workspace||!session?.user?.id)redirect("/login");
  return session.user.id;
}
export async function submitRule(_state:IndicatorActionState,form:FormData):Promise<IndicatorActionState>{
  const sub=await subject();
  try{await saveIndicatorRule(sub,readIndicatorRule(form));}
  catch{return {error:"저장하지 못했습니다. 숫자·조건을 확인해 주세요. 다른 창에서 기준을 수정했다면 목록에서 최신 기준을 다시 여세요. 입력 내용은 유지됩니다."};}
  redirect("/private/indicators?saved=rule");
}
export async function submitRecord(_state:IndicatorActionState,form:FormData):Promise<IndicatorActionState>{
  const sub=await subject();
  const record=readIndicatorRecord(form);
  try{await saveIndicatorRecord(sub,record);}
  catch{return {error:"저장하지 못했습니다. 선택한 지표, 매수·매도 구분, 숫자와 시간대를 확인해 주세요. 입력 내용은 유지됩니다."};}
  redirect("/private/indicators?saved=record&ticker="+encodeURIComponent(record.ticker));
}
