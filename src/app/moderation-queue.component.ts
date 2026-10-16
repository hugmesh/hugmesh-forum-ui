import { Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { ForumService, ModerationQueueDepth } from './forum.service';
import { MFA_CHALLENGE_ROUTE, StepUpRequiredError } from './step-up';

/**
 * Moderation queue depth: how many posts are waiting for review. Slice 1 of the
 * forum-moderation surface. It shows a COUNT only: the moderator-reachable
 * endpoint (GET /bff/forum/moderation/queue) returns `{queueDepth, source}`, and
 * the per-post list and approve/reject are ADMIN-only on the BFF.
 *
 * Gated in the component on {@link ForumService.canModerate} (not a route guard,
 * because the session hydrates asynchronously): a caller who is not a forum
 * moderator sees a plain message and no request is made. The count is loaded as
 * soon as the role is known.
 *
 * States: loading, count, unavailable (the BFF's phpBB seam is degraded; shown
 * as "unavailable", never as zero), step-up required (offers the platform's MFA
 * challenge), and a plain error.
 *
 * a11y: h1 heading; loading/count/unavailable are role="status", errors are
 * role="alert"; the refresh control is a real button.
 */
@Component({
  selector: 'hug-forum-moderation-queue',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './moderation-queue.component.html',
  styleUrl: './moderation-queue.component.scss',
})
export class ModerationQueueComponent {
  private readonly forum = inject(ForumService);
  private readonly router = inject(Router);

  readonly canModerate = this.forum.canModerate;

  readonly loading = signal(false);
  readonly queue = signal<ModerationQueueDepth | null>(null);
  readonly error = signal('');
  readonly stepUp = signal(false);
  readonly mfaChallengeRoute = MFA_CHALLENGE_ROUTE;

  /** Loads once, the first time the caller is known to be a moderator. */
  private requested = false;

  constructor() {
    effect(() => {
      if (this.canModerate() && !this.requested) {
        this.requested = true;
        untracked(() => void this.load());
      }
    });
  }

  /** Fetch the queue depth (also the "Check again" action). */
  async load(): Promise<void> {
    if (!this.canModerate()) return;
    this.loading.set(true);
    this.error.set('');
    this.stepUp.set(false);
    try {
      this.queue.set(await this.forum.getModerationQueueDepth());
    } catch (e) {
      this.queue.set(null);
      if (e instanceof StepUpRequiredError) {
        this.stepUp.set(true);
      } else {
        this.error.set('Could not load the moderation queue. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** The host-level URL the MFA challenge returns to: this very page. */
  mfaReturnTo(): string {
    return this.router.url;
  }
}
