# 19: cloudformation.aws.a's twin patch 01 (CloudFormation reads) against AWS's references

Review of docs/cloudformation/patches/2026-11-23__01-cloudformation-reads.patch and its test (on dev since c87dc92), at the hand-over's item 7. Public material only, read 23 Nov 2026: botocore cloudformation 2010-05-15 and the CloudFormation API reference. No AWS call.

**Runs:** the patch still applies to dev 485b41d, and `node docs/cloudformation/patches/cloudformation-reads.test.mjs site/twin.js` prints "OK (twin CloudFormation reads)" on the patched copy.

| Item | Verdict | Note and source |
|---|---|---|
| Element names | Confirmed | Every element the patch writes for its six read calls is a member or shape name in botocore's model (StackSummaries, StackResourceSummaries, StackEvents, Exports, Imports, ...); the wrappers `<Op>Response`/`<Op>Result` follow the query protocol. |
| Required members | Confirmed | botocore's required members are emitted: StackSummary and Stack (StackName, CreationTime, StackStatus), StackResourceSummary (LogicalResourceId, ResourceType, LastUpdatedTimestamp, ResourceStatus), StackEvent (StackId, EventId, StackName, Timestamp). |
| DescribeStackEvents newest first | Confirmed | API reference: "Returns all stack related events for a specified stack in reverse chronological order." |
| Unknown stack: ValidationError 400 | Confirmed (code); message to confirm | DescribeStacks: "If the stack doesn't exist, a ValidationError is returned." The text "Stack with id X does not exist" is the common one but not quoted on the page. |
| ListImports with no importer | To confirm | The API page names no error for it; the patch's text is the author's reading, as the patch note says. |
| Exports per region | Confirmed | `Fn::ImportValue` works only "within the same account and Region" (CloudFormation best practices; note 08), so moving demo-dns to eu-west-2 is right. |
| Not modelled | Gaps, not errors | No `StackStatusFilter` and no `NextToken` paging on ListStacks. AWS's ListStacks returns deleted stacks too ("Summary information for stacks that have been deleted is kept for 90 days ... If no StackStatusFilter is specified, summary information for all stacks is returned"). With four live stacks and no deleted ones in the seed this changes nothing today; a seeded DELETE_COMPLETE stack would be a cheap fidelity test. |

Recommendation: fine to land as it is (it needs Dinis's yes via aws.c, since it touches site/twin.js and test/**). The IAM mirror mismatch the patch note raises (`ThisStackOnly` pinned to eu-west-2 while the page reads CloudFormation in us-east-1) is for dev.2.aws.a.

Sources: https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/cloudformation/2010-05-15/service-2.json; https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackEvents.html; https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStacks.html; https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStacks.html; https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListImports.html.
