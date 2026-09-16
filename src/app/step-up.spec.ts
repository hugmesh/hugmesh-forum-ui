import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import {
  LEGACY_STEP_UP_PATTERN,
  STEP_UP_SIGNAL_HEADER,
  StepUpRequiredError,
  isStepUpRequiredError,
  stepUpRequirementOf,
  toStepUpError,
} from './step-up';

/** An HttpClient rejection as the generated ng-openapi-gen client surfaces it. */
function httpError(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: status === 403 ? 'Forbidden' : 'Error',
    url: '/bff/forum/moderation/topics/10',
    error: body,
    headers: new HttpHeaders(headers),
  });
}

/**
 * The DETECTION unit. Mirrors hugmesh-admin-ui `mfa/step-up-error.spec.ts` so the
 * two remotes recognise the platform's step-up 403 identically.
 */
describe('step-up contract detection', () => {
  it('recognises the STRUCTURED signal on a 403 and names the retry header', () => {
    const e = httpError(403, { error: 'moderation requires step-up re-authentication' },
      { [STEP_UP_SIGNAL_HEADER]: 'X-Forum-StepUp' });
    expect(stepUpRequirementOf(e)).toEqual({ retryHeader: 'X-Forum-StepUp', via: 'signal' });
    expect(isStepUpRequiredError(e)).toBeTrue();
  });

  it('falls back to the LEGACY phrase when an old BFF sends no signal header', () => {
    const e = httpError(403, { error: 'lock requires step-up re-authentication' });
    expect(stepUpRequirementOf(e)).toEqual({ retryHeader: null, via: 'legacy-phrase' });
  });

  it('reads the legacy phrase off a {message} body and off a plain-text body too', () => {
    expect(isStepUpRequiredError(httpError(403, { message: 'this requires step-up' }))).toBeTrue();
    expect(isStepUpRequiredError(httpError(403, 'requires step-up'))).toBeTrue();
  });

  it('does NOT fire on an ordinary 403 (a routine authz DENY must never pop an MFA prompt)', () => {
    // The forum BFF's role refusals and the gateway's X-Route-Denied carry neither contract.
    expect(stepUpRequirementOf(httpError(403, { error: 'forbidden' }))).toBeNull();
    expect(stepUpRequirementOf(httpError(403, null))).toBeNull();
    expect(stepUpRequirementOf(httpError(403, '', { 'X-Route-Denied': 'fe:/bff/forum/moderation/topics/10' }))).toBeNull();
  });

  it('trusts the signal header ONLY on a 403 — a stray header on a 500 is ignored', () => {
    const e = httpError(500, { error: 'boom' }, { [STEP_UP_SIGNAL_HEADER]: 'X-Forum-StepUp' });
    expect(stepUpRequirementOf(e)).toBeNull();
  });

  it('ignores a signal value that is not a gate constant (header-injection guard)', () => {
    const e = httpError(403, { error: 'nope' }, { [STEP_UP_SIGNAL_HEADER]: 'Authorization' });
    expect(stepUpRequirementOf(e)).toBeNull();
    const e2 = httpError(403, { error: 'nope' }, { [STEP_UP_SIGNAL_HEADER]: 'X-Evil StepUp' });
    expect(stepUpRequirementOf(e2)).toBeNull();
  });

  it('does not mistake Angular\'s own "Http failure response" wrapper for the phrase', () => {
    const e = httpError(403, null);
    expect(LEGACY_STEP_UP_PATTERN.test(e.message)).toBeFalse();
    expect(stepUpRequirementOf(e)).toBeNull();
  });

  it('is transparent to plain Errors and strings carrying the phrase (fleet parity)', () => {
    expect(isStepUpRequiredError(new Error('image build requires step-up'))).toBeTrue();
    expect(isStepUpRequiredError('requires step-up')).toBeTrue();
    expect(isStepUpRequiredError(new Error('boom'))).toBeFalse();
    expect(isStepUpRequiredError(undefined)).toBeFalse();
  });

  describe('toStepUpError', () => {
    it('wraps a step-up rejection into a typed, instanceof-checkable Error', () => {
      const e = httpError(403, { error: 'requires step-up' }, { [STEP_UP_SIGNAL_HEADER]: 'X-Forum-StepUp' });
      const wrapped = toStepUpError(e)!;
      expect(wrapped).toBeInstanceOf(StepUpRequiredError);
      expect(wrapped).toBeInstanceOf(Error);
      expect(wrapped.status).toBe(403);
      expect(wrapped.message).toBe('requires step-up');
      expect(wrapped.requirement.via).toBe('signal');
      // Idempotent: re-wrapping hands back the same instance.
      expect(toStepUpError(wrapped)).toBe(wrapped);
      expect(stepUpRequirementOf(wrapped)).toEqual(wrapped.requirement);
    });

    it('returns null for anything else so the caller rethrows the ORIGINAL rejection', () => {
      expect(toStepUpError(httpError(403, { error: 'forbidden' }))).toBeNull();
      expect(toStepUpError(new Error('offline'))).toBeNull();
    });
  });
});
