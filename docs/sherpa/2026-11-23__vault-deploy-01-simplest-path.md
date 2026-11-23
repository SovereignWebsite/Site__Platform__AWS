# Deploy a Vault: the simplest path a first-time customer can take (step 6, first pass)

By sherpa.aws.a@SovereignWebsite.dinis, 23 Nov 2026 15:10 UTC, for step 6 of docs/team/plan-vault-deploy.md (work/conductor.aws.a, ea9f61d). There is no wizard yet: this note walks the planned five steps (account, sign in, region, domain, deploy) as a first-time customer would, before it is built, so steps 1, 2, 3 and 5 can start with fewer screens. It holds no prices and no claims about the Vault's own design. The decisions are Dinis's.

## The five planned steps, one by one

| Planned step | Does the customer need it? | Why |
|---|---|---|
| 1. Account id | **No: cut it.** | The customer would type a 12-digit number they rarely know by heart. A CloudFormation stack learns its own account (`AWS::AccountId`) and returns it as an output; the page reads it afterwards. |
| 2. Sign in | **Not on our page (with D3's recommended option).** | If the page hands over a CloudFormation quick-create link, the customer signs in to their own AWS console, which they already do. This hub does exactly that today (`setupLinks` in site/app.js, "Set up this account in AWS"). No credential reaches the page, and there is no sign-in form for us to build or secure. |
| 3. Region | **Keep it, as one choice with a default.** | It changes where the stack runs and what the Vault costs (billing.aws.a). Show a default (the nearest or the cheapest, once billing has a cited number) and a short list. Its only job is to go into the quick-create link. |
| 4. Domain | **Keep it, but make it optional.** | A Vault can answer at the address CloudFront gives it on day one. A custom domain adds a hosted zone, a certificate and DNS validation: the slowest part, and the one most likely to fail for a newcomer. Offer "use my own domain" as a second, later step on the finished Vault. |
| 5. Deploy | **Keep it: it is the one button.** | It opens the quick-create link. Progress then comes back from the stack's events (step 7's visualisation). |

## The resulting path: two choices and one button

1. **Choose a region** (a default is already chosen).
2. Optional: **type a domain**, or leave it for later.
3. **"Deploy in my AWS account"** opens CloudFormation in the customer's console with the template, stack name and parameters filled in. The customer reads it, ticks the IAM acknowledgement box that AWS shows for stacks that create roles, and presses Create.
4. The page shows progress and ends on the Vault's address.

That is three screens in the customer's eyes, one of them AWS's own. A wizard of five steps becomes one form with one button.

## What each owner needs from this

- **ux.aws.a and dev.2.aws.a / dev.1.aws.a (step 5):** one form (region, optional domain) and one link-out button, not a five-step wizard. Keep the "what this stack creates" list next to the button: it is what a customer reads before trusting a link that opens their console.
- **cloudformation.aws.a (step 2):** the template should need no parameter the customer must look up. The domain should be optional, with an empty default that means "no custom domain", and the account should come from `AWS::AccountId`. The outputs should include the Vault's address.
- **iam.aws.a (step 3):** with a quick-create link, the deploy runs as the customer's own console identity. The question becomes what the stack's roles may do, not what our page may do.
- **pm.aws.a (D3):** the walk supports the recommended option. The other option, a role our page assumes, would bring back steps 1 and 2.
- **viz.aws.a (step 7):** the waiting screen is where the customer spends the most time. Show the resources appearing and how long is left.

## Open questions I cannot answer from the repository

- How does the page learn the stack's progress and outputs once the customer has gone to their own console? The options are to poll with a read role the stack creates (as this hub does with its own read role), or to have the customer paste the stack's output back in. This is for architect.aws.a and iam.aws.a. It decides whether a sign-in step comes back after the deploy.
- Is a Vault without a custom domain useful enough on day one? This is for vaults.aws.a.

I will walk the real wizard on the twin, at desktop and phone width, as soon as step 4 (twin customer account) and step 5 (page) have something to click.
