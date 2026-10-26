import assert from "node:assert/strict";
import { test } from "node:test";
import { googleIdentity, saasAuthConfigured } from "../lib/saas-auth-policy";
import { SESSION_MAX_AGE_SECONDS, SESSION_REFRESH_INTERVAL_SECONDS } from "../lib/auth-session-policy";

const configured = {
  AUTH_GOOGLE_ID: "synthetic-google-client-id",
  AUTH_GOOGLE_SECRET: "synthetic-google-client-secret",
  AUTH_SECRET: "synthetic-auth-secret-longer-than-32-chars",
  AUTH_URL: "https://journal.example.invalid",
  SAAS_INTERNAL_API_URL: "https://internal.example.invalid",
  SAAS_INTERNAL_SECRET: "synthetic-internal-secret-over-32-chars",
};

test("Google verified subject, not email, defines identity", () => {
  const p = {sub:"1000000000001",email:"a@example.invalid",email_verified:true,name:"A"};
  assert.deepEqual(googleIdentity(p),{subject:p.sub,email:p.email,name:"A",email_verified:true});
  for (const candidate of [{...p,email_verified:false},{...p,sub:"github"}, {...p,sub:""},
    {...p,email:"bad"}, null,{}, {...p,email_verified:"true"}]) {
    assert.equal(googleIdentity(candidate), null);
  }
});

test("Google login requires ALL private configurations and safe origins", () => {
  assert.equal(saasAuthConfigured(configured),true);
  for (const key of Object.keys(configured)) {
    assert.equal(saasAuthConfigured({...configured,[key]:undefined}),false,key);
  }
  for(const unsafe of ["http://example.invalid","https://user@example.invalid",
    "https://example.invalid/private","https://example.invalid/?token=1"]) {
    assert.equal(saasAuthConfigured({...configured,AUTH_URL:unsafe}),false,unsafe);
    assert.equal(saasAuthConfigured({...configured,SAAS_INTERNAL_API_URL:unsafe}),false,unsafe);
  }
  assert.equal(saasAuthConfigured({...configured,AUTH_URL:"http://localhost:3000"}),false);
  assert.equal(saasAuthConfigured({...configured,AUTH_URL:"http://localhost:3000"},true),true);
});


test("Google JWT session persists for 30 days and refreshes before expiry", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(SESSION_REFRESH_INTERVAL_SECONDS, 60 * 60);
  assert.ok(SESSION_REFRESH_INTERVAL_SECONDS < SESSION_MAX_AGE_SECONDS);
});
