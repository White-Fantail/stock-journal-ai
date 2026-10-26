import Link from "next/link";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import {formatDecimal} from "../../../lib/format-decimal";

const when=(raw:string|null)=> {
  if(!raw) return "시각 미확인";
  const t=new Date(Number(raw));
  return Number.isFinite(t.valueOf())
    ?new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"short",timeStyle:"short"}).format(t)
    :"시각 미확인";
};
const viewNumber=(value:string|null)=>formatDecimal(value);

/** Owner-only Tiger observation, never inferred FIFO or account-wide performance. */
export function PersonalPortfolioBlock({data}:{data:TigerPersonalRead}){
  return <div className="account-portfolio-list">
    {data.accounts.map(account=><section className="user-panel" key={account.alias}>
      <div className="user-panel-head">
        <div><h2>{account.alias}</h2>
          <small className="user-muted">최종 관측 {account.asOf?
            new Intl.DateTimeFormat("ko-KR",{timeZone:"Pacific/Auckland",dateStyle:"medium",timeStyle:"short"}).format(new Date(account.asOf)):"시각 미확인"} (NZ)</small>
        </div>
        <Link href="/private/trades">거래 기록 →</Link>
      </div>
      <div className="account-summary-values portfolio-account-values">
        <div><small>순자산</small><strong>{viewNumber(account.assets?.netLiquidation??null)} <span className="account-currency">{account.assets?.currency??"통화 미확인"}</span></strong></div>
        <div><small>현금</small><strong>{viewNumber(account.assets?.cashBalance??null)} <span className="account-currency">{account.assets?.currency??"통화 미확인"}</span></strong></div>
        <div><small>보유 종목</small><strong>{account.positions.length}</strong></div>
      </div>
      <div className="user-panel-head portfolio-holdings-head">
        <h3>보유 종목</h3><span className="user-muted">{account.positions.length}개 · Tiger 관측</span>
      </div>
      {account.positions.length===0?<p className="user-empty">현재 수집된 보유 종목이 없습니다. 전체 거래 이력의 부재를 의미하지 않습니다.</p>:
      <div className="portfolio-verified-scroll">
        <table className="portfolio-verified-table">
          <thead><tr><th>종목</th><th>수량</th><th>평균 단가</th><th>시장 가치</th><th>미실현손익</th></tr></thead>
          <tbody>{account.positions.map(p=><tr key={p.symbol+":"+p.currency}>
            <th scope="row"><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link><small className="user-muted portfolio-symbol-currency">{p.currency}</small></th>
            <td>{viewNumber(p.quantity)}</td>
            <td>{viewNumber(p.averageCost)} {p.currency}</td>
            <td>{viewNumber(p.marketValue)} {p.currency}</td>
            <td className={p.unrealizedPnl?.startsWith("-")?"value-negative":"value-standard"}>{viewNumber(p.unrealizedPnl)} {p.currency}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <p className="user-footnote">평가액·미실현손익은 Tiger 조회 시점의 원본값입니다. 서로 다른 통화를 임의로 합산하지 않습니다.</p>
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
    {rows.some(o=>o.filled===null) && <p role="status">이전 수집 자료에는 Tiger의 소수점 수량 정보가 빠져 있어. 잘못된 수량을 표시하지 않고 재수집 후에 보여줄게.</p>}
    {rows.length===0 ? <p>아직 조회된 Tiger 주문 이력이 없어. 보유 종목 스냅샷은 별도로 표시돼.</p> :
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th>시간 (NZ)</th><th>종목</th><th>방향</th><th>상태</th><th>체결 수량</th><th>평균 체결가</th><th>주문 수수료</th></tr></thead>
          <tbody>{rows.slice(0,compact?12:120).map((o,i)=><tr key={o.sourceRef+":"+i}>
            <td>{when(o.at)}</td>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(o.symbol)}>{o.symbol}</Link></td>
            <td>{o.side==="BUY"?"매수":"매도"}</td><td>{o.status}</td>
            <td>{o.filled===null?"수량 재수집 필요":viewNumber(o.filled)}</td>
            <td>{viewNumber(o.price)} {o.currency}</td>
            <td>{viewNumber(o.fee)} {o.feeCurrency??"통화 미확인"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {compact && rows.length>12 && <Link href="/private/trades">전체 관측 주문 보기 →</Link>}
    {!compact && <div className="journal-trades" style={{marginTop:26}}>
      <h3>개별 체결 API 확인 · 검증 전</h3>
      <p>Tiger의 Prime 계좌용 get_transactions 읽기 전용 조회 결과야. 각 체결의 수량·가격은 관측값이며, 전체 계좌 이력이나 확정 손익으로 사용하지 않아.
      원본 체결 시각의 시간대가 확인되지 않으면 뉴질랜드 시간으로 임의 변환하지 않아. 수수료는 주문 단위 관측값이고 개별 체결에 배분하지 않아.</p>
      <p>조회한 주문 {data.accounts.reduce((n,a)=>n+a.fillProbeCount,0)}건 ·
        세부 체결 관측 {data.accounts.reduce((n,a)=>n+a.fillObservations.length,0)}건 ·
        조회 불가 {data.accounts.reduce((n,a)=>n+a.fillProbeUnavailable,0)}건 ·
        수량 불일치 {data.accounts.reduce((n,a)=>n+a.fillProbeDifference,0)}건 ·
        일부만 확인 {data.accounts.reduce((n,a)=>n+a.fillProbePartial,0)}건</p>
      <p>주문별 수수료 세부 조회: 금액·통화 일치 {data.accounts.reduce((n,a)=>n+a.feeProbeMatched,0)}건 ·
        금액은 일치하나 수수료 통화 미확인 {data.accounts.reduce((n,a)=>n+a.feeProbeCurrencyUnknown,0)}건 ·
        금액 또는 증거 불일치 {data.accounts.reduce((n,a)=>n+a.feeProbeDifference,0)}건 ·
        조회 불가 {data.accounts.reduce((n,a)=>n+a.feeProbeUnavailable,0)}건</p>
      <p className="user-footnote">Tiger 원본 get_order(show_charges=true)의 주문별 항목 합계를 비교했어. 개별 체결마다 얼마의 수수료가 배분됐는지는 여전히 미확인이야. 수수료 금액·통화 모두 확인된 경우만 별도로 구분해.</p>
      {data.accounts.some(a=>a.feeObservations.length>0) && <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th>주문 종목</th><th>수수료 합계</th><th>검증 수준</th><th>수수료 구성</th></tr></thead>
          <tbody>{data.accounts.flatMap(a=>a.feeObservations).map(f=><tr key={f.sourceRef}>
            <td>{f.symbol}</td>
            <td>{viewNumber(f.total)} {f.currency??"통화 미확인"}</td>
            <td>{f.status==="MATCHED"?"주문 수수료 합계·통화 확인":"주문 수수료 합계 확인 · 통화 미확인"}</td>
            <td>{f.details.map(d=>d.type+" ("+d.category+"): "+viewNumber(d.amount)).join(" · ")}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data.accounts.some(a=>a.fillProbeTruncated) && <p role="status">진단 결과는 화면 표시 한도가 적용됐어. 이를 전체 체결 이력으로 판단하지 마.</p>}
      {data.accounts.every(a=>a.fillProbeCount===0) ? <p className="user-empty">개별 체결 조회 결과가 아직 없어. 별도 수집기의 다음 실행에서 지원 여부를 확인해야 해.</p> :
        <div style={{overflowX:"auto"}}><table style={{width:"100%"}}>
          <thead><tr><th>원본 체결 시각 (시간대 미검증)</th><th>종목</th><th>방향</th><th>체결 수량</th><th>체결 가격</th><th>수수료</th></tr></thead>
          <tbody>{data.accounts.flatMap(a=>a.fillObservations).slice(0,100).map(f=><tr key={f.sourceRef}>
            <td>{f.timeRaw??"미확인"}</td>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(f.symbol)}>{f.symbol}</Link></td>
            <td>{f.side==="BUY"?"매수":"매도"}</td><td>{viewNumber(f.quantity)}</td>
            <td>{viewNumber(f.price)} {f.currency}</td><td>개별 배분 미확인</td>
          </tr>)}</tbody>
        </table></div>}
    </div>}
    {!compact && <div style={{display:"flex",gap:18,marginTop:14}}>
      {page>0 && <Link href={"/private/trades?page="+(page-1)}>← 이전 페이지</Link>}
      {data.accounts.some(a=>a.hasMore) && page<20 && <Link href={"/private/trades?page="+(page+1)}>다음 주문 기록 →</Link>}
    </div>}
  </section>;
}
