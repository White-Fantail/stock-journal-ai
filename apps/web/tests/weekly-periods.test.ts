import assert from "node:assert/strict";
import {test} from "node:test";
import {nzRecentWeeks,selectRecentWeek} from "../lib/weekly-periods";

test("Pacific/Auckland week selection follows Monday boundary across UTC date and year",()=>{
 const first=nzRecentWeeks(new Date("2026-10-27T00:00:00Z"),3);
 assert.deepEqual(first,["2026-W44","2026-W43","2026-W42"]);
 assert.equal(selectRecentWeek(first,"2026-W42"),"2026-W42");
 assert.equal(selectRecentWeek(first,"2027-W01"),"2026-W44");
 assert.equal(nzRecentWeeks(new Date("2027-01-01T00:00:00Z"),2)[0],"2026-W53");
 assert.equal(nzRecentWeeks(new Date("2027-01-04T00:00:00Z"),1)[0],"2027-W01");
 assert.throws(()=>nzRecentWeeks(new Date("bad"),3));
 assert.throws(()=>nzRecentWeeks(new Date(),17));
});
