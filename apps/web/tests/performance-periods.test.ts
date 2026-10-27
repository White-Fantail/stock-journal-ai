import assert from "node:assert/strict";
import {test} from "node:test";
import {completedPerformanceIntervals,selectPerformanceInterval} from "../lib/performance-periods";

test("completed NZ calendar periods cannot show partial current reporting periods",()=>{
 const now=new Date("2026-10-27T01:00:00Z");
 const periods=completedPerformanceIntervals(now);
 assert.equal(periods.length,19);
 assert.deepEqual(periods.map(p=>p.kind).reduce((o,k)=>(o[k]=(o[k]??0)+1,o),
   {} as Record<string,number>),{MONTH:12,QUARTER:4,YEAR:3});
 assert.equal(periods[0].key,"M:2026-09");
 assert.equal(periods[0].start,"2026-08-31T12:00:00.000Z");
 assert.equal(periods[0].end,"2026-09-30T11:00:00.000Z");
 assert.equal(periods.find(p=>p.key==="Q:2026-3")?.end,"2026-09-30T11:00:00.000Z");
 assert.equal(periods.find(p=>p.key==="Y:2025")?.end,"2025-12-31T11:00:00.000Z");
 assert.ok(periods.every(p=>p.status==="EVIDENCE_INCOMPLETE"&&p.currency==="UNSPECIFIED"));
 assert.equal(periods.some(p=>p.key==="M:2026-10"||p.key==="Q:2026-4"||p.key==="Y:2026"),false);
});
test("month end and NZ DST boundaries are preserved across quarters and years",()=>{
 const periods=completedPerformanceIntervals(new Date("2029-05-15T00:00:00Z"));
 assert.equal(periods.find(p=>p.key==="M:2029-04")?.start,"2029-03-31T11:00:00.000Z");
 assert.equal(periods.find(p=>p.key==="M:2029-04")?.end,"2029-04-30T12:00:00.000Z");
 assert.equal(periods.find(p=>p.key==="Q:2029-2"),undefined);
 assert.equal(periods.find(p=>p.key==="Q:2029-1")?.end,"2029-03-31T11:00:00.000Z");
});
test("invalid, future or user-forged period selection falls back to a verified calendar option",()=>{
 const periods=completedPerformanceIntervals(new Date("2026-10-27T01:00:00Z"));
 assert.equal(selectPerformanceInterval(periods,"Q:2026-2")?.key,"Q:2026-2");
 assert.equal(selectPerformanceInterval(periods,"Y:2025")?.key,"Y:2025");
 assert.equal(selectPerformanceInterval(periods,"M:2026-10"),periods[0]);
 assert.equal(selectPerformanceInterval(periods,"../../forged"),periods[0]);
 assert.equal(selectPerformanceInterval(periods,null),periods[0]);
 assert.equal(selectPerformanceInterval([],"M:2026-09"),null);
});
