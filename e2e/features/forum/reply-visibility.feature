@cluster
Feature: Cross-user reply visibility and concurrent posting (MULTIUSER)
  # The core promise of a forum: one user's REAL write becomes visible to a
  # SECOND independent user. Each user logs in with a real Casdoor session in
  # its own context; forum-user's reply is observed in forum-user-2's page (and
  # vice-versa), and interleaved replies keep chronological order for a reader.
  # (No same-user-only assertions — the reply is asserted in the OTHER reader's
  # page.)
  # @cluster (ships dark): needs the live forum-bff + Casdoor. bddgen compiles.

  Background:
    Given a clean session

  Scenario: A reply by one user is visible to another user after reload
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "reply-visibility-alpha"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    Then "forum-user-2" sees a post by "forum-user" with body "reply-visibility-alpha"

  Scenario: Interleaved replies from two users keep chronological order
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "interleave-one"
    And "forum-user-2" posts a reply "interleave-two"
    And "forum-user" reloads
    Then "forum-user" sees the posts "interleave-one" then "interleave-two" in order
