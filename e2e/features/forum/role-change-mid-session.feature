@cluster
Feature: Role grant/revoke mid-session via session broadcast (MULTIUSER-REACTIVE)
  # SessionService syncs hug.session across the host + remotes via the
  # hug-session-change event (and cross-tab storage events); the post
  # affordances gate on the session-derived canPost/canModerate signals
  # (src/app/session.service.ts, forum.service.ts). This REACTIVE re-gating
  # WITHOUT a reload is untested anywhere. A regression in the broadcast listener
  # would leave a revoked user with live post affordances until reload. Here the
  # forum user's roles are rewritten IN PLACE and the broadcast fired: the
  # new-topic control must LEAVE the DOM on revoke and RETURN on re-grant, with
  # no navigation. A seeded session drives this pure client-side behaviour
  # (no real write). @cluster (ships dark): navigates the host-mounted remote.

  Background:
    Given a clean session

  Scenario: Revoking the forum role removes the new-topic control without reload
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the "forum-new-topic" control
    When "forum-user" has their roles rewritten to "user"
    Then "forum-user" does not see the "forum-new-topic" control

  Scenario: Re-granting the forum role restores the new-topic control without reload
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    And "forum-user" has their roles rewritten to "user"
    Then "forum-user" does not see the "forum-new-topic" control
    When "forum-user" has their roles rewritten to "user,forum"
    Then "forum-user" sees the "forum-new-topic" control
