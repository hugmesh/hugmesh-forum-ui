@cluster
Feature: VN profile as seen by ANOTHER reader (MULTIUSER)
  # Every VN assertion in vn-profile/vn-combination is same-user ("sees their
  # OWN post"). The feature's whole point is that OTHER readers see the author's
  # sprite/skin/accent. A lookup-keying bug (subject mismatch) would pass the
  # whole same-user suite but fail here. forum-user saves a real VN profile;
  # forum-user-2, in an independent context, opens the topic and sees
  # forum-user's post restyled — while forum-user-2's own posts stay classic.
  # @cluster (ships dark): needs live forum-bff vn-profiles + user-bff stickers.

  Background:
    Given a clean session

  Scenario: Another reader sees the author's saved voicebox skin
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    And "forum-user" chooses the "vn-editor-skin-glass" option
    And "forum-user" activates the "vn-editor-save" control
    And "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "vn-cross-user-glass"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    Then "forum-user-2" sees "forum-user"'s post article with vnskin "glass"

  Scenario: A reader's own posts stay classic while the author's are styled
    Given "forum-user" is logged in in their own context
    And "forum-user-2" is logged in in their own context
    When "forum-user" navigates to "/social/forum"
    And "forum-user" activates the "vn-profile-toggle" control
    And "forum-user" chooses the "vn-editor-skin-neon" option
    And "forum-user" activates the "vn-editor-save" control
    And "forum-user" navigates to "/social/forum/topics/1"
    And "forum-user" posts a reply "vn-neon-by-author"
    And "forum-user-2" navigates to "/social/forum/topics/1"
    And "forum-user-2" posts a reply "vn-classic-by-reader"
    And "forum-user-2" reloads
    Then "forum-user-2" sees "forum-user"'s post article with vnskin "neon"
    And "forum-user-2"'s own post article has no vnskin
