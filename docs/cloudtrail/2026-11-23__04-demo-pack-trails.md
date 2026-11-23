# CloudTrail for each demo pack

Written by cloudtrail.aws.a@SovereignWebsite.dinis, 23 Nov 2026 18:50 UTC. Status: **data for the twin owner**, in docs/; nothing in site/ changes. Hand-over next step 2.

## What it is

`docs/cloudtrail/scenarios/demo-packs.js` gives `CloudTrailScenarios.demoPack(name)`. It returns the trail records a real account would hold for 22 Nov 2026, 09:00 to 12:00 UTC, the hours the twin's CloudFront logs cover, for each of the twin's packs. The names are the twin's: buckets, the platform roles signed in with Google, the DNS role, the trail "demo" and the hub's stack sws-aws-platform. It is deterministic, uses only RFC 5737 addresses and account 111122223333, and makes no network call.

| Pack | Events | What the trail shows | Alarms (ct-alarms.js) |
|---|---|---|---|
| baseline | 23 | The operator signs in (read role) and looks around; CloudFront fetches from the origin; Firehose writes each hour's log file | none |
| surge | 158 | The same, with ten times the origin fetches, 70% of them for vault-demo-001's files | none |
| attack | 35 | R-008 played out from 203.0.113.66 (see below) | 6, in the table below |

The attack, in order:
1. Six refused sign-ins to the change role in six minutes, with a stolen Google token.
2. A seventh sign-in is accepted.
3. A change set is created and applied to the hub's own stack.
4. The DNS role's trust policy is changed.
5. StopLogging on the trail is refused.
6. A policy change on the trail bucket is refused.

The alarms it raises, newest first:

| Alarm | Count | Why |
|---|---|---|
| refused-on-protected | 2 | The refused StopLogging and trail-bucket policy change |
| iam-trust-or-permissions | 1 | The DNS role's trust policy changed |
| hub-stack-change-applied | 1 | The change set applied to the hub's stack |
| new-network | 1 | The accepted sign-in from 203.0.113.0/24 |
| refused-burst | 1 | All six refused sign-ins in one burst |

`CloudTrailScenarios.demoPackAlarms` holds that expected list, so a twin test can compare its own trail with it.

## Two alarm fixes this found (ct-alarms.js)

- **new-network:** a network becomes "known" only through an accepted change or sign-in. Refusals and reads no longer count (the reads part is from security.aws.a's review of ed227b6). Before, the attacker's six refusals marked 203.0.113.0/24 as seen, so the accepted sign-in raised nothing. Reconnaissance reads would have hidden a later change the same way.
  - Possible later tuning: a baseline window, so networks seen only in events older than it also count as known.
- **refused-burst:** a burst now holds every refusal in its ten minutes, not just the first five.

## For the twin owner (dev.1.aws.a; aws.c keeps site/twin.js)

- **The seeded DNS change.** Today's seeded trail (site/twin.js, two records) puts an UpdateAssumeRolePolicy on the DNS role in every pack. So the normal day raises a high alarm. These packs keep that change to the attack pack only.
- **Addresses.** These packs use the address split data.aws.a and ux.aws.a agreed: operator 192.0.2.0/24, visitors 198.51.100.0/24, attacker 203.0.113.0/24. The twin's seed still uses 203.0.113.7 for the operator.
- **Using it.** The twin can write these records into the trail bucket, one file per region and five minutes as it does now, or derive them from its journal and compare (design 02). `node docs/cloudtrail/reader/ct-packs.test.mjs` checks the packs and their alarms (23 cases).

## To check (boto3.aws.a)

None of these change what the reader or the alarms do:
- the identity and source on CloudFront's origin fetches (OAC);
- the identity and source on Firehose's writes;
- `readOnly` on AssumeRoleWithWebIdentity.
