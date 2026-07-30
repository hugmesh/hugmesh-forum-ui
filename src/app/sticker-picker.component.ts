import { Component, ElementRef, OnInit, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { StickerMeta, StickerService } from './sticker.service';
import { stickerBodyUrl } from './stickers';

/**
 * "Insert sticker" toggle + panel for the composers (create-topic body and the
 * topic-detail inline reply). Lists the caller's OWN stickers (thumbnails from
 * /bff/user/character/stickers/{slug}/body) and emits the picked slug — the
 * host composer inserts the `:snap-sticker:<slug>:` token at its caret.
 *
 * Feature-detecting: the whole control is hidden when the sticker endpoint is
 * unavailable (or the caller owns no stickers) — see StickerService.listOwn.
 *
 * a11y: the toggle carries aria-expanded; each sticker button has an
 * aria-label naming the sticker; thumbnails are decorative (alt=""); the open
 * panel is keyboard operable — Tab/Enter natively, Arrow keys move between
 * stickers, Escape closes and returns focus to the toggle.
 */
@Component({
  selector: 'hug-forum-sticker-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sticker-picker.component.html',
  styleUrl: './sticker-picker.component.scss',
})
export class StickerPickerComponent implements OnInit {
  private readonly stickerSvc = inject(StickerService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** null = endpoint unavailable (hide); [] = none owned (also hidden). */
  readonly stickers = signal<readonly StickerMeta[] | null>(null);
  readonly open = signal(false);

  /** Emits the picked sticker slug (charset-validated upstream + on render). */
  readonly insert = output<string>();

  /** Probe the caller's sticker list once on init (memoized in the service). */
  async ngOnInit(): Promise<void> {
    this.stickers.set(await this.stickerSvc.listOwn());
  }

  /**
   * Thumbnail URL for a slug (same-origin sticker body endpoint).
   *
   * @param slug - The sticker slug.
   * @returns The constructed URL, or '' for an invalid slug (renders nothing).
   */
  bodyUrl(slug: string): string {
    return stickerBodyUrl(slug) ?? '';
  }

  /**
   * Hide a thumbnail whose sticker body no longer resolves (a deleted /
   * rejected / still-PENDING-for-another-user sticker 404s at the serve route).
   * Fail-soft at the pixel level: the picker keeps its layout and never shows a
   * broken-image glyph — matching the topic-detail sprite's (error) handler.
   *
   * @param ev - The img error event.
   */
  hideBrokenThumb(ev: Event): void {
    (ev.target as HTMLElement | null)?.setAttribute('hidden', '');
  }

  /**
   * Emit the picked slug to the host composer and close the panel.
   *
   * @param slug - The picked sticker slug.
   */
  pick(slug: string): void {
    this.insert.emit(slug);
    this.open.set(false);
  }

  /**
   * Keyboard support for the open panel (a11y): ArrowRight/ArrowDown move to
   * the next sticker, ArrowLeft/ArrowUp to the previous (wrapping), Escape
   * closes the panel and returns focus to the toggle. Enter/Space activation
   * and Tab order are native button behaviour.
   *
   * @param ev - The keydown event from the panel.
   */
  onPanelKeydown(ev: KeyboardEvent): void {
    const root = this.host.nativeElement as HTMLElement;
    if (ev.key === 'Escape') {
      this.open.set(false);
      root.querySelector<HTMLButtonElement>('[data-testid="sticker-toggle"]')?.focus();
      // Escape is consumed here — don't also close an enclosing panel/dialog.
      ev.stopPropagation();
      return;
    }
    const forward = ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
    if (!forward && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowUp') return;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.sticker-picker__item'));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? 0 : (current + (forward ? 1 : items.length - 1)) % items.length;
    items[next].focus();
    ev.preventDefault();
  }
}
