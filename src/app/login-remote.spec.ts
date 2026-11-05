import { output } from '@angular/core';

import {
  LOGIN_REMOTE_ENTRY,
  MFA_STEP_UP_LOAD_OPTIONS,
  MFA_STEP_UP_REMOTE,
  RemoteModuleLoader,
  mfaStepUpRemoteLoader,
} from './login-remote';

/** Stands in for login-ui's MfaStepUpComponent class. */
class StubChallenge {
  readonly satisfied = output<void>();
  readonly dismissed = output<void>();
  readonly unavailable = output<void>();
}

/**
 * The decision-35 pin (hugmesh-generator#347, operator 2026-09-17: "A — the
 * remote entry is hardcoded"). A change to the literal, or a loader that stops
 * passing it, must fail here before it can reach the mocked e2e lane.
 */
describe('login remote (decisions 21/35 consumer)', () => {
  it('hardcodes the login remote entry as /login/remoteEntry.json', () => {
    // Widened to string on purpose: with the `as const` literal type a wrong
    // value would be a COMPILE error, and the mutation check wants a red spec.
    expect<string>(LOGIN_REMOTE_ENTRY).toBe('/login/remoteEntry.json');
  });

  it("names login-ui's remote and exposed module exactly as login-ui exports them", () => {
    // login-ui src/app/mfa-step-up.ts: MFA_STEP_UP_REMOTE = { remoteName: 'login', exposedModule: './mfa-step-up' }
    expect<Record<string, string>>(MFA_STEP_UP_REMOTE).toEqual({ remoteName: 'login', exposedModule: './mfa-step-up' });
  });

  it('drives the load from the hardcoded entry and nothing else', async () => {
    const loader = jasmine.createSpy<RemoteModuleLoader>('loadRemoteModule').and.resolveTo({
      loadMfaStepUpComponent: () => Promise.resolve(StubChallenge),
    });
    const cmp = await mfaStepUpRemoteLoader.load(loader);
    expect(cmp).toBe(StubChallenge);
    expect(loader).toHaveBeenCalledOnceWith({
      remoteEntry: '/login/remoteEntry.json',
      remoteName: 'login',
      exposedModule: './mfa-step-up',
    });
    // The exported options object is the same triple (consumers may read it).
    expect<Record<string, string>>(MFA_STEP_UP_LOAD_OPTIONS).toEqual({
      remoteEntry: '/login/remoteEntry.json',
      remoteName: 'login',
      exposedModule: './mfa-step-up',
    });
  });

  it('resolves through loadMfaStepUpComponent(), the catalog-aware entry point', async () => {
    const loadMfaStepUpComponent = jasmine.createSpy('loadMfaStepUpComponent').and.resolveTo(StubChallenge);
    const loader = jasmine.createSpy<RemoteModuleLoader>('loadRemoteModule').and.resolveTo({ loadMfaStepUpComponent });
    await mfaStepUpRemoteLoader.load(loader);
    expect(loadMfaStepUpComponent).toHaveBeenCalledTimes(1);
  });

  it('rejects when the remote entry cannot be loaded (the caller degrades to the returnTo link)', async () => {
    const loader = jasmine.createSpy<RemoteModuleLoader>('loadRemoteModule').and.rejectWith(new Error('fetch failed'));
    await expectAsync(mfaStepUpRemoteLoader.load(loader)).toBeRejectedWithError('fetch failed');
  });

  it('rejects when the module does not carry the documented contract', async () => {
    const loader = jasmine.createSpy<RemoteModuleLoader>('loadRemoteModule').and.resolveTo({ somethingElse: 1 });
    await expectAsync(mfaStepUpRemoteLoader.load(loader)).toBeRejectedWithError(/loadMfaStepUpComponent/);
  });
});
