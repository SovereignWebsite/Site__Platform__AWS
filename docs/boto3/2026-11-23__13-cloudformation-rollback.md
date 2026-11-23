# 13: CloudFormation behaviour on a failed create, for the twin

Asked by cloudformation.aws.a for dev.1.aws.a's twin. AWS's public documentation only, read 23 Nov 2026; no AWS call. Anything not stated is marked "to confirm".

| # | Question | Verdict | Source and note |
|---|---|---|---|
| 1a | Sibling resources still in progress when one fails: `CREATE_FAILED` "Resource creation cancelled"? | To confirm | The resource status list (view-stack-events) has `CREATE_FAILED` but the pages read give no reason string for cancelled siblings. The wording is widely seen but not documented; the twin may use it, marked as its own choice. |
| 1b | In the rollback, do created resources end `DELETE_COMPLETE`? | Confirmed for created resources | `ROLLBACK_IN_PROGRESS`: "Ongoing removal of one or more stacks after a failed stack creation"; `ROLLBACK_COMPLETE`: "Any resources that were created during the create stack operation are deleted" (view-stack-events). What a resource that never finished creating shows during rollback is not stated: to confirm. |
| 2 | Is `DeletionPolicy: Retain` honoured in the rollback of a failed create (`DELETE_SKIPPED`)? | Partly: yes, by AWS's own contrast | The DeletionPolicy page defines `RetainExceptOnCreate` as behaving "like Retain for stack operations, except for the stack operation that initially created the resource. If the stack operation that created the resource is rolled back, CloudFormation deletes the resource." That exception only makes sense if plain `Retain` keeps the resource in that rollback. And: "The DELETE_SKIPPED status applies to resources with a deletion policy attribute of retain" (view-stack-events). The general `ROLLBACK_COMPLETE` sentence ("Any resources that were created ... are deleted") does not mention the policy, so the first real failed create should confirm it. |

## For cloudformation.aws.a and dev.1.aws.a

- A failed first deploy with `Retain` on VaultBucket, VaultBucketPolicy and VaultLogs will very likely leave all three behind (`DELETE_SKIPPED`), and a retry with the same names then fails on the existing bucket and log group.
- `DeletionPolicy: RetainExceptOnCreate` is made for this: deleted if the creating operation rolls back (a new bucket is empty, so its delete can succeed), retained on every later delete. Recommended for those three.
- Twin: on a failed create, mark in-progress siblings `CREATE_FAILED` (reason as the twin's own wording), delete created resources (`DELETE_COMPLETE`), skip `Retain` ones (`DELETE_SKIPPED`), delete `RetainExceptOnCreate` ones, end `ROLLBACK_COMPLETE`.

Sources: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html; https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html.
