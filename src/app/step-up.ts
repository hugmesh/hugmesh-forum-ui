import { HttpErrorResponse } from '@angular/common/http';

/**
 * The platform's "step-up required" 403 contract, as this remote consumes it
 * (issue #3, item 1 — first slice).
 *
 * <h2>Which step-up gate the forum is behind</h2>
 * hugmesh-forum-bff-api (PR #11, merged 2026-08-20) wraps `/bff/forum/admin/**`
 * and `/bff/forum/moderation/**` in `SecurityConfig.stepUp(base)`: while the
 * platform flag `app.mfa.enabled` is off (today's org-wide default) the wrapper
 * is a no-op; once it is on, those two path groups ALSO demand the non-role
 * `MFA_SATISFIED` authority, which `CasdoorAuthorities` derives ONLY from a
 * fresh `mfa_satisfied_at` claim. That claim is stamped on the caller's OWN
 * opaque session by the platform's MFA challenge (`POST /bff/mfa/challenge`,
 * rendered by hugmesh-login-ui at `/login/mfa/challenge`). There is NO token
 * leg on the forum gate — unlike the admin-bff Service Store gates
 * (`X-ServiceStore-StepUp` etc.), a pasted token is never read here — so the
 * only way to satisfy it is a fresh MFA stamp, after which a plain retry of the
 * same call succeeds.
 *
 * <h2>How a step-up denial is recognised</h2>
 * The same contract as hugmesh-admin-ui `mfa/step-up-error.ts`, the fleet's
 * reference detector — identical header name, phrase pattern and 403-only rule
 * (that detector reads its `BffHttpError`; this one reads Angular's
 * `HttpErrorResponse`):
 * <ol>
 *   <li><b>STRUCTURED</b> — a 403 carrying `X-Step-Up-Required: X-<flavour>-StepUp`
 *       (admin-bff `web/StepUpRequiredException` + `ApiExceptionHandler`).</li>
 *   <li><b>LEGACY PHRASE</b> — a body whose error message contains
 *       "requires step-up", the pre-signal contract every gate message retains.</li>
 * </ol>
 * An ordinary 403 (a MOD without ROLE_FORUM, an own-domain DENY, the gateway's
 * `X-Route-Denied`) matches NEITHER and is left alone — a routine authz DENY
 * must never offer an MFA prompt. HONEST GAP, tracked on hugmesh-forum-bff-api:
 * the forum BFF's MFA denial is Spring Security's default access-denied (403,
 * empty body, no signal header) TODAY, so this detector cannot fire against it
 * until that BFF emits the structured signal. This module is the UI half of
 * that contract, wired and pinned so the challenge offer appears the moment the
 * BFF half lands — and never before.
 */

/** The response header the platform stamps on (and only on) a step-up rejection. */
export const STEP_UP_SIGNAL_HEADER = 'X-Step-Up-Required';

/** The pre-signal contract, kept as a fallback. Intentionally narrow so it
 *  cannot false-positive on unrelated 403s (an own-domain DENY, a MOD-without-
 *  FORUM refusal — none contain this phrase). */
export const LEGACY_STEP_UP_PATTERN = /requires step-up/i;

/** The shape a signal value must have to be trusted: one of the gates'
 *  `X-<flavour>-StepUp` constants (byte-identical to admin-bff's
 *  `StepUpRequiredException.SAFE_HEADER_NAME`). The value names a REQUEST header
 *  a token-carrying caller would set, so an unvalidated value from a rogue proxy
 *  would be a header-injection vector; anything else is ignored. */
const SAFE_RETRY_HEADER = /^X-[A-Za-z0-9-]{1,60}-StepUp$/;

/** The platform's step-up challenge screen (hugmesh-login-ui `MfaChallengeComponent`,
 *  mounted by the host at `/login`). Takes `?returnTo=<host URL>` and navigates back
 *  to it once `POST /bff/mfa/challenge` has stamped the session. An ABSOLUTE host
 *  route on purpose: it is the login remote's surface, not a path inside this one,
 *  so it resolves under the host shell; the standalone dev shell (`ng serve forum`)
 *  mounts no login remote and cannot follow it. */
export const MFA_CHALLENGE_ROUTE = '/login/mfa/challenge';

/** How a step-up requirement was recognised. */
export type StepUpDetection = 'signal' | 'legacy-phrase';

/** A recognised step-up requirement. */
export interface StepUpRequirement {
  /** The REQUEST header a step-up TOKEN would ride on when retrying, or null when
   *  only the legacy phrase was available. The forum gate has no token leg, so
   *  this remote never sends it — it is carried for diagnostics and fleet parity. */
  readonly retryHeader: string | null;
  readonly via: StepUpDetection;
}

/**
 * The typed rejection {@link import('./forum.service').ForumService} throws for a
 * step-up-gated write the BFF refused with the step-up contract. Extends `Error`
 * so every existing `e instanceof Error ? e.message : …` caller is unaffected.
 */
export class StepUpRequiredError extends Error {
  constructor(
    readonly requirement: StepUpRequirement,
    /** The HTTP status (always 403 for a structured signal). */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StepUpRequiredError';
  }
}

/** The server's error text for an HttpClient failure: `{error}` / `{message}`
 *  JSON bodies and plain-text bodies alike; never Angular's own
 *  "Http failure response for …" wrapper. */
function bodyMessageOf(e: HttpErrorResponse): string {
  const body: unknown = e.error;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const o = body as { error?: unknown; message?: unknown };
    if (typeof o.error === 'string') return o.error;
    if (typeof o.message === 'string') return o.message;
  }
  return '';
}

function messageOf(e: unknown): string {
  if (e instanceof HttpErrorResponse) return bodyMessageOf(e);
  return e instanceof Error ? e.message : typeof e === 'string' ? e : '';
}

/**
 * The single detection seam: prefers the STRUCTURED signal (trusted only on a
 * 403, the only status the platform ever pairs it with), falls back to the
 * legacy phrase. Returns null when `e` is not a step-up rejection at all.
 */
export function stepUpRequirementOf(e: unknown): StepUpRequirement | null {
  if (e instanceof StepUpRequiredError) return e.requirement;
  if (e instanceof HttpErrorResponse && e.status === 403) {
    const signal = e.headers?.get(STEP_UP_SIGNAL_HEADER) ?? null;
    if (signal && SAFE_RETRY_HEADER.test(signal)) {
      return { retryHeader: signal, via: 'signal' };
    }
  }
  if (LEGACY_STEP_UP_PATTERN.test(messageOf(e))) {
    return { retryHeader: null, via: 'legacy-phrase' };
  }
  return null;
}

/** True when `e` is the step-up-required rejection. */
export function isStepUpRequiredError(e: unknown): boolean {
  return stepUpRequirementOf(e) !== null;
}

/**
 * Wrap a transport rejection into a {@link StepUpRequiredError} when it carries
 * the step-up contract; null otherwise (the caller rethrows the original, so a
 * routine 403 / 500 / network error surfaces exactly as before).
 */
export function toStepUpError(e: unknown): StepUpRequiredError | null {
  if (e instanceof StepUpRequiredError) return e;
  const requirement = stepUpRequirementOf(e);
  if (!requirement) return null;
  const status = e instanceof HttpErrorResponse ? e.status : 403;
  const text = messageOf(e) || 'requires step-up';
  return new StepUpRequiredError(requirement, status, text);
}
