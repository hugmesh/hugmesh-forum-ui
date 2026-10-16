# hugmesh-forum-ui — e2e (Playwright + playwright-bdd)

Gherkin/BDD end-to-end harness for the **forum-ui native-federation remote** (the
phpBB-backed forum, mounted by the hugmesh.net host at `/social/forum`). It copies the
`hugmesh-games/e2e` and `hugmesh-admin-ui/e2e` pattern. It is **test code only**. It
does not touch the Angular/Karma unit build or any app code, and it all lives in this
isolated `e2e/` workspace.

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell + `hugmesh-forum-bff-api` +
headless phpBB + Casdoor seed) carries the **`@cluster`** tag at the feature level.
The default `playwright.config.ts` filters `tags: 'not @cluster'`, so the **default
run needs no cluster**. Today it generates an empty but valid set. To turn a feature
on, drop its `@cluster` tag once the env-test-build wiring lands in a later wave.

The tag is `@cluster`, a plain filter tag, **not** playwright-bdd's reserved `@skip`.
`@skip` removes a scenario from *generation*, so a suite tagged `@skip` cannot be
*discovered*. With `@cluster`, a no-filter `bddgen` plus `--list` generates and lists
every scenario, which proves the Gherkin parses, while the default config keeps them
dark.

## Coverage

| Feature | Class |
| --- | --- |
| `forum/role-gated-surfaces.feature` | USER-SITUATIONAL — ALLOW + DENY + gated helptext (canPost: `forum`/`admin`) |
| `forum/moderation-and-ownership.feature` | MULTIUSER (author vs forum-mod vs admin) + CROSS-USER (non-owner DENIED edit/delete, two isolated contexts) |
| `forum/cross-domain-isolation.feature` | CROSS-USER multi-tenant — anonymous floor + per-brand BFF DENY (domain-B → domain-A) |
| `forum/vn-profile.feature` | VN layer basics — editor entry point, skin/sprite render, sticker insert + 8/post cap, read-aloud toggle, sticker-endpoint fail-soft |
| `forum/vn-combination.feature` | VN COMBINATION sweep — 5 skins × accent on/off at the post-card boundary, sticker token counts (0/1/8/9-capped/malformed/code-block), full skin × voice editor save matrix asserting the PUT payload, read-aloud exclusivity, VN-lookup-outage fail-soft, Escape/focus-return + sticker-picker keyboard a11y, phone/tablet no-h-scroll + 44px touch targets |
| `a11y/accessibility.feature` | skip-link → `#main-content`, named landmarks/regions, `role="search"`, pagination keyboard reachability + focus restore |
| `forum/reply-visibility.feature` | MULTIUSER CONSEQUENCE — one user's REAL reply becomes visible to a second identity; interleaved replies keep chronological order |
| `forum/post-lifecycle.feature` | MULTIUSER CONSEQUENCE — owner edit → `(edited)` marker seen by a second reader; owner delete → gone for both; moderator deletes a victim's post (victim-creates-first) |
| `forum/moderation-consequence.feature` | MULTIUSER CONSEQUENCE — a moderator lock/unlock adds/removes the author's reply form; bare-mod and plain-user see no lock control |
| `forum/create-topic-journey.feature` | MULTIUSER — full create journey (form → POST → navigate) plus cross-user reach: a second identity finds the topic via search |
| `forum/vn-cross-user.feature` | MULTIUSER — the author's saved voicebox skin/sprite as rendered in ANOTHER reader's page; the reader's own posts stay `classic` |
| `forum/profile-embed.feature` | MULTIUSER — author link → the federated user remote's `./profile` fragment; the remote-unreachable error alert |
| `forum/announcements.feature` | MULTIUSER — published forum announcement seen by a logged-in user, dismiss-once persistence, pinned (non-dismissible) variant, anonymous sees none |
| `forum/ban-consequence.feature` | MULTIUSER CONSEQUENCE — a banned user's reply is rejected LOUDLY via the `aria-live` outcome region, never silently dropped |
| `forum/role-change-mid-session.feature` | MULTIUSER-REACTIVE — role revoke/grant broadcast over `hug.session` + `hug-session-change` re-gates affordances WITHOUT a reload |
| `forum/moderation-step-up.feature` | MOCKED + ARMED — the topic page offers the platform's MFA challenge when the BFF refuses a lock/unlock with `X-Step-Up-Required`, and never on a plain role 403; the armed lane (`MFA_STEPUP_ARMED=1`) checks the real BFF's refusal on `/bff/forum/admin/**` and `/bff/forum/moderation/**`. One scenario (challenge loaded in place) is `@fixme` and fails until forum-ui issue #3 box 2 lands |
| `forum/branding.feature` | BRANDING — the resolved `ForumBrandService` wordmark ("HugMesh Forum" under Model A) reaches the rendered header |

Surfaces and role gates come from the real components (`src/app/*.component.html`,
`forum.service.ts`, `session.service.ts`):

- `canPost`     = roles ∋ `forum` **or** `admin`
- `canModerate` = roles ∋ `admin` **or** (`mod` **and** `forum`)  — a bare mod is *not* a forum moderator
- `ownsPost`    = roles ∋ `admin` **or** `session.id === post.authorSubject`

Session-seeding coupling (issue #3 item 2): `SessionService` re-reads the
authoritative `GET /bff/session` on construction and on every `hug-session-change`
broadcast that leaves a `hug.session` mirror behind. When that probe answers 200, the
cookie's roles WIN over the mirror. So the mirror-rewrite step (`"... has their roles
rewritten to ..."` in `features/steps/multiuser-steps.ts`) holds only for identities
that `have a seeded session`: they have no `bff_` cookie, the probe 401s, and the
rewritten mirror stands. Do not combine that step with a REAL login in one scenario.
The cookie's real roles would override the rewrite on the broadcast the step fires.

## Run offline (what CI does: compile and discover, no browser, no cluster)

```bash
npm ci
npx bddgen                 # compiles features/**/*.feature -> .features-gen/
npx playwright test --list # 0 tests with the default 'not @cluster' filter (ships dark); exits 1 with "No tests found"
```

To prove every scenario *parses and is discoverable*, use a no-filter override config
(the `e2e:bdd` GitLab job does exactly this): generate a temp config without the
`tags` filter, then run `bddgen -c` and `playwright test --list -c`. That lists **103 tests across 17 feature files** (counted 2026-10-07; outline rows count as tests).

## Run live (later wave; needs a cluster)

```bash
E2E_BASE_URL=https://your-host:8443 \
E2E_FORUM_USER_PASSWORD=… E2E_ADMIN_PASSWORD=… \
npm run bdd                # bddgen && playwright test
```

The per-user `E2E_<ROLE>_PASSWORD` and shared `E2E_PASSWORD` variables are optional
overrides. `tests/helpers/roles.ts` (`passwordFor()`) falls back to the run-state
`.e2e-credentials` file that hugmesh-generator's `make stack-seed` writes
(`$E2E_CREDENTIALS_FILE`, or a `.e2e-credentials` found by walking up from the
working directory). There is no built-in password. If nothing resolves, the suite
throws and names `make stack-seed`, rather than sign in with a guessable default.

**A live run needs two things this suite does not provide** (measured 2026-09-23
against the generator's compose stack at `https://localhost:8488`):

- **This suite's personas are not the ones the generator seeds.** `POST /bff/login`
  answered `401 "The user: hugmesh/<name> doesn't exist"` for `admin`,
  `forum-mod`, `forum-user`, `forum-user-2`, `bare-mod`, `plain-user` and
  `superadmin` from this roster, while the
  generator's own personas (`e2e-admin`, `e2e-mod`, `e2e-user`, `e2e-forum`,
  `e2e-superadmin` — `tests/stack/seed-e2e.sh`, `tests/e2e-extra-personas.sh`,
  and `tests/qemu/seed-accounts.sh` for `e2e-forum`, which holds `ROLE_FORUM`
  and `ROLE_USER`) logged in. Nothing in hugmesh-generator seeds this roster's names, so every
  `"X" is logged in` row needs those accounts provisioned (or a name mapping) first.
  No seeded persona holds both `ROLE_MOD` and `ROLE_FORUM`.
- **A seeded session alone cannot load this remote behind the real gateway.**
  `/social/forum/remoteEntry.json` answered `401` without a `bff_` cookie (the
  fe-gateway row for `/social/forum/**` is `ROLE_FORUM`). A `has a seeded session`
  row writes only the `hug.session` mirror, so it needs a real session cookie in the
  same browser context before the host shell can mount the forum.

`login()` in `tests/helpers/roles.ts` drives login-ui's selector contract (`data-testid`
`login-username` / `login-password` / `login-submit`). The earlier `formControlName` /
`.login-btn` selectors matched nothing on the current login form.

The `AfterStep` hook in `features/support/fixtures.ts` attaches a PNG of each step to
the HTML report (`results/html`). Trace and video are kept on failure.
