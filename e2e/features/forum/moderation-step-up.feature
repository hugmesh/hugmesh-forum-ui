# hugmesh-forum-ui#3 (box 1) — the forum's moderation writes sit behind the
# platform's D8 MFA step-up gate, and the topic page must OFFER the challenge on
# that refusal instead of printing a generic failure.
#
# RE-CHECKED against origin/main before writing (2026-09-23):
#   - forum-ui dacf44b (PR #16, the first slice): forum.service.ts wraps
#     POST /bff/forum/moderation/topics/{id} in toStepUpError(); topic-detail
#     renders the `mod-step-up` offer (verify link → /login/mfa/challenge?returnTo=,
#     "Not now" dismiss) and leaves the topic UNTOUCHED.
#   - forum-bff-api 52a2866 (PR #15, 2026-09-17): an ARMED gate on
#     /bff/forum/admin/** and /bff/forum/moderation/** refuses with
#     403 + `X-Step-Up-Required: X-Forum-StepUp` (ForumStepUpGate.STEP_UP_HEADER,
#     ForumStepUpAccessDeniedHandler). Both halves of the contract are on main.
#
# Two lanes in one file:
#   MOCKED — page.route() answers the topic read and the moderation write with
#     the documented wire shapes, so the topic page's half of the loop is proven
#     on a default stack where app.mfa.enabled is off (forum-bff's gate is then a
#     byte-identical no-op and never emits the refusal). A BARE 403 (a role
#     denial) must NOT offer the challenge; that negative is asserted.
#   ARMED — the API-level contract against the REAL forum-bff, skip-loudly gated
#     on MFA_STEPUP_ARMED=1 (the same variable the mod-ui armed lane uses, so an
#     operator arms one stack for both). /bff/forum/admin/** has NO forum-ui
#     surface (the admin console talks to admin-bff's /bff/admin/forum/**), so
#     that path group is only reachable here as a fetch.
#
# Box 2 of #3 (generator#347 decisions 21/35, operator 2026-09-17) is NOT landed:
# the topic page must load login-ui's federated `./mfa-step-up` from the
# HARDCODED `/login/remoteEntry.json` in place, and DEGRADE to today's ?returnTo=
# link whenever that load is rejected. Two rows pin it:
#   - `@fixme` "…loads login-ui's federated challenge in place": asserts the
#     CORRECT behaviour (the remote entry is requested and login-ui's
#     `mfa-challenge-view` renders) and ONLY login-ui's `mfa-challenge-*` testids,
#     so it cannot be satisfied by today's link. It turns green, unmodified, the
#     day box 2 merges. (The federated component makes no /bff/mfa call on mount,
#     so it renders even while MFA ships dark; dark is reached only on submit.)
#   - "…degrades to the returnTo link": the remote entry is made unfetchable and
#     the link must still be offered. This PASSES TODAY because the link is
#     unconditional; it is a fence for the wiring (the decided fallback must
#     survive), which is why it is not `@fixme`.
#
# The ROLE_SUPERADMIN row of the admin surface is driven by the `superadmin`
# persona (tests/helpers/roles.ts), spelled as hugmesh-admin-ui and
# hugmesh-mod-ui spell it. Role refusals on /bff/forum/admin/** (gateway row
# ROLE_ADMIN) and /bff/forum/moderation/** (gateway row ROLE_FORUM_MOD) are
# refused BEFORE forum-bff's step-up composition runs, so they carry no signal
# armed or not and need no MFA_STEPUP_ARMED. @cluster: the host shell must serve
# this remote.
@cluster @forum-ui @issue:forum-ui-3
Feature: Forum moderation writes pause on the platform's step-up contract
  As the forum topic page
  I must offer the second-factor check when the BFF refuses a moderation write with the step-up signal
  So a moderator can verify and re-issue the action, and a routine role denial never masquerades as an MFA prompt

  Scenario: a forum moderator's lock is paused by the step-up signal and nothing changes
    Given "forum-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    Then "forum-mod" is offered the forum step-up check
    And the topic stays unlocked for "forum-mod"
    And the moderation write on topic 77 was sent exactly once

  Scenario: an admin's lock is paused the same way
    Given "admin" has a seeded session
    And the forum serves the unlocked topic 77 to "admin"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "admin" navigates to "/social/forum/topics/77"
    And "admin" attempts to lock the topic
    Then "admin" is offered the forum step-up check
    And the topic stays unlocked for "admin"

  Scenario: the offer leads to the platform challenge and returns to this topic
    Given "forum-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    Then the step-up verify link shown to "forum-mod" leads to the platform MFA challenge returning to topic 77

  Scenario: a bare 403 is the plain lock failure and never offers the step-up
    Given "forum-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 with a bare 403
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    Then "forum-mod" sees the plain lock failure alert
    And "forum-mod" is not offered the forum step-up check
    And the topic stays unlocked for "forum-mod"

  Scenario: declining the offer leaves the topic unchanged
    Given "forum-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    And "forum-mod" declines the forum step-up check
    Then "forum-mod" is not offered the forum step-up check
    And the topic stays unlocked for "forum-mod"
    And the moderation write on topic 77 was sent exactly once

  Scenario: with the gate armed, an admin's forum-admin read is refused with the forum step-up signal
    Given the platform MFA step-up gate is armed on this stack
    And "admin" is logged in
    When "admin" GETs "/bff/forum/admin/stats" capturing the step-up signal
    Then the captured response was a 403 carrying the step-up signal "X-Forum-StepUp"

  Scenario: with the gate armed, a forum moderator's moderation read is refused with the forum step-up signal
    Given the platform MFA step-up gate is armed on this stack
    And "forum-mod" is logged in
    When "forum-mod" GETs "/bff/forum/moderation/queue" capturing the step-up signal
    Then the captured response was a 403 carrying the step-up signal "X-Forum-StepUp"

  Scenario: a plain user's moderation read is a role refusal that carries no step-up signal
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/forum/moderation/queue" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: a forum moderator's forum-admin read is a role refusal that carries no step-up signal
    Given "forum-mod" is logged in
    When "forum-mod" GETs "/bff/forum/admin/stats" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: a bare mod's forum-admin read is a role refusal that carries no step-up signal
    Given "bare-mod" is logged in
    When "bare-mod" GETs "/bff/forum/admin/stats" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: a plain user's forum-admin read is a role refusal that carries no step-up signal
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/forum/admin/stats" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: a bare mod's moderation read is a role refusal that carries no step-up signal
    Given "bare-mod" is logged in
    When "bare-mod" GETs "/bff/forum/moderation/queue" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: with the gate armed, a superadmin's forum-admin read is refused with the forum step-up signal
    Given the platform MFA step-up gate is armed on this stack
    And "superadmin" is logged in
    When "superadmin" GETs "/bff/forum/admin/stats" capturing the step-up signal
    Then the captured response was a 403 carrying the step-up signal "X-Forum-StepUp"

  # Issue #3's human check names this persona: "a mod WITHOUT forum still sees the
  # plain alert and no offer". canModerate is false for a bare mod, so the page
  # never renders the lock control at all — there is no write to refuse.
  Scenario: a bare mod is shown no lock control, so no step-up offer can appear
    Given "bare-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "bare-mod"
    When "bare-mod" navigates to "/social/forum/topics/77"
    Then "bare-mod" sees the title of topic 77
    And "bare-mod" does not see the "mod-lock-toggle" control
    And "bare-mod" is not offered the forum step-up check

  @fixme
  Scenario: the step-up refusal loads login-ui's federated challenge in place
    Given "forum-mod" has a seeded session
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    Then the page of "forum-mod" requested the login remote entry "/login/remoteEntry.json"
    And "forum-mod" sees the federated login-ui MFA challenge in place
    And the topic stays unlocked for "forum-mod"

  Scenario: when the login remote entry cannot be fetched, the offer degrades to the returnTo link
    Given "forum-mod" has a seeded session
    And the login remote entry cannot be fetched by "forum-mod"
    And the forum serves the unlocked topic 77 to "forum-mod"
    And the forum-bff will refuse the next moderation write on topic 77 demanding a step-up
    When "forum-mod" navigates to "/social/forum/topics/77"
    And "forum-mod" attempts to lock the topic
    Then "forum-mod" is offered the forum step-up check
    And the step-up verify link shown to "forum-mod" leads to the platform MFA challenge returning to topic 77
    And the topic stays unlocked for "forum-mod"
