# UX: spawn/configure/install agent lists disagree (capability matrix)

## Summary

spawn accepts pi, pi-agent, poe-agent; configure/install omit pi/poe-agent; configure pi → Unknown agent. No matrix of spawnable vs configurable vs installable.

## Evidence

```text
spawn agents: … | pi | pi-agent | poe-agent
configure agents: … | opencode  (no pi, no poe-agent)
install agents: same as configure
$ poe-code configure pi
■  Unknown agent "pi".
```
spawn goose/test goose work with haiku.

## Why it matters

Users hit Unknown agent when configuring spawnable agents; platform fix: capability matrix.

## Suggested direction

Publish matrix in help: spawnable / configurable / installable columns; message: pi is spawn-only.

## Severity

**High**

## Area

Help / capability matrix
