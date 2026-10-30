/** Conservative presentation of Tiger order observations (not executed trades). */
import type {TigerPersonalOrder} from "./tiger-api";
type Order=Pick<TigerPersonalOrder,
  "status"|"filled"|"price"|"fee"|"currency"|"orderType"|"orderQuantity"|
  "auxPrice"|"limitPrice"|"timeInForce"|"outsideRth">;
const positive=(value:string|null)=>value!==null && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
  /[1-9]/.test(value);
export const hasExecution=(order:Order)=>positive(order.filled);
export function orderTypeLabel(kind:Order["orderType"]):string{
  switch(kind){
    case "MKT":return "시장가";
    case "LMT":return "지정가";
    case "STP":return "스탑";
    case "STP_LMT":return "스탑 지정가";
    case "TRAIL":return "트레일링 스탑";
    case "AL":return "장개시 지정가";
    case "AM":return "장개시 시장가";
    default:return "유형 미확인";
  }
}
export function orderStatusLabel(status:string):string {
  const labels:Record<string,string>={
    SUBMITTED:"접수 · 체결 대기",NEW:"신규 접수",PENDING:"접수 대기",
    HELD:"보류",PARTIALLY_FILLED:"부분 체결",FILLED:"체결 완료",
    CANCELLED:"취소",EXPIRED:"만료",REJECTED:"거절",INACTIVE:"비활성",
  };
  return labels[status]??status;
}
export function orderTerms(order:Order):string[]{
  const parts:string[]=[];
  if(order.orderQuantity!==null)parts.push("주문 "+order.orderQuantity+"주");
  if((order.orderType==="STP"||order.orderType==="STP_LMT") && order.auxPrice!==null)
    parts.push("스탑 발동가 "+order.auxPrice+" "+order.currency);
  if(order.orderType==="TRAIL" && order.auxPrice!==null)
    parts.push("추적 가격차 "+order.auxPrice+" "+order.currency);
  if(["LMT","STP_LMT","AL"].includes(order.orderType??"") && order.limitPrice!==null)
    parts.push("지정가 "+order.limitPrice+" "+order.currency);
  if(order.timeInForce)parts.push("유효기간 "+order.timeInForce);
  if(order.outsideRth!==null)
    parts.push(order.outsideRth?"정규장 외 거래 허용":"정규장 외 거래 미허용");
  return parts;
}
export const executionPriceIsKnown=(order:Order)=>hasExecution(order) && positive(order.price);
export const feeIsKnown=(order:Order)=>hasExecution(order) && order.fee!==null;
