import { TestBed } from '@angular/core/testing';
import { ForumBrandService } from './forum-brand.service';

describe('ForumBrandService', () => {
  afterEach(() => {
    delete (globalThis as unknown as { __HUG_BRAND__?: unknown }).__HUG_BRAND__;
  });

  function make(): ForumBrandService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ForumBrandService] });
    return TestBed.inject(ForumBrandService);
  }

  it('defaults to "HugMesh Forum" with no brand injected (Model A — branded by default)', () => {
    expect(make().forumName).toBe('HugMesh Forum');
  });

  it('falls back to the branded default when an injected forumName is blank/whitespace', () => {
    (globalThis as unknown as { __HUG_BRAND__?: unknown }).__HUG_BRAND__ = { forumName: '   ' };
    expect(make().forumName).toBe('HugMesh Forum');
  });

  it('reads __HUG_BRAND__.forumName when the host injects it (Model B)', () => {
    (globalThis as unknown as { __HUG_BRAND__?: unknown }).__HUG_BRAND__ = { forumName: 'Fluffy Forum' };
    expect(make().forumName).toBe('Fluffy Forum');
  });

  it('applyTo writes brand token overrides as --forum-* custom properties', () => {
    (globalThis as unknown as { __HUG_BRAND__?: unknown }).__HUG_BRAND__ = {
      tokens: { accent: '#abcdef' },
    };
    const svc = make();
    const el = document.createElement('div');
    svc.applyTo(el);
    expect(el.style.getPropertyValue('--forum-accent')).toBe('#abcdef');
  });

  it('applyTo is a no-op when nothing is injected', () => {
    const svc = make();
    const el = document.createElement('div');
    svc.applyTo(el);
    expect(el.style.getPropertyValue('--forum-accent')).toBe('');
  });
});
