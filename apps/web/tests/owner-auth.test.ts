import assert from "node:assert/strict";
import { test } from "node:test";
import { isApprovedOwner, ownerAuthConfigured } from "../lib/owner-policy";

test("owner is locked to immutable numeric GitHub account id, not name/email", () => {
  assert.equal(isApprovedOwner("123456", "123456"), true);
  assert.equal(isApprovedOwner(123456, "123456"), true);
  for (const candidate of ["1234567", "owner@example.com", "owner", null,
                           false, undefined, {}, 123455, "0123456"]) {
    assert.equal(isApprovedOwner(candidate, "123456"), false);
  }
  assert.equal(isApprovedOwner("123456", ""), false);
  assert.equal(isApprovedOwner("123456", undefined), false);
});

const configured = {
  OWNER_GITHUB_ID: "123456",
  AUTH_GITHUB_ID: "synthetic-github-app-id",
  AUTH_GITHUB_SECRET: "synthetic-not-a-real-oauth-secret",
  AUTH_SECRET: "synthetic-and-deliberately-unused-1234567890",
  AUTH_URL: "https://stock-journal.example.invalid",
};

test("missing or incomplete config always disables login", () => {
  assert.equal(ownerAuthConfigured({}), false);
  assert.equal(ownerAuthConfigured(configured), true);
  for (const key of Object.keys(configured)) {
    assert.equal(ownerAuthConfigured({ ...configured, [key]: undefined }), false);
  }
  assert.equal(ownerAuthConfigured({ ...configured, OWNER_GITHUB_ID: "a-user-name" }), false);
  assert.equal(ownerAuthConfigured({ ...configured, AUTH_SECRET: "short" }), false);
});

test("non-HTTPS or manipulated AUTH_URL is denied", () => {
  for (const url of ["http://localhost:3000", "http://stock-journal.example.invalid",
                     "https://user@stock-journal.example.invalid",
                     "https://stock-journal.example.invalid/login",
                     "https://stock-journal.example.invalid/?next=evil",
                     "https://stock-journal.example.invalid/#evil"]) {
    assert.equal(ownerAuthConfigured({ ...configured, AUTH_URL: url }), false, url);
  }
});
