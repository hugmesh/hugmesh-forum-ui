import * as fs from 'node:fs';
import * as path from 'node:path';
import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the forum-ui e2e matrix. Adapted from the
 * proven hugmesh.games/e2e + hugmesh-admin-ui/e2e helper, but keyed to THIS
 * app's session + role model:
 *   - The forum-ui (and its host) persist a {@link HugSession} under the
 *     `hug.session` localStorage key (see src/app/session.service.ts), whose
 *     `roles: string[]` drives every UI gate.
 *   - The forum's gates (src/app/forum.service.ts) are:
 *       canPost      = roles ∋ 'forum'  OR roles ∋ 'admin'
 *                      (admins reach forum surfaces via the gateway admin-bypass)
 *       canModerate  = roles ∋ 'admin'  OR (roles ∋ 'mod' AND roles ∋ 'forum')
 *                      (a BARE mod WITHOUT the forum role is NOT a forum moderator)
 *       ownsPost     = roles ∋ 'admin'  OR session.id === post.authorSubject
 *   The BFF + the headless-phpBB extension are the REAL gates; these flags are
 *   defence-in-depth so the UI never shows an action the role can't use.
 *
 * The catalogue exercises the THREE coverage classes the wave demands:
 *   - USER-SITUATIONAL  — each forum surface, ALLOW + DENY + disabled/helptext.
 *   - MULTIUSER         — owner-vs-moderator edit/delete over the SAME post.
 *   - CROSS-USER        — a non-owner user DENIED on another user's post; a
 *                         domain-A member DENIED on a domain-B forum resource;
 *                         the anonymous (no-session) floor of the DENY matrix.
 *
 * The `kind` tag selects which role-specific assertions a feature drives. The
 * `domain` tag drives the cross-domain isolation scenarios. Passwords resolve
 * via {@link passwordFor}: a per-user override env var, then the shared
 * `process.env.E2E_PASSWORD`, then the run-state credentials file written by
 * hugmesh-generator's `make stack-seed` — there is no literal fallback.
 * `anonymous` carries no session and is seeded with NO hug.session.
 */
export type RoleKind = 'superadmin' | 'admin' | 'forum-mod' | 'forum-user' | 'bare-mod' | 'plain-user' | 'anonymous';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — forum sessions are google- or discord-backed. */
  provider: 'google' | 'discord';
  /** The lowercase Casdoor roles this user carries in `hug.session.roles`. */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
  /** Brand/domain this user belongs to — used by the cross-domain DENY specs. */
  domain?: string;
  /** When true, NO hug.session is seeded (the anonymous DENY floor). */
  anonymous?: boolean;
}

export const SEED_USERS: SeedUser[] = [
  // ── Superadmin — the ROLE_SUPERADMIN row of forum-bff's admin surface
  //    (/bff/forum/admin/** is stepUp(hasAnyRole('ADMIN','SUPERADMIN'))). Spelled
  //    `superadmin` with roles ['superadmin', 'admin'] to match the hugmesh-admin-ui
  //    and hugmesh-mod-ui rosters, so one persona name means one identity across the
  //    UI suites. NOTE: the generator's stack seed names its superadmin
  //    `e2e-superadmin` (tests/e2e-extra-personas.sh, CASDOOR_SUPERADMIN_USERNAME),
  //    and none of this roster's names are seeded by it — see e2e/README.md.
  { username: 'superadmin', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google', roles: ['superadmin', 'admin'], kind: 'superadmin' },

  // ── Admin — reaches every forum surface via the gateway admin-bypass; may
  //    post, moderate (edit/delete ANY post, lock threads), regardless of the
  //    'forum' role. The ALLOW ceiling.
  { username: 'admin', passwordEnv: 'E2E_ADMIN_PASSWORD', provider: 'google', roles: ['admin'], kind: 'admin', domain: 'domain-a' },

  // ── Forum moderator — a mod who ALSO holds the forum role (the ROLE_FORUM_MOD
  //    AND-of-mod+forum the BFF enforces). May post AND moderate others' posts.
  { username: 'forum-mod', passwordEnv: 'E2E_FORUM_MOD_PASSWORD', provider: 'google', roles: ['mod', 'forum'], kind: 'forum-mod', domain: 'domain-a' },

  // ── Forum user — holds the 'forum' role: may view + post + reply + edit/delete
  //    OWN posts, but NOT moderate others'. The everyday participant.
  { username: 'forum-user', passwordEnv: 'E2E_FORUM_USER_PASSWORD', provider: 'discord', roles: ['user', 'forum'], kind: 'forum-user', domain: 'domain-a' },

  // ── Second forum user (same domain) — drives the CROSS-USER ownership matrix:
  //    DENIED edit/delete on forum-user's post (no edit control rendered).
  { username: 'forum-user-2', passwordEnv: 'E2E_FORUM_USER2_PASSWORD', provider: 'google', roles: ['user', 'forum'], kind: 'forum-user', domain: 'domain-a' },

  // ── Bare mod — has 'mod' but NOT 'forum': canModerate is FALSE (a bare mod is
  //    not a forum moderator) AND canPost is FALSE. The subtle DENY: a powerful
  //    role elsewhere that is read-only here.
  { username: 'bare-mod', passwordEnv: 'E2E_BARE_MOD_PASSWORD', provider: 'discord', roles: ['mod'], kind: 'bare-mod', domain: 'domain-a' },

  // ── Plain user — 'user' only, no 'forum' role: may VIEW but the post/reply/
  //    new-topic affordances are hidden and the gated-helptext shows instead.
  { username: 'plain-user', passwordEnv: 'E2E_USER_PASSWORD', provider: 'google', roles: ['user'], kind: 'plain-user', domain: 'domain-a' },

  // ── Domain-B forum user — same role shape as forum-user but a DIFFERENT brand.
  //    Drives the cross-domain isolation specs: DENIED on domain-A forum
  //    resources at the per-brand BFF boundary.
  { username: 'forum-user-domain-b', passwordEnv: 'E2E_FORUM_USER_B_PASSWORD', provider: 'discord', roles: ['user', 'forum'], kind: 'forum-user', domain: 'domain-b' },

  // ── Anonymous — no session at all; the floor of the DENY matrix. Sees the
  //    read-only forum (if the brand makes it public) but no post affordances,
  //    and the BFF rejects every write.
  { username: 'anonymous', passwordEnv: 'E2E_NONE', provider: 'google', roles: [], kind: 'anonymous', anonymous: true },
];

/**
 * Locate the run-state credentials file written by hugmesh-generator's
 * `tests/stack/e2e-password.sh` (`e2e_password_ensure()`): `$E2E_CREDENTIALS_FILE`
 * if set, else a `.e2e-credentials` found by walking up from `process.cwd()`.
 * This repo is a CONSUMER — it never generates the file, only reads it — so an
 * explicit override plus an upward search covers both "run from the repo root"
 * and "run from e2e/" without hardcoding a single relative path.
 */
function findCredentialsFile(): string | undefined {
  const override = process.env['E2E_CREDENTIALS_FILE'];
  if (override) return override;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.e2e-credentials');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Parse the plain `KEY=value` run-state credentials file (no quotes, no
 * `export` keyword — see CONTRACT rule 3). A missing/unreadable file is NOT an
 * error here: it yields an empty map so {@link passwordFor} falls through to
 * its own explicit error instead of an ENOENT stack trace.
 */
function readCredentialsFile(): Record<string, string> {
  const file = findCredentialsFile();
  if (!file) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return values;
}

/**
 * Resolve a seed user's password. Precedence:
 *   1. the per-user override, `process.env[user.passwordEnv]`
 *   2. the shared `process.env.E2E_PASSWORD` (same-run propagation)
 *   3. the run-state credentials file (role-specific key, then `E2E_PASSWORD`)
 * There is no literal fallback (CONTRACT rule 4) — a run with nothing seeded
 * throws, naming `make stack-seed`, rather than silently authenticating with a
 * guessable default.
 */
export function passwordFor(user: SeedUser): string {
  const fromEnv = process.env[user.passwordEnv] ?? process.env['E2E_PASSWORD'];
  if (fromEnv) return fromEnv;

  const creds = readCredentialsFile();
  const fromFile = creds[user.passwordEnv] ?? creds['E2E_PASSWORD'];
  if (fromFile) return fromFile;

  throw new Error(
    `No e2e password resolved for seed user "${user.username}" ` +
      `(checked process.env.${user.passwordEnv}, process.env.E2E_PASSWORD, and the ` +
      'run-state credentials file — $E2E_CREDENTIALS_FILE or .e2e-credentials ' +
      'walked up from cwd). Run `make stack-seed` in hugmesh-generator first: it ' +
      'generates the e2e password and writes .e2e-credentials for consumers like this suite.',
  );
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `hug.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE Casdoor + host shell, so it is only
 * exercised by scenarios tagged `@cluster` today (wave 2b ships dark). It is
 * written now so a later wave can un-skip a feature without rewriting steps.
 *
 * The forum-ui's host shell renders the login micro-frontend; on success the
 * SessionService writes `hug.session` (see set()/broadcast()) and the gateway
 * sets the HttpOnly `bff_` session cookie on the context — the browser holds NO
 * bearer token (post-#18). We wait for `hug.session` to carry the post-#18
 * shape (a `roles` array) so a follow-up guarded navigation doesn't race the
 * write; every real write/DENY thereafter authenticates via the `bff_` cookie
 * the context now carries (credentials: 'include'), never a synthetic bearer.
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // login-ui's form (login.component.html) is template-driven and carries NO
  // formControlName; its selector contract is data-testid login-username /
  // login-password / login-submit. The old formControlName-attribute input and
  // login-btn class selectors matched nothing (measured 2026-09-23 against the
  // compose stack: the username wait timed out on every "is logged in" row).
  await page.locator('[data-testid="login-username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('[data-testid="login-username"]', user.username);
  await page.fill('[data-testid="login-password"]', passwordFor(user));
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return false;
      try {
        // Post-#18 HugSession carries no bffToken (auth is the HttpOnly bff_
        // cookie); a resolved session is proven by the roles array being present.
        return Array.isArray(JSON.parse(raw).roles);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Seed a {@link HugSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes (see
 * src/app/session.service.ts), so the forum's canPost / canModerate / ownsPost
 * gates behave exactly as in production. Used by the offline/dark scenarios that
 * assert pure client-side gate behaviour (skip-link focus, hidden affordances,
 * gated helptext) without needing the BFF.
 *
 * An `anonymous` user is seeded with NO session (the addInitScript clears the
 * key) so the anonymous DENY floor renders the read-only, no-affordance view.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  if (user.anonymous) {
    await page.addInitScript(() => {
      window.localStorage.removeItem('hug.session');
    });
    return;
  }
  // Mirrors the real post-#18 HugSession shape EXACTLY (src/app/session.service.ts):
  // id/label/provider/roles/registrationComplete — NO bffToken (auth is the
  // HttpOnly bff_ cookie the browser can't read). Seeded sessions drive pure
  // client-side gate behaviour only; real writes use login() + the real cookie.
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['hug.session', JSON.stringify(session)] as const,
  );
}

/** The author-subject string the forum stamps on a seed user's posts — matches
 *  the `id` field seedSession() writes, which forum.service.ownsPost() compares
 *  against post.authorSubject. */
export function subjectOf(user: SeedUser): string {
  return `${user.provider}:${user.username}@example.test`;
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's gate check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('hug.session'));
}
