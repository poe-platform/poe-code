---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: resolver-skill-reference
    title: Skill reference resolver in agent-skill-config
    prompt: |
      In `packages/agent-skill-config/src/`, add a new file `resolve-skill-reference.ts`
      that exports:

        interface SkillSource {
          kind: "resolved";
          ref: string;            // the original reference, e.g. "foo" or "claude/foo"
          name: string;           // basename used at the bridge target, e.g. "foo"
          sourceAgentId?: string; // canonical id (e.g. "claude-code") iff ref was prefixed
          sourcePath: string;     // resolved absolute path on disk
          scope: "project" | "user";
        }

        type SkillResolutionFailure =
          | { kind: "malformed";       ref: string }
          | { kind: "unknown-agent";   ref: string; agentInput: string }
          | { kind: "not-found";       ref: string; searchedPaths: string[] };

        type SkillResolution = SkillSource | SkillResolutionFailure;

        function resolveSkillReference(
          ref: string,
          cwd: string,
          homeDir: string
        ): SkillResolution

      A reference is one of two forms:

      1. **Bare** — `"foo"`. Source is a poe-code-native skill folder. Tiers (first hit
         wins):
           project: `<cwd>/.poe-code/skills/foo`
           user:    `<homeDir>/.poe-code/skills/foo`

      2. **Agent-prefixed** — `"<agentInput>/<name>"`, e.g. `"claude/foo"`. The agent
         token may be a canonical id (`claude-code`), an alias (`claude`), or any
         supported casing — pass it through `resolveAgentSupport` from `configs.ts`,
         which delegates to `resolveAgentId` in `@poe-code/agent-defs` and already
         handles aliases and case-insensitivity. Tiers (project beats user, first hit
         wins):
           project: `<cwd>/<localSkillDir-for-canonicalId>/<name>`
                    derived from `resolveSkillDir(config, "local", cwd)`
           user:    `<expanded globalSkillDir-for-canonicalId>/<name>`
                    derived from `resolveSkillDir(config, "global", cwd)`

      Return values:

      - Successful lookup → `{ kind: "resolved", ... }` with `sourceAgentId` set to the
        canonical id returned by `resolveAgentSupport` (NOT the raw input token).
      - Empty string, empty agent token, empty name, two-or-more slashes → `{ kind:
        "malformed", ref }`.
      - Prefixed ref whose agent token doesn't resolve (e.g. `"nonsense/foo"`) →
        `{ kind: "unknown-agent", ref, agentInput }`. Never fall back to a bare lookup
        when the agent token is present — silent fallback would hide typos.
      - Ref parses and (for prefixed refs) the agent is known, but no tier has the
        skill folder → `{ kind: "not-found", ref, searchedPaths }`. `searchedPaths`
        lists every path actually checked in lookup order so the caller can show the
        user exactly where it looked.

      Other rules:
      - Reference splits on the FIRST `/` only. The name segment must not contain `/`
        either — `"a/b/c"` is malformed.
      - The skill `name` segment is case-sensitive. The agent token's case-handling is
        delegated to `resolveAgentSupport` (which is case-insensitive).
      - Take `cwd` and `homeDir` as explicit parameters — no `os.homedir()` reads inside
        this module. Use `node:fs` to test directory existence.

      Reuse `resolveAgentSupport`, `getAgentConfig`, and `resolveSkillDir` from
      `configs.ts`. No provider branching. Plain TS guards, no zod.

      Add `resolve-skill-reference.test.ts` next to the source using `memfs`. Cover:
      - bare ref project-tier hit → resolved
      - bare ref user-tier hit → resolved
      - bare ref project beats user → resolved with `scope: "project"`
      - bare ref no match → `{ kind: "not-found", searchedPaths: [...] }`
      - prefixed canonical id (`claude-code/foo`) resolves to claude-code's skill dir
      - prefixed alias (`claude/foo`) resolves to the SAME canonical id (`claude-code`)
        and the SAME paths as the canonical form
      - prefixed mixed case (`Claude/foo`, `CLAUDE/foo`) resolves identically (alias
        case-insensitivity)
      - prefixed ref project-tier hit (`.claude/skills/foo`)
      - prefixed ref user-tier hit (`~/.claude/skills/foo`)
      - prefixed ref project beats user
      - prefixed unknown agent token (`nonsense/foo`) → `{ kind: "unknown-agent",
        agentInput: "nonsense" }`. No fallback to bare lookup.
      - malformed refs (`""`, `"foo/"`, `"/foo"`, `"a/b/c"`, `" /foo"`) → `{ kind:
        "malformed" }`
      - returned `name` equals basename (post-prefix) for both forms
      - returned `sourceAgentId` is the canonical id, NOT the raw alias the user typed
      - `searchedPaths` for not-found bare refs lists both tiers in lookup order
      - `searchedPaths` for not-found prefixed refs lists both tiers in lookup order

      Export `resolveSkillReference`, `SkillSource`, `SkillResolutionFailure`,
      `SkillResolution` from `packages/agent-skill-config/src/index.ts`.
    status:
      implement: done
      test: done
      commit: open

  - id: git-exclude-block
    title: Marked-block helpers for .git/info/exclude
    prompt: |
      Add `packages/agent-skill-config/src/git-exclude.ts` exporting:

        function appendExcludeBlock(cwd: string, runId: string, entries: string[]): void
        function removeExcludeBlock(cwd: string, runId: string): void

      Block format in `.git/info/exclude`:

        # poe-code-spawn-skills:<runId> begin
        <entries one per line>
        # poe-code-spawn-skills:<runId> end

      Resolve the exclude file by invoking `git rev-parse --git-dir` in `cwd` so worktrees
      and submodules work. If `cwd` is not inside a git repo, both functions are silent
      no-ops.

      `removeExcludeBlock` removes only the lines between this run's markers — never
      touches other runs' blocks or pre-existing user content. Idempotent: a second call
      on an already-removed block is a no-op.

      `appendExcludeBlock` is safe when the file does not exist (creates it) and when
      other runs' blocks are already present (coexists).

      Abstract the `git rev-parse` call behind a small injectable runner so tests can
      stub it without spawning real git. Default implementation uses `child_process`.

      Add `git-exclude.test.ts` using `memfs`. Cover: append in fresh exclude file
      preserves pre-existing content; append when another run's block is present (both
      coexist); remove leaves other runs' blocks intact; remove is idempotent; non-git
      cwd → both are silent no-ops.

      Export both functions from `packages/agent-skill-config/src/index.ts`.
    status:
      implement: open
      test: open
      commit: open

  - id: bridge-active-skills
    title: Copy-based bridge with warn-on-collision and cleanup manifest
    prompt: |
      Add `packages/agent-skill-config/src/bridge-active-skills.ts` exporting:

        interface BridgeEntry {
          ref: string;
          sourcePath: string;
          targetPath: string;
          createdParents: string[];
        }

        type BridgeWarningKind =
          | "local-collision"
          | "global-collision"
          | "self-reference"
          | "intra-batch-collision";

        interface BridgeWarning {
          kind: BridgeWarningKind;
          ref: string;
          sourcePath: string;
          conflictingPath: string;
          message: string;
        }

        interface BridgeManifest {
          spawnAgentId: string;
          cwd: string;
          runId: string;
          entries: BridgeEntry[];
          warnings: BridgeWarning[];
        }

        function bridgeActiveSkills(
          spawnAgentId: string,
          cwd: string,
          refs: string[],
          homeDir: string,
          runId: string
        ): BridgeManifest

        function cleanupBridgedSkills(manifest: BridgeManifest): void

      `bridgeActiveSkills` runs through refs in input order. Pre-flight rules:

      1. **Resolution failures abort.** For every `ref`, call
         `resolveSkillReference(ref, cwd, homeDir)`. If any ref returns a non-resolved
         result, throw a single error that groups failures by kind and reports each
         precisely:
           - `malformed`: list each malformed ref verbatim and explain the expected
             syntax (`"<name>"` or `"<agentId>/<name>"`).
           - `unknown-agent`: list each ref and its `agentInput`; include the set of
             supported agent ids (from `supportedAgents` in `configs.ts`) so the user
             can pick the right one.
           - `not-found`: list each ref and the `searchedPaths` returned by the
             resolver, in lookup order.
         Nothing is bridged when any ref fails. Resolution failures are
         missing-resource / config errors, not collisions.

      2. **Compute targets.** For each resolved source, target =
         `resolveSkillDir(getAgentConfig(spawnAgentId), "local", cwd) + "/" + source.name`.
         The target uses the SPAWNING agent's local skill dir; the source's own
         agentId prefix is irrelevant to the target path.

      3. **Collisions warn and skip; they never abort.** For each resolved ref, in
         input order, detect collisions and, on hit, record a `BridgeWarning`, skip
         this ref, and continue with the rest of the batch:

         - `intra-batch-collision`: an earlier ref in this batch already produced the
           same target path (basename clash, e.g. `claude/foo` and `codex/foo` when
           spawning opencode). First-in-batch wins; subsequent refs warn and skip.
         - `local-collision`: a folder already exists at the local target path
           (e.g. `<cwd>/.claude/skills/<name>`). The pre-existing folder stays
           untouched; this ref warns and skips. Native local skills are never
           overwritten.
         - `global-collision`: a folder already exists at the global target path
           (e.g. `~/.claude/skills/<name>`). The agent will see the global skill
           natively; bridging would shadow it. Warn and skip.
         - `self-reference`: the ref is prefixed with the spawning agent's own id
           (e.g. spawning claude with `claude/foo`) AND the source resolved to the
           agent's own native dir. The agent already sees it; warn and skip. Detect
           this before the local/global collision check so the warning is precise.

         Multiple warnings on the same ref are possible in principle (e.g. self-ref
         plus global-collision); emit only the most specific one and skip — never
         duplicate.

      4. **Mutate only after the per-ref decision is made.** For refs that survive the
         collision pass: record which parent directories did not exist before this
         call (e.g. `<cwd>/.claude/skills/` if absent), create them, then recursively
         copy `sourcePath` → `targetPath`. The first-in-batch winner of an intra-batch
         clash is bridged before any later ref is examined for collisions, so the
         later ref sees the winner's target as an existing path — that's expected and
         shows up as `intra-batch-collision`, not `local-collision`. Implement the
         detection by tracking targets claimed earlier in the batch so the
         distinction is precise regardless of FS state.

      5. **Exclude file.** Call `appendExcludeBlock(cwd, runId,
         [...targetPathsRelativeToCwd])` with only the entries that were actually
         bridged (not the skipped ones). Helper handles non-repo cwd gracefully.

      6. Return the manifest. `entries` lists what was bridged; `warnings` lists what
         was skipped and why. The caller (spawn runner) is responsible for surfacing
         warnings to the user.

      `cleanupBridgedSkills` is idempotent and conservative:
      - Remove each `entry.targetPath` recursively.
      - For each path in `entry.createdParents`, remove the directory only if it is
         now empty (a user-dropped sibling means the directory stays).
      - Call `removeExcludeBlock(manifest.cwd, manifest.runId)`.
      - Skipped refs (those that produced warnings) leave no state behind, so cleanup
         simply has nothing to do for them.
      - A second invocation on the same manifest is a no-op.

      No provider branching. Reuse `getAgentConfig`, `resolveSkillDir`,
      `resolveSkillReference`, `appendExcludeBlock`, `removeExcludeBlock`.

      Add `bridge-active-skills.test.ts` using `memfs`. Cover:
      - happy path: bare ref and agent-prefixed ref bridged together when spawning a
         third agent (e.g. spawn opencode, refs `["foo", "claude/bar"]` → copies into
         `.opencode/skills/foo` and `.opencode/skills/bar`; `warnings` is empty)
      - alias prefix works identically to canonical: ref `claude/bar` and
         `claude-code/bar` produce the same bridged target when the source exists
      - resolution failure: unknown-agent ref (e.g. `nonsense/foo`) aborts before any
         FS mutation; error message names the agent token and lists supported agents
      - resolution failure: malformed ref (e.g. `"a/b/c"`) aborts with a precise
         malformed-ref error
      - resolution failure: not-found ref aborts and the error lists the
         `searchedPaths` from the resolver
      - multi-failure batch: malformed + unknown-agent + not-found in one call →
         single error that groups all three categories
      - resolution failure leaves nothing on disk and nothing in the exclude file
      - local target collision warns and skips; the rest of the batch still bridges;
         the pre-existing folder is left untouched
      - global target collision warns and skips
      - intra-batch basename collision (`claude/foo` + `codex/foo` for opencode spawn):
         first ref bridges, second warns with `intra-batch-collision` and skips
      - self-reference (spawn claude with `claude/foo` where `~/.claude/skills/foo`
         exists) warns with `self-reference` and skips
      - mixed batch: some refs succeed, some warn — `entries` and `warnings` together
         account for every input ref exactly once
      - exclude file lists only successfully bridged entries
      - `createdParents` records only newly-created directories
      - nested subdirs and binary file contents copy correctly
      - cleanup removes targets and only empty parents
      - cleanup leaves a parent untouched if the user added a sibling file inside it
      - cleanup is idempotent

      Export `bridgeActiveSkills`, `cleanupBridgedSkills`, `BridgeManifest`,
      `BridgeEntry`, `BridgeWarning`, `BridgeWarningKind` from
      `packages/agent-skill-config/src/index.ts`.
    status:
      implement: open
      test: open
      commit: open

  - id: spawn-runner-bridge
    title: Wire bridge into the spawn runner (SDK level)
    prompt: |
      Wire `bridgeActiveSkills` + `cleanupBridgedSkills` into the spawn runner so that
      `poe-code spawn` and the programmatic SDK can pass an active skill reference set
      per run.

      Locate the spawn runner — most likely in `packages/agent-spawn/src/` (search for
      the function that launches the external coding-agent process given an agent id,
      cwd, and prompt; if the package is named differently, find it via the existing
      CLI `spawn` command wiring).

      Extend the runner's public entry point with an optional `skills?: string[]`
      argument. The strings are skill references in the same syntax accepted by
      `resolveSkillReference` (bare `"foo"` or prefixed `"claude/foo"`). Behavior:

      - `skills` omitted or empty → runner behaves exactly as before. No bridge call, no
        manifest, no exclude-file edits.
      - `skills` non-empty:
        1. Generate `runId = crypto.randomUUID()`.
        2. Call `bridgeActiveSkills(agentId, cwd, skills, os.homedir(), runId)` BEFORE
           launching the agent process. If it throws (unresolved refs), surface the
           error to the caller and do not launch.
        3. If `manifest.warnings` is non-empty, surface each warning through the
           existing design-system warning channel before launching. Use the
           `BridgeWarning.message` field as the user-facing text. Do not abort —
           warnings are informational and the agent still runs.
        4. Launch the agent process as today.
        5. In a finally-equivalent block (always runs on success, failure, signal, or
           cancellation), call `cleanupBridgedSkills(manifest)`.

      Do not branch by provider. Pass `agentId` straight through as the bridge's
      `spawnAgentId`.

      Update the SDK type surface so consumers can pass `skills` (per CLAUDE.md: CLI and
      SDK in parity — SDK is canonical, CLI calls into it).

      Add tests covering: skills omitted → bridge never called; skills provided → bridge
      called with correct args and agent launched only after bridge resolves; bridge
      throws (unresolved ref) → agent process never spawned; bridge returns warnings →
      warnings surfaced via the design-system warning channel AND agent still launches;
      agent exits cleanly → cleanup called once; agent throws/aborts → cleanup still
      called. Stub the agent-process launcher, the warning channel, and use `memfs` for
      the FS; no real child processes.
    status:
      implement: open
      test: open
      commit: open

  - id: spawn-cli-skills-flag
    title: Add --skills CLI flag to poe-code spawn
    prompt: |
      Add a `--skills` flag to the `poe-code spawn` CLI command that maps to the SDK
      `skills` option wired in the previous task.

      Accepts a comma-separated list of skill references: `--skills foo,claude/bar`.
      Repeated flags concatenate: `--skills foo --skills claude/bar` → `["foo",
      "claude/bar"]`. An empty value (`--skills ''` or `--skills`) is treated as no
      skills.

      Trim whitespace per entry and drop empty entries. Do not validate reference
      syntax in the CLI — the resolver will report invalid refs at bridge time with a
      precise error.

      The CLI must use the existing argument framework already in place for `poe-code
      spawn`. Do not introduce a new parser.

      Add tests covering: `--skills foo,claude/bar` → `["foo","claude/bar"]`; repeated
      flag concatenation; empty value → `undefined`; whitespace-only value →
      `undefined`; no `--skills` → `undefined`.

      Take a `npm run screenshot-poe-code -- spawn --help` screenshot to confirm the
      flag appears in the help text and the rendering is coherent with the existing CLI
      design language. Do not write a screenshot test.
    status:
      implement: open
      test: open
      commit: open

  - id: pipeline-step-skills
    title: skills field on pipeline StepDefinition flows to spawn
    prompt: |
      Extend the pipeline `StepDefinition` type with an optional `skills?: string[]`
      field — an array of skill references in the same syntax used by the CLI and SDK
      (bare `"foo"` or prefixed `"claude/foo"`).

      Files to touch:
      - `packages/pipeline/src/types.ts` — add `skills?: string[]` to `StepDefinition`.
      - The pipeline executor module in `packages/pipeline/src/` that calls into the
        spawn runner — when executing a step, forward `step.skills` as the runner's
        `skills` argument.
      - Wherever YAML step definitions are parsed/validated, accept the new field. Use
        plain TS type guards, no zod.

      Backwards compatible: a step without `skills` keeps current behavior end to end.

      Add tests covering: YAML step with `skills: [foo, claude/bar]` parses to the right
      shape; YAML step without `skills` parses unchanged; executor passes `step.skills`
      through to the spawn runner (stub the runner); executor omits the option when
      step has no skills field.

      Use `memfs` if any test reads YAML from disk.
    status:
      implement: open
      test: open
      commit: open

  - id: ralph-step-skills
    title: skills field on ralph plan/step flows to spawn
    prompt: |
      Mirror the pipeline change in ralph: extend the ralph plan/step schema with an
      optional `skills?: string[]` field of skill references and forward it to the
      spawn runner.

      Files:
      - The ralph step/plan type in `packages/ralph/src/` (search for the schema/type
        used by `discovery.ts` and the runner).
      - The ralph runner module that launches spawns — pass `step.skills` to the spawn
        runner's `skills` option.
      - The plan parser/validator — accept the new field. Plain TS guards, no zod.

      Backwards compatible: a ralph plan without `skills` is unchanged in behavior.

      Add tests covering: a ralph plan with `skills: [foo, claude/bar]` parses
      correctly; a plan without `skills` behaves as before; the runner forwards
      `skills` to spawn; the runner omits the option when the step has none.

      Use `memfs` for any disk-based plan-parsing tests.
    status:
      implement: open
      test: open
      commit: open

  - id: document-skills-references
    title: Document the skill reference syntax and bridge contract
    prompt: |
      Update `packages/agent-skill-config/README.md` to document the new public
      surface. Do not modify the project root README.

      Content:

      1. The skill reference syntax used by CLI/SDK/pipeline/ralph configs:

           "<name>"              # bare — a poe-code-native skill
           "<agentId>/<name>"    # agent-prefixed — an agent-native skill

         Examples:
           "my-helper"               → ~/.poe-code/skills/my-helper (or .poe-code/...)
           "claude/my-helper"        → ~/.claude/skills/my-helper   (alias for claude-code)
           "claude-code/my-helper"   → ~/.claude/skills/my-helper   (canonical id)
           "codex/my-helper"         → ~/.codex/skills/my-helper

         The agent token accepts canonical ids, aliases, and any casing — it is
         normalized via `resolveAgentId` from `@poe-code/agent-defs`. Note: the agent
         token has nothing to do with the source agent's native dir name. The source
         path always comes from `agentSkillConfigs[canonicalId]`, so the alias maps
         cleanly to whichever directory that agent owns.

      2. Resolution order per reference (project beats user; first hit wins):

         Bare `<name>`:
           1. <cwd>/.poe-code/skills/<name>
           2. ~/.poe-code/skills/<name>

         Prefixed `<agentId>/<name>`:
           1. <cwd>/<agentId-local-skill-dir>/<name>     e.g. .claude/skills/<name>
           2. ~/<agentId-global-skill-dir>/<name>        e.g. ~/.claude/skills/<name>

         The per-agent skill directories come from `agentSkillConfigs` in `configs.ts` —
         no hard-coded paths in the resolver.

      3. Bridge target and contract:
         - At spawn time, the bridge copies every resolved skill source folder into the
           SPAWNING agent's native local skill dir under cwd (e.g.
           `.claude/skills/<name>`), keyed by the source basename. The source's own
           agentId prefix never appears in the target path.
         - Resolution failures abort the entire bridge — no skills are copied. Failures
           come in three flavors and the error message distinguishes them: `malformed`
           (bad syntax), `unknown-agent` (the agent token doesn't match any supported
           agent; the error lists the supported set), and `not-found` (the skill folder
           wasn't at any tier; the error lists the paths searched in order).
         - Collisions never abort. The bridge emits a `BridgeWarning` for each collision
           and skips that ref; the rest of the batch proceeds normally. The four
           collision kinds: `local-collision` (folder already at local target),
           `global-collision` (folder already at the agent's global skill dir),
           `self-reference` (spawning agent referenced its own native skill), and
           `intra-batch-collision` (two refs in the batch produce the same target
           basename — first in input order wins). Native skills are never overwritten;
           skipped refs leave no state behind.
         - Callers (spawn runner) surface `manifest.warnings` through the design-system
           warning channel before launching the agent.
         - `cleanupBridgedSkills` removes only what bridge created (targets and empty
           parents) and is idempotent.
         - `.git/info/exclude` is updated with a per-run marked block listing only the
           successfully bridged entries; cleanup removes only that block.

      4. Env vars and config options: list any exposed by the package (per CLAUDE.md
         README rules). If none, say so explicitly.

      Keep the prose dense — no restating, no hedging.
    status:
      implement: open
      commit: open
---

# Skills Bridge

A reference-based way to declare which skills a spawned agent should see for a run,
plus a per-run copy-and-cleanup bridge that materializes them into the spawning agent's
native skill directory.

## Reference syntax

In any config (CLI `--skills`, pipeline step `skills:`, ralph step `skills:`, SDK
`skills` option):

```
"<name>"             # poe-code-native skill in .poe-code/skills or ~/.poe-code/skills
"<agentId>/<name>"   # agent-native skill in that agent's own skill dir
```

Examples:

| Reference         | Source resolved from                                  |
| ----------------- | ----------------------------------------------------- |
| `my-helper`       | `.poe-code/skills/my-helper` → `~/.poe-code/skills/my-helper` |
| `claude/foo`      | `.claude/skills/foo` → `~/.claude/skills/foo`         |
| `codex/foo`       | `.codex/skills/foo` → `~/.codex/skills/foo`           |
| `opencode/foo`    | `.opencode/skills/foo` → `~/.opencode/skills/foo`     |

Project location always beats user location.

## Bridge contract

For each ref, the bridge:

1. Resolves the source via the project-then-user lookup above.
2. Copies the resolved folder into the **spawning** agent's native local skill dir
   under cwd, named by the source basename (the source's `agentId/` prefix is dropped
   from the target name).
3. Adds the relative target paths to `.git/info/exclude` under a per-run marker block.

Pre-flight rules, applied in input order per ref:

- Every ref must resolve. Resolution failures **abort** the whole bridge with a single
  error grouped by kind:
    - `malformed` — bad ref syntax.
    - `unknown-agent` — the agent token in a prefixed ref isn't a known agent id or
      alias. The error lists the supported set.
    - `not-found` — ref parsed and (for prefixed refs) the agent is known, but no tier
      contained the skill folder. The error lists the paths searched in order.
  These are missing-resource / config errors, not collisions.
- Collisions **warn and skip**, never abort:
  - `local-collision` — folder already at the local target path.
  - `global-collision` — folder already at the agent's global skill dir.
  - `self-reference` — spawning agent referenced its own native skill.
  - `intra-batch-collision` — two refs produce the same target basename; first in
    input order wins, the rest warn.
- Skipped refs leave no state behind. The pre-existing folder at a collision target is
  never modified. Native skills are never overwritten.

The bridge returns a manifest with `entries` (what was bridged) and `warnings` (what
was skipped and why). The spawn runner surfaces every warning via the design-system
warning channel and launches the agent anyway.

After the run, cleanup removes only what was created and only directories that are now
empty. Idempotent. The `.git/info/exclude` block is removed by run-id, leaving other
runs' blocks intact.

## Producer wiring

Three producers feed the runner's `skills` option:

- `poe-code spawn --skills foo,claude/bar` (CLI; parity with SDK).
- Pipeline `StepDefinition.skills: string[]`.
- Ralph plan/step `skills: string[]`.

Each is optional; absent → bridge is not called, behavior unchanged.

## Non-goals

- No symlinks — copy only.
- No permanent installation of bridged skills.
- No auto-bridging — only the declared active set.
- No deletion or modification of pre-existing user content under any agent skill dir.
- No changes to `poe-agent` in-process skill plumbing.
- No migration of bundled poe-code `SKILL_*` templates or the `sync-skills` script.
