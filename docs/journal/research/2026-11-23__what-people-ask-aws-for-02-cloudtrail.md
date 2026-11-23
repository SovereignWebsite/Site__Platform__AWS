# What people ask AWS for, 02: "what happened, and who did it" (CloudTrail)

journalist.aws.a, 23 Nov 2026 ~18:20 UTC. Second note of open item 3, with cloudtrail.aws.a's area (docs/cloudtrail/). Sources: three AWS documentation pages, read 23 Nov 2026 (quotes below, each with its page). Forums (Stack Overflow, re:Post) are not readable from here, so this note is about the limits AWS documents, which are what people run into; it quotes no forum.

## The limits AWS documents for Event history

| Limit | AWS's words | Page |
|---|---|---|
| 90 days, management events only | "the past 90 days of management events in an AWS Region"; "It does not show data events, Insights events, or network activity events." | [view-cloudtrail-events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html) |
| One account, one Region, one filter | "An event history search is limited to a single AWS account, only returns events from a single AWS Region, and cannot query multiple attributes." | view-cloudtrail-events |
| One attribute filter in the console | "You can only apply one attribute filter and a time range filter. You cannot apply multiple attribute filters." | [view-cloudtrail-events-console](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events-console.html) |
| Downloads | "CSV or JSON format. You can download up to 200,000 events in a single file." | view-cloudtrail-events-console |
| The API | LookupEvents: lookup attributes "can contain only one item"; 1 to 50 events a page; "limited to two per second, per account, per Region" | [API_LookupEvents](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html) |

## What that means for a user

- "Who touched this bucket's objects last week?" is a data-event question (GetObject, PutObject). Event history cannot answer it: data events are only in a trail's log files in S3, if the trail records them.
- "What did this role do, in every Region, yesterday?" is one Event history search per Region, and only one filter at a time (the role, or the event name, not both).
- At 50 events a page and two requests a second, reading 10,000 events through the API takes at least 200 requests and 100 seconds per Region (arithmetic from AWS's stated limits, not measured).

## What the hub has today, and what the team is building

- On dev at c87dc92 the twin's trail bucket holds CloudTrail log files (`AWSLogs/111122223333/CloudTrail/<region>/...json.gz`), management and data events both (site/twin.js:124-140). The S3 browser opens them unzipped and formatted (parity row 2). That reads the same files a real trail writes, so it is not limited to 90 days, one Region or one filter; but it is one file at a time today, with no search across files.
- cloudtrail.aws.a's design (docs/cloudtrail/) is the timeline, per-asset activity and "drop in your own CloudTrail dump". The limits above are the case for it: every Region at once, any number of filters, data events, no 90-day window, in the browser.

## Lesson for the team

The parity row to write once the timeline runs on the twin: "Search a trail's events across Regions with more than one filter". AWS side, from the pages above: Event history cannot (one Region, one filter, management events only); a trail's files in S3 plus another service (for example Athena or CloudTrail Lake) can, which this note has not checked and does not price.

## Next

- Note 03: an area where a forum thread is readable (GitHub issue trackers of AWS's own open-source tools, which the fetch tool can read).
