import { Injectable } from '@angular/core';

/** The runtime brand contract the host MAY inject before loadRemoteModule.
 *  Model A (recommended in the design) never injects this — the static --hug-*
 *  SCSS tokens are rebranded at build via rebrand_sysroot, one image per brand.
 *  Model B (a genuine runtime multi-brand contract) would set
 *  globalThis.__HUG_BRAND__ in the HOST; this service reads it with safe
 *  static fallbacks so the forum works under EITHER model. */
export interface HugBrand {
  /** Display name shown in the forum header (default "HugMesh Forum"). */
  forumName?: string;
  /** Token overrides applied to the forum root as --forum-* custom properties.
   *  Keys are the unprefixed token names (accent, surface, text, …). */
  tokens?: Partial<Record<ForumTokenName, string>>;
}

export type ForumTokenName =
  | 'bg'
  | 'surface'
  | 'border'
  | 'text'
  | 'text-muted'
  | 'accent'
  /** Text drawn ON a filled accent. A Model B host that overrides `accent`
   *  MUST be able to override this too: --forum-accent-on otherwise resolves
   *  to the PLATFORM accent's luminance pick, which can be the wrong pole for
   *  the brand's accent and reintroduce the unreadable-label bug. */
  | 'accent-on'
  | 'accent-soft'
  | 'success'
  | 'error';

/**
 * Owns the forum's runtime branding. The forum is unbranded by design at the
 * phpBB layer (no phpBB CSS reaches the browser); ALL chrome/colour lives in
 * the --hug-* and --forum-* tokens declared in styles.scss.
 *
 * This service reads `globalThis.__HUG_BRAND__` (Model B) if the host injected
 * it, otherwise it is a no-op and the static build-time tokens (Model A) win.
 * Either way the forum renders with a WCAG-AA default palette.
 */
@Injectable({ providedIn: 'root' })
export class ForumBrandService {
  private readonly brand: HugBrand = this.read();

  /** The forum display name for the header. Defaults to the branded
   *  "HugMesh Forum" so the surface carries brand presence under Model A
   *  (no host injection); a Model B host may override via
   *  __HUG_BRAND__.forumName for a per-brand deployment. */
  get forumName(): string {
    return this.brand.forumName?.trim() || 'HugMesh Forum';
  }

  /** Apply any brand token overrides to a root element as --forum-* custom
   *  properties. A no-op under Model A (no __HUG_BRAND__ injected). Safe to
   *  call from a component's host element after view init.
   *
   *  NOTE: no component in this remote currently calls this — Model A
   *  (build-time rebrand_sysroot tokens) is the only model exercised by the
   *  running app today. This method exists for a Model B host integration
   *  (runtime __HUG_BRAND__.tokens) that has not yet been wired up; a host
   *  adopting Model B must invoke it explicitly, e.g. from a root component's
   *  AfterViewInit. */
  applyTo(root: HTMLElement | null | undefined): void {
    if (!root || !this.brand.tokens) return;
    for (const [name, value] of Object.entries(this.brand.tokens)) {
      if (typeof value === 'string' && value) {
        root.style.setProperty(`--forum-${name}`, value);
      }
    }
  }

  private read(): HugBrand {
    try {
      const b = (globalThis as unknown as { __HUG_BRAND__?: HugBrand }).__HUG_BRAND__;
      return b && typeof b === 'object' ? b : {};
    } catch {
      return {};
    }
  }
}
