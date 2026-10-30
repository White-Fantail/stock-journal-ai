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

test("AI improvement is persisted only through a user-approved immutable self-checkin",()=>{
 const page=read("../app/private/analysis/page.tsx");
 const action=read("../app/private/analysis/save-improvement.ts");
 const form=read("../app/private/analysis/ai-improvement-form.tsx");
 const panel=read("../app/private/analysis/analysis-panel.tsx");
 const analysis=read("../app/private/analysis/actions.ts");
 assert.ok(page.includes("planRevisions={planRevisions}"));
 assert.ok(action.includes('field(form,"approval")!=="USER_REVIEWED_AND_APPROVED"'));
 assert.ok(action.includes("currentWorkspace()")&&action.includes("auth()"));
 assert.ok(action.includes("fetchPlanCheckinContext(subject,ticker)"));
 assert.ok(action.includes("context.currentPlan.id!==planId"));
 assert.ok(action.includes("submitPlanCheckin(subject"));
 assert.ok(!action.includes("submitJournalPlan"));
 assert.ok(!action.includes("submitReviewAction"));
 assert.ok(!action.includes("openrouter.ai"));
 assert.ok(form.includes('name="selfAssessment" required defaultValue=""'));
 assert.ok(form.includes('name="content"'));
 assert.ok(form.includes('name="nextAction"'));
 assert.ok(form.includes('name="approval" required'));
 assert.ok(form.includes("onChange={e=>setTicker(e.target.value)}"));
 assert.ok(form.includes("value={planRevisions[ticker]"));
 assert.ok(panel.includes("<AiImprovementForm"));
 assert.ok(analysis.includes("saveKeys:result.findings.map(()=>randomUUID())"));
});
