/** Shared inert user taxonomy. Never auto-assign a ticker to a factor. */
export const RISK_FACTOR_LABELS={
 AI_INFRA:"AI 인프라·반도체",HIGH_GROWTH:"고성장 기대",
 US_TECH:"미국 기술주",CONSUMER_CYCLICAL:"경기민감 소비",
 SPACE_DEFENSE:"우주·방산",INTEREST_RATE:"금리 민감",
 CHINA:"중국 시장 노출",OTHER:"기타 공통 요인",
} as const;
export type UserRiskFactor=keyof typeof RISK_FACTOR_LABELS;
