import { RESUBSCRIBE_MAX_DELAY_MS, RESUBSCRIBE_MIN_DELAY_MS, RESUBSCRIBE_STEPS } from './constants';

export function getResubscribeDelayMs(attempt: number): number {
  const clampedAttempt = Math.min(Math.max(attempt, 1), RESUBSCRIBE_STEPS);
  const a = (RESUBSCRIBE_MAX_DELAY_MS - RESUBSCRIBE_MIN_DELAY_MS) / (RESUBSCRIBE_STEPS - 1) ** 2;
  return Math.round(a * (clampedAttempt - 1) ** 2 + RESUBSCRIBE_MIN_DELAY_MS);
}
