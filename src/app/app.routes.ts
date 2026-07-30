import { Routes } from '@angular/router';
import { FORUM_ROUTES } from './forum.routes';

/** Per-surface tab titles for the STANDALONE dev shell only, keyed by the
 *  FORUM_ROUTES `path`. The ForumTitleStrategy (dev-shell bootstrap) renders
 *  these as `HugMesh Forum — <Surface>`. These live on the dev-shell wrapper,
 *  NOT on FORUM_ROUTES, so the host's own TitleStrategy stays authoritative when
 *  it federates `./routes`. */
const DEV_SHELL_TITLES: Record<string, string> = {
  '': '',
  'categories/:id': 'Topics',
  'topics/:id': 'Topic',
  'create-topic': 'New topic',
  'search': 'Search',
  'profile/:subject': 'Profile',
};

/** Dev-shell routes: mount the exposed Forum routes at the root so the remote
 *  is browsable standalone, adding a per-surface tab title. The host ignores
 *  this and loads `./routes` (FORUM_ROUTES, which carry no title). */
export const routes: Routes = [
  {
    path: '',
    children: FORUM_ROUTES.map((r) => {
      const title = DEV_SHELL_TITLES[r.path ?? ''];
      return title ? { ...r, title } : { ...r };
    }),
  },
];
