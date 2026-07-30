import { Component, OnInit, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  VN_ACCENT_RE,
  VOICEBOX_STYLES,
  VOICE_STYLES,
  VnProfile,
  VnProfileService,
  VoiceStyle,
  VoiceboxStyle,
} from './vn-profile.service';
import { StickerMeta, StickerService } from './sticker.service';
import { stickerBodyUrl } from './stickers';

/** The one same-origin characterImgRef the editor can set: the caller's own
 *  character avatar served by the platform user-bff. */
export const VN_AVATAR_REF = '/bff/user/character/avatar';

/**
 * Compact VN profile editor (reached from the forum index header): pick a
 * character sticker (or none) as the post sprite, optionally use the platform
 * character avatar instead, choose a voicebox skin (radio swatches with a mini
 * preview of each skin), an accent colour, and a read-aloud voice style.
 * Saves via PUT /bff/forum/vn-profiles/me — the subject always comes from the
 * JWT server-side, never from this body.
 *
 * Fail-soft: the sticker chooser is hidden when the sticker endpoint is
 * unavailable; loading errors leave the classic defaults in place.
 *
 * a11y: a labelled region; every control is labelled; radios are grouped in
 * fieldsets with legends; the save outcome is announced via a live region.
 */
@Component({
  selector: 'hug-forum-vn-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vn-profile-editor.component.html',
  styleUrl: './vn-profile-editor.component.scss',
})
export class VnProfileEditorComponent implements OnInit {
  private readonly vn = inject(VnProfileService);
  private readonly stickerSvc = inject(StickerService);

  readonly skins = VOICEBOX_STYLES;
  readonly voices = VOICE_STYLES;

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly status = signal('');

  /** null = sticker endpoint unavailable — hide the sticker chooser. */
  readonly stickers = signal<readonly StickerMeta[] | null>(null);
  readonly stickerSlug = signal<string | null>(null);
  readonly useAvatar = signal(false);
  readonly skin = signal<VoiceboxStyle>('classic');
  readonly accentEnabled = signal(false);
  readonly accent = signal('#7c4dff');
  /** '' = no explicit voice style (null on the wire). */
  readonly voiceStyle = signal<VoiceStyle | ''>('');

  /** Emits the saved profile so the opener can close the panel / restyle. */
  readonly saved = output<VnProfile>();

  /** Seed the controls from the caller's current profile + sticker list. */
  async ngOnInit(): Promise<void> {
    const [profile, stickers] = await Promise.all([this.vn.getMe(), this.stickerSvc.listOwn()]);
    this.stickers.set(stickers);
    if (profile) {
      this.stickerSlug.set(profile.stickerSlug);
      this.useAvatar.set(profile.characterImgRef === VN_AVATAR_REF);
      this.skin.set(profile.voiceboxStyle);
      this.accentEnabled.set(profile.voiceboxAccent !== null);
      if (profile.voiceboxAccent) this.accent.set(profile.voiceboxAccent);
      this.voiceStyle.set(profile.voiceStyle ?? '');
    }
    this.loading.set(false);
  }

  /**
   * Thumbnail URL for a sticker option.
   *
   * @param slug - The sticker slug.
   * @returns The same-origin body URL, or '' for an invalid slug.
   */
  bodyUrl(slug: string): string {
    return stickerBodyUrl(slug) ?? '';
  }

  /**
   * Hide a sticker thumbnail whose body no longer resolves (a deleted /
   * rejected / still-PENDING sticker 404s at the serve route). Fail-soft at the
   * pixel level — the radio option keeps its label, never a broken-image glyph.
   *
   * @param ev - The img error event.
   */
  hideBrokenThumb(ev: Event): void {
    (ev.target as HTMLElement | null)?.setAttribute('hidden', '');
  }

  /** Whether the accent input currently holds a usable #rrggbb value. */
  accentValid(): boolean {
    return !this.accentEnabled() || VN_ACCENT_RE.test(this.accent().toLowerCase());
  }

  /**
   * Save the profile.
   * Calls PUT /bff/forum/vn-profiles/me with the picked values (nulls clear).
   * The accent is lowercased + re-validated before it is ever sent (client
   * mirror of the server's ^#[0-9a-f]{6}$ rule).
   */
  async save(): Promise<void> {
    const accent = this.accentEnabled() ? this.accent().toLowerCase() : null;
    if (accent !== null && !VN_ACCENT_RE.test(accent)) {
      this.error.set('Accent must be a #rrggbb colour.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.status.set('');
    try {
      const saved = await this.vn.saveMe({
        stickerSlug: this.stickerSlug(),
        characterImgRef: this.useAvatar() ? VN_AVATAR_REF : null,
        voiceboxStyle: this.skin(),
        voiceboxAccent: accent,
        voiceStyle: this.voiceStyle() || null,
      });
      this.status.set('VN profile saved.');
      this.saved.emit(saved);
    } catch {
      this.error.set('Could not save your VN profile. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
