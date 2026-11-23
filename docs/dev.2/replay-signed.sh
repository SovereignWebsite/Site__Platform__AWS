#!/usr/bin/env bash
# Replay a line of commits with the same trees, re-signing one author's commits with that author's current key.
# For the four commits signed by dev.2.aws.a's retired key in the twin line (conductor.aws.a, 23 Nov 2026): each author
# runs this in turn; nothing is force-pushed, the result goes to a new branch, and every tree is unchanged.
#
#   CLAUDE_SESSION=<your session URL> docs/dev.2/replay-signed.sh <base> <tip> <map-file> <author-name>
#
# Walks <base>..<tip> oldest first (topological order). For each commit not yet in <map-file> ("old new" lines):
#   - parents are mapped through <map-file>;
#   - if its author name and email are this repository's git identity (user.name = <author-name>, user.email), it is re-created with the same tree, message and author (name, email, date),
#     committed and signed by the current git identity, and "old new" is appended to the map. Its Claude-Session
#     trailer becomes $CLAUDE_SESSION (the CI signer check pairs each key with the session it was published with) and
#     a "Replayed-from: <old sha>" trailer is added, so the change of signer is on the record;
#   - if it is someone else's and none of its parents changed, it is kept as it is ("old old");
#   - if it is someone else's and a parent changed, the script stops there: that author runs it next with the same map.
# The base must be a commit on the landing target (dev), so other roles' commits merged in earlier are unchanged; the
# first runner's base is locked in the map's first line and a later run with another base is refused.
# At the end it prints the new tip; push it to a new branch (for example land/<role>) for review, never over the old.
# Signing uses the repository's git config (gpg.format ssh, user.signingkey), so set those to your own key first.
set -euo pipefail
base=$1 tip=$2 map=$3 me=$4
: "${CLAUDE_SESSION:?set CLAUDE_SESSION to the session URL published with your key}"
# A runner re-signs only their own commits (security.aws.a): <author-name> must be this repository's git identity,
# and each commit's author email must be that identity's email as well as its name matching.
me_email=$(git config user.email || true)
[ "$me" = "$(git config user.name || true)" ] || { echo "<author-name> $me is not git config user.name" >&2; exit 2; }
[ -n "$me_email" ] || { echo "git config user.email is not set" >&2; exit 2; }
touch "$map"
# The map must hold one line per old commit (security.aws.a): duplicates are refused.
dups=$({ grep -v '^#' "$map" || true; } | awk '{print $1}' | sort | uniq -d | head -1)
[ -z "$dups" ] || { echo "map has $dups twice" >&2; exit 2; }
# Both runners use the same base (dev.1.aws.a): it is locked in the map's first line, "# base <full sha>".
want=$(git rev-parse "$base^{commit}")
if [ ! -s "$map" ]; then echo "# base $want" > "$map"
else got=$(awk 'NR==1 && $1=="#" && $2=="base" {print $3}' "$map"); [ "$got" = "$want" ] || { echo "base $want is not the map's base ${got:-(none)}" >&2; exit 2; }
fi
lookup() { awk -v c="$1" '$1==c {print $2; f=1} END {if (!f) print c}' "$map"; }
for c in $(git rev-list --reverse --topo-order "$base..$tip"); do
  if grep -q "^$c " "$map"; then continue; fi
  parents=$(git log -1 --format=%P "$c"); new_parents=""; changed=0
  for p in $parents; do
    np=$(lookup "$p"); new_parents="$new_parents $np"
    if [ "$np" != "$p" ]; then
      changed=1
      # A mapped parent must carry the same tree as the commit it replaces (security.aws.a).
      [ "$(git rev-parse "$np^{tree}")" = "$(git rev-parse "$p^{tree}")" ] || { echo "mapped parent $np of $c has another tree than $p" >&2; exit 1; }
    fi
  done
  author=$(git log -1 --format=%an "$c"); author_email=$(git log -1 --format=%ae "$c")
  if [ "$author" = "$me" ] && [ "$author_email" = "$me_email" ]; then
    args=(); for p in $new_parents; do args+=(-p "$p"); done
    new=$(git log -1 --format=%B "$c" | awk -v s="$CLAUDE_SESSION" -v o="$c" '
        /^Claude-Session:/ { if (!done) { print "Claude-Session: " s; print "Replayed-from: " o; done = 1 }; next } { print }
        END { if (!done) { print ""; print "Claude-Session: " s; print "Replayed-from: " o } }' | GIT_AUTHOR_NAME="$(git log -1 --format=%an "$c")" GIT_AUTHOR_EMAIL="$(git log -1 --format=%ae "$c")" \
      GIT_AUTHOR_DATE="$(git log -1 --format=%aI "$c")" git commit-tree -S "$(git log -1 --format=%T "$c")" "${args[@]}")
    [ "$(git log -1 --format=%T "$new")" = "$(git log -1 --format=%T "$c")" ] || { echo "tree changed for $c" >&2; exit 1; }
    echo "$c $new" >> "$map"; echo "re-signed $c -> $new"
  elif [ "$changed" = 0 ]; then
    echo "$c $c" >> "$map"
  else
    echo "hand-off: $c is $author's and a parent changed; $author runs this next with $map" >&2
    exit 3
  fi
done
new_tip=$(lookup "$(git rev-parse "$tip")")
echo "tip $new_tip"
echo "before anyone pushes it: node .github/ci/signers.mjs $want $new_tip (with the published keys) on the whole line" >&2
