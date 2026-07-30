@cluster
Feature: Ban consequence on a live forum session (MULTIUSER)
  # POST /bff/forum/admin/users/{subject}/ban exists (admin-bff owns the ban
  # itself). For a mid-session ban the CLIENT post gate is unchanged — the reply
  # form is still rendered — so the write must fail LOUDLY via the alert live
  # region, never silently. This pins the post-ban reply rejection ROUTE-SHAPED
  # (403 on the reply POST the forum makes to /bff/forum/topics/{id}/replies) and
  # asserts the "Could not post your reply" announcement in the aria-live region.
  # A REAL login so the topic loads with the caller's own bff_ cookie; only the
  # reply POST is intercepted. @cluster (ships dark): needs the live forum-bff.

  Background:
    Given a clean session

  Scenario: A banned user's reply is rejected loudly, not silently dropped
    Given "forum-user" is logged in
    And "forum-user"'s next reply will be rejected with 403
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the reply form
    When "forum-user" attempts a reply "ban-consequence-attempt"
    Then "forum-user" sees the reply failure announced
