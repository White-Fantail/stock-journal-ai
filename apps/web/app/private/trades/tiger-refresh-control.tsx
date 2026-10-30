"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {TigerPersonalRefreshState} from "../../../../lib/tiger-api";

const when=(stamp?:string|null)=>stamp
  ?new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",
     dateStyle:"short",timeStyle:"short"}).format(new Date(stamp)):"미확인";

export function TigerRefreshControl(){
  const router=useRouter();
  const [status,setStatus]=useState<TigerPersonalRefreshState>({state:"IDLE"});
  const [loading,setLoading]=useState(false);
  const previous=useRef<string|null>(null);
  const poll=useCallback(async()=>{
    try {
      const reply=await fetch("/api/private/tiger/refresh",{cache:"no-store"});
      const value=await reply.json() as TigerPersonalRefreshState;
      setStatus(reply.ok?value:{state:"UNAVAILABLE"});
      if(reply.ok && previous.current==="RUNNING" && value.state==="COMPLETED")
        router.refresh();
      previous.current=value.state;
    } catch {
      setStatus({state:"UNAVAILABLE"});
    }
  },[router]);
  useEffect(()=>{
    void poll();
    const interval=setInterval(()=>{void poll();},5000);
    return ()=>clearInterval(interval);
  },[poll]);
  const refresh=async()=>{
    setLoading(true);
    try {
      const response=await fetch("/api/private/tiger/refresh",{
        method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"}});
      const result=await response.json() as TigerPersonalRefreshState;
      setStatus(response.ok?result:{state:"UNAVAILABLE"});
      previous.current=result.state;
    } catch {
      setStatus({state:"UNAVAILABLE"});
    } finally {
      setLoading(false);
    }
  };
  const busy=loading||status.state==="RUNNING";
  const cooling=status.state==="COOLDOWN" &&
    !!status.nextAllowedAt && Date.parse(status.nextAllowedAt)>Date.now();
  return <section className="state-panel" aria-label="Tiger 주문 기록 동기화">
    <div className="dashboard-heading">
      <h2>주문 기록 동기화</h2>
      <button type="button" className="btn btn-primary" onClick={()=>void refresh()}
        disabled={busy||cooling}>{busy?"동기화 중…":"지금 동기화"}</button>
    </div>
    <p role="status">{
      status.state==="RUNNING"?"Tiger 주문·부분체결의 최근 기록을 가져오고 있습니다. 이 페이지를 벗어나도 작업은 계속됩니다.":
      status.state==="FAILED"?"최근 동기화에 실패했습니다. 저장된 이전 거래 기록은 유지됩니다.":
      status.state==="COOLDOWN"?"중복 요청을 막기 위해 잠시 뒤 다시 요청할 수 있습니다.":
      status.state==="UNAVAILABLE"?"동기화 서버에 접근할 수 없습니다. 기존 거래 기록은 그대로 표시됩니다.":
      status.state==="COMPLETED"?"최근 동기화 작업이 완료되었습니다. 자료의 완전성 검증과는 별개입니다.":
      "필요할 때 최근 거래 기록을 직접 갱신할 수 있습니다."
    }</p>
    <p className="user-muted">
      최근 성공: {when(status.lastSuccessfulAt)}
      {status.state==="RUNNING"&&status.startedAt?" · 시작: "+when(status.startedAt):""}
      {cooling&&status.nextAllowedAt?" · 재요청 가능: "+when(status.nextAllowedAt):""}
    </p>
    <p className="user-footnote">미국 정규장 중 약 1시간마다 최근 주문을 확인하고 하루 한 번 이력을 점검합니다.
      동기화된 주문과 부분체결은 관측 정보이며 확정 손익 원장이 아닙니다.</p>
  </section>;
}
