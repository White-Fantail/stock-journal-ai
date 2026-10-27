/** Source-neutral hypothetical cash-funded equity purchase. No quote retrieval,
 * FX conversion, orders, recommendations or realized-loss claims.
 * Fixed-point arithmetic avoids rounded cap comparisons and float drift.
 */
const SCALE=BigInt(10)**BigInt(12);
const DEC=/^(?:0|[1-9][0-9]{0,20})(?:\.[0-9]{1,12})?$/;
function decimal(raw:string):bigint|null{
 if(!DEC.test(raw))return null;
 const [w,f=""]=raw.split(".");
 return BigInt(w)*SCALE+BigInt(f.padEnd(12,"0"));
}
function format(v:bigint,places=2):string{
 const factor=BigInt(10)**BigInt(12-places);
 const rounded=(v+factor/BigInt(2))/factor;
 const unit=BigInt(10)**BigInt(places);
 return (rounded/unit).toString()+"."+(rounded%unit).toString().padStart(places,"0");
}
function pct(n:bigint,d:bigint){return format(n*BigInt(100)*SCALE/d);}
export type PurchaseScenarioInput={
 nav:string;cash:string;heldValue:string;heldShares:string;
 price:string;buyShares:string;maxAllocationPct:string|null;
 stop:string|null;
};
export type PurchaseScenario =
 | {state:"INVALID";reason:string}
 | {state:"READY";purchaseAmount:string;beforePercent:string;afterPercent:string;
    cashLeft:string;withinCash:boolean;capExceeded:boolean|null;
    capReference:string|null;maxAdditionalUnderCap:string|null;
    drawdowns:{ten:string;twenty:string;thirty:string};
    stopImpact:string|null;stopWarning:string|null;
    existingPositionValue:string;afterPositionValue:string;};
export function calculatePurchaseScenario(i:PurchaseScenarioInput):PurchaseScenario{
 const nav=decimal(i.nav),cash=decimal(i.cash),heldValue=decimal(i.heldValue),
   heldShares=decimal(i.heldShares),price=decimal(i.price),buyShares=decimal(i.buyShares);
 if(nav===null||nav<=BigInt(0)||cash===null||cash<BigInt(0)||cash>nav||
   heldValue===null||heldValue<BigInt(0)||heldValue>nav||heldShares===null||heldShares<BigInt(0)||
   price===null||price<=BigInt(0)||buyShares===null||buyShares<BigInt(0)||
   (heldShares===BigInt(0))!==(heldValue===BigInt(0))||cash+heldValue>nav+SCALE/BigInt(100))
   return {state:"INVALID",reason:"같은 통화로 된 순자산·가용 현금·기존 보유 평가액·수량을 확인해 주세요."};
 const amount=price*buyShares/SCALE;
 const after=heldValue+amount;
 const cap=i.maxAllocationPct===null?null:decimal(i.maxAllocationPct);
 if(cap!==null&&(cap<=BigInt(0)||cap>BigInt(100)*SCALE))
   return {state:"INVALID",reason:"최대 비중은 0보다 크고 100% 이하여야 합니다."};
 const limit=cap===null?null:nav*cap/(BigInt(100)*SCALE);
 const budget=limit===null?null:limit>heldValue?limit-heldValue:BigInt(0);
 const maxAddition=budget===null?null:
   ((budget* SCALE /price)/SCALE).toString();
 // Ensure rounded display never determines the compliance decision.
 let stopImpact:string|null=null,stopWarning:string|null=null;
 if(i.stop){
   const stop=decimal(i.stop);
   if(stop===null||stop<=BigInt(0))stopWarning="손절 기준가 형식을 확인해 주세요.";
   else if(stop>=price || (heldShares>BigInt(0) && stop*heldShares/SCALE>=heldValue))
     stopWarning="손절 기준가가 매수가 또는 보유분 참고가격 이상이므로 가격 하락 위험을 산출하지 않습니다.";
   else{
     const beforeDrop=heldValue-stop*heldShares/SCALE;
     const newDrop=(price-stop)*buyShares/SCALE;
     stopImpact=format(beforeDrop+newDrop);
   }
 }
 return {state:"READY",purchaseAmount:format(amount),
   beforePercent:pct(heldValue,nav),afterPercent:pct(after,nav),
   cashLeft:format(cash>amount?cash-amount:BigInt(0)),withinCash:amount<=cash,
   capExceeded:limit===null?null:after>limit,
   capReference:cap===null?null:format(cap),
   maxAdditionalUnderCap:maxAddition,
   drawdowns:{
     ten:format(after*BigInt(10)*SCALE/nav),
     twenty:format(after*BigInt(20)*SCALE/nav),thirty:format(after*BigInt(30)*SCALE/nav),
   },
   stopImpact,stopWarning,
   existingPositionValue:format(heldValue),afterPositionValue:format(after)};
}

/** Observed share-price approximation: market value / shares, never a live quote. */
export function referencePrice(marketValue:string,shares:string):string|null{
 const mv=decimal(marketValue),qty=decimal(shares);
 if(mv===null||qty===null||qty<=BigInt(0)||mv<=BigInt(0))return null;
 return format(mv*SCALE/qty,4);
}
export function sumObservedShares(values:readonly string[]):string|null{
 let sum=BigInt(0);
 for(const raw of values){const v=decimal(raw);if(v===null)return null;sum+=v;}
 const w=sum/SCALE,f=sum%SCALE;
 return w.toString()+(f===BigInt(0)?"":"."+f.toString().padStart(12,"0").replace(/0+$/,""));
}
