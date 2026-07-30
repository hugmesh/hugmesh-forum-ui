@cluster
Feature: Create-topic journey + cross-user reach (MULTIUSER)
  # role-gated-surfaces only asserts the create form is VISIBLE — nobody submits
  # it. Here the whole journey runs: forum-user fills the create form, POSTs
  # /bff/forum/topics, and lands on the new topic's detail page; then a SECOND
  # real user finds that topic via the forum search (cross-user reach) and can
  # read it. Search execution (typing a query, asserting results) is otherwise
  # uncovered by the suite.
  # @cluster (ships dark): needs the live forum-bff + Casdoor. bddgen compiles.

  Background:
    Given a clean session

  Scenario: A created topic is reachable by another user via search
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum/create-topic"
    And "forum-user" creates a topic titled "journey-orion-thread" with body "First post of the Orion thread."
    Then "forum-user" lands on the topic page titled "journey-orion-thread"
    And "forum-user-2" finds the topic "journey-orion-thread" via search

  Scenario: The create journey lands the author on the new topic detail page
    Given "forum-user" is logged in
    When "forum-user" navigates to "/social/forum/create-topic"
    And "forum-user" creates a topic titled "journey-vega-thread" with body "Opening the Vega thread."
    Then "forum-user" lands on the topic page titled "journey-vega-thread"
    And "forum-user" sees the reply form
