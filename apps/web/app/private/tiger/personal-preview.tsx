import Link from "next/link";
import type {TigerPersonalRead} from "../../../lib/tiger-api";

const when=(raw:string|null)=> {
  if(!raw) return "시각 미확인";
  const t=new Date(Number(raw));
  return Number.isFinite(t.valueOf())
    ?new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"short",timeStyle:"short"}).format(t)
    :"시각 미확인";
};
const viewNumber=(value:string|null)=>value??"미제공";

/** Observed broker balances: never passed through the verified FIFO projector. */
export function PersonalPortfolioBlock({data}:{data:TigerPersonalRead}) {
  return <div>
    <section className="state-panel">
      <span className="pill">개인 Tiger 계좌 연결됨 · 조회 전용</span>
      <h2>실제 Tiger 계좌 스냅샷</h2>
      <p>본인 계정에서만 조회하는 Tiger API 원본 관측값이야. 조회 당시 가격·자산이며, 전 거래내역을 검증한 FIFO 취득원가/수익률이 아니야.</p>
      <p>주문·체결 요청, 이체 또는 주문 변경 기능은 제공하지 않아.</p>
    </section>
    {data.accounts.length===0 && <section className="state-panel"><h2>아직 수집된 계좌가 없어</h2></section>}
    {data.accounts.map(account=><section className="state-panel" key={account.alias}>
      <h2>{account.alias}</h2>
      <p>최근 관측: {account.asOf ? new Date(account.asOf).toLocaleString("ko-KR",{timeZone:"Pacific/Auckland"}):"미확인"}</p>
      <p>순자산: {viewNumber(account.assets?.netLiquidation??null)} · 현금: {viewNumber(account.assets?.cashBalance??null)}
      <small> (계좌 기준 통화 확인 필요)</small></p>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th>종목</th><th>보유 수량</th><th>평균 단가</th><th>시장 가치</th><th>미실현손익</th></tr></thead>
          <tbody>{account.positions.map(p=><tr key={p.symbol+":"+p.currency}>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link></td>
            <td>{p.quantity}</td><td>{viewNumber(p.averageCost)} {p.currency}</td>
            <td>{viewNumber(p.marketValue)} {p.currency}</td>
            <td>{viewNumber(p.unrealizedPnl)} {p.currency}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p>{account.positions.length}개 보유 종목 · 통화별 계좌 표시 원본값이며, 독립 검증된 실현손익이 아니야.</p>
      <Link href="/private/trades">Tiger 주문·거래 이력 보기 →</Link>
    </section>)}
  </div>;
}

export function PersonalOrderHistory({data,compact=false,page=0}:{data:TigerPersonalRead,compact?:boolean,page?:number}){
  const rows=data.accounts.flatMap(account=>account.orders.map(o=>({alias:account.alias,...o})))
      .sort((a,b)=>Number(b.at??0)-Number(a.at??0));
  return <section className="state-panel">
    <h2>Tiger 주문 및 부분체결 관측 이력</h2>
    <p>증권사 API에서 수집한 실제 <strong>주문 단위</strong> 자료야. 주문 한 건은 여러 번 나누어 체결될 수 있으며, 수수료·시간·현금 거래의 완전성은 검증 전이야.
    거래 원장으로 확정하거나 자동 손익 계산에 사용하지 않아.</p>
    {data.accounts.some(a=>a.partial || a.truncated) && <p role="status">조회 누락 가능성이 있는 구간이 존재해. 표시된 자료를 전체 거래 이력으로 사용하지 마.</p>}
    <p>수집 구간: {data.accounts.reduce((n,a)=>n+a.windowCount,0)}개 · 전체 관측 주문 {data.accounts.reduce((n,a)=>n+a.totalOrders,0)}건 · 현재 페이지 {page+1} · 표시: {rows.length}개
    {data.accounts.some(a=>a.truncated)?" · 표시 한도 적용":""}</p>
    {rows.length===0 ? <p>아직 조회된 Tiger 주문 이력이 없어. 보유 종목 스냅샷은 별도로 표시돼.</p> :
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th>시간 (NZ)</th><th>종목</th><th>방향</th><th>상태</th><th>체결 수량</th><th>평균 체결가</th><th>주문 수수료</th></tr></thead>
          <tbody>{rows.slice(0,compact?12:120).map((o,i)=><tr key={o.sourceRef+":"+i}>
            <td>{when(o.at)}</td>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(o.symbol)}>{o.symbol}</Link></td>
            <td>{o.side==="BUY"?"매수":"매도"}</td><td>{o.status}</td>
            <td>{o.filled}</td>
            <td>{viewNumber(o.price)} {o.currency}</td>
            <td>{viewNumber(o.fee)} {o.currency}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {compact && rows.length>12 && <Link href="/private/trades">전체 관측 주문 보기 →</Link>}
    {!compact && <div style={{display:"flex",gap:18,marginTop:14}}>
      {page>0 && <Link href={"/private/trades?page="+(page-1)}>← 이전 페이지</Link>}
      {data.accounts.some(a=>a.hasMore) && page<20 && <Link href={"/private/trades?page="+(page+1)}>다음 주문 기록 →</Link>}
    </div>}
  </section>;
}
