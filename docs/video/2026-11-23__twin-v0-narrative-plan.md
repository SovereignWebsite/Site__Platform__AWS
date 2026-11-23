# Narrative plan: the twin v0, "a whole AWS in one page"

By video.aws.c@SovereignWebsite.dinis, 23 Nov 2026 ~03:40 UTC. Status: draft plan, for studio.c to agree and Dinis to review. Source step: commit 5371ed9 (the twin v0, site/twin.js and site/transport.js) on dev.

## The story in one line

You can try a full AWS console without an AWS account: press one button, and the page talks to a synthetic AWS that answers the same calls in the same formats, so the code cannot tell the difference.

Dinis's line it carries: "the code either hits the AWS from the browser ... or it hits the twin, but the code should not know the difference."

## Who it is for

A first-time visitor who has never signed in, and Dinis's followers who know AWS consoles. Length: about 60 seconds (studio.c takes 45 to 89), vertical (9:16) for Instagram and 16:9 for the site. Captions always on (most people watch muted).

## Beats

Each beat is a real screen of aws.platform.sovereignweb.site, captured from dev in Chromium.

| # | Seconds | Screen (real) | What the viewer sees | Narration (presenter, first person) |
|---|---|---|---|---|
| 1 | 0 to 6 | Hub, signed out | The hero and the "Try the twin" button | "What if you could try an AWS console without an AWS account? I am a synthetic presenter, for a synthetic AWS." |
| 2 | 6 to 13 | Press "Try the twin" | The twin bar appears: "A synthetic AWS that runs in this page" | "One button, and this page talks to a twin of AWS that runs inside your browser." |
| 3 | 13 to 22 | Accounts, "Read this account" | Read role, one-hour credentials; account id blurred | "Same roles, same one-hour credentials, same calls. Even the account number is made up." |
| 4 | 22 to 34 | S3, list buckets | Bucket list; only names the twin invents, anything that could be real blurred, or cropped to the list's shape | "These calls are signed just as AWS expects them, and the twin answers in the same formats." |
| 5 | 34 to 46 | Open a zip in the logs or dependencies bucket | Entries listed, one opened | "It reads just the part of the zip it needs, without downloading the whole file." |
| 6 | 46 to 54 | A .json.gz file | Shown as formatted JSON in the page | "Compressed logs open right here, unpacked and formatted, in the page." |
| 7 | 54 to 64 | Leave the twin; back to the hub | Quote on screen, then the sign-in button | "The same code talks to your real AWS when you sign in. It is open source, at aws.platform.sovereignweb.site." |

Changes from the first draft, agreed with studio.c (03:35 UTC): a question as the hook; the cost tile dropped (no costs or budgets on screen, even synthetic); one plain fact per beat; the quote closes beat 7, verbatim, credited "Dinis Cruz, 23 Nov 2026, site/twin.js (5371ed9)". Presenter: Tejo, cast by studio.c, labelled synthetic. Captures: phone width (390x844 at 2x), one per beat (b1.png to b7.png), credit "Capture: aws.platform.sovereignweb.site, twin mode". Blur before capture: the account id 111122223333 and the role name sovereignwebsite-factory-dns (a real role's name the twin reuses).

Beats 5 and 6 are the "better than AWS" points on the parity tracker (AV-2); journalist.aws.c's wording wins where it differs.

## How it is captured

- A Playwright script (Chromium, 1280x720 and 390x844) walks the beats on dev, served locally, twin mode only: no sign-in, no request to AWS, no credential. Screenshots and a screen recording per beat; captions as data (JSON) so studio.c can render them in its own style.
- The script and its output land in docs/video/ once the video agent's path is in site/policy/abp.json.

## Snags seen on tonight's walk (for sherpa.aws.c and aws.c, not blocking)

1. In twin mode the account first shows "not set up yet" and the two CloudFormation console steps, which a twin visitor cannot do and should not need. Suggest: the twin account starts as set up, or the steps are hidden in twin mode.
2. The S3 tab opens empty with a "List buckets" button; beat 4 needs one press. Suggest: in the twin, list buckets on open.
3. The cost tile shows a dollar figure with no "synthetic" label beside it. Suggest: label it in twin mode (the bar says it once, the tile should too). It is left out of the video.

## Settled with studio.c

Run at :45 UTC every 4 h; synthetic presenter and AI voice, disclosed, subtitles always on; the quote as on-screen text only; input as twin-v0.storyboard.json (see README.md). Still open: its player for decision-brief animations.

## Not in this plan

No real account, no real cost, no customer, no person named. Dinis publishes; no agent posts.

## Captured (video.aws.a, 23 Nov 2026 ~04:10 UTC)

Seven captures, b1.png to b7.png in docs/video/twin-v0/, made by docs/video/capture-twin-v0.js from dev at 003976e, and the storyboard for studio.c at docs/video/twin-v0.storyboard.json (129 words, about 52 s). Changes from the plan above:

- Size: 1080x1010 (540x505 CSS px at 2x), studio.c's input size, not 390x844.
- Beat 3: the cost tile is now labelled synthetic on the site, but its figure is masked anyway (no costs on screen).
- Beat 5: the twin's zip is small (797 B), and the page says it was read whole. So the line no longer says "just the part it needs" for this file: "Zips open right in the page, with every file inside listed. Big ones are read from their index, not downloaded whole." (site/zip.js reads big zips by byte range.)
- Beat 7: Google's sign-in script is blocked in the capture (no request off the local site), so the sign-in button's space is empty. Studio.c's on-screen quote and address go over it.
- Snags 1 and 3 from tonight's walk are fixed on dev: the twin account starts set up, and the cost tile says synthetic. Snag 2 stands (S3 opens with a List buckets press).
