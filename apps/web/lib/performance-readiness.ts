/** Evidence requirements for investment *performance* reporting, not a P&L engine.
 * Even a published FIFO trade ledger does not prove cash-adjusted monthly
 * performance, historic NAV observations, FX, dividends, or all corporate actions.
 * Never infer absent proof from successful quote or asset snapshots.
 */
import type {TigerLedgerRead,TigerPersonalRead} from "./tiger-api";

export type PerformanceGateKind=
  "SOURCE_ACCESS"|"BROKER_EXECUTIONS"|"BROKER_COVERAGE"|
  "CASH_FLOWS"|"DIVIDENDS_CORPORATE_ACTIONS"|"FX_CONVERSION"|
  "HISTORICAL_VALUATIONS"|"PERFORMANCE_RELEASE";
export type PerformanceGate=Readonly<{
  kind:PerformanceGateKind;
  state:"VERIFIED"|"NOT_VERIFIED"|"UNAVAILABLE";
  label:string;detail:string;
}>;
export type PerformanceReadiness=Readonly<{
  overall:"NOT_AVAILABLE";label:"월간 장기 투자 수익률 미제공";
  gates:readonly PerformanceGate[];
  verifiedAccounts:number;truncated:boolean;
  asOf:string|null;source:"PUBLISHED_BROKER_LEDGER_ONLY";
}>;

export function assessPerformanceReadiness(
  ledger:TigerLedgerRead|null, personal:TigerPersonalRead|null,
):PerformanceReadiness{
  const accessible=ledger!==null && ledger.readEnabled &&
    ledger.coverage==="VERIFIED_ACCOUNTS_ONLY";
  const verified=accessible&&ledger!==null?ledger.accounts.filter(a=>a.state==="VERIFIED"):[];
  const truncated=accessible&&ledger?.truncated===true;
  const published=!truncated&&verified.length>0;
  const asOf=verified.reduce<string|null>((last,account)=>{
    const at=account.asOf;
    if(!at||!Number.isFinite(Date.parse(at)))return last;
    return last===null||Date.parse(at)>Date.parse(last)?at:last;
  },null);
  const snapshot=personal?.accounts?.length??0;
  const gates:PerformanceGate[]=[
    {kind:"SOURCE_ACCESS",state:ledger===null?"UNAVAILABLE":accessible?"VERIFIED":"NOT_VERIFIED",
      label:"증권사 원장 조회",detail:ledger===null?
        "서버에서 Tiger 검증 원장 상태를 확인하지 못했습니다.":
        accessible?"사용자별 검증 원장 읽기가 활성화되었습니다.":
        "읽기 가능한 독립 검증 원장이 공개되지 않았습니다."},
    {kind:"BROKER_EXECUTIONS",state:published?"VERIFIED":"NOT_VERIFIED",
      label:"검증된 체결·FIFO 원장",detail:published?
        "독립 검증된 계좌 원장이 일부 공개되었습니다. 각 계좌의 검증 범위를 넘어 전체 실적을 계산하지 않습니다.":
        truncated?"조회 상한으로 일부 체결 또는 포지션이 생략돼 원장을 통째로 사용할 수 없습니다.":
        "검증된 계좌 원장을 사용할 수 없습니다."},
    {kind:"BROKER_COVERAGE",state:"NOT_VERIFIED",label:"전 계좌·전체 기간 원본 이력",
      detail:"게시된 일부 계좌의 원장은 전체 보유 계좌·거래 기간의 커버리지를 증명하지 않습니다."},
    {kind:"CASH_FLOWS",state:"NOT_VERIFIED",label:"입출금·자금 이동",
      detail:"외부 입출금과 계좌 간 자금 이동을 분리한 검증된 현금흐름 원장이 아직 없습니다."},
    {kind:"DIVIDENDS_CORPORATE_ACTIONS",state:"NOT_VERIFIED",label:"배당·분할·기업행동",
      detail:"배당금, 액면분할·합병, 세금과 기타 기업행동 전체 이력이 독립 검증되지 않았습니다."},
    {kind:"FX_CONVERSION",state:"NOT_VERIFIED",label:"환율·기준 통화 일관성",
      detail:"다른 통화로 이루어진 입출금·거래·평가액의 시점별 환산 근거가 충분하지 않습니다."},
    {kind:"HISTORICAL_VALUATIONS",state:"NOT_VERIFIED",label:"기간별 순자산 평가",
      detail:snapshot>0?"Tiger 최근 자산 스냅샷이 있으나 월초·월말 전 계좌 NAV의 완전한 이력은 아닙니다.":
        "월초·월말의 원장과 연결된 NAV 이력이 없습니다."},
    {kind:"PERFORMANCE_RELEASE",state:"NOT_VERIFIED",label:"검증된 장기 투자 성과 공개",
      detail:"선행 검증이 끝나지 않아 성과·수익률·벤치마크 우위 수치를 제공하지 않습니다."},
  ];
  return {overall:"NOT_AVAILABLE",label:"월간 장기 투자 수익률 미제공",
    gates,verifiedAccounts:verified.length,truncated,asOf,
    source:"PUBLISHED_BROKER_LEDGER_ONLY"};
}
