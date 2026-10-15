import { FORUM_ROUTES } from './forum.routes';

describe('FORUM_ROUTES', () => {
  it('exposes the index, category, topic, create, search, moderation and profile routes', () => {
    const paths = FORUM_ROUTES.map((r) => r.path);
    expect(paths).toEqual(['', 'categories/:id', 'topics/:id', 'create-topic', 'search', 'moderation', 'profile/:subject']);
  });

  it('binds a component to every route (no empty leaves)', () => {
    for (const r of FORUM_ROUTES) {
      expect(r.component).withContext(`route ${r.path}`).toBeDefined();
    }
  });

  it('routes the forum profile by platform subject (not a phpBB profile)', () => {
    const profile = FORUM_ROUTES.find((r) => r.path === 'profile/:subject');
    expect(profile).toBeDefined();
    expect(profile!.component!.name).toBe('ForumProfileComponent');
  });
});
