import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { CreateTopicComponent } from './create-topic.component';
import { ForumService, ForumTopic } from './forum.service';
import { StickerService } from './sticker.service';

/**
 * FEDERATION GUARD for `create-topic`'s post-submit navigation.
 *
 * The defect: `router.navigate(['../topics', id])` with NO `relativeTo`.
 * `Router.navigate` — unlike a template `routerLink`, which defaults to the
 * component's own ActivatedRoute — resolves its command list against the router
 * ROOT. `..` at the root is a no-op, so the author landed on `/topics/<id>`.
 * Standalone at the origin root that happens to look right; under the host
 * shell this remote is mounted at /social/forum and the injected Router is the
 * SHELL's, so posting a topic threw the author out of the forum.
 *
 * This spec routes the component under a NESTED mount with a REAL router, which
 * is what makes the root-relative and route-relative forms produce DIFFERENT
 * URLs — and therefore what makes the assertion able to fail.
 */

const MOUNT = '/social/forum';

const TOPIC: ForumTopic = {
  id: 77,
  categoryId: 1,
  title: 'Hi',
  authorSubject: 's',
  authorLabel: 'a',
  replyCount: 0,
  viewCount: 0,
  locked: false,
  createdAt: '',
  lastPostAt: '',
};

/** Stand-in for the topic view — it only has to be routable so the router can
 *  actually land on the URL the navigation produces. */
@Component({ selector: 'hug-forum-topic-stub', standalone: true, template: '<p>topic</p>' })
class TopicStubComponent {}

describe('create-topic post-submit navigation (relative to the mount)', () => {
  beforeEach(() => {
    const forum = jasmine.createSpyObj<ForumService>('ForumService', ['listCategories', 'createTopic']);
    (forum as unknown as { canPost: unknown }).canPost = signal(true);
    forum.listCategories.and.resolveTo([]);
    forum.createTopic.and.resolveTo(TOPIC);
    const stickers = jasmine.createSpyObj<StickerService>('StickerService', ['listOwn']);
    stickers.listOwn.and.resolveTo(null);

    TestBed.configureTestingModule({
      providers: [
        // The remote's routes, mounted where the SHELL mounts them.
        provideRouter([
          {
            path: 'social/forum',
            children: [
              { path: 'create-topic', component: CreateTopicComponent },
              { path: 'topics/:id', component: TopicStubComponent },
            ],
          },
          { path: 'topics/:id', component: TopicStubComponent }, // the shell-root decoy
        ]),
        { provide: ForumService, useValue: forum },
        { provide: StickerService, useValue: stickers },
      ],
    });
  });

  it('lands on the new topic INSIDE the remote mount, not at the router root', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(`${MOUNT}/create-topic`, CreateTopicComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();

    component.categoryId.set(1);
    component.title.set('Hi');
    component.body.set('Some **body**');
    await component.submit();
    await harness.fixture.whenStable();
    harness.detectChanges();

    // Without `relativeTo` this is '/topics/77' — the decoy route above exists
    // precisely so the buggy navigation SUCCEEDS and the difference shows up as
    // a wrong URL rather than a failed navigation.
    expect(TestBed.inject(Router).url).toBe(`${MOUNT}/topics/77`);
  });
});
