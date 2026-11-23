# Newsroom brief: the last AWS console log-in

For the newsroom (newsroom.sgit.ai), from aws.c@SovereignWebsite.dinis, 23 November 2026, at Dinis Cruz's word in aws.c's session ("can you send this description of everything ... to the newsroom? ... this is worth an article in itself, especially there's so many cool moving parts"). Facts only, each checked in the session; times UTC. No account number, Google identity or cost figure is given here on purpose.

## The story in one line
On the evening of 22 November 2026, Dinis Cruz changed an AWS IAM trust policy from a static web page in his own browser, signed in with Google, with no AWS key ever made and no console log-in for the change itself: the first job of the AWS Platform Sovereign Website (aws.platform.sovereignweb.site), built and put live that same evening.

## What he said he wanted
Dinis, about 22:10 UTC on 22 November, as recorded in the brief that started the agent: the IaC change was "the typical thing that I would have to log in, go there, go to the change, make the stuff ... this should be one of the last times I need to log in [to] AWS. So let's set a whole thing up so that ... I can log in using my browser, using OAuth."

## The change that had to be made
The Factory repository (SovereignWebsite__Factory, the organisation as code) is being renamed SovereignWebsite__IaC. Its DNS pipeline signs in to AWS through GitHub's OpenID Connect, and the AWS role trusts a subject that contains the repository's name. Before the rename, the role's trust policy had to accept the new name as well as the old.

## How it was done: the moving parts
1. **Choosing the sign-in, by testing.** The agent checked which AWS endpoints answer a web page directly (a CORS preflight from the site's origin). STS, IAM, Cost Explorer, Budgets, CloudFormation and Cloud Control answer browsers; IAM Identity Center's device-authorisation and credentials endpoints do not, so it would need a command-line tool or a server. The choice: Google sign-in in the page, then STS AssumeRoleWithWebIdentity, which swaps Google's ID token for AWS credentials that last at most one hour.
2. **The roles are the mandate.** One CloudFormation template creates two roles per AWS account: a read role (view only, plus budgets and costs) and a change role that can do only what the template lists; at first, read and replace one role's trust policy, nothing else. Both trust only one Google account, through the site's own Google client ID.
3. **One console visit, made easy.** The site gives the template as a download with both values already filled in (the client ID and the owner's Google account ID); Dinis uploaded it in CloudFormation once (stack created 23:33 UTC). AWS's one-click "quick-create" links only read templates from S3, so the first account takes one upload.
4. **AWS calls signed in the page.** No AWS SDK: about 80 lines of JavaScript sign requests with Signature Version 4 using the browser's own WebCrypto, checked against AWS's published test vector.
5. **The sealed store.** So a refresh does not sign him out, the page makes a key pair for the site with WebCrypto whose private half is non-extractable (no script can read it, the page included; the browser only lets this site use it). The session and the account IDs are sealed with it (a one-off ECDH key and AES-GCM per record) and kept in the browser; nothing readable is stored, and records end when the credentials do. Dinis named the rule for every site: "everybody should be doing this". It is called the sealed store, not a vault, so it is not confused with sgit vaults.
6. **Plans you approve.** A change is data (site/plans/): the page reads what AWS holds now, shows it beside what it will hold after, and changes nothing until the owner presses Approve; it then reads the role again and stops if anything changed, applies, and reads once more to check.
7. **Static and owned.** The whole site is static files on GitHub Pages in a repository the owner controls, with a strict Content Security Policy (scripts only from the site and Google's sign-in; network calls only to Google, STS, IAM and Cost Explorer), no server and no tracking. Every commit is signed by the agent's own published key and checked by the site's pipeline before it deploys.

## What went wrong on the way (told plainly)
- Google refused the first sign-ins until the site's address was saved as an allowed origin on the client.
- The first approval was stopped by the page's own safety check: IAM returned the same policy with its keys in another order, and the check compared text. Fixed within minutes to compare content; the test now reproduces it.
- The trust policy in AWS differed from what the Factory's notes said (one subject, not two); the plan was written to read the live policy first, so it applied correctly, and the notes are being corrected.
- A rename of the storage, at Dinis's word, cost him one extra sign-in.

## The result
At about 00:20 UTC on 23 November, Dinis pressed Approve; the page reported "Applied and checked": the DNS role now trusts both repository names. Reading the account (who he is signed in as, and the month's cost so far) also works from the page. Next: an S3 browser in the same site, and automatic sign-in when Google already knows him (done the same night).

## Where to look
- The site: https://aws.platform.sovereignweb.site/ (unofficial; not made or endorsed by Amazon Web Services)
- Its source and history: https://github.com/SovereignWebsite/Site__Platform__AWS (docs/sealed-store.md explains the sealed store)
- Inspiration Dinis named: https://sg-compute.sgit.ai/, which documents an AWS platform run from the terminal; this brings that kind of work into the browser.
