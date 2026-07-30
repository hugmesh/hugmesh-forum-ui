@cluster
Feature: Forum announcements banner publish, see, dismiss persistence (MULTIUSER)
  # The forum announcements banner (sandboxed null-origin iframe body, priority
  # order, dismiss-once persisted to localStorage, non-dismissible pinning,
  # logged-in-only fetch — forum-announcements.*) had ZERO e2e coverage. It is
  # inherently multi-user: an admin publishes a forum-targeted announcement and
  # forum users see it. The publish itself is an admin-bff concern (its own suite
  # owns it); here the GET /bff/announcements/forum payload is pinned ROUTE-SHAPED
  # so the forum-SIDE contract is exercised deterministically — render + sandboxed
  # body + dismiss-once persistence + non-dismissible pinning + logged-in-only.
  # @cluster (ships dark): navigates the host-mounted remote. bddgen compiles.

  Background:
    Given a clean session

  Scenario: A logged-in forum user sees a published announcement and dismisses it for good
    Given "forum-user" has a seeded session
    And "forum-user" publishes a forum announcement titled "Scheduled maintenance"
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the announcement banner "Scheduled maintenance"
    When "forum-user" dismisses the announcement
    Then "forum-user" sees no announcement banner
    When "forum-user" reloads
    Then "forum-user" sees no announcement banner

  Scenario: A pinned (non-dismissible) announcement offers no dismiss control
    Given "forum-user" has a seeded session
    And "forum-user" publishes a pinned forum announcement titled "Community guidelines"
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the announcement banner "Community guidelines"
    And the announcement "Community guidelines" has no dismiss control for "forum-user"

  Scenario: An anonymous visitor sees no announcement banner
    Given "anonymous" is anonymous
    When "anonymous" navigates to "/social/forum"
    Then "anonymous" sees no announcement banner
