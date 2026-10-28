import assert from "node:assert/strict";
import { test } from "node:test";
import {formatDecimal,formatMoney,formatQuantity,formatPercent} from "../lib/format-decimal";

test("money is displayed with exactly two decimals, without losing the source amount",()=>{
  assert.equal(formatMoney("51.9"),"51.90");
  assert.equal(formatMoney("1234567.000000000001"),"1,234,567.00");
  assert.equal(formatMoney("-12345678.905"),"-12,345,678.91");
  assert.equal(formatMoney("0"),"0.00");
  assert.equal(formatMoney(null),"미제공");
  assert.equal(formatMoney("0.004"),"<0.01");
  assert.equal(formatMoney("-0.004"),"-<0.01");
});
test("share quantities use at most 3 decimals and avoid showing a nonzero holding as zero",()=>{
  assert.equal(formatQuantity("179.211"),"179.211");
  assert.equal(formatQuantity("21.00000000"),"21");
  assert.equal(formatQuantity("1.2345"),"1.235");
  assert.equal(formatQuantity("0.000000000001"),"<0.001");
  assert.equal(formatQuantity("-0.000000000001"),"-<0.001");
});
test("ratios and general figures show at most two decimals without trailing zeros",()=>{
  assert.equal(formatPercent("12.3400000000"),"12.34");
  assert.equal(formatPercent("12.345"),"12.35");
  assert.equal(formatPercent("20.00"),"20");
  assert.equal(formatDecimal("179.211"),"179.21");
  assert.equal(formatDecimal("1234567.000000000001"),"1,234,567");
});
test("string rounding handles large exact integers without floating point conversion",()=>{
  assert.equal(formatMoney("999999999999999999999999.999999999999"),"1,000,000,000,000,000,000,000,000.00");
  assert.equal(formatQuantity("999999999999999999999999.9999"),"1,000,000,000,000,000,000,000,000");
  assert.equal(formatMoney("not a number","—"),"not a number");
  assert.equal(formatQuantity(undefined,"—"),"—");
});
