import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot } from '@angular/router';

import { ForumTitleStrategy } from './forum-title.strategy';

describe('ForumTitleStrategy', () => {
  let strategy: ForumTitleStrategy;
  let title: Title;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ForumTitleStrategy, Title] });
    strategy = TestBed.inject(ForumTitleStrategy);
    title = TestBed.inject(Title);
  });

  /** The formatting is the strategy's contribution; buildTitle (inherited) is
   *  Angular's and is stubbed to isolate the branding format. */
  function updateWithSurface(surface: string | undefined): void {
    spyOn(strategy, 'buildTitle').and.returnValue(surface);
    strategy.updateTitle({} as RouterStateSnapshot);
  }

  it('renders "HugMesh Forum — <Surface>" for a titled route', () => {
    updateWithSurface('Topics');
    expect(title.getTitle()).toBe('HugMesh Forum — Topics');
  });

  it('renders the bare brand at the index (no route title)', () => {
    updateWithSurface(undefined);
    expect(title.getTitle()).toBe('HugMesh Forum');
  });

  it('treats an empty surface as the bare brand (no dangling em dash)', () => {
    updateWithSurface('');
    expect(title.getTitle()).toBe('HugMesh Forum');
  });
});
