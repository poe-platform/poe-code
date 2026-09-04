import { Shell, browserCommands, portableSearchCommands, createBoundedRegexProvider } from "@poe-platform/safe-bash/browser";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { observeProvider } from "./observe.mjs";

const encoder = new TextEncoder();
const endpointOptions = Object.freeze({ requestTimeoutMs: 1000, startupTimeoutMs: 1000, maxWorkers: 2, maxQueuedRequests: 64, maxQueuedBytes: 134217728, idleTimeoutMs: 100, workerOldGenerationMb: 128, workerStackMb: 4 });
const grep = (patterns, overrides = {}) => ({ kind: "grep", patterns, fixed: true, extended: false, insensitive: false, whole: false, word: false, ...overrides });
const rg = (patterns, overrides = {}) => ({ kind: "rg", patterns, fixed: true, case: "sensitive", whole: false, word: false, nullData: false, ...overrides });
const row = (text, overrides = {}) => ({ bytes: encoder.encode(text), all: false, terminated: true, ...overrides });
const note = "café\r\nCafe\ne\u0301\né\n前😀後\n\ufeffBOM\n";

function check(condition, message) { if (!condition) throw new Error(message); }
function bytesEqual(actual, expected, label) {
  check(actual.length === expected.length && actual.every((byte, index) => byte === expected[index]), `${label}: ${JSON.stringify([...actual])}, expected ${JSON.stringify([...expected])}`);
}
function clean(provider) {
  const state = provider.evidence;
  check(state.created === state.retired && state.retiring === 0 && state.pending === 0 && state.listeners === 0, `unretired endpoint: ${JSON.stringify(state)}`);
  check(state.posted === state.replies + state.cancelled, `unaccounted request: ${JSON.stringify(state)}`);
}
async function environment(provider, options = {}) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/notes", encoder.encode(note));
  await fs.writeFile("/long", encoder.encode("é".repeat(24_000) + "!\n"));
  await fs.writeFile("/invalid", Uint8Array.of(0xc3, 0x28, 10));
  await fs.writeFile("/nul", Uint8Array.of(0xc3, 0xa9, 0, 10));
  await fs.writeFile("/empty", new Uint8Array());
  return new Shell({ fs }).use(browserCommands()).use(portableSearchCommands({ provider, ...options }));
}
async function command(shell, script, expected, status = 0) {
  const result = await shell.exec(script);
  check(result.exitCode === status, `${script}: ${JSON.stringify(result)}`);
  bytesEqual(result.stdoutBytes, encoder.encode(expected), script);
  bytesEqual(result.stderrBytes, new Uint8Array(), `${script} stderr`);
}
async function exchange(endpoint, descriptor, rows) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { endpoint.off("message", listener); reject(new Error("UTF-8 production endpoint did not reply")); }, 5000);
    const listener = value => {
      if (value?.id !== 1) return;
      clearTimeout(timer);
      endpoint.off("message", listener);
      resolve(value);
    };
    endpoint.on("message", listener);
    try { endpoint.postMessage({ id: 1, descriptor, rows }); }
    catch (error) { clearTimeout(timer); endpoint.off("message", listener); reject(error); }
  });
}
async function directCase(options, descriptor, rows, inspect) {
  const observed = observeProvider(createBoundedRegexProvider(options));
  const endpoint = observed.createWorker(endpointOptions);
  try { inspect(await exchange(endpoint, descriptor, rows)); }
  finally { await endpoint.terminate(); }
  clean(observed);
  return { ...observed.evidence };
}

export default {
  async test() {
    check(typeof process === "undefined" && typeof Buffer === "undefined" && typeof Worker === "undefined", "unexpected Node/browser Worker globals");
    const results = [];
    const provider = observeProvider(createBoundedRegexProvider());
    const shell = await environment(provider);
    try {
      for (const program of ["grep -F", "rg -F"]) {
        for (const [script, expected, status = 0] of [
          [`printf 'café\\n' | ${program} café`, "café\n"],
          [`${program} café /notes`, "café\r\n"],
          [`${program} 'e\u0301' /notes`, "e\u0301\n"],
          [`${program} -x é /notes`, "é\n"],
          [`${program} 😀 /notes`, "前😀後\n"],
          [`${program} '\ufeff' /notes`, "\ufeffBOM\n"],
          [`${program} -x BOM /notes`, "", 1],
          [`${program} -e café -e 😀 /notes`, "café\r\n前😀後\n"],
          [`${program} '' /notes`, note],
          [`${program} -f /empty /notes`, "", 1],
        ]) {
          await command(shell, script, expected, status);
          clean(provider);
          results.push({ kind: "exact-command-bytes", script, status });
        }
      }
      for (const script of ["grep -F '�' /invalid", "rg -F '�' /invalid", "grep -F é /nul", "rg -F é /nul", "grep -E é /notes", "grep -E . /notes", "rg é /notes", "grep -Fi é /notes", "rg -Fi é /notes", "rg -FS é /notes", "grep -Fw é /notes", "rg -Fw é /notes", "grep -Fo é /notes", "rg -Fo é /notes", "rg -F -g '*.txt' é /notes"]) {
        const value = await shell.exec(script);
        check(value.exitCode === 2 && value.stderr.length > 0, `unsupported command accepted: ${script}: ${JSON.stringify(value)}`);
        bytesEqual(value.stdoutBytes, new Uint8Array(), `${script} rejection output`);
        clean(provider);
        results.push({ kind: "explicit-command-rejection", script });
      }
    } finally { await shell.dispose(); }
    clean(provider);

    for (const descriptor of [grep, rg]) {
      for (const [patterns, text, expected, flags = {}] of [
        [["😀"], "é前😀後", [5, 9]],
        [["é"], "前café!", [6, 8]],
        [["e\u0301"], "😀e\u0301é", [4, 7]],
        [["é"], "e\u0301", []],
        [["e\u0301"], "é", []],
        [["\ufeff"], "x\ufeffy", [1, 4]],
        [["BOM"], "\ufeffBOM", [3, 6]],
        [["前😀"], "前😀", [0, 7], { whole: true }],
        [["😀"], "前😀", [], { whole: true }],
        [[""], "é", [0, 0]],
        [[""], "", [0, 0], { whole: true }],
        [[""], "é", [], { whole: true }],
        [[], "é", []],
        [["�"], "é�", [2, 5]],
        [["\u0001é\u007f"], "😀\u0001é\u007f", [4, 8]],
        [["\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}"], "é\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}", [2, 26]],
      ]) {
        const value = descriptor(patterns, flags);
        const evidence = await directCase({}, value, [row(text)], reply => {
          check(reply.results?.length === 1, `missing fixed UTF-8 result: ${JSON.stringify(reply)}`);
          bytesEqual(reply.results[0], expected, "original byte span");
        });
        results.push({ kind: "original-byte-offset", descriptor: value, text, expected, evidence });
      }
    }

    for (const bytes of [[0x80], [0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xc3], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xc3, 0x28], [0]]) {
      for (const descriptor of [grep(["�"]), rg(["�"])]) {
        const original = Uint8Array.from(bytes);
        const evidence = await directCase({}, descriptor, [row("", { bytes: original })], reply => check(typeof reply.error === "string" && reply.error.includes("unsupported"), `malformed input accepted: ${JSON.stringify(reply)}`));
        bytesEqual(original, bytes, "invalid input must not be mutated");
        results.push({ kind: "invalid-input-rejected-unchanged", descriptor: descriptor.kind, bytes, evidence });
      }
    }
    for (const descriptor of [grep(["\ud800"]), rg(["\udc00"]), grep(["\0"]), rg(["\0"]), grep(["é"], { fixed: false, extended: true }), rg(["é"], { fixed: false }), grep(["é"], { insensitive: true }), rg(["é"], { case: "smart" }), grep(["é"], { word: true })]) {
      const evidence = await directCase({}, descriptor, [], reply => check(typeof reply.error === "string" && reply.error.includes("unsupported"), `unsupported pattern accepted on empty input: ${JSON.stringify(reply)}`));
      results.push({ kind: "empty-input-pattern-rejection", descriptor, evidence });
    }
    for (const descriptor of [grep(["é"]), rg(["é"])]) {
      const evidence = await directCase({}, descriptor, [row("é", { all: true })], reply => check(typeof reply.error === "string" && reply.error.includes("unsupported"), "all-match enumeration accepted"));
      results.push({ kind: "all-match-rejection", descriptor, evidence });
    }
    for (const [options, patterns, rows] of [
      [{ maxPatterns: 1 }, ["é", "😀"], []],
      [{ maxPatternBytes: 3 }, ["😀"], []],
      [{ maxPatternBytes: 3 }, ["é", "é"], []],
      [{ maxRows: 1 }, ["é"], [row("é"), row("é")]],
      [{ maxInputBytes: 3 }, ["é"], [row("éé")]],
      [{ maxInputBytes: 3 }, ["é"], [row("é"), row("é")]],
      [{ maxResultBytes: 15 }, ["é"], [row("é")]],
      [{ maxAllocationUnits: 16 }, ["é"], [row("é")]],
      [{ maxWork: 8 }, ["é"], [row("é".repeat(100))]],
    ]) {
      const evidence = await directCase(options, grep(patterns), rows, reply => check(typeof reply.error === "string" && reply.error.toLowerCase().includes("limit"), `missing limit error: ${JSON.stringify({ options, reply })}`));
      results.push({ kind: "bounded-utf8-request", options, evidence });
    }

    for (const [label, options, pluginOptions, script, expected] of [
      ["work", { maxWork: 4096 }, {}, "grep -F 'éz' /long", "limit"],
      ["deadline", {}, { regex: { requestTimeoutMs: 1 } }, "grep -F 'éz' /long", "REQUEST_TIMEOUT"],
      ["output", {}, { search: { maxOutputBytes: 1 } }, "rg -F café /notes", "output byte limit"],
    ]) {
      const observed = observeProvider(createBoundedRegexProvider(options));
      const target = await environment(observed, pluginOptions);
      try {
        const value = await target.exec(script);
        check(value.exitCode === 2 && value.stderr.includes(expected), `${label}: ${JSON.stringify(value)}`);
        clean(observed);
        // The output-limited shell cannot emit a record; a no-match request still proves reuse.
        await command(target, "grep -F absent /notes", "", 1);
        clean(observed);
      } finally { await target.dispose(); }
      clean(observed);
      results.push({ kind: "utf8-budget-cleanup-recovery", label, evidence: { ...observed.evidence } });
    }

    for (const action of ["abort", "dispose"]) {
      const cancellation = new AbortController();
      const reason = new Error("UTF-8 production workerd cancellation");
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
        try { await target.exec(`grep -F '${"é".repeat(1000)}z' /long`, { signal: cancellation.signal }); }
        catch (error) { rejected = action === "dispose" || error === reason; }
        check(rejected && activeAtFirstTurn && activeAtSecondTurn, `${action} did not interrupt a UTF-8 request across cooperative turns: ${JSON.stringify(observed.evidence)}`);
        clean(observed);
        if (action === "abort") await command(target, "grep -F -x é /notes", "é\n");
      } finally { await (closing ?? target.dispose()); }
      clean(observed);
      results.push({ kind: "active-utf8-cancellation", action, activeAtFirstTurn, activeAtSecondTurn, evidence: { ...observed.evidence } });
    }
    console.log("UTF8_LITERAL_SEARCH_WORKERD_PASS " + JSON.stringify({ cases: results.length, results, normalEvidence: provider.evidence }));
  },
};
