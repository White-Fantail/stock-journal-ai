import assert from "node:assert/strict";
import {test} from "node:test";
import {assessPerformanceReadiness} from "../lib/performance-readiness";
import type {TigerLedgerRead,TigerPersonalRead} from "../lib/tiger-api";
const full=():TigerLedgerRead=>({
 provider:"TIGER",readEnabled:true,coverage:"VERIFIED_ACCOUNTS_ONLY",
 accounts:[{accountId:"synthetic",alias:"Synthetic verified",state:"VERIFIED",
   asOf:"2026-10-25T00:00:00Z",version:2}],
 executions:[],positions:[{
   accountId:"synthetic",symbol:"TEST",currency:"USD",quantity:"1",
   costBasis:"100",realizedPnl:"0",asOf:"2026-10-25T00:00:00Z",
   reviewVersion:2,provenance:"BROKER_VERIFIED",
 }],truncated:false,
});
test("no broker data means no profitability assertion",()=>{
 const s=assessPerformanceReadiness(null,null);
 assert.equal(s.overall,"NOT_AVAILABLE");
 assert.equal(s.verifiedAccounts,0);
 assert.equal(s.gates.find(x=>x.kind==="SOURCE_ACCESS")?.state,"UNAVAILABLE");
 assert.ok(s.gates.every(x=>x.state!=="VERIFIED"));
});
test("one verified broker ledger does not certify full coverage or cashflow-adjusted returns",()=>{
 const s=assessPerformanceReadiness(full(),null);
 assert.equal(s.overall,"NOT_AVAILABLE");
 assert.equal(s.verifiedAccounts,1);
 assert.equal(s.gates.find(x=>x.kind==="BROKER_EXECUTIONS")?.state,"VERIFIED");
 for(const key of ["BROKER_COVERAGE","CASH_FLOWS","DIVIDENDS_CORPORATE_ACTIONS",
  "FX_CONVERSION","HISTORICAL_VALUATIONS","PERFORMANCE_RELEASE"]){
  assert.equal(s.gates.find(x=>x.kind===key)?.state,"NOT_VERIFIED");
 }
});
test("verified account with no published execution or position rows stays incomplete",()=>{
 const empty={...full(),positions:[],executions:[]};
 const state=assessPerformanceReadiness(empty,null);
 assert.equal(state.verifiedAccounts,1);
 assert.equal(state.gates.find(x=>x.kind==="BROKER_EXECUTIONS")?.state,"NOT_VERIFIED");
 assert.equal(state.overall,"NOT_AVAILABLE");
});
test("limited broker ledger fails closed and personal assets are not backfilled as proof",()=>{
 const incomplete={...full(),truncated:true};
 const snapshot={coverage:"SNAPSHOT_ONLY",verified:false,accounts:[{
  alias:"Synthetic",asOf:"2026-10-27T00:00:00Z",
 }]} as TigerPersonalRead;
 const s=assessPerformanceReadiness(incomplete,snapshot);
 assert.equal(s.gates.find(x=>x.kind==="BROKER_EXECUTIONS")?.state,"NOT_VERIFIED");
 assert.equal(s.gates.find(x=>x.kind==="HISTORICAL_VALUATIONS")?.state,"NOT_VERIFIED");
 assert.equal(s.overall,"NOT_AVAILABLE");
});
