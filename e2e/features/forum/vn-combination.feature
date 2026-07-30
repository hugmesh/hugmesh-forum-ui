@cluster
Feature: VN combinations — skin/accent sweep, sticker caps, editor payloads, fail-soft floors, small screens
  # Hardening sweep over the VN layer's COMBINATION space:
  #   - all 5 voicebox skins x accent on/off, asserted at the post-card boundary
  #     (article[data-vnskin] + the strictly validated --forum-vnbox-accent var)
  #   - sticker token render counts (0 / 1 / 8 / 9-capped / malformed / inside a
  #     code block) against the 8-per-post client render cap
  #   - the editor's full skin x voice-style save matrix, asserting the EXACT
  #     PUT /bff/forum/vn-profiles/me wire payload the UI produces
  #   - read-aloud aria-pressed exclusivity across two posts
  #   - fail-soft floors: VN lookup outage => posts render exactly as
  #     pre-feature (the missing-profile floor lives in vn-profile.feature)
  #   - phone (360x740) + tablet (768x1024) viewports: no horizontal scroll on
  #     topic-detail with VN cards or on the editor panel; >=44px touch targets
  #     in the editor under a REAL coarse-pointer (isMobile+hasTouch) context
  #
  # @cluster (ships dark, wave 2b convention): the harness has no BFF-less
  # browser mode — every scenario navigates the host-mounted remote. The
  # deterministic wire shaping (save interception, sticker lists, token posts)
  # rides Playwright routes ON TOP of the live stack, so the sweeps stay
  # reproducible; bddgen still compiles everything for `--list`.

  Background:
    Given a clean session

  # ── skin x accent render sweep (post-card boundary) ─────────────────────────
  Scenario Outline: Skin "<skin>" with accent <accent> lands on the author's post card
    Given "forum-user" has a seeded session
    And "forum-user" intercepts VN profile saves
    When "forum-user" navigates to "/social/forum"
    And "forum-user" saves a VN profile with skin "<skin>" and accent "<accent>"
    And "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees their own post article with vnskin "<skin>" and accent "<accent>"

    Examples:
      | skin    | accent |
      | classic | off    |
      | classic | on     |
      | glass   | off    |
      | glass   | on     |
      | retro   | off    |
      | retro   | on     |
      | neon    | off    |
      | neon    | on     |
      | paper   | off    |
      | paper   | on     |

  # ── editor combination save matrix (wire-payload boundary) ──────────────────
  # Every skin and every voice style (incl. "none" = null) appears at least
  # once; the assertion pins the EXACT PUT body (skin, voice, accent null-vs-
  # default-#7c4dff) so a serializer regression cannot hide behind the UI.
  Scenario Outline: Saving skin "<skin>" + voice "<voice>" PUTs exactly the picked values
    Given "forum-user" has a seeded session
    And "forum-user" intercepts VN profile saves
    When "forum-user" navigates to "/social/forum"
    And "forum-user" saves a VN profile with skin "<skin>", voice "<voice>" and accent "<accent>"
    Then the captured VN save payload for "forum-user" has skin "<skin>", voice "<voice>" and accent "<accent>"

    Examples:
      | skin    | voice  | accent |
      | classic | warm   | on     |
      | glass   | bright | off    |
      | retro   | deep   | on     |
      | neon    | soft   | off    |
      | paper   | robot  | on     |
      | classic | none   | off    |

  # ── sticker token render sweep (8/post cap) ─────────────────────────────────
  Scenario Outline: A post with <tokens> sticker tokens renders <rendered> sticker images
    Given "forum-user" has a seeded session
    And a topic post containing <tokens> sticker tokens
    When "forum-user" navigates to "/social/forum/topics/1"
    Then the newest post shows exactly <rendered> rendered sticker images

    Examples:
      | tokens | rendered |
      | 0      | 0        |
      | 1      | 1        |
      | 8      | 8        |
      | 9      | 8        |

  Scenario: A malformed sticker slug stays inert text (never an image)
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply ":snap-sticker:NOT_A_SLUG!: stays literal"
    Then the newest post shows exactly 0 rendered sticker images
    And the newest post still contains the literal text ":snap-sticker:NOT_A_SLUG!:"

  Scenario: A sticker token inside a code block still renders as a safe same-origin image
    Given "forum-user" has a seeded session
    And "forum-user" owns the sticker "wave"
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "`:snap-sticker:wave:`"
    Then the newest post renders a sticker image inside a code element

  # ── read-aloud toggle states across posts ───────────────────────────────────
  Scenario: Read aloud is exclusive — starting a second post releases the first
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" activates the read-aloud control on post 1
    Then the read-aloud control on post 1 is pressed
    When "forum-user" activates the read-aloud control on post 2
    Then the read-aloud control on post 2 is pressed
    And the read-aloud control on post 1 is not pressed

  # ── fail-soft floor: VN lookup outage ───────────────────────────────────────
  Scenario: A VN profile service outage renders posts exactly as pre-feature
    Given "forum-user" has a seeded session
    And the VN profile service is unavailable
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees at least one post article
    And "forum-user" sees a post article without any vnskin attribute
    And "forum-user" does not see the "post-sprite" control

  # ── editor a11y: Escape + focus return ──────────────────────────────────────
  Scenario: Escape closes the VN editor and returns focus to its toggle
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    Then "forum-user" sees the "vn-editor" control
    When "forum-user" focuses the "vn-editor-save" control
    And "forum-user" presses "Escape"
    Then "forum-user" does not see the "vn-editor" control
    And the "vn-profile-toggle" control is focused for "forum-user"

  # ── sticker picker keyboard operability ─────────────────────────────────────
  Scenario: The sticker picker is fully keyboard operable
    Given "forum-user" has a seeded session
    And "forum-user" owns the stickers "wave" and "hug"
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the "sticker-toggle" control
    And the "sticker-toggle" control shows aria-expanded "false"
    When "forum-user" activates the "sticker-toggle" control
    Then the "sticker-toggle" control shows aria-expanded "true"
    When "forum-user" focuses the "sticker-insert-wave" control
    And "forum-user" presses "ArrowRight"
    Then the "sticker-insert-hug" control is focused for "forum-user"
    When "forum-user" presses "Enter"
    Then the reply draft for "forum-user" contains ":snap-sticker:hug:"

  # ── phone / tablet coverage ─────────────────────────────────────────────────
  Scenario Outline: Topic detail with VN cards fits a <device> viewport without horizontal scroll
    Given "forum-user" has a seeded session
    And "forum-user" uses a <device> viewport
    And "forum-user" has a saved VN profile with a character sticker
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees at least one post article
    And the page shows no horizontal scroll for "forum-user"

    Examples:
      | device |
      | phone  |
      | tablet |

  Scenario Outline: The VN profile editor fits a <device> viewport without horizontal scroll
    Given "forum-user" has a seeded session
    And "forum-user" uses a <device> viewport
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    Then "forum-user" sees the "vn-editor" control
    And the page shows no horizontal scroll for "forum-user"

    Examples:
      | device |
      | phone  |
      | tablet |

  Scenario: Editor controls meet the 44px touch-target floor on a touch phone
    Given "forum-user" has a seeded touch session
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    Then "forum-user" sees the "vn-editor" control
    And every interactive control in the VN editor is at least 44px tall for "forum-user"
