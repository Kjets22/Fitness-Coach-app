# OptimalFit — Community Moderation Policy (internal)

**Owner / moderator of record:** Qualixo22@gmail.com
**Effective:** July 8, 2026 (Phase 3 launch)
**Scope:** all user-generated content in the opt-in community — posts (workout/meal/photo/Receipt), comments, profiles (username, display name, avatar, bio), and gym check-ins.

This is the internal playbook. The user-facing rules live in `terms-of-service.md` Section 6 (objectionable content) and Section 7 (moderation rights); keep the two in sync.

## What the app does automatically

- **Terms acknowledgment at signup** — no account exists without it (with the 13+ age confirmation).
- **Report** — every post, comment, and user has an in-app report action.
- **Block** — any user can block another; content is hidden in both directions immediately, no moderator involvement needed.
- **Auto-hide** — a post reported by **3 or more distinct users** is automatically hidden from the feed pending review. It stays hidden until a moderator clears or removes it.

## The report queue

- Reports arrive at **Qualixo22@gmail.com** (the moderation queue). In-app reports and direct emails both land here.
- **Response-time promise: every report is reviewed within 72 hours** of receipt. Auto-hide limits exposure in the meantime, so the feed is safe even before review.
- Check the queue at least once a day while the community is small; set a recurring reminder.

## Review outcomes (escalation ladder)

Applied via the **Supabase dashboard** (Table Editor / Auth / Storage):

1. **Clear** — report unfounded → unhide the post, note the decision.
2. **Remove content** — delete the post/comment row (and its image from Storage).
3. **Warn** — first genuine but minor violation → remove content + email the user the rule they broke.
4. **Suspend** — repeat violations or serious single violation (harassment, hate, dangerous-behavior promotion) → ban/disable the user in Supabase Auth.
5. **Terminate** — egregious or continued abuse → delete the account (the standard cascade removes profile, posts, images, likes, comments, check-ins, follows, benchmark contributions).

Rules of thumb: eating-disorder promotion and PED sourcing are remove-on-sight (health app — zero tolerance); sexualized physique photos get removed with a warning; obvious spam accounts go straight to terminate.

## CSAM (child sexual abuse material)

If any content appears to be CSAM:

1. **Do not delete it immediately** — preserve the evidence (content row, image file, uploader's account/email, timestamps). Do not download, forward, or share it beyond what reporting requires.
2. **Report it** to NCMEC via the CyberTipline (report.cybertip.org) and/or local law-enforcement authorities immediately.
3. **Suspend the uploading account** at once (Supabase Auth) so the content is unreachable while evidence is preserved.
4. Remove the content from public view (auto-hide/hide), then delete only after the report is filed and any law-enforcement preservation request is satisfied.

## Honest limits (see KNOWN-LIMITATIONS.md)

Moderation is **manual and single-person** at launch: no automated image scanning, no ML classifiers, no on-call rotation. The 72-hour promise is the commitment that makes this acceptable at small scale — revisit this policy (tooling, second moderator) if the community grows beyond what one daily queue-check can handle.
