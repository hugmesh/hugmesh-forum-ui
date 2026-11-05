import { OutputRef, Type } from '@angular/core';

/**
 * Where this remote finds login-ui's federated MFA step-up dialog (issue #3,
 * box 2 — hugmesh-generator#347 decisions 21 and 35), and how it loads it.
 *
 * <h2>Decision 21: login-ui federates ONE dialog</h2>
 * The platform's step-up client lives in hugmesh-login-ui and is published as
 * the exposed module `./mfa-step-up` (login-ui `src/app/mfa-step-up.ts`). Forum,
 * mod and wiki load THAT in place instead of each carrying a copy.
 *
 * <h2>Decision 35 = A: the remote entry is HARDCODED</h2>
 * {@link LOGIN_REMOTE_ENTRY} is the one place the login remote's entry URL is
 * spelled in this repo. It is NOT taken from the host's federation manifest, a
 * `window` global or a runtime config: a manifest row or a global would be a
 * second source of truth for a path the fe-gateway fixes anyway
 * (`/login/**` -> hugmesh-login-ui), and a runtime-supplied URL would be an
 * injection seam into a security surface. `login-remote.spec.ts` pins the
 * literal.
 *
 * <h2>Why NOT `loadRemoteModule` from this bundle (measured 2026-11-04)</h2>
 * `@angular-architects/native-federation` is never a shared external (the
 * builder skips its own runtime), so under the host shell this remote carries
 * its OWN copy of the runtime. That copy's module-scoped `federationPromise` is
 * resolved only by a call to ITS `initFederation`, which under the host nobody
 * makes: a bare `loadRemoteModule({ remoteEntry, … })` from here awaits
 * forever — no request, no rejection, no fallback ("never requested
 * /login/remoteEntry.json" under a host-mounted scratch front door). Calling
 * `initFederation({})` on our copy does not help either: the federation state
 * lives in `globalThis.__NATIVE_FEDERATION__` and was written by the HOST's
 * orchestrator (4.5.2 at the time), whose storage schema this bundle's
 * orchestrator (4.3.0) cannot read — the init flow dies with
 * `TypeError: Cannot read properties of undefined (reading 'startsWith')` on
 * the cached `__NF-HOST__` entry. Host and remotes upgrade independently, so
 * that coupling can never be relied on.
 *
 * What IS stable is the page's import map, owned by the host's es-module-shims
 * instance (`importShim`, shim mode — the same loader every HugMesh UI boots
 * through), and login-ui's `remoteEntry.json` contract (`exposes[].key` /
 * `outFileName`, `shared[].packageName` / `outFileName`). So this loader does
 * what the orchestrator's `initRemoteEntry` does, minus version negotiation:
 * it fetches the entry, maps — SCOPED to `/login/` — only those of login-ui's
 * shared packages the page cannot already resolve (its private `@nf-internal`
 * chunks, a package the host does not share), leaves every resolvable
 * singleton (`@angular/core`, `rxjs`, …) on the host's copy exactly as the
 * orchestrator's `skip` action would, and imports the exposed chunk through
 * `importShim`. Standalone (`ng serve forum`) it is the same code path against
 * this remote's own import map.
 *
 * <h2>What a load returns</h2>
 * The exposed module's `loadMfaStepUpComponent()` resolves the challenge
 * component with login-ui's translation catalog already installed (the
 * recommended entry point — the bare class renders in English). The component
 * emits `satisfied` (the caller's OWN session now carries a fresh `mfa_satisfied`
 * stamp: retry the identical write, no token or header), `dismissed` ("Not
 * now": do not retry) and `unavailable` (the MFA surface answered 503 — ships
 * dark; fall back to the non-MFA path).
 *
 * <h2>Why a holder object</h2>
 * {@link mfaStepUpRemoteLoader.load} is the stubbable seam (same pattern as
 * `forumProfileRemoteLoader`) and takes its I/O as injected defaults so the spec
 * can assert exactly what is fetched, mapped and imported.
 */

/** The login remote's entry, as decision 35 hardcodes it: root-relative, so it
 *  resolves against the ORIGIN (the host shell's) and not against this remote's
 *  own mount path. */
export const LOGIN_REMOTE_ENTRY = '/login/remoteEntry.json';

/** The remote name + exposed module, byte-identical to login-ui's exported
 *  `MFA_STEP_UP_REMOTE` (`src/app/mfa-step-up.ts`). The name is checked against
 *  the entry's declared `name` so a wrong remote at that path is refused. */
export const MFA_STEP_UP_REMOTE = {
  remoteName: 'login',
  exposedModule: './mfa-step-up',
} as const;

/** The outputs this remote wires on login-ui's `MfaStepUpComponent`. Typed
 *  structurally: the class itself is only known at runtime. */
export interface MfaStepUpComponentLike {
  readonly satisfied: OutputRef<void>;
  readonly dismissed: OutputRef<void>;
  readonly unavailable: OutputRef<void>;
}

/** The shape of login-ui's exposed `./mfa-step-up` module, as far as this
 *  remote consumes it. */
export interface MfaStepUpModule {
  loadMfaStepUpComponent(): Promise<Type<MfaStepUpComponentLike>>;
}

/** The slice of a native-federation `remoteEntry.json` this loader reads. */
export interface RemoteEntryInfo {
  name: string;
  exposes: ReadonlyArray<{ key: string; outFileName: string }>;
  shared: ReadonlyArray<{ packageName: string; outFileName: string }>;
}

/** The es-module-shims surface used (`importShim`, shim mode). */
export interface ModuleShim {
  /** Resolves a specifier through the live import map; THROWS when unmapped. */
  resolve(id: string, parentUrl?: string): string;
  addImportMap(map: { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> }): void;
  import(url: string): Promise<unknown>;
}

/** The I/O a load is driven by; every default is the real browser one. */
export interface RemoteLoadDeps {
  fetchEntry: (url: string) => Promise<RemoteEntryInfo>;
  shim: () => ModuleShim;
  /** The document URL the (root-relative) entry resolves against. */
  baseHref: () => string;
}

async function fetchRemoteEntry(url: string): Promise<RemoteEntryInfo> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to fetch remoteEntry at ${url}: ${res.status} ${res.statusText}`);
  const info = (await res.json()) as Partial<RemoteEntryInfo>;
  if (!info || typeof info.name !== 'string' || !Array.isArray(info.exposes) || !Array.isArray(info.shared)) {
    throw new Error(`remoteEntry at ${url} is not a native-federation remote entry`);
  }
  return info as RemoteEntryInfo;
}

function browserShim(): ModuleShim {
  const g = globalThis as { importShim?: ((url: string) => Promise<unknown>) & Omit<ModuleShim, 'import'> };
  const shim = g.importShim;
  if (typeof shim !== 'function' || typeof shim.addImportMap !== 'function' || typeof shim.resolve !== 'function') {
    throw new Error('es-module-shims (importShim, shim mode) is not available on this page');
  }
  return {
    resolve: (id, parent) => shim.resolve(id, parent),
    addImportMap: (m) => shim.addImportMap(m),
    import: (u) => shim(u),
  };
}

export const DEFAULT_REMOTE_LOAD_DEPS: RemoteLoadDeps = {
  fetchEntry: fetchRemoteEntry,
  shim: browserShim,
  baseHref: () => globalThis.location?.href ?? 'http://localhost/',
};

/**
 * Load one exposed module of a native-federation remote by its entry URL,
 * through the page's es-module-shims import map (see the module docs for why
 * this is not `loadRemoteModule`). Exported for the spec; consumers use
 * {@link mfaStepUpRemoteLoader}.
 *
 * @returns the exposed module's namespace.
 */
export async function loadExposedModule(
  entryUrl: string,
  remoteName: string,
  exposedModule: string,
  deps: RemoteLoadDeps = DEFAULT_REMOTE_LOAD_DEPS,
): Promise<unknown> {
  const info = await deps.fetchEntry(entryUrl);
  if (info.name !== remoteName) {
    throw new Error(`remoteEntry at ${entryUrl} declares remote '${info.name}', expected '${remoteName}'`);
  }
  const exposed = info.exposes.find((e) => e.key === exposedModule);
  if (!exposed) {
    throw new Error(`remote '${remoteName}' does not expose '${exposedModule}'`);
  }
  const scopeUrl = new URL('./', new URL(entryUrl, deps.baseHref())).href;
  const shim = deps.shim();
  const scoped: Record<string, string> = {};
  for (const s of info.shared) {
    if (!s.packageName || !s.outFileName) continue;
    let resolvable = true;
    try {
      shim.resolve(s.packageName, scopeUrl);
    } catch {
      resolvable = false;
    }
    if (!resolvable) scoped[s.packageName] = new URL(s.outFileName, scopeUrl).href;
  }
  if (Object.keys(scoped).length > 0) {
    shim.addImportMap({ scopes: { [scopeUrl]: scoped } });
  }
  return shim.import(new URL(exposed.outFileName, scopeUrl).href);
}

/**
 * Resolve login-ui's federated step-up component. Rejects when the remote entry
 * cannot be fetched, names another remote, lacks the exposed module, cannot be
 * imported, or does not carry the documented `loadMfaStepUpComponent()` — the
 * caller then degrades to the `?returnTo=` link.
 */
export const mfaStepUpRemoteLoader = {
  load: (deps: RemoteLoadDeps = DEFAULT_REMOTE_LOAD_DEPS): Promise<Type<MfaStepUpComponentLike>> =>
    loadExposedModule(LOGIN_REMOTE_ENTRY, MFA_STEP_UP_REMOTE.remoteName, MFA_STEP_UP_REMOTE.exposedModule, deps)
      .then((m) => {
        const mod = m as Partial<MfaStepUpModule> | null | undefined;
        if (!mod || typeof mod.loadMfaStepUpComponent !== 'function') {
          throw new Error(`${MFA_STEP_UP_REMOTE.exposedModule} does not export loadMfaStepUpComponent()`);
        }
        return mod.loadMfaStepUpComponent();
      }),
};
