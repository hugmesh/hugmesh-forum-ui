import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ForumSearchComponent } from './forum-search.component';
import { ForumService, ForumSearchResult } from './forum.service';

describe('ForumSearchComponent', () => {
  let fixture: ComponentFixture<ForumSearchComponent>;
  let component: ForumSearchComponent;
  let forum: jasmine.SpyObj<ForumService>;

  const results: ForumSearchResult = {
    topics: [
      {
        id: 1,
        categoryId: 1,
        title: 'Found topic',
        authorSubject: 's',
        authorLabel: 'a',
        replyCount: 0,
        viewCount: 0,
        locked: false,
        createdAt: '',
        lastPostAt: '',
      },
    ],
    posts: [],
  };

  beforeEach(async () => {
    forum = jasmine.createSpyObj<ForumService>('ForumService', ['search']);
    forum.search.and.resolveTo(results);

    await TestBed.configureTestingModule({
      imports: [ForumSearchComponent],
      providers: [provideRouter([]), { provide: ForumService, useValue: forum }],
    }).compileComponents();

    fixture = TestBed.createComponent(ForumSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a labelled role=search form', () => {
    expect(el().querySelector('form[role="search"]')).not.toBeNull();
    expect(el().querySelector('label[for="forum-search-input"]')).not.toBeNull();
  });

  it('does not search on an empty query', async () => {
    component.query.set('   ');
    await component.search();
    expect(forum.search).not.toHaveBeenCalled();
  });

  it('searches and renders grouped results with a live count', async () => {
    component.query.set('found');
    await component.search();
    fixture.detectChanges();
    expect(forum.search).toHaveBeenCalledWith('found');
    expect(el().querySelector('[data-testid="forum-search-count"]')!.textContent).toContain('1 result');
    expect(el().querySelector('#search-topics-heading')).not.toBeNull();
  });
});
