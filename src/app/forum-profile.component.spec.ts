import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Component, Input } from '@angular/core';
import { of } from 'rxjs';

import { ForumProfileComponent, forumProfileRemoteLoader } from './forum-profile.component';

/** Stand-in for the user remote's exposed ProfileComponent (./profile). It
 *  declares `subject` as a real @Input so NgComponentOutlet's input binding
 *  reaches it (the live fragment does the same). */
@Component({
  selector: 'stub-profile',
  standalone: true,
  template: '<div data-testid="stub-profile">profile of {{ subject }}</div>',
})
class StubProfileComponent {
  @Input() subject = '';
}

/** Flush the loadFragment() promise chain (.then/.finally) so the resolved
 *  remote component is set before assertions run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('ForumProfileComponent', () => {
  let fixture: ComponentFixture<ForumProfileComponent>;
  const route = { paramMap: of({ get: (_: string) => 'google:alice@gmail.com' }) } as unknown as ActivatedRoute;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [ForumProfileComponent],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: route }],
    }).compileComponents();
    fixture = TestBed.createComponent(ForumProfileComponent);
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('embeds OUR federated user-profile fragment (loaded from the user remote ./profile)', async () => {
    spyOn(forumProfileRemoteLoader, 'load').and.resolveTo(StubProfileComponent);
    await setup();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(forumProfileRemoteLoader.load).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="forum-profile-fragment"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="stub-profile"]')!.textContent).toContain('google:alice@gmail.com');
  });

  it('passes the route subject to the embedded fragment as an input', async () => {
    spyOn(forumProfileRemoteLoader, 'load').and.resolveTo(StubProfileComponent);
    await setup();
    fixture.detectChanges();
    await flush();
    expect(fixture.componentInstance.profileInputs()).toEqual({ subject: 'google:alice@gmail.com' });
  });

  it('shows a role=alert when the fragment fails to load', async () => {
    spyOn(forumProfileRemoteLoader, 'load').and.rejectWith(new Error('no remote'));
    await setup();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="forum-profile-error"]')).not.toBeNull();
  });

  it('always renders a single h1 region heading (no phpBB profile chrome)', async () => {
    spyOn(forumProfileRemoteLoader, 'load').and.resolveTo(StubProfileComponent);
    await setup();
    fixture.detectChanges();
    expect(el().querySelectorAll('h1').length).toBe(1);
    expect(el().querySelector('[aria-labelledby="forum-profile-heading"]')).not.toBeNull();
  });
});
