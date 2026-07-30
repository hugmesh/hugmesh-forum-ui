@cluster
Feature: VN profiles — character sprites, stickers and voicebox skins on forum posts
  # The VN layer decorates forum posts per AUTHOR: a character sprite column, a
  # voicebox skin (data-vnskin + --forum-vnbox-accent on the post <article>),
  # sticker tokens rendered as same-origin imgs, and a speechSynthesis
  # "Read aloud" control. Everything is fail-soft: an author with no VN profile
  # (or an unavailable sticker endpoint) renders EXACTLY as today.
  #
  # @cluster (ships dark in wave 2b): these scenarios navigate the host-mounted
  # remote and need the forum-bff vn-profiles endpoints + the user-bff
  # character/sticker endpoints live. bddgen still compiles every scenario so
  # `playwright test --list` proves the Gherkin parses. The interaction steps
  # ("activates", "chooses", "sees a post article with") land with this wave's
  # step-definition batch.
  #
  # Surfaces grounded against src/app/*.component.html:
  #   forum-index       -> [data-testid="vn-profile-toggle"] (logged-in only)
  #   vn-profile-editor -> "vn-editor", "vn-editor-skin-{classic|glass|retro|neon|paper}",
  #                        "vn-editor-sticker-none"/"vn-editor-sticker-<slug>",
  #                        "vn-editor-avatar", "vn-editor-accent-enabled",
  #                        "vn-editor-accent", "vn-editor-voice", "vn-editor-save"
  #   topic-detail      -> "post-sprite", "post-read-aloud", "sticker-toggle",
  #                        "sticker-panel", "sticker-insert-<slug>",
  #                        article[data-vnskin] (allowlisted skins only)
  #   create-topic      -> "sticker-toggle" under the body field

  Background:
    Given a clean session

  # ── entry point ─────────────────────────────────────────────────────────────
  Scenario: A logged-in user reaches the VN profile editor from the index header
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    Then "forum-user" sees the "vn-profile-toggle" control
    When "forum-user" activates the "vn-profile-toggle" control
    Then "forum-user" sees the "vn-editor" control
    And "forum-user" sees the "vn-editor-skin-glass" control
    And "forum-user" sees the "vn-editor-voice" control
    And "forum-user" sees the "vn-editor-save" control

  Scenario: An anonymous visitor gets no VN profile entry point
    Given "anonymous" is anonymous
    When "anonymous" navigates to "/social/forum"
    Then "anonymous" sees the forum index heading
    And "anonymous" does not see the "vn-profile-toggle" control

  # ── saving a profile restyles the author's posts ────────────────────────────
  Scenario: Saving a voicebox skin + accent restyles the author's own posts
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    And "forum-user" chooses the "vn-editor-skin-glass" option
    And "forum-user" activates the "vn-editor-save" control
    And "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees their own post article with vnskin "glass"

  Scenario: Posts by authors without a VN profile render exactly as today
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/social/forum/topics/1"
    Then "plain-user" sees a post article without any vnskin attribute
    And "plain-user" does not see the "post-sprite" control

  Scenario: A profiled author's posts carry the character sprite column
    Given "forum-user" has a seeded session
    And "forum-user" has a saved VN profile with a character sticker
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the "post-sprite" control

  # ── stickers in the composers ───────────────────────────────────────────────
  Scenario: The sticker picker is hidden when the sticker endpoint is unavailable
    Given "forum-user" has a seeded session
    And the character sticker endpoint is unavailable
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" does not see the "sticker-toggle" control

  Scenario: Inserting a sticker from the reply composer renders it as an image
    Given "forum-user" has a seeded session
    And "forum-user" owns the sticker "wave"
    When "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" activates the "sticker-toggle" control
    Then "forum-user" sees the "sticker-panel" control
    When "forum-user" activates the "sticker-insert-wave" control
    And "forum-user" submits the reply
    Then "forum-user" sees a rendered sticker image for "wave" in the last post

  Scenario: Sticker rendering is capped at 8 per post (extras stay inert text)
    Given "forum-user" has a seeded session
    And a topic post containing 12 sticker tokens
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees at most 8 rendered sticker images in that post

  # ── voicebox = also audible ─────────────────────────────────────────────────
  Scenario: Read aloud toggles browser speech for a post
    Given "forum-user" has a seeded session
    When "forum-user" navigates to "/social/forum/topics/1"
    Then "forum-user" sees the "post-read-aloud" control
    When "forum-user" activates the "post-read-aloud" control
    Then the "post-read-aloud" control is pressed
    When "forum-user" activates the "post-read-aloud" control
    Then the "post-read-aloud" control is not pressed
