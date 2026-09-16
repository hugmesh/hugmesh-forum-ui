import { TestBed } from '@angular/core/testing';
import { ForumAnnouncementsService, forumAnnouncementsFetcher } from './forum-announcements.service';
import { SessionService, HugSession, sessionFetcher } from './session.service';
import { ForumAnnouncement } from './forum-announcement.model';

function session(over: Partial<HugSession> = {}): HugSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice',
    provider: 'google',
    roles: ['user', 'forum'],
    registrationComplete: true,
    ...over,
  };
}

function ann(over: Partial<ForumAnnouncement> = {}): ForumAnnouncement {
  return {
    id: 'a1',
    title: 'Notice',
    body_html: '<p>hi</p>',
    priority: 1,
    dismissible: true,
    starts_at: null,
    ends_at: null,
    ...over,
  };
}

describe('ForumAnnouncementsService', () => {
  let service: ForumAnnouncementsService;
  let sess: SessionService;

  beforeEach(() => {
    localStorage.clear();
    // The real SessionService probes GET /bff/session on construction; no BFF
    // here, so it falls back to the mirror set() writes.
    spyOn(sessionFetcher, 'fetch').and.rejectWith(new Error('offline'));
    TestBed.configureTestingModule({ providers: [ForumAnnouncementsService, SessionService] });
    sess = TestBed.inject(SessionService);
    service = TestBed.inject(ForumAnnouncementsService);
  });

  afterEach(() => localStorage.clear());

  it('renders nothing when signed out', async () => {
    spyOn(forumAnnouncementsFetcher, 'fetch').and.resolveTo([ann()]);
    await service.load();
    expect(service.visible().length).toBe(0);
  });

  it('loads active forum announcements for an authenticated user, priority desc', async () => {
    sess.set(session());
    spyOn(forumAnnouncementsFetcher, 'fetch').and.resolveTo([
      ann({ id: 'low', priority: 1 }),
      ann({ id: 'high', priority: 9 }),
    ]);
    await service.load();
    expect(service.visible().map((a) => a.id)).toEqual(['high', 'low']);
  });

  it('drops announcements whose window has closed', async () => {
    sess.set(session());
    spyOn(forumAnnouncementsFetcher, 'fetch').and.resolveTo([
      ann({ id: 'expired', ends_at: new Date(Date.now() - 1000).toISOString() }),
      ann({ id: 'live' }),
    ]);
    await service.load();
    expect(service.visible().map((a) => a.id)).toEqual(['live']);
  });

  it('dismiss-once hides the announcement and persists the id', async () => {
    sess.set(session());
    spyOn(forumAnnouncementsFetcher, 'fetch').and.resolveTo([ann({ id: 'a1' })]);
    await service.load();
    expect(service.visible().length).toBe(1);
    service.dismiss('a1');
    expect(service.visible().length).toBe(0);
    expect(localStorage.getItem('hug.forum.announcements.dismissed')).toContain('a1');
  });

  it('a non-dismissible announcement cannot be dismissed', async () => {
    sess.set(session());
    spyOn(forumAnnouncementsFetcher, 'fetch').and.resolveTo([ann({ id: 'pinned', dismissible: false })]);
    await service.load();
    service.dismiss('pinned');
    expect(service.visible().length).toBe(1);
  });

  it('a failed fetch leaves the banner empty and records the error', async () => {
    sess.set(session());
    spyOn(forumAnnouncementsFetcher, 'fetch').and.rejectWith(new Error('boom'));
    await service.load();
    expect(service.visible().length).toBe(0);
    expect(service.loadError()).toContain('boom');
  });
});
