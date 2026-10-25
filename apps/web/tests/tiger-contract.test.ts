import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectionReadiness } from "../lib/tiger-connection-policy";

const schemaPath = fileURLToPath(new URL("../../../packages/contracts/tiger-readiness.v1.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

test("Tiger owner status matches versioned backend-neutral contract", () => {
  const response = connectionReadiness();
  assert.equal(response.contractVersion, 1);
  assert.deepEqual(Object.keys(response).sort(), [...schema.required].sort());
  assert.equal(schema.additionalProperties, false);
  for (const [name, property] of Object.entries(schema.properties) as [string, any][]) {
    if ("const" in property) {
      assert.equal((response as Record<string, unknown>)[name], property.const);
    }
  }
  assert.ok(response.outstanding.every(code => new RegExp(schema.properties.outstanding.items.pattern).test(code)));
  assert.equal(new Set(response.outstanding).size, response.outstanding.length);
});
