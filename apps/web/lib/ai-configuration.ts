import "server-only";

/** Feature stays disabled until both explicit rollout flag and an isolated
 * server-only OpenRouter key+model are installed. Never NEXT_PUBLIC_*.
 */
export function aiConfigured(env:NodeJS.ProcessEnv=process.env):boolean{
  return env.POSITIONARY_AI_ENABLED==="1" &&
    typeof env.OPENROUTER_API_KEY==="string" && env.OPENROUTER_API_KEY.length>=20 &&
    typeof env.OPENROUTER_MODEL==="string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9./:_-]{2,100}$/.test(env.OPENROUTER_MODEL);
}
