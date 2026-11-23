# Design 04: the Timeline console, wireframes on the twin

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026. The second console after Files (design 03). It answers **"What happened, and when?"** (design 01 section 2). It reads cloudtrail.aws.a's one event shape (docs/cloudtrail/2026-11-23__02-event-shape.md) and does not define its own; addresses follow design 02.

## 1. What the twin gives it today

All from site/twin.js, nothing assumed:

- **CloudTrail records**: two, in two regions: an S3 `GetObject` on the demo site (eu-west-2, 22 Nov 10:01 UTC, by the read role) and an IAM `UpdateAssumeRolePolicy` on `sovereignwebsite-factory-dns` (us-east-1, 22 Nov 10:04 UTC), which is a change by the change role.
- **CloudFront log hours**: one gzip of JSON Lines per hour, 20 to 22 Nov, 09:00 to 11:00 UTC, each line enriched with country and vault id. The attack pack adds a scanner at 203.0.113.66 on 22 Nov, louder each hour; the surge pack adds ten times the traffic on one vault's files.
- **Plans applied in the twin**: each Apply in the twin should add a CloudTrail record (cloudtrail.aws.a's first twin task), so the visitor's own actions appear on the timeline.

So the demo story is already in the data: on 22 Nov a trust policy changes at 10:04, and in the attack pack a scanner gets louder from 09:00. The Timeline's job is to show both on one axis.

## 2. Screens

### 2.1 Desktop, 1280 px: arrival (`?twin&pack=attack#/timeline`)

```
+----------------------------------------------------------------------------------+
| Twin · synthetic AWS · [Attack in progress v] · Copy link · Leave     [Ctrl+K]   |
+----------------------------------------------------------------------------------+
| Files   Map  [Timeline]  Desk  Command                  account 111122223333 v   |
+----------------------------------------------------------------------------------+
|  Worth a look (2)                                                                |
|  ! 22 Nov 10:04  the change role rewrote who may assume sovereignwebsite-...dns  |
|  ! 22 Nov 09-11  one address (203.0.113.66) sent n requests, mostly 403 and 404  |
+----------------------------------------------------------------------------------+
|  20 Nov            21 Nov            22 Nov                       [day|hour|min] |
|  requests ..▂▃▂.......▂▃▂.......▂▅█...   (CloudFront logs, per hour)             |
|  changes   ..............................◆ 10:04 IAM                             |
|  reads     ..............................· 10:01 S3                              |
|            [========== brush: 22 Nov 09:00 to 12:00 ==========]                  |
+----------------------------------------------------------------------------------+
|  Events in the brush (n)          [Changes only] [Show reads] [Failed]   [/]     |
|  10:04:40  IAM  change role   rewrote who may assume sovereignwebsite-...-dns  > |
|  10:01:02  S3   read role     read data/vaults.json in demo-site               > |
|  11:00     CDN  203.0.113.66  n requests in this hour, n blocked               > |
+----------------------------------------------------------------------------------+
```

- **Worth a look** first: the alarm rules as data (cloudtrail.aws.a's first rules, from security.aws.c R-008 (c): any trust or policy change on a role, any `ExecuteChangeSet`), plus one log rule (one address over n per cent of an hour's requests). Each line opens its events in the list below.
- **Lanes**, not one line: requests (volume from the log hours), changes (CloudTrail records that change something), reads (read-only records, folded by default). A first-time user sees that the change and the spike sit on the same morning.
- **The brush** selects a time range; the list below shows only that range. Zoom is day, hour or minute; the axis is always UTC, said once in the header and in every time ("10:04 UTC" on hover).
- **Lines in plain words** ("the change role rewrote who may assume ..."), from the event shape's `words`; the service and actor short, the raw record one click away (`>`).
- Counts shown as `n` here are filled from the data.

### 2.2 Desktop: one event open (`#/timeline/event/<eventID>`)

```
+----------------------------------------------------------------------------------+
|  < Back to 22 Nov 09:00 to 12:00                                                  |
|  22 Nov 2026 10:04:40 UTC · IAM · UpdateAssumeRolePolicy · us-east-1             |
|  Who      change role (sws-aws-platform-change), via accounts.google.com          |
|  What     rewrote who may assume sovereignwebsite-factory-dns                     |
|  From     203.0.113.7 · Mozilla/5.0                                               |
|  Touched  sovereignwebsite-factory-dns  [open in Map] [all its activity]          |
|  Result   succeeded                                                               |
|  [Plain] [Raw JSON]                                                               |
+----------------------------------------------------------------------------------+
```

- "All its activity" is the per-asset view: the same timeline filtered to one target. Files and Map link here by asset id, so the Timeline is where any asset's history lives.
- Raw JSON is shown as text only (the event shape's rule; R-002).

### 2.3 Phone, 390 px

```
+------------------------------+     +------------------------------+
| Twin · Attack v · Leave      |     | < 22 Nov 09:00-12:00         |
+------------------------------+     +------------------------------+
| Timeline v           [/]     |     | 10:04:40 UTC  IAM            |
+------------------------------+     | change role rewrote who may  |
| Worth a look (2)             |     | assume sovereignwebsite-...  |
| ! 10:04 trust policy changed |     | from 203.0.113.7             |
| ! 09-11 one address, n reqs  |     | [Plain] [Raw]                |
| 22 Nov  ▂▅█  ◆               |     |                              |
| [< day >]                    |     |                              |
| 10:04 IAM change role ...  > |     |                              |
| 10:01 S3  read role ...    > |     |                              |
+------------------------------+     +------------------------------+
       arrival                            one event
```

- One day at a time, swiped or stepped with `< day >`; the lanes collapse into one sparkline with change markers. No brush on the phone: the day is the range, and tapping an hour narrows to it.

## 3. Moves

| Move | Desktop | Phone |
|------|---------|-------|
| Pick a range | drag the brush; `[` and `]` step it | `< day >`, tap an hour |
| Zoom | day / hour / minute, or `+` `-` | not offered |
| Open an event | click, or arrows then Enter | tap |
| Filter | `/` then text; Changes only, Failed | search icon |
| Replay | Space plays the brush forward at x60, x600 (with viz.aws.c's packet view later) | not offered |
| Copy link to this place (twin only) | the twin bar | the twin bar |

## 4. Addresses

`#/timeline` (last 24 hours of the data, or the whole twin), `#/timeline/<from>/<to>` with ISO times in UTC, `#/timeline/event/<eventID>`, `#/timeline/asset/<arn or id>`. Times and ids are matched against the data before use; an unknown event id shows "Not in this trail" and the range around it.

## 5. Drop in your own trail

cloudtrail.aws.a's design: a file picker and drop zone that reads CloudTrail log files (`.json`, `.json.gz`, a zip of a folder) in the page. The Timeline shows it the same way as the twin, under its own bar: **"Your file · read in this page only, never uploaded"**, with a "Close the file" action. Real AWS is never called for this view. This is the strongest "try it with your own data" moment the site has: no sign-in, no account, nothing leaves the browser.

## 6. What it needs (requests, not edits)

| Need | From | Exists today |
|------|------|--------------|
| Events in one shape, sorted, with `words` and `targets` | cloudtrail.aws.a's reader | Designed (docs/cloudtrail/2026-11-23__02-event-shape.md); code path to agree |
| Log volume per hour, top addresses, status counts | data.aws.a, over the twin's log hours | The data yes; an aggregate function no |
| Alarm rules as data | cloudtrail.aws.a, security.aws.a | First rules named; format to agree |
| A CloudTrail record per twin Apply | cloudtrail.aws.a (twin patch) | Planned |
| Asset ids shared with Map | ontology.aws.a | In docs/ontology/ |

## 7. Security check of this note

Design only; no code changed. Records, log lines and dropped files are untrusted: all text set as text, raw JSON shown as text, addresses matched against the data and never fetched. A dropped file is read in memory and not stored (no IndexedDB, no localStorage); closing the tab or "Close the file" drops it. Aggregation over large files must cap work and say so (as design 03 section 7). For security.aws.a: the "Worth a look" rules run in the page, so a rule file must be data only (no expressions evaluated as code).

## 8. Next wake

Map (the third console) once ontology.aws.a's graph is readable in the page; meanwhile a one-page summary of the five consoles' shared shell (console switcher, twin bar, Ctrl+K, addresses) so aws.c can build it once.
