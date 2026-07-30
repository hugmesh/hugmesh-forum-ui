import { Component, OnInit, Type, inject, signal } from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';

/** Resolve the user remote's standalone ProfileComponent (exposed module
 *  './profile') — the SAME federated user-profile fragment the host profile
 *  modal mounts. Indirected through a holder so unit tests can stub the loader
 *  (the native-federation ESM namespace export is read-only and can't be spied).
 *  This is the platform-wide profile; the forum NEVER renders a phpBB
 *  profile/memberlist page (those stay blocked, headless). */
export const forumProfileRemoteLoader = {
  load: (): Promise<Type<unknown>> =>
    loadRemoteModule('user', './profile').then(
      (m) => (m as { ProfileComponent: Type<unknown> }).ProfileComponent,
    ),
};

/**
 * FORUM PROFILE route. When a poster's name is clicked in the forum, this route
 * EMBEDS OUR OWN federated user-profile fragment (the user remote's ./profile,
 * the same profile shown elsewhere on the platform) instead of a phpBB native
 * profile. hugmesh-forum-bff-api maps the phpBB user ↔ our Casdoor identity
 * so the `:subject` route param is the platform subject the fragment resolves.
 *
 * One unified profile across the whole platform; phpBB's profile/memberlist
 * pages stay BLOCKED (headless + default-UI-blocking). A 404'd/hidden profile
 * (profile-ban / self-silence) shows the same way here as everywhere — the
 * fragment owns that behaviour.
 *
 * a11y: an h1 region heading; a role="status" while the fragment loads and a
 * role="alert" if it fails; the embedded fragment carries its own a11y.
 */
@Component({
  selector: 'hug-forum-profile',
  standalone: true,
  imports: [CommonModule, NgComponentOutlet],
  templateUrl: './forum-profile.component.html',
  styleUrl: './forum-profile.component.scss',
})
export class ForumProfileComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  /** The platform subject (Casdoor sub) of the poster, from the route. Passed
   *  to the fragment as an input so it resolves the right profile. */
  readonly subject = signal<string>('');
  /** The lazily-resolved remote ProfileComponent class for NgComponentOutlet. */
  readonly profileComponent = signal<Type<unknown> | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');

  /** Inputs forwarded to the embedded fragment (it reads `subject`). */
  readonly profileInputs = signal<Record<string, unknown>>({});

  /**
   * Subscribe to the `:subject` route param and keep `profileInputs` in sync
   * so that navigating between posters reuses the already-loaded fragment
   * class and simply rebinds the input.
   * Also triggers the one-time remote module load via {@link loadFragment}.
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const subject = p.get('subject') ?? '';
      this.subject.set(subject);
      // Keep the NgComponentOutlet inputs map in sync with the current subject.
      this.profileInputs.set({ subject });
    });
    this.loadFragment();
  }

  /**
   * Lazily load the `user` remote's `./profile` exposed module via
   * Module Federation. Populates {@link profileComponent} on success so
   * `<ng-container [ngComponentOutlet]>` can mount it; sets {@link loadError}
   * on failure so the template shows a role="alert" message.
   *
   * The load is intentionally a one-time operation: subject changes reuse the
   * already-resolved component class and are handled by rebinding `profileInputs`.
   */
  private loadFragment(): void {
    this.loading.set(true);
    this.loadError.set('');
    forumProfileRemoteLoader
      .load()
      .then((cmp) => this.profileComponent.set(cmp))
      .catch(() => this.loadError.set('Could not load this profile. Please try again.'))
      .finally(() => this.loading.set(false));
  }
}
