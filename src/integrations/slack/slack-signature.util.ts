import * as crypto from 'crypto';

/**
 * Verifies a Slack request signature (https://api.slack.com/authentication/verifying-requests-from-slack).
 *
 * Slack signs `v0:{timestamp}:{rawBody}` with the app Signing Secret using
 * HMAC-SHA256. We must hash the exact raw request bytes, so callers pass
 * `req.rawBody` (enabled via `rawBody: true` in main.ts).
 *
 * Returns false (rather than throwing) so callers can respond 401 uniformly.
 */
export function verifySlackSignature(
  signingSecret: string | undefined,
  rawBody: Buffer | string | undefined,
  timestamp: string | string[] | undefined,
  signature: string | string[] | undefined,
): boolean {
  if (!signingSecret || rawBody == null) return false;

  const ts = Array.isArray(timestamp) ? timestamp[0] : timestamp;
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!ts || !sig) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  // Reject requests older than 5 minutes to guard against replay attacks.
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 60 * 5) return false;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const base = `v0:${ts}:${body}`;
  const computed =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');

  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
