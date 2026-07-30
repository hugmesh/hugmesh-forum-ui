// Branding step definitions: assert the forum surface carries the HugMesh
// brand at the DOM level. ForumBrandService resolves the header wordmark
// (forum-index.component.html renders <h1>{{ brand.forumName }}</h1>); the unit
// spec covers the Model A default / blank fallback / Model B override, and this
// step proves the resolved name reaches the rendered header under the live host
// (Model A — the only exercised model, no __HUG_BRAND__ injection).

import { expect } from '@playwright/test';
import { Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

Then('{string} sees the forum brand {string}', async ({ user }, username: string, brand: string) => {
  // The forum-index header h1 is bound to ForumBrandService.forumName. Exact
  // text: under Model A (no host brand injection) this is the branded default
  // "HugMesh Forum" — the whole point of the branding fix (the surface no
  // longer renders the bare, unbranded "Forum").
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator('h1').first()).toHaveText(brand, { timeout: 15_000 });
});
