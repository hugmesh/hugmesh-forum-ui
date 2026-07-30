@cluster
Feature: Forum role-gated surfaces (USER-SITUATIONAL ALLOW + DENY)
  # phpBB-backed forum surfaces gate the post/reply/new-topic affordances on the
  # canPost flag (roles ∋ 'forum' OR 'admin') and the moderate affordances on
  # canModerate (roles ∋ 'admin' OR mod+forum). The whole feature is @cluster
  # (ships dark in wave 2b) because it navigates the host-mounted remote and
  # needs the forum-bff to serve categories/topics; bddgen still compiles every
  # scenario so `playwright test --list` proves the Gherkin parses.
  #
  # Surfaces grounded against src/app/*.component.html:
  #   forum-index   -> [data-testid="forum-new-topic"], "forum-search-link"
  #   topics-list   -> "topics-new-topic"
  #   topic-detail  -> "reply-body"/"reply-submit" (ALLOW) | "reply-gated" (DENY)
  #   create-topic  -> "create-title"/"create-body"/"create-submit" | "create-gated"

  Background:
    Given a clean session

  # ── ALLOW: a forum-role user gets the post affordances ─────────────────────
  Scenario: A forum-role user sees the new-topic affordance on the index
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the forum index heading
    And "forum-user" sees the "forum-new-topic" control
    And "forum-user" sees the "forum-search-link" control

  Scenario: A forum-role user can open and use the reply form on an unlocked topic
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the "reply-body" control
    And "forum-user" sees the "reply-submit" control
    And "forum-user" does not see the "reply-gated" control

  Scenario: A forum-role user sees the create-topic form, not the gated helptext
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/create-topic"
    Then "forum-user" sees the "create-title" control
    And "forum-user" sees the "create-body" control
    And "forum-user" sees the "create-submit" control
    And "forum-user" does not see the "create-gated" control

  # ── ALLOW ceiling: an admin reaches forum surfaces via the gateway bypass ───
  Scenario: An admin sees the post affordances even without an explicit forum role
    Given "admin" has a seeded session
    When "admin" navigates to "/social/forum"
    Then "admin" sees the "forum-new-topic" control

  # ── DENY: a plain user (no forum role) gets the gated helptext, no form ─────
  Scenario: A plain user is denied the new-topic affordance on the index
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/social/forum"
    Then "plain-user" sees the forum index heading
    And "plain-user" does not see the "forum-new-topic" control

  Scenario: A plain user sees the reply-gated helptext instead of the reply form
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/social/forum/topics/1"
    Then "plain-user" sees the "reply-gated" gated helptext
    And "plain-user" does not see the "reply-body" control
    And "plain-user" does not see the "reply-submit" control

  Scenario: A plain user sees the create-gated helptext instead of the create form
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/social/forum/create-topic"
    Then "plain-user" sees the "create-gated" gated helptext
    And "plain-user" does not see the "create-submit" control

  # ── DENY (subtle): a BARE mod (no forum role) is read-only here ─────────────
  Scenario: A bare mod without the forum role cannot post or moderate
    Given "bare-mod" has a seeded session
    When "bare-mod" navigates to "/social/forum/topics/1"
    Then "bare-mod" sees the "reply-gated" gated helptext
    And "bare-mod" does not see the "reply-submit" control

  # ── Locked topic: even a forum user gets no reply form ──────────────────────
  Scenario: A forum-role user sees the locked-topic notice and no reply form
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/99"
    Then "forum-user" sees the locked-topic notice
    And "forum-user" does not see the "reply-submit" control
