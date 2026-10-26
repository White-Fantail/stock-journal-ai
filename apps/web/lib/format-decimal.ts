/** Render money and share quantities without IEEE-754 rounding.
 * Broker numeric strings may contain 12+ fractional digits or >2^53 values.
 */
export function formatDecimal(value: string | null | undefined, missing="미제공"): string {
  if (value == null) return missing;
  const parts = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (!parts) return value;
  const integer = parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts[1] + integer + (parts[3] === undefined ? "" : "." + parts[3]);
}
