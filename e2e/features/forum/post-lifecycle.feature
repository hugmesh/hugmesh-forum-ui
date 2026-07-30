@cluster
Feature: Post edit/delete round-trips with cross-user consequence (MULTIUSER)
  # role-gated-surfaces + moderation-and-ownership only assert the edit/delete
  # controls are VISIBLE; nobody clicks them. Here a REAL edit/delete round-trip
  # is observed by a SECOND independent identity: an owner's edit shows the new
  # body plus the "(edited)" marker to another reader; a moderator (admin) delete
  # removes the VICTIM's post (the victim authors it live first —
  # victim-creates-first); an owner's own delete removes the post for everyone.
  # Each user has a real Casdoor session in its OWN context, so a write is never
  # asserted only in the actor's own page.
  # @cluster (ships dark): needs the live forum-bff + Casdoor. bddgen compiles.

  Background:
    Given a clean session

  Scenario: An owner's edit is seen by another reader with the edited marker
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "lifecycle-edit-src"
    And "forum-user" edits their post with body "lifecycle-edit-src" to "lifecycle-edit-dst"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    Then "forum-user-2" sees "forum-user"'s post body "lifecycle-edit-dst" with an edited marker

  Scenario: A moderator deletes a victim's post and the victim sees it gone
    Given "forum-user" is logged in in their own context
    And "admin" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "lifecycle-victim-alpha"
    And "admin" navigates to "/social/forum/topics/1"
    And "admin" deletes the post with body "lifecycle-victim-alpha"
    And "forum-user" reloads
    Then "forum-user" does not see a post with body "lifecycle-victim-alpha"

  Scenario: An owner deletes their own reply and it is gone for a second reader
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "lifecycle-own-beta"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    Then "forum-user-2" sees a post with body "lifecycle-own-beta"
    When "forum-user" deletes the post with body "lifecycle-own-beta"
    And "forum-user-2" reloads
    Then "forum-user-2" does not see a post with body "lifecycle-own-beta"
