import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDecimal } from "../lib/format-decimal";

test("preserves fractional share precision and groups thousands", () => {
  assert.equal(formatDecimal("179.211"), "179.211");
  assert.equal(formatDecimal("1234567.000000000001"), "1,234,567.000000000001");
  assert.equal(formatDecimal("-12345678.90"), "-12,345,678.90");
  assert.equal(formatDecimal("0"), "0");
  assert.equal(formatDecimal(null), "미제공");
});
