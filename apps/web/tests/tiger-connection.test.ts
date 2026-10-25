import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionReadiness } from "../lib/tiger-connection-policy";

test("private Tiger UI never reports a live session without actual provider verification", () => {
  const report = connectionReadiness();
  assert.equal(report.source, "NO_BROKER_CALLS");
  assert.equal(report.authorization, "NOT_CONNECTED");
  assert.equal(report.brokerageQueries, "DISABLED");
  assert.equal(report.shadowSync, "FIXTURES_ONLY");
  assert.ok(report.outstanding.includes("TIGER_QUERY_ONLY_CONSENT_NOT_VERIFIED"));
  assert.ok(report.outstanding.every(item => /^[A-Z0-9_]+$/.test(item)));
  const serialized = JSON.stringify(report);
  for (const secret of ["access_token", "refresh_token", "private_key", "account_id"]) {
    assert.ok(!serialized.includes(secret), secret);
  }
});
