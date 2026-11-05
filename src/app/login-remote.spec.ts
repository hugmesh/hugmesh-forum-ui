import { output } from '@angular/core';

import {
  LOGIN_REMOTE_ENTRY,
  MFA_STEP_UP_REMOTE,
  ModuleShim,
  RemoteEntryInfo,
  RemoteLoadDeps,
  loadExposedModule,
  mfaStepUpRemoteLoader,
} from './login-remote';

/** Stands in for login-ui's MfaStepUpComponent class. */
class StubChallenge {
  readonly satisfied = output<void>();
  readonly dismissed = output<void>();
  readonly unavailable = output<void>();
}

const ORIGIN = 'https://mesh.example.test';

/** login-ui's remoteEntry.json as built on 2026-11-04 (the slice this loader reads). */
function loginEntry(over: Partial<RemoteEntryInfo> = {}): RemoteEntryInfo {
  return {
    name: 'login',
    exposes: [
      { key: './routes', outFileName: 'routes-SDL34TF2.js' },
      { key: './mfa-step-up', outFileName: 'mfa-step-up-VVLGMEOE.js' },
    ],
    shared: [
      { packageName: '@angular/core', outFileName: '_angular_core.IJmxGu1tvY.js' },
      { packageName: '@angular/forms', outFileName: '_angular_forms.kwe4g4QEuD.js' },
      { packageName: 'rxjs', outFileName: 'rxjs.abc.js' },
      { packageName: '@nf-internal/chunk-KNUKVBCT', outFileName: 'chunk-KNUKVBCT.js' },
    ],
    ...over,
  };
}

/** A fake importShim whose live map already resolves the HOST's singletons. */
function fakeShim(resolvable: string[], moduleNamespace: unknown = { loadMfaStepUpComponent: () => Promise.resolve(StubChallenge) }) {
  const added: Parameters<ModuleShim['addImportMap']>[0][] = [];
  const imported: string[] = [];
  const shim: ModuleShim = {
    resolve: (id) => {
      if (resolvable.includes(id)) return `${ORIGIN}/host/${id}.js`;
      throw new Error(`Unable to resolve specifier '${id}'`);
    },
    addImportMap: (m) => { added.push(m); },
    import: async (url) => { imported.push(url); return moduleNamespace; },
  };
  return { shim, added, imported };
}

function deps(over: Partial<RemoteLoadDeps> = {}, entry: RemoteEntryInfo = loginEntry()): RemoteLoadDeps & { fetched: string[] } {
  const fetched: string[] = [];
  const { shim } = fakeShim(['@angular/core', 'rxjs']);
  return {
    fetched,
    fetchEntry: async (url) => { fetched.push(url); return entry; },
    shim: () => shim,
    baseHref: () => `${ORIGIN}/social/forum/topics/77`,
    ...over,
  };
}

/**
 * The decision-35 pin (hugmesh-generator#347, operator 2026-09-17: "A — the
 * remote entry is hardcoded"). A change to the literal, or a loader that stops
 * fetching it, must fail here before it can reach the mocked e2e lane.
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

  it('fetches the hardcoded entry — root-relative, never relative to this remote\'s mount path', async () => {
    const d = deps();
    const cmp = await mfaStepUpRemoteLoader.load(d);
    expect(cmp).toBe(StubChallenge);
    expect(d.fetched).toEqual(['/login/remoteEntry.json']);
  });

  it("imports login-ui's './mfa-step-up' chunk from the entry's own directory", async () => {
    const { shim, imported } = fakeShim(['@angular/core', 'rxjs']);
    await mfaStepUpRemoteLoader.load(deps({ shim: () => shim }));
    expect(imported).toEqual([`${ORIGIN}/login/mfa-step-up-VVLGMEOE.js`]);
  });

  it('maps ONLY the shared packages the page cannot resolve, scoped to /login/, and leaves the host\'s singletons alone', async () => {
    const { shim, added } = fakeShim(['@angular/core', 'rxjs']);
    await mfaStepUpRemoteLoader.load(deps({ shim: () => shim }));
    expect(added).toEqual([{
      scopes: {
        [`${ORIGIN}/login/`]: {
          '@angular/forms': `${ORIGIN}/login/_angular_forms.kwe4g4QEuD.js`,
          '@nf-internal/chunk-KNUKVBCT': `${ORIGIN}/login/chunk-KNUKVBCT.js`,
        },
      },
    }]);
  });

  it('adds no import map at all when every shared package already resolves', async () => {
    const { shim, added, imported } = fakeShim(['@angular/core', '@angular/forms', 'rxjs', '@nf-internal/chunk-KNUKVBCT']);
    await mfaStepUpRemoteLoader.load(deps({ shim: () => shim }));
    expect(added).toEqual([]);
    expect(imported.length).toBe(1);
  });

  it('resolves through loadMfaStepUpComponent(), the catalog-aware entry point', async () => {
    const loadMfaStepUpComponent = jasmine.createSpy('loadMfaStepUpComponent').and.resolveTo(StubChallenge);
    const { shim } = fakeShim(['@angular/core'], { loadMfaStepUpComponent });
    await mfaStepUpRemoteLoader.load(deps({ shim: () => shim }));
    expect(loadMfaStepUpComponent).toHaveBeenCalledTimes(1);
  });

  it('rejects when the remote entry cannot be fetched (the caller degrades to the returnTo link)', async () => {
    const d = deps({ fetchEntry: () => Promise.reject(new Error('fetch failed')) });
    await expectAsync(mfaStepUpRemoteLoader.load(d)).toBeRejectedWithError('fetch failed');
  });

  it("rejects when the entry at /login/ declares another remote's name", async () => {
    const d = deps({}, loginEntry({ name: 'not-login' }));
    await expectAsync(mfaStepUpRemoteLoader.load(d)).toBeRejectedWithError(/declares remote 'not-login', expected 'login'/);
  });

  it('rejects when login-ui does not expose ./mfa-step-up', async () => {
    const d = deps({}, loginEntry({ exposes: [{ key: './routes', outFileName: 'routes-SDL34TF2.js' }] }));
    await expectAsync(mfaStepUpRemoteLoader.load(d)).toBeRejectedWithError(/does not expose '\.\/mfa-step-up'/);
  });

  it('rejects when the module does not carry the documented contract', async () => {
    const { shim } = fakeShim(['@angular/core'], { somethingElse: 1 });
    await expectAsync(mfaStepUpRemoteLoader.load(deps({ shim: () => shim }))).toBeRejectedWithError(/loadMfaStepUpComponent/);
  });

  it('rejects when the exposed chunk fails to import', async () => {
    const { shim } = fakeShim(['@angular/core']);
    shim.import = () => Promise.reject(new Error('import failed'));
    await expectAsync(mfaStepUpRemoteLoader.load(deps({ shim: () => shim }))).toBeRejectedWithError('import failed');
  });

  it('loadExposedModule resolves the entry against the document URL (an absolute entry stays absolute)', async () => {
    const { shim, imported } = fakeShim(['@angular/core', '@angular/forms', 'rxjs', '@nf-internal/chunk-KNUKVBCT']);
    const d = deps({ shim: () => shim });
    await loadExposedModule('https://other.example.test/login/remoteEntry.json', 'login', './mfa-step-up', d);
    expect(d.fetched).toEqual(['https://other.example.test/login/remoteEntry.json']);
    expect(imported).toEqual(['https://other.example.test/login/mfa-step-up-VVLGMEOE.js']);
  });
});
