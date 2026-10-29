import assert from "node:assert/strict";
import { test } from "node:test";
import { requireMcpWriteFields } from "../lib/positionary-mcp-write-validation";

const fields = {
  ticker: { type: "string" },
  rationale: { type: "string" },
  targetPrice: { type: ["string", "null"] },
  stopPrice: { type: ["string", "null"] },
  priceCurrency: { type: ["string", "null"] },
  invalidationCondition: { type: ["string", "null"] },
  maxAllocationPct: { type: ["string", "null"] },
  strategyType: { type: ["string", "null"], enum: ["LONG_TERM", null] },
  reviewCadence: { type: ["string", "null"], enum: ["MONTHLY", null] },
};
const required = Object.keys(fields);

test("MCP plan revision allows explicitly unset target, stop, currency and invalidation", () => {
  assert.doesNotThrow(() => requireMcpWriteFields({
    ticker: "TSLA",
    rationale: "Long-term holding; review FSD commercial adoption monthly",
    targetPrice: null,
    stopPrice: null,
    priceCurrency: null,
    invalidationCondition: null,
    maxAllocationPct: "60",
    strategyType: "LONG_TERM",
    reviewCadence: "MONTHLY",
  }, required, fields));
});

test("MCP required nullable properties still must be provided", () => {
  const payload = Object.fromEntries(required.map(k => [k, k === "ticker" ? "TSLA" : k === "rationale" ? "Synthetic plan rationale" : null]));
  for (const missing of ["targetPrice", "priceCurrency", "maxAllocationPct"]) {
    const incomplete = { ...payload };
    delete incomplete[missing];
    assert.throws(() => requireMcpWriteFields(incomplete, required, fields),
      new RegExp("Missing required field: " + missing));
  }
});

test("MCP required non-nullable fields reject null or missing values", () => {
  for (const value of [null, undefined]) {
    assert.throws(() => requireMcpWriteFields({ticker: value}, ["ticker"], fields),
      /Missing required field: ticker/);
  }
  assert.throws(() => requireMcpWriteFields({ticker:null},["ticker"],{ticker:{type:"string",enum:["TSLA",null]}}),
    /Missing required field: ticker/);
});
