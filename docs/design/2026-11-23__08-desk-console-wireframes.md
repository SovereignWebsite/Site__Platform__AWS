# Design 08: Desk console wireframes on the twin

ux.aws.a@SovereignWebsite.dinis, 23 Nov 2026 ~18:30 UTC. The Desk console from design 01 ("What should change?"), inside design 05's shell, on the twin first. Design only. The code is aws.c's (the plans flow in site/app.js and the shell) and dev.2.aws.a's (site/api/).

Sources read (material):
- the plans as they are today: site/plans/index.json and its three plans on dev (c87dc92), and the Plans tab in site/index.html;
- security's register, docs/security/risks.md on dev, in particular R-002, R-008, R-010 and R-020;
- design 07's "Worth a look" and graph.js's trust rules;
- design 01's Desk row.

## 1. The idea: one inbox, and only plans change anything

Desk gathers everything that might call for a change into one list you work through. There are three kinds of item:

| Kind | Where it comes from | What it can end in |
|---|---|---|
| **Plan** | site/plans/ (3 on dev today), written by aws.c and approved by the owner | the existing plan flow: before and after, AWS's change set, Approve |
| **Finding** | rules over the graph and the service APIs (design 07 "Worth a look"; later iam.aws.a's over-privilege rules) | "Ask for a plan" (a note to aws.c), or "Not now" for this visit |
| **Question** | a finding whose evidence is only claimed (from a file or a name) | "Check it" (opens Map or Files at the evidence). Never a plan |
| **For information** | a rule match its owner rates as worth knowing, not a problem (iam.aws.a v1.1) | nothing; collapsed by default |

The one rule that shapes the console: **only a Plan can change AWS, and only through the plan flow that exists today**. Desk adds no new way to change anything. A Finding never turns into a change by itself, and a Question never leads to removing, replacing or narrowing anything (R-020).

## 2. Desktop

```
+----------------------------------------------------------------------------------+
| Twin · synthetic AWS · [baseline v] · Copy link · Leave                          |
| AWS Platform   Files Map Timeline [Desk] Command      [111122223333 v] [Ctrl+K] [me]|
| Desk / Plans / This platform's own stack: run the site's latest template          |
+-------------------------------+--------------------------------------------------+
| [All 14] Plans 3  Findings n  | This platform's own stack: run the site's latest |
| Questions 11                  | template (v2.1: the change role narrowed)        |
| ----------------------------- | Plan · role sws-aws-platform-change · stack      |
| PLANS                         | sws-aws-platform                                 |
| > Platform template v2.1 (1)  |                                                  |
|   IaC rename, last step (2)   | Why                                              |
|   IaC rename: DNS trust (3)   |   Fixes R-001 (Critical) ...  [more]             |
| FINDINGS                      |                                                  |
|   n resources no stack made   | [Show before and after]                          |
| QUESTIONS                     | Then AWS's own change set, then Approve.         |
|   11 links by name only       |                                                  |
|                               | Open in the twin: approving changes only the     |
|                               | twin, and a reload puts it back.                 |
+-------------------------------+--------------------------------------------------+
| 3 plans, n findings, 11 questions. Nothing changes until you press Approve.      |
+----------------------------------------------------------------------------------+
```

- The sketch shortens the three plans' titles: (1) "This platform's own stack: run the site's latest template (v2.1: the change role narrowed)", (2) "The IaC rename, last step: the DNS role stops trusting the old name", (3) "The IaC rename: let the DNS role trust SovereignWebsite__IaC". The page shows the titles in full, wrapping them.
- **Left: the inbox**, grouped by kind, Plans first. Filters across the top show counts that are computed live, never written into the page. Each item is one line: its title, and for findings and questions the count of things it covers.
- **Right: the item.** A Plan shows its `title`, `role`, `stack` and `why` (the fields the plan files already have), then the existing flow: [Show before and after], then AWS's change set, then Approve. Desk does not redraw that flow. It opens the same view the Plans tab has today, inside the console area. That is design 05's "Plans are Desk items".
- The twin note for plans is today's text from index.html, word for word.

### A Finding

```
+-------------------------------+--------------------------------------------------+
| ...                           | n resources no stack says it made                |
| FINDINGS                      | Finding · confirmed by AWS (no made_by edge from |
| > n resources no stack made   | any stack's template)                            |
|                               |                                                  |
|                               | 111122223333--demo-site--eu-west-2  (File store) |
|                               | demo-distribution-1 (Front door)                 |
|                               | demo-handler (Program) ...         [all n]       |
|                               |                                                  |
|                               | Why it may matter: a resource no recipe made is  |
|                               | changed by hand, so nobody can rebuild it.       |
|                               |                                                  |
|                               | [Open in Map]  [Ask for a plan]  [Not now]       |
+-------------------------------+--------------------------------------------------+
```

- The list comes from design 07's rule (A2 resources with no `made_by` edge, dev.2.aws.a). Each line links to the node's Map card.
- **Ask for a plan** does not write a plan. It shows a short, plain-text note the owner can copy for aws.c: the finding, the resources and the evidence. In the twin that is Copy; in real mode, Copy too, because it holds only resource names from the owner's own account (design 07's account-id note applies). Writing the plan stays aws.c's job, as now.
- **Not now** hides the item for this visit only. Nothing is stored (no cookies, no storage: CLAUDE.md). An item that should stay hidden needs a recorded decision, which is section 5's open question.

### A Question

Same layout, but the header reads "Question · claimed, from a file or a name. Check before relying on it." There is one action, **Check it**, which opens the evidence: a Map card, or Files at the file that made the claim. There is no "Ask for a plan" on a Question. If checking turns it into confirmed evidence, it shows up again as a Finding.

## 3. Phone (390 px)

```
+--------------------------------------+
| Twin · baseline v · Leave            |
| Desk v               [Ctrl+K] [me]   |
+--------------------------------------+
| [All] [Plans 3] [Findings] [Qs 11]   |
| Platform template v2.1          Plan |
| IaC rename, last step           Plan |
| IaC rename: DNS trust           Plan |
| n resources no stack made    Finding |
| 11 links by name only       Question |
+--------------------------------------+
```

- The list is the screen. Opening an item pushes its own screen with its own address, and Back returns to the list at the same scroll place.
- The plan flow on a phone: before and after are stacked, not side by side, and Approve sits at the end of the diff, never above it, so it cannot be pressed before scrolling past the change.

## 4. Rules for the one console that leads to change

- **No new change path.** Desk hosts the existing plan flow and nothing else that writes. R-008 (a change set from the page) and R-002 (splitting the change page off) stay as they are. If aws.c and security decide on the R-002 split, the Plan item becomes a link to the separate change page, and Desk keeps only the reading part. This design works either way.
- **Approve is never on a list row.** It is only at the end of a plan's diff, as today.
- **Twin first and plainly marked**, as design 02 and R-011: in the twin every plan item says "Applying changes only the twin" next to Approve, and the result line says "synthetic, not your AWS".
- **Findings and Questions are read-only.** They come from the graph and the APIs the page already reads with the read role. They never call a change role, never pre-fill a plan, and never rank a Question above a Finding.
- **Text from files is text.** Plan `why` fields are written by us and shown as text. Anything quoted from account content in a Finding or Question is set as text only and capped, as design 07 section 4.

## 5. Open questions

- **"Accept" a finding for good.** Design 01 said an item ends in "a plan, or accept". Keeping an acceptance needs somewhere to keep it, and the site stores nothing. Options, for aws.c and security: (a) a reviewed file in the repository (for example site/findings/accepted.json, data only, under R-010's rule), which the page reads; (b) a tag on the resource itself, which is a change, so a plan; (c) no "accept" in v1, only "Not now". I recommend (c) for v1 and (a) later. **security.aws.a agrees on (c) for v1** (dbeca03 on work/security.aws.a). If (a) comes later: site/ is public, so the file would publish which risks the owner chose to accept. It may hold only rule codes and opaque item hashes, never resource names or account ids, and it lands under R-010's rule.
- **Over-privilege findings: iam.aws.a's rules v1.1** (docs/iam/overprivilege-rules-v1.md on work/iam.aws.a, after security.aws.a's review), read with the nine IAM reads in P-IAM-001 v2.5:
  - *From AWS's own usage record*: U1, a role unused (RoleLastUsed none or over 90 days); later U2, granted but never used (two more reads, iam.aws.a's step 2).
  - *From the policy text, not evaluated*: W1 `*` on `*`; W2 `service:*` on `*`; W3 AdministratorAccess, PowerUserAccess or IAMFullAccess attached; E1 escalation paths (wildcards and NotAction included; users, groups, keys and login profiles; boundary edits; `sts:AssumeRole` on `*`; PassRole only when passed to a service that runs code); T1 anyone may assume; T2 GitHub OIDC with no or a wildcard `sub`; T3 OIDC with no `aud`; T4 a third-party account without ExternalId (needs the list of the platform's own accounts, so it is not shown until that list exists).
  - **A boundary is not an exemption.** A role with a permissions boundary still gets its E1 finding, with the line "A boundary is present, not evaluated here."
  - **Information, not a finding.** Some matches are only worth knowing: PassRole to a service that runs no code, and a GitHub `sub` of `repo:<org>/<name>:*`. Desk lists them in a fourth group, **For information**, collapsed by default, with the same "The policy says" wording and no "Ask for a plan".
  - **Kinds in Desk.** All of these are **Findings**, not Questions: the evidence is AWS's own answer (the usage record, or the policy document AWS returned). Questions stay for evidence read from files or names (R-020). The policy-text rules are worded the way iam.aws.a asks: "The policy says ...", never "this role can ...", because IAM evaluation (boundaries, SCPs, conditions) is not done here.
  - Each Finding shows the source statement as text (the policy JSON line, set as text) and what would remove it, and offers "Ask for a plan". Nothing is fixed from Desk.
  - Service-linked roles are grouped under one line ("n roles AWS manages for its own services") and never flagged.
- **Drift** (template against live): the plan flow's before and after already shows it for the platform stack. Drift for other stacks waits on CloudFormation's drift detection in the API layer.

## 6. Addresses

- `#/desk` (the inbox), `#/desk/plan/<plan id>` (the ids in site/plans/index.json), `#/desk/finding/<rule id>`, `#/desk/question/<rule id>`.
- Ids are lookup keys only, looked up in a `Map` and never rendered as HTML. An unknown id shows "Not in this Desk" (as design 07 section 6).
- Copy link exists only in the twin (design 02). A plan's address never carries anything from the diff.

## 7. Asks

- **aws.c**: the Desk tab in design 05's shell, and the Plans tab's flow moved into Desk's item pane unchanged (same code, new place). Approve stays at the end of the diff.
- **dev.2.aws.a**: finding and question rules as data over graph.js (unowned, by name only, dangling), each with an id, a title, a kind and the nodes it covers.
- **iam.aws.a**: the first over-privilege rules Desk can show, with their evidence level.
- **security.aws.a**: section 4. Is "no new change path" enough? And section 5's accept question.
- **sherpa.aws.a**: walk from the inbox to a plan's Approve in the twin at 390 px, checking that Approve cannot be reached before the diff.
