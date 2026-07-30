// Multi-user journey + consequence step definitions for the forum-ui e2e wave.
// These back the cross-user features (reply visibility, moderation consequence,
// VN-as-seen-by-another-reader, create-topic journey, post lifecycle, role
// change mid-session, announcements, profile embed, ban/reject consequence).
//
// Honesty contract (matches the suite's house law):
//   - REAL writes / cross-user DENY use a REAL Casdoor login per user, each in
//     its OWN browser context, so a first user's write is observed by a SECOND
//     independent identity — never asserted only in the author's own page. The
//     bff_ session cookie rides every same-origin request (credentials:'include').
//   - ROUTE-SHAPED steps (announcements payload, a rejected reply) pin the wire
//     the UI must survive; the server side of those contracts is owned by the
//     admin-bff / forum-bff suites. Each such step says so at its call site.
//   - Assertions read the REAL component markup data-testids (grounded against
//     src/app/*.component.html) — no vacuous assertions, bounded expects, DOM
//     absence (toHaveCount(0)) for "gone".
//
// All the features driven here are @cluster (ship dark): they navigate the
// host-mounted remote and need the live forum-bff + Casdoor. bddgen still
// compiles them so `playwright test --list` proves the Gherkin + steps parse.

import { Page, expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry } from './_registry';
import { SeedUser, login, newE2eContext } from '../../tests/helpers/roles';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** A post <article> whose author link label EXACTLY matches `author` (the
 *  cluster seed keys the author label to the username). Exact match matters:
 *  "forum-user" is a substring of "forum-user-2", so a loose hasText would
 *  cross-match the two identities. */
function articleByAuthor(page: Page, author: string) {
  const exact = new RegExp(`^\\s*${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  return page
    .locator('article.forum-post')
    .filter({ has: page.locator('.forum-post__author a', { hasText: exact }) });
}

// ── real per-user login in an isolated context (cross-user writes/DENY) ───────

Given('{string} is logged in in their own context', async ({ browser, user }, username: string) => {
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await login(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

When('{string} reloads', async ({ user }, username: string) => {
  await pageOf(user(username).username).reload({ waitUntil: 'domcontentloaded' });
});

// ── reply form presence (moderation / ban consequence) ───────────────────────

Then('{string} sees the reply form', async ({ user }, username: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="reply-body"]')).toBeVisible();
});

Then('{string} does not see the reply form', async ({ user }, username: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="reply-body"]')).toHaveCount(0);
});

// ── moderator topic lock / unlock (real consequence on the victim) ───────────

When('{string} locks the topic', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mod-lock-toggle"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Topic locked.');
});

When('{string} unlocks the topic', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="mod-lock-toggle"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Topic unlocked.');
});

// ── cross-user reply visibility + concurrent ordering ────────────────────────

Then(
  '{string} sees a post by {string} with body {string}',
  async ({ user }, viewer: string, author: string, body: string) => {
    const page = pageOf(user(viewer).username);
    const article = articleByAuthor(page, author).filter({ hasText: body });
    await expect(article.first()).toBeVisible();
  },
);

Then('{string} sees a post with body {string}', async ({ user }, viewer: string, body: string) => {
  const page = pageOf(user(viewer).username);
  await expect(page.locator('article.forum-post').filter({ hasText: body }).first()).toBeVisible();
});

Then('{string} does not see a post with body {string}', async ({ user }, viewer: string, body: string) => {
  const page = pageOf(user(viewer).username);
  await expect(page.locator('article.forum-post').filter({ hasText: body })).toHaveCount(0);
});

Then(
  '{string} sees the posts {string} then {string} in order',
  async ({ user }, viewer: string, first: string, second: string) => {
    const page = pageOf(user(viewer).username);
    const bodies = page.locator('article.forum-post .forum-post__body');
    // Wait for both to be present, then assert their relative order by index.
    await expect(page.locator('article.forum-post').filter({ hasText: first }).first()).toBeVisible();
    await expect(page.locator('article.forum-post').filter({ hasText: second }).first()).toBeVisible();
    const texts = await bodies.allInnerTexts();
    const iFirst = texts.findIndex((t) => t.includes(first));
    const iSecond = texts.findIndex((t) => t.includes(second));
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThan(iFirst);
  },
);

// ── VN profile as seen by ANOTHER reader ─────────────────────────────────────

Then(
  "{string} sees {string}'s post article with vnskin {string}",
  async ({ user }, viewer: string, author: string, skin: string) => {
    const page = pageOf(user(viewer).username);
    await expect(articleByAuthor(page, author).first()).toHaveAttribute('data-vnskin', skin);
  },
);

Then(
  "{string} sees {string}'s post article carry a character sprite",
  async ({ user }, viewer: string, author: string) => {
    const page = pageOf(user(viewer).username);
    await expect(articleByAuthor(page, author).first().locator('[data-testid="post-sprite"]')).toBeVisible();
  },
);

Then(
  "{string}'s own post article has no vnskin",
  async ({ user }, viewer: string) => {
    const page = pageOf(user(viewer).username);
    // The reader saved no VN profile, so the lookup falls back to the classic
    // default and applyVoicebox stamps data-vnskin="classic" on THEIR post
    // article (never the author's custom skin). Assert it stayed classic — the
    // real cross-user isolation. A descendant `has:[data-vnskin]` check can't see
    // the attribute (it lives ON the article), so it would pass vacuously even if
    // the author's skin leaked onto the reader's post.
    await expect(articleByAuthor(page, user(viewer).username).first()).toHaveAttribute('data-vnskin', 'classic');
  },
);

// ── create-topic full journey ────────────────────────────────────────────────

When(
  '{string} creates a topic titled {string} with body {string}',
  async ({ user }, username: string, title: string, body: string) => {
    const page = pageOf(user(username).username);
    // The category picker is populated from the live BFF; the first option is a
    // valid category on the seeded stack.
    await page.locator('[data-testid="create-category"]').selectOption({ index: 0 });
    await page.locator('[data-testid="create-title"]').fill(title);
    await page.locator('[data-testid="create-body"]').fill(body);
    await page.locator('[data-testid="create-submit"]').click();
  },
);

Then('{string} lands on the topic page titled {string}', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  // create-topic navigates to ../topics/{id}; the detail h1 is the topic title.
  await expect(page).toHaveURL(/\/social\/forum\/topics\/\d+/);
  await expect(page.locator('h1')).toHaveText(title);
});

Then('{string} sees the topic {string} in the category list', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('.forum-topic-row__title', { hasText: title }).first()).toBeVisible();
});

Then('{string} finds the topic {string} via search', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  await page.goto('/social/forum/search', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="forum-search-input"]').fill(title);
  await page.locator('[data-testid="forum-search-submit"]').click();
  await expect(page.locator('.search-group a', { hasText: title }).first()).toBeVisible();
});

// ── edit / delete round-trips with cross-user consequence ────────────────────

When(
  '{string} edits their post with body {string} to {string}',
  async ({ user }, username: string, oldBody: string, newBody: string) => {
    const page = pageOf(user(username).username);
    // Target the caller's OWN post carrying oldBody (a user may have several).
    const article = articleByAuthor(page, user(username).username).filter({ hasText: oldBody }).first();
    await article.locator('[data-testid="post-edit"]').click();
    // Entering edit mode swaps the post body for the editor textarea, so the
    // article stops matching `hasText: oldBody` (a textarea's value is NOT part
    // of textContent) — re-resolving `article` here would find nothing. Only ONE
    // post is ever open for edit at a time (editingId is a single signal), so the
    // open editor + its Save button are unique on the page; anchor to them.
    await page.locator('.forum-post__editor').fill(newBody);
    await page.locator('[data-testid="post-save"]').click();
    await expect(page.locator('.topic__outcome')).toContainText('Post updated.');
  },
);

Then(
  "{string} sees {string}'s post body {string} with an edited marker",
  async ({ user }, viewer: string, author: string, body: string) => {
    const page = pageOf(user(viewer).username);
    const article = articleByAuthor(page, author).filter({ hasText: body }).first();
    await expect(article).toBeVisible();
    await expect(article.locator('.forum-post__edited')).toBeVisible();
  },
);

When('{string} deletes the post with body {string}', async ({ user }, username: string, body: string) => {
  const page = pageOf(user(username).username);
  const article = page.locator('article.forum-post').filter({ hasText: body }).first();
  await article.locator('[data-testid="post-delete"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Post deleted.');
});

// ── role grant / revoke mid-session (session broadcast, no reload) ────────────

When('{string} has their roles rewritten to {string}', async ({ user }, username: string, roles: string) => {
  const page = pageOf(user(username).username);
  const next = roles.split(',').map((r) => r.trim()).filter(Boolean);
  // Simulate a role revoke/grant propagated across the host + remotes: rewrite
  // hug.session and fire the hug-session-change broadcast the SessionService
  // listens for (src/app/session.service.ts). No navigation — the affordance
  // must re-gate reactively off the session signal.
  await page.evaluate((r) => {
    const raw = window.localStorage.getItem('hug.session');
    const s = raw ? JSON.parse(raw) : {};
    s.roles = r;
    window.localStorage.setItem('hug.session', JSON.stringify(s));
    window.dispatchEvent(new Event('hug-session-change'));
  }, next);
});

// ── announcements banner (ROUTE-SHAPED: pins the admin-bff wire payload) ──────

When(
  '{string} publishes a forum announcement titled {string}',
  async ({ user }, username: string, title: string) => {
    // ROUTE-SHAPED: the admin publish itself is an admin-bff concern (its own
    // suite owns it); here we pin the GET /bff/announcements/forum payload the
    // banner must render, so the forum-side contract (render + dismiss-once +
    // sandbox) is exercised deterministically.
    const page = pageOf(user(username).username);
    await page.route('**/bff/announcements/forum', (route) =>
      route.fulfill({
        json: [
          {
            id: 'e2e-ann-1',
            title,
            body_html: '<p>Scheduled maintenance tonight. <a href="https://example.test">Details</a>.</p>',
            priority: 10,
            dismissible: true,
            starts_at: null,
            ends_at: null,
          },
        ],
      }),
    );
  },
);

When(
  '{string} publishes a pinned forum announcement titled {string}',
  async ({ user }, username: string, title: string) => {
    const page = pageOf(user(username).username);
    await page.route('**/bff/announcements/forum', (route) =>
      route.fulfill({
        json: [
          {
            id: 'e2e-ann-pinned',
            title,
            body_html: '<p>Read the community guidelines.</p>',
            priority: 100,
            dismissible: false,
            starts_at: null,
            ends_at: null,
          },
        ],
      }),
    );
  },
);

Then('{string} sees the announcement banner {string}', async ({ user }, username: string, title: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="forum-announcement-title"]', { hasText: title })).toBeVisible();
  await expect(page.locator('[data-testid="forum-announcement-body"]').first()).toBeVisible();
});

Then('{string} sees no announcement banner', async ({ user }, username: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="forum-announcements"]')).toHaveCount(0);
});

When('{string} dismisses the announcement', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="forum-announcement-dismiss"]').click();
});

Then('the announcement {string} has no dismiss control for {string}', async ({ user }, title: string, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="forum-announcement-title"]', { hasText: title })).toBeVisible();
  await expect(page.locator('[data-testid="forum-announcement-dismiss"]')).toHaveCount(0);
});

// ── profile embed (federated user ./profile fragment) ────────────────────────

When('{string} opens the author profile on the first post', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('article.forum-post .forum-post__author a').first().click();
});

Given('the user profile remote is unreachable for {string}', async ({ user }, username: string) => {
  // Force the native-federation ./profile load to fail so the forum-profile
  // error alert path renders instead of the fragment.
  const page = pageOf(user(username).username);
  await page.route('**/remoteEntry.json', (route) => route.abort());
  await page.route('**/user/**', (route) => route.abort());
});

Then('the forum profile fragment renders for {string}', async ({ user }, username: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="forum-profile-fragment"]')).toBeVisible();
});

Then('the forum profile error is shown for {string}', async ({ user }, username: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="forum-profile-error"]')).toBeVisible();
});

// ── ban / rejected-write consequence (ROUTE-SHAPED reply rejection) ──────────

Given('{string}\'s next reply will be rejected with {int}', async ({ user }, username: string, status: number) => {
  // ROUTE-SHAPED: models the post-ban state (admin-bff owns the ban itself). The
  // client gate is unchanged — the reply form still renders — so the write must
  // fail LOUDLY via the alert live-region, which is what this pins.
  const page = pageOf(user(username).username);
  await page.route('**/bff/forum/topics/*/replies', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: '{"error":"forbidden"}' }),
  );
});

When('{string} attempts a reply {string}', async ({ user }, username: string, body: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="reply-body"]').fill(body);
  await page.locator('[data-testid="reply-submit"]').click();
});

Then('{string} sees the reply failure announced', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // topic-detail sets an alert outcome; the live region is role="status"/alert.
  await expect(page.locator('.topic__outcome')).toContainText('Could not post your reply');
});
