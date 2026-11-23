# Design 04: the Timeline console, wireframes on the twin

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026. The second console after Files (design 03). It answers **"What happened, and when?"** (design 01 section 2). It reads cloudtrail.aws.a's one event shape (docs/cloudtrail/2026-11-23__02-event-shape.md) and does not define its own; addresses follow design 02.

## 1. What the twin gives it today

All from site/twin.js, nothing assumed:

- **CloudTrail records**: two, in two regions: an S3 `GetObject` on the demo site (eu-west-2, 22 Nov 10:01 UTC, by the read role) and an IAM `UpdateAssumeRolePolicy` on `sovereignwebsite-factory-dns` (us-east-1, 22 Nov 10:04 UTC), which is a change by the change role.
- **CloudFront log hours**: one gzip of JSON Lines per hour, 20 to 22 Nov, 09:00 to 11:00 UTC, each line enriched with country and vault id. The attack pack adds a scanner (one address) on 22 Nov, louder each hour; the surge pack adds ten times the traffic on one vault's files.
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
|  ! 22 Nov 09-11  one network (n.n.n.0/24, NL) sent n requests, mostly 403/404    |
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
|  11:00     CDN  n.n.n.0/24    n requests in this hour, n blocked               > |
+----------------------------------------------------------------------------------+
```

- **Worth a look** first: the alarm rules as data (cloudtrail.aws.a's first rules, from security.aws.c R-008 (c): any trust or policy change on a role, any `ExecuteChangeSet`), plus one log rule (one address over n per cent of an hour's requests). Each line opens its events in the list below.
- **Lanes**, not one line: requests (volume from the log hours), changes (CloudTrail records that change something), reads (read-only records, folded by default). A first-time user sees that the change and the spike sit on the same morning.
- **The brush** selects a time range; the list below shows only that range. Zoom is day, hour or minute; the axis is always UTC, said once in the header and in every time ("10:04 UTC" on hover).
- **Lines in plain words** ("the change role rewrote who may assume ..."), from the event shape's `words`; the service and actor short, the raw record one click away (`>`).
- Counts shown as `n` here are filled from the data.

### Privacy

Visitor addresses from the CloudFront logs appear in lanes, alarms, lists and exports only as their network (/24 or /48) with country (Dinis, 23 Nov ~11:15 UTC, in data.aws.a's session: the rule covers anything kept or written out). Drilling into one request in the page may show its full address, as data.aws.a's investigation view does; it is never copied out. The "From" address of a CloudTrail record is the caller of AWS (here the owner's own browser), shown as AWS records it; screenshot mode masks it.

**Finding for the twin (data.aws.a, architect.aws.a):** every synthetic visitor and the attack pack's scanner are in 203.0.113.0/24, so once addresses are cut to /24 the scanner is indistinguishable from normal visitors and the "one network" alarm cannot fire. Suggest spreading normal visitors across the three documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, RFC 5737) and giving the scanner a network of its own, so the demo still tells its story under the privacy rule.

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

### 2.4 Revision 2: the three inputs, chips and Vault deployments (with cloudtrail.aws.a, 23 Nov ~20:40 UTC)

cloudtrail.aws.a's data pieces (work/cloudtrail.aws.a 5cc769e) give the Timeline three inputs. One **Source** control at the top of the console picks between them:

| Source | From | Bar |
|---|---|---|
| Twin pack | `CloudTrailScenarios.demoPack('baseline' \| 'attack' \| 'surge')` (note 04): 22 Nov 2026, 09:00 to 12:00 UTC, the hours the twin's logs cover. baseline has 23 events, surge 158 and attack 35 | the twin bar (design 02) |
| Your file | `CloudTrailDropIn.readFiles` (note 05, section 5 below) | "Your file · read in this page only, never uploaded" |
| Vault deployments | `group(events)` over the current source (ct-deploy.js, note 03) | none: it is a view, not a source |

```
+----------------------------------------------------------------------------------+
| Source [Twin: attack v]   Who [any v]  Service [any v]  Region [any v]  [Failed] |
+----------------------------------------------------------------------------------+
| Worth a look (6)                                                                 |
|  ! refused-on-protected (2)   StopLogging and a trail-bucket policy, refused     |
|  ! iam-trust-or-permissions   the DNS role's trust policy changed                |
|  ! hub-stack-change-applied   a change set applied to the hub's own stack        |
|  ! new-network                an accepted sign-in from a new network             |
|  ! refused-burst              six refused sign-ins in one burst                  |
+----------------------------------------------------------------------------------+
| (lanes and brush as 2.1)                                                         |
+----------------------------------------------------------------------------------+
```

- **Chips** replace 2.1's three buttons. **Who** lists the principals in the data (role names, the account root, "a visitor network" for logs), **Service** the event sources, **Region** the regions, with IAM, STS (which record us-east-1) and CloudFront grouped under "global", and **Failed** is a toggle for refused calls. Each chip shows counts, the list and lanes follow the chips, and **Clear** resets them. The chips are built from the data, never from a fixed list.
- **Worth a look** shows each alarm's level (high, medium, low, as a word and a mark, not colour alone), its rule id as the label and the alarm's own words (`a.words`), so the lines stay true when the rules change. The words in the sketch are placeholders for those. On the attack pack that is 6 alarms over 5 rules, refused-on-protected counting 2 (note 04). The baseline and surge packs show "Nothing worth a look in this pack." A rule opens its events, with the chips set to match.
- **Vault deployments** (a tab beside Events in the list area): one row per Vault id, from ct-deploy.js.

```
| Vault deployments (n)                                                            |
| 3f9a0c21b7d4  created · one-stack · by <who> · eu-west-2 · 22 Nov 10:12-10:19     |
|               n calls · n refused · 0 out of band · alarms: none          [open] |
| 9b1e44a0c2f7  failed  · access-stack · by <who> · eu-west-1 · ...                 |
|               alarms: vault-deploy-refused (1)                            [open] |
```

  State is created, updated, deleted, failed or prepared, and mode is one-stack or access-stack, as the note defines them. The eight vault rules (vault-out-of-band-change, vault-change-not-approved, vault-deleted, vault-deploy-refused, vault-deploy-role-outside-cloudformation, vault-root-activity, vault-direct-change-refused, vault-token-read) show on the row that raised them. **Open** sets the chips to that Vault's events. The ids in the sketch are illustrative.

  The note's own limit is said under the tab, once: "In one-stack mode, another stack's calls on this Vault look the same as the Vault's own."

- **The raw record** opens from any event (2.2's [Raw JSON]) as a side panel on desktop and a pushed screen on the phone. It is text only, with no Copy button, because the record can hold a full address (the privacy rule above). Every event from the reader carries its raw record, the twin packs' included (only the graph's copy drops it), so the panel is there for every event.
- **Phone**: Source and the chips go into one "Filter" sheet with a count badge. Worth a look stays first, and Vault deployments is a third button beside Events.

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

`#/timeline` (last 24 hours of the data, or the whole twin), `#/timeline/<from>/<to>` with ISO times in UTC, `#/timeline/event/<eventID>`, `#/timeline/asset/<arn or id>`. Revision 2 adds the chips' state after the path, so Back and a shared twin link restore it: `?who=<principal>&svc=<event source>&region=<region>&failed=1`, and `#/timeline/vault/<vault id>`. Only names from the data go in (role names, event sources, regions, Vault ids). Never a network, an address or anything from a dropped file: with Your file the address keeps the path and drops the chips, since the file is not there after a reload. Times and ids are matched against the data before use; an unknown event id shows "Not in this trail" and the range around it.

## 5. Drop in your own trail

cloudtrail.aws.a's design: a file picker and drop zone that reads CloudTrail log files (`.json`, `.json.gz`, `.jsonl`, plain or gzip, recognised by content; a zip is not read) in the page. The Timeline shows it the same way as the twin, under its own bar: **"Your file · read in this page only, never uploaded"**, with a "Close the file" action. Real AWS is never called for this view. This is the strongest "try it with your own data" moment the site has: no sign-in, no account, nothing leaves the browser.

**Reading the dropped file** (revision 2, 23 Nov ~20:40 UTC): the drop-in uses cloudtrail.aws.a's own reader, `CloudTrailDropIn.readFiles(files)` (docs/cloudtrail/reader/ct-dropin.js, note 05, work/cloudtrail.aws.a 5cc769e), not Decode directly. It recognises the four shapes by content (a trail's delivery file, LookupEvents output, a bare array, one record per line), gunzips by magic bytes, merges the files newest first and drops duplicates across files.

```
+----------------------------------------------------------------------------------+
| Your file · read in this page only, never uploaded            [Close the file]   |
+----------------------------------------------------------------------------------+
| [ Choose files ]  or drop CloudTrail files here (.json, .json.gz, .jsonl)        |
|                                                                                  |
| Read 3 of 4 files · n events                                         [Hide]      |
|  ✓ 111122223333_CloudTrail_eu-west-2_..._0900.json.gz   n KB -> n KB  n events   |
|  ✓ 111122223333_CloudTrail_us-east-1_..._0900.json.gz   n KB -> n KB  n events   |
|  ✓ lookup-events.json                                  n KB          n events    |
|  ✗ event-history.csv     A CSV export; download the JSON instead                 |
+----------------------------------------------------------------------------------+
```

- **The report** is one line per file, in the reader's own words (after security.aws.a's memory review, e714b43): "larger than 50 MB; not read", "larger than 64 MB once unzipped; not read", "a damaged gzip file; not read", "a CSV export; download the JSON instead", "not a CloudTrail file (no Records, Events or records)". Past a drop limit (256 MB unzipped, 500,000 events or 2,000 files per drop): "the drop's limit is reached; not read". A refusal affects only its own file. A zip, including a zipped folder, is refused as not a CloudTrail file.
- **Under the drop zone**, the reader's own line: "Files are read in this tab and never uploaded. Up to 64 MB per file once unzipped and 256 MB per drop; for more, drop fewer days at a time."
- **Skipped records** within a read file show as "n records skipped [Show]", as text.
- The report is collapsed to its first line once the timeline draws, and it stays one click away.
- Nothing is uploaded or stored. The reader makes no network call and uses no storage (its test checks this), and closing the file drops everything.

Times are shown in UTC with the zone written, like the twin's lanes.

## 6. What it needs (requests, not edits)

| Need | From | Exists today |
|------|------|--------------|
| Events in one shape, sorted, with `words` and `targets` | cloudtrail.aws.a's reader | Designed (docs/cloudtrail/2026-11-23__02-event-shape.md); code path to agree |
| Log volume per hour, top addresses, status counts | data.aws.a, over the twin's log hours | The data yes; an aggregate function no |
| Alarm rules as data | cloudtrail.aws.a, security.aws.a | First rules named; format to agree |
| A CloudTrail record per twin Apply | cloudtrail.aws.a (twin patch) | Planned |
| Asset ids shared with Map | ontology.aws.a | In docs/ontology/ |

## 7. Security check of this note

Design only; no code changed. Records, log lines and dropped files are untrusted: all text set as text, raw JSON shown as text, addresses matched against the data and never fetched. A dropped file is read in memory and not stored (no IndexedDB, no localStorage); closing the tab or "Close the file" drops it. Aggregation over large files must cap work and say so: Decode's limits and `truncated`, worded as in section 5 and design 03 section 2.3a. For security.aws.a: the "Worth a look" rules run in the page, so a rule file must be data only (no expressions evaluated as code).

## 8. Next wake

Map (the third console) once ontology.aws.a's graph is readable in the page; meanwhile a one-page summary of the five consoles' shared shell (console switcher, twin bar, Ctrl+K, addresses) so aws.c can build it once.
