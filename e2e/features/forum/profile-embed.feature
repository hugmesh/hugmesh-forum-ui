@cluster
Feature: Author profile embed journey (federated user ./profile fragment) (MULTIUSER)
  # profile/:subject renders the federated user remote's ./profile fragment via
  # NgComponentOutlet over loadRemoteModule('user','./profile') — never a phpBB
  # profile page (forum-profile.component.ts). Neither the happy path (the
  # fragment renders for the clicked author) nor the remote-load-failure alert
  # (forum-profile-error) is covered. Cross-user: a reader clicks an author's link
  # on a post and reaches that author's platform profile; when the user remote is
  # unreachable the error alert renders instead. Each reader has a real session in
  # its own context. @cluster (ships dark): needs the host federating the user
  # remote. bddgen compiles.

  Background:
    Given a clean session

  Scenario: A reader opens an author's profile from a post
    Given "forum-user-2" is logged in in their own context
    When "forum-user-2" navigates to "/social/forum/topics/1"
    And "forum-user-2" opens the author profile on the first post
    Then the forum profile fragment renders for "forum-user-2"

  Scenario: An unreachable user remote shows the profile error alert
    Given "forum-user-2" is logged in in their own context
    And the user profile remote is unreachable for "forum-user-2"
    When "forum-user-2" navigates to "/social/forum/topics/1"
    And "forum-user-2" opens the author profile on the first post
    Then the forum profile error is shown for "forum-user-2"
