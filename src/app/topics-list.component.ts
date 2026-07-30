import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ForumService, ForumTopic, Page, PageQuery } from './forum.service';

type Sort = NonNullable<PageQuery['sort']>;

/**
 * Paginated list of topics in a category, with sort (latest / oldest / most
 * replies). The "New topic" affordance is shown role-responsively (forum role /
 * admin only).
 *
 * a11y: h1 = category name; the topic list is a labelled role="region"; the sort
 * control is a labelled <select>; pagination buttons carry aria-labels and are
 * disabled at the ends.
 */
@Component({
  selector: 'hug-forum-topics-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './topics-list.component.html',
  styleUrl: './topics-list.component.scss',
})
export class TopicsListComponent implements OnInit {
  private readonly forum = inject(ForumService);
  private readonly route = inject(ActivatedRoute);

  readonly categoryId = signal<number>(0);
  readonly page = signal<Page<ForumTopic>>({ items: [], page: 1, pageSize: 20, total: 0 });
  readonly sort = signal<Sort>('latest');
  readonly loading = signal(false);
  readonly error = signal('');

  readonly canPost = this.forum.canPost;

  /**
   * Track-by for the topic list.
   *
   * @param _ - Unused list index.
   * @param t - The topic item.
   * @returns The topic's numeric id.
   */
  trackId = (_: number, t: ForumTopic): number => t.id;

  /**
   * Subscribe to the `:id` route param and load the first page of topics
   * whenever the category changes (e.g. the user navigates between categories
   * without a full page transition).
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const id = Number(p.get('id'));
      this.categoryId.set(Number.isFinite(id) ? id : 0);
      void this.reload(1);
    });
  }

  /**
   * Total number of pages given the current page-size. Always at least 1.
   *
   * @returns The ceiling of `total / pageSize`, minimum 1.
   */
  totalPages(): number {
    const p = this.page();
    return Math.max(1, Math.ceil(p.total / p.pageSize));
  }

  /** @returns `true` when there is a previous page to navigate to. */
  hasPrev(): boolean {
    return this.page().page > 1;
  }

  /** @returns `true` when there is a next page to navigate to. */
  hasNext(): boolean {
    return this.page().page < this.totalPages();
  }

  /**
   * Handle a sort-control change event.
   * Resets to page 1 and reloads with the new sort order.
   *
   * @param value - The raw `<select>` value string; cast to {@link Sort}.
   */
  onSortChange(value: string): void {
    this.sort.set((value as Sort) ?? 'latest');
    void this.reload(1);
  }

  /** Navigate to the previous page, if one exists. */
  prev(): void {
    if (this.hasPrev()) void this.reload(this.page().page - 1);
  }

  /** Navigate to the next page, if one exists. */
  next(): void {
    if (this.hasNext()) void this.reload(this.page().page + 1);
  }

  /**
   * Fetch a specific page of topics for the current category and sort.
   * Calls GET /bff/forum/topics?categoryId=&page=&sort=.
   * Sets `loading` during the request and `error` on failure.
   *
   * @param page - 1-based page number to load.
   */
  async reload(page: number): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.forum.listTopics(this.categoryId(), { page, sort: this.sort() });
      this.page.set(res);
      this.error.set('');
    } catch {
      this.error.set('Could not load topics. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
