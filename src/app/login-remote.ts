import { OutputRef, Type } from '@angular/core';
import { loadRemoteModule } from '@angular-architects/native-federation';

/**
 * Where this remote finds login-ui's federated MFA step-up dialog (issue #3,
 * box 2 — hugmesh-generator#347 decisions 21 and 35).
 *
 * <h2>Decision 21: login-ui federates ONE dialog</h2>
 * The platform's step-up client lives in hugmesh-login-ui and is published as
 * the exposed module `./mfa-step-up` (login-ui `src/app/mfa-step-up.ts`). Forum,
 * mod and wiki load THAT in place instead of each carrying a copy.
 *
 * <h2>Decision 35 = A: the remote entry is HARDCODED</h2>
 * {@link LOGIN_REMOTE_ENTRY} is the one place the login remote's entry URL is
 * spelled in this repo. It is NOT taken from the host's federation manifest, a
 * `window` global or a runtime config: the host shell initialises federation
 * with an EMPTY eager set and parks every remote, so unless the user already
 * visited `/login` this session the two-arg `loadRemoteModule('login', …)`
 * finds nothing registered. The object form with `remoteEntry` initialises the
 * remote itself. A manifest row or a global would be a second source of truth
 * for a path the fe-gateway fixes anyway (`/login/**` -> hugmesh-login-ui), and
 * a runtime-supplied URL would be an injection seam into a security surface.
 * `login-remote.spec.ts` pins the literal.
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
 * The native-federation ESM namespace export is frozen, so a spec cannot spy on
 * `loadRemoteModule` directly; {@link mfaStepUpRemoteLoader.load} is the
 * stubbable seam (same pattern as `forumProfileRemoteLoader`), and takes the
 * loader as an injected default so the spec can assert exactly what is passed.
 */

/** The login remote's entry, as decision 35 hardcodes it: root-relative, so it
 *  resolves against the ORIGIN (the host shell's) and not against this remote's
 *  own mount path. */
export const LOGIN_REMOTE_ENTRY = '/login/remoteEntry.json';

/** The remote name + exposed module, byte-identical to login-ui's exported
 *  `MFA_STEP_UP_REMOTE` (`src/app/mfa-step-up.ts`). A remote name that is not the
 *  remote's own declared `name` registers fine and then fails at load time with
 *  no failed network request to point at, which is why both are pinned here. */
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

/** The three values a federated load is driven by — exported so the spec can
 *  assert the loader passes exactly these and nothing discovered at runtime. */
export const MFA_STEP_UP_LOAD_OPTIONS = {
  remoteEntry: LOGIN_REMOTE_ENTRY,
  remoteName: MFA_STEP_UP_REMOTE.remoteName,
  exposedModule: MFA_STEP_UP_REMOTE.exposedModule,
} as const;

/** The signature of native-federation's `loadRemoteModule` (object form). */
export type RemoteModuleLoader = (options: {
  remoteEntry: string;
  remoteName: string;
  exposedModule: string;
}) => Promise<unknown>;

/**
 * Resolve login-ui's federated step-up component. Rejects when the remote entry
 * cannot be fetched or initialised, or when the module lacks the documented
 * `loadMfaStepUpComponent()` — the caller then degrades to the `?returnTo=` link.
 */
export const mfaStepUpRemoteLoader = {
  load: (
    loader: RemoteModuleLoader = loadRemoteModule as RemoteModuleLoader,
  ): Promise<Type<MfaStepUpComponentLike>> =>
    loader({ ...MFA_STEP_UP_LOAD_OPTIONS }).then((m) => {
      const mod = m as Partial<MfaStepUpModule> | null | undefined;
      if (!mod || typeof mod.loadMfaStepUpComponent !== 'function') {
        throw new Error(`${MFA_STEP_UP_REMOTE.exposedModule} does not export loadMfaStepUpComponent()`);
      }
      return mod.loadMfaStepUpComponent();
    }),
};
