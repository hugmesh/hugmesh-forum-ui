// Session / login / navigation + forum-surface step definitions backing the
// forum-ui features.
//
// Two flavours of "present":
//   - `Given "X" is logged in`         — full Casdoor round-trip via login()
//     (LIVE; only reached by @cluster scenarios in wave 2b).
//   - `Given "X" has a seeded session` — writes hug.session directly via an
//     addInitScript (OFFLINE-capable; exercises the pure client-side gate
//     behaviour the forum enforces with canPost/canModerate/ownsPost). An
//     `anonymous` user is seeded with NO session.
//
// The navigation + affordance steps assert the gate outcome on the REAL markup
// (data-testids grounded against src/app/*.component.html): the post/reply/
// new-topic affordances render (ALLOW) or are absent + a gated-helptext shows
// (DENY). Route-rendering steps live in @cluster features today because they
// need the host shell to be serving the remote; bddgen still compiles them so
// `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  // addInitScript must run BEFORE the first navigation, so register the page and
  // seed; the navigation step that follows picks the session up on load.
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} is anonymous', async ({ page, user }, username: string) => {
  // The anonymous floor: no hug.session is written. Same wiring as a seeded
  // session so the navigation step can run unchanged.
  const u: SeedUser = user(username);
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix: give each user an isolated context so two identities can
  // coexist in one scenario without sharing localStorage.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u: SeedUser = user(username);
  const page = pageRegistry.get(u.username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

// ── Forum surface assertions (grounded in the real component markup) ─────────

Then('{string} sees the forum index heading', async ({ user }, username: string) => {
  // forum-index.component.html renders <h1>{{ brand.forumName }}</h1>.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator('h1')).toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the categories region', async ({ user }, username: string) => {
  // The read-only surface every authenticated AND anonymous viewer reaches.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator('section.forum-categories[role="region"]')).toBeVisible();
});

// ── Affordance ALLOW (the control renders) ───────────────────────────────────

Then('{string} sees the {string} control', async ({ user }, username: string, testid: string) => {
  // ALLOW: canPost / ownsPost passed so the affordance is in the DOM and visible.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the {string} control enabled', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
});

// ── Affordance DENY (the control is NOT rendered) ────────────────────────────

Then('{string} does not see the {string} control', async ({ user }, username: string, testid: string) => {
  // DENY: the @if (canPost()) / @if (canEdit(p)) block never rendered, so the
  // affordance is absent from the DOM entirely — defence-in-depth visibility.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── Disabled + helptext (the ALLOW-but-restricted / gated surface) ───────────

Then('{string} sees the {string} gated helptext', async ({ user }, username: string, testid: string) => {
  // create-topic.component.html renders [data-testid="create-gated"] and
  // topic-detail.component.html renders [data-testid="reply-gated"] — the
  // "you need the forum role" message shown INSTEAD of the form/affordance.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible();
});

Then('the {string} control is disabled', async ({ user }, username: string, testid: string) => {
  // e.g. the reply-submit / topics-prev buttons carry [disabled] bindings.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeDisabled();
});

// ── Locked-topic notice ──────────────────────────────────────────────────────

Then('{string} sees the locked-topic notice', async ({ user }, username: string) => {
  // topic-detail.component.html: @if (d.topic.locked) renders
  // <p class="topic__locked" role="status">. The reply form is suppressed.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator('p.topic__locked[role="status"]')).toBeVisible();
});

// ── API-level cross-user / cross-domain / anonymous DENY ─────────────────────
// The UI affordance is display-only; the forum-bff (wrapping headless phpBB) is
// the real gate. Post-#18 auth is the HttpOnly `bff_` session cookie the gateway
// sets on a real login and swaps into a server-side Bearer — the browser holds
// no token. So these steps fire a SAME-ORIGIN fetch with `credentials: 'include'`
// (the cookie rides automatically for a logged-in context) and NO synthetic
// Authorization header. A cross-user/cross-domain caller must therefore be a
// REAL login ("… is logged in"); an anonymous context carries no cookie, so its
// write is the unauthenticated DENY. (@cluster — needs a live BFF + gateway.)

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => (await fetch(url, { credentials: 'include' })).status,
    path,
  );
});

When('{string} POSTs to {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'e2e probe' }),
      });
      return r.status;
    },
    path,
  );
});

When('the unauthenticated client POSTs to {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'e2e probe' }),
    });
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

Then('the response status is one of {int} or {int}', async ({}, a: number, b: number) => {
  expect([a, b]).toContain(responseState.lastStatus);
});
