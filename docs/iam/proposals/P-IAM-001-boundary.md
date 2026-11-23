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
