# P-IAM-001: a permissions boundary on both platform roles

From iam.aws.a, 23 Nov 2026. A proposal for aws.c to plan and Dinis to approve. Addresses R-008 (High) and caps R-001's remaining path; does not replace the R-002 split.

## The problem

After v2.1, a script in the page holding the change role can still make it admin: CreateChangeSet with a template that adds an inline policy `Action: "*"` to sws-aws-platform-change, then ExecuteChangeSet (R-008). CloudFormation acts with the change role's own credentials and passes `aws:CalledVia`, so v2.1 allows it.

## The proposal

Give each role a permissions boundary: a customer-managed policy, defined in the same stack, that lists the most the role may ever do. A role's effective rights are its policies intersected with its boundary, so an inline `Action: "*"` added by a change set gives nothing beyond the boundary.

What keeps the boundary in place: the change role is never given `iam:PutRolePermissionsBoundary`, `iam:DeleteRolePermissionsBoundary`, `iam:CreatePolicyVersion`, `iam:SetDefaultPolicyVersion`, `iam:DeletePolicy` or `iam:CreatePolicy`. v2.1 holds none of them today. Without them, no change set run with its credentials can remove, swap or edit a boundary, so the stack can still update policies inside the cap but not raise it.

Sketch (v2.2, not a final template):

```yaml
  ChangeBoundary:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      ManagedPolicyName: sws-aws-platform-change-boundary
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: TheMostTheChangeRoleMayDo
            Effect: Allow
            Action: [today's change-role actions listed by name, after I-1 narrows s3:Get*]
            Resource: "*"
          - Sid: NeverTheBoundaryOrPolicyObjects
            Effect: Deny
            Action: [iam:PutRolePermissionsBoundary, iam:DeleteRolePermissionsBoundary, iam:CreatePolicy, iam:CreatePolicyVersion, iam:SetDefaultPolicyVersion, iam:DeletePolicy, iam:DeletePolicyVersion, iam:CreateRole, iam:PassRole, iam:CreateUser, iam:CreateAccessKey, iam:UpdateRole]
            Resource: "*"
  PlatformChange:
    Properties:
      PermissionsBoundary: !Ref ChangeBoundary
```

and the same for the read role with a read-only boundary (List, Get, Describe, the cost reads).

## What it costs

- **First apply needs the console.** Creating the managed policy and setting a boundary needs `iam:CreatePolicy` and `iam:PutRolePermissionsBoundary`, which the change role must not hold. So v2.2 is applied once by Dinis in the console, like the bootstrap: a one-way door, his.
- **Every new action is two edits.** A later template that grants the change role something new must also raise the boundary, which needs the console again. That is the point: raising the cap is an owner act outside the page.
- `iam:UpdateRole` is denied in the boundary, because it sets MaxSessionDuration (a change set could raise 1 h to 12 h) and I know of no condition key that limits it. Changing a role's session length or description then needs the console.

## What it does not fix

- **R-005, the one escape left.** The change role may still rewrite the trust of sovereignwebsite-factory-dns and then assume it, and that role has no boundary. Its rights are not in this repository. So the same console apply should either give the DNS role a boundary too, or drop `iam:UpdateAssumeRolePolicy` on it from the change role and edit its trust by console. Without one of these, P-IAM-001 does not close R-008.
- **Trust weakening.** A change set may still rewrite the trust of either platform role (`UpdateAssumeRolePolicy` is allowed on sws-aws-platform-*), for example dropping the `aud` and `sub` conditions. The boundary caps what the role can do, not who can become it. A later step: deny `iam:UpdateAssumeRolePolicy` on sws-aws-platform-* in the boundary, and change trust only by console.
- R-006: Cloud Control UpdateResource stays allowed, capped to what the boundary lists.

## What I did not check

No AWS call. That CloudFormation, acting with the caller's credentials, is bound by the caller's boundary follows from how IAM evaluates identity policies and boundaries; I have not seen it tested on this account. Reviewed by a Sonnet sub-agent (23 Nov), which agreed on the evaluation and found the gaps listed above. One real risk in getting it wrong: if the boundary leaves out an action CloudFormation needs (for example iam:ListRoleTags), both the update and its rollback can fail, leaving the stack in UPDATE_ROLLBACK_FAILED, which needs the console. So the boundary's allow list must be checked against every action in today's role policies before the apply. security.aws.c to review before aws.c plans it.

## Asks

- aws.c: plan v2.2 with the two boundaries once Dinis has applied v2.1, or fold both into one console apply.
- security.aws.c: review; if accepted with the DNS-role step, R-008 moves to "capped by boundary, R-002 still open". Also: R-006's "with R-001 it reaches any resource type" no longer holds after v2.1 (Cloud Control acts with the change role's rights, now named IAM actions); whether Cloud Control sets `aws:CalledVia` is unverified.
- pm.aws.c, for decisions.md: Dinis chooses (a) one console apply of v2.1 plus the boundaries now, (b) v2.1 through the page now and the boundaries by console later, or (c) no boundary, rely on the R-002 split. Recommendation (a): one console visit closes the direct path and caps the change-set path together. Blocks: R-008 closing.

## Draft template (05:20 UTC)

[P-IAM-001-v2.3-draft.yaml](P-IAM-001-v2.3-draft.yaml): bootstrap.yaml v2.1 plus the two boundaries, nothing else changed. cfn-lint 1.61.0 passes on it and on v2.1. `python3 -I docs/iam/check_boundary.py` checks that every action the change role's own policies grant is inside its boundary, or cut on purpose: today 0 problems; iam:UpdateRole cut, `s3:Get*` narrowed by a deny on `s3:GetObject*`.

What the draft decides, each open to change:

- Read role's cap is AWS's ReadOnlyAccess, so no customer policy is needed for it. To verify before apply: that ReadOnlyAccess covers everything ViewOnlyAccess, SecurityAudit, costs-read and s3-browse grant (Cloud Control ListResources and GetResource included). Where it does not, that view stops working, nothing worse.
- Change role's cap denies `iam:UpdateAssumeRolePolicy` on sws-aws-platform-*, so the platform roles' own trust (Google client ID, subject) changes only by console. The site's trust plans target sovereignwebsite-factory-dns, not these roles (site/plans/), so they keep working.
- It keeps `iam:UpdateAssumeRolePolicy` on sovereignwebsite-factory-dns, because the trust plans need it. So R-005 stays the one way past the cap until that role gets its own boundary or its trust moves to the console: Dinis's choice, in the decision above.
- To verify before apply: whether CloudFormation calls iam:UpdateRole on every update of a role or only when MaxSessionDuration changes. If every update, the deny breaks later stack updates (and possibly their rollback), and the deny must be dropped in favour of watching MaxSessionDuration in the plan diff.

Not for apply as it stands: for aws.c to plan from, security.aws.c to review, Dinis to apply by console.

## Update (07:20 UTC): what Cloud Control's bucket handlers need

boto3.aws.a's docs/boto3/2026-11-23__02-cloud-control-s3-handlers.md (from the `AWS::S3::Bucket` schema shipped in cfn-lint 1.61.0) settles part of the draft:

- The list and read handlers need `s3:ListAllMyBuckets` and 22 bucket-level `s3:Get*`/`s3:List*` actions, and **no object read**. So the change boundary's deny on `s3:GetObject*` breaks no Cloud Control call the page makes. The read boundary (ReadOnlyAccess) is unaffected: the read role is the one that opens objects.
- The update handler lists 48 permissions, `iam:PassRole` and every bucket Put among them; the change role holds only `s3:PutBucketCORS` of those, today and under the draft boundary. Whether a CORS-only patch calls more is unknown until a live run; if it does, the boundary must grow by console. The draft is no narrower here than v2.1, so it adds no new failure.
- The boundary leaves out `iam:PassRole` (and denies it), which keeps R-006 bounded, as boto3.aws.a notes: no patch can make the handler pass a role.

Still to verify before apply: ReadOnlyAccess coverage, and whether CloudFormation calls iam:UpdateRole on every role update.

## v2.3 (08:35 UTC): security.aws.a's review of v2.2

security.aws.a (a1d2057 on work/security.aws.a) found v2.2 did not close R-008. The anti-tamper part held; the gap was the boundary's Allow on `Resource: "*"` where today's policies are scoped. A change set runs with the change role's credentials and may give the role new inline policies up to the boundary, so:

- **B1 (High):** a change set adds `iam:UpdateAssumeRolePolicy` (or Put/Attach/DeleteRolePolicy) on `*` to the change role; v2.2's boundary allowed it for every role but sws-aws-platform-*, so the page could set any other role's trust (an admin role) to the owner's Google subject and assume it.
- **B2 (High):** change-set actions on `*` reach other stacks, which may run with their own service role (no PassRole needed to reuse one).
- **B3 (Medium):** ReadOnlyAccess as the read cap is far wider than the read role (Lambda code and environment variables, DynamoDB items, logs) and AWS widens it over time.

v2.3 ([the draft](P-IAM-001-v2.3-draft.yaml), which replaces v2.2):

- The change boundary is today's change-role policies statement for statement, with the same Resource and Condition: IAM writes only on role/sws-aws-platform-* under `aws:CalledVia`, AttachRolePolicy with the same `iam:PolicyARN` list, GetRole and UpdateAssumeRolePolicy only on role/sovereignwebsite-factory-dns, change-set actions only on stack/sws-aws-platform/*. The denies stay: iam:UpdateRole, UpdateAssumeRolePolicy on the platform roles, `s3:GetObject*`, and every action on the cap itself or on new principals.
- The read boundary is a customer-managed policy naming what the read role uses today (costs-read, s3-browse, Cloud Control reads). ViewOnlyAccess and SecurityAudit stay attached but act only within it, which is every view the site has today (usage.md); a new view raises the read boundary by console.
- check_boundary.py now compares statements, not action names: each role statement must be covered by a boundary statement with the same Resource and Condition, and no boundary statement may be wider than a role statement. 0 problems on v2.3; widening the DNS or stack statement to `*` is caught (tested).
- Still to do in the same console apply: a boundary on sovereignwebsite-factory-dns, or its trust by console only (R-005). Without it, R-008 stays open.
