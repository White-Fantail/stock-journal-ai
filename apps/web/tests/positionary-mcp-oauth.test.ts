import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  enabled, ticket, readTicket, validScopes, validRedirectUri,
  validateAuthorization, matchesPkce,
} from "../lib/positionary-mcp-crypto";

const previous = {
  POSITIONARY_MCP_ENABLED: process.env.POSITIONARY_MCP_ENABLED,
  AUTH_SECRET: process.env.AUTH_SECRET,
  SAAS_INTERNAL_SECRET: process.env.SAAS_INTERNAL_SECRET,
  AUTH_URL: process.env.AUTH_URL,
};
process.env.POSITIONARY_MCP_ENABLED="1";
process.env.AUTH_SECRET="a".repeat(64);
process.env.SAAS_INTERNAL_SECRET="b".repeat(64);
process.env.AUTH_URL="https://positionary.example.invalid";
const callback="https://chatgpt.example.invalid/oauth/callback";
const client=()=>ticket("client",{redirectUris:[callback],clientName:"Test client"},3600);
const verifier="a".repeat(43);
const challenge=createHash("sha256").update(verifier).digest("base64url");

test("MCP OAuth has an explicit server-side kill switch", ()=>{
  assert.equal(enabled(),true);
  process.env.POSITIONARY_MCP_ENABLED="0";
  assert.equal(enabled(),false);
  process.env.POSITIONARY_MCP_ENABLED="1";
});

test("OAuth client and code tickets are signed, typed and expiring",()=>{
  const c=client();
  assert.ok(readTicket(c,"client"));
  assert.equal(readTicket(c,"access"),null);
  const [a,b]=c.split(".");
  assert.equal(readTicket(a+"x."+b,"client"),null);
  assert.equal(readTicket(a+"."+b+"x","client"),null);
  const code=ticket("code",{subject:"1234567890123",clientId:c,
    redirectUri:callback,challenge,scope:"positionary:read"},60);
  assert.equal(readTicket(code,"code")?.subject,"1234567890123");
  assert.equal(readTicket(code,"access"),null);
  assert.equal(readTicket(ticket("access",{subject:"abc",clientId:c,scope:"positionary:read"},60),"access"),null);
  assert.equal(readTicket(ticket("code",{subject:"1234567890123",clientId:c,
    redirectUri:"https://different.example/cb",challenge,scope:"positionary:read"},-1),"code"),null);
});

test("Only S256, registered callback, strong state and least-privilege scopes are accepted",()=>{
  const q=new URLSearchParams({client_id:client(),redirect_uri:callback,response_type:"code",
    code_challenge:challenge,code_challenge_method:"S256",scope:"positionary:read",
    state:"safe-client-state-123"});
  assert.ok(validateAuthorization(q));
  for (const [key,value] of [
    ["redirect_uri","https://attacker.example/cb"],
    ["code_challenge_method","plain"],
    ["state","s"],
    ["response_type","token"],
    ["scope","positionary:write"],
    ["scope","positionary:read positionary:evil"],
    ["resource","https://attacker.example/resource"],
  ]) {
    const other=new URLSearchParams(q);other.set(key,value);
    assert.equal(validateAuthorization(other),null,key);
  }
  assert.equal(validScopes("positionary:read positionary:write"),true);
  assert.equal(validScopes("positionary:read positionary:read"),false);
  assert.equal(matchesPkce(verifier,challenge),true);
  assert.equal(matchesPkce("wrong",challenge),false);
  assert.equal(validRedirectUri("https://evil.example/cb#frag"),false);
  assert.equal(validRedirectUri("http://evil.example/cb"),false);
  assert.equal(validRedirectUri("https://user:pass@evil.example/cb"),false);
});

process.env.POSITIONARY_MCP_ENABLED=previous.POSITIONARY_MCP_ENABLED;
process.env.AUTH_SECRET=previous.AUTH_SECRET;
process.env.SAAS_INTERNAL_SECRET=previous.SAAS_INTERNAL_SECRET;
process.env.AUTH_URL=previous.AUTH_URL;
