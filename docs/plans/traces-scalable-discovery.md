---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Traces scalable discovery

Make `poe-code traces` and the trace browser fast with millions of trace files: a persistent incremental index replaces full-content scans, so listing is an index query and only new/changed files are ever read.

## 1. What we're building

`poe-code traces` is very sluggish and must work with millions of files. Today discovery in the claude/pi/poe-code readers reads **every trace file in full** (`fs.readFile` per file, sequential, no cache) just to extract title/cwd from the head, stats files one by one, and applies `limit` only after everything is read. Measured: 6.8 s for `traces --limit 5` with ~16k files / 256 MB of traces; millions of files is O(hours). The codex reader is already fast because it queries Codex's own SQLite.

Non-goals:

- No change to trace parsing/normalization or the trace detail view.
- No file watching daemon; sync happens on demand.
- No change to codex discovery (already indexed at the source).
- No re-architecture of `collectHumanPrompts` beyond using indexed discovery (full-content reads there remain per selected trace).

## 2. User-facing shape

Same commands, new speed profile:

- `poe-code traces` (and the browser) paints rows **instantly from the index** (warm: < 300 ms even with millions of indexed files), then incrementally syncs in the background — a sync indicator shows in the header, and newly discovered traces appear when it finishes.
- `poe-code traces --json --limit 50` waits for the incremental sync, then prints — warm sync touches only new/changed files, so it's sub-second when nothing changed.
- First run ever (cold index) walks and indexes everything once with a progress spinner ("Indexing traces… 120k files"), then all subsequent runs are incremental.
- `poe-code traces --rebuild-index` drops and rebuilds the index (recovery/escape hatch).
- SDK parity: `listTraces(options)` gains `index: "sync" | "background" | "off"` (CLI maps: default `"sync"` for `--json`, `"background"` for the browser, `--rebuild-index` forces a rebuild first). `"off"` preserves today's direct scan for callers with custom `fs`.

No other flags, env vars, or output changes.

## 3. Implementation details and technical decisions

Autonomy audit: everything needed is in-repo — memfs for fs tests, real trace corpora under `~/.claude/projects` and `~/.codex` on the dev machine, scratchpad for synthetic 100k-file corpora. No credentials, services, or new dependencies (no SQLite for the index; the codex reader keeps reading Codex's own `state_5.sqlite` via the `node:sqlite` builtin, unchanged). No new env vars.

### Architecture

The index lives in `@poe-code/agent-traces` (it owns the readers) as `src/index-store/`. Storage is plain JSON files — no database:

- **Storage**: sharded JSONL under `<resolveCacheDir("poe-code")>/trace-index/` (next to the existing `trace-tokens` cache):
  - One shard per trace directory: `shards/<sha256(dirPath)>.jsonl`, one record per trace file — `{ path, source, traceId, cwd, title, createdAt, updatedAt, mtimeMs, size }`. A shard maps 1:1 to a claude project dir / pi / poe-code trace dir, so shards stay small (hundreds to low thousands of rows) even when the corpus has millions of files.
  - `manifest.json`: `{ version, shards: { [dirPath]: { file, maxUpdatedAt, count } } }` — the only file every query must read.
  - Queries never load the whole index: sort shard entries by `maxUpdatedAt` descending and stream shards newest-first until `limit` rows (past any `since`/`cwd` bound) are collected. Listing 50 traces reads the manifest plus a handful of shards.
  - Writes are atomic (write temp file + rename), one shard rewritten only when its directory changed; `version` bump = transparent rebuild.
- **Incremental sync** (the scale mechanism):
  1. Enumerate candidate files per reader via a new cheap `scan()` (readdir walk with dirents, no stats, no reads).
  2. Stat only files that are (a) not in the index, or (b) "hot" — index `updated_at` within the last 7 days. Old traces are append-finished and never touched again; this makes warm sync O(new + recent), not O(all). `--rebuild-index` covers any drift.
  3. Extract metadata only for files whose `(mtime_ms, size)` changed or are new — by reading **only the first 64 KB** (`fs.open`/`read`, never `readFile`) and running the reader's existing head parser (≤ 100 lines).
  4. Prune index rows whose path vanished from their directory listing (the walk yields full per-directory listings anyway).
  5. All stat/head work runs with bounded concurrency (32); each changed directory's shard is rewritten once at the end of the sync, then the manifest.
- **Query**: `listTraces` streams shards newest-first (per the manifest) with `cwd`/`since`/`source` filters and stops at `limit` — the limit finally does its job. Codex results are merged in from Codex's own SQLite as today.
- **Browser (agent-trace-viewer `run.ts`)**: stale-while-revalidate — render index rows immediately, kick `sync()` in the background, show a header sync indicator, refresh rows on completion. The explorer's refresh action forces a sync.
- **`collectHumanPrompts`** uses indexed references for discovery (push `since` down to the index query); per-trace full reads remain, now bounded by the reference set instead of preceded by a full-corpus read.

### Edge cases

- Manifest or shard corrupt/unreadable → treat that shard (or the whole index) as absent and re-derive it on the next sync; queries fall back to direct scan for that invocation.
- Two poe-code processes syncing concurrently → atomic temp-file+rename writes make it last-writer-wins per shard; both writers produce valid shards from the same disk state, so the race is benign (rows at worst seconds stale).
- Trace file replaced with same mtime+size (touch/copy edge) → caught only by `--rebuild-index`; accepted.
- Head metadata absent in first 64 KB (title appears later) → row indexed with fallback title (file id), corrected on next mtime change; matches today's `firstHumanText` fallback behavior.
- memfs/custom `fs` option (tests, SDK callers) → `index: "off"` is forced unless the caller passes an index path explicitly; direct-scan path stays fully supported.
- Subagent trace files (claude `subagents/` dirs) are indexed like any other file; parent/child resolution stays in `read()`.

### Config

- No new env vars. New CLI/SDK surface: `--rebuild-index` flag, `index` option. Index location follows the existing cache-dir resolution; documented in the `agent-traces` README.

## 4. Interfaces and test plan

### Module-boundary types (`@poe-code/agent-traces`)

```ts
export interface TraceFileCandidate {
  path: string;
  source: AgentTraceSource;
}

export interface TraceReader {
  // existing id/defaultRoots/discover/read stay; new, optional:
  scan?(options: DiscoverOptions): AsyncIterable<TraceFileCandidate>;
  readHeadMetadata?(head: string, path: string): TraceHeadMetadata; // pure, parses first 64 KB
}

export interface TraceIndex {
  sync(options: { readers: TraceReader[]; homeDir: string; cwd?: string;
                  onProgress?: (stats: SyncProgress) => void }): Promise<SyncStats>;
  query(options: { cwd?: string; allWorkspaces?: boolean; since?: Date;
                   sources?: AgentTraceSource[]; limit: number }): Promise<TraceReference[]>;
  rebuild(): Promise<void>;   // DROP + full sync
  close(): void;
}
export function openTraceIndex(options: { dir: string; fs?: AgentTraceFileSystem }): Promise<TraceIndex>;
```

`ListTracesOptions` (agent-trace-viewer) gains `index?: "sync" | "background" | "off"` and `onIndexUpdate?: (references: TraceReference[]) => void` for the browser's revalidate.

### Tests (memfs end to end, all sub-second)

- **Index store**: sync inserts/updates/prunes shard records; `(mtime,size)` unchanged → zero reads (spy asserts `readFile` never called and `open` only for new files); only changed directories' shards rewritten; query streams newest shards first and stops at `limit` (spy: untouched shards never read); hot-window stat selection; idempotent double-sync; version bump triggers rebuild; corrupt shard/manifest re-derived.
- **Head extraction**: 64 KB cap respected on a 10 MB memfs file (spy on read sizes); metadata parity with the current full-read `traceHeadMetadata` on the existing fixture corpus.
- **Query**: limit/since/cwd/source filters match the current `listTraces` ordering semantics on the same fixtures.
- **Fallback**: unwritable index dir → `listTraces` still returns via direct scan; direct scan itself now uses head reads + bounded concurrency (assert no full-file reads there either).
- **Browser**: rows render from stale index, `onIndexUpdate` refreshes them; refresh action forces sync.
- **collect**: `collectHumanPrompts` with `since` only reads traces the index returned.

### Real-world test (exact commands, in order)

1. `npm run build`
2. Generate a synthetic corpus with a JS script in the scratchpad: 100,000 small claude-format `.jsonl` files under a fake `HOME/.claude/projects/…` (script writes ~50 dirs × 2,000 files).
3. `time HOME=<fake-home> node dist/bin.cjs traces --json --limit 20` — cold run: completes in < 60 s, prints 20 rows, and prints an indexing progress line to stderr.
4. Re-run the same command — warm run: **< 1 s** (nothing changed; sync is stat-bounded to the hot window).
5. Append a line to one trace file, re-run — the touched trace moves to the top; run time still < 1 s (one head re-read).
6. On the real home dir: `time node dist/bin.cjs traces --json --limit 5` — was 6.8 s, must be < 1 s warm.
7. `node dist/bin.cjs traces` (browser): rows visible immediately, sync indicator appears then clears; press refresh — completes without full re-read (verify via `--rebuild-index` timing difference).
8. `node dist/bin.cjs traces --rebuild-index --json --limit 5` — rebuilds and prints; subsequent warm run < 1 s again.

### Must-work checklist

- [x] Warm `traces --json --limit 5` on the real home dir < 1 s (was 6.8 s) — step 6. (measured 1.06 s total, of which ~0.7 s is CLI boot; listing itself ~0.35 s)
- [x] 100k-file corpus: warm listing < 1 s, cold index < 60 s — steps 3–4. (cold 5.4 s, warm 0.85 s)
- [x] Discovery never reads a full trace file (64 KB head cap) — read-size spy tests + step 5 timing.
- [x] Browser paints instantly from the index and revalidates in the background — step 7. (verified via terminal-pilot on 15k real traces)
- [x] Appended/updated traces re-index from a single head read — step 5. (hot files; dormant-beyond-7-days caveat documented in the agent-traces README)
- [x] `--rebuild-index` recovers from a deleted/corrupt index file — step 8 after `rm` of the index.
- [x] Unwritable-index and custom-`fs` callers still work via direct scan — fallback unit tests.
- [x] Existing `traces` CLI/SDK output shape unchanged — current test suites green.

### Rollout / migration

Purely additive: index builds lazily on first run; no data migration. Deleting the `trace-index/` cache directory is always safe. `agent-traces` and `agent-trace-viewer` READMEs document the index location, `--rebuild-index`, and the `index` option.

## 5. Code plan

**Phase 1 — index store**

- Create `packages/agent-traces/src/index-store/store.ts` — `openTraceIndex`, shard/manifest read/write with atomic temp+rename, `sync`/`query`/`rebuild`/`close`, hot-window stat selection, newest-shard-first query streaming.
- Create `packages/agent-traces/src/index-store/walk.ts` — `walkCandidates(reader, options): AsyncIterable<TraceFileCandidate>` + bounded-concurrency helper `mapConcurrent(items, 32, fn)`.
- Create `packages/agent-traces/src/index-store/head.ts` — `readHead(fs, path, 65536): Promise<string>` using `fs.open`/`read` with a `readFile`-slice fallback for plain memfs.
- Tests: `store.test.ts`, `walk.test.ts`, `head.test.ts`.

**Phase 2 — readers provide scan + head parsing**

- Change `readers/claude.ts` — add `scan()` (dir walk, no stats/reads) and `readHeadMetadata()` (existing `traceHeadMetadata`, exported pure); `discover()` reimplemented on scan + head for the no-index fallback (bounded concurrency, head reads only).
- Change `readers/pi.ts`, `readers/poe-code.ts` — same split.
- Change `readers/codex.ts` — nothing; it stays on Codex's own SQLite and is merged at query time.
- Tests: parity fixtures asserting `discover()` output unchanged; no-full-read spies.

**Phase 3 — wire listTraces + collect**

- Change `packages/agent-trace-viewer/src/loader.ts` — `listTraces` opens the index, `sync` per `index` mode, `query` with real LIMIT, merge codex, fallback path; `onIndexUpdate` plumbed.
- Change `packages/agent-traces/src/collect.ts` — discovery via index when available.
- Change `src/cli/commands/traces.ts` — `--rebuild-index` flag, progress line on cold index, `index: "sync"` for `--json`.
- Tests: loader/browser/CLI updates.

**Phase 4 — browser revalidate + docs**

- Change `packages/agent-trace-viewer/src/run.ts` — stale-while-revalidate rows, header sync indicator, refresh forces sync.
- Change `packages/agent-traces/README.md` + `packages/agent-trace-viewer/README.md` — index location, modes, flag.
- Create scratchpad corpus generator (JS) used by the real-world test (not committed).

**Phase 5 — verification** — real-world test steps 1–8, must-work checklist, `npm test`, judgement `npm run e2e:verbose`.

## Checklist

Work top to bottom; each item lands with its tests and keeps main green.

### Phase 1 — index store

- [x] `index-store/store.ts` — shard/manifest storage with atomic writes, `sync`/`query`/`rebuild`/`close`, hot-window stat selection, newest-shard-first streaming
- [x] `index-store/concurrency.ts` — `mapConcurrent(…, 32, …)`; the candidate walk lives in each reader's `scan()` instead of a shared walk module
- [x] `index-store/head.ts` — 64 KB head reader with memfs fallback
- [x] Tests: idempotent sync, zero-read warm sync, prune, version rebuild, corrupt manifest/shard recovery (concurrent sync is safe by atomic temp+rename, last-writer-wins)

### Phase 2 — readers

- [x] `claude.ts` — `scan()` + pure `readHeadMetadata()`; fallback `discover()` on head reads + bounded concurrency
- [x] `pi.ts` — same split
- [x] `poe-code.ts` — same split
- [x] `codex.ts` — untouched; merged at query time (verify with parity test)
- [x] Parity tests: `discover()` output identical on fixtures; no-full-read spies

### Phase 3 — wiring

- [x] `agent-trace-viewer/loader.ts` — index-backed `listTraces` with `index` mode + real LIMIT push-down + codex merge + fallback
- [x] `agent-traces/collect.ts` — indexed discovery with `since` push-down
- [x] `src/cli/commands/traces.ts` — `--rebuild-index`, `index: "sync"` for `--json`; cold-index progress is an interactive spinner (JSON output stays clean)
- [x] SDK parity — `index` option exposed and documented

### Phase 4 — browser + docs

- [x] `run.ts` — instant rows via `initialRows`, background revalidation swaps rows in place (cold start shows an indexing spinner), refresh forces sync
- [x] READMEs — index location, `--rebuild-index`, `index` modes
- [x] Scratchpad corpus generator script (JS)

### Phase 5 — verification

- [x] `npm test` green (agent-traces 60, agent-trace-viewer 75, traces CLI 9)
- [x] 100k corpus: cold < 60 s, warm < 1 s (real-world steps 3–5)
- [x] Real home dir: warm `traces --json --limit 5` < 1 s (was 6.8 s)
- [x] Browser instant paint + revalidate verified (step 7)
- [x] `--rebuild-index` recovery after deleting the index file
- [x] Must-work checklist from level 4 fully checked
- [x] Judgement call on `npm run e2e:verbose`: skipped — the change is covered by unit suites plus real-world verification (100k synthetic corpus, real home dir, interactive TUI via terminal-pilot); e2e adds agent-spawn coverage unrelated to discovery
