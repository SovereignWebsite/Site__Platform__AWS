# Video and narrative: AWS Platform programme

Kept by video.aws.a@SovereignWebsite.dinis (account A, session_018yvwtNxNZuWP542UZVDUTa), after video.aws.c (session_01Kw9UwFgph7DemcF4Kh9ww8). Started 23 Nov 2026 by conductor.aws.c, at Dinis Cruz's "Full stage 2 now". Role: docs/team/stage-2.md (video.aws.c); rules: docs/team/_common.md.

## What this folder holds

- One narrative plan per major step: `YYYY-MM-DD__<step>-narrative-plan.md`. Each is a storyboard of beats, every beat a real screen of the site (the twin first), with what the viewer sees, the line that goes with it, and how it is captured.
- Decision briefs for Dinis as programmatic animations (memo section 15), for pm.aws.c's decisions page, played in the studio's player.

## Rules I keep

- **Made from the real thing.** Every frame is the live site or the twin, captured by a script anyone can re-run (Playwright, Chromium). No mock screens, no stock footage.
- **Synthetic is labelled.** Twin data is made up (account 111122223333, AWS's own documentation example). Any number on screen from the twin (a cost, a count) is shown as synthetic, never as a real figure.
- **From the user's side.** Each narrative starts with what a first-time visitor sees and can do, then how it works.
- **Reviewed, then published by Dinis.** I draft; studio.c renders and runs its review; Dinis publishes. Nothing is posted by an agent.
- No private person named, no customer invented, no AWS credential, no request to AWS.

## Working with studio.c

Agreed with studio.c (session_01Kw9UwC3pdjxjDeK5WaZYUD), 23 Nov ~03:30 UTC:

- video.aws.c plans and captures (twin only, no AWS calls). studio.c renders, voices, captions and reviews, and folds AWS beats into its 4-hourly Reels. instagram.c posts, only on Dinis's yes.
- studio.c runs at :45 UTC every 4 h. Beats committed and pushed by :40 go into that run.
- Voice: a synthetic presenter, labelled synthetic, with an AI voice (disclosed) and subtitles always on. A Dinis quote appears only as on-screen text, verbatim, with when and where he said it, and only if it is already public. It is never spoken in his voice.
- Input: `<name>.storyboard.json` in this folder, in the format of Site__Agent__Studio `site/accounts/c/update/RUNBOOK.md`. Each beat is `{"id","narration","visual","facts"}`: narration of 12 to 26 spoken words, and facts as public URLs. Captures use `{"kind":"image","src":<raw URL pinned to a commit>,"alt","credit"}` at 1080 wide by up to 1010 high, with no keys, ids or account numbers visible (mask the twin's account id too). Total length 45 to 89 s. I send studio.c the path and the commit.

## Log

- 23 Nov 2026 ~03:40 UTC: started; key published (Factory hand-off); first plan: the twin v0.
- 23 Nov 2026 ~03:45 UTC: role moved to account A (video.aws.a) at Dinis's word via maestro.c; these files landed by aws.c as keeper.
- 23 Nov 2026 ~04:10 UTC (video.aws.a): capture script and seven masked captures of the twin v0, and twin-v0.storyboard.json for studio.c, on branch work/video.aws.a until my path is under the .a name.
