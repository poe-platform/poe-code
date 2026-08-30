import base64
import datetime
import hashlib
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
CANDIDATE = '9885390fb11454fa194a3e60fdbef198dbfdf633'
START = time.monotonic_ns()
COMMANDS = []

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    COMMANDS.append(['git', *args])
    return subprocess.check_output(['git', *args], cwd=REPO)

def add(name, content):
    if not isinstance(content, str):
        content = json.dumps(content, indent=2) + '\n'
    patch = '*** Begin Patch\n*** Add File: ' + str((ROOT / name).relative_to(REPO)) + '\n'
    patch += ''.join('+' + line + '\n' for line in content.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch', patch], cwd=REPO, check=True)

def census(directory):
    result = []
    for path in sorted(directory.rglob('*')):
        assert not path.is_symlink(), str(path)
        result.append({'path': str(path), 'directory': True, 'bytes': 0} if path.is_dir() else
                      {'path': str(path), 'sha256': digest(path.read_bytes()), 'bytes': path.stat().st_size})
    return result

header = 'const __v9 = (globalThis as unknown as { __gitAdapterV9: (event: string, subject?: unknown, value?: unknown, detail?: unknown) => void }).__gitAdapterV9;\n'
specs = {
 'src/commands/git/codec.ts': [
  ('    const stream = createInflate({ chunkSize: GIT_LIMITS.maxChunkBytes });', '    const stream = createInflate({ chunkSize: GIT_LIMITS.maxChunkBytes });\n    __v9("stream-created", session.context, stream);'),
  ('      stream.once("close", resolve);', '      __v9("acquire-close-hook", stream, resolve);\n      stream.once("close", resolve);'),
  ('    await closing;', '    await closing;\n    __v9("acquire-close-joined", stream, closing);'),
  ('  let written: Promise<void> | undefined;', '  __v9("codec-acquired", codec);\n  let written: Promise<void> | undefined;'),
  ('          const closed = (): void => finish(hasCodecError ? codecError : new GitFailure("Git codec closed during write"));', '          const closed = (): void => { __v9("writer-close-delivered", codec, closed); finish(hasCodecError ? codecError : new GitFailure("Git codec closed during write")); };'),
  ('            codec.removeListener("close", closed);', '            __v9("writer-finish-attempt", codec, closed, error);\n            codec.removeListener("close", closed);'),
  ('          codec.once("close", closed);', '          __v9("writer-close-hook", codec, closed);\n          codec.once("close", closed);'),
  ('error => finish(error ?? undefined)', 'error => { __v9("raw-write-callback", codec, closed, error); finish(error ?? undefined); }'),
  ('    written = writer();', '    written = writer();\n    __v9("writer-start", codec, written);'),
  ('    for await (const value of codec) {', '    for await (const value of codec) {\n      __v9("reader-yield", codec);'),
  ('    await written;', '    __v9("reader-done", codec);\n    await written;\n    __v9("writer-normal-joined", codec, written);'),
  ('    if (hasCodecError && error === codecError) throw new GitFailure("invalid Git zlib object");', '    if (hasCodecError && error === codecError) { __v9("codec-primary-mapped", codec, error); throw new GitFailure("invalid Git zlib object"); }'),
  ('  } finally {\n    codec.destroy();', '  } finally {\n    __v9("codec-finalizer-enter", codec);\n    codec.destroy();'),
  ('    await written?.catch(() => {});', '    await written?.catch(() => {});\n    if (written !== undefined) __v9("writer-joined", codec, written);'),
  ('    if (!codec.closed) await new Promise<void>(resolve => codec.once("close", resolve));', '    if (!codec.closed) await new Promise<void>(resolve => { __v9("finalizer-close-hook", codec, resolve); codec.once("close", resolve); });\n    __v9("codec-finalizer-joined", codec);'),
 ],
 'src/contracts/output.ts': [
  ('    accepting = false;', '    accepting = false;\n    __v9("output-close-begin", close);'),
  ('        const failures = results.filter', '        __v9("output-close-results", close, results);\n        __v9("output-close-joined", close);\n        const failures = results.filter'),
  ('  context.registerCleanup?.(close);', '  __v9("output-open", context, close);\n  __v9(typeof context.registerCleanup === "function" ? "hook-present" : "hook-absent", context, close);\n  context.registerCleanup?.(close);'),
 ],
 'src/commands/git/index.ts': [
  ('    async execute(context) {', '    async execute(context) {\n      __v9("invocation-begin", context);'),
  ('      try { await session.operation.close(); }', '      try { await session.operation.close(); __v9("internal-cleanup-fulfilled", context); }'),
  ('      catch (error) { cleanupFailed = true; cleanupFailure = error; }', '      catch (error) { __v9("internal-cleanup-rejected", context, error); cleanupFailed = true; cleanupFailure = error; }'),
 ],
 'src/shell/cleanup.ts': [
  ('    this.#callbacks.push(cleanup);', '    this.#callbacks.push(cleanup);\n    __v9("scope-registered", this, cleanup);'),
  ('            try { await cleanup(); } catch (error) { this.failures.push(error); }', '            __v9("cleanup-start", cleanup);\n            try { await cleanup(); __v9("cleanup-fulfilled", cleanup); } catch (error) { __v9("cleanup-rejected", cleanup, error); this.failures.push(error); }'),
 ],
 'src/shell/runtime.ts': [
  ('        const raw = definition.execute(forwarded);', '        __v9("shell-route", forwarded, scope);\n        const raw = definition.execute(forwarded);'),
  ('        return arrayStore(state) ? await interruptible(observed, this.signal) : await observed;', '        const interruptedObservation = !!arrayStore(state);\n        try {\n          const result = interruptedObservation ? await interruptible(observed, this.signal) : await observed;\n          __v9(interruptedObservation ? "shell-interruptible-joined" : "execute-joined", forwarded, raw, false);\n          return result;\n        } catch (error) { __v9(interruptedObservation ? "shell-interruptible-joined" : "execute-joined", forwarded, raw, true); __v9("execute-failure", forwarded, error); throw error; }'),
 ],
}
sources = []
for path, replacements in specs.items():
    original = git('show', CANDIDATE + ':' + path)
    transformed = original.decode()
    changes = []
    for before, after in replacements:
        assert transformed.count(before) == 1, (path, before, transformed.count(before))
        offset = original.find(before.encode())
        assert offset >= 0
        changes.append({'before': before, 'after': after, 'originalByteOffset': offset,
                        'line': original[:offset].count(b'\n') + 1, 'sha256Before': digest(before.encode()), 'sha256After': digest(after.encode())})
        transformed = transformed.replace(before, after)
    restored = transformed
    for change in reversed(changes):
        restored = restored.replace(change['after'], change['before'], 1)
    assert restored.encode() == original
    transformed = header + transformed
    sources.append({'path': path, 'commit': CANDIDATE, 'blobOid': git('rev-parse', CANDIDATE + ':' + path).decode().strip(),
                    'sha256': digest(original), 'sourceBase64': base64.b64encode(original).decode(),
                    'transformedSha256': digest(transformed.encode()), 'transformedBase64': base64.b64encode(transformed.encode()).decode(),
                    'prefix': header, 'changes': changes, 'reverseRestoresOriginal': True, 'execution': 'HELD: DATA only'})
for path in ['src/commands/git/io.ts', 'src/commands/git/repository.ts', 'src/shell/shell.ts']:
    original = git('show', CANDIDATE + ':' + path)
    sources.append({'path': path, 'commit': CANDIDATE, 'sha256': digest(original), 'sourceBase64': base64.b64encode(original).decode(), 'execution': 'SOURCE only; not transformed'})
old = ROOT.parent / 'm1a-review-v5'
cases = (old / 'cases.mjs').read_text()
case_changes = [
 ('registerCleanup(callback) { fixture.register(); cleanups.push(callback); }', 'registerCleanup(callback) { fixture.register(); cleanups.push(callback); __v9("host-registered", context, callback); }'),
 ('    const cleaned = await Promise.allSettled(cleanups.map(callback => callback()));', '    __v9("execute-joined", context, failure, thrown);\n    const cleaned = await Promise.allSettled(cleanups.map(callback => { __v9("cleanup-start", callback); return callback(); }));\n    cleaned.forEach((result, index) => __v9(result.status === "fulfilled" ? "cleanup-fulfilled" : "cleanup-rejected", cleanups[index], result.status === "rejected" ? result.reason : undefined));\n    __v9("host-boundary", context);'),
 ('try { const result = await shell.exec(', 'try { __v9("shell-exec-start", shell); const result = await shell.exec('),
 ("get().observations.push({ shell: true", "__v9('shell-exec-joined', shell); get().observations.push({ shell: true"),
 ('finally { await shell.dispose(); }', 'finally { await shell.dispose(); __v9("shell-dispose-joined", shell); }'),
]
transformed = cases
for before, after in case_changes:
    assert transformed.count(before) == 1, before
    transformed = transformed.replace(before, after)
restored = transformed
for before, after in reversed(case_changes):
    restored = restored.replace(after, before, 1)
assert restored == cases
case_prefix = 'const __v9 = globalThis.__gitAdapterV9;\n'
sources.append({'path': str((old / 'cases.mjs').relative_to(REPO)), 'sha256': digest(cases.encode()),
 'sourceBase64': base64.b64encode(cases.encode()).decode(), 'transformedSha256': digest((case_prefix + transformed).encode()),
 'transformedBase64': base64.b64encode((case_prefix + transformed).encode()).decode(), 'prefix': case_prefix,
 'changes': [{'before': before, 'after': after} for before, after in case_changes], 'reverseRestoresOriginal': True, 'execution': 'HELD helper overlay; assertions restored byte-exact'})
add('SOURCE-TRANSFORMS.json', {'classification': 'DATA ONLY; no import/transpile/eval', 'sources': sources})
proposal = json.loads((ROOT.parent / 'observer-qualification-v8/CONTINUATION-PROPOSED.json').read_text())
add('CONTINUATION-PROPOSED.json', {'status': 'UNAPPROVED_HELD_DIFFERENT_REVIEW_REQUIRED', 'candidate': CANDIDATE,
 'observerAcceptedBy': 'd80af7048688dfbd1b4b3ebd9c5fb2aacb26f473', 'adapterSha256': digest((ROOT / 'adapter.mjs').read_bytes()),
 'transformsSha256': digest((ROOT / 'SOURCE-TRANSFORMS.json').read_bytes()),
 'semanticGroups': {'source': 71, 'compiled': 71, 'staged': 71, 'moved': 71, 'total': 284, 'oldCompletedSourceRepeated': 69, 'oldUnexecuted': 215},
 'semanticChildren': {'layouts': 4, 'typesPositive': 1, 'typesNegative': 4, 'mutants': 3, 'bindingNegative': 3, 'total': 15},
 'priorExactRecipeData': proposal, 'nativeGitHeld': 6,
 'mechanicalPilotProposal': {'execution': 'HELD; distinct from 284 unchanged semantic groups', 'sourceGroups': ['A57', 'A60', 'H09'],
 'children': 1, 'additionalToSemantic15': True, 'allModuleTransforms': [dict(path=item['path'], sha256=item['transformedSha256']) for item in sources if 'transformedSha256' in item],
 'maxMs': 60000, 'traceSlots': 8192, 'identitySlots': 1024, 'streamSlots': 32,
 'overflow': 'HOLD, no retry/rescore/cap increase under same seal'},
 'finiteOrder': 'different review -> fresh ROOT admission of mechanical pilot only -> inspect loaded hashes/routes -> separate ROOT decision on unchanged 284/15 continuation',
 'aggregateFutureProposal': {'childrenIncludingAdditionalMechanicalPilot': 16, 'peak': 2, 'aggregateMs': 600000, 'captureBytes': 33554432, 'workBytes': 134217728},
 'missingAdmissionInputs': ['diagnostic loader loaded-byte receipt and pinned TS toolchain', 'full-fixture capacity proof',
 'review of unchanged semantic adapter using conditional source-join rather than private dynamic timestamps'],
 'command': None, 'candidateExecutableSealPromoted': False})
add('WORKER-DELTA.json', {'status': 'PREPARED adapter integration recipe; candidate execution HELD',
 'oldWorkerSha256': digest((old / 'worker.mjs').read_bytes()), 'oldCasesSha256': digest((old / 'cases.mjs').read_bytes()),
 'oldFixturesSha256': digest((old / 'fixtures.mjs').read_bytes()),
 'oldObserverMustNotBeReused': 'remove writerCodec global-factory inference; do not use active close-event count as native liveness',
 'mechanicalOnly': ['load adapter.mjs and bindProbe before importing any prepared module; verify global binding before/after',
 'load only exact SOURCE-TRANSFORMS transformed bytes with independent loaded-byte hashing',
 'one bounded adapter per group; one invocations context identity per observed route; preserve all semantic assertions',
 'capture execute/host boundary states before separate bounded owned notification horizon; no case-level rescore of historical H09',
 'verify and restore descriptors in finally only after known owned stream close/error drain; unknown closure HOLD',
 'aggregate context verdicts, not only group-end close count; record all errors and exact reason identity'],
 'notYetClaimed': 'Loader, whole candidate adapter runtime, all native allocations and future 284 execution are not qualified by synthetic seams'})
supervisor = (ROOT.parent / 'observer-qualification-v8/run.mjs').read_text()
supervisor = supervisor.replace('observer-v8-cohort-receipt', 'adapter-v9-cohort-receipt').replace('!== 19', '!== 12').replace('<= 6', '<= 12')
add('run.mjs', supervisor)
old_trees = [{'root': str(ROOT.parent / name), 'rows': census(ROOT.parent / name)} for name in
             ['m1a-review-v5', 'observer-qualification-v6', 'observer-qualification-v7', 'observer-qualification-v8', 'observer-v8-independent']]
node = pathlib.Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
assert digest(node.read_bytes()) == '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'
add('PRESEAL.json', {'schema': 'adapter-v9-post-author-preexecution', 'frozenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'preparationFirstObservedWall': '2026-08-28T20:04:04Z', 'preparationScriptMs': (time.monotonic_ns() - START) / 1e6,
 'preparationMetadataGitCommands': COMMANDS, 'stagedBeforeSeal': git('diff', '--cached', '--name-status', '-z').decode(),
 'node': {'path': str(node), 'version': 'v22.22.2', 'sha256': digest(node.read_bytes())},
 'files': [{'path': path.name, 'sha256': digest(path.read_bytes()), 'bytes': path.stat().st_size} for path in sorted(ROOT.iterdir()) if path.is_file()],
 'oldTrees': old_trees, 'qualification': {'rows': 12, 'synthetic': 10, 'data': 2, 'realZlib': 0, 'candidate': 0,
 'coordinator': 1, 'workerChildren': 1, 'syntaxChildren': 0, 'otherControlChildren': 0, 'totalNodeProcesses': 2,
 'directChildrenCountingCoordinator': 2, 'ceiling': 12, 'peak': 2, 'aggregateMs': 600000,
 'workerMs': 60000, 'cleanupMs': 5000, 'captureBytes': 33554432, 'scratchBytes': 134217728,
 'tracePerControl': 8192, 'identityPerControl': 1024, 'streamPerControl': 32,
 'command': str(node) + ' ' + str((ROOT / 'run.mjs').relative_to(REPO)), 'cwd': str(REPO),
 'childArgv': [str(ROOT / 'worker.mjs')], 'childEnvironment': {'PATH': str(node.parent), 'UV_THREADPOOL_SIZE': '1'},
 'imports': ['node:assert/strict', 'node:events', 'node:crypto', 'node:fs', 'node:path', 'node:url', 'node:child_process', './adapter.mjs'],
 'execution': 'ONE cohort; no retry; source transformed bytes never evaluated; all exit/nonzero safety authoritative'}})
