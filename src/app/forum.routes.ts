import { Routes } from '@angular/router';
import { ForumIndexComponent } from './forum-index.component';
import { TopicsListComponent } from './topics-list.component';
import { TopicDetailComponent } from './topic-detail.component';
import { CreateTopicComponent } from './create-topic.component';
import { ForumSearchComponent } from './forum-search.component';
import { ForumProfileComponent } from './forum-profile.component';
import { ModerationQueueComponent } from './moderation-queue.component';

/** Lazy-loadable routes for the Forum module. Mounted by the host at
 *  /social/forum (see host app.routes.ts) via loadRemoteModule('forum','./routes').
 *
 *  - ''               ForumIndex (categories + the main-page announcements banner)
 *  - categories/:id   TopicsList (paginated topics in a category)
 *  - topics/:id       TopicDetail (the topic + replies + inline reply form)
 *  - create-topic     CreateTopic (gated to forum-role / admin)
 *  - search           ForumSearch
 *  - moderation       ModerationQueue (queue depth; the page itself gates on canModerate)
 *  - profile/:subject FORUM PROFILE — embeds OUR federated user-profile fragment
 *                     for the poster (NOT a phpBB profile/memberlist page). */
export const FORUM_ROUTES: Routes = [
  { path: '', component: ForumIndexComponent },
  { path: 'categories/:id', component: TopicsListComponent },
  { path: 'topics/:id', component: TopicDetailComponent },
  { path: 'create-topic', component: CreateTopicComponent },
  { path: 'search', component: ForumSearchComponent },
  { path: 'moderation', component: ModerationQueueComponent },
  { path: 'profile/:subject', component: ForumProfileComponent },
];
