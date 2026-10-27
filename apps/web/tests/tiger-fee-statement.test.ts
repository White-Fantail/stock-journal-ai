import assert from "node:assert/strict";
import {test} from "node:test";
import {parseStatementFeeEvidence,resolvedFeeCurrency,statementMatchesOrder} from "../lib/tiger-fee-statement";
import type {TigerPersonalOrder} from "../lib/tiger-api";
const alias="Tiger pilot ••••9999";
const sample: TigerPersonalOrder={
 sourceRef:"a".repeat(64),symbol:"SAMPLE",side:"BUY",currency:"USD",
 status:"FILLED",filled:"5",price:"10.25",fee:"2.01",feeCurrency:null,
 at:String(Date.parse("2026-09-14T13:30:19Z")), // 09:30:19 US Eastern
};
const rows=Array.from({length:10},(_,i)=>({
  symbol:i===0?"SAMPLE":"T"+String(i),
  side:"BUY",quantity:i===0?"5":"1",price:i===0?"10.25":"5",
  fee:i===0?"2.01":"0.5",tradeTimeEastern:i===0?"2026-09-14 09:30:19":
    `2026-09-${String(14+i).padStart(2,"0")} 09:31:00`,
  currency:"USD",
}));
const proof=JSON.stringify({accountAlias:alias,baseCurrency:"USD",periodStart:"2026-08-01",
 periodEnd:"2026-10-25",source:"OWNER_PROVIDED_TIGER_STATEMENT",rows});
test("only exact independently matched fees acquire statement-attested USD",()=>{
 const attested=parseStatementFeeEvidence(proof);
 assert.ok(attested);
 assert.equal(resolvedFeeCurrency(sample,alias,"USD",attested).currency,"USD");
 assert.equal(resolvedFeeCurrency(sample,alias,"USD",attested).basis,"STATEMENT_MATCH");
 assert.ok(statementMatchesOrder(sample,alias,"USD",attested));
 assert.equal(resolvedFeeCurrency({...sample,feeCurrency:"USD"},alias,"USD",attested).basis,"TIGER_API");
 assert.deepEqual(resolvedFeeCurrency({...sample,feeCurrency:"NZD"},alias,"USD",attested),
   {currency:null,basis:"CONFLICT"});
});
test("no inference for other accounts, dates, price, fee, quantity, symbol or currency",()=>{
 const p=parseStatementFeeEvidence(proof);
 assert.ok(p);
 const bad=[
  {order:sample,alias:"Tiger pilot ••••0000",base:"USD"},
  {order:sample,alias,base:"NZD"},
  {order:{...sample,symbol:"WRONG"},alias,base:"USD"},
  {order:{...sample,side:"SELL" as const},alias,base:"USD"},
  {order:{...sample,fee:"2.02"},alias,base:"USD"},
  {order:{...sample,filled:"6"},alias,base:"USD"},
  {order:{...sample,price:"10.26"},alias,base:"USD"},
  {order:{...sample,status:"CANCELLED"},alias,base:"USD"},
  {order:{...sample,currency:"NZD"},alias,base:"USD"},
  {order:{...sample,at:String(Date.parse("2026-09-14T13:30:20Z"))},alias,base:"USD"},
  {order:{...sample,at:String(Date.parse("2026-10-27T13:30:19Z"))},alias,base:"USD"},
  {order:{...sample,sourceRef:"forged"},alias,base:"USD"},
 ];
 for(const {order,alias:a,base} of bad){
  assert.deepEqual(resolvedFeeCurrency(order,a,base,p),{currency:null,basis:"UNKNOWN"});
 }
 assert.deepEqual(resolvedFeeCurrency(sample,alias,"USD",null),{currency:null,basis:"UNKNOWN"});
});
test("refuse corrupt, duplicate or broadened secret statement configurations",()=>{
 const base=JSON.parse(proof);
 const bad=[
  {...base,rows:[]},{...base,accountAlias:"unscoped"},
  {...base,periodStart:"2025-01-01"},
  {...base,rows:[...base.rows,base.rows[0]]},
  {...base,rows:base.rows.map((r:unknown,i:number)=>i===1?base.rows[0]:r)},
  {...base,rows:base.rows.map((r:Record<string,string>,i:number)=>i===0?{...r,fee:"NaN"}:r)},
  {...base,rows:base.rows.map((r:Record<string,string>,i:number)=>i===0?{...r,currency:"NZD"}:r)},
 ];
 for(const input of bad)assert.equal(parseStatementFeeEvidence(JSON.stringify(input)),null);
 assert.equal(parseStatementFeeEvidence(undefined),null);
 assert.equal(parseStatementFeeEvidence("{bad"),null);
});
