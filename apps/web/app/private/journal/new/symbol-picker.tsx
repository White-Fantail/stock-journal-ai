"use client";

import {useState} from "react";
import {formatQuantity} from "../../../../lib/format-decimal";

type TradeOption={
  id:string;
  ticker:string;
  side:"BUY"|"SELL"|null;
  quantity:string|null;
  executedAt:string;
};
const OTHER="__other__";

export function JournalSymbolPicker({
  symbols,initialTicker,trades=[],
}:{
  symbols:readonly string[];
  initialTicker:string;
  trades?:readonly TradeOption[];
}){
  const initial=initialTicker&&symbols.includes(initialTicker)
    ? initialTicker : symbols[0]??OTHER;
  const [choice,setChoice]=useState(initial);
  const [custom,setCustom]=useState("");
  const ticker=choice===OTHER?custom.trim().toUpperCase():choice;
  const matching=trades.filter(t=>t.ticker===ticker);
  return <>
    <label>종목 심볼
      <select value={choice} onChange={e=>setChoice(e.target.value)} required>
        {symbols.map(s=><option key={s} value={s}>{s}</option>)}
        <option value={OTHER}>+ 목록에 없는 종목 입력</option>
      </select>
    </label>
    {choice===OTHER&&<label>새 종목 심볼
      <input value={custom} onChange={e=>setCustom(e.target.value.toUpperCase())}
        placeholder="예: AAPL" maxLength={32} required pattern="[A-Z0-9.:-]{1,32}"/>
    </label>}
    <input type="hidden" name="ticker" value={ticker}/>
    {matching.length>0&&<label>관련 직접 입력 체결 (체결 메모 작성 시 선택)
      <select name="tradeEventId" key={ticker} defaultValue="">
        <option value="">연결하지 않음</option>
        {matching.map(t=><option key={t.id} value={t.id}>
          {t.side==="BUY"?"매수":"매도"} {formatQuantity(t.quantity,"?")}주 · {t.executedAt}
        </option>)}
      </select>
    </label>}
  </>;
}
