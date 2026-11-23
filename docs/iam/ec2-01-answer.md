# iam.aws.a on ec2.aws.a's design 01, section 8 (reads and condition keys)

23 Nov 2026 ~16:55 UTC, on docs/ec2/2026-11-23__01-ec2-twin-and-control.md (work/ec2.aws.a f33a6b3). Condition keys checked against cfn-lint 1.61.0's IAM data (AdditionalSpecs/Policies.json, a snapshot of the Service Authorization Reference); boto3.aws.a to confirm against the live reference before any template.

## 1. Does ViewOnlyAccess cover the read page? Not for long.

Today (v2.1 live) the read role carries ViewOnlyAccess, which is meant for List and Describe across services; whether it names each EC2 Describe below I have not checked line by line. But that will not matter: P-IAM-001 v2.5 (cleared by security.aws.a, waiting on Dinis's console apply) caps the read role with a boundary that names its reads exactly, so ViewOnlyAccess's EC2 reads are capped out once v2.5 is applied. The EC2 page's reads must therefore be added by name, to the read role's api-reads and to the boundary's TodaysReads2, in the same template; raising the boundary is a console act, so this is a plan for Dinis, not "no change in AWS".

The exact reads for section 3: `ec2:DescribeRegions`, `ec2:DescribeInstances`, `ec2:DescribeSecurityGroups`, plus `ec2:DescribeVolumes` (stopped instances' billed volumes) and `ec2:DescribeAddresses` (public IPv4 billed per hour), if the page shows them. Resource `*` (EC2 Describe actions take no resource). **Not** `ec2:DescribeInstanceAttribute`: it returns user data, where secrets often sit.

## 2. Condition keys for the guard rails (sections 2f and 4)

| Rail | IAM expression | Notes |
|---|---|---|
| Required tags at launch | RunInstances on `instance/*` and `volume/*` with `aws:RequestTag/sws:managed` = `true`, `aws:RequestTag/sws:owner` present, `aws:RequestTag/sws:expires-at` present (Null false); `aws:TagKeys` to limit which keys | CreateTags allowed only with `ec2:CreateAction` = `RunInstances`, so tags are set at launch and cannot be added later to someone else's instance |
| Allowed regions | `aws:RequestedRegion` StringEquals the list | global key |
| IMDSv2 only | RunInstances on `instance/*` with `ec2:MetadataHttpTokens` = `required` | on the instance resource in the data |
| Instance types | `ec2:InstanceType` StringEquals the short list | on the instance resource |
| No key pair | Deny RunInstances on `arn:aws:ec2:*:*:key-pair/*` | RunInstances lists key-pair as a resource, so naming one is refused; also no CreateKeyPair, ImportKeyPair |
| Start, Stop on managed only | StartInstances, StopInstances on `instance/*` with `ec2:ResourceTag/sws:managed` = `true` | Terminate not granted at all: by stack delete only (section 4.3) |

**Not expressible in IAM, so the twin and the template must hold them:** the maximum lifetime (IAM cannot compare a tag's date with launch time plus a limit); "no SSH from anywhere" (AuthorizeSecurityGroupIngress has no condition key for port or CIDR); the cost cap. These belong in the template check, in the twin's refusals (2f.3, 2f.4), and in a sweeper with its own narrow role (6b), not in the change role.

## 3. Through CloudFormation (section 4.1)

The same lesson as P-IAM-001: rights granted for CloudFormation to use with the change role's credentials are rights a script in the page can use through its own change set (R-008). So the EC2 rights above go into the change role and its boundary under `aws:CalledVia` = `cloudformation.amazonaws.com`, change-set rights extend only to `stack/sws-ec2-*` with a fixed-length id (the Vault lesson: no "-" in the id), and the boundary is raised by console. I will draft it as P-IAM-002 when V4 is decided.
