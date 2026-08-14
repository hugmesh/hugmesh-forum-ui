import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the Forum remote. Only used when this remote is run
 * on its own (`ng serve forum`); in production the hugmesh.net host
 * federates `./routes` (FORUM_ROUTES) directly and mounts them at /social/forum
 * — this shell is not loaded.
 */
@Component({
  selector: 'hug-forum-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
