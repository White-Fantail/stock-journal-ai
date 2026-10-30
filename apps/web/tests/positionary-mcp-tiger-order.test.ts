import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const tools=read("../lib/positionary-mcp-tools.ts");
const backend=read("../../../services/saas_api/journal_observation_links.py");
const history=read("../../../temporary/tiger_personal/history_sync.py");

test("MCP refresh only uses fixed signed owner gateway with no trading methods",()=>{
 assert.ok(tools.includes('read("request_tiger_order_refresh"'));
 assert.ok(tools.includes('read("get_tiger_order_refresh_status"'));
 assert.ok(tools.includes('tiger(sub,"personal-refresh")'));
 assert.ok(tools.includes('tiger(sub,"personal-refresh-status")'));
 assert.ok(tools.includes("createHmac"));
 assert.ok(!tools.includes('tiger(sub,"place_order"'));
 assert.ok(!history.includes("client.place_order("));
});

test("exact user-approved order-note linking uses existing verified-under-RLS source identity",()=>{
 assert.ok(tools.includes('write("add_tiger_order_note"'));
 assert.ok(tools.includes('observationKind:"ORDER"'));
 assert.ok(tools.includes('submitTigerObservationNote(sub,{'));
 assert.ok(tools.includes('idempotencyKey:field(p,"idempotencyKey")'));
 assert.ok(tools.includes('page:{type:"integer",minimum:0,maximum:20'));
 assert.ok(tools.includes('sourceRef:{type:"string",pattern:"^[0-9a-f]{64}$"'));
 assert.ok(backend.includes('if len(matched)!=1:'));
 assert.ok(backend.includes('raise TradeNotFound("OBSERVATION_NOT_AVAILABLE")'));
 assert.ok(backend.includes('owner_only(subject)'));
 assert.ok(backend.includes('idempotency_key'));
});

test("MCP never promotes unfilled order observations to broker verified fills",()=>{
 assert.ok(tools.includes('verifiedExecution:false'));
 assert.ok(tools.includes('SUBMITTED/0 shares is a pending order'));
 assert.ok(tools.includes('Never claim a broker execution'));
});
