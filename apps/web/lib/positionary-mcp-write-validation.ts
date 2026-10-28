/** Validate presence of MCP write fields without rejecting schema-allowed nulls.
 * A required nullable property must be present; null means explicitly unset.
 * The downstream tenant-scoped API still validates all field values.
 */
export function requireMcpWriteFields(
  payload: Record<string, unknown>,
  required: readonly string[],
  properties: Record<string, unknown>,
): void {
  for (const name of required) {
    const value = payload[name];
    const definition = properties[name];
    const type = definition && typeof definition === "object" && !Array.isArray(definition)
      ? (definition as { type?: unknown }).type : undefined;
    const nullable = Array.isArray(type) && type.includes("null");
    if (value === undefined || (value === null && !nullable)) {
      throw new Error("Missing required field: " + name);
    }
  }
}
