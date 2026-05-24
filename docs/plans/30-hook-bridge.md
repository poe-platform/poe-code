---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: research-hook-formats
    title: Capture hook-format research for claude-code, codex, opencode
    prompt: |
      Write `docs/research/hook-formats.md` documenting how coding-agent
      hooks work. Single doc, no boilerplate. Cover at minimum:

      For each agent (claude-code, codex, opencode, goose if applicable):
      - canonical hook file path(s), both global and project scope
      - file format (JSON / TOML / TS plugin code)
      - top-level schema shape (paste a minimal example)
      - full event list with one-line semantics
      - per-event input fields (focus on PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, PermissionRequest)
      - per-event output/decision schema
      - matcher syntax and what it filters on
      - supported handler types (command/http/mcp_tool/prompt/agent for claude; command only for codex; plugin-functions for opencode)
      - placeholder/env variables (`${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `PLUGIN_ROOT`, etc.)
      - precedence and merge behavior across layers

      End with a delta table titled "claude-code → codex conversion deltas"
      listing every divergence the bridge must handle:
      - events present in claude-code but absent in codex (must be dropped)
      - handler types present in claude-code but unsupported in codex
        (codex only honors `type: "command"` — `http`, `mcp_tool`, `prompt`,
        `agent` must be dropped)
      - placeholder/env-var renames
      - matcher-syntax differences (both use regex, but document any quirks)
      - JSON vs TOML write-target choice (out of v1 scope but note it)

      Sources to cite at top of doc:
      - https://code.claude.com/docs/en/hooks
      - https://developers.openai.com/codex/hooks
      - https://developers.openai.com/codex/config-reference

      Keep prose dense per repo conventions. No restating, no hedging.
    status:
      implement: done
      commit: done

  - id: package-skeleton
    title: Scaffold @poe-code/agent-hook-config package
    prompt: |
      Create a new workspace package `packages/agent-hook-config/`. Mirror
      the layout of `packages/agent-skill-config/` (which already exists
      and is the closest sibling).

      Files to create:
      - `packages/agent-hook-config/package.json` — name
        `@poe-code/agent-hook-config`, version `0.0.1`, `private: true`,
        `type: "module"`, main `dist/index.js`, types `dist/index.d.ts`,
        same `exports`/`scripts`/`files` shape as `agent-skill-config`.
      - `packages/agent-hook-config/tsconfig.json` — copy from
        `agent-skill-config/tsconfig.json` verbatim, no changes.
      - `packages/agent-hook-config/src/index.ts` — empty barrel; later
        tasks add exports.
      - `packages/agent-hook-config/README.md` — one-paragraph stub; the
        documentation task fills this in.

      Add the package to the root workspace if there is a workspaces list
      that requires per-package entries (check root `package.json`).

      Add `@poe-code/agent-defs` as a workspace `dependencies` entry — the
      registry will need `resolveAgentId`.

      Do not add zod or any runtime-validation library. Per repo
      conventions: plain TS type guards only.

      Run `npm run build -w @poe-code/agent-hook-config` (or whatever the
      repo's per-package build invocation is — match what `agent-skill-config`
      uses) and confirm the empty package compiles.
    status:
      implement: done
      commit: done

  - id: agent-hook-config-registry
    title: Per-agent hook config registry
    prompt: |
      In `packages/agent-hook-config/src/configs.ts` declare a per-agent
      registry capturing where each agent's hook config lives and what
      capabilities it has. Mirror the pattern used by `agentSkillConfigs`
      in `packages/agent-skill-config/src/configs.ts` — including the
      `expandHome`, `resolveAgentSupport`, `getAgentConfig` helpers, with
      the same case-insensitive alias handling delegating to
      `resolveAgentId`.

      Shape:

        export type HookFormat = "claude-settings-json" | "codex-hooks-json" | "codex-config-toml";

        export type HookEvent =
          | "SessionStart"
          | "SessionEnd"
          | "UserPromptSubmit"
          | "PreToolUse"
          | "PostToolUse"
          | "PermissionRequest"
          | "Stop"
          | "StopFailure"
          | "Notification"
          | "PreCompact"
          | "PostCompact"
          | "SubagentStart"
          | "SubagentStop";

        export type HookHandlerType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

        export interface AgentHookConfig {
          /** File where this agent reads hooks. Supports `~` expansion. */
          globalHookPath: string;
          /** Project-relative path, may be undefined for agents without project scope. */
          localHookPath?: string;
          format: HookFormat;
          /** Events the agent honors. Anything outside this set is dropped at bridge time. */
          supportedEvents: readonly HookEvent[];
          /** Handler types the agent executes. Anything outside this set is dropped. */
          supportedHandlerTypes: readonly HookHandlerType[];
          /**
           * Placeholders the agent recognizes. Bridge consults the source-agent
           * placeholder list to identify tokens that need rewriting and the
           * target-agent list as the canonical destination form.
           */
          placeholders: {
            /** Maps abstract token → concrete substring the agent recognizes. */
            projectDir: string;
            pluginRoot?: string;
            pluginData?: string;
          };
        }

      Concrete entries (values derived strictly from the research doc):

        "claude-code": {
          globalHookPath: "~/.claude/settings.json",
          localHookPath: ".claude/settings.json",
          format: "claude-settings-json",
          supportedEvents: ["SessionStart","SessionEnd","UserPromptSubmit","PreToolUse","PostToolUse","PermissionRequest","Stop","StopFailure","Notification","PreCompact","PostCompact","SubagentStart","SubagentStop"],
          supportedHandlerTypes: ["command","http","mcp_tool","prompt","agent"],
          placeholders: {
            projectDir: "${CLAUDE_PROJECT_DIR}",
            pluginRoot: "${CLAUDE_PLUGIN_ROOT}",
            pluginData: "${CLAUDE_PLUGIN_DATA}"
          }
        },
        "codex": {
          globalHookPath: "~/.codex/hooks.json",
          localHookPath: ".codex/hooks.json",
          format: "codex-hooks-json",
          supportedEvents: ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PermissionRequest","Stop"],
          supportedHandlerTypes: ["command"],
          placeholders: {
            projectDir: "$(git rev-parse --show-toplevel)",
            pluginRoot: "$PLUGIN_ROOT",
            pluginData: "$PLUGIN_DATA"
          }
        }

      Export `supportedHookAgents = Object.keys(agentHookConfigs)`.

      Export `resolveAgentSupport(input, registry?)` and
      `getAgentConfig(agentId)` with the same semantics as their
      `agent-skill-config` counterparts.

      Export `resolveHookPath(config, scope, cwd, homeDir?)` matching the
      shape of `resolveSkillDir` but returning a FILE path (not a dir).
      Returns `undefined` when `scope === "local"` and the agent has no
      `localHookPath`.

      Add `configs.test.ts`. Cover: known agent resolves to config,
      alias resolution (`claude` → `claude-code`), unknown returns
      `{ status: "unknown" }`, supported but no local path returns
      `undefined` for local scope, `~` expansion works against an
      injected homeDir, project-scope path is cwd-rooted.

      Export everything from `packages/agent-hook-config/src/index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: source-reader-claude
    title: Read hooks from a claude-code settings.json
    prompt: |
      In `packages/agent-hook-config/src/read-hooks.ts` add:

        export interface SourceHookEntry {
          event: string;          // raw event name from the source file
          matcher?: string;       // raw matcher string, undefined when omitted
          handler: {
            type: string;         // raw handler type
            command?: string;
            args?: string[];
            url?: string;
            headers?: Record<string,string>;
            server?: string;
            tool?: string;
            input?: Record<string,unknown>;
            prompt?: string;
            model?: string;
            timeout?: number;
            statusMessage?: string;
            if?: string;
            once?: boolean;
            shell?: string;
          };
        }

        export interface HookReadResult {
          entries: SourceHookEntry[];
          /** Paths actually read, in order. Empty when no source files existed. */
          readPaths: string[];
        }

        export function readClaudeHooks(
          cwd: string,
          homeDir: string,
          opts?: { scope?: "project" | "user" | "merged" }
        ): HookReadResult

      Behavior:
      - Resolve project file at `<cwd>/.claude/settings.json` and user file
        at `<homeDir>/.claude/settings.json`. Use `JSON.parse` after reading
        with `node:fs`.
      - Scopes: `"project"` reads only the project file; `"user"` reads only
        user; `"merged"` (default) reads both with project entries appearing
        AFTER user entries in `entries` (so caller can treat later entries as
        project-scoped overrides — but the bridge just emits both).
      - When a file doesn't exist, skip it silently (do not throw).
      - When a file is present but has no `hooks` key, treat as empty.
      - The settings.json structure is `{ hooks: { Event: [{ matcher,
        hooks: [{type, ...}] }] } }`. Walk that exhaustively. Each leaf hook
        becomes one `SourceHookEntry`. Preserve the parent `matcher` value
        (string or undefined).
      - Do NOT validate event names, handler types, or matcher strings here.
        This is a raw reader; the transformer filters.
      - Malformed JSON throws a precise error naming the file path.

      Add `read-hooks.test.ts` using `memfs`. Cover:
      - both files absent → `{ entries: [], readPaths: [] }`
      - project-only file → entries match, `readPaths` lists only project
      - user-only file → same for user
      - both files present in `"merged"` → user entries first, project after
      - settings.json with no `hooks` key → empty result, path still listed
      - matcher omitted on a group → entry has `matcher: undefined`
      - multiple handlers under one matcher group → one entry per handler
      - nested handler fields (`args`, `headers`, `input`) flow through verbatim
      - malformed JSON throws naming the file path

      Export from `packages/agent-hook-config/src/index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: event-mapping
    title: Event/handler/placeholder mapping rules
    prompt: |
      In `packages/agent-hook-config/src/event-mapping.ts` declare the
      pure-data conversion table consumed by the transformer.

      Shape:

        export interface EventMapping {
          /** Source event name as written by the source agent. */
          sourceEvent: string;
          /** Target event name. `null` means "drop this hook entirely". */
          targetEvent: HookEvent | null;
          /** Human-readable reason used in drop warnings. */
          dropReason?: string;
        }

        export function getEventMappings(
          sourceAgentId: string,
          targetAgentId: string
        ): EventMapping[]

      For the v1 pair (`sourceAgentId: "claude-code"`, `targetAgentId: "codex"`):
      Build the mapping from the registry — every claude-code event maps to
      itself if codex supports it, otherwise `targetEvent: null` with a
      specific `dropReason`:
      - SessionStart → SessionStart
      - SessionEnd → null ("codex has no SessionEnd hook")
      - UserPromptSubmit → UserPromptSubmit
      - PreToolUse → PreToolUse
      - PostToolUse → PostToolUse
      - PermissionRequest → PermissionRequest
      - Stop → Stop
      - StopFailure → null ("codex has no StopFailure hook")
      - Notification → null ("codex has no Notification hook")
      - PreCompact / PostCompact → null
      - SubagentStart / SubagentStop → null

      Mapping is derived from the registry, not hard-coded per pair — when
      the same source event name appears in the target's `supportedEvents`,
      it maps; otherwise it drops with a generic reason naming the target
      agent.

      In the same file:

        export interface HandlerTypeRule {
          sourceType: string;
          allowed: boolean;
          dropReason?: string;
        }

        export function getHandlerTypeRules(targetAgentId: string): HandlerTypeRule[]

      For `targetAgentId: "codex"`, `command` is allowed; `http`,
      `mcp_tool`, `prompt`, `agent` are dropped with reasons like
      "codex only honors handlers of type \"command\"".

      Also export:

        export interface PlaceholderRewrite {
          from: string;   // source placeholder, exact substring
          to: string;     // target placeholder, exact substring
        }

        export function getPlaceholderRewrites(
          sourceAgentId: string,
          targetAgentId: string
        ): PlaceholderRewrite[]

      Produces an entry for each placeholder key present in both source
      and target configs (`projectDir`, `pluginRoot`, `pluginData`):
      `{ from: source.placeholders[key], to: target.placeholders[key] }`.

      No regex. No provider branching. All three functions are pure and
      take agent ids as input — the registry drives behavior.

      Add `event-mapping.test.ts`. Cover:
      - claude-code → codex produces the exact mapping listed above
      - source agent unknown → throws
      - target agent unknown → throws
      - identity case (claude-code → claude-code) → every event maps to
        itself, no drops
      - handler rules for codex target → only `command` allowed
      - placeholder rewrites for claude-code → codex → three entries
        (projectDir, pluginRoot, pluginData) with the substrings from
        the registry; identity case → empty array

      Export from `index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: hook-transformer
    title: Pure transform source entries to target entries
    prompt: |
      In `packages/agent-hook-config/src/transform-hooks.ts` add a pure
      function (no FS, no FS, no IO):

        export interface GeneratedHookEntry {
          event: HookEvent;          // target event name
          matcher?: string;          // passed through verbatim
          handler: {
            type: "command";         // codex v1 — only command survives
            command: string;         // placeholder-rewritten
            args?: string[];
            timeout?: number;
            statusMessage: string;   // ALWAYS present, prefixed (see below)
          };
          /** Stable id derived from the source so two transform runs yield
              the same id for the same source entry. */
          generatedId: string;
        }

        export interface HookDrop {
          reason: "unsupported-event" | "unsupported-handler-type";
          detail: string;            // human-readable, includes event/type
          source: SourceHookEntry;
        }

        export interface TransformResult {
          entries: GeneratedHookEntry[];
          drops: HookDrop[];
        }

        export function transformHooks(
          source: SourceHookEntry[],
          sourceAgentId: string,
          targetAgentId: string,
          opts: {
            /** Stable per-run identifier used in the statusMessage prefix
                and in `generatedId`. Caller (bridge) supplies this. */
            runId: string;
          }
        ): TransformResult

      Algorithm, applied in input order:

      1. Look up `eventMapping = getEventMappings(...)`. For each source
         entry, find the rule for `source.event`. If `targetEvent === null`,
         record a `HookDrop { reason: "unsupported-event", detail }` and
         skip.
      2. Look up `handlerRules = getHandlerTypeRules(targetAgentId)`. Find
         the rule for `source.handler.type`. If `!allowed`, record a
         `HookDrop { reason: "unsupported-handler-type", detail }` and skip.
      3. Apply placeholder rewrites: for every `PlaceholderRewrite { from,
         to }` returned by `getPlaceholderRewrites(...)`, replace every
         occurrence of `from` in `handler.command` AND in each entry of
         `handler.args` with `to`. Use literal `String.prototype.replaceAll`
         — no regex.
      4. Compute `generatedId = "generated-<runId>-<index>"` where `<index>`
         is the surviving-entry counter (zero-based across the whole batch).
      5. Compose `statusMessage`:
            "[generated:<runId>] " + (source.handler.statusMessage ?? "")
         The literal prefix `[generated:<runId>] ` is the marker the writer
         and cleanup use to identify bridged entries; do not drop it even
         when the source had no statusMessage. The prefix MUST start with
         the literal string `generated` so the entry is unambiguously
         attributable to this bridge.
      6. Pass through `args`, `timeout` unchanged when present. Drop all
         claude-only fields (`if`, `once`, `shell`, `url`, `headers`,
         `allowedEnvVars`, `server`, `tool`, `input`, `prompt`, `model`).
      7. `matcher` passes through unchanged. Do not normalize regex.

      Pure function. No FS access, no logging, no env reads. All inputs
      explicit. No provider branching beyond the registry lookups.

      Add `transform-hooks.test.ts`. Cover:
      - command-type hook on a supported event → one entry, statusMessage
        starts with `[generated:<runId>] `, matcher preserved
      - SessionEnd → drops with `reason: "unsupported-event"` and detail
        names the event
      - http handler → drops with `reason: "unsupported-handler-type"` and
        detail names the type
      - mcp_tool, prompt, agent handlers → also drop with handler-type reason
      - placeholder substitution: `${CLAUDE_PROJECT_DIR}/foo` →
        `$(git rev-parse --show-toplevel)/foo` in both `command` and `args`
      - `${CLAUDE_PLUGIN_ROOT}` → `$PLUGIN_ROOT`
      - source with no statusMessage → output statusMessage equals the prefix
        with empty tail
      - source with existing statusMessage → prefix prepended, original tail
        preserved exactly
      - claude-only handler fields (`if`, `once`, `shell`) do not leak into
        output
      - `generatedId` values are unique within the batch
      - drops preserve input order in `drops`; survivors preserve input order
        in `entries`
      - empty input → `{ entries: [], drops: [] }`

      Export from `index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: target-writer-codex
    title: Write generated entries to codex hooks.json with marked region
    prompt: |
      In `packages/agent-hook-config/src/write-hooks.ts` add:

        export interface WriteResult {
          path: string;
          fileCreated: boolean;
          previousGeneratedRemoved: number;
          generatedWritten: number;
        }

        export function writeCodexHooks(
          targetPath: string,
          entries: GeneratedHookEntry[],
          runId: string
        ): WriteResult

      Contract:
      - Target file is JSON at `targetPath`. Codex's `hooks.json` schema:
          { "hooks": { "<EventName>": [
              { "matcher": "...", "hooks": [{ type, command, ... }] }
          ] } }
      - When the file doesn't exist, create it with `{ "hooks": {} }`
        before merging. `fileCreated: true` in that case.
      - When the file exists, parse it. If malformed JSON, throw a precise
        error naming the path. Never overwrite a malformed user file.
      - Before adding new entries, REMOVE every existing entry whose
        innermost handler `statusMessage` starts with `[generated:` —
        regardless of runId. This is the cross-run cleanup pass: prior
        runs that crashed without cleanup are reclaimed here. Count
        removed entries into `previousGeneratedRemoved`.
      - After cleanup, group the supplied `entries` by `event` and `matcher`
        and merge into the file's `hooks` map:
          for each event group:
            find or create `hooks[event]` array
            for each matcher subgroup within the event:
              find the matcher-array element with the same matcher value
              (treat `undefined`/missing as a distinct key from `""`);
              if absent, push a new element `{ matcher, hooks: [] }`;
              append all generated handlers in order to `.hooks`.
      - Preserve every user-authored event/matcher group that wasn't
        affected. Never reorder pre-existing handler arrays.
      - After mutation, JSON-stringify with 2-space indent and trailing
        newline. Write atomically: write to `<path>.tmp` then `fs.renameSync`.
      - Create parent directories as needed (`recursive: true`). Record
        which parents were newly created in a separate manifest the bridge
        owns — but the writer does not need to expose that; the bridge
        captures pre/post state itself.

      The marker convention is established here:
        Every entry written by this writer has its handler `statusMessage`
        starting with the literal `[generated:<runId>]`. The transformer
        guarantees this prefix; the writer enforces it on every input by
        rejecting (throwing) any entry whose `statusMessage` does not start
        with `[generated:`. That makes cross-run cleanup safe regardless
        of any caller skipping the transformer.

      Add `write-hooks.test.ts` using `memfs`. Cover:
      - target absent → file created with `{ "hooks": { Event: [...] } }`,
        `fileCreated: true`, `previousGeneratedRemoved: 0`
      - target has only user-authored entries → user entries untouched,
        generated entries appended into the same event/matcher group when
        matcher matches, or new group created when it doesn't
      - target has stale generated entries from a prior run → all stale
        generated entries removed (count returned), new entries added
      - mixed file with user + stale-generated under same matcher → only
        the generated handlers are stripped from the matcher's `hooks`
        array; user handlers preserved in original order
      - matcher distinction: `matcher: undefined` and `matcher: ""` go into
        DIFFERENT groups (do not collapse)
      - writer rejects an entry whose statusMessage does not start with
        `[generated:` — throws naming the offending entry
      - malformed JSON in target → throws naming the path; file not modified
      - atomic write: simulate failure during `renameSync` (stub the rename)
        and confirm the original file is intact
      - empty `entries` and a target with stale generated entries → result
        cleans the stale ones; resulting file's `hooks` map has empty arrays
        for events whose only handlers were stale (do NOT delete the event
        key — preserve the empty array so user diffs are minimal). If the
        event had no other handlers AND wasn't present before, the key
        is removed.

      Export from `index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: symlink-path
    title: Symlink path for identical-schema agent pairs
    prompt: |
      In `packages/agent-hook-config/src/symlink-hooks.ts` add:

        export interface SymlinkResult {
          symlinkPath: string;     // where the symlink was placed
          targetPath: string;      // what it points to
          replaced: "none" | "stale-symlink" | "generated-file";
        }

        export function symlinkHooks(
          sourceAgentId: string,
          targetAgentId: string,
          cwd: string,
          homeDir: string,
          scope: "project" | "user"
        ): SymlinkResult

      Purpose: when source and target agents share the EXACT same hook
      file format (registry `format` field equal), the bridge can use a
      symlink instead of a transform — no drift, instant updates.

      Behavior:
      - Look up source and target configs. If `source.format !==
        target.format`, throw — caller must use the transform path instead.
      - Resolve `targetPath = source<scope>HookPath` (the file we point AT)
        and `symlinkPath = target<scope>HookPath` (where we place the link).
      - Throw if either resolves to undefined (e.g., agent has no local path
        and scope is project).
      - If `symlinkPath` already exists:
          - If it's a symlink → readlink it. If it points to `targetPath`,
            return with `replaced: "none"`. Otherwise unlink and replace,
            `replaced: "stale-symlink"`.
          - If it's a regular file → read first 1KB and check if its
            JSON parses to an object whose every leaf handler statusMessage
            starts with `[generated:`. If yes, the file is a fully-generated
            artifact safe to replace; unlink, `replaced: "generated-file"`.
            If no, throw: refuse to clobber a user-authored file.
      - Create parent directories as needed.
      - `fs.symlinkSync(targetPath, symlinkPath)`.

      Out of scope for v1: bidirectional symlinks, hardlinks, Windows
      compatibility quirks (note in README). Calling this with claude-code
      → codex throws because formats differ; the bridge will route those
      pairs through the transformer instead.

      Add `symlink-hooks.test.ts` using `memfs`. Cover:
      - formats differ → throws with a message naming both formats
      - happy path (claude-code project → claude-code user, since formats
        match) creates the symlink, `replaced: "none"` first time
      - re-running idempotent: existing symlink to the right target →
        `replaced: "none"`
      - existing symlink to a stale target → replaced, `replaced:
        "stale-symlink"`
      - existing regular file whose contents are 100% generated → replaced,
        `replaced: "generated-file"`
      - existing regular file with any user-authored entries → throws,
        file untouched
      - missing parent dir → created
      - source has no local path and scope is project → throws

      Note `memfs` symlink support: if the test runner's `memfs` version
      doesn't support symlinks reliably, abstract `fs.symlinkSync`/
      `fs.readlinkSync`/`fs.lstatSync` behind a small injectable FS
      interface so tests can stub it. Do not introduce a heavyweight
      filesystem abstraction across the package — local to this file.

      Export from `index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: bridge-orchestrator
    title: bridgeHooks orchestrator with manifest and cleanup
    prompt: |
      In `packages/agent-hook-config/src/bridge-hooks.ts` add the
      orchestrator that ties read → transform → write (or symlink)
      together. Mirror the API surface of `bridgeActiveSkills` in
      `packages/agent-skill-config/src/bridge-active-skills.ts` — same
      manifest/cleanup pattern, same warning-vs-error discipline.

      Shape:

        export type BridgeStrategy = "symlink" | "transform";

        export interface BridgeHookManifest {
          sourceAgentId: string;
          targetAgentId: string;
          cwd: string;
          runId: string;
          strategy: BridgeStrategy;
          // Populated when strategy === "transform"
          writtenPath?: string;
          generatedEntryIds?: string[];
          drops: HookDrop[];
          // Populated when strategy === "symlink"
          symlinkPath?: string;
          symlinkTarget?: string;
          symlinkReplaced?: "none" | "stale-symlink" | "generated-file";
        }

        export function bridgeHooks(
          sourceAgentId: string,
          targetAgentId: string,
          cwd: string,
          homeDir: string,
          runId: string,
          opts?: {
            /** Override strategy. When omitted, picks "symlink" iff source
                and target share `format`; otherwise "transform". */
            strategy?: BridgeStrategy;
            /** Default "merged" — reads both project and user source files. */
            scope?: "project" | "user" | "merged";
          }
        ): BridgeHookManifest

        export function cleanupBridgedHooks(manifest: BridgeHookManifest): void

      Algorithm for `bridgeHooks`:
      1. Resolve `sourceAgentId` and `targetAgentId` through
         `resolveAgentSupport`. If either is unknown/unsupported, throw
         with a specific error that names the input and lists
         `supportedHookAgents`.
      2. Pick strategy: explicit `opts.strategy` overrides; otherwise
         `source.format === target.format ? "symlink" : "transform"`.
      3. If `"symlink"`:
         - Call `symlinkHooks(sourceAgentId, targetAgentId, cwd, homeDir,
           "project")` (and "user" if scope demands it — for v1, project
           only). Populate symlink fields in manifest.
      4. If `"transform"`:
         - Call `readClaudeHooks(cwd, homeDir, { scope })` for v1 — when
           additional source agents are added later, dispatch via the
           registry. For now, throw if `sourceAgentId !== "claude-code"`.
         - Call `transformHooks(entries, sourceAgentId, targetAgentId,
           { runId })`.
         - Resolve target write path via `resolveHookPath(targetConfig,
           "project", cwd, homeDir)` — for v1 always write to the
           project-scoped target file (the user's `~/.codex/hooks.json`
           is never touched by automation). If target has no local path,
           throw.
         - Track which parent directories of the target file did not exist
           before the call so cleanup can prune them when empty.
         - Call `writeCodexHooks(...)` and populate `writtenPath`,
           `generatedEntryIds`, `drops` in manifest.
      5. Update `.git/info/exclude` via the existing
         `appendExcludeBlock` helper from
         `packages/agent-skill-config/src/git-exclude.ts`. The marker
         scheme there is `poe-code-spawn-skills:<runId>` — for hooks,
         use a parallel marker `poe-code-spawn-hooks:<runId>`. EITHER
         extend `git-exclude.ts` to accept a custom marker prefix, OR
         add a thin sibling in `agent-hook-config` that uses the same
         git-dir resolution. Pick the option that avoids duplication —
         per repo conventions, extend the shared helper if a small
         parameter does it; do not roll a second implementation.
         Entries to exclude: the symlink path OR the written file path,
         relative to cwd.

      Algorithm for `cleanupBridgedHooks`:
      - When strategy was `"symlink"`: if the symlink at `symlinkPath`
        still points to `symlinkTarget`, unlink it. If it points elsewhere,
        leave it (some other tool replaced it). If it's a regular file
        now, leave it.
      - When strategy was `"transform"`: re-open the written file, remove
        every entry whose `generatedId` matches one in
        `manifest.generatedEntryIds`. Use `generatedId` rather than the
        prefix match here so we only remove what THIS run generated, not
        a concurrent run's entries.
         - Actually the writer doesn't currently persist `generatedId` in
           the on-disk JSON. Decide one of:
             (a) Have the writer embed `generatedId` as an extra field
                 on the handler (e.g., `statusMessage: "[generated:<runId>:<index>] ..."`
                 so cleanup can match by runId+index).
             (b) Match by `statusMessage.startsWith("[generated:" + runId + "]")`
                 which is enough because the prefix already encodes the
                 runId. Use this — it doesn't require a separate field.
         - Remove matching entries; if a matcher group's `hooks` array
           becomes empty, remove that matcher element; if an event's
           array becomes empty AND wasn't present before this run, remove
           the event key.
         - Tracking "wasn't present before this run" requires the bridge
           to capture the pre-state. Capture it: before
           `writeCodexHooks`, record `preExistingEvents` and
           `preExistingMatchers` in the manifest. Cleanup consults them.
      - Remove any directories the bridge created when they are now empty
        (reuse the `createdParents` idea from `bridge-active-skills.ts`).
      - Call `removeExcludeBlock(cwd, runId)` (with hook-prefixed marker).
      - Idempotent: a second call on the same manifest is a no-op.

      Add `bridge-hooks.test.ts` using `memfs`. Cover:
      - claude-code → codex with one PreToolUse Bash command hook in source
        project file → strategy `"transform"`, codex hooks.json created,
        one generated entry with the `[generated:<runId>]` marker
      - claude-code → codex with a SessionEnd hook in source → strategy
        `"transform"`, drops array names SessionEnd, no entry written for it
      - claude-code → codex with an http handler → drops with handler-type
        reason, command-type peer survives
      - claude-code → codex with `${CLAUDE_PROJECT_DIR}` in command →
        rewritten to `$(git rev-parse --show-toplevel)` in the written file
      - identity case (claude-code → claude-code) → strategy `"symlink"`,
        symlink placed and manifest populated
      - source agent unknown → throws naming the input and supported set
      - target agent unknown → throws naming the input and supported set
      - target has no local path → throws
      - cleanup after transform removes only this run's entries; user
        entries in the same file preserved
      - cleanup after symlink removes the symlink only when it still
        points at the original target
      - cleanup is idempotent: second call does nothing, does not throw
      - exclude file lists the generated/symlink path; cleanup removes
        only this run's block

      Export from `index.ts`.
    status:
      implement: done
      test: done
      commit: done

  - id: git-exclude-helper-parametrize
    title: Parametrize git-exclude marker prefix for hook reuse
    prompt: |
      In `packages/agent-skill-config/src/git-exclude.ts`, generalize the
      marker prefix. Currently the block markers are hard-coded as
      `# poe-code-spawn-skills:<runId> begin` / `end`. Add an optional
      `markerPrefix` parameter (default `"poe-code-spawn-skills"`) to both
      `appendExcludeBlock` and `removeExcludeBlock`, threaded into the
      marker comment strings.

      Signature:

        export function appendExcludeBlock(
          cwd: string,
          runId: string,
          entries: string[],
          opts?: { markerPrefix?: string }
        ): void

        export function removeExcludeBlock(
          cwd: string,
          runId: string,
          opts?: { markerPrefix?: string }
        ): void

      The hook bridge in the previous task will call these with
      `{ markerPrefix: "poe-code-spawn-hooks" }`. Existing skill-bridge
      callers continue to work with the default.

      Update existing call sites in `packages/agent-skill-config/src/`
      that pass no opts — those are fine, the default preserves behavior.
      Do NOT change `bridge-active-skills.ts` semantics; the default
      keeps skill bridging identical.

      Update `git-exclude.test.ts`:
      - existing tests stay green with default prefix
      - add tests passing a custom prefix: append writes
        `# custom-prefix:<runId> begin`/`end`, remove finds and removes
        only the matching prefix, two different prefixes coexist in the
        same exclude file and neither's remove touches the other's block.

      Do not duplicate the file in `agent-hook-config`. Extending the
      shared helper is the right move per repo conventions
      ([[feedback_extend_not_duplicate]]).
    status:
      implement: done
      test: done
      commit: done

  - id: package-exports
    title: Wire @poe-code/agent-hook-config into the SDK barrel
    prompt: |
      Export the public surface of `@poe-code/agent-hook-config` from
      the SDK so consumers can import it the same way they import
      `@poe-code/agent-skill-config` things today.

      1. In `packages/agent-hook-config/src/index.ts`, re-export from each
         module: `configs.ts`, `read-hooks.ts`, `event-mapping.ts`,
         `transform-hooks.ts`, `write-hooks.ts`, `symlink-hooks.ts`,
         `bridge-hooks.ts`. Explicit re-exports (named), no `export *`.

      2. Add an `exports.compile-check.ts` next to `index.ts` that
         imports every public name and references it (mirror
         `packages/agent-skill-config/src/exports.compile-check.ts`).
         Confirms the package builds with no dead exports.

      3. Find the top-level SDK barrel (`src/sdk/types.ts` or
         `src/sdk/index.ts` — match what the skill-bridge task did at
         the same layer in plan 28) and re-export the hook-bridge types
         and functions: `bridgeHooks`, `cleanupBridgedHooks`,
         `BridgeHookManifest`, `BridgeStrategy`, `HookDrop`,
         `GeneratedHookEntry`, `supportedHookAgents`.

      4. Build the workspace and confirm types resolve.
    status:
      implement: done
      commit: open

  - id: spawn-runner-wire-hooks
    title: Wire bridgeHooks into the spawn runner
    prompt: |
      Wire `bridgeHooks` and `cleanupBridgedHooks` into the spawn runner
      analogous to how `bridgeActiveSkills` was wired in plan 28's
      `spawn-runner-bridge` task. The runner already accepts a
      `skills?: string[]` option; add a sibling `hooks` option.

      Locate the spawn runner — `packages/agent-spawn/src/` houses it
      (the function that launches the external coding-agent process given
      an agent id, cwd, and prompt).

      Extend the runner's public entry point:

        spawn(agentId, prompt, {
          ...,
          skills?: string[],
          hooks?: {
            from: string;         // source agent id (e.g., "claude" or "claude-code")
            strategy?: "auto" | "symlink" | "transform";  // default "auto"
            scope?: "project" | "user" | "merged";        // default "merged"
          }
        })

      Behavior:
      - `hooks` omitted → no bridge call, no manifest, no exclude-file edit.
        Runner identical to today.
      - `hooks` present:
        1. Generate `runId = crypto.randomUUID()` (reuse the same runId
           the skill bridge uses if both are active — emit one runId per
           spawn call and pass it to both bridges).
        2. Call `bridgeHooks(hooks.from, agentId, cwd, os.homedir(),
           runId, { strategy: hooks.strategy === "auto" ? undefined :
           hooks.strategy, scope: hooks.scope })` BEFORE launching the
           agent process. If it throws, surface the error and do not launch.
        3. If `manifest.drops` is non-empty, surface each drop through
           the design-system warning channel with a clear message naming
           the dropped event/handler-type. Do not abort — drops are
           informational, agent still runs.
        4. Launch the agent process.
        5. In a finally-equivalent block (success, failure, signal,
           cancellation), call `cleanupBridgedHooks(manifest)`.

      Do not branch by provider. Pass `agentId` straight through.

      Update the SDK type surface so consumers can pass `hooks`. SDK is
      canonical, CLI calls into it.

      Add tests covering: `hooks` omitted → bridge never called; `hooks`
      provided → bridge called with right args and agent launched only
      after bridge resolves; bridge throws (unknown source agent) → agent
      process never spawned; bridge returns drops → drops surfaced via
      the design-system warning channel AND agent still launches; agent
      exits cleanly → cleanup called once; agent throws/aborts → cleanup
      still called. Stub the agent-process launcher, the warning channel,
      and use `memfs` for the FS.
    status:
      implement: open
      test: open
      commit: open

  - id: spawn-cli-hooks-flag
    title: Add --hooks-from and --hooks-strategy CLI flags to poe-code spawn
    prompt: |
      Add CLI flags to `poe-code spawn` that map to the SDK `hooks` option
      wired in the previous task. Two flags:

      - `--hooks-from <agentId>` — sets `hooks.from`. Required when any
        other `--hooks-*` flag is passed. Bare agent id (e.g., `claude`,
        `claude-code`), case-insensitive — passes through to
        `resolveAgentSupport` at bridge time. Validation happens at the
        bridge boundary, not the CLI.
      - `--hooks-strategy <auto|symlink|transform>` — sets `hooks.strategy`.
        Default `auto`. Reject other values at parse time.

      Behavior:
      - Neither flag provided → `hooks` is `undefined` and the runner skips
        the bridge entirely.
      - `--hooks-from` provided, strategy omitted → `{ from, strategy:
        "auto" }`.
      - `--hooks-strategy` provided without `--hooks-from` → CLI error,
        usage shown.

      Use the existing argument framework already in place for `poe-code
      spawn` (see how `--skills` was wired in plan 28). Do not introduce
      a new parser.

      Tests: `--hooks-from claude` → `{ from: "claude", strategy: "auto" }`;
      `--hooks-from claude --hooks-strategy transform` → strategy passes
      through; `--hooks-strategy auto` alone → error; invalid strategy
      value → error; no flags → `hooks: undefined`.

      Take `npm run screenshot-poe-code -- spawn --help` and confirm both
      flags render coherently with the existing CLI design language. No
      screenshot test, per repo policy.
    status:
      implement: open
      test: open
      commit: open

  - id: pipeline-step-hooks
    title: hooks field on pipeline StepDefinition flows to spawn
    prompt: |
      Extend the pipeline `StepDefinition` type with an optional `hooks`
      field of the same shape exposed at the SDK and CLI:

        hooks?: {
          from: string;
          strategy?: "auto" | "symlink" | "transform";
          scope?: "project" | "user" | "merged";
        }

      Files to touch:
      - `packages/pipeline/src/types.ts` — add `hooks?` to `StepDefinition`.
      - The pipeline executor module in `packages/pipeline/src/` that calls
        into the spawn runner — forward `step.hooks` as the runner's
        `hooks` argument when defined.
      - Wherever YAML step definitions are parsed/validated, accept the new
        field. Plain TS type guards, no zod.

      Backwards compatible: a step without `hooks` keeps current behavior
      end to end.

      Tests:
      - YAML step with `hooks: { from: claude }` parses to the right shape
      - YAML step with full `{ from, strategy, scope }` parses
      - YAML step without `hooks` parses unchanged
      - executor passes `step.hooks` to the spawn runner (stub the runner)
      - executor omits the option when step has none
      - invalid strategy string at parse time → precise error

      `memfs` for any disk-based YAML test.
    status:
      implement: open
      test: open
      commit: open

  - id: ralph-step-hooks
    title: hooks field on ralph plan/step flows to spawn
    prompt: |
      Mirror the pipeline change in ralph: extend ralph plan/step schema
      with the same `hooks?: { from, strategy?, scope? }` shape and
      forward to the spawn runner.

      Files:
      - The ralph step/plan type in `packages/ralph/src/` (search for the
        schema/type used by `discovery.ts` and the runner).
      - The ralph runner module that launches spawns — pass `step.hooks`
        to the spawn runner's `hooks` option.
      - The plan parser/validator — accept the new field. Plain TS guards,
        no zod.

      Backwards compatible: a plan without `hooks` is unchanged in
      behavior.

      Tests: ralph plan with `hooks: { from: claude }` parses; plan without
      `hooks` behaves as before; runner forwards `hooks` to spawn; runner
      omits the option when step has none.

      `memfs` for disk-based plan-parsing tests.
    status:
      implement: open
      test: open
      commit: open

  - id: e2e-spawn-test-hook-bridge
    title: End-to-end test that poe-code test command bridges hooks
    prompt: |
      Wire an e2e check that exercises the hook bridge through `poe-code
      test` (the existing test command that drives spawn). Goal: confirm
      the bridge produces a valid `.codex/hooks.json` from a fixture
      `.claude/settings.json`, the spawned codex sees it, and cleanup
      runs.

      The repo's existing test command targets spawn end-to-end (per
      CLAUDE.md "The whole point of the test command is to test spawn and
      not work around it"). Add one new fixture under the appropriate
      e2e fixtures dir (locate where existing spawn fixtures live) with:
      - `.claude/settings.json` containing one PreToolUse Bash hook that
        echoes a marker string and exits 0
      - one PreToolUse http hook that should be DROPPED
      - one SessionEnd hook that should be DROPPED

      Run the bridge programmatically (or via `poe-code spawn
      --hooks-from claude` against a no-op prompt that triggers a Bash
      tool call). Assertions:
      - `.codex/hooks.json` exists with exactly one PreToolUse entry whose
        statusMessage starts with `[generated:`
      - the http and SessionEnd hooks are NOT present in `.codex/hooks.json`
      - the bridge surfaced drop warnings naming both
      - after spawn returns, `.codex/hooks.json` no longer contains any
        `[generated:` entries (cleanup ran)
      - the `.git/info/exclude` block is gone

      If the e2e harness can't easily run a real codex process, stub the
      agent process launcher at the SDK boundary and assert the file state
      around the launch call — keep the test fast. Tests must NOT take
      longer than necessary per repo conventions.

      Do NOT write a github-workflow test or a screenshot test.
    status:
      implement: open
      test: open
      commit: open

  - id: package-readme
    title: Document @poe-code/agent-hook-config
    prompt: |
      Write `packages/agent-hook-config/README.md`. Do not modify the
      project root README (per CLAUDE.md). Content, in order, no fluff:

      1. One-paragraph "what this does": per-run, per-spawn bridge that
         materializes a source agent's hooks into a target agent's hook
         file. Two strategies — symlink when formats match, transform
         when they don't. Every transformed entry is marked with a
         `[generated:<runId>]` statusMessage prefix so cleanup can find
         only what the bridge wrote.

      2. The supported pair table:

         | Source | Target | Strategy | Notes |
         |--------|--------|----------|-------|
         | claude-code | codex | transform | event subset, command-only handlers, placeholder rewrite |
         | claude-code | claude-code | symlink | identity (share between project and user) |

      3. The transform contract (claude-code → codex):
         - Events dropped (with reasons): SessionEnd, StopFailure,
           Notification, PreCompact/PostCompact, SubagentStart/Stop.
         - Handler types dropped: http, mcp_tool, prompt, agent.
         - Placeholder rewrites: `${CLAUDE_PROJECT_DIR}` →
           `$(git rev-parse --show-toplevel)`,
           `${CLAUDE_PLUGIN_ROOT}` → `$PLUGIN_ROOT`,
           `${CLAUDE_PLUGIN_DATA}` → `$PLUGIN_DATA`.
         - Output statusMessage prefix: `[generated:<runId>] ` exactly.

      4. The symlink contract:
         - Used only when source and target share the registry `format`.
         - Replaces a stale symlink or a 100%-generated regular file.
         - Refuses to clobber a user-authored file at the symlink path.

      5. The marker convention: callers and external tools can identify
         bridge-generated entries by checking for `statusMessage`
         starting with the literal `[generated:`. Cleanup keys off the
         full `[generated:<runId>] ` form so concurrent runs don't
         interfere.

      6. Cleanup contract:
         - Idempotent.
         - Only removes entries this run created.
         - Empty event/matcher groups created by this run are removed;
           pre-existing empties are preserved.
         - `.git/info/exclude` block is removed by runId only.

      7. Producer wiring: the three call sites that feed the runner's
         `hooks` option — `poe-code spawn --hooks-from`, pipeline
         `StepDefinition.hooks`, ralph step `hooks`.

      8. Env vars and config options exposed by this package: list them,
         or say "none" explicitly (per CLAUDE.md package-readme rules).

      9. Non-goals (terse list):
         - No bidirectional sync.
         - No conversion of opencode/goose plugin code.
         - No translation of MCP-tool / HTTP / prompt / agent handlers
           into command equivalents — they are dropped.
         - No editing of the user's `~/.codex/hooks.json` — bridge writes
           project-scope only.

      Dense prose. No restating. No hedging
      ([[feedback_dense_prompts]]).
    status:
      implement: open
      commit: open
---

# Hook Bridge

A reference-based way to make a target coding agent see a source agent's
lifecycle hooks for a spawned run. Pattern parallels the [skills bridge
in 28](28-skills-bridge.md), but for hooks: per-run materialization with
cleanup, marker-based identification, and no permanent installation.

## Why not just symlink

Symlinks work only when source and target use the same on-disk hook
schema. They do not work for `claude-code` → `codex` because:

- Codex's `hooks.json` is a strict subset: only `command` handlers, fewer
  events (no `SessionEnd`/`Notification`/`PreCompact`/`Subagent*`/etc.).
- Placeholder tokens differ: `${CLAUDE_PROJECT_DIR}` vs
  `$(git rev-parse --show-toplevel)`; `${CLAUDE_PLUGIN_*}` vs
  `$PLUGIN_*`.
- Codex silently ignores unsupported handler types, which is worse than
  dropping at bridge time — the user gets no signal that their `http`
  hook is dead.

So the bridge picks strategy from the registry:

- `source.format === target.format` → symlink (no transform, no drift).
- otherwise → transform programmatically, write to target file with each
  entry's `statusMessage` prefixed `[generated:<runId>] `.

## Marker convention

Every bridge-generated entry has its handler `statusMessage` prefixed
with the literal string `[generated:<runId>] ` (with a space). This is
the single source of truth used by:

- **Writer**: rejects any entry whose statusMessage doesn't start with
  `[generated:`, so accidental misuse is impossible.
- **Cross-run cleanup**: before writing this run's entries, every
  existing entry whose statusMessage starts with `[generated:` is
  removed — reclaims state from prior runs that crashed before
  `cleanupBridgedHooks`.
- **Per-run cleanup**: `cleanupBridgedHooks(manifest)` removes only the
  entries whose statusMessage starts with `[generated:<runId>] `, so
  concurrent runs (a future possibility — current working assumption is
  sequential-only per [[project_sequential_only]]) don't clobber each
  other.

User-authored entries are never matched by `[generated:`. Native hooks
are never overwritten.

## Hook format research (summary)

Captured in full at `docs/research/hook-formats.md`. Cliff notes:

| Aspect             | claude-code                                                                                                                                                                   | codex                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| File               | `~/.claude/settings.json`, `.claude/settings.json`                                                                                                                            | `~/.codex/hooks.json`, `<repo>/.codex/hooks.json`, OR inline `[[hooks.*]]` in `config.toml` |
| Format             | JSON                                                                                                                                                                          | JSON or TOML                                                                                |
| Schema shape       | `hooks: { Event: [{ matcher, hooks: [{type, command, ...}] }] }`                                                                                                              | Same logical shape                                                                          |
| Events             | SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop, StopFailure, Notification, PreCompact, PostCompact, SubagentStart, SubagentStop | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop            |
| Handler types      | command, http, mcp_tool, prompt, agent                                                                                                                                        | command only                                                                                |
| Placeholders       | `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`                                                                                                     | `$(git rev-parse --show-toplevel)`, `$PLUGIN_ROOT`, `$PLUGIN_DATA`                          |
| Multi-source merge | last-write wins per layer                                                                                                                                                     | union across layers; no replacement                                                         |

opencode hooks are plugin-functions in TS, not file-based — out of scope
for v1.

## Producer wiring

Three producers feed the runner's `hooks` option (mirrors the
`skills` producer set from plan 28):

- `poe-code spawn --hooks-from claude [--hooks-strategy ...]` (CLI;
  parity with SDK).
- Pipeline `StepDefinition.hooks: { from, strategy?, scope? }`.
- Ralph step `hooks: { from, strategy?, scope? }`.

Each is optional; absent → bridge is not called, behavior unchanged.

## Non-goals

- No conversion of opencode/goose plugin code.
- No translation of unsupported handler types (`http`, `mcp_tool`,
  `prompt`, `agent`) into `command` equivalents. They are dropped with
  a warning.
- No editing of the user's `~/.codex/hooks.json`. Bridge writes to
  project-scope `<cwd>/.codex/hooks.json` only.
- No bidirectional bridging.
- No inline TOML `[[hooks.*]]` writer in v1 — JSON only; document as
  future work.
- No Windows-specific path or symlink handling beyond what Node provides.
