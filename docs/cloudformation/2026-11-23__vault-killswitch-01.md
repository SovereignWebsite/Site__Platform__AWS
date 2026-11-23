# The Vault cost kill switch, wired (vault-alarm.yaml 0.2.0)

Written by cloudformation.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~21:10 UTC. It wires:
- ec2.aws.a's design 03 (work/ec2.aws.a c5de6d4 and 7252d01);
- iam.aws.a's role (killswitch-role.yaml 0.1.1, work/iam.aws.a);
- boto3.aws.a's checks (note 17).

Status: **draft for review, twin only.** Off by default. Whether to offer it at all is Dinis's (K1 to K4 through pm.aws.a).

## What it adds to `sws-vault-<id>-alarm`

All of it is behind `KillSwitch: throttle-and-disable`; the default is `off`. It needs `VaultRegion`, and a Rule enforces that. It is created by the customer's own identity like the rest of the alarm stack (R-027), never by the deploy role.

| Resource | What |
|---|---|
| `KillSwitchRole` `sws-vault-<id>-killswitch` | iam.aws.a's policy unchanged (with `${AWS::Partition}`): Get/Update on the one distribution; Get/Put concurrency on the one function in `VaultRegion`; TagResource on both, only for the key `sws-vault-paused`; its own logs. It denies delete, restore and everything else. |
| `KillSwitchLogs` | 90 days, `RetainExceptOnCreate`: the audit trail of every pause. |
| `KillSwitchFunction` `sws-vault-<id>-killswitch` | python3.12, inline code (1.6 KB, under the 4 KB limit), reserved concurrency 1, timeout 60 s. |
| `KillSwitchPermission` | invoke only by `lambda.alarms.cloudwatch.amazonaws.com`, with `SourceAccount` and `SourceArn` set to this alarm's ARN, so nothing else in the account can fire it. |
| The alarm's `AlarmActions` | the function, directly (boto3.aws.a note 17: alarm actions can invoke Lambda), plus the email topic if there is one. The topic is now only for email. |

## What the code does

1. It acts only if the event names `sws-vault-<id>-requests` in state `ALARM`. Anything else is logged and ignored. The event's field names (`alarmData.alarmName`, `alarmData.state.value`) are marked CHECK, and a different shape fails safe: the function then does nothing.
2. **Lever 1:** if the Vault's function concurrency is not 0, it sets it to 0 and tags the function `sws-vault-paused=<UTC time>`.
3. **Lever 2:** `GetDistributionConfig`. If the distribution is enabled, it sets only `Enabled: false` and writes the whole config back with `IfMatch` (boto3.aws.a note 17), then tags it `sws-vault-paused`.
4. It logs one line per lever, with before, after and the alarm's time.
5. **It never restores and never deletes.** A second trigger writes nothing.

## Tested

- **`vault/test_killswitch.py`** runs the inline code taken from the template against fake AWS clients. It checks:
  - foreign alarms, OK state, empty and null events are all ignored;
  - one trigger pauses: concurrency 0, distribution disabled, both tagged, `IfMatch` and the full config sent;
  - a second trigger writes nothing;
  - nothing is ever deleted or restored.
- **`test_vault_template.py`** now also checks:
  - the switch is off by default;
  - its resources exist only under `KillSwitchOn`;
  - the alarm acts only on the topic and the function;
  - the invoke permission names only the alarm;
  - concurrency is 1 and the code is under 4 KB;
  - the role has no Allow on `*` and no delete.
- cfn-lint passes.

## Restore (design 03 section 4)

By hand, never automatic: delete the function's concurrency override or set it back to the stack's value, enable the distribution, and remove the two `sws-vault-paused` tags. The page offers console links. A Vault stack update does **not** restore, and while the tag is there the page refuses an update, or asks for restore first (ec2.aws.a, option (b)).

## Open

- **For Dinis:** K1 to K4. The trade-off to state plainly: anyone who can send enough requests can switch a Vault off.
- **Not confirmed (boto3.aws.a note 17):** whether throttled invocations are unbilled, and how quickly a disabled distribution stops billing ("a few minutes" to propagate).
- **CHECK:** the alarm-action event's field names.
- **Reviews:** security.aws.a reviews the code; dev.1.aws.a builds the twin from design 03 section 6.

## 0.3.0 (21:25 UTC): the slow alarm (security.aws.a, R-026; billing.aws.a 27911d0 and 7621a65)

**Why:** a flood held just under the 5-minute threshold never trips the fast alarm. At 149 req/s that is about $24 a day.

**What 0.3.0 adds:**
- **`CostAlarmSlow`, `sws-vault-<id>-requests-slow`:** the same metric, Sum over 21600 s (6 hours), with its own `SlowRequestThreshold`. 0 means no slow alarm. billing.aws.a suggests 44,121 for a $10 a month budget, with a worst case of $12.41 before the switch acts, against $48.88 at 24 hours.
- **Same actions as the fast alarm:** the same topic and the same kill switch. The test checks they are identical, and that neither alarm has OK or insufficient-data actions.
- **The kill switch accepts exactly these two alarm names.** A second invoke permission, `KillSwitchPermissionSlow`, has the slow alarm's `SourceArn`. The topic policy now allows exactly the two alarms' ARNs, and denies everything else.
- **`test_killswitch.py`** checks that the slow alarm pauses too, and that look-alike names (`...-requests-slower`, `sws-vault-<id>`) are ignored. The code is 1.6 KB.
