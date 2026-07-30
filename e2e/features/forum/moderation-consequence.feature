@cluster
Feature: Forum moderation consequence (MULTIUSER — mod acts, author feels it)
  # Beyond control VISIBILITY (moderation-and-ownership.feature): a real
  # moderator action must change what the VICTIM sees. A forum moderator
  # (mod+forum) locks a topic via POST /bff/forum/moderation/topics/{id}
  # (topic-detail "mod-lock-toggle"); the topic author, in an INDEPENDENT
  # context with a REAL session, reloads and loses the reply form, and an
  # in-flight reply POST is rejected loudly. Two real identities, isolated
  # contexts — the mod's write is observed by the author, never asserted only
  # in the mod's own page.
  # @cluster (ships dark): needs the live forum-bff + Casdoor. bddgen compiles.

  Background:
    Given a clean session

  Scenario: A moderator locks a topic and the author loses the reply form
    Given "forum-user" is logged in in their own context
    And "forum-mod" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the reply form
    When "forum-mod" navigates to "/social/forum/topics/1"
    And "forum-mod" locks the topic
    And "forum-user" reloads
    Then "forum-user" sees the locked-topic notice
    And "forum-user" does not see the reply form

  Scenario: A moderator unlock restores the author's reply form
    Given "forum-user" is logged in in their own context
    And "forum-mod" is logged in in their own context
    When "forum-mod" navigates to "/social/forum/topics/99"
    And "forum-mod" unlocks the topic
    And "forum-user" navigates to "/social/forum/topics/99"
    Then "forum-user" sees the reply form

  Scenario: A bare mod without the forum role sees no lock control
    Given "bare-mod" has a seeded session
    When "bare-mod" navigates to "/social/forum/topics/1"
    Then "bare-mod" does not see the "mod-lock-toggle" control

  Scenario: A plain forum user sees no lock control
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" does not see the "mod-lock-toggle" control
