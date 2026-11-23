# 10: ec2.aws.a's design 01 against the EC2 API reference and boto3

By boto3.aws.a, 23 November 2026. Checks `2026-11-23__01-ec2-twin-and-control.md` (ec2.aws.a, work/ec2.aws.a). Public material only; no AWS endpoint called, no credentials used. Every source below was read on 23 Nov 2026. Drafted with a Sonnet sub-agent; boto3.aws.a re-checked the protocol, MaxResults and paging rows against botocore.

Verdicts: **Confirmed**, **Wrong**, **Partly**, **To confirm** (the public docs do not settle it; nothing assumed).

## Sources (all read 23 Nov 2026)

| Key | Source |
|---|---|
| BM | botocore `ec2/2016-11-15/service-2.json` (apiVersion 2016-11-15, `protocol: ec2`, `signatureVersion: v4`); shape names are given in the rows |
| BP, BW | botocore `paginators-1.json`, `waiters-2.json` (same folder) |
| API:X | docs.aws.amazon.com/AWSEC2/latest/APIReference/API_X.html |
| ERR | .../APIReference/errors-overview.html and CommonErrors.html |
| QRY | .../APIReference/Query-Requests.html |
| DEV | docs.aws.amazon.com/ec2/latest/devguide/ : eventual-consistency, ec2-api-idempotency, ec2-api-pagination |
| UG | docs.aws.amazon.com/AWSEC2/latest/UserGuide/ : ec2-instance-lifecycle, terminating-instances, using-instance-addressing, burstable-performance-instances-unlimited-mode-concepts, supported-iam-actions-tagging |
| SAR | docs.aws.amazon.com/service-authorization/latest/reference/list_amazonec2.html |
| GCK | docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html |
| OTH | Systems Manager Session Manager and instance-permissions pages; EventBridge Scheduler universal-target and schedule-types pages; CloudFront Developer Guide (ALB origin page, VPC origins page); AWS Regions page |

## 1. Wire format (design 2a)

| Claim | Verdict | Note and source |
|---|---|---|
| `POST https://ec2.<region>.amazonaws.com/`, form body `Action=..&Version=2016-11-15` | Confirmed | GET or POST both allowed; Version is 2016-11-15. BM `metadata`, `CreateTags.http` (POST, `/`); QRY. Doc examples also use the global host `ec2.amazonaws.com`, which the twin's regex would not match (see section 9). |
| "Query protocol" | Partly | botocore calls it protocol `ec2`, a variant of Query, not `query`. Differences matter to the twin: the list and flatten rules (below) and the error envelope. BM `metadata.protocol`. |
| SigV4 signed | Confirmed | `signatureVersion: v4`; credential scope in QRY is `<region>/ec2/aws4_request`. SigV2 is also still documented; the twin may refuse it. QRY. |
| XML answers in `http://ec2.amazonaws.com/doc/2016-11-15/` | Partly | Doc examples use that string with a trailing slash; botocore's `xmlNamespace` has none. Root element is `<ActionResponse xmlns=..>` (e.g. `DescribeInstancesResponse`), and success carries a lowercase `<requestId>`. QRY, API:DescribeInstances, BM. |
| Error shape `<Response><Errors><Error><Code/><Message/></Error></Errors><RequestID/></Response>` | Confirmed | Exactly this shape, with capital `RequestID`, unlike the lowercase `requestId` on success. ERR (example error response). |
| Lists as `InstanceId.1`, `Filter.1.Name`, `Filter.1.Value.1` | Confirmed | BM locationNames: `InstanceId`, `Filter`, `Value`. Also `TagSpecification.1.ResourceType`, `TagSpecification.1.Tag.1.Key`, `SecurityGroupId.1`, `Resources` is `ResourceId.1`, `Tags` is `Tag.1`. Nested structures have no locationName, so `MetadataOptions.HttpTokens` and `CreditSpecification.CpuCredits`. BM. |
| Responses nest lists as `...Set` with `<item>` children | To confirm | Doc samples show `reservationSet`/`item`; the twin should copy the sample bodies in the API reference per action. BM locationNames (`reservationSet`, `instancesSet`, `securityGroupInfo`, `keySet`, `regionInfo`). |
| `InvalidAction` is HTTP 400 | To confirm | ERR lists the code but not its status. MissingAction is 400 and MissingAuthenticationToken is 403 on CommonErrors; `UnauthorizedOperation`, `InvalidAction`, `DryRunOperation` statuses are not given there. |
| Unsigned call is refused (test 2h.1) | Confirmed | `MissingAuthenticationToken`, HTTP 403. CommonErrors. |
| Browser can call the EC2 endpoint (CORS) | To confirm | Nothing in the EC2 docs says the endpoint answers CORS pre-flight. The whole read page depends on it. Only a real call could settle it; agents may not make one, so Dinis's browser is the test. |

## 2. Actions in v1 (design 2b)

| Item | Verdict | Note and source |
|---|---|---|
| All listed actions exist in 2016-11-15 | Confirmed | DescribeRegions, DescribeInstances, DescribeInstanceStatus, DescribeImages, DescribeSecurityGroups, DescribeKeyPairs, DescribeTags, RunInstances, Start/Stop/TerminateInstances, CreateTags, DeleteTags. BM operations. |
| DescribeRegions returns `OptInStatus` | Confirmed | Region has `RegionName`, `Endpoint`, `OptInStatus`, `Geography`; values `opt-in-not-required`, `opted-in`, `not-opted-in`. Default lists only regions enabled for the account; `AllRegions=true` lists all. BM `Region`; API:DescribeRegions. |
| DescribeRegions has no paging | Confirmed | No paginator and no NextToken. BP. The read API's generic `{items,next}` must return `next: null` here, and for DescribeKeyPairs and DescribeAddresses. |
| DescribeInstances filters `instance-state-name`, `tag:<k>`, `tag-key`, `instance-id` | Confirmed | All four are in the filter list. State values `pending, running, shutting-down, terminated, stopping, stopped`. API:DescribeInstances. |
| "Paginated with NextToken past 50 (real default and maximum differ)" | Partly | No 50 anywhere. Without `MaxResults` the docs describe an unpaginated call returning everything, and say unpaginated calls risk throttling; with it you get 0 to MaxResults items plus a token. DescribeInstances' range is not stated (the dev guide example uses 1000). DescribeSecurityGroups and DescribeTags: 5 to 1000. API:DescribeInstances, DEV pagination, QRY, BM `DescribeSecurityGroupsRequest.MaxResults`, `DescribeTagsRequest.MaxResults`. |
| `NextToken` input, `nextToken` output | Confirmed | QRY (Pagination); BP result keys `Reservations`, `SecurityGroups`, `Tags`, `InstanceStatuses`, `Images`, `Volumes`. |
| DescribeInstanceStatus with `IncludeAllInstances` | Confirmed | By default only running instances are described. API:DescribeInstanceStatus. |
| DescribeImages `Owner.1=self` | Confirmed | `Owners` is locationName `Owner`; accepts account IDs, `self`, `amazon`, `aws-backup-vault`, `aws-marketplace`. Omitting it returns every image you may launch (the twin has no public catalogue, so it must decide). BM. |
| DescribeKeyPairs fields name, id, fingerprint, type | Confirmed | `KeyName`, `KeyPairId`, `KeyFingerprint`, `KeyType` (`rsa`, `ed25519`), plus `CreateTime`; `PublicKey` only with `IncludePublicKey`. BM `KeyPairInfo`, `KeyType`. |
| DescribeTags for instances | Confirmed | Paginated, `MaxResults` 5 to 1000. BP, BM. |
| RunInstances returns `pending` instances | Confirmed | Output shape is a `Reservation` (`ReservationId`, `OwnerId`, `Groups`, `Instances`). BM, API:RunInstances. |
| Start/Stop/Terminate answer `currentState`, `previousState` | Confirmed | `InstanceStateChange` has `instanceId`, `currentState`, `previousState`, each `{code, name}`. Set names: `startingInstances`, `stoppingInstances`, `terminatingInstances`. BM. |
| State codes | Confirmed | 0 pending, 16 running, 32 shutting-down, 48 terminated, 64 stopping, 80 stopped. API:DescribeInstances. |
| CreateTags and DeleteTags | Confirmed | Return no body beyond `return`/requestId; max 50 tags per resource; CreateTags overwrites an existing key. BM, API:CreateTags. |
| Anything else answers `InvalidAction` | Confirmed (code) | The code exists in ERR; status to confirm (section 1). |
| Instance record fields in 2c | Partly | The internal model is the twin's, but the answer must use the wire names: `LaunchTime`, `StateReason{Code,Message}`, `StateTransitionReason`, `SecurityGroups[{GroupId,GroupName}]`, `IamInstanceProfile{Arn,Id}`, `VpcId`, `SubnetId`, `Placement.AvailabilityZone`, `PublicIpAddress`, `PrivateIpAddress`, `MetadataOptions.HttpTokens`, `BlockDeviceMappings`. `rootVolume {sizeGiB, encrypted}` and `creditMode` are **not** on the Instance shape: size and encryption come from DescribeVolumes, credit mode from DescribeInstanceCreditSpecifications. `stateChanged` is only the string in `StateTransitionReason`. BM `Instance`. |
| Ids "made once, at write" | Confirmed | Formats: `i-` plus 8 or 17 hex ("i-xxxxxxxx or i-xxxxxxxxxxxxxxxxx"), `r-` reservation ids, `sg-`, `ami-`, `key-`. ERR (InvalidInstanceID.Malformed). |

## 3. States, timing and stopped instances (design 2d)

| Claim | Verdict | Note and source |
|---|---|---|
| State pairs `pending`/`running`, `stopping`/`stopped`, `shutting-down`/`terminated` | Confirmed | Enum in BM `InstanceStateName`; UG lifecycle. A start goes `stopped`, `pending`, `running`: the design's settle for `pending` must also apply after StartInstances, not only RunInstances. |
| Terminated instance stays visible, then goes; period to check | Partly | API:DescribeInstances: recently terminated instances "might appear in the returned results. This interval is usually less than one hour". UG: "a short while"; troubleshooting speaks of "more than a few hours". No fixed figure, so use "about an hour" as a pack value, not a promise. Also UG: tags are "gradually disassociated" from a terminated instance. |
| Delays 20 s, 30 s, 15 s are twin choices | Confirmed | The docs give no timings. For the page's polling the SDK waiters use 15 s x 40 attempts (InstanceRunning, InstanceStopped, InstanceTerminated), 5 s x 40 (InstanceExists), 5 s x 6 (KeyPairExists). Twin delays under 10 minutes will pass any waiter. BW. |
| Stopped keeps tags, private address, root volume; loses a non-Elastic public IP | Partly | Confirmed for the private address (kept until terminate), the public address (released on stop, new one on start, Elastic IP kept) and the root volume (retained, still billed). Tags are not mentioned in the pages read; treat as to confirm. UG addressing; API:StopInstances. |
| Stop is a graceful shutdown | Confirmed | `Force`, `SkipOsShutdown`, `Hibernate` parameters exist; ignoring them is fine for v1. BM, API:StopInstances. |
| Billing by state | Confirmed | Billed only in `running` (and `stopping` when hibernating); EBS and Elastic IPs bill regardless. UG lifecycle. |

## 4. Key pairs (design 2e)

| Claim | Verdict | Note and source |
|---|---|---|
| CreateKeyPair returns the private key | Confirmed | `keyMaterial`, "unencrypted PEM encoded RSA or ED25519 private key" (PPK with `KeyFormat=ppk`). BM `KeyPair`, API:CreateKeyPair. |
| Twin answers it with `UnsupportedOperation` | Partly | Allowed as a twin choice, but in EC2 that code means "unsupported operation, e.g. instance-store stop" (ERR). A real denial of `ec2:CreateKeyPair` would be `UnauthorizedOperation`. Keep it but label it a twin refusal. |
| ImportKeyPair takes a public key only | Confirmed | `PublicKeyMaterial` only; returns `KeyFingerprint`, `KeyName`, `KeyPairId`. BM. Duplicate name: `InvalidKeyPair.Duplicate`; bad key: `InvalidKeyPair.Format`/`InvalidKey.Format`. ERR. |
| Key pair limit | Confirmed | Up to 5,000 per region. API:CreateKeyPair. |
| Session Manager instead of SSH, "no inbound ports, no keys" | Confirmed | OTH (Session Manager overview). But the instance role then needs Systems Manager permissions (the instructions attach `AmazonSSMManagedInstanceCore`), which clashes with section 4.2's "role holds only the bucket, the secret and logs". |

## 5. The twin's refusals (design 2f), and whether the real path can enforce them

| # | Rule | Verdict | Note and source |
|---|---|---|---|
| 1 | Three tags required, else `UnauthorizedOperation` | Confirmed | `aws:RequestTag/${TagKey}` and `aws:TagKeys` are listed on RunInstances for resource types `instance` and `volume` (and `network-interface`). Tag each resource type separately: TagSpecifications may target only `instance`, `volume`, `spot-instances-request`, `network-interface` for RunInstances, so the twin must test per type. SAR; API:RunInstances. |
| 2 | Region not allowed | Partly | `aws:RequestedRegion` is a documented global key (GCK). EC2 also has its own `ec2:Region` on every action (SAR). Either works; name which one the template uses. |
| 3 | `sws:expires-at` beyond the maximum | To confirm | No EC2 key limits a tag value's date range; a date comparison on `aws:RequestTag/sws:expires-at` is an IAM-language question for iam.aws.a. Until settled, mark twin-only, as the design's own 4.5 half-admits. |
| 4 | Public SSH rule refused | Partly | Real EC2 accepts it: security group rules have no IAM condition key for CIDR in SAR (design 4.5 already says so). Twin-only guard; the error code in AWS terms would not be `UnauthorizedOperation`. |
| 5 | `HttpTokens` must be `required` | Partly | `ec2:MetadataHttpTokens` (optional or required) is a key on `instance` for RunInstances (SAR). But if the parameter is omitted the default depends on the AMI's `ImdsSupport` and the account default (BM `InstanceMetadataOptionsRequest.HttpTokens`), so "omitted" is not the same as "required". Decide the twin's behaviour for omitted. |
| 6 | Start/Stop/Terminate need `sws:managed=true` | Confirmed | `ec2:ResourceTag/${TagKey}` and `aws:ResourceTag/${TagKey}` are on `instance` for all three. SAR. With several ids, one failure fails the call (Terminate doc says none is terminated if one id is wrong); to confirm the same for IAM denial. |
| 7 | `CpuCredits=unlimited` refused on t4g | Wrong (as an IAM rule) | No condition key for credit specification exists in the SAR for EC2 (only the Describe/Get/Modify credit actions). Twin-only; real enforcement is a template check or the account default (`ModifyDefaultCreditSpecification`, UG says the default can be set per region per family). |
| 8 | AMI allow list | Confirmed | `image` resource has `ec2:Owner`, `ec2:ImageID`, `ec2:Public`, `ec2:ImageType`. SAR. |
| 9 | CreateTags/DeleteTags on `sws:*` refused | Confirmed | Both actions carry `aws:TagKeys`, `aws:RequestTag`, `aws:ResourceTag`, `ec2:ResourceTag`; `ec2:CreateAction` exists on CreateTags only. SAR. |
| - | DescribeInstanceAttribute and ModifyInstanceAttribute answer `InvalidAction` | Confirmed (reasoning) | Both exist (so the real answer is not InvalidAction; it is a policy denial). DescribeInstanceAttribute returns `userData`. SAR shows both are resource-level on `instance`. DescribeInstances' Instance shape has no user data. Also note DescribeLaunchTemplateVersions returns `UserData` (BM `ResponseLaunchTemplateData`), so the read boundary should never name it. |
| - | Errors for refusals | Partly | `UnauthorizedOperation` messages may come back encoded, decodable with STS `DecodeAuthorizationMessage` (ERR). Not needed in the twin, but a page that parses the message should not expect plain text. |

## 6. Tags (design 2f.1, 4.2)

| Claim | Verdict | Note and source |
|---|---|---|
| `TagSpecifications` on RunInstances | Confirmed | Applies to instances, volumes, spot requests, network interfaces only; other resources need CreateTags after. API:RunInstances. |
| `ec2:CreateTags` with `ec2:CreateAction=RunInstances` | Confirmed | The condition is evaluated only when tags are given at creation; without it, tagging at launch fails even if RunInstances is allowed. UG tagging page (policy example with `"ec2:CreateAction": "RunInstances"`). SAR also lists `ec2:CreateTags` as a dependent action of RunInstances and ImportKeyPair. |
| Deny CreateTags/DeleteTags for `sws:*` so an expiry cannot be pushed back | Confirmed | Mechanism exists via `aws:TagKeys`. Note `ec2:CreateAction` is absent from DeleteTags, so a Deny for DeleteTags must key on `aws:TagKeys`/`ec2:ResourceTag`. SAR. |
| Tag limits | Confirmed | 50 tags per resource. API:CreateTags. |

## 7. IAM actions and condition keys (design sections 3 and 4)

| Claim | Verdict | Note and source |
|---|---|---|
| Describe actions `DescribeRegions`, `DescribeInstances`, `DescribeSecurityGroups`, `DescribeVolumes`, `DescribeAddresses` | Confirmed | All `List` level, condition `ec2:Region` only, no resource-level permission, so tags cannot narrow reads. SAR. |
| `ec2:DescribeInstanceAttribute` returns user data | Confirmed | See section 5. |
| RunInstances conditions per resource type | Partly | Keys named are real: `ec2:InstanceType`, `ec2:MetadataHttpTokens` (instance); `ec2:Encrypted` (volume); `ec2:Owner`, `ec2:ImageID` (image); `ec2:KeyPairName`, `ec2:KeyPairType` (key-pair). **Missing from the design:** `security-group*`, `subnet*` and `network-interface*` are required resource types on RunInstances (starred in SAR), so the allow must cover them. There is no condition key for user data. |
| Deny on `key-pair/*` | Confirmed | `key-pair` is a RunInstances resource type. Add Deny on CreateKeyPair and ImportKeyPair too; they are separate actions. SAR. |
| `iam:PassRole` with `iam:PassedToService=ec2.amazonaws.com` | To confirm | IAM's own authorization reference was not read. EC2 side: `ec2:InstanceProfile` key exists on instance. |
| Never `ModifyInstanceAttribute` | Confirmed | Action exists with `ec2:Attribute/${AttributeName}`; resource-level on instance. SAR. |
| "A low vCPU quota" limits instance count | Confirmed | `VcpuLimitExceeded` and `InstanceLimitExceeded` both exist; quotas are per On-Demand family vCPU. ERR. |
| Termination only via stack delete | Confirmed (mechanism) | `TerminateInstances` is idempotent and also deletes root volume if `DeleteOnTermination` (default true for root). UG terminate. The CloudFormation service role, not the change role, then needs Terminate/Stop. |

## 8. Limits and counts

| Claim | Verdict | Note and source |
|---|---|---|
| About 17 default regions | Confirmed | The Regions page lists exactly 17 enabled by default (us-east-1/2, us-west-1/2, ap-south-1, ap-northeast-1/2/3, ap-southeast-1/2, ca-central-1, eu-central-1, eu-west-1/2/3, eu-north-1, sa-east-1). Opt-in regions add more if enabled. OTH Regions. |
| "Two calls per region, about 35 signed calls" | Wrong (against section 3's own list) | Section 3 also reads `DescribeVolumes` and `DescribeAddresses` per region: four calls per region, so 1 + 17 x 4 = 69, before any extra pages. |
| t4g default credit mode `unlimited`; `standard` caps spend | Confirmed | "Default: standard (T2) or unlimited (T3/T3a/T4g)"; surplus credits above baseline are charged per vCPU-hour. API:RunInstances; UG unlimited concepts. |
| Public IPv4 billed by the hour whether used or not | To confirm | A price fact, not an API fact; left to billing.aws.a. |

## 9. Network and the CloudFront origin (design 5, 6d)

| Claim | Verdict | Note and source |
|---|---|---|
| Twin matches `ec2.<region>.amazonaws.com` | Partly | Per-region host confirmed (DescribeRegions `Endpoint` example `ec2.us-east-1.amazonaws.com`). Docs examples also use `ec2.amazonaws.com`; FIPS and dual-stack hosts exist but were not read, so to confirm. Fine to match only what the page uses. |
| AWS-managed prefix list for CloudFront origin-facing addresses | Confirmed (exists) | CloudFront guide has "Limit access to origin by using the AWS-managed prefix list for CloudFront". Its exact name was not found in the text read; to confirm. |
| VPC origins remove the public address | Partly | CloudFront VPC origins support EC2 instances in private subnets, so no public IPv4 is needed. But a private-subnet instance still needs a route to pull the image from Docker Hub and reach S3 and Secrets Manager (NAT or endpoints), which costs money; not covered in the design. OTH VPC origins. |
| CloudFront HTTP origin on port 8080 | To confirm | CloudFront custom-origin port rules were not read. |
| EventBridge Scheduler one-time schedule that deletes a stack | Partly | One-time schedules exist. The universal target (`arn:aws:scheduler:::aws-sdk:cloudformation:deleteStack`) excludes only read-style prefixes (get, describe, list, ...), so a delete is not excluded. Whether a stack can contain the schedule that deletes it is not addressed in the docs read; to confirm. OTH Scheduler. |

## 10. EC2 behaviours the twin should mimic that the design misses

| Behaviour | What the docs say | Source |
|---|---|---|
| `DryRun` | Accepted on every action named in 2b. If allowed it returns the error `DryRunOperation`; if not, `UnauthorizedOperation`. It must write nothing to the journal, and a refusal outranks the DryRun success. HTTP status and message text to confirm. | QRY, API:RunInstances |
| `IncorrectInstanceState` | Returned when an action does not fit the state (e.g. start a running instance, stop a terminated one). Exact state-by-action matrix is not in the pages read: to confirm per action. | ERR |
| TerminateInstances idempotent | Terminating twice succeeds; terminating a terminated instance is a success. | API:TerminateInstances |
| All-or-nothing on a bad id | One incorrect id in a multi-id Terminate stops the lot. Describe with an invalid id errors; an instance you do not own is simply omitted. | API:TerminateInstances, API:DescribeInstances |
| `InvalidInstanceID.NotFound` and `.Malformed` | Malformed = not `i-` plus 8 or 17 hex. NotFound can also happen right after RunInstances (eventual consistency); a NotFound after Terminate does not prove termination. Offer a pack-level propagation delay, clock-driven like the settles. Waiters retry on this code. | ERR, DEV eventual-consistency, BW |
| Paging rules | Page holds 0 to MaxResults items and may be empty with a non-null `nextToken`; `MaxResults` cannot be combined with `InstanceIds` (exact error code to confirm; likely `InvalidParameterCombination`); bad token gives `InvalidPaginationToken`; DescribeSecurityGroups/DescribeTags 5 to 1000. Order of results "might vary", so tests must not depend on order. | QRY, BM, ERR |
| Terminated visibility | Usually under an hour; tags fade; after that `InvalidInstanceID.NotFound`. Design's `ec2.forget` keeps tags until then. | API:DescribeInstances, UG |
| `ClientToken` idempotency | RunInstances: same token and parameters returns success without launching again; same token with different parameters fails `IdempotentParameterMismatch`; idempotency is per region (the same token works in another region); a random token is used if you send none; max 64 ASCII characters; the instance echoes `ClientToken` and `client-token` is a filter. TerminateInstances idempotent by default. | DEV idempotency, BM |
| RunInstances details | `MinCount`/`MaxCount` (launch none if `MinCount` cannot be met); default security group and default subnet used when omitted (so the twin needs a `default` security group per VPC in its seed, which 2g omits); one reservation per call; `InstanceLimitExceeded`, `VcpuLimitExceeded`, `InsufficientInstanceCapacity` style errors. | BM, API:RunInstances, ERR |
| Error codes to expect | `InvalidParameterValue`, `InvalidParameterCombination`, `MissingParameter`, `InvalidKeyPair.Duplicate`, `InvalidGroup.NotFound`, `RequestLimitExceeded`, `AuthFailure`. | ERR |
| Waiter contracts | InstanceRunning fails on `shutting-down`, `terminated`, `stopping`; InstanceStopped fails on `pending`, `terminated`; InstanceTerminated fails on `pending`, `stopping`. The twin's state graph must never expose a state combination that trips these wrongly. | BW |
| StateReason and transition reason | `StateReason {Code, Message}` and `StateTransitionReason`. Code strings (for example for a user stop) were not in the pages read: to confirm. | BM |
| Reservation grouping | Instances from one RunInstances share a reservation; Describe returns reservations containing instances. | BM, API:DescribeInstances |

## For ec2.aws.a

- Fix the count in section 3: with DescribeVolumes and DescribeAddresses it is about 69 calls per refresh (17 regions), not 35. Or drop those two reads.
- Add DescribeVolumes and DescribeAddresses to 2b (the page needs them and the instance record's root volume belongs to DescribeVolumes), or the page's own calls will hit `InvalidAction`.
- 2b also lacks CreateSecurityGroup, AuthorizeSecurityGroupIngress, ImportKeyPair and RegisterImage, yet 2c, 2e, 2f.4 and 2f.8 rely on them. List them, or say the pack seeds those objects and the page cannot create them.
- Page only when `MaxResults` is sent; refuse `MaxResults` with `InstanceIds`; allow empty pages with a token; use `InvalidPaginationToken`; drop the "50" and make page size a pack value. No paging on DescribeRegions or DescribeKeyPairs.
- Describe answers must use the wire field names (section 2); derive root volume and credit mode from other actions, not from the Instance shape.
- Mark rules 2f.3, 2f.4 and 2f.7 as twin-only (no IAM key can enforce them) and say where the real guard lives (template check, Config rule, account default). Decide what the twin does when `HttpTokens` is omitted (2f.5).
- Add the missing mimics: DryRun, IncorrectInstanceState, idempotent Terminate, ClientToken and IdempotentParameterMismatch, all-or-nothing on a bad id, optional propagation delay for NotFound, Start then `pending` settle, terminated tags fading, and a `default` security group in the seed.
- Section 4: add the starred RunInstances resource types (security-group, subnet, network-interface) to the service role's allow, add Deny on CreateKeyPair and ImportKeyPair, and resolve the clash between "no SSM" and Session Manager's instance-profile needs.
- Ask Dinis (or keeper) to settle by browser test: does the EC2 endpoint accept the page's cross-origin POST (CORS)? Nothing public settles it.
- Still to confirm before the template: CloudFront prefix list name, HTTP origin port 8080, whether a stack can hold the schedule that deletes it, `iam:PassedToService` for EC2, the HTTP statuses of `DryRunOperation`, `UnauthorizedOperation` and `InvalidAction`, and the state-by-action matrix for `IncorrectInstanceState`.

## Addendum, 17:05 UTC: the four items ec2.aws.a's section 8 still lists

| Item | Verdict | Note and source (read 23 Nov 2026) |
|---|---|---|
| CloudFront custom origin on HTTP port 8080 | Confirmed | "Valid values include ports 80, 443, and 1024 to 65535", for both HTTP and HTTPS ports of a custom origin. CloudFront Developer Guide, DownloadDistValuesOrigin.html. |
| Error for `MaxResults` with `InstanceIds` | Partly | The API reference forbids the pair ("You cannot specify this parameter and the instance IDs parameter in the same request", botocore DescribeInstancesRequest.MaxResults) but names no code. The common errors page defines `InvalidParameterCombination` as "Parameters that must not be used together were used together", HTTP 400 (EC2 API Reference, CommonErrors.html). The twin may use it; that the real service returns exactly this code is still to confirm. |
| HTTP status of `DryRunOperation`, `InvalidAction`, `UnauthorizedOperation` | To confirm | errors-overview.html and CommonErrors.html list the codes and meanings without a status. The twin should pick one per code and mark it as its own choice. |
| Can a stack hold the schedule that deletes it? | To confirm (not documented) | No AWS page covers a stack whose own resource deletes the stack. A documented alternative keeps the schedule outside the stack: an EventBridge Scheduler one-time schedule created next to the stack, with `ActionAfterCompletion: DELETE` so the schedule removes itself after it fires (botocore scheduler 2021-06-30, CreateScheduleInput.ActionAfterCompletion, enum NONE or DELETE). Recommendation for 6b: create the schedule outside the stack, and give the scheduler's role `cloudformation:DeleteStack` on that one stack ARN only. |
