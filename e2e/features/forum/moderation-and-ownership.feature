@cluster
Feature: Forum moderation and post ownership (MULTIUSER + CROSS-USER)
  # The per-post edit/delete controls (topic-detail.component.html: "post-edit",
  # "post-delete") render only when canEdit(post) is true, where
  #   ownsPost = roles ∋ 'admin' OR session.id === post.authorSubject.
  # canModerate = roles ∋ 'admin' OR (mod AND forum) governs moderating OTHERS'
  # posts. This feature exercises the SAME post viewed by different identities:
  #   - MULTIUSER  : the author and a forum moderator over post #10.
  #   - CROSS-USER : a second forum user (forum-user-2) DENIED edit/delete on
  #                  forum-user's post — the ownership-isolation matrix.
  # @cluster (ships dark): seeded topic #10 is owned by forum-user; the controls
  # only render once the BFF serves the topic. bddgen compiles all scenarios.

  Background:
    Given a clean session

  # ── MULTIUSER: the author sees their own edit/delete controls ──────────────
  Scenario: The post author sees the edit and delete controls on their own post
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/10"
    Then "forum-user" sees the "post-edit" control
    And "forum-user" sees the "post-delete" control

  # ── MULTIUSER: a forum moderator may moderate the same post ────────────────
  Scenario: A forum moderator sees edit/delete controls on another user's post
    Given "forum-mod" has a seeded session
    When "forum-mod" navigates to "/social/forum/topics/10"
    Then "forum-mod" sees the "post-edit" control
    And "forum-mod" sees the "post-delete" control

  # ── MULTIUSER: an admin may moderate any post ──────────────────────────────
  Scenario: An admin sees edit/delete controls on another user's post
    Given "admin" has a seeded session
    When "admin" navigates to "/social/forum/topics/10"
    Then "admin" sees the "post-edit" control
    And "admin" sees the "post-delete" control

  # ── CROSS-USER: a non-owner forum user is DENIED edit/delete ───────────────
  Scenario: A different forum user does not see edit/delete on someone else's post
    Given "forum-user-2" has a seeded session
    When "forum-user-2" navigates to "/social/forum/topics/10"
    Then "forum-user-2" sees the "reply-body" control
    And "forum-user-2" does not see the "post-edit" control
    And "forum-user-2" does not see the "post-delete" control

  # ── CROSS-USER (two identities, isolated contexts, same scenario) ──────────
  Scenario: Author and non-owner see different controls on the same post simultaneously
    Given "forum-user" has a seeded session in their own context
    And "forum-user-2" has a seeded session in their own context
    When "forum-user" navigates to "/social/forum/topics/10"
    And "forum-user-2" navigates to "/social/forum/topics/10"
    Then "forum-user" sees the "post-edit" control
    And "forum-user-2" does not see the "post-edit" control

  # ── CROSS-USER API DENY: the BFF rejects a non-owner edit ──────────────────
  # A REAL login so the request carries forum-user-2's OWN bff_ cookie — the
  # DENY under test is wrong-owner, not unauthenticated (a seeded, cookie-less
  # session would only re-prove the anonymous floor). The status tolerance stays
  # 401-or-403 because the exact reject code is the BFF's contract, owned by its
  # own suite; tighten it here once that suite pins one.
  Scenario: The BFF denies a non-owner editing another user's post
    Given "forum-user-2" is logged in
    When "forum-user-2" navigates to "/social/forum/topics/10"
    And "forum-user-2" POSTs to "/bff/forum/posts/10"
    Then the response status is one of 401 or 403
