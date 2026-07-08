# UX: root --help hides skill, memory, runtime, eval, provider, and more

## Summary

Root help only lists ~18 commands ending at usage. Working commands skill, memory, worktree, eval, maestro, superintendent, code-review, runtime, launch, approvals, tasks, provider, utils are fully functional but absent from root help. Usage still npm run dev.

## Evidence

```bash
$ poe-code --help
Usage: npm run dev -- <command> [...args]
Commands: install, update, configure, unconfigure, login, logout, auth, agent,
spawn, gaslight, test, models, pipeline, plan, traces, harness, experiment,
ralph, usage
# NOT listed but work:
$ poe-code skill --help    # ok
$ poe-code memory --help   # ok
$ poe-code runtime --help  # ok
$ poe-code eval --help     # ok
$ poe-code provider --help # ok
$ poe-code worktree --help # ok
$ poe-code launch --help   # ok
$ poe-code tasks --help    # ok
$ poe-code approvals --help # ok
$ poe-code maestro --help  # ok
$ poe-code superintendent --help # ok
$ poe-code code-review --help # ok
$ poe-code utils --help    # ok
```

## Why it matters

Primary discoverability failure: half the product is invisible on root help.

## Suggested direction

Register all public commands on root help; group Advanced; displayBinaryName poe-code.

## Severity

**Critical**

## Area

Help / discoverability
