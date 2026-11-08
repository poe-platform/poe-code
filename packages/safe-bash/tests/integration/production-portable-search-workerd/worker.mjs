import { Shell, browserCommands, portableSearchCommands, createBoundedRegexProvider, FsError } from "@poe-platform/safe-bash/browser";
import { createMemoryFileSystem, FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { observeProvider } from "./observe.mjs";

const encoder = new TextEncoder();
const endpointOptions = Object.freeze({ requestTimeoutMs: 1000, startupTimeoutMs: 1000, maxWorkers: 2, maxQueuedRequests: 64, maxQueuedBytes: 134217728, idleTimeoutMs: 100, workerOldGenerationMb: 128, workerStackMb: 4 });
const grep = (patterns, overrides = {}) => ({ kind: "grep", patterns, fixed: false, extended: true, insensitive: false, whole: false, word: false, ...overrides });
const rg = (patterns, overrides = {}) => ({ kind: "rg", patterns, fixed: true, case: "sensitive", whole: false, word: false, nullData: false, ...overrides });
const row = (text, overrides = {}) => ({ bytes: encoder.encode(text), all: false, terminated: true, ...overrides });

function check(condition, message) { if (!condition) throw new Error(message); }
function bytesEqual(actual, expected, label) {
  check(actual.length === expected.length && actual.every((byte, index) => byte === expected[index]), `${label}: bytes ${JSON.stringify([...actual])}, expected ${JSON.stringify([...expected])}`);
}
function clean(provider) {
  const state = provider.evidence;
  check(state.created === state.retired && state.retiring === 0 && state.pending === 0 && state.listeners === 0, `unretired endpoint: ${JSON.stringify(state)}`);
  check(state.posted === state.replies + state.cancelled, `unaccounted request: ${JSON.stringify(state)}`);
}
async function environment(provider, options = {}) {
  const fs = createMemoryFileSystem();
  for (const [path, text] of [["/input", "first\nsecond\tkeep\r\nlast\n"], ["/literal", "a+b\naab\n"], ["/empty", ""], ["/hostile", "a".repeat(1000) + "!\n"]]) await fs.writeFile(path, encoder.encode(text));
  await fs.writeFile("/invalid", Uint8Array.of(0xff, 0xfe, 10));
  return new Shell({ fs }).use(browserCommands()).use(portableSearchCommands({ provider, ...options }));
}
async function assertCommand(shell, script, expected, exitCode = 0) {
  const result = await shell.exec(script);
  check(result.exitCode === exitCode, `${script}: ${JSON.stringify(result)}`);
  bytesEqual(result.stdoutBytes, encoder.encode(expected), script);
  bytesEqual(result.stderrBytes, new Uint8Array(), `${script} stderr`);
}
async function exchange(endpoint, id, descriptor, rows) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { endpoint.off("message", listener); reject(new Error("production endpoint did not reply")); }, 5000);
    const listener = value => {
      if (value?.id !== id) return;
      clearTimeout(timer);
      endpoint.off("message", listener);
      resolve(value);
    };
    endpoint.on("message", listener);
    try { endpoint.postMessage({ id, descriptor, rows }); }
    catch (error) { clearTimeout(timer); endpoint.off("message", listener); reject(error); }
  });
}
async function directCase(options, descriptor, rows, inspect) {
  const observed = observeProvider(createBoundedRegexProvider(options));
  const endpoint = observed.createWorker(endpointOptions);
  try { inspect(await exchange(endpoint, 1, descriptor, rows)); }
  finally { await endpoint.terminate(); }
  clean(observed);
  return { ...observed.evidence };
}

export default {
  async test() {
    check(typeof process === "undefined" && typeof Buffer === "undefined" && typeof Worker === "undefined", "unexpected Node/browser Worker globals");
    check(FsError === CoreFsError, "filesystem identity mismatch");
    check(typeof createBoundedRegexProvider === "function", "missing package-owned production provider");
    const results = [];
    const provider = observeProvider(createBoundedRegexProvider());
    const shell = await environment(provider);
    try {
      for (const [script, expected, status = 0] of [
        ["printf 'first\\nsecond\\n' | grep second", "second\n"],
        ["printf 'first\\nsecond\\n' | rg -F second", "second\n"],
        ["grep '^seco.d.*$' /input", "second\tkeep\r\n"],
        ["grep -E '^sec.*' /input", "second\tkeep\r\n"],
        ["grep -F 'a+b' /literal", "a+b\n"],
        ["rg -F 'a+b' /literal", "a+b\n"],
        ["grep -e first -e last /input", "first\nlast\n"],
        ["grep -x first /input", "first\n"],
        ["grep '' /input", "first\nsecond\tkeep\r\nlast\n"],
        ["grep -f /empty /input", "", 1],
        ["grep -E '^sec.*' /input | sed 's/second/found/' | rg -F found", "found\tkeep\r\n"],
        ["sed -n '/second/p' /input", "second\tkeep\r\n"],
      ]) {
        await assertCommand(shell, script, expected, status);
        results.push({ kind: "exact-bytes", script, status });
      }
      for (const script of ["grep -i first /empty", "grep -w first /empty", "grep 'a\\+' /empty", "rg second /empty", "rg -Fi first /empty", "rg -F -g '*.txt' first /input", "grep -o first /input", "grep -a . /invalid", "rg -aF x /invalid"]) {
        const result = await shell.exec(script);
        check(result.exitCode === 2 && result.stderr.toLowerCase().includes("unsupported"), `unsupported command: ${script}: ${JSON.stringify(result)}`);
        bytesEqual(result.stdoutBytes, new Uint8Array(), `${script} rejected stdout`);
        results.push({ kind: "unsupported-command", script, stderr: result.stderr });
      }
    } finally { await shell.dispose(); }
    clean(provider);

    const unsupported = [
      grep(["x"], { insensitive: true }), grep(["x"], { word: true }),
      grep(["a\\+"], { extended: false }), grep(["é"]), grep(["\0"]),
      ...["a^b", "a$b", "a^", "$a", "*a"].map(pattern => grep([pattern], { extended: false })),
      rg(["a|aa"], { fixed: false }), rg(["x"], { case: "smart" }), rg(["x"], { word: true }),
      { kind: "glob", patterns: [], globOptions: [] },
      { kind: "expr-match", pattern: encoder.encode("x"), profile: "byte", limits: { maxPatternBytes: 16, maxSubjectBytes: 16, maxNodes: 16, maxDepth: 4, maxSteps: 256, maxStates: 16, maxAllocatedUnits: 256 } },
    ];
    for (const descriptor of unsupported) {
      const evidence = await directCase({}, descriptor, [], reply => check(typeof reply.error === "string" && reply.error.toLowerCase().includes("unsupported"), `empty-row admission: ${JSON.stringify(reply)}`));
      results.push({ kind: "empty-row-rejection", descriptor, evidence });
    }
    await directCase({}, grep(["["]), [], reply => check(typeof reply.error === "string", "invalid regex accepted without rows"));
    results.push({ kind: "empty-row-syntax-rejection" });
    await directCase({}, grep(["x"]), [row("", { all: true })], reply => check(typeof reply.error === "string" && reply.error.includes("all-match"), "all-match enumeration accepted"));
    results.push({ kind: "empty-subject-all-match-rejection" });
    for (const bytes of [Uint8Array.of(255), Uint8Array.of(192, 128), Uint8Array.of(0), encoder.encode("é")]) {
      const original = Uint8Array.from(bytes);
      await directCase({}, grep(["."]), [{ bytes, all: false, terminated: true }], reply => check(typeof reply.error === "string" && reply.error.includes("non-NUL ASCII"), `invalid subject admission: ${JSON.stringify(reply)}`));
      bytesEqual(bytes, original, "rejected subject ownership");
      results.push({ kind: "raw-subject-rejection", bytes: [...bytes] });
    }
    await directCase({}, grep(["a|aa"]), [row("zaa")], reply => {
      check(reply.results?.length === 1, "missing ERE result");
      bytesEqual(reply.results[0], [1, 3], "leftmost-longest ERE offsets");
    });
    results.push({ kind: "ERE-byte-offsets" });
    for (const [descriptor, rows, expected] of [
      [grep([]), [row("abc")], [[]]],
      [grep([""]), [row("")], [[0, 0]]],
      [rg(["a+b"]), [row("xa+by")], [[1, 4]]],
      [grep(["[^a]"], { extended: false }), [row("aab")], [[2, 3]]],
      [grep(["[$^]"], { extended: false }), [row("a$b"), row("a^b")], [[1, 2], [1, 2]]],
      [grep(["^a$"], { extended: false }), [row("a"), row("aa")], [[0, 1], []]],
    ]) {
      await directCase({}, descriptor, rows, reply => {
        check(reply.results?.length === expected.length, "missing supported-profile results");
        expected.forEach((span, index) => bytesEqual(reply.results[index], span, "supported byte offsets"));
      });
      results.push({ kind: "supported-direct-selection", descriptor });
    }

    for (const [options, descriptor, rows] of [
      [{ maxPatterns: 1 }, grep(["x", "y"]), []],
      [{ maxPatternBytes: 4 }, grep(["abcde"]), []],
      [{ maxRows: 1 }, grep(["x"]), [row("x"), row("x")]],
      [{ maxInputBytes: 4 }, grep(["x"]), [row("abcde")]],
      [{ maxResultBytes: 15 }, grep(["x"]), [row("x")]],
      [{ maxAllocationUnits: 16 }, grep(["a+"]), [row("aaa")]],
      [{ maxStates: 1 }, grep(["a+"]), [row("aaa")]],
    ]) {
      const evidence = await directCase(options, descriptor, rows, reply => check(typeof reply.error === "string" && reply.error.toLowerCase().includes("limit"), `missing limit error: ${JSON.stringify({ options, reply })}`));
      results.push({ kind: "provider-limit", options, evidence });
    }
    const capacityProvider = createBoundedRegexProvider({ maxWorkers: 1 });
    const busy = capacityProvider.createWorker(endpointOptions);
    let capacityRejected = false;
    try { capacityProvider.createWorker(endpointOptions); }
    catch (error) { capacityRejected = error.message.includes("limit"); }
    check(capacityRejected, "endpoint count limit was not enforced");
    let replies = 0;
    const countReplies = reply => { if (reply?.id !== undefined) replies++; };
    busy.on("message", countReplies);
    try {
      busy.postMessage({ id: 1, descriptor: grep(["^(a+)+$"]), rows: [row("a".repeat(1000) + "!")] });
      let busyRejected = false;
      try { busy.postMessage({ id: 2, descriptor: grep(["x"]), rows: [] }); }
      catch (error) { busyRejected = error.message.includes("busy"); }
      check(busyRejected, "endpoint accepted simultaneous requests");
      await new Promise(resolve => setTimeout(resolve, 0));
      const retirement = busy.terminate();
      check(retirement === busy.terminate(), "endpoint termination is not idempotent");
      await retirement;
      await new Promise(resolve => setTimeout(resolve, 0));
      check(replies === 0, "cancelled endpoint delivered a reply during or after retirement");
      let closedRejected = false;
      try { busy.postMessage({ id: 3, descriptor: grep(["x"]), rows: [] }); }
      catch (error) { closedRejected = error.message.includes("closed"); }
      check(closedRejected, "retired endpoint accepted work");
    } finally { busy.off("message", countReplies); await busy.terminate(); }
    const replacement = capacityProvider.createWorker(endpointOptions);
    try {
      const recovered = await exchange(replacement, 1, grep(["x"]), [row("x")]);
      check(recovered.results?.length === 1, "capacity not reusable after awaited retirement");
      bytesEqual(recovered.results[0], [0, 1], "replacement endpoint result");
    } finally { await replacement.terminate(); }
    results.push({ kind: "endpoint-capacity-busy-idempotent-retirement-recovery", replies });
    for (const [label, providerOptions, pluginOptions, script, expected] of [
      ["work", { maxWork: 4096 }, {}, "grep -E '^(a+)+$' /hostile", "limit"],
      ["deadline", {}, { regex: { requestTimeoutMs: 1 } }, "grep -E '^(a+)+$' /hostile", "REQUEST_TIMEOUT"],
      ["output", {}, { search: { maxOutputBytes: 1 } }, "rg -F second /input", "output byte limit"],
      ["sed-steps", {}, { sed: { maxSteps: 8 } }, "sed -n '/z/p' /hostile", "step limit"],
    ]) {
      const bounded = observeProvider(createBoundedRegexProvider(providerOptions));
      const target = await environment(bounded, pluginOptions);
      try {
        const result = await target.exec(script);
        check(result.exitCode === 2 && result.stderr.includes(expected), `${label}: ${JSON.stringify(result)}`);
        clean(bounded);
        await assertCommand(target, "grep first /input", "first\n");
      } finally { await target.dispose(); }
      clean(bounded);
      results.push({ kind: "budget-cleanup-recovery", label, evidence: { ...bounded.evidence } });
    }

    for (const action of ["abort", "dispose"]) {
      const cancellation = new AbortController();
      const reason = new Error("production workerd acceptance cancellation");
      let armed = true;
      let activeAtFirstTurn = false;
      let activeAtSecondTurn = false;
      let closing;
      const observed = observeProvider(createBoundedRegexProvider(), request => {
        if (!armed || request.rows.length === 0) return;
        armed = false;
        setTimeout(() => {
          activeAtFirstTurn = observed.evidence.pending > 0;
          setTimeout(() => {
            activeAtSecondTurn = observed.evidence.pending > 0;
            if (action === "abort") cancellation.abort(reason);
            else closing = target.dispose();
          }, 0);
        }, 0);
      });
      const target = await environment(observed);
      let rejected = false;
      try {
        try { await target.exec("grep -E '^(a+)+$' /hostile", { signal: cancellation.signal }); }
        catch (error) { rejected = action === "dispose" || error === reason; }
        check(rejected && activeAtFirstTurn && activeAtSecondTurn, `${action} did not interrupt an active request across cooperative turns: ${JSON.stringify(observed.evidence)}`);
        clean(observed);
        if (action === "abort") await assertCommand(target, "grep first /input", "first\n");
      } finally { await (closing ?? target.dispose()); }
      clean(observed);
      results.push({ kind: "active-cancellation", action, activeAtFirstTurn, activeAtSecondTurn, evidence: { ...observed.evidence } });
    }
    console.log("PRODUCTION_PORTABLE_SEARCH_WORKERD_PASS " + JSON.stringify({ cases: results.length, results, normalEvidence: provider.evidence }));
  },
};
