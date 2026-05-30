---
name: "Skill synchronization follows a symlinked global skill directory and writes outside the user home"
---

# Skill synchronization follows a symlinked global skill directory and writes outside the user home

## Summary

The standalone `scripts/sync-skills.ts` command writes installed template skills into each agent's global skill directory without rejecting symbolic links. A symlinked global Codex skill root redirects synchronized `SKILL.md` files to an external location.

## Reproduction

1. From the repository root, run this disposable home-directory probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-sync-skills-probe.XXXXXX)
   mkdir -p "$probe/home/.codex" "$probe/outside"
   ln -s "$probe/outside" "$probe/home/.codex/skills"

   HOME="$probe/home" SYNC_SKILLS_SCOPE=global \
     "$PWD/node_modules/.bin/tsx" scripts/sync-skills.ts

   realpath "$probe/home/.codex/skills"
   find "$probe/outside" -name SKILL.md -print | sort
   ```

## Observed Behavior

The apparent Codex global skill root `~/.codex/skills` resolves to the external directory, and skill synchronization creates multiple external `SKILL.md` files there, including `poe-code-plan/SKILL.md` and `poe-code-agent-script/SKILL.md`.

`scripts/sync-skills.ts:52` through `scripts/sync-skills.ts:64` derive global install targets, and `scripts/sync-skills.ts:70` through `scripts/sync-skills.ts:88` create or overwrite installed skills without canonical-containment or symlink checks. `packages/agent-skill-config/src/configs.ts:95` through `packages/agent-skill-config/src/configs.ts:105` provide the global skill root resolution used by the synchronization script.

## Expected Behavior

Global skill synchronization should write only beneath canonical agent skill roots within the selected user home. A symlinked global skill directory that escapes that location should be rejected.

## Impact

Running the documented synchronization command in an environment with a replaced global skill directory can create or overwrite agent instruction files outside the intended home configuration tree with the user's privileges.
