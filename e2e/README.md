# hugmesh-forum-ui — e2e (Playwright + playwright-bdd)

Gherkin/BDD end-to-end harness for the **forum-ui native-federation remote**
(phpBB-backed forum, mounted by the hugmesh.net host at `/social/forum`).
Copied from the proven `hugmesh-games/e2e` + `hugmesh-admin-ui/e2e`
pattern. **PURE TEST CODE** — it does not touch the Angular/karma unit build or
any app code; everything lives under this isolated `e2e/` workspace.

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell + `hugmesh-forum-bff-api` +
headless phpBB + Casdoor seed) is tagged **`@cluster`** at the feature level. The
default `playwright.config.ts` filters `tags: 'not @cluster'`, so the **default
run requires no cluster** — it generates an empty-but-valid runnable set today.
Un-skip a feature by dropping its `@cluster` tag once the env-test-build wiring
lands in a later wave.

`@cluster` (a plain filter tag), **not** playwright-bdd's reserved `@skip`:
`@skip` removes a scenario from *generation* entirely, so a skip-tagged suite
can't be *discovered*. `@cluster` lets a no-filter `bddgen` + `--list` generate
and list every scenario, proving the Gherkin parses, while the default config
keeps them dark.

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
| `forum/branding.feature` | BRANDING — the resolved `ForumBrandService` wordmark ("HugMesh Forum" under Model A) reaches the rendered header |

Surfaces + role gates are grounded against the real components
(`src/app/*.component.html`, `forum.service.ts`, `session.service.ts`):

- `canPost`     = roles ∋ `forum` **or** `admin`
- `canModerate` = roles ∋ `admin` **or** (`mod` **and** `forum`)  — a bare mod is *not* a forum moderator
- `ownsPost`    = roles ∋ `admin` **or** `session.id === post.authorSubject`

## Run offline (what CI does — compile + discover, no browser, no cluster)

```bash
npm ci
npx bddgen                 # compiles features/**/*.feature -> .features-gen/
npx playwright test --list # 0 with the default 'not @cluster' filter (ships dark)
```

Prove every scenario *parses + is discoverable* with a no-filter override config
(the `e2e:bdd` GitLab job does exactly this): generate a temp config without the
`tags` filter, then `bddgen -c` + `playwright test --list -c`. As of the
multi-user journey wave, that lists **87 scenarios across 16 features**.

## Run live (later wave — needs a cluster)

```bash
E2E_BASE_URL=https://your-host:8443 \
E2E_FORUM_USER_PASSWORD=… E2E_ADMIN_PASSWORD=… \
npm run bdd                # bddgen && playwright test
```

Per-user `E2E_<ROLE>_PASSWORD` / shared `E2E_PASSWORD` env vars above are
optional overrides, not requirements: `tests/helpers/roles.ts` (`passwordFor()`)
falls back to the run-state `.e2e-credentials` file written by
hugmesh-generator's `make stack-seed` (`$E2E_CREDENTIALS_FILE`, or a
`.e2e-credentials` found by walking up from cwd). There is no built-in literal
password — if nothing resolves, the suite throws naming `make stack-seed`
rather than silently authenticating with a guessable default.

Per-step PNGs are attached to the HTML report (`results/html`) via the
`AfterStep` hook in `features/support/fixtures.ts`; trace/video retain on failure.
