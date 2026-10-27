import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");

test("new action follow-up uses its own independent page and same-user signed backend",()=>{
 const hub=read("../app/private/review/page.tsx");
 const editor=read("../app/private/review/action/new/page.tsx");
 const backend=read("../../../services/saas_api/action_followups.py");
 const api=read("../lib/saas-trades-api.ts");
 assert.ok(hub.includes("fetchReviewActions(session.user.id)"));
 assert.ok(hub.includes("지난 점검에서 정한 다음 행동"));
 assert.ok(!hub.includes("<form"));
 assert.ok(hub.includes("/private/review/action/new?checkin="));
 assert.ok(editor.includes("currentWorkspace()"));
 assert.ok(editor.includes("submitReviewAction(session.user.id"));
 assert.ok(editor.includes("fetchReviewActions(session.user.id)"));
 for(const state of ["DONE","NOT_DONE","NOT_APPLICABLE","UNCERTAIN"])
   assert.ok(editor.includes('value="'+state+'"'));
 assert.ok(backend.includes("_confirmed_scope(identity,subject)"));
 assert.ok(backend.includes("_runtime_safety(trade)"));
 assert.ok(backend.includes("_tenant_scope(trade,scope)"));
 assert.ok(backend.includes("current[0]"));
 assert.ok(api.includes("/internal/v1/review/action/resolve"));
 assert.ok(api.includes("Array.isArray(result.actionFollowups)"));
});
test("AI does not automatically save investment plans or evaluate trades",()=>{
 const ai=read("../app/private/analysis/actions.ts");
 const coach=read("../lib/coach-evidence.ts");
 const panel=read("../app/private/analysis/analysis-panel.tsx");
 assert.ok(ai.includes("form.get(\"consent\")"));
 assert.ok(ai.includes("fetchReviewActions(subject)"));
 assert.ok(ai.includes("withAuthoredActionFollowup"));
 assert.ok(ai.includes("claimAiAnalysis(subject,mode"));
 assert.ok(!ai.includes("submitJournalPlan"));
 assert.ok(!ai.includes("submitReviewAction"));
 assert.ok(coach.includes("USER_REPORTED_ACTION_STATUS_NOT_INDEPENDENTLY_VERIFIED"));
 assert.ok(panel.includes("state.mode===mode"));
 assert.ok(panel.includes("state.symbol===selected"));
});
