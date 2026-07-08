# UX: plan archive/delete help still omit --yes and non-TTY contract (reconfirmed)

## Summary

plan archive and delete --help still only path, --kind, --output, -h — no --yes, no warning that --yes without path archives/deletes arbitrary plan, no non-TTY path requirement.

## Evidence

plan archive/delete --help — path optional; no --yes documented.

## Why it matters

Reconfirm Critical destructive footgun is undocumented in help.

## Suggested direction

Require path non-TTY; document --yes; forbid --yes without path.

## Severity

**High**

## Area

Plan / destructive
