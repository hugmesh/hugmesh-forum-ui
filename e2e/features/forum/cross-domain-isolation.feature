@cluster
Feature: Forum cross-domain isolation (CROSS-USER multi-tenant)
  # The platform is multi-tenant: each brand/domain runs its OWN forum-bff
  # instance behind its own gateway (per-brand BFF + per-domain CA). A
  # domain-B member's real login sets a domain-B-scoped HttpOnly `bff_` cookie
  # (post-#18 — no bearer token exists in the browser); the domain-A forum-bff
  # must REJECT it. The forum-ui itself is brand-agnostic
  # (ForumBrandService reads __HUG_BRAND__), so isolation is enforced at the
  # BFF boundary — these scenarios assert the API-level DENY (anonymous +
  # cross-domain), plus the UI floor for the anonymous viewer.
  # @cluster (ships dark): needs two live per-brand stacks. bddgen compiles all.

  Background:
    Given a clean session

  # ── Anonymous floor: read-only view, no affordances ───────────────────────
  Scenario: An anonymous visitor sees the read-only index but no post affordance
    Given "anonymous" is anonymous
    When "anonymous" navigates to "/social/forum"
    Then "anonymous" sees the forum index heading
    And "anonymous" sees the categories region
    And "anonymous" does not see the "forum-new-topic" control

  Scenario: An anonymous visitor sees the reply-gated helptext on a topic
    Given "anonymous" is anonymous
    When "anonymous" navigates to "/social/forum/topics/1"
    Then "anonymous" sees the "reply-gated" gated helptext
    And "anonymous" does not see the "reply-submit" control

  # ── Anonymous API DENY: the BFF rejects an unauthenticated write ───────────
  Scenario: The BFF rejects an unauthenticated reply POST
    When the unauthenticated client POSTs to "/bff/forum/topics/1/replies"
    Then the response status is one of 401 or 403

  # ── CROSS-DOMAIN DENY: a domain-B member is rejected on domain-A's forum ───
  # A REAL login is required so the request carries the domain-B-scoped bff_
  # cookie the domain-A forum-bff must reject — a seeded (cookie-less) session
  # would only prove the anonymous DENY, not the cross-tenant one.
  Scenario: A domain-B forum member is denied reading a domain-A forum topic
    Given "forum-user-domain-b" is logged in
    When "forum-user-domain-b" navigates to "/social/forum"
    And "forum-user-domain-b" GETs "/bff/forum/topics/10"
    Then the response status is one of 401 or 403

  Scenario: A domain-B forum member is denied posting to a domain-A forum topic
    Given "forum-user-domain-b" is logged in
    When "forum-user-domain-b" navigates to "/social/forum"
    And "forum-user-domain-b" POSTs to "/bff/forum/topics/10/replies"
    Then the response status is one of 401 or 403
