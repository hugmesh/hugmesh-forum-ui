import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { ModerationQueueComponent } from './moderation-queue.component';
import { ForumService, ModerationQueueDepth } from './forum.service';
import { MFA_CHALLENGE_ROUTE, StepUpRequiredError } from './step-up';

function depth(over: Partial<ModerationQueueDepth> = {}): ModerationQueueDepth {
  return { depth: 3, source: 'phpbb', available: true, ...over };
}

describe('ModerationQueueComponent', () => {
  let fixture: ComponentFixture<ModerationQueueComponent>;
  let component: ModerationQueueComponent;
  let forum: jasmine.SpyObj<ForumService>;
  const canModerate = signal(false);

  beforeEach(async () => {
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['getModerationQueueDepth']);
    (forum as unknown as { canModerate: typeof canModerate }).canModerate = canModerate;
    canModerate.set(true);
    forum.getModerationQueueDepth.and.resolveTo(depth());

    await TestBed.configureTestingModule({
      imports: [ModerationQueueComponent],
      providers: [provideRouter([]), { provide: ForumService, useValue: forum }],
    }).compileComponents();

    fixture = TestBed.createComponent(ModerationQueueComponent);
    component = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function q(testid: string): HTMLElement | null {
    return el().querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the queue depth to a forum moderator', async () => {
    await render();
    expect(forum.getModerationQueueDepth).toHaveBeenCalledTimes(1);
    const count = q('mod-queue-count')!;
    expect(count.getAttribute('role')).toBe('status');
    expect(count.textContent).toContain('3 posts are waiting for review');
    expect(el().querySelectorAll('h1').length).toBe(1);
  });

  it('uses the singular for a queue of one', async () => {
    forum.getModerationQueueDepth.and.resolveTo(depth({ depth: 1 }));
    await render();
    expect(q('mod-queue-count')!.textContent).toContain('1 post is waiting for review');
  });

  it('shows a live empty queue as zero', async () => {
    forum.getModerationQueueDepth.and.resolveTo(depth({ depth: 0 }));
    await render();
    expect(q('mod-queue-count')!.textContent).toContain('0 posts are waiting for review');
    expect(q('mod-queue-unavailable')).toBeNull();
  });

  it('says "unavailable", never zero, when the BFF source is degraded', async () => {
    forum.getModerationQueueDepth.and.resolveTo({ depth: null, source: 'degraded', available: false });
    await render();
    expect(q('mod-queue-count')).toBeNull();
    const msg = q('mod-queue-unavailable')!;
    expect(msg.getAttribute('role')).toBe('status');
    expect(msg.textContent).toContain('unavailable');
    expect(msg.textContent).not.toMatch(/\b0\b/);
  });

  it('shows a loading status while the request is in flight', async () => {
    let resolve!: (v: ModerationQueueDepth) => void;
    forum.getModerationQueueDepth.and.returnValue(new Promise((r) => (resolve = r)));
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    expect(q('mod-queue-loading')!.getAttribute('role')).toBe('status');
    expect(q('mod-queue-count')).toBeNull();
    resolve(depth());
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('mod-queue-loading')).toBeNull();
    expect(q('mod-queue-count')).not.toBeNull();
  });

  it('shows a plain error in a role=alert (and no MFA offer) for an ordinary failure', async () => {
    forum.getModerationQueueDepth.and.rejectWith(new Error('GET failed: 403'));
    await render();
    const err = q('mod-queue-error')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(q('mod-queue-step-up')).toBeNull();
    expect(q('mod-queue-count')).toBeNull();
  });

  it('offers the MFA challenge with a returnTo back to THIS page on a step-up refusal', async () => {
    forum.getModerationQueueDepth.and.rejectWith(
      new StepUpRequiredError({ retryHeader: 'X-Forum-StepUp', via: 'signal' }, 403, 'requires step-up'),
    );
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/social/forum/moderation');
    await render();
    expect(q('mod-queue-error')).toBeNull();
    const verify = q('mod-queue-step-up')!.querySelector<HTMLAnchorElement>('[data-testid="mod-queue-step-up-verify"]')!;
    expect(verify.getAttribute('href')).toBe(
      `${MFA_CHALLENGE_ROUTE}?returnTo=${encodeURIComponent('/social/forum/moderation')}`,
    );
  });

  it('"Check again" reloads and clears a previous step-up offer', async () => {
    forum.getModerationQueueDepth.and.rejectWith(
      new StepUpRequiredError({ retryHeader: null, via: 'legacy-phrase' }, 403, 'requires step-up'),
    );
    await render();
    expect(q('mod-queue-step-up')).not.toBeNull();

    forum.getModerationQueueDepth.and.resolveTo(depth({ depth: 2 }));
    q('mod-queue-refresh')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(forum.getModerationQueueDepth).toHaveBeenCalledTimes(2);
    expect(q('mod-queue-step-up')).toBeNull();
    expect(q('mod-queue-count')!.textContent).toContain('2 posts');
  });

  it('a caller who is not a forum moderator sees the gate message and fires NO request', async () => {
    canModerate.set(false);
    await render();
    expect(q('mod-queue-gated')).not.toBeNull();
    expect(q('mod-queue-refresh')).toBeNull();
    await component.load();
    expect(forum.getModerationQueueDepth).not.toHaveBeenCalled();
  });

  it('loads once the session hydrates and the role arrives after the page opened', async () => {
    canModerate.set(false);
    await render();
    expect(forum.getModerationQueueDepth).not.toHaveBeenCalled();

    canModerate.set(true);
    await render();
    expect(forum.getModerationQueueDepth).toHaveBeenCalledTimes(1);
    expect(q('mod-queue-gated')).toBeNull();
    expect(q('mod-queue-count')).not.toBeNull();
  });
});
