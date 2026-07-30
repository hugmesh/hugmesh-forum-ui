import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForumAnnouncementsComponent } from './forum-announcements.component';
import { ForumAnnouncementsService } from './forum-announcements.service';
import { ForumAnnouncement } from './forum-announcement.model';
import { signal } from '@angular/core';

function ann(over: Partial<ForumAnnouncement> = {}): ForumAnnouncement {
  return {
    id: 'a1',
    title: 'Maintenance window',
    body_html: '<p>Heads up</p>',
    priority: 1,
    dismissible: true,
    starts_at: null,
    ends_at: null,
    ...over,
  };
}

describe('ForumAnnouncementsComponent', () => {
  let fixture: ComponentFixture<ForumAnnouncementsComponent>;
  let service: jasmine.SpyObj<ForumAnnouncementsService> & { visible: ReturnType<typeof signal> };

  beforeEach(async () => {
    const visible = signal<ForumAnnouncement[]>([]);
    service = jasmine.createSpyObj<ForumAnnouncementsService>('ForumAnnouncementsService', ['load', 'dismiss']) as never;
    (service as unknown as { visible: typeof visible }).visible = visible;
    service.load.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [ForumAnnouncementsComponent],
      providers: [{ provide: ForumAnnouncementsService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(ForumAnnouncementsComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('loads on init and renders nothing when there are no announcements', () => {
    fixture.detectChanges();
    expect(service.load).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="forum-announcements"]')).toBeNull();
  });

  it('renders a labelled aria-live region with the announcement title', () => {
    (service as unknown as { visible: ReturnType<typeof signal> }).visible.set([ann({ title: 'Hello forum' })]);
    fixture.detectChanges();
    const region = el().querySelector('[data-testid="forum-announcements"]')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(el().querySelector('[data-testid="forum-announcement-title"]')!.textContent).toContain('Hello forum');
  });

  it('renders the body in a sandboxed null-origin srcdoc iframe (no scripts, no same-origin)', () => {
    (service as unknown as { visible: ReturnType<typeof signal> }).visible.set([ann()]);
    fixture.detectChanges();
    const iframe = el().querySelector<HTMLIFrameElement>('[data-testid="forum-announcement-body"]')!;
    // sandbox="" = maximally restricted: NEITHER allow-scripts NOR allow-same-origin.
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('srcdoc')).toBeTruthy();
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('styles the iframe body/links from the --hug-* palette, never the host gold', () => {
    (service as unknown as { visible: ReturnType<typeof signal> }).visible.set([ann()]);
    fixture.detectChanges();
    const iframe = el().querySelector<HTMLIFrameElement>('[data-testid="forum-announcement-body"]')!;
    const srcdoc = iframe.getAttribute('srcdoc')!;
    // Gold (#ffd700) is host-shell chrome only — it must NOT leak into the remote.
    expect(srcdoc).not.toContain('#ffd700');
    // Links use the accent-TEXT token (#b388ff, the resolved --hug-accent-soft),
    // body copy uses --hug-text (#e8e8f0) — both from the HugMesh contract.
    expect(srcdoc.toLowerCase()).toContain('a{color:#b388ff}');
    expect(srcdoc.toLowerCase()).toContain('color:#e8e8f0');
  });

  it('a dismissible announcement renders a labelled dismiss button that calls the service', () => {
    (service as unknown as { visible: ReturnType<typeof signal> }).visible.set([ann({ id: 'x9', dismissible: true })]);
    fixture.detectChanges();
    const btn = el().querySelector<HTMLButtonElement>('[data-testid="forum-announcement-dismiss"]')!;
    expect(btn.getAttribute('aria-label')).toContain('Dismiss announcement');
    btn.click();
    // The component dismisses by id (the service's dismiss-once key).
    expect(service.dismiss).toHaveBeenCalledWith('x9');
  });

  it('hides the dismiss control for a non-dismissible (pinned) announcement', () => {
    (service as unknown as { visible: ReturnType<typeof signal> }).visible.set([ann({ dismissible: false })]);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="forum-announcement-dismiss"]')).toBeNull();
  });
});
