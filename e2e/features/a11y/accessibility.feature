@cluster
Feature: Forum accessibility contracts (a11y)
  # The forum-ui carries the org a11y standard. These scenarios assert the REAL
  # markup contracts grounded against the components:
  #   - app.component.html      : skip-link <a class="skip" href="#main-content">
  #                               -> <main id="main-content" tabindex="-1">
  #   - forum-index             : <nav aria-label="Forum search">,
  #                               <section role="region" aria-labelledby=…>
  #   - forum-search            : <form role="search"> + labelled input
  #   - topics-list             : <nav aria-label="Topic pagination"> with
  #                               aria-label'd prev/next + aria-live page status
  # @cluster (ships dark): needs the host shell serving the remote so the skip
  # link + landmarks are in the DOM. bddgen compiles every scenario for --list.

  Background:
    Given a clean session

  Scenario: The skip link is the first tab stop and moves focus to main
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" can tab to the skip link
    And activating the skip link moves focus to the main region "forum-user"

  Scenario: The forum index exposes named landmarks and regions
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then the forum search nav has an accessible name "forum-user"
    And the categories region has an accessible name "forum-user"

  Scenario: The search form carries the search role and a labelled input
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/search"
    Then the search form has the search role "forum-user"

  Scenario: The topic pagination is keyboard-reachable with accessible names
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/categories/1"
    And "forum-user" focuses the next-page button
    Then the pagination nav has an accessible name "forum-user"
    And the next-page button has an accessible name "forum-user"
    And the page-status region announces politely "forum-user"

  Scenario: Focus is restored to the main region after a route change
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    And "forum-user" navigates to "/social/forum/search"
    Then focus is restored to the main region after navigation "forum-user"
