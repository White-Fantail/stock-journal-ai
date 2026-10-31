import assert from "node:assert/strict";
import {test} from "node:test";
import {isOlderReviewAction} from "../lib/review-action-age";
const now=new Date("2026-11-01T00:00:00Z");
test("age classification is conservative",()=>{
 assert.equal(isOlderReviewAction("2026-07-01T00:00:00Z",now),true);
 assert.equal(isOlderReviewAction("2026-10-01T00:00:00Z",now),false);
 assert.equal(isOlderReviewAction("2026-08-03T00:00:00Z",now),false);
 assert.equal(isOlderReviewAction("2026-08-02T23:59:59Z",now),true);
 assert.equal(isOlderReviewAction("2026-07-01T00:00:00Z",new Date("invalid")),false);
 assert.equal(isOlderReviewAction("invalid",now),false);
 assert.equal(isOlderReviewAction("2026-12-01T00:00:00Z",now),false);
});
