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
import { CharacterAvatarService } from './character-avatar.service';
import { isCharacterAvatarBodyUrl, isLegacyCharacterAvatarRef } from './character-avatar';

/**
 * Compact VN profile editor (reached from the forum index header): pick a
 * character sticker (or none) as the post sprite, optionally use the platform
 * character avatar instead, choose a voicebox skin (radio swatches with a mini
 * preview of each skin), an accent colour, and a read-aloud voice style.
 * Saves via PUT /bff/forum/vn-profiles/me — the subject always comes from the
 * JWT server-side, never from this body.
 *
 * The avatar option stores a RESOLVED image URL
 * ({@link CharacterAvatarService}: `/bff/user/character/avatar/{ref}/body`),
 * never the bare handle path. Storing the bare path is the defect
 * hugmesh-forum-bff-api issue #3 tracked: it named no owner, so a reader's
 * browser had nothing to fetch and every avatar sprite rendered broken.
 *
 * Fail-soft: the sticker chooser is hidden when the sticker endpoint is
 * unavailable, and so is the avatar option when the caller has no stored
 * picture (or the endpoint is unavailable); loading errors leave the classic
 * defaults in place.
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
  private readonly avatarSvc = inject(CharacterAvatarService);

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
  /** The caller's resolved character-avatar image URL, or null = no avatar /
   *  endpoint unavailable — hide the avatar option (feature-detect). */
  readonly avatarUrl = signal<string | null>(null);
  /** The characterImgRef the profile was loaded with, kept so a transient
   *  avatar-probe failure cannot silently clear an ALREADY-resolvable ref on an
   *  unrelated save. */
  private storedImgRef: string | null = null;
  readonly skin = signal<VoiceboxStyle>('classic');
  readonly accentEnabled = signal(false);
  readonly accent = signal('#7c4dff');
  /** '' = no explicit voice style (null on the wire). */
  readonly voiceStyle = signal<VoiceStyle | ''>('');

  /** Emits the saved profile so the opener can close the panel / restyle. */
  readonly saved = output<VnProfile>();

  /** Seed the controls from the caller's current profile + sticker list +
   *  resolved character-avatar URL. */
  async ngOnInit(): Promise<void> {
    const [profile, stickers, avatarUrl] = await Promise.all([
      this.vn.getMe(),
      this.stickerSvc.listOwn(),
      this.avatarSvc.myImageUrl(),
    ]);
    this.stickers.set(stickers);
    this.avatarUrl.set(avatarUrl);
    if (profile) {
      this.storedImgRef = profile.characterImgRef;
      this.stickerSlug.set(profile.stickerSlug);
      // Ticked for a resolved avatar ref AND for the legacy bare-path ref, so a
      // profile saved before the serve route existed shows its true intent and
      // is rewritten to a resolvable URL on the next save.
      this.useAvatar.set(
        isCharacterAvatarBodyUrl(profile.characterImgRef) || isLegacyCharacterAvatarRef(profile.characterImgRef),
      );
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

  /**
   * The characterImgRef to save: the resolved avatar image URL when the option
   * is on, else null.
   *
   * When the option is on but this session could not resolve a URL (the probe
   * failed / the endpoint was down), an ALREADY-resolvable stored ref is kept
   * verbatim rather than cleared — an unrelated save must not drop the user's
   * sprite over a transient failure. A legacy bare-path ref is NOT kept: it
   * never resolved for a reader, so clearing it is the repair.
   *
   * @returns The ref to send, or null to clear.
   */
  private refToSave(): string | null {
    if (!this.useAvatar()) return null;
    const resolved = this.avatarUrl();
    if (resolved) return resolved;
    return isCharacterAvatarBodyUrl(this.storedImgRef) ? this.storedImgRef : null;
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
        characterImgRef: this.refToSave(),
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
