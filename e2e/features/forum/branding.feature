@cluster
Feature: Forum brand presence (HugMesh by default under Model A)
  # ForumBrandService.forumName defaults to "HugMesh Forum" so the surface
  # carries brand presence with NO host injection (Model A — the only exercised
  # model; no host sets __HUG_BRAND__). Before the branding fix the header
  # rendered the bare, unbranded "Forum". This asserts the resolved wordmark
  # reaches the rendered header, complementing the ForumBrandService unit spec
  # (Model A default / blank fallback / Model B override).
  # @cluster (ships dark): navigates the host-mounted remote. bddgen compiles.

  Background:
    Given a clean session

  Scenario: The forum header shows the HugMesh brand by default
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the forum index heading
    And "forum-user" sees the forum brand "HugMesh Forum"
