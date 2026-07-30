/** A single forum-surface announcement, as returned by the admin-bff endpoint
 *  GET /bff/announcements/forum. The BFF only emits ACTIVE announcements
 *  targeted at the forum MAIN page (state=published, now within
 *  [starts_at,ends_at] and target_forum=true), so the forum renders what it is
 *  given, in the server-supplied priority order.
 *
 *  Mirrors the host HomeAnnouncement contract. `body_html` is sanitized
 *  server-side at create/update, but is STILL rendered inside a sandboxed
 *  null-origin srcdoc iframe here — never via raw innerHTML — as a second line
 *  of defence (the same model the host + login banners use). */
export interface ForumAnnouncement {
  /** Stable uuid; also the localStorage dismiss key. */
  id: string;
  title: string;
  /** Server-sanitized admin HTML, rendered inside a sandboxed srcdoc iframe. */
  body_html: string;
  /** Higher first. The BFF lists in priority order; we re-sort defensively. */
  priority: number;
  /** When false, the banner hides the dismiss control and stays pinned. */
  dismissible: boolean;
  /** ISO-8601; null = active since forever. Used only for a defensive re-check. */
  starts_at: string | null;
  /** ISO-8601; null = open-ended. Used only for a defensive re-check. */
  ends_at: string | null;
}
