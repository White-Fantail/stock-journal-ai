/** User-authored criteria, never a quote feed or trading recommendation. */
export type IndicatorDefinition = {
  name:string;parameters:string;timeframe:string;side:"BUY"|"SELL";
  stage:"CONTEXT"|"TIMING";operator:"LTE"|"GTE"|"BETWEEN"|"MANUAL";
  lower:string|null;upper:string|null;condition:string;active:boolean;
};
export type IndicatorRule = IndicatorDefinition & {id:string;ruleId:string;createdAt:string};
export type IndicatorRuleInput = IndicatorDefinition & {
  idempotencyKey:string;ruleId:string|null;expectedRevisionId:string|null;
};
export type IndicatorRecordInput = {
  idempotencyKey:string;ticker:string;side:"BUY"|"SELL";observedAt:string;
  tradeEventId:string|null;journalId:string|null;note:string;
  observations:{revisionId:string;value:string|null;assessment:"MET"|"NOT_MET"|"UNCERTAIN"}[];
};
export type IndicatorRecord = Omit<IndicatorRecordInput,"idempotencyKey"|"observations"> & {
  id:string;createdAt:string;source:"USER_AUTHORED_ONLY";
  observations:{rule:IndicatorRule;value:string|null;assessment:"MET"|"NOT_MET"|"UNCERTAIN";
    basis:"USER_ASSESSED"|"MISSING_VALUE"|"ENTERED_VALUE_COMPARISON"}[];
};
export type IndicatorFilter = {ticker:string|null;tradeEventId:string|null;journalId:string|null};
export const SIDE_LABELS={BUY:"매수",SELL:"매도"};
export const STAGE_LABELS={CONTEXT:"검토 조건",TIMING:"시점 판단"};
export const ASSESSMENT_LABELS={MET:"충족",NOT_MET:"미충족",UNCERTAIN:"판단 보류"};
export function indicatorCriterion(rule:IndicatorDefinition):string {
  if(rule.operator==="MANUAL")return rule.condition;
  if(rule.operator==="BETWEEN")return `${rule.lower} ~ ${rule.upper}`;
  return `${rule.lower} ${rule.operator==="LTE"?"이하":"이상"}`;
}
export function readIndicatorRule(form:FormData):IndicatorRuleInput {
  const s=(k:string)=>String(form.get(k)??"").trim();
  const operator=s("operator") as IndicatorDefinition["operator"];
  return {idempotencyKey:s("idempotencyKey"),ruleId:s("ruleId")||null,
    expectedRevisionId:s("expectedRevisionId")||null,name:s("name"),parameters:s("parameters"),
    timeframe:s("timeframe"),side:s("side") as IndicatorDefinition["side"],
    stage:s("stage") as IndicatorDefinition["stage"],operator,
    lower:operator==="MANUAL"?null:s("lower")||null,
    upper:operator==="BETWEEN"?s("upper")||null:null,
    condition:s("condition"),active:form.get("active")==="yes"};
}
export function readIndicatorRecord(form:FormData):IndicatorRecordInput {
  const s=(k:string)=>String(form.get(k)??"").trim();
  return {idempotencyKey:s("idempotencyKey"),ticker:s("ticker").toUpperCase(),
    side:s("side") as IndicatorRecordInput["side"],observedAt:s("observedAt"),
    tradeEventId:s("tradeEventId")||null,journalId:s("journalId")||null,note:s("note"),
    observations:form.getAll("revisionId").map(id=>({revisionId:String(id),
      value:s(`value:${id}`)||null,
      assessment:(s(`assessment:${id}`)||"UNCERTAIN") as "MET"|"NOT_MET"|"UNCERTAIN"}))};
}
