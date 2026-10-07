#!/bin/bash
# Start-of-session check: where this checkout stands, and what is waiting for you.
#   Claude Code runs it as a SessionStart hook; its output lands in the session's context.
#   Cowork runs it by hand with --cowork: no fetch (Cowork holds no git credentials),
#   so it reports how long ago the Mac last fetched instead.
# Read-only throughout. Never fails the session.
mode="${1:-}"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0
gitdir="$(git rev-parse --git-dir 2>/dev/null)" || { echo "Not a git repository."; exit 0; }

if [ "$mode" = "--cowork" ]; then
  t="$(stat -c %Y "$gitdir/FETCH_HEAD" 2>/dev/null || stat -f %m "$gitdir/FETCH_HEAD" 2>/dev/null)"
  if [ -n "$t" ]; then
    m=$(( ($(date +%s) - t) / 60 ))
    f="last fetched by the Mac ${m} min ago"
    [ "$m" -gt 30 ] && f="$f - repo-sync may not be running, so GitHub may be ahead of this view"
  else f="never fetched"; fi
elif git fetch --quiet origin 2>/dev/null; then f="fetched just now"
else f="could not fetch origin, so ahead/behind may be stale"; fi

b="$(git branch --show-current)"
u="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null)"
echo "Repo status ($f)"
echo "- branch: ${b:-detached HEAD}${u:+, tracking $u}"
[ -n "$u" ] && echo "- ahead $(git rev-list --count "$u..HEAD"), behind $(git rev-list --count "HEAD..$u")"
d="$(git status --porcelain | head -20)"
if [ -n "$d" ]; then echo "- uncommitted changes (someone else's work until shown otherwise):"; echo "$d" | sed 's/^/    /'
else echo "- working tree clean"; fi
l="$(find "$gitdir" -maxdepth 3 \( -name '*.lock' -o -name 'tmp_obj_*' \) 2>/dev/null)"
[ -n "$l" ] && echo "- WARNING: git lock files present: $l"
[ -n "$(git config --local user.name)" ] && echo "- WARNING: this clone sets a local git identity, which mislabels every agent's commits: git config --local --unset user.name (and user.email)"

# Open handoffs: docs/handoffs/*.md whose front matter says status: open or answered.
if [ -d docs/handoffs ]; then
  for h in docs/handoffs/*.md; do
    [ -f "$h" ] || continue
    s="$(sed -n '1,8s/^status: *//p' "$h" | head -1)"
    [ "$s" = "open" ] || [ "$s" = "answered" ] || continue
    if [ "$s" = "open" ]; then who="$(sed -n '1,8s/^to: *//p' "$h" | head -1)"
    else who="$(sed -n '1,8s/^from: *//p' "$h" | head -1)"; fi
    echo "- handoff ($s, for ${who:-?} to act on): $h"
  done
fi
exit 0
