// VN-layer step definitions: character sprites, voicebox skins/accents,
// sticker tokens, the VN profile editor, read-aloud, and the small-screen /
// touch-target contracts. Backs features/forum/vn-profile.feature and
// features/forum/vn-combination.feature (both @cluster — wave 2b ships dark;
// bddgen still compiles everything so `--list` proves the Gherkin parses).
//
// Two flavours of setup, mirroring the session-steps split:
//   - REAL-PATH steps ("saves a VN profile with skin …", "posts a reply …")
//     drive the actual editor/composer UI end-to-end.
//   - ROUTE-SHAPED steps ("has a saved VN profile with a character sticker",
//     "owns the sticker …", "… endpoint is unavailable", "a topic post
//     containing N sticker tokens") use Playwright routing to pin the wire
//     payload the UI must survive — that is the point of those scenarios
//     (fail-soft floors, hostile/degenerate payloads, the 8/post render cap),
//     and it keeps them deterministic on any stack. The BFF's own suite owns
//     the server side of those contracts.
//
// Surfaces are grounded against the real markup:
//   topic-detail  -> article.forum-post[data-vnskin], --forum-vnbox-accent,
//                    [data-testid="post-sprite"|"post-read-aloud"], the
//                    .forum-post__body sticker <img class="forum-sticker">
//   forum-index   -> [data-testid="vn-profile-toggle"], #vn-editor-panel
//   vn-editor     -> "vn-editor-skin-<skin>", "vn-editor-accent-enabled",
//                    "vn-editor-voice", "vn-editor-save"
//   sticker picker-> "sticker-toggle" (aria-expanded), "sticker-panel",
//                    "sticker-insert-<slug>"

import { Page, expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry } from './_registry';
import { SeedUser, seedSession, subjectOf } from '../../tests/helpers/roles';

/** Captured PUT /bff/forum/vn-profiles/me payloads, per username (the editor
 *  combination sweep asserts EXACTLY what the UI put on the wire). */
const vnSavePayloads = new Map<string, Record<string, unknown>>();

/** 1x1 transparent PNG for sticker-body/full-sprite fulfils, so screenshots
 *  don't show broken-image glyphs when a scenario stubs the sticker list. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The post <article> authored by this seed user (matched on the author link
 *  label the forum renders, which the cluster seed keys to the username). */
function ownArticle(page: Page, username: string) {
  return page
    .locator('article.forum-post')
    .filter({ has: page.locator('.forum-post__author a', { hasText: username }) })
    .first();
}

// ── generic control interaction ──────────────────────────────────────────────

When('{string} activates the {string} control', async ({ user }, username: string, testid: string) => {
  const page = pageOf(user(username).username);
  await page.locator(`[data-testid="${testid}"]`).first().click();
});

When('{string} chooses the {string} option', async ({ user }, username: string, testid: string) => {
  // Radio options (skin swatches, sticker chooser) — clicking the input checks it.
  const page = pageOf(user(username).username);
  await page.locator(`[data-testid="${testid}"]`).first().click();
});

When('{string} focuses the {string} control', async ({ user }, username: string, testid: string) => {
  const page = pageOf(user(username).username);
  await page.locator(`[data-testid="${testid}"]`).first().focus();
});

When('{string} presses {string}', async ({ user }, username: string, key: string) => {
  const page = pageOf(user(username).username);
  await page.keyboard.press(key);
});

Then('the {string} control is focused for {string}', async ({ user }, testid: string, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="${testid}"]`).first()).toBeFocused();
});

Then('the {string} control shows aria-expanded {string}', async ({ page }, testid: string, value: string) => {
  // Used with the sticker-picker toggle / VN profile toggle (a11y contract).
  await expect(page.locator(`[data-testid="${testid}"]`).first()).toHaveAttribute('aria-expanded', value);
});

// ── read-aloud (aria-pressed toggle states) ──────────────────────────────────

Then('the {string} control is pressed', async ({ page }, testid: string) => {
  await expect(page.locator(`[data-testid="${testid}"]`).first()).toHaveAttribute('aria-pressed', 'true');
});

Then('the {string} control is not pressed', async ({ page }, testid: string) => {
  await expect(page.locator(`[data-testid="${testid}"]`).first()).toHaveAttribute('aria-pressed', 'false');
});

When('{string} activates the read-aloud control on post {int}', async ({ user }, username: string, nth: number) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="post-read-aloud"]').nth(nth - 1).click();
});

Then('the read-aloud control on post {int} is pressed', async ({ page }, nth: number) => {
  await expect(page.locator('[data-testid="post-read-aloud"]').nth(nth - 1)).toHaveAttribute('aria-pressed', 'true');
});

Then('the read-aloud control on post {int} is not pressed', async ({ page }, nth: number) => {
  await expect(page.locator('[data-testid="post-read-aloud"]').nth(nth - 1)).toHaveAttribute('aria-pressed', 'false');
});

// ── VN profile state seeding / interception ──────────────────────────────────

Given('{string} has a saved VN profile with a character sticker', async ({ user }, username: string) => {
  // ROUTE-SHAPED: pin the lookup payload for this user's subject so the sprite
  // render path is exercised deterministically. The PUT→lookup round trip is
  // covered by the editor save sweep + the BFF's own 250-test suite.
  const u: SeedUser = user(username);
  const page = pageOf(u.username);
  const profile = {
    subject: subjectOf(u),
    stickerSlug: 'wave',
    characterImgRef: null,
    voiceboxStyle: 'classic',
    voiceboxAccent: null,
    voiceStyle: null,
  };
  await page.route('**/bff/forum/vn-profiles/lookup', (route) =>
    route.fulfill({ json: { profiles: { [profile.subject]: profile } } }),
  );
  await page.route('**/bff/user/character/stickers/*/body', (route) =>
    route.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );
});

Given('{string} intercepts VN profile saves', async ({ user }, username: string) => {
  // Capture the editor's PUT payload verbatim, echo it back as the server
  // would, and serve subsequent lookups/GETs from the captured state — the
  // full client pipeline (editor → wire payload → lookup → applyVoicebox)
  // runs for real; only the database is elided.
  const u: SeedUser = user(username);
  const page = pageOf(u.username);
  vnSavePayloads.delete(u.username);
  const subject = subjectOf(u);
  await page.route('**/bff/forum/vn-profiles/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const captured = vnSavePayloads.get(u.username) ?? null;
    if (req.method() === 'PUT' && url.includes('/vn-profiles/me')) {
      const payload = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      vnSavePayloads.set(u.username, payload);
      await route.fulfill({ json: { subject, ...payload } });
    } else if (url.endsWith('/vn-profiles/lookup')) {
      await route.fulfill({ json: { profiles: captured ? { [subject]: { subject, ...captured } } : {} } });
    } else if (url.includes('/vn-profiles/me')) {
      await route.fulfill({ json: { subject, voiceboxStyle: 'classic', ...(captured ?? {}) } });
    } else {
      await route.fallback();
    }
  });
});

Given('the character sticker endpoint is unavailable', async ({ page }) => {
  // Fail-soft floor: the sticker surfaces must hide entirely.
  await page.route('**/bff/user/character/stickers', (route) => route.abort());
});

Given('the VN profile service is unavailable', async ({ page }) => {
  // Fail-soft floor: posts must render EXACTLY as pre-feature.
  await page.route('**/bff/forum/vn-profiles/**', (route) => route.abort());
});

Given('{string} owns the sticker {string}', async ({ user }, username: string, slug: string) => {
  const page = pageOf(user(username).username);
  await page.route('**/bff/user/character/stickers', (route) =>
    route.fulfill({ json: [{ slug, name: slug }] }),
  );
  await page.route('**/bff/user/character/stickers/*/body', (route) =>
    route.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );
});

Given(
  '{string} owns the stickers {string} and {string}',
  async ({ user }, username: string, a: string, b: string) => {
    const page = pageOf(user(username).username);
    await page.route('**/bff/user/character/stickers', (route) =>
      route.fulfill({ json: [{ slug: a, name: a }, { slug: b, name: b }] }),
    );
    await page.route('**/bff/user/character/stickers/*/body', (route) =>
      route.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
    );
  },
);

Given('a topic post containing {int} sticker tokens', async ({ page }, count: number) => {
  // ROUTE-SHAPED: append one deterministic post with exactly N tokens to the
  // real topic payload — the render cap (8/post) is a pure client contract.
  const tokens = Array.from({ length: count }, (_, i) => `:snap-sticker:e2e-cap-${i}:`).join(' ');
  await page.route('**/bff/forum/topics/*', async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { topic?: { id?: number }; posts?: unknown[] };
    const posts = Array.isArray(json?.posts) ? json.posts : [];
    posts.push({
      id: 99900 + count,
      topicId: json?.topic?.id ?? 1,
      authorSubject: 'google:e2e-sticker-author@example.test',
      authorLabel: 'sticker-author',
      bodyHtml: `<p>${tokens}</p>`,
      createdAt: new Date().toISOString(),
      editedAt: null,
    });
    await route.fulfill({ response, json: { ...json, posts } });
  });
  await page.route('**/bff/user/character/stickers/*/body', (route) =>
    route.fulfill({ body: TINY_PNG, contentType: 'image/png' }),
  );
});

// ── editor save flows ────────────────────────────────────────────────────────

/** Drive the editor UI: open it from the index header (if closed), pick the
 *  skin/accent/voice, save, and wait for the panel to close (the saved event
 *  closes it and returns focus to the toggle). */
async function saveVnProfile(
  page: Page,
  opts: { skin: string; accent: 'on' | 'off'; voice?: string },
): Promise<void> {
  if ((await page.locator('[data-testid="vn-editor"]').count()) === 0) {
    await page.locator('[data-testid="vn-profile-toggle"]').click();
  }
  await expect(page.locator('[data-testid="vn-editor"]')).toBeVisible();
  // Wait for the profile load (the skin radios render after loading()).
  await page.locator(`[data-testid="vn-editor-skin-${opts.skin}"]`).click();
  await page.locator('[data-testid="vn-editor-accent-enabled"]').setChecked(opts.accent === 'on');
  if (opts.voice !== undefined) {
    await page.locator('[data-testid="vn-editor-voice"]').selectOption(opts.voice === 'none' ? '' : opts.voice);
  }
  await page.locator('[data-testid="vn-editor-save"]').click();
  // Success closes the panel (forum-index closeVnEditor) — the strongest signal.
  await expect(page.locator('[data-testid="vn-editor"]')).toHaveCount(0);
}

When(
  '{string} saves a VN profile with skin {string} and accent {string}',
  async ({ user }, username: string, skin: string, accent: string) => {
    await saveVnProfile(pageOf(user(username).username), { skin, accent: accent as 'on' | 'off' });
  },
);

When(
  '{string} saves a VN profile with skin {string}, voice {string} and accent {string}',
  async ({ user }, username: string, skin: string, voice: string, accent: string) => {
    await saveVnProfile(pageOf(user(username).username), { skin, accent: accent as 'on' | 'off', voice });
  },
);

Then(
  'the captured VN save payload for {string} has skin {string}, voice {string} and accent {string}',
  async ({ user }, username: string, skin: string, voice: string, accent: string) => {
    const payload = vnSavePayloads.get(user(username).username);
    expect(payload, 'a VN save should have been captured').toBeTruthy();
    expect(payload!['voiceboxStyle']).toBe(skin);
    expect(payload!['voiceStyle']).toBe(voice === 'none' ? null : voice);
    // The editor's default swatch is #7c4dff; "off" must serialize null so the
    // server CLEARS a previously stored accent.
    expect(payload!['voiceboxAccent']).toBe(accent === 'on' ? '#7c4dff' : null);
  },
);

// ── post-card assertions (skins, accents, sprites, stickers) ─────────────────

Then('{string} sees their own post article with vnskin {string}', async ({ user }, username: string, skin: string) => {
  const u: SeedUser = user(username);
  const page = pageOf(u.username);
  await expect(ownArticle(page, u.username)).toHaveAttribute('data-vnskin', skin);
});

Then(
  '{string} sees their own post article with vnskin {string} and accent {string}',
  async ({ user }, username: string, skin: string, accent: string) => {
    const u: SeedUser = user(username);
    const page = pageOf(u.username);
    const article = ownArticle(page, u.username);
    await expect(article).toHaveAttribute('data-vnskin', skin);
    // applyVoicebox writes the STRICTLY validated accent as an inline custom
    // property; "off" must leave it entirely unset.
    const accentVar = await article.evaluate((el) => el.style.getPropertyValue('--forum-vnbox-accent'));
    expect(accentVar).toBe(accent === 'on' ? '#7c4dff' : '');
  },
);

Then('{string} sees a post article without any vnskin attribute', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const first = page.locator('article.forum-post').first();
  await expect(first).toBeVisible();
  await expect(page.locator('article.forum-post[data-vnskin]')).toHaveCount(0);
});

Then('{string} sees at least one post article', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('article.forum-post').first()).toBeVisible();
});

Then(
  '{string} sees a rendered sticker image for {string} in the last post',
  async ({ user }, username: string, slug: string) => {
    const page = pageOf(user(username).username);
    const img = page.locator('article.forum-post').last().locator(`img.forum-sticker[src$="/stickers/${slug}/body"]`);
    await expect(img.first()).toBeVisible();
  },
);

Then('{string} sees at most {int} rendered sticker images in that post', async ({ user }, username: string, cap: number) => {
  const page = pageOf(user(username).username);
  const last = page.locator('article.forum-post').last();
  await expect(last).toBeVisible();
  // The cap consumes tokens eagerly, so a capped post renders EXACTLY the cap.
  await expect(last.locator('img.forum-sticker')).toHaveCount(cap);
});

Then('the newest post shows exactly {int} rendered sticker images', async ({ page }, count: number) => {
  const last = page.locator('article.forum-post').last();
  await expect(last).toBeVisible();
  await expect(last.locator('img.forum-sticker')).toHaveCount(count);
});

Then('the newest post still contains the literal text {string}', async ({ page }, text: string) => {
  await expect(page.locator('article.forum-post').last()).toContainText(text);
});

Then('the newest post renders a sticker image inside a code element', async ({ page }) => {
  await expect(page.locator('article.forum-post').last().locator('code img.forum-sticker').first()).toBeVisible();
});

// ── composer flows ───────────────────────────────────────────────────────────

When('{string} submits the reply', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="reply-submit"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Reply posted.');
});

When('{string} posts a reply {string}', async ({ user }, username: string, body: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="reply-body"]').fill(body);
  await page.locator('[data-testid="reply-submit"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Reply posted.');
});

When('{string} posts a reply containing {int} sticker tokens', async ({ user }, username: string, count: number) => {
  const page = pageOf(user(username).username);
  const tokens = Array.from({ length: count }, (_, i) => `:snap-sticker:e2e-cap-${i}:`).join(' ');
  await page.locator('[data-testid="reply-body"]').fill(count === 0 ? 'no stickers in this one' : tokens);
  await page.locator('[data-testid="reply-submit"]').click();
  await expect(page.locator('.topic__outcome')).toContainText('Reply posted.');
});

Then('the reply draft for {string} contains {string}', async ({ user }, username: string, text: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="reply-body"]')).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ── viewport / touch coverage ────────────────────────────────────────────────

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  // Small phone + portrait tablet — the two breakpoints the brief pins.
  phone: { width: 360, height: 740 },
  tablet: { width: 768, height: 1024 },
};

Given('{string} uses a {word} viewport', async ({ user }, username: string, device: string) => {
  const size = VIEWPORTS[device];
  if (!size) throw new Error(`Unknown viewport "${device}" — known: ${Object.keys(VIEWPORTS).join(', ')}`);
  await pageOf(user(username).username).setViewportSize(size);
});

Given('{string} has a seeded touch session', async ({ browser, user }, username: string) => {
  // A REAL coarse-pointer environment (isMobile + hasTouch) so the
  // `@media (pointer: coarse)` 44px touch-target rules actually apply.
  const u: SeedUser = user(username);
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
    viewport: VIEWPORTS['phone'],
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

Then('the page shows no horizontal scroll for {string}', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  // <=1px tolerance for subpixel rounding; anything more is real overflow.
  expect(overflow).toBeLessThanOrEqual(1);
});

Then(
  'every interactive control in the VN editor is at least {int}px tall for {string}',
  async ({ user }, minPx: number, username: string) => {
    const page = pageOf(user(username).username);
    // The touch targets: real buttons/selects/checkboxes plus the LABELS that
    // wrap the tiny radio inputs (the label is the touchable surface).
    const targets = page.locator(
      '[data-testid="vn-editor"] :is(button, select, input[type="checkbox"], label.vn-editor__skin, label.vn-editor__sticker)',
    );
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const target = targets.nth(i);
      if (!(await target.isVisible())) continue;
      const box = await target.boundingBox();
      expect(box, `control #${i} should have a bounding box`).toBeTruthy();
      expect(box!.height, `control #${i} height`).toBeGreaterThanOrEqual(minPx);
    }
  },
);
