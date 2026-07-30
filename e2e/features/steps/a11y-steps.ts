// Accessibility step definitions. The forum-ui carries the org a11y standard
// (skip-link, aria landmarks/regions, focus restoration after a route change,
// keyboard-reachable controls). These steps assert those contracts against the
// REAL shell + component markup:
//   - app.component.html renders `<a class="skip" href="#main-content">` →
//     `<main id="main-content" tabindex="-1">` (the skip-link + focus target).
//   - forum-index.component.html renders `<nav aria-label="Forum search">` and
//     `<section class="forum-categories" role="region" aria-labelledby=…>`.
//   - topics-list.component.html renders `<nav aria-label="Topic pagination">`
//     with prev/next buttons (the roving keyboard surface).

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  // forum-ui targets #main-content (NOT #main) — see src/app/app.component.html.
  await expect(skip).toHaveAttribute('href', '#main-content');
});

Then('activating the skip link moves focus to the main region {string}', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#main-content');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / regions ─────────────────────────────────────────────────

Then('the forum search nav has an accessible name {string}', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('nav[aria-label="Forum search"]')).toBeVisible();
});

Then('the categories region has an accessible name {string}', async ({}, username: string) => {
  const page = pageOf(username);
  const region = page.locator('section.forum-categories[role="region"]');
  // aria-labelledby points at the #forum-categories-heading <h2>.
  await expect(region).toHaveAttribute('aria-labelledby', 'forum-categories-heading');
  await expect(page.locator('#forum-categories-heading')).toBeVisible();
});

Then('the search form has the search role {string}', async ({}, username: string) => {
  const page = pageOf(username);
  // forum-search.component.html: <form role="search"> with a labelled input.
  await expect(page.locator('form[role="search"]')).toBeVisible();
  await expect(page.locator('label[for="forum-search-input"]')).toHaveCount(1);
});

// ── Focus restoration after a route change ───────────────────────────────────

Then('focus is restored to the main region after navigation {string}', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('main#main-content')).toBeFocused();
});

// ── Keyboard reachability of the pagination controls (roving surface) ────────

When('{string} focuses the next-page button', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('[data-testid="topics-next"]').focus();
});

Then('the pagination nav has an accessible name {string}', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('nav[aria-label="Topic pagination"]')).toBeVisible();
});

Then('the next-page button has an accessible name {string}', async ({}, username: string) => {
  const page = pageOf(username);
  // The button carries aria-label="Next page" (icon-free text + label).
  await expect(page.locator('[data-testid="topics-next"]')).toHaveAttribute('aria-label', 'Next page');
});

Then('the page-status region announces politely {string}', async ({}, username: string) => {
  const page = pageOf(username);
  // [data-testid="topics-page"] is aria-live="polite".
  await expect(page.locator('[data-testid="topics-page"]')).toHaveAttribute('aria-live', 'polite');
});
