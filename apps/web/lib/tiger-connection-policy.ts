/** No Tiger OAuth flow is active on the web server.
 * This policy is intentionally incapable of describing a live account as linked.
 * Only a future versioned, server-only connector may replace this after audit.
 */
export type ConnectionReadiness = Readonly<{
  contractVersion: 1;
  source: "NO_BROKER_CALLS";
  authorization: "NOT_CONNECTED";
  brokerageQueries: "DISABLED";
  shadowSync: "FIXTURES_ONLY";
  outstanding: readonly string[];
}>;

export function connectionReadiness(): ConnectionReadiness {
  return {
    contractVersion: 1,
    source: "NO_BROKER_CALLS",
    authorization: "NOT_CONNECTED",
    brokerageQueries: "DISABLED",
    shadowSync: "FIXTURES_ONLY",
    outstanding: [
      "OWNER_OAUTH_NOT_PROVISIONED",
      "TIGER_QUERY_ONLY_CONSENT_NOT_VERIFIED",
      "TIGER_SDK_LOCAL_TOKEN_CACHE_UNREVIEWED_FOR_HOSTING",
      "LIVE_TIGER_ACCOUNT_QUERY_NOT_VERIFIED",
      "INDEPENDENT_PHASE0_BACKUP_NOT_CONFIRMED",
    ],
  };
}
