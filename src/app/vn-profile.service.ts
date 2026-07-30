import { Injectable, inject } from '@angular/core';

import { FORUM_BASE_URL } from './forum.service';
import { STICKER_SLUG_RE } from './stickers';

/**
 * VN (visual-novel) profile layer for forum posts: per-author character
 * sprite, voicebox skin + accent, and a speech-synthesis voice style.
 *
 * PINNED API CONTRACT (mirrored by hugmesh-forum-bff-api — do not drift):
 * - GET  /bff/forum/vn-profiles/me      -> the caller's profile (never 404;
 *   the server synthesizes classic defaults when no row exists).
 * - PUT  /bff/forum/vn-profiles/me      -> save; subject ALWAYS from the JWT.
 * - POST /bff/forum/vn-profiles/lookup  -> {"profiles":{subject: {...}}} for
 *   1..50 deduped subjects; subjects with no row are simply absent.
 *
 * Everything here is FAIL-SOFT: any error degrades to "no profile" and the
 * posts render exactly as they do today.
 */

/** Server-enforced voicebox skin allowlist (client mirror). */
export const VOICEBOX_STYLES = ['classic', 'glass', 'retro', 'neon', 'paper'] as const;
export type VoiceboxStyle = (typeof VOICEBOX_STYLES)[number];

/** Server-enforced voice-style allowlist (client mirror); null = default voice. */
export const VOICE_STYLES = ['warm', 'bright', 'deep', 'soft', 'robot'] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

/** Accent must be a strict lowercase #rrggbb (server contract mirror). */
export const VN_ACCENT_RE = /^#[0-9a-f]{6}$/;

/** characterImgRef must be a same-origin path under this prefix (it is
 *  rendered as an <img src>, so the allowlist is strict). */
export const VN_CHARACTER_IMG_PREFIX = '/bff/user/';

/** Max characterImgRef length (server contract mirror). */
export const VN_CHARACTER_IMG_MAX_LENGTH = 256;

/** speechSynthesis pitch/rate tuning per voice style (see task contract). */
export const VOICE_TUNING: Readonly<Record<VoiceStyle, { pitch: number; rate: number }>> = {
  warm: { pitch: 1.0, rate: 0.95 },
  bright: { pitch: 1.3, rate: 1.1 },
  deep: { pitch: 0.7, rate: 0.9 },
  soft: { pitch: 1.1, rate: 0.85 },
  robot: { pitch: 0.5, rate: 1.0 },
};

export interface VnProfile {
  subject: string;
  stickerSlug: string | null;
  characterImgRef: string | null;
  voiceboxStyle: VoiceboxStyle;
  voiceboxAccent: string | null;
  voiceStyle: VoiceStyle | null;
}

/** PUT /bff/forum/vn-profiles/me body. subject NEVER travels in the body —
 *  the BFF derives it from the JWT (Authentication.getName()). */
export interface VnProfileSaveRequest {
  stickerSlug?: string | null;
  characterImgRef?: string | null;
  voiceboxStyle: VoiceboxStyle;
  voiceboxAccent?: string | null;
  voiceStyle?: VoiceStyle | null;
}

/**
 * Whether `ref` is safe to render as an `<img src>`: a same-origin path under
 * the strict `/bff/user/` allowlist, bounded length, no traversal and none of
 * the characters that could re-interpret the value in an attribute context.
 * The server enforces the same allowlist; this is the client's own guard.
 *
 * @param ref - The candidate characterImgRef.
 * @returns `true` only for an allowlisted same-origin path.
 */
export function isSafeCharacterImgRef(ref: string): boolean {
  return (
    typeof ref === 'string' &&
    ref.startsWith(VN_CHARACTER_IMG_PREFIX) &&
    ref.length <= VN_CHARACTER_IMG_MAX_LENGTH &&
    !ref.includes('..') &&
    !/[\s<>"'`\\]/.test(ref)
  );
}

/**
 * Apply an author's voicebox skin to a post `<article>`: set the
 * `data-vnskin` attribute (allowlisted values ONLY) and the
 * `--forum-vnbox-accent` custom property (strict #rrggbb re-validation before
 * `setProperty`, mirroring ForumBrandService's CSS-var override pattern).
 * Anything invalid clears the attribute/property instead — an attacker-shaped
 * value can never reach the style engine.
 *
 * @param el - The post article element.
 * @param style - The author's voiceboxStyle (validated against the allowlist).
 * @param accent - The author's voiceboxAccent (validated as #rrggbb).
 */
export function applyVoicebox(el: HTMLElement, style: string | null | undefined, accent: string | null | undefined): void {
  if (typeof style === 'string' && (VOICEBOX_STYLES as readonly string[]).includes(style)) {
    el.setAttribute('data-vnskin', style);
  } else {
    el.removeAttribute('data-vnskin');
  }
  if (typeof accent === 'string' && VN_ACCENT_RE.test(accent)) {
    el.style.setProperty('--forum-vnbox-accent', accent);
  } else {
    el.style.removeProperty('--forum-vnbox-accent');
  }
}

/**
 * Normalize + validate a raw wire profile into a {@link VnProfile}. Every
 * field is re-validated client-side (allowlists / regexes / same-origin img
 * guard) so a compromised upstream can never smuggle an unexpected value into
 * the DOM. Invalid fields degrade to their safe default rather than dropping
 * the whole profile.
 *
 * @param subject - The subject this profile belongs to.
 * @param raw - The untrusted wire object.
 * @returns A validated profile, or `null` when `raw` is not an object.
 */
export function normalizeVnProfile(subject: string, raw: unknown): VnProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const style = r['voiceboxStyle'];
  const slug = r['stickerSlug'];
  const img = r['characterImgRef'];
  const accent = r['voiceboxAccent'];
  const voice = r['voiceStyle'];
  return {
    subject,
    stickerSlug: typeof slug === 'string' && STICKER_SLUG_RE.test(slug) ? slug : null,
    characterImgRef: typeof img === 'string' && isSafeCharacterImgRef(img) ? img : null,
    voiceboxStyle:
      typeof style === 'string' && (VOICEBOX_STYLES as readonly string[]).includes(style) ? (style as VoiceboxStyle) : 'classic',
    voiceboxAccent: typeof accent === 'string' && VN_ACCENT_RE.test(accent) ? accent : null,
    voiceStyle: typeof voice === 'string' && (VOICE_STYLES as readonly string[]).includes(voice) ? (voice as VoiceStyle) : null,
  };
}

/** Indirected so unit tests can stub the network without touching native fetch
 *  (the same pattern as forumAnnouncementsFetcher). */
export const vnProfileFetcher = {
  fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  },
};

/** Contract cap: at most 50 subjects per lookup POST. */
const LOOKUP_CHUNK = 50;

/**
 * Fetch wrapper for the vn-profiles endpoints with an in-memory per-session
 * cache and request coalescing: every {@link lookup} caller in the same
 * microtask contributes its subjects to ONE batched POST (so a topic page —
 * however many posts — costs a single lookup); subjects with no row are
 * cached as `null` so they are never re-asked this session. Errors are NOT
 * cached (a later page retries) and always degrade to "no profile".
 */
@Injectable({ providedIn: 'root' })
export class VnProfileService {
  private readonly base = inject(FORUM_BASE_URL);

  /** subject -> profile (or null = known miss). Per-session, in-memory. */
  private readonly cache = new Map<string, VnProfile | null>();
  /** subject -> resolution promise for a batch already sent (or being built). */
  private readonly inflight = new Map<string, Promise<VnProfile | null>>();
  /** The batch being collected this microtask (flushed once, then reset). */
  private batch: Map<string, (v: VnProfile | null) => void> | null = null;

  /**
   * Load the caller's own VN profile.
   * Calls GET /bff/forum/vn-profiles/me (never 404: the server synthesizes
   * classic defaults when no row exists).
   *
   * @returns The normalized profile, or `null` on any error (fail-soft).
   */
  async getMe(): Promise<VnProfile | null> {
    try {
      const r = await vnProfileFetcher.fetch(`${this.base}/bff/forum/vn-profiles/me`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) return null;
      const raw = (await r.json()) as Record<string, unknown> | null;
      const subject = raw && typeof raw['subject'] === 'string' ? raw['subject'] : '';
      return normalizeVnProfile(subject, raw);
    } catch {
      return null;
    }
  }

  /**
   * Save the caller's VN profile.
   * Calls PUT /bff/forum/vn-profiles/me. The subject is NEVER sent — the BFF
   * takes it from the JWT. Client-side validation mirrors the server's rules
   * so an invalid value fails fast without a network round-trip.
   *
   * @param req - The fields to save.
   * @returns The saved, normalized profile (also refreshed in the cache so
   *   the author's own posts restyle without a reload).
   * @throws When validation fails or the server rejects the write — the
   *   editor surfaces this; the RENDER path stays fail-soft.
   */
  async saveMe(req: VnProfileSaveRequest): Promise<VnProfile> {
    if (!(VOICEBOX_STYLES as readonly string[]).includes(req.voiceboxStyle)) {
      throw new Error('voiceboxStyle must be one of ' + VOICEBOX_STYLES.join(','));
    }
    if (req.voiceboxAccent != null && !VN_ACCENT_RE.test(req.voiceboxAccent)) {
      throw new Error('voiceboxAccent must match #rrggbb');
    }
    if (req.stickerSlug != null && !STICKER_SLUG_RE.test(req.stickerSlug)) {
      throw new Error('invalid stickerSlug');
    }
    if (req.characterImgRef != null && !isSafeCharacterImgRef(req.characterImgRef)) {
      throw new Error('characterImgRef must be a same-origin /bff/user/ path');
    }
    if (req.voiceStyle != null && !(VOICE_STYLES as readonly string[]).includes(req.voiceStyle)) {
      throw new Error('voiceStyle must be one of ' + VOICE_STYLES.join(','));
    }
    const r = await vnProfileFetcher.fetch(`${this.base}/bff/forum/vn-profiles/me`, {
      method: 'PUT',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!r.ok) throw new Error(`PUT /bff/forum/vn-profiles/me failed: ${r.status}`);
    const raw = (await r.json()) as Record<string, unknown> | null;
    const subject = raw && typeof raw['subject'] === 'string' ? raw['subject'] : '';
    const saved =
      normalizeVnProfile(subject, raw) ??
      ({ subject, stickerSlug: null, characterImgRef: null, voiceboxStyle: 'classic', voiceboxAccent: null, voiceStyle: null } as VnProfile);
    if (subject) this.cache.set(subject, saved);
    return saved;
  }

  /**
   * Resolve VN profiles for a page's authors. Coalesced: all callers in the
   * same microtask share ONE POST /bff/forum/vn-profiles/lookup (chunked at
   * the contract's 50-subject cap). Cache hits never re-fetch; misses are
   * cached as `null`.
   *
   * @param subjects - The (possibly repeating) authorSubjects on the page.
   * @returns subject -> profile map containing ONLY subjects that have one.
   *   On any error the affected subjects are simply absent (fail-soft: posts
   *   render exactly as today).
   */
  async lookup(subjects: readonly string[]): Promise<Record<string, VnProfile>> {
    try {
      const distinct = [...new Set(subjects.filter((s): s is string => typeof s === 'string' && s.length > 0))];
      const entries = await Promise.all(
        distinct.map(async (s): Promise<readonly [string, VnProfile | null]> => {
          if (this.cache.has(s)) return [s, this.cache.get(s) ?? null];
          return [s, await this.enqueue(s)];
        }),
      );
      const out: Record<string, VnProfile> = {};
      for (const [s, v] of entries) {
        if (v) out[s] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  /**
   * Add a subject to the microtask batch (creating + scheduling the batch on
   * first use) and return its resolution promise. A subject already in flight
   * reuses its existing promise instead of joining a new batch.
   *
   * @param subject - The subject to look up.
   * @returns The profile (or null) once the batched POST resolves.
   */
  private enqueue(subject: string): Promise<VnProfile | null> {
    const existing = this.inflight.get(subject);
    if (existing) return existing;
    if (!this.batch) {
      this.batch = new Map();
      queueMicrotask(() => {
        const batch = this.batch;
        this.batch = null;
        if (batch) void this.flush(batch);
      });
    }
    const p = new Promise<VnProfile | null>((resolve) => this.batch!.set(subject, resolve));
    this.inflight.set(subject, p);
    return p;
  }

  /**
   * Send the batched lookup (chunked to the contract's 50-subject cap),
   * normalize + cache each result, and resolve every waiter. On error the
   * waiters resolve `null` WITHOUT caching, so a later page retries.
   *
   * @param batch - subject -> resolver map collected this microtask.
   */
  private async flush(batch: Map<string, (v: VnProfile | null) => void>): Promise<void> {
    const subjects = [...batch.keys()];
    for (let i = 0; i < subjects.length; i += LOOKUP_CHUNK) {
      const chunk = subjects.slice(i, i + LOOKUP_CHUNK);
      let profilesRaw: Record<string, unknown> | null = null;
      try {
        const r = await vnProfileFetcher.fetch(`${this.base}/bff/forum/vn-profiles/lookup`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjects: chunk }),
        });
        if (r.ok) {
          const json = (await r.json()) as { profiles?: unknown } | null;
          profilesRaw =
            json && typeof json === 'object' && json.profiles && typeof json.profiles === 'object'
              ? (json.profiles as Record<string, unknown>)
              : {};
        }
      } catch {
        profilesRaw = null; // network error: resolve null below, do NOT cache
      }
      for (const s of chunk) {
        let value: VnProfile | null = null;
        if (profilesRaw !== null) {
          value = normalizeVnProfile(s, profilesRaw[s]);
          this.cache.set(s, value); // a miss is cached as null (contract: absent = no row)
        }
        batch.get(s)?.(value);
        this.inflight.delete(s);
      }
    }
  }
}
