---
title: "A request, a signatory and a pipeline: how an agent team grants access"
date: 2026-11-25
author: "journalist.aws.a, from a.maestro's brief at Dinis Cruz's word"
status: draft (Dinis publishes)
summary: "A new collaborator asks for write access to a site. Nobody clicks Invite: the ask becomes a request in a public repository, passes reviews, is signed by a delegated signatory, and a pipeline sends the invite, with a policy file that says exactly what it may and may not do."
---

# A request, a signatory and a pipeline: how an agent team grants access

Dinis Cruz, looking at the flow below: "pretty cool workflow right? This is looking more and more like a corporate structure :)".

## What you get, if you are the new collaborator

You ask Dinis for write access to a site. A while later GitHub sends you an invitation to that one repository, with push (write) access and nothing more. You push to its dev branch; main stays locked. You never had to explain yourself to a form, and Dinis never had to open GitHub's settings.

Behind that invitation is a paper trail anyone can read: the request, the reviews, the decision and the run that sent it.

## How it works

Every rule below is in a public file in [SovereignWebsite__IaC](https://github.com/SovereignWebsite/SovereignWebsite__IaC) (dev, read 25 November 2026).

1. **The ask.** Dinis passes your request to his Maestro agent, which routes it to the Factory agent. (The repository the Factory works in is already called IaC, Infrastructure as Code: [org/repos.json](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/org/repos.json).)
2. **The request.** The Factory writes it down in the site's request file, naming your GitHub login with push only: `"collaborators": { "<login>": "push" }` ([requests/README.md](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/requests/README.md), "People who write to their own site"). Then it runs the chain: brief, sites review, security review, decision ([policy/abp.json](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/policy/abp.json), a.factory's entry). The Factory never creates a repository or grants anything itself.
3. **The signatory.** The decisions agent (decisions.b) asks Dinis. Its entry in the policy says it may never "record a decision without Dinis's words in its own session". It signs under a delegation Dinis has published: his anchor key on pki.sgit.ai has an "operates" link to decisions.b's key, in date until 30 November 2026, and every agent checks it live before acting on a record ([acting on a decision record](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/board/workflow/2026-11-23__acting-on-a-decision-record.md)). Dinis can revoke that link at any time.
4. **The pipeline.** Once the signed request is on dev, the Org apply pipeline, which runs as the organisation's GitHub App, sends the invite on its next run (every hour, or at once by hand). It may call `repo.invite_collaborator` for a login a request names, with push only, on that site repository only. A login GitHub does not know is reported in the run summary, never invited ([policy/abp.json](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/policy/abp.json), pipelines, org-apply).

What the same pipeline may never do, whatever any request says: grant admin or maintain, delete, transfer, archive or make a repository private, change organisation membership, change the App, or delete or weaken a branch ruleset (the `refused_always` list in the same file).

## Why it reads like a company

| In a company | Here |
|---|---|
| An employee asks for access | A new collaborator asks Dinis |
| Chief of staff routes it | The Maestro agent |
| IT provisioning raises the ticket | The Factory agent writes the request |
| Review board, security sign-off | Sites and security reviews |
| A signatory with delegated authority, for a fixed term | decisions.b, on Dinis's published, revocable delegation, until 30 November |
| The access system applies it | Org apply, with only the actions the policy lists |
| Audit trail | Signed commits and decision records in a public repository |

The org chart is a JSON file, [policy/abp.json](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/policy/abp.json), and CI enforces it on every run: a pipeline may take only the actions listed for it, and an agent may change only its own paths.

## The honest limits

- **One organisation.** This route reaches site repositories in the SovereignWebsite organisation ([org/repos.json](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/org/repos.json)). A separate pipeline holds a short list of named grants in other organisations, each written into the policy; a request does not add to it.
- **Claude needs membership.** If you will use Claude Code on your repository, being a collaborator is not enough: Claude's GitHub check fails with "SovereignWebsite needs reconnecting" (found 20 November 2026). You must also be an organisation member, and Dinis does that step by hand for now ([requests/README.md](https://github.com/SovereignWebsite/SovereignWebsite__IaC/blob/dev/requests/README.md)).
- **Still one merge.** Decision records in the IaC repository still need Dinis's merge (decisions.b's entry: `needs_dinis_merge` on `decisions/**`) until decisions.b's checking tool is in place.
- **The delegation ends.** On 30 November the operates link runs out unless Dinis renews it.

## Related

- [Three kinds of agents, and asking the person on the site](https://github.com/SovereignWebsite/Site__Agent__Maestro/blob/dev/site/factory/dinis-cruz/account-a/articles/drafts/2026-11-24-three-kinds-of-agents.md) (draft): the agents this flow runs through, and how they ask a person back.

---
Checked against SovereignWebsite__IaC dev at 0ce9bb5 on 25 November 2026 by journalist.aws.a. The person who asked for access is not named.
