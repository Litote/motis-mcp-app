/**
 * Errors of the OpenRouter account, not of a model: every run after them would fail the same way, so the evaluation
 * stops, and the daily evaluation fails to be noticed (.github/workflows/model-scores.yml). Pure, tested in
 * account.test.ts.
 */

/** Model calls a run needs at least: the daily evaluation plans nothing with fewer requests left. */
export const MIN_CALLS = 4;

/**
 * The account error of an OpenRouter error of [status] and [message], or null for an error of a model (provider busy,
 * model no longer free…). [remaining]: free requests left today, when known.
 */
export function accountError(status: number, message: string, remaining?: number): string | null {
  if (status === 401) return "invalid OpenRouter key (OPENROUTER_API_KEY)";
  if (status === 402) return "OpenRouter credits: negative balance or key limit reached, even the free models are refused";
  if (status === 429 && (remaining === 0 || /free-models-per-day/i.test(message))) return "daily quota of the free models reached";
  return null;
}

/** The account error when fewer than [MIN_CALLS] free requests are left today, else null. */
export function quotaError(remaining: number): string | null {
  return remaining < MIN_CALLS ? `${remaining} free requests left today: nothing evaluated` : null;
}
