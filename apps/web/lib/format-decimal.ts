/** Presentation only: values keep their full source precision in state, API and audit records.
 * Format base-10 strings without converting the amount to IEEE-754 floats.
 * Money/stock prices use 2dp, quantities up to 3dp, ratios up to 2dp.
 * Very small nonzero amounts must never be displayed as exactly zero.
 */
type Precision = 2 | 3;
function formatNumeric(
  value:string|null|undefined,
  missing:string,
  precision:Precision,
  fixed:boolean,
):string {
  if(value==null) return missing;
  const match=/^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if(!match) return value;
  const sign=match[1], whole=match[2], fraction=match[3]??"";
  const digits=fraction.padEnd(precision+1,"0");
  const unit=BigInt(10)**BigInt(precision);
  const absolute=BigInt(whole)*unit+BigInt(digits.slice(0,precision) || "0")+
    (digits[precision]>="5"?BigInt(1):BigInt(0));
  const nonzero=BigInt(whole)!==BigInt(0)||/[1-9]/.test(fraction);
  if(absolute===BigInt(0)&&nonzero){
    return (sign?"-":"")+"<0."+("0".repeat(precision-1))+"1";
  }
  const integer=(absolute/unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const roundedFraction=(absolute%unit).toString().padStart(precision,"0");
  const decimals=fixed?roundedFraction:roundedFraction.replace(/0+$/,"");
  return (absolute===BigInt(0)?"":sign)+integer+(decimals?"."+decimals:"");
}

/** General visible decimals: at most two fractional digits, omit trailing zeroes. */
export function formatDecimal(value:string|null|undefined,missing="미제공"):string {
  return formatNumeric(value,missing,2,false);
}
/** Monetary amounts and prices: always two fractional digits. */
export function formatMoney(value:string|null|undefined,missing="미제공"):string {
  return formatNumeric(value,missing,2,true);
}
/** Stock share quantities: at most three fractional digits, no artificial .000. */
export function formatQuantity(value:string|null|undefined,missing="미제공"):string {
  return formatNumeric(value,missing,3,false);
}
/** Percentages: at most two fractional digits. Append % at the call site. */
export function formatPercent(value:string|null|undefined,missing="미제공"):string {
  return formatNumeric(value,missing,2,false);
}
