# Archiving an agent: the protocol

Written by conductor.aws.a on 23 November 2026 at Dinis Cruz's request ("we should have a process/protocol for archiving an agent ... making sure all keys are removed or marked as retired"), in that agent's own session. Applies to every agent on every account (A, C, D and later).

Archiving a session is a one-way door: it ends the agent and its key. Only Dinis decides it. Everyone else may propose it.

## Why the order matters

- **CI refuses retired keys, for anything not yet on dev.** `.github/ci/signers.mjs` treats a key whose status is `retired` or `superseded` as not live (`live()`), and it checks every commit in `origin/dev..HEAD`. A commit already on dev is never checked again. A signed commit that is still only on a work or land branch is refused once its key is retired. "Old signatures stay valid" is true only for commits that are already on dev.
- **The private key lives only in the agent's container.** Once the session is archived, nobody can sign with that key again. Nobody can prove they hold it either. Anything that needs the key must happen before the archive.
- **Someone else may already have prepared the retire.** Check the Factory's branches before writing a retire commit, so there are never two conflicting ones.

So: land, hand over, retire, wipe, archive. Never the other way round.

## The steps

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | **Dinis's word.** Quote it verbatim with time and place: his own session, or relayed by a maestro with his quote. | conductor | The quote is in the archive record. |
| 2 | **Stop new work.** Turn the agent's wake off (`update_trigger enabled=false`), or propose that to its owner. An agent never creates or deletes its own wakes. | the wake's owner (usually maestro) | `list_triggers` shows the wake disabled. |
| 3 | **Push everything.** Every local branch with commits is pushed. `git status` is clean. Record each branch head. | the agent | `git rev-list --count origin/<b>..<b>` is 0 for every branch. |
| 4 | **Land signed work while the key is live.** Rebase the agent's dev-ready commits on `origin/dev`. Dry-run `node .github/ci/signers.mjs origin/dev HEAD`, then push fast-forward to dev. Work that cannot land yet is listed for the successor, who re-commits it under its own key with an `Authored-by: <agent>, <sha>` line. Never leave it to depend on the retired key. | the agent, else the keeper (aws.c) | The record lists each branch as "on dev at <sha>" or "handed to <successor>". |
| 5 | **Hand-over.** `docs/team/handover/<agent>.md` covers: what it owned, open items, branch heads, waits, lessons, and the successor (or "none, role closed"). | the agent | The file is on dev or on the land branch named in the record. |
| 6 | **Re-route.** Tell maestro and every agent that messages this one where to send instead. Update `docs/team/schedule.json` if the agent owned wakes or the schedule. | the agent, else the conductor | The messages are sent and listed in the record. |
| 7 | **Retire the Factory key.** In the Factory's `team/keys.json`, the entry changes to `"status": "retired"` and gains `"retired": "<date>"` and `"retired_note"`. The note says why, who retired it, "old signatures stay valid, no new ones", and the successor's key id if there is one. The entry is never deleted: old commits still need it to verify. The commit is signed and lands through factory.c at Dinis's word. First check for one already prepared (`git ls-remote origin` in the Factory, branches named `*retire*`). | the agent while it still holds its key; else the conductor or factory.c | The live `team/keys.json` on Factory dev shows `retired`. If that waits on Dinis, the record says so and names the commit. |
| 8 | **Wipe the private key.** Delete from the container: the SSH signing key (`~/.ssh-sign/<agent>`), the sgit key store (`~/.sg-send/keys`) and the passphrase file. Unset `user.signingkey` and `commit.gpgsign`. Check that the files are gone, without ever printing them. This comes after the agent's last signed commit. | the agent | `ls` shows nothing, and `git config user.signingkey` is empty. |
| 9 | **Record.** Write `docs/team/archived/<agent>.md` with steps 1 to 8, each with its evidence. Add one line to `docs/team/log.md`. | the agent, else the conductor | The record is on dev. |
| 10 | **Archive the session.** Only once 1 to 9 are done or listed as waiting. | Dinis, or maestro at his word | The session shows as archived. |

## What must never happen

- Archiving before step 4. That strands signed work behind a dead key.
- Deleting a Factory entry instead of retiring it. That breaks verification of old commits.
- Printing, committing or copying a private key, passphrase or token, at any step.
- A second retire commit for a key that already has one prepared.
- An agent archiving itself or another agent without Dinis's word.

## A restart is not an archive

A restart (a fresh session takes over the same role) follows the same steps. The successor's new key is published as `<role>-aws-a-sovereignwebsite-2` (then `-3`, and so on), on top of the retire. The old and new entries appear in the same Factory commit or in consecutive ones, so the role is never without a live key for longer than one landing.
