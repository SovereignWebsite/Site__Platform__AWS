# Opinion: git signing key born as OpenSSH ed25519, published in ssh_signing

security.aws.a, 23 November 2026, 22:00 UTC. Asked by a.maestro for aws.c, factory and Dinis. This is a review of a proposal only. Nothing has been built or changed.

## The proposal

A fresh session's guard refuses to decrypt its sgit key into a file for git (conductor and ontology now). The proposal:

- The git signing key is made in the session with `ssh-keygen -t ed25519`, mode 600, and is never decrypted from anything.
- Its public half goes into the Factory entry's `ssh_signing` field.
- `.github/ci/signers.mjs` reads `ssh_signing` when it is present, before `bundle.sign` (line 36).

## Verdict

**Acceptable, at the same trust as today, if the six conditions below are met.** The trust root does not change. The public key is still published in a Factory entry that is committed, signed and landed through factory.c at Dinis's word, and `live()` still governs retire. The private key is no weaker either: today the sgit signing key also ends up as an unencrypted 0600 file in the container. An ed25519 key is a sound choice, and simpler to parse than the PKCS8 to OpenSSH conversion done now.

What changes is that the git signing key is no longer the sgit identity's own key. Two things follow: the link between them must be stated, and the new field must be parsed strictly, because it is written into an allowed_signers file.

## Conditions

1. **Strict parsing (must).** `ssh_signing` is today an object (`{ from: "bundle.sign", note }`) in all 43 entries that have it. A key there must be accepted only as one line matching `^ssh-ed25519 [A-Za-z0-9+/]{68}$`, with any comment dropped, and anything else verifies nothing. signers.mjs writes `<agent> namespaces="git" <key>` into allowed_signers. A value with a newline, options (`cert-authority`, `principals=`) or a second key could otherwise add trust for another principal. Read the value as a string only when its type is string; the existing object form keeps meaning "use bundle.sign".
2. **One signing key per entry (must).** When `ssh_signing` holds a key, use that key, not that key and `bundle.sign` together. Two keys per entry doubles what a retire must cover, and makes "which key signed this" ambiguous.
3. **Same check in every verifier, in one change (must).** The Factory's `build/check-signatures.mjs` derives from `bundle.sign` too (the entries' own note says so), and each site carries a copy of signers.mjs. If one verifier reads `ssh_signing` and another does not, the same commit passes one gate and fails the other. Change them together, with a test for each.
4. **Proof of possession (must).** The commit that adds the entry should itself be signed by the new ssh key and carry the session's `Claude-Session:` trailer, and factory.c checks this before landing (`git verify-commit` against that one key). This replaces the binding that `signing_fingerprint` gives today through the bundle.
5. **Fingerprints (should).** `signing_fingerprint` should be the ssh key's own `SHA256:` fingerprint (`ssh-keygen -lf`), so reviewers and watchers can match a signature to an entry without conversion. Refuse a key whose fingerprint is already in any entry, live or retired.
6. **Dinis's word (must).** `.github/**` needs his yes. The change also goes around a guard's refusal, so he should see that stated plainly. The guard refuses decrypting a secret; this makes a new key that never existed elsewhere. I see no secret exposed by that, but the decision is his.

## Not affected

- Retire and archive (docs/team/archive-agent.md): unchanged, `status` still decides.
- Old commits: entries keep their `bundle.sign`, so everything already verified still verifies.
- R-028: unchanged. The -2 entries for the restarted roles can use this form once the six conditions are met.

## Residual

The sgit identity (vault, messages) and the git identity become two keys in one entry. Losing or wiping one does not wipe the other, so the archive protocol's step 8 should list both.
