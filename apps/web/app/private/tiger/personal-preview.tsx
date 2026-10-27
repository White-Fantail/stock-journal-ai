import Link from "next/link";
import type {TigerPersonalRead} from "../../../lib/tiger-api";
import {formatDecimal} from "../../../lib/format-decimal";
import {parseStatementFeeEvidence,resolvedFeeCurrency,statementMatchesOrder} from "../../../lib/tiger-fee-statement";

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
    {!!data.readWarnings?.length && <p role="status">Tiger 저장 데이터의 일부 세부 항목을 검증할 수 없어 제외했습니다. 표시된 정보는 부분 조회 결과이며 저장 기록은 삭제되지 않았습니다.</p>}
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
      <><div className="mobile-data-cards" aria-label="보유 종목 모바일 목록">
        {account.positions.map(p=>{
          const q=account.marketObservations.find(x=>x.symbol===p.symbol && x.currency===p.currency);
          return <article className="mobile-data-card" key={p.symbol+":"+p.currency}>
            <div className="mobile-data-card-head">
              <div><strong><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link></strong>
                <small>{p.currency} · Tiger 보유 관측</small></div>
              <strong>{viewNumber(p.quantity)}주</strong>
            </div>
            <dl className="mobile-data-card-fields">
              <div><dt>평균 매입단가</dt><dd>{viewNumber(p.averageCost)} {p.currency}</dd></div>
              <div><dt>최근 관측 시세</dt><dd>{q?viewNumber(q.price)+" USD":"미확인"}</dd></div>
              <div><dt>추정 평가액</dt><dd>{q?.estimatedValue?viewNumber(q.estimatedValue)+" USD":"계산 보류"}</dd></div>
              <div><dt>추정 미실현 손익</dt><dd>{q?.estimatedUnrealized?viewNumber(q.estimatedUnrealized)+" USD":"계산 보류"}</dd></div>
            </dl>
            <details className="data-disclosure"><summary>수익률 및 Tiger 원본 평가 보기</summary>
              <p>추정 수익률: {q?.estimatedReturnPct?viewNumber(q.estimatedReturnPct)+"%":"계산 보류"}</p>
              <p>Tiger 원본 평가액: {viewNumber(p.marketValue)} {p.currency} · 원본 미실현손익: {viewNumber(p.unrealizedPnl)} {p.currency}</p>
              <p>시세 출처: {q?(q.mode==="REALTIME_PERMISSIONED"?"실시간 권한":"15분 지연"):"미확인"} · {q?when(q.quoteAt):"관측 없음"} (NZ)</p>
            </details>
          </article>;
        })}
      </div>
      <div className="portfolio-verified-scroll desktop-data-table">
        <table className="portfolio-verified-table">
          <thead><tr><th>종목</th><th>수량</th><th>Tiger 평균단가</th><th>최근 미국주식 시세</th><th>시세 기준 평가액 (참고)</th><th>추정 미실현손익 (참고)</th><th>추정 수익률 (참고)</th><th>Tiger 보유 스냅샷 평가액</th></tr></thead>
          <tbody>{account.positions.map(p=>{
            const q=account.marketObservations.find(x=>x.symbol===p.symbol && x.currency===p.currency);
            return <tr key={p.symbol+":"+p.currency}>
              <th scope="row"><Link href={"/private/journal?ticker="+encodeURIComponent(p.symbol)}>{p.symbol}</Link><small className="user-muted portfolio-symbol-currency">{p.currency}</small></th>
              <td>{viewNumber(p.quantity)}</td>
              <td>{viewNumber(p.averageCost)} {p.currency}</td>
              <td>{q ? <><strong>{viewNumber(q.price)} USD</strong>
                <small className="user-muted">{q.mode==="REALTIME_PERMISSIONED"?"실시간 권한 시세":"미국주식 15분 지연 시세"}
                {q.stale?" · 과거 마지막 체결가":""} · {when(q.quoteAt)} (NZ)</small></> : "시세 미확인"}</td>
              <td>{q?.estimatedValue===null || !q?"계산 보류":viewNumber(q.estimatedValue)+" USD"}</td>
              <td className={q?.estimatedUnrealized?.startsWith("-")?"value-negative":"value-standard"}>
                {q?.estimatedUnrealized===null || !q?"계산 보류":viewNumber(q.estimatedUnrealized)+" USD"}</td>
              <td>{q?.estimatedReturnPct===null || !q?"계산 보류":viewNumber(q.estimatedReturnPct)+"%"}</td>
              <td>{viewNumber(p.marketValue)} {p.currency}
                <small className="user-muted">원본 미실현손익 {viewNumber(p.unrealizedPnl)} {p.currency}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div></>}
      <p className="user-footnote">시세 기준 계산은 최근 Tiger 보유수량 × 시세와 Tiger 관측 평균단가를 사용한 <strong>참고 추정</strong>입니다.
        수수료·환율·배당·과거 매매원장의 정확성이 검증되지 않았으므로 확정 손익이나 전체 투자수익률이 아닙니다.
        시세가 없거나 보유 스냅샷이 오래되면 계산을 보류합니다. 서로 다른 통화는 합산하지 않습니다.
        Tiger 보유 스냅샷 평가액과 추정 시세 평가액은 조회 시각이 다를 수 있습니다.</p>
      {account.marketObservations.length===0 && <p className="user-footnote">아직 연결된 시장 시세가 없습니다. 다음 Railway 수집 후 미국주식 시세 권한·지연 시세 지원 여부를 확인합니다.</p>}
    </section>)}
  </div>;
}

export function PersonalOrderHistory({data,compact=false,page=0}:{data:TigerPersonalRead,compact?:boolean,page?:number}){
  // Private owner-supplied statement facts live in server-only configuration,
  // never hardcoded in Git or copied into client-side caches. No other Tiger
  // account, date, amount or symbol can inherit statement-validated USD.
  const proof=data.accounts.length===1
    ?parseStatementFeeEvidence(process.env.POSITIONARY_PERSONAL_FEE_STATEMENT_EVIDENCE)
    :null;
  const rows=data.accounts.flatMap(account=>account.orders.map(o=>({
       alias:account.alias,...o,
       feeView:resolvedFeeCurrency(o,account.alias,account.assets?.currency??null,proof),
     }))).sort((a,b)=>Number(b.at??0)-Number(a.at??0));
  const feeRows=data.accounts.flatMap(account=>account.feeObservations.map(f=>{
    const order=account.orders.find(o=>o.sourceRef===f.sourceRef &&
      o.symbol===f.symbol && o.fee!==null && f.total===o.fee);
    const match=order&&statementMatchesOrder(order,account.alias,
      account.assets?.currency??null,proof);
    const currency=(f.status==="MATCHED"&&f.currency)?f.currency:
      f.status==="CURRENCY_UNKNOWN"&&match?"USD":null;
    return {...f,currencyForDisplay:currency,
      statementVerified:f.status==="CURRENCY_UNKNOWN"&&currency==="USD"};
  }));
  const statementVerifiedCount=rows.filter(o=>o.feeView.basis==="STATEMENT_MATCH").length;
  const feeLabel=(currency:string|null,statement:boolean)=>currency
    ?currency+(statement?" (명세서 대조)":""):"통화 미확인";
  return <section className="state-panel">
    <h2>Tiger 주문 및 부분체결 관측 이력</h2>
    {!!data.readWarnings?.length && <p role="status">Tiger 원본 응답의 일부 항목 형식이 맞지 않아 해당 항목만 제외했습니다. 표시된 자료는 부분 조회 결과이며 전체 주문 이력으로 사용하지 마세요.</p>}
    {statementVerifiedCount>0&&<p className="user-footnote" role="status">
      Tiger 원본 API의 수수료 통화 누락분 중 {statementVerifiedCount}건을
      별도로 제공된 Tiger 명세서의 종목·방향·수량·가격·수수료·미국 동부 체결시각과
      정확히 대조해 USD로 표시합니다. 그 외 주문의 수수료 통화는 추정하지 않습니다.
      명세서 대조는 전체 주문 원장·손익 검증이나 개별 체결 수수료 배분을 의미하지 않습니다.
    </p>}
    <details className="data-disclosure"><summary>주문 자료 범위 및 검증 안내</summary>
      <p>증권사 API에서 수집한 주문 단위 관측값입니다. 한 주문이 여러 차례 체결될 수 있으며 수수료·시간·현금 거래의 완전성은 검증 전입니다. 확정 거래 원장이나 손익 계산에 사용하지 않습니다.</p>
    </details>
    {data.accounts.some(a=>a.partial || a.truncated) && <p role="status">조회 누락 가능성이 있는 구간이 존재해. 표시된 자료를 전체 거래 이력으로 사용하지 마.</p>}
    <p>수집 구간: {data.accounts.reduce((n,a)=>n+a.windowCount,0)}개 · 전체 관측 주문 {data.accounts.reduce((n,a)=>n+a.totalOrders,0)}건 · 현재 페이지 {page+1} · 표시: {rows.length}개
    {data.accounts.some(a=>a.truncated)?" · 표시 한도 적용":""}</p>
    {rows.some(o=>o.filled===null) && <p role="status">일부 과거 주문의 소수점 수량이 미확인이라 임의로 표시하지 않습니다.</p>}
    {!compact && <nav className="record-pagination record-pagination-top" aria-label="목록 위 주문 페이지 이동">
      {page>0 && <Link href={"/private/trades?page="+(page-1)}>← 이전 페이지</Link>}
      {data.accounts.some(a=>a.hasMore) && page<20 && <Link href={"/private/trades?page="+(page+1)}>다음 페이지 →</Link>}
    </nav>}
    {rows.length===0 ? <p>아직 조회된 Tiger 주문 이력이 없어. 보유 종목 스냅샷은 별도로 표시돼.</p> :
      <><div className="mobile-data-cards" aria-label="Tiger 주문 모바일 목록">
        {rows.slice(0,compact?12:120).map((o,i)=>
          <article className="mobile-data-card" key={o.sourceRef+":"+i}>
            <div className="mobile-data-card-head">
              <div><strong><Link href={"/private/journal?ticker="+encodeURIComponent(o.symbol)}>{o.symbol}</Link></strong>
                <div className="mobile-data-card-meta">{o.side==="BUY"?"매수":"매도"} · {o.status}</div></div>
              <small>{when(o.at)}</small>
            </div>
            <dl className="mobile-data-card-fields">
              <div><dt>평균 체결가</dt><dd>{viewNumber(o.price)} {o.currency}</dd></div>
              <div><dt>체결 수량</dt><dd>{o.filled===null?"재수집 필요":viewNumber(o.filled)+"주"}</dd></div>
              <div><dt>주문 수수료</dt><dd>{viewNumber(o.fee)} {feeLabel(o.feeView.currency,o.feeView.basis==="STATEMENT_MATCH")}</dd></div>
              <div><dt>계좌</dt><dd>{o.alias}</dd></div>
            </dl>
            <div className="mobile-data-card-action"><Link href={"/private/journal/new?mode=observed&sourceKind=ORDER&sourceRef="+o.sourceRef+
              "&page="+page+"&ticker="+encodeURIComponent(o.symbol)}>매매 이유 기록 →</Link></div>
          </article>)}
      </div>
      <div className="responsive-table desktop-data-table">
        <table>
          <thead><tr><th>시간 (NZ)</th><th>종목</th><th>방향</th><th>상태</th><th>체결 수량</th><th>평균 체결가</th><th>주문 수수료</th><th>투자 기록</th></tr></thead>
          <tbody>{rows.slice(0,compact?12:120).map((o,i)=><tr key={o.sourceRef+":"+i}>
            <td>{when(o.at)}</td>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(o.symbol)}>{o.symbol}</Link></td>
            <td>{o.side==="BUY"?"매수":"매도"}</td><td>{o.status}</td>
            <td>{o.filled===null?"수량 재수집 필요":viewNumber(o.filled)}</td>
            <td>{viewNumber(o.price)} {o.currency}</td>
            <td>{viewNumber(o.fee)} {feeLabel(o.feeView.currency,o.feeView.basis==="STATEMENT_MATCH")}</td>
            <td><Link href={"/private/journal/new?mode=observed&sourceKind=ORDER&sourceRef="+o.sourceRef+
              "&page="+page+"&ticker="+encodeURIComponent(o.symbol)}>매매 이유 기록 →</Link></td>
          </tr>)}</tbody>
        </table>
      </div></>}
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
        금액 일치·Tiger API 통화 누락 {data.accounts.reduce((n,a)=>n+a.feeProbeCurrencyUnknown,0)}건 (명세서 대조 별도) ·
        금액 또는 증거 불일치 {data.accounts.reduce((n,a)=>n+a.feeProbeDifference,0)}건 ·
        조회 불가 {data.accounts.reduce((n,a)=>n+a.feeProbeUnavailable,0)}건</p>
      <p className="user-footnote">Tiger 원본 get_order(show_charges=true)의 주문별 항목 합계를 비교했어. 개별 체결마다 얼마의 수수료가 배분됐는지는 여전히 미확인이야. API 수수료 통화가 빠진 경우에도 별도 명세서와 정확하게 대조한 주문은 USD로 표시하고 있어. 조회 통계는 API 원본 상태를 유지해.</p>
      {data.accounts.some(a=>a.feeObservations.length>0) && <>
        <div className="mobile-data-cards" aria-label="주문 수수료 검증 목록">
          {feeRows.map(f=><article className="mobile-data-card" key={f.sourceRef}>
            <div className="mobile-data-card-head"><strong>{f.symbol}</strong>
              <small>{f.status==="MATCHED"?"API 금액·통화 확인":f.statementVerified?"명세서 대조 USD":"API 통화 미확인"}</small></div>
            <dl className="mobile-data-card-fields">
              <div><dt>주문 수수료 합계</dt><dd>{viewNumber(f.total)} {feeLabel(f.currencyForDisplay,f.statementVerified)}</dd></div>
            </dl>
            <details className="data-disclosure"><summary>수수료 구성 보기</summary>
              <p>{f.details.map(d=>d.type+" ("+d.category+"): "+viewNumber(d.amount)).join(" · ")}</p>
            </details>
          </article>)}
        </div>
        <div className="responsive-table desktop-data-table">
        <table style={{width:"100%"}}>
          <thead><tr><th>주문 종목</th><th>수수료 합계</th><th>검증 수준</th><th>수수료 구성</th></tr></thead>
          <tbody>{feeRows.map(f=><tr key={f.sourceRef}>
            <td>{f.symbol}</td>
            <td>{viewNumber(f.total)} {feeLabel(f.currencyForDisplay,f.statementVerified)}</td>
            <td>{f.status==="MATCHED"?"API 주문 수수료 합계·통화 확인":f.statementVerified?"주문 합계 일치 · USD 명세서 대조":"주문 합계 일치 · API 통화 미확인"}</td>
            <td>{f.details.map(d=>d.type+" ("+d.category+"): "+viewNumber(d.amount)).join(" · ")}</td>
          </tr>)}</tbody>
        </table>
      </div></>}
      {data.accounts.some(a=>a.fillProbeTruncated) && <p role="status">진단 결과는 화면 표시 한도가 적용됐어. 이를 전체 체결 이력으로 판단하지 마.</p>}
      {data.accounts.every(a=>a.fillProbeCount===0) ? <p className="user-empty">개별 체결 조회 결과가 아직 없어. 별도 수집기의 다음 실행에서 지원 여부를 확인해야 해.</p> :
        <><div className="mobile-data-cards" aria-label="개별 체결 관측 모바일 목록">
          {data.accounts.flatMap(a=>a.fillObservations).slice(0,100).map(f=><article className="mobile-data-card" key={f.sourceRef}>
            <div className="mobile-data-card-head"><strong><Link href={"/private/journal?ticker="+encodeURIComponent(f.symbol)}>{f.symbol}</Link></strong>
              <small>{f.side==="BUY"?"매수":"매도"}</small></div>
            <div className="mobile-data-card-meta">원본 체결 시각 {f.timeRaw??"미확인"} · 시간대 미검증</div>
            <dl className="mobile-data-card-fields">
              <div><dt>체결 수량</dt><dd>{viewNumber(f.quantity)}주</dd></div>
              <div><dt>체결 가격</dt><dd>{viewNumber(f.price)} {f.currency}</dd></div>
            </dl>
            <div className="mobile-data-card-action"><Link href={"/private/journal/new?mode=observed&sourceKind=FILL&sourceRef="+f.sourceRef+
              "&page=0&ticker="+encodeURIComponent(f.symbol)}>체결 복기 작성 →</Link></div>
          </article>)}
        </div>
        <div className="responsive-table desktop-data-table"><table>
          <thead><tr><th>원본 체결 시각 (시간대 미검증)</th><th>종목</th><th>방향</th><th>체결 수량</th><th>체결 가격</th><th>수수료</th><th>투자 기록</th></tr></thead>
          <tbody>{data.accounts.flatMap(a=>a.fillObservations).slice(0,100).map(f=><tr key={f.sourceRef}>
            <td>{f.timeRaw??"미확인"}</td>
            <td><Link href={"/private/journal?ticker="+encodeURIComponent(f.symbol)}>{f.symbol}</Link></td>
            <td>{f.side==="BUY"?"매수":"매도"}</td><td>{viewNumber(f.quantity)}</td>
            <td>{viewNumber(f.price)} {f.currency}</td><td>개별 배분 미확인</td>
            <td><Link href={"/private/journal/new?mode=observed&sourceKind=FILL&sourceRef="+f.sourceRef+
              "&page=0&ticker="+encodeURIComponent(f.symbol)}>체결 복기 작성 →</Link></td>
          </tr>)}</tbody>
        </table></div></>}
    </div>}
    {!compact && <nav className="record-pagination" aria-label="주문 페이지 이동">
      {page>0 && <Link href={"/private/trades?page="+(page-1)}>← 이전 페이지</Link>}
      {data.accounts.some(a=>a.hasMore) && page<20 && <Link href={"/private/trades?page="+(page+1)}>다음 주문 기록 →</Link>}
    </nav>}
  </section>;
}
