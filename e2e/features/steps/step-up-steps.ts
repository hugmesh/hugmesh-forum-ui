// Step definitions backing features/forum/moderation-step-up.feature — the
// platform step-up contract on the forum's moderation writes (hugmesh-forum-ui#3).
//
// MOCKED lane: page.route() answers GET /bff/forum/topics/{id} with a real
// TopicDetail shape (forum.service.ts) and POST /bff/forum/moderation/topics/{id}
// with the wire shapes hugmesh-forum-bff-api documents on origin/main (52a2866):
//   refusal 403 + `X-Step-Up-Required: X-Forum-StepUp` + `{error:"… requires step-up"}`
//   bare    403 with no header and no phrase (a role denial)
// ARMED lane: a real fetch against the live forum-bff, gated on MFA_STEPUP_ARMED=1
// so an unarmed stack reports WHY instead of passing vacuously.
//
// NOT mocked on purpose: GET /bff/session. The README's session-seeding
// coupling says a 200 there lets the cookie's roles override the seeded mirror —
// a seeded persona has no cookie, so the real probe 401s and the mirror stands.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** Every moderation write the page actually sent per topic id — the oracle for
 *  "sent exactly once" (the offer must not itself retry). */
const modWrites = new Map<number, number>();

/** Every request each page made for login-ui's remote entry — the oracle for the
 *  decision-35 consumer (box 2 of #3): the topic page must fetch the HARDCODED
 *  `/login/remoteEntry.json` when it offers the challenge. Keyed by persona. */
const loginEntryRequests = new Map<string, string[]>();

/** The login remote entry, as decision 35 hardcodes it. Matches any origin. */
const LOGIN_REMOTE_ENTRY_GLOB = '**/login/remoteEntry.json';

/** The last capturing fetch: status + the step-up signal header, or null. */
const captured = { status: 0, signal: null as string | null };

const MFA_STEPUP_ARMED = process.env.MFA_STEPUP_ARMED === '1';

// ── Mocks ──────────────────────────────────────────────────────────────────

Given('the forum serves the unlocked topic {int} to {string}', async ({ user }, id: number, username: string) => {
  const page = pageOf(user(username).username);
  const author = 'google:forum-user@example.test';
  const detail = {
    topic: {
      id, categoryId: 1, title: `Step-up probe topic ${id}`, authorSubject: author, authorLabel: 'forum-user',
      replyCount: 1, viewCount: 3, locked: false, createdAt: '2026-09-23T00:00:00Z',
    },
    posts: [{
      id: id * 100 + 1, topicId: id, authorSubject: author, authorLabel: 'forum-user',
      bodyHtml: '<p>Opening post (mocked forum-bff).</p>', createdAt: '2026-09-23T00:00:00Z', editedAt: null,
    }],
  };
  // Watch for the decision-35 load from the first navigation on (listeners are
  // per page, so a fresh scenario starts from an empty list).
  loginEntryRequests.set(username, []);
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/login/remoteEntry.json') {
      loginEntryRequests.get(username)?.push(req.url());
    }
  });
  await page.route(`**/bff/forum/topics/${id}**`, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET' || !new URL(req.url()).pathname.endsWith(`/bff/forum/topics/${id}`)) {
      return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
  });
});

async function mockModerationWrite(
  username: string,
  id: number,
  answer: { status: number; headers?: Record<string, string>; body: unknown },
): Promise<void> {
  const page = pageOf(username);
  modWrites.set(id, 0);
  await page.route(`**/bff/forum/moderation/topics/${id}`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    modWrites.set(id, (modWrites.get(id) ?? 0) + 1);
    return route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: answer.headers ?? {},
      body: JSON.stringify(answer.body),
    });
  });
}

Given('the forum-bff will refuse the next moderation write on topic {int} demanding a step-up', async ({}, id: number) => {
  const username = [...pageRegistry.keys()].pop();
  if (!username) throw new Error('No page registered — add a session step first.');
  await mockModerationWrite(username, id, {
    status: 403,
    headers: { 'X-Step-Up-Required': 'X-Forum-StepUp' },
    body: { error: 'moderating a topic requires step-up' },
  });
});

Given('the forum-bff will refuse the next moderation write on topic {int} with a bare 403', async ({}, id: number) => {
  const username = [...pageRegistry.keys()].pop();
  if (!username) throw new Error('No page registered — add a session step first.');
  await mockModerationWrite(username, id, { status: 403, body: {} });
});

Given('the login remote entry cannot be fetched by {string}', async ({ user }, username: string) => {
  // The decided fallback context (decision 35): no federation runtime can reach
  // login-ui — a moved manifest row, the standalone dev shell, a network error.
  const page = pageOf(user(username).username);
  await page.route(LOGIN_REMOTE_ENTRY_GLOB, (route) => route.abort('failed'));
});

// ── Driving the page ───────────────────────────────────────────────────────

When('{string} attempts to lock the topic', async ({ user }, username: string) => {
  // Unlike `locks the topic` (multiuser-steps.ts) this expects NO outcome: the
  // scenario decides whether the write was paused, refused or accepted.
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mod-lock-toggle"]').click();
});

When('{string} declines the forum step-up check', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mod-step-up-dismiss"]').click();
});

// ── Assertions ─────────────────────────────────────────────────────────────

Then('{string} is offered the forum step-up check', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="mod-step-up"]')).toBeVisible({ timeout: 15_000 });
  // The outcome region says WHY the action did not apply, as an alert.
  await expect(page.locator('.topic__outcome')).toContainText(/second-factor check/i);
});

Then('{string} is not offered the forum step-up check', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="mod-step-up"]')).toHaveCount(0);
});

Then('the topic stays unlocked for {string}', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Nothing was performed: no locked notice, and the toggle still offers Lock.
  await expect(page.locator('.topic__locked')).toHaveCount(0);
  await expect(page.locator('[data-testid="mod-lock-toggle"]')).toHaveText(/Lock topic/);
});

Then('the step-up verify link shown to {string} leads to the platform MFA challenge returning to topic {int}',
  async ({ user }, username: string, id: number) => {
    const page = pageOf(user(username).username);
    const link = page.locator('[data-testid="mod-step-up-verify"]');
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = (await link.getAttribute('href')) ?? '';
    // login-ui's MfaChallengeComponent at the HOST route /login/mfa/challenge,
    // with ?returnTo= pointing back at this very topic (step-up.ts MFA_CHALLENGE_ROUTE).
    expect(href).toContain('/login/mfa/challenge');
    expect(href).toContain('returnTo=');
    expect(decodeURIComponent(href)).toContain(`/topics/${id}`);
  });

Then('{string} sees the plain lock failure alert', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const outcome = page.locator('.topic__outcome');
  await expect(outcome).toContainText('Could not update the topic lock', { timeout: 15_000 });
  await expect(outcome).not.toContainText(/second-factor/i);
});

Then('{string} sees the title of topic {int}', async ({ user }, username: string, id: number) => {
  // The mocked topic rendered — a positive, settled page before any absence check.
  const page = pageOf(user(username).username);
  await expect(page.locator('.topic__head h1')).toHaveText(`Step-up probe topic ${id}`, { timeout: 15_000 });
});

Then('the page of {string} requested the login remote entry {string}', async ({ user }, username: string, path: string) => {
  // Decision 35 = A: ONE hardcoded path, not discovered, not configured.
  expect(path).toBe('/login/remoteEntry.json');
  const u = user(username).username;
  await expect
    .poll(() => (loginEntryRequests.get(u) ?? []).length, {
      message: `the topic page never requested ${path} after the step-up refusal`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

Then('{string} sees the federated login-ui MFA challenge in place', async ({ user }, username: string) => {
  // login-ui's exposed MfaStepUpComponent (`./mfa-step-up`, login-ui PR #24):
  // ONLY its `mfa-challenge-*` testids, so today's ?returnTo= link cannot pass
  // this. It makes no /bff/mfa call on mount, so it renders even while MFA is dark.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="mfa-challenge-view"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="mfa-challenge-intro"]')).toBeVisible();
  // Mounted in place: the topic is still on screen, not a navigation to /login.
  await expect(page).toHaveURL(/\/topics\/\d+/);
});

Then('the moderation write on topic {int} was sent exactly once', async ({}, id: number) => {
  expect(modWrites.get(id) ?? 0, `moderation writes on topic ${id}`).toBe(1);
});

// ── ARMED lane (real forum-bff) ────────────────────────────────────────────

Given('the platform MFA step-up gate is armed on this stack', async ({ $testInfo }) => {
  $testInfo.skip(
    !MFA_STEPUP_ARMED,
    'MFA_STEPUP_ARMED!=1 — this needs a stack with app.mfa.enabled=true on forum-bff-api / '
    + 'auth-core (default false, i.e. the gate ships dark and is a no-op). Set MFA_STEPUP_ARMED=1 '
    + 'once the mesh under test carries that flag.',
  );
});

When('{string} GETs {string} capturing the step-up signal', async ({ user }, username: string, path: string) => {
  const page = pageOf(user(username).username);
  const r = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { status: res.status, signal: res.headers.get('X-Step-Up-Required') };
  }, path);
  captured.status = r.status;
  captured.signal = r.signal;
});

Then('the captured response was a 403 carrying the step-up signal {string}', async ({}, flavour: string) => {
  expect(captured.status).toBe(403);
  expect(captured.signal).toBe(flavour);
});

Then('the captured response was a 403 without any step-up signal', async ({}) => {
  expect(captured.status).toBe(403);
  expect(captured.signal).toBeNull();
});
