import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { RustWasmBash, createRustWasmBash } from "./index.js";

test("output budgets count the bytes written by each command and pipeline stage", async () => {
  for (const bytes of [Uint8Array.of(255), new TextEncoder().encode("\uE080")]) {
    const bash = new RustWasmBash({ files: { "/bytes": bytes } });
    try {
      for (const [script, channel, writes] of [
        ["head -c3 /bytes", "stdoutBytes", 1],
        ["cat /bytes >&2", "stderrBytes", 1],
        ["cat /bytes | cat", "stdoutBytes", 2],
      ]) {
        const limit = writes * bytes.length;
        const result = await bash.exec(script, { limits: { maxOutputBytes: limit } });
        assert.deepEqual(result[channel], bytes);
        if (limit > 1) {
          await assert.rejects(bash.exec(script, { limits: { maxOutputBytes: limit - 1 } }), /maxOutputBytes/);
        }
      }
    } finally { bash.dispose(); }
  }
});

test("tail and negative head retain the requested suffix across chunks until EOF", async () => {
  const first = "a".repeat(65535) + "\n";
  const second = "b".repeat(65534) + "\0\n";
  const bash = new RustWasmBash({ files: { "/f": first + second + "last" }, deviceView: "provided" });
  bash.mountDevices();
  try {
    for (const cmd of ["tail -c4", "tail -n0", "head -c-4", "head -n-1"]) {
      await assert.rejects(bash.exec(cmd + " /dev/zero", { limits: { maxInputBytes: 65536 } }), /maxInputBytes/);
    }
    for (const [cmd, expected] of [
      ["tail -n2", second + "last"], ["head -n-1", first + second],
      ["tail -zn1", "\nlast"], ["tail -c6", "\0\nlast"], ["head -c-4", first + second],
    ]) {
      const result = await bash.exec(cmd + " /f");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    await assert.rejects(bash.exec("head -c-1 /dev/zero", {
      limits: { maxInputBytes: 65536, maxOutputBytes: 5 },
    }), /maxOutputBytes/);
  } finally { bash.dispose(); }
});

test("tail starting at a record skips across device chunks and reads to EOF or a limit", async t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  try {
    await assert.rejects(bash.exec("tail -n+2 /dev/zero", { limits: { maxInputBytes: 65536 } }), /maxInputBytes/);
    const random = t.mock.method(globalThis.crypto, "getRandomValues", view => {
      view.fill(97);
      view[0] = 10;
      return view;
    });
    await assert.rejects(bash.exec("tail -n+3 /dev/random", { limits: { maxOutputBytes: 8 } }), /maxOutputBytes/);
    assert.equal(random.mock.callCount(), 2);
  } finally { bash.dispose(); }
});

test("cat enforces its input quota per regular file, including later chunks", async () => {
  const bash = new RustWasmBash({ files: {
    "/long": new Uint8Array(65537), "/one": "abc", "/two": "def", "/secret": { content: "hidden", mode: 0o200 },
  }, symlinks: { "/alias": "/long" } });
  try {
    await assert.rejects(bash.exec("cat -n /alias", { limits: { maxInputBytes: 65536 } }), /maxInputBytes/);
    const r = await bash.exec("cat /one /secret /two", { limits: { maxInputBytes: 3 } });
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "abcdef", "cat: EACCES: permission denied, readStream '/secret'\n"]);
    assert.equal((await bash.exec("cat /long", { limits: { maxInputBytes: 65537 } })).stdoutBytes.length, 65537);
  } finally { bash.dispose(); }
});

test("noclobber checks the final name without replacing files or following dangling links", async () => {
  for (const profile of [undefined, "strict-budgets-mount-dev", "overlay-cow-fs"]) {
    const bash = new RustWasmBash({profile, files:{"/dir/file":"original"}, symlinks:{"/dangling":"/absent", "/cycle":"/cycle", "/alias":"/dir"}});
    try {
      for (const target of ["/dir/file", "/dir", "/dangling", "/cycle", "/alias"]) {
        const r = await bash.exec("set -C; echo changed >" + target);
        assert.deepEqual([r.exitCode, r.stderr], [1, `shell: line 1: ${target}: cannot overwrite existing file\n`], profile);
      }
      const r = await bash.exec("set -C; printf new >/alias/new; cat /dir/new /dir/file; test ! -e /absent");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "neworiginal", ""]);
    } finally { bash.dispose(); }
  }
});

test("cat checks access before reading aliases and preserves each filesystem's path errors", async () => {
  for (const profile of [undefined, "strict-budgets-mount-dev", "overlay-cow-fs"]) {
    const bash = new RustWasmBash({ profile, files: {
      "/private/entry": "inside", "/hidden": { content: "secret", mode: 0o200 }, "/visible": "ok",
    }, symlinks: { "/alias": "/hidden", "/loop": "/loop" } });
    const overlay = profile === "overlay-cow-fs", mounted = profile === "strict-budgets-mount-dev";
    try {
      const r = await bash.exec("chmod 600 /private; cat /alias /private/entry /hidden/ /loop /missing /visible");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "ok", [
        "cat: EACCES: permission denied, " + (overlay ? "overlay '/hidden'" : "readStream '/alias'"),
        "cat: EACCES: permission denied, " + (overlay ? "overlay '/private'" : (mounted ? "capabilitiesFor" : "lstat") + " '/private/entry'"),
        "cat: ENOTDIR: not a directory, " + (overlay ? "overlay '/hidden'" : (mounted ? "capabilitiesFor" : "readStream") + " '/hidden/'"),
        "cat: ELOOP: too many symbolic links encountered" + (mounted ? ", capabilitiesFor" : "") + " '/loop'",
        "cat: ENOENT: no such file or directory, " + (overlay ? "overlay" : "readStream") + " '/missing'",
        "",
      ].join("\n")]);
    } finally { bash.dispose(); }
  }
});

test("head and tail check every path component before emitting a file header", async () => {
  for (const profile of [undefined, "strict-budgets-mount-dev", "overlay-cow-fs"]) {
    const bash = new RustWasmBash({ profile, files: { "/private/entry": "hidden", "/ok": "shown" } });
    try {
      for (const cmd of ["head", "tail"]) {
        const r = await bash.exec(`chmod 600 /private; ${cmd} -vc1 /private/../ok /private/entry /ok`);
        const op = profile === "strict-budgets-mount-dev" ? "capabilitiesFor" : "lstat";
        const denied = profile === "overlay-cow-fs" ? ["overlay '/private'", "overlay '/private'"] :
          [profile ? "capabilitiesFor '/private/../ok'" : "stat '/private/../ok'", op + " '/private/entry'"];
        assert.equal(r.exitCode, 1);
        assert.equal(r.stdout, "==> /ok <==\n" + (cmd === "head" ? "s" : "n"));
        assert.equal(r.stderr, denied.map(at => cmd + ": EACCES: permission denied, " + at + "\n").join(""));
      }
    } finally { bash.dispose(); }
  }
});

test("head reads device chunks until its byte or record count is satisfied", async t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  try {
    const random = t.mock.method(globalThis.crypto, "getRandomValues", view => {
      view.fill(97);
      view[view.length - 1] = 10;
      return view;
    });
    const zeros = await bash.exec("head -c65539 /dev/zero");
    assert.deepEqual([zeros.exitCode, zeros.stdoutBytes.length, zeros.stdoutBytes.some(b => b !== 0)], [0, 65539, false]);
    assert.equal((await bash.exec("head -c0 /dev/random")).stdout, "");
    assert.equal(random.mock.callCount(), 0);
    const lines = await bash.exec("head -n2 /dev/urandom");
    assert.equal(lines.exitCode, 0, lines.stderr);
    assert.equal(random.mock.callCount(), 2);
    assert.equal(lines.stdoutBytes.length, 2 * 65536);
    assert.equal(lines.stdoutBytes[65535], 10);
    await assert.rejects(bash.exec("head -c20 /dev/zero > /dest", { limits: { maxOutputBytes: 10 } }), /maxOutputBytes/);
    const denied = await bash.exec("touch /private; chmod 000 /private; head -vc0 /private /dev/zero");
    assert.deepEqual([denied.exitCode, denied.stdout, denied.stderr], [
      1, "==> /dev/zero <==\n", "head: EACCES: permission denied, access '/private'\n"
    ]);
    random.mock.mockImplementation(() => { throw new Error("source unavailable"); });
    const failed = await bash.exec("head -vc1 /dev/random");
    assert.deepEqual([failed.exitCode, failed.stdout, failed.stderr], [
      1, "==> /dev/random <==\n", "head: EIO: input/output error, readStream '/dev/random'\n"
    ]);
    await assert.rejects(bash.exec("head -n1 /dev/zero", { limits: { maxInputBytes: 65536 } }), /maxInputBytes/);
  } finally { bash.dispose(); }
});

test("reentrant host commands have independent SECONDS, deadlines and elapsed times", async t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  const wasm = bash.instance.exports;
  t.mock.method(globalThis.crypto, "getRandomValues", view => {
    assert.equal(bash.execSync("sleep 7").exitCode, 0);
    return view.fill(0);
  });
  try {
    const outer = await bash.exec("SECONDS=0; sleep 1; head -c1 /dev/random >/dev/null; echo $SECONDS");
    assert.deepEqual([outer.exitCode, outer.stdout, outer.stderr], [0, "1\n", ""]);
    assert.equal(wasm.safe_bash_last_elapsed_ms(bash.sessionId), 7000);
    const timed = await bash.exec("timeout 1 bash -c 'head -c1 /dev/random >/dev/null; sleep 2; echo leaked'");
    assert.deepEqual([timed.exitCode, timed.stdout, timed.stderr], [124, "", ""]);
    const untouched = wasm.safe_bash_fork_session(bash.sessionId);
    try { assert.equal(wasm.safe_bash_last_elapsed_ms(untouched), 0); }
    finally { wasm.safe_bash_destroy_session(untouched); }
    bash.execSync(":");
    assert.equal(wasm.safe_bash_last_elapsed_ms(bash.sessionId), 0);
  } finally { bash.dispose(); }
});

test("a host callback can inspect the parent session while a child is executing", async t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  let snapshot;
  t.mock.method(globalThis.crypto, "getRandomValues", view => {
    snapshot = bash.snapshot(0);
    return view.fill(0x61);
  });
  try {
    const result = await bash.exec("head -c1 /dev/random");
    assert.deepEqual([result.exitCode, result.stdout, snapshot?.cwd], [0, "a", "/workspace"]);
  } finally { bash.dispose(); }
});

test("random device reads allow the entropy source to access the shared filesystem", async t => {
  const bash = new RustWasmBash({ deviceView: "provided", files: { "/workspace/value": "ok" } });
  bash.mountDevices();
  let observed;
  t.mock.method(globalThis.crypto, "getRandomValues", view => {
    observed = bash.readText("/dev/null") + bash.readText("/workspace/value");
    return view.fill(0x61);
  });
  try {
    const command = await bash.exec("dd if=/dev/random of=/dev/null bs=1 count=1 status=none");
    assert.deepEqual([command.exitCode, command.stderr, observed], [0, "", "ok"]);
    observed = undefined;
    const fd = await bash.fs.open("/dev/urandom", { access: "read" });
    try {
      const bytes = new Uint8Array(3);
      assert.equal(await fd.read(bytes, null), 3);
      assert.deepEqual([...bytes], [97, 97, 97]);
      assert.equal(observed, "ok");
      assert.equal(await fd.getPosition(), 3);
    } finally { await fd.close(); }
  } finally { bash.dispose(); }
});

test("entropy reads survive WASM memory growth inside the host callback", t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  t.mock.method(globalThis.crypto, "getRandomValues", view => {
    bash.exports.memory.grow(1);
    return view.fill(97);
  });
  try {
    const result = bash.execSync("head -c3 /dev/urandom");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "aaa", ""]);
  } finally { bash.dispose(); }
});

test("a running command cannot restore its session after a host callback destroys it", t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  const x = bash.instance.exports, old = bash.sessionId;
  let next = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", view => {
    x.safe_bash_destroy_session(old);
    next = x.safe_bash_create_session();
    return view.fill(0);
  });
  try {
    bash.execSync("head -c1 /dev/random");
    assert.ok(next > 0);
    assert.equal(x.safe_bash_session_snapshot(old, 0), -1);
    assert.ok(x.safe_bash_session_snapshot(next, 0) > 0);
  } finally { x.safe_bash_destroy_session(next); bash.dispose(); }
});

test("a destroyed session handle cannot read or destroy a later session", () => {
  const bash = new RustWasmBash();
  const x = bash.instance.exports;
  try {
    const stale = x.safe_bash_fork_session(bash.sessionId);
    x.safe_bash_destroy_session(stale);
    for (const create of [() => x.safe_bash_fork_session(bash.sessionId), () => x.safe_bash_create_session()]) {
      const next = create();
      assert.equal(x.safe_bash_session_snapshot(stale, 0), -1);
      x.safe_bash_destroy_session(stale);
      assert.ok(x.safe_bash_session_snapshot(next, 0) > 0);
      x.safe_bash_destroy_session(next);
    }
  } finally { bash.dispose(); }
});

test("find -exec children inherit the caller's stdin in both execution modes", async () => {
  const bash = new RustWasmBash({ files: { "/x": "", "/y": "" } });
  try {
    for (const [action, expected] of [["\\;", "ab\nc"], ["{} +", "a\nbc"]]) {
      const r = await bash.exec("find /x /y -exec sh -c 'head -c1' " + action + "; echo; cat", { stdin: "abc" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], action);
    }
  } finally { bash.dispose(); }
});

test("xargs shares inherited stdin across batches only with an argument file", async () => {
  const bash = new RustWasmBash({ files: { "/args": "x y" } });
  try {
    for (const [script, expected] of [
      ["xargs -a /args -n1 sh -c 'head -c1'; echo; cat", "ab\ncd"],
      ["xargs -n1 echo; echo; cat", "abcd\n\n"],
      ["xargs -a /absent echo 2>/dev/null; cat", "abcd"],
    ]) {
      const r = await bash.exec(script, { stdin: "abcd" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], script);
    }
  } finally { bash.dispose(); }
});

test("disabling capture still delivers bytes to sinks and hides them from result hooks", async () => {
  const bash = new RustWasmBash();
  try {
    const writes = [];
    let observed;
    const r = await bash.exec("cat; echo err >&2", {
      captureOutput: false,
      stdin: Uint8Array.of(0, 255),
      stdout: { async write(bytes) { writes.push(["out", ...bytes]); } },
      stderr: { async write(bytes) { writes.push(["err", ...bytes]); } },
      hooks: { afterExec(_state, res) { observed = [res.stdout, res.stderr, ...res.stdoutBytes, ...res.stderrBytes]; } },
    });
    assert.deepEqual(writes, [["out", 0, 255], ["err", 101, 114, 114, 10]]);
    assert.deepEqual(observed, ["", ""]);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr, r.stdoutBytes.length, r.stderrBytes.length], [0, "", "", 0, 0]);
  } finally { bash.dispose(); }
});

test("env and timeout leave the child's unread stdin for the caller", async () => {
  const bash = new RustWasmBash();
  try {
    for (const wrapper of ["env X=y", "timeout 1", "env timeout 1 env"]) {
      const r = await bash.exec(wrapper + " head -c2; echo; cat", { stdin: "abcd" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "ab\ncd", ""], wrapper);
    }
  } finally { bash.dispose(); }
});

test("text utilities consume stdin once across operands and shell commands", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, expected] of [
      ["wc -c - -", "      4 -\n      0 -\n      4 total\n"],
      ["sort - -", "a\nb\n"], ["uniq", "b\na\n"], ["tac - -", "a\nb\n"],
      ["cut -f1 - -", "b\na\n"], ["tr a x", "b\nx\n"], ["rev", "b\na\n"],
      ["fold - -", "b\na\n"], ["fmt - -", "b a\n"], ["nl - -", "     1\tb\n     2\ta\n"],
      ["expand - -", "b\na\n"], ["unexpand - -", "b\na\n"],
    ]) {
      const r = await bash.exec(cmd + "; cat", { stdin: "b\na\n" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], cmd);
    }
  } finally { bash.dispose(); }
});

test("cat, head and tail advance the shared stdin cursor only when they read", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [script, input, expected] of [
      ["head -qc2 - -; echo; cat", "abcdef", "abcd\nef"],
      ["head -qzn1 - -; echo; cat", "a\0b\0c", "a\0b\0\nc"],
      ["head -n-1; cat", "a\nb\nc\n", "a\nb\n"],
      ["tail -qc2 - -; cat", "abcdef", "ef"],
      ["cat - -; cat", "abcdef", "abcdef"],
      ["cat --invalid 2>/dev/null; cat", "abcdef", "abcdef"],
      ["head -c0; head -c1 </dev/null; cat", "abc", "abc"],
    ]) {
      const result = await bash.exec(script, { stdin: input });
      assert.deepEqual([result.stdout, result.exitCode], [expected, 0], script);
    }
    const split = await bash.exec("head -c1; echo; cat", { stdin: "é" });
    assert.deepEqual([...split.stdoutBytes], [0xc3, 10, 0xa9]);
  } finally { bash.dispose(); }
});

test("a rejected beforeExec hook leaves stdin untouched", async () => {
  const bash = new RustWasmBash(), reason = new Error("hook refused execution");
  let opened = 0;
  const stdin = { [Symbol.asyncIterator]() { opened++; return { async next() { return { done: true }; } }; } };
  try {
    await assert.rejects(bash.exec("cat", { stdin, hooks: { async beforeExec() { throw reason; } } }), e => e === reason);
    assert.equal(opened, 0);
  } finally { bash.dispose(); }
});

test("abort closes held async stdin once without waiting for the producer", async () => {
  const bash = new RustWasmBash(), controller = new AbortController();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let returns = 0, settled = false;
  const source = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return release.promise; },
    async return() { returns++; throw new Error("late cleanup failure"); },
  }; } };
  const reason = { stop: true };
  const result = assert.rejects(bash.exec("cat", { stdin: source, signal: controller.signal }), e => e === reason)
    .then(() => { settled = true; });
  try {
    await entered.promise;
    controller.abort(reason);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([settled, returns], [true, 1]);
  } finally {
    release.resolve({ done: true });
    await result;
    bash.dispose();
  }
});

test("async stdin preserves borrowed bytes and stops pulling after cancellation", async () => {
  const bash = new RustWasmBash();
  try {
    const source = { async *[Symbol.asyncIterator]() {
      const chunk = Buffer.alloc(2);
      for (const b of [0, 128, 255]) {
        chunk.fill(b);
        yield chunk.subarray(1);
      }
    } };
    const result = await bash.exec("cat", { stdin: source });
    assert.deepEqual([...result.stdoutBytes], [0, 128, 255]);
    const controller = new AbortController();
    const reason = { cancelled: true };
    let reads = 0, closes = 0;
    const cancelled = { async *[Symbol.asyncIterator]() {
      try {
        reads++; yield Uint8Array.of(1);
        controller.abort(reason);
        reads++; yield Uint8Array.of(2);
        reads++; yield Uint8Array.of(3);
      } finally { closes++; }
    } };
    await assert.rejects(bash.exec("cat", { stdin: cancelled, signal: controller.signal }), e => e === reason);
    assert.deepEqual([reads, closes], [2, 1]);
  } finally { bash.dispose(); }
});

test("jq repeats strings and splits each separator value with Unicode and empty-input semantics", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, expected] of [
      ['["ab"*2.9,2*"π",""*infinite,"a"*(-1),"a"*0]', ["abab", "ππ", "", null, ""]],
      ['["π😀"/"",""/"x","x,"/","]', [["π","😀"], [], ["x",""]]],
      ['["a,b;c"|split((",", ";"))]', [["a","b;c"], ["a,b","c"]]],
      ['[try ("a,b"|split((",",3))) catch .]', [["a","b"], "split input and separator must be strings"]],
      ['first("x,y"|split((",",error("late"))))', ["x","y"]],
      ['["x"|split(empty)]', []],
    ]) {
      const r = bash.execSync("jq -nc '" + filter + "'");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, JSON.stringify(expected) + "\n", ""], filter);
    }
    const tooBig = await bash.exec(`jq -n 'try ("π"*5) catch 0'`, { limits: { maxMemoryBytes: 9 } });
    assert.deepEqual([tooBig.exitCode, tooBig.stdout, tooBig.stderr], [5, "", "jq: maxValueBytes limit exceeded\n"]);
  } finally { bash.dispose(); }
});

test("jq numeric remainder uses signed 64-bit operands and operators describe errors", () => {
  const bash = new RustWasmBash();
  try {
    const r = bash.execSync("jq -nc '[5.9%2.5,(-5.9)%2.5,18446744073709551616%3,-9223372036854775808 % -1,nan%0]'");
    assert.deepEqual([r.exitCode, r.stdout], [0, "[1,-1,1,0,null]\n"]);
    for (const [expr, message] of [
      ["1/0", "number (1) and number (0) cannot be divided because the divisor is zero"],
      ["5.9%0.1", "number (5.9) and number (0.1) cannot be divided (remainder) because the divisor is zero"],
      ["true+{}", "boolean (true) and object ({}) cannot be added"],
      ['{a:2}-[1]', 'object ({"a":2}) and array ([1]) cannot be subtracted'],
      ["false*3", "cannot apply * to boolean and number"],
    ]) {
      const err = bash.execSync("jq -nr 'try (" + expr + ") catch .'");
      assert.deepEqual([err.exitCode, err.stdout], [0, message + "\n"]);
    }
  } finally { bash.dispose(); }
});

test("jq recurse emits each node before requesting children and preserves suspended sibling streams", () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, expected] of [
      ['first(recurse(error("late")))', "null"],
      ["[0|recurse(.+1; . < 0)]", "[0]"],
      ["[limit(3; 7|recurse(null))]", "[7,null,null]"],
      ["[0|recurse(.+1; (. < 2,. < 2))]", "[0,1,1]"],
      ['[try (0|recurse(if . == 0 then (1,error("after")) else empty end)) catch .]', '[0,1,"after"]'],
      ["[limit(2;recurse(inputs)),inputs]", "[null,1,2,3]"],
      ["[def recurse(f): 9; recurse(.)]", "[9]"],
    ]) {
      const r = bash.execSync("jq -nc '" + filter + "'", "1 2 3");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected + "\n", ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq accepts leading decimal points in numeric filters and arithmetic operands", () => {
  const bash = new RustWasmBash();
  try {
    const r = bash.execSync("jq -nc '[.5, -.25, .125e+2, 1+.5+.25, {x: 2}.x]'");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "[0.5,-0.25,12.5,1.75,2]\n", ""]);
  } finally { bash.dispose(); }
});

test("jq reports exhaustion in nested generator expressions before losing its session", () => {
  const bash = new RustWasmBash();
  try {
    const filter = Array(2500).fill("first(range(1; 2))").join("+");
    const r = bash.execSync("jq -n '" + filter + "'");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", "jq: maxDepth limit exceeded\n"]);
    assert.equal(bash.execSync("echo ok").stdout, "ok\n");
  } finally { bash.dispose(); }
});

test("a long jq operator chain cannot exhaust the shell stack", () => {
  const bash = new RustWasmBash();
  try {
    const r = bash.execSync("jq -n '" + Array(2500).fill("inputs").join("+") + "'");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "", ""]);
    const leftDeep = bash.execSync("jq -n '" + Array(2500).fill("1").join("+") + "'");
    assert.deepEqual([leftDeep.exitCode, leftDeep.stdout, leftDeep.stderr], [0, "2500\n", ""]);
    const stream = bash.execSync("jq -nc '[(first(inputs),first(inputs))+first(inputs)+2*3*4-5-6]'", "1 2 3");
    assert.deepEqual([stream.exitCode, stream.stdout], [0, "[16,17]\n"]);
    const early = bash.execSync(`jq -nc 'first((1,error("late"))+2+3)'`);
    assert.deepEqual([early.exitCode, early.stdout], [0, "6\n"]);
    assert.equal(bash.execSync("echo ok").stdout, "ok\n");
  } finally { bash.dispose(); }
});

test("exhausted jq function and path recursion reports a limit and leaves the shell usable", () => {
  const bash = new RustWasmBash();
  try {
    for (const program of [
      "def f: f; f",
      "def f: . |= f; try f catch 0",
      "def f: f; path(f)",
      "def f: if . > 0 then .-1 | f else . end; 10000 | f",
    ]) {
      const r = bash.execSync("jq -n '" + program + "'");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", "jq: maxDepth limit exceeded\n"]);
      assert.equal(bash.execSync("echo ok").stdout, "ok\n");
    }
  } finally { bash.dispose(); }
});

test("jq handles two hundred nested user calls without losing the shell", () => {
  const bash = new RustWasmBash();
  try {
    const result = bash.execSync("jq -n 'def countdown: if . > 0 then .-1 | countdown else . end; 200 | countdown'");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "0\n", ""]);
    assert.equal(bash.execSync("echo still-running").stdout, "still-running\n");
  } finally { bash.dispose(); }
});

test("jq accepts if as an unquoted object key beside conditional values", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, expected] of [
      ["{if:if true then 1 else 3 end,end:4}", '{"if":1,"end":4}\n'],
      ['{"if":"yes","end":2} | {if,end}', '{"if":"yes","end":2}\n'],
      ["{if: (1,2), end: 3}", '{"if":1,"end":3}\n{"if":2,"end":3}\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq field access visits every base and respects optional and quoted keys", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["{x:1} | .x", 0, "1\n", ""],
      ["{\"if\":1} | .if", 0, "1\n", ""],
      ["({a:1},error(\"late\")).a", 5, "1\n", "jq: error (at <unknown>): late\n"],
      ["first(({a:1},error(\"late\")).a)", 0, "1\n", ""],
      ["[{a:1},0,{a:3}] | .[].a?", 0, "1\n", ""],
      ["[{a:1},0,{a:3}] | .[].a", 5, "1\n", "jq: error (at <unknown>): Cannot index number with string \"a\"\n"],
      ["{\"#text\":4} | .\"+content\"", 0, "null\n", ""],
      ["{\"@x\":2} | .\"+@x\"", 0, "null\n", ""],
      ["{\"a.b\":5} | .\"a.b\"", 0, "5\n", ""],
      ["{\"k1\":4,\"k2\":7} | .\"k\\((1,2))\"", 0, "4\n7\n", ""],
      ["[5] | .longlonglonglonglonglonglonglonglong", 5, "", "jq: error (at <unknown>): Cannot index array with string\n"],
      ["0 | .\"a\\\"b\"", 5, "", "jq: error (at <unknown>): Cannot index number with string \"a\\\"b\"\n"],
      ["[{\"x\":3}] as $r | $r[0].x", 0, "3\n", ""],
      ["def f: {v:1},error(\"late\"); first(f.v)", 0, "1\n", ""],
      ["[{a:1},{a:2}] | (.[]).a", 0, "1\n2\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
  } finally { bash.dispose(); }
});

test("jq evaluates bracket indexes and slice bounds before each base", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["([7,8],[5,6])[(1,0)]", 0, "8\n6\n7\n5\n", ""],
      [".[(0,error(\"late\"))]", 5, "null\n", "jq: error (at <unknown>): late\n"],
      [".[false]", 5, "", "jq: error (at <unknown>): Cannot index null with boolean\n"],
      ["[4,5][1]", 0, "5\n", ""],
      ["[1,2,1][[1]]", 0, "[0,2]\n", ""],
      ["[1,2,3][{start:1,end:null}]", 0, "[2,3]\n", ""],
      ["[1,2,3][(0,1):(1,3)]", 0, "[1]\n[1,2,3]\n[]\n[2,3]\n", ""],
      ["\"𝄞ab\" | .[-2:]", 0, "\"ab\"\n", ""],
      ["{x:[5,6]} | .x[(1,0)]", 0, "6\n5\n", ""],
      ["first(([1], error(\"late\"))[0])", 0, "1\n", ""],
      ["[.,.][halt]", 0, "", ""],
      ["[1,2] | .[false]?", 0, "", ""],
      ["[1,2] | .[(0,error(\"late\"))]?", 0, "1\n", ""],
      ["\"ab\" | .[0]", 5, "", "jq: error (at <unknown>): Cannot index string with number\n"],
      ["null | .[1:false]", 5, "", "jq: error (at <unknown>): slice end must be a finite number or null\n"],
      ["{\"a\":1,\"b\":2} | .[\"a\",\"b\"]", 0, "1\n2\n", ""],
      ["[1,2] as $a | $a[0:1]", 0, "[1]\n", ""],
      ["[0,1,2] | .[nan:1.5]", 0, "[0,1]\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
  } finally { bash.dispose(); }
});

test("jq halt exits the program across catches and preserves prior output", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, status, stdout, stderr] of [
      ["1,halt,2", 0, "1\n", ""],
      ["halt()", 0, "", ""],
      ["halt_error()", 5, "", ""],
      ["try halt catch 9", 0, "", ""],
      ["try halt_error(7) catch .", 7, "", ""],
      ['"problem" | halt_error', 5, "", "problem"],
      ["{a:2} | halt_error(259.9)", 3, "", '{"a":2}\n'],
      ['"x" | halt_error(-2)', 0, "", "x"],
      ["false | halt_error(empty), 1", 0, "1\n", ""],
      ['"a" | try halt_error(false) catch .', 0, JSON.stringify('string ("a") halt_error/1: number required') + "\n", ""],
      ['null | halt_error((6,error("never")))', 6, "", ""],
      ["try error(nan) catch isnan", 0, "true\n", ""],
      ['try error((1,error("later"))) catch .', 0, "1\n", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, stdout, stderr], filter);
    }
    const stopped = await bash.exec("jq -c '.,halt' <<< $'1\\n2'");
    assert.deepEqual([stopped.exitCode, stopped.stdout, stopped.stderr], [0, "1\n", ""]);
  } finally { bash.dispose(); }
});

test("jq searches byte offsets and overlapping subsequences for every pattern", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['"ééé" | indices("éé")', "[0,2]\n"],
      ['"𝄞a𝄞" | index(("a","𝄞"))', "4\n0\n"],
      ["[1,1,1] | rindex(([1,1],[2]))", "1\nnull\n"],
      ["[1.0,1.00,1] | indices([1,1])", "[0,1]\n"],
      ['"abc" | indices(false)', "", "Cannot index string with boolean"],
      ['{"x":[1,2]} | indices("x"),rindex("x")', "[1,2]\n2\n"],
      ['"a" | first(indices(("a",error("late"))))', "[0]\n"],
      ["[7,8,9] | indices({start:1,end:null})", "[8,9]\n"],
      ['"abc" | indices({start:nan,end:2})', '"ab"\n'],
      ["[1] | indices(empty)", ""],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq iteration emits each object or array item until an error or early stop", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['([1,2],error("late"))[]', "1\n2\n", "late"],
      ['first(([1],error("late"))[])', "1\n"],
      ['({x:1,y:2},[3])[]', "1\n2\n3\n"],
      ["(true,[3])[]?", ""],
      ["[[1],false,[2]] | .[][]?", "1\n"],
      ["0 | .[ ]", "", "Cannot iterate over number (0)"],
      ['"ББББББББББ" | .[]', "", 'Cannot iterate over string ("БББББ...)'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq binds function value parameters as nested streams in the caller's scope", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['def f($x): $x; f((1,error("stop")))', "1\n", "stop"],
      ['def f($a;$b): [$a,$b]; f((1,2);inputs)', "[1,7]\n[1,8]\n"],
      ['def f($a;$b): [$a,$b]; f(empty;error("stop"))', ""],
      ['def f($a;$b): [$a,$b]; first(f((1,2);(3,error("late"))))', "[1,3]\n"],
      ['def f($a;g): $a | g; 4 as $x | f((3,4);.+$x)', "7\n8\n"],
      ['def f($x): .[$x]; {"a":1,"b":2} | (f(("a","b")))=3', '{"a":3,"b":3}\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`, { stdin: "7\n8\n" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq getpath and setpath visit each candidate and validate it against the input", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ['setpath((["x"],["y"]);(1,2))', '{"x":1}\n{"y":1}\n{"x":2}\n{"y":2}\n'],
      ['setpath(error("path");empty)', ""],
      ['setpath("x";0)', "", "Path must be specified as an array"],
      ['try setpath([1e100,false];1) catch .', '"Cannot index null with boolean"\n'],
      ['setpath([{"__slice":[0,1]}];[])', "", "Cannot index null with object"],
      ['first(setpath((["x"],error("later"));1))', '{"x":1}\n'],
      ['setpath((["x"],error("stop"));42)', '{"x":42}\n', "stop"],
      ['{"a":3} | getpath((["a"],[],["x"]))', '3\n{"a":3}\nnull\n'],
      ["getpath(4)", "", "Path must be specified as an array"],
      ["[0] | getpath(([0],[false]))", "0\n", "Cannot index array with boolean"],
      ['"𝄞ab" | getpath([{start:-2,end:null}])', '"ab"\n'],
      ["[2,3,4] | getpath([{start:0.1,end:1.1}])", "[2,3]\n"],
      ["[] | getpath([{}])", "", "Array/string slice indices must be integers"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq select, negation and optional filters preserve intermediate results", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout, error] of [
      ["7 | select((false,true,true))", "7\n7\n"],
      ['5 | select((true,error("stop")))', "5\n", "stop"],
      ['first(select((true,error("stop"))))', "null\n"],
      ["-((2,true))", "-2\n", "negation requires a number"],
      ['(-(2,error("stop")))?', "-2\n"],
      ['(1,error("stop"))?', "1\n"],
      ['(1,2)? | error("outside")', "", "outside"],
    ]) {
      const r = await bash.exec(`jq -nc -- '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [error ? 5 : 0, stdout, error ? `jq: error (at <unknown>): ${error}\n` : ""], filter);
    }
  } finally { bash.dispose(); }
});

test("yq properties retain numeric path components as keys and replace scalar parents", async () => {
  const bash = new RustWasmBash({ files: {"/workspace/app.properties": "a=1\na.1=b\na.0=x\n0=root\n"} });
  try {
    const r = await bash.exec("yq -p props -o json -I0 . app.properties");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, '{"0":"root","a":{"0":"x","1":"b"}}\n', ""]);
  } finally { bash.dispose(); }
});

test("jq validates array indexes and slice replacements before growing a path", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, message] of [
      ["[1] | .[-3]=9", "array index out of bounds"],
      ["2 | .x=4", 'Cannot index number with string "x"'],
      ["{} | .[2]=5", "Cannot index object with number"],
      ["[1,2] | .[0:1]=3", "slice assignment requires an array value"],
      ["setpath([false];42)", "Cannot index null with boolean"],
      ["setpath([-1];9)", "Out of bounds negative array index"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`], filter);
    }
    const limit = await bash.exec("jq -nc 'try setpath([1e100];42) catch 5'");
    assert.deepEqual([limit.exitCode, limit.stdout, limit.stderr], [5, "", "jq: maxCollectionSize limit exceeded\n"]);
  } finally { bash.dispose(); }
});

test("jq assignments use one right-hand value for every path and delete empty updates", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, values] of [
      ["{} | (.a,.b) = (1,2)", [{a:1,b:1},{a:2,b:2}]],
      ["{} | (.a,.b) = first(inputs)", [{a:1,b:1}]],
      ["{x:3} | .x += (2,4)", [{x:5},{x:7}]],
      ["{x:5} | .x //= (1,2)", [{x:5},{x:5}]],
      ["{x:5} | .x = empty", []],
      ["{x:5} | .x |= empty", [{}]],
      ["[0,1,2,3,4] | (.[1],.[3],.[1]) |= empty", [[0,2,4]]],
      ['{x:42} | .x |= (1,error("late"))', [{x:1}]],
      ["first(.x = inputs),inputs", [{x:1},2,3]],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, values.map(v => JSON.stringify(v) + "\n").join(""), ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq labels stop the right generator and expose the break value to catch", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, stdout] of [
      ["-nc 'label $x | [(1,break $x)],2'", ""],
      ["-nc 'label $outer | (label $out | 1,break $outer),2'", "1\n"],
      ["-nc '[label $x | (label $x | 1,break $x),2]'", "[1,2]\n"],
      ["-c 'label $x | try break $x catch .__jq' <<< '1 2 3'", "0\n1\n2\n"],
      ["-nc 'label $x | try break $x catch error(.)'", ""],
      ["-nc 'label $x | 1,error({__jq:0}),2'", "1\n"],
      ["-nc '[first(label $x | inputs),inputs]' <<< '1 2 3'", "[1,2,3]\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], args);
    }
    const err = await bash.exec(`jq -nc 'label $x | 1,error("bad")'`);
    assert.deepEqual([err.exitCode, err.stdout, err.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
  } finally { bash.dispose(); }
});

test("jq reduce and foreach interleave their initial, source and update streams", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[reduce (1,2) as $x (0; (.+$x, .+$x+10))]", "[23]\n"],
      ["[foreach (1,2) as $x (0; (.+$x, .+$x+10))]", "[1,11,13,23]\n"],
      ["7 | [reduce . as $x ((0,5); $x)]", "[7,null]\n"],
      ["7 | [foreach . as $x ((0,5); $x)]", "[7,7]\n"],
      ["[reduce inputs as $x (empty; .),inputs]", "[1,2,3]\n"],
      ["[first(foreach inputs as $x (0; $x)),inputs]", "[1,2,3]\n"],
      ["[foreach (1,2) as $x (0; empty; 42)]", "[]\n"],
      ["reduce range(3) as $x (first(range(7;9)); .+$x)", "10\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    const r = await bash.exec(`jq -nc 'foreach (1,error("bad")) as $x (0; $x)'`);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
  } finally { bash.dispose(); }
});

test("jq binary operators visit every operand in order and short-circuit unused filters", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[(10,20) - (1,2)]", "[9,19,8,18]\n"],
      ["[(1,2) == (2,1)]", "[false,true,true,false]\n"],
      ["[first(inputs) - first(inputs),inputs]", "[1,3]\n"],
      ['[false and error("x"),true or error("y")]', "[false,true]\n"],
      ["[(false,true) and (true,false)]", "[false,true,false]\n"],
      ['first((1,error("late")) // 3)', "1\n"],
      ['try (error("x") // 2) catch .', '"x"\n'],
      ['first((1,error("late")) + 2)', "3\n"],
      ["[.a // .b=5]", '[{"b":5}]\n'],
      ["(1,2)+empty", ""],
      ["[1+-2,2*-3,1e-2+2e-2]", "[-1,-6,0.03]\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
  } finally { bash.dispose(); }
});

test("jq parses arguments, file variables and string conversions with its input grammar", async () => {
  const bash = new RustWasmBash({ files: {"/workspace/bad": "[1,]", "/workspace/-": "1 2"} });
  try {
    for (const [args, code, stdout, stderr] of [
      ["-nc --argjson x '[1,]' '$x'", 2, "", "jq: invalid JSON for --argjson x\n"],
      ["-nc --jsonargs '$ARGS.positional' '[1,]'", 2, "", "jq: invalid JSON text passed to --jsonargs\n"],
      ["-nc --argjson x '+.5' '$x'", 0, "0.5\n", ""],
      ["-nc --slurpfile x bad '$x'", 2, "", "jq: Bad JSON in --slurpfile x bad: parse error: Expected another array element at line 1, column 4\n"],
      ["-nc --slurpfile x - '$x' <<< 99", 0, "[1,2]\n", ""],
      ["-Rsc fromjson bad", 5, "", "jq: error (at bad:0): Expected another array element at line 1, column 4 (while parsing '[1,]')\n"],
      [`-nc '"1 2 ]" | fromjson'`, 5, "", "jq: error (at <unknown>): Unexpected extra JSON values (while parsing '1 2 ]')\n"],
      [`-nc '"true" | tonumber'`, 5, "", 'jq: error (at <unknown>): string ("true") cannot be parsed as a number\n'],
      ["-nc '42 | fromjson'", 5, "", "jq: error (at <unknown>): number (42) only strings can be parsed\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], args);
    }
  } finally { bash.dispose(); }
});

test("jq preserves numeric literals independently when their doubles are equal", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [command, stdout] of [
      ["jq -c . <<< '[9007199254740992,9007199254740993,1.00,1e300,1e-999,-0.0]'", "[9007199254740992,9007199254740993,1.00,1E+300,1E-999,-0.0]\n"],
      ["jq -nc '[9007199254740993 == 9007199254740992,9007199254740993 > 9007199254740992,1e-999 > 0,1e-999 == 0]'", "[false,true,true,false]\n"],
      ["jq -nc '[1e20+0,1e-8+0,-1.200,-0.0]'", "[1e+20,1e-08,-1.2,-0]\n"],
      ["jq -nc '[range(1.0;3.0),limit(2.0;range(3))]'", "[1.0,2,0,1]\n"],
      ["jq -nc '[1.00|.,tonumber,abs,-.,.+0]'", "[1.00,1.00,1,-1,1]\n"],
      ["jq -nc '[[1.00]|add]'", "[1.00]\n"],
    ]) {
      const r = await bash.exec(command);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], command);
    }
  } finally { bash.dispose(); }
});

test("jq selects stream results for each nth argument and returns null for last(empty)", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["nth((0,2);range(4))", "0\n2\n"],
      ["[nth((0,1);inputs),inputs]", "[1,3,4]\n"],
      ["[1,2,3] | nth((-1,0.5,9))", "3\n1\nnull\n"],
      ['{x:42} | nth(("x","missing"))', "42\nnull\n"],
      ["nth(1.0;range(3))", "1\n"],
      ["last(empty)", "null\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3 4'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    for (const [filter, message] of [
      ["nth(-1;empty)", "nth doesn't support negative indices"],
      ["true | nth(2)", "Cannot index boolean with number"],
      ['[] | nth("x")', 'Cannot index array with string "x"'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`], filter);
    }
  } finally { bash.dispose(); }
});

test("jq emits every combination of object fields in order and replaces duplicate keys", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, values] of [
      ["{x:(1,2),y:(3,4)}", [{x:1,y:3}, {x:1,y:4}, {x:2,y:3}, {x:2,y:4}]],
      ["{x:empty}", []],
      ["{x:1,y:2,x:3}", [{x:3,y:2}]],
      ['{("a","b"):first(inputs)}', [{a:1}, {b:2}]],
      ['"key" as $x | {$x, $x:2}', [{x:"key",key:2}]],
      ['{"a\\tb":1, "x\\(1)":2}', [{"a\tb":1,x1:2}]],
      ['first({x:(1,error("late"))})', [{x:1}]],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, values.map(v => JSON.stringify(v) + "\n").join(""), ""], filter);
    }
    const r = await bash.exec("jq -nc '{(1):2}'");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", "jq: error (at <unknown>): object keys must be strings\n"]);
  } finally { bash.dispose(); }
});

test("jq ranges and limits stream numeric arguments and stop when their consumer stops", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["[range(0.5;3)]", "[0.5,1.5,2.5]\n"],
      ["[range((0,2);(2,4);2)]", "[0,0,2,2]\n"],
      ["[range(0;3;(1,2))]", "[0,1,2,0,2]\n"],
      ["[limit((1,2);range(4))]", "[0,0,1]\n"],
      ["[first(limit(100000000;range(1000000000)))]", "[0]\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    for (const [filter, message] of [
      ["limit(-1;1)", "limit requires a nonnegative integer"],
      ["limit(0.5;1)", "limit requires a nonnegative integer"],
      ['range("2")', "range requires numbers"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", `jq: error (at <unknown>): ${message}\n`]);
    }
  } finally { bash.dispose(); }
});

test("jq stops input generators after producing enough output and preserves results before errors", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/items": "1 2 3 4\n", "/workspace/good": "7 8" } });
  try {
    for (const [filter, stdout] of [
      ["[limit(1; inputs | select(.>2)),inputs]", "[3,4]\n"],
      ["def filtered: inputs|select(.>2); [first(filtered),inputs]", "[3,4]\n"],
      ["def by(f): inputs|select(f); [first(by(.>2)),inputs]", "[3,4]\n"],
      ["def f($x): $x; f(2)+f(3)", "5\n"],
      ["[limit(1;[inputs]),inputs]", "[[1,2,3,4]]\n"],
      ["(inputs | select(. > 1)) as $x | [$x,first(inputs)]", "[2,3]\n[4]\n"],
      ['try (1,error("bad")) catch "caught"', '1\n"caught"\n'],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' items`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], filter);
    }
    const error = await bash.exec(`jq -nc '1,error("bad")'`);
    assert.deepEqual([error.exitCode, error.stdout, error.stderr], [5, "1\n", "jq: error (at <unknown>): bad\n"]);
    const missing = await bash.exec("jq -nc inputs good missing");
    assert.deepEqual([missing.exitCode, missing.stdout, missing.stderr], [2, "7\n", "jq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"]);
  } finally { bash.dispose(); }
});

test("jq reports runtime errors at the input record and resumes at the next value", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/a": "1\n2\n", "/workspace/b": "3 4", "/workspace/x": "1 2 3\n", "/workspace/bad": "oops",
  } });
  try {
    for (const [args, code, stdout, stderr] of [
      ["-c 'error(\"bad\")' a b", 5, "", ["a:1", "a:2", "b:0", "b:0"].map(p => `jq: error (at ${p}): bad\n`).join("")],
      ["-c 'if .==2 then error({a:3}) else . end' x", 0, "1\n3\n", 'jq: error (at x:1): {"a":3}\n'],
      ["-ce 'if .==2 then error(\"bad\") else empty end' x", 4, "", "jq: error (at x:1): bad\n"],
      ["-nc '[inputs]' bad", 5, "", "jq: error (at bad:0): parse error: Invalid numeric literal at EOF at line 1, column 4\n"],
      ["-nc 'try inputs catch .' bad", 0, '"parse error: Invalid numeric literal at EOF at line 1, column 4"\n', ""],
      [String.raw`-nc 'error("a\rb\u001b")'`, 5, "", "jq: error (at <unknown>): a\\rb\\033\n"],
      ["-c 'error' a missing", 2, "", "jq: error (at a:1): 1\njq: error (at a:2): 2\njq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], args);
    }
  } finally { bash.dispose(); }
});

test("jq resynchronizes JSON sequences at record separators and preserves warnings", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [flags, text, stdout, stderr] of [
      ["", "123\n", "", ""],
      ["", "noise\n\x1e1\n\x1e2", "\x1e1\n", "jq: ignoring parse error: Potentially truncated top-level numeric value at EOF at line 3, column 2\n"],
      ["", "\x1e1\x1e[2]\n", "\x1e[2]\n", "jq: ignoring parse error: Potentially truncated top-level numeric value at line 1, column 3\n"],
      ["", "\x1e[1,\x1e3\n", "\x1e3\n", ""],
      ["", "\x1e[1\x1e3\n", "\x1e3\n", "jq: ignoring parse error: Truncated value at line 1, column 4\n"],
      ["", "\x1ebad\n\x1e{}\n", "\x1e{}\n", "jq: ignoring parse error: Invalid numeric literal at line 2, column 0 (need RS to resync)\n"],
      ["--stream-errors", "\x1e[1,]\n\x1e[2]\n", '\x1e[[0],1]\n\x1e["Expected another array element at line 1, column 5",[1]]\n\x1e[[0],2]\n\x1e[[0]]\n', ""],
    ]) {
      await bash.fs.writeFile("/workspace/data", new TextEncoder().encode(text));
      const r = await bash.exec(`jq -c --seq ${flags} . data`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, stderr], text);
    }
  } finally { bash.dispose(); }
});

test("jq emits JSON stream events before a container closes and reports parse errors at byte positions", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/prefix": "[10," } });
  try {
    const first = await bash.exec("jq -cn --stream 'first(inputs)' prefix missing");
    assert.deepEqual([first.exitCode, first.stdout, first.stderr], [0, "[[0],10]\n", ""]);
    for (const [flags, text, code, stdout, stderr] of [
      ["", "1 bad\n", 5, "1\n", "jq: parse error: Invalid numeric literal at line 2, column 0\n"],
      ["", "[1,]", 5, "", "jq: parse error: Expected another array element at line 1, column 4\n"],
      ["", '{"x":}', 5, "", "jq: parse error: Unmatched '}' at line 1, column 6\n"],
      ["", '"é\\q"', 5, "", "jq: parse error: Invalid escape at line 1, column 6\n"],
      ["", "[1", 5, "", "jq: parse error: Unfinished JSON term at EOF at line 1, column 2\n"],
      ["", "\ufeff2", 0, "2\n", ""],
      ["", "\ufeffbad", 5, "", "jq: parse error: Invalid numeric literal at EOF at line 1, column 3\n"],
      ["--stream", '{"x":[1,2],"x":3}', 0, '[["x",0],1]\n[["x",1],2]\n[["x",1]]\n[["x"],3]\n[["x"]]\n', ""],
      ["--stream-errors", "[1,]\n[2]\n", 0, '[[0],1]\n["Expected another array element at line 1, column 4",[1]]\n[[0],2]\n[[0]]\n', ""],
    ]) {
      await bash.fs.writeFile("/workspace/data", new TextEncoder().encode(text));
      const r = await bash.exec(`jq -c ${flags} . data`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], text);
    }
  } finally { bash.dispose(); }
});

test("jq opens input files on demand and shares a cursor with inputs", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/numbers": "10 20", "/workspace/start": "1", "/workspace/end": "2\n",
    "/workspace/a": "a\r\nb", "/workspace/b": "c\n",
  } });
  try {
    for (const [args, stdout] of [
      ["-nc 'if false then inputs else 5 end' missing", "5\n"],
      ["-nc 'def unused: inputs; 1' missing", "1\n"],
      ["-nc 'limit(0; inputs)' missing", ""],
      ["-nc 'first(inputs)' numbers missing", "10\n"],
      ["-c . start end", "12\n"],
      ["-Rc . a b", '"a\\r"\n"bc"\n'],
      ["-nc '[first(inputs),inputs]' - - <<< '1 2'", "[1,2]\n"],
      ["-nsc '[inputs]' </dev/null", "[[]]\n"],
      ["-nRsc '[inputs]' </dev/null", '[""]\n'],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""], args);
    }
    for (const [args, stdout] of [
      [". numbers missing", "10\n"],
      ["-nc 'try inputs catch 3' missing", ""],
      ["-nc 'first(inputs)' start missing", ""],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, stdout, "jq: ENOENT: no such file or directory, readStream '/workspace/missing'\n"], args);
    }
  } finally { bash.dispose(); }
});

test("jq evaluates each condition result and emits nothing for an empty condition", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, stdout] of [
      ["if (true,first(inputs)) then first(inputs) else 0 end", "1\n3\n"],
      ['first(if (true,error("late")) then 7 else 0 end)', "7\n"],
      ["if empty then 1 else 2 end", ""],
      ['if (true,false,true) then "a" elif (false,true) then "b" else "c" end', '"a"\n"c"\n"b"\n"a"\n'],
      ["if (null,true,false) then 9 end", "null\n9\nnull\n"],
    ]) {
      const r = await bash.exec(`jq -nc '${filter}' <<< '1 2 3'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, ""]);
    }
  } finally { bash.dispose(); }
});

test("jq keeps the first named argument and skips duplicate file operands", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/values": "42" } });
  try {
    for (const [args, expected] of [
      ["--arg x first --argjson x 2", "first"],
      ["--arg x first --rawfile x missing", "first"],
      ["--slurpfile x values --arg x second", [42]],
    ]) {
      const r = await bash.exec(`jq -nc ${args} '[$x,$ARGS.named]'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, JSON.stringify([expected, { x: expected }]) + "\n", ""]);
    }
    const r = await bash.exec("jq -nc --arg x first --argjson x nope '$x'");
    assert.deepEqual([r.exitCode, r.stderr], [2, "jq: invalid JSON for --argjson x\n"]);
  } finally { bash.dispose(); }
});

test("jq rejects invalid UTF-8 in program files before opening data files", async () => {
  const bash = new RustWasmBash({ files: { "/workspace/filter.jq": Uint8Array.of(34, 255, 34) } });
  try {
    const r = await bash.exec("jq -f filter.jq missing");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [3, "", "jq: program file is not valid UTF-8\n"]);
  } finally { bash.dispose(); }
});

test("jq emits exact JSON bytes for ASCII, indentation, color, and sequence options", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, expected] of [
      [String.raw`-nc '["\b","\f","\u007f"]'`, String.raw`["\b","\f","\u007f"]` + "\n"],
      [`-nrc --ascii-output '{"é":"😀"}'`, String.raw`{"\u00e9":"\ud83d\ude00"}` + "\n"],
      [String.raw`-na --raw-output0 '"\u0000"'`, '"\\u0000"\0'],
      [`-nc --indent 1 '{a:[1]}'`, '{\n "a": [\n  1\n ]\n}\n'],
      [`-nc --tab '{a:[]}'`, '{\n\t"a": []\n}\n'],
      [`-ncC '{a:[null]}'`, '\x1b[1;39m{\x1b[0m\x1b[1;34m"a"\x1b[0m\x1b[1;39m:\x1b[0m\x1b[1;39m[\x1b[0;90mnull\x1b[0m\x1b[1;39m\x1b[1;39m]\x1b[0m\x1b[1;39m\x1b[1;39m}\x1b[0m\n'],
      [`-ncMC '{a:[null]}'`, '{"a":[null]}\n'],
      [`-nr --seq '"abc",1'`, "abc\n\x1e1\n"],
    ]) {
      const r = await bash.exec(`jq ${args}`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], args);
    }
  } finally { bash.dispose(); }
});

test("jq reports undefined function signatures in unused definitions and branches", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, errors] of [
      ["if false then foo else bar(baz) end", [["foo/0", 14], ["bar/1", 23]]],
      ["def a: missing1; def b: missing2; missing3", [["missing2/0", 24], ["missing1/0", 7], ["missing3/0", 34]]],
      ["def f($x): $x; f(1;2)", [["f/2", 15]]],
      ["def unused: later; def later: 1; .", [["later/0", 12]]],
      ["(def local: 1; local), local", [["local/0", 23]]],
      ["empty | length(.)", [["length/1", 8]]],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing`);
      const diagnostic = errors.map(([call, offset]) =>
        `jq: error: ${call} is not defined at <top-level>, line 1:\n${filter}${" ".repeat(offset)}\n`
      ).join("") + `jq: ${errors.length} compile error${errors.length > 1 ? "s" : ""}\n`;
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", diagnostic]);
    }
    const r = await bash.exec(`jq -nc 'def f: 1; def apply(f): f; [f(), apply(f)]'`);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "[1,1]\n", ""]);
  } finally { bash.dispose(); }
});

test("jq compiles nested modules in their own scope before opening inputs", async () => {
  const bash = new RustWasmBash({ files: {
    "/workspace/lib/base.jq": 'def pair($a;$b): [$a,$b]; def tag: "m::tag";',
    "/workspace/lib/top.jq": 'include "base"; def run: pair(tag;42);',
    "/workspace/lib/loop.jq": 'include "loop";',
    "/workspace/lib/bad.jq": 'def f: $lost;',
    "/workspace/cwd.jq": 'def ignored: 1;',
  } });
  try {
    const result = await bash.exec(`jq -Llib -nc 'import "top" as m; [m::run,"m::tag",m::pair(3;4)]'`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '[["m::tag",42],"m::tag",[3,4]]\n', ""]);
    for (const [filter, diagnostic] of [
      ['$lost', 'undefined variable $lost at offset 5'],
      ['include "cwd"; .', 'module not found: cwd'],
      ['include "bad"; .', 'undefined variable $lost at offset 12'],
      ['include "../cwd"; .', 'invalid module path'],
      ['include "loop"; .', 'module dependency cycle: loop'],
    ]) {
      const r = await bash.exec(`jq -Llib '${filter}' /missing`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [3, "", `jq: ${diagnostic}\n`]);
    }
  } finally { bash.dispose(); }
});

test("jq validates complete string segments and decodes paired Unicode escapes", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, diagnostic] of [
      [String.raw`"abc\q"`, "invalid string at offset 0"],
      [String.raw`"\ud800"`, "invalid string at offset 0"],
      [String.raw`"\udc00"`, "invalid string at offset 0"],
      [String.raw`"x\(2)y\q"`, "invalid string at offset 5"],
      ['"abc' + "\\", "unterminated string or interpolation at offset 6"],
      ["[", "error: syntax error, unexpected end of file (Unix shell quoting issues?) at <top-level>, line 1:\n[\njq: 1 compile error"],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing-input`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", `jq: ${diagnostic}\n`]);
    }
    const result = await bash.exec(String.raw`jq -nc '["\ud83d\ude00","x\(2)\ud83d\ude00\b\f"]'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["😀", "x2😀\b\f"]);
  } finally { bash.dispose(); }
});

test("jq checks variable scope before reading input or evaluating branches", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, name, offset] of [
      ["$missing", "missing", 8], ["empty | $missing", "missing", 16], ["if false then $missing else 3 end", "missing", 23],
      ["(. as $x | $x), $x", "x", 18], ["def f($x): $x; $x", "x", 17],
      ["reduce .[] as $x ($x; .)", "x", 20], ['"😀\\($no)"', "no", 8],
    ]) {
      const result = await bash.exec(`jq '${filter}' /missing-input`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [3, "", `jq: undefined variable $${name} at offset ${offset}\n`]);
    }
    const scoped = await bash.exec(`jq -nc --arg x outer '[$x,(1 as $x | $x),$x,(reduce [2,3][] as $n (1; . * $n))]'`);
    assert.equal(scoped.stdout, '["outer",1,"outer",6]\n');
  } finally { bash.dispose(); }
});

test("jq resolves definitions by arity and evaluates filter arguments in their caller's scope", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [filter, value] of [
      ["def f: 1; def f(x): x+1; [$__def_f,f,f(4)]", ["user",1,5]],
      ["def f(g): \"inside\" as $x | [g, g]; \"outside\" as $x | f($x)", ["outside","outside"]],
      ["def step: .+1; def apply(step): 1|step; apply(step)", 2],
      ["def length: 9; [1,2] | length", 9],
    ]) {
      const result = await bash.exec(`jq --arg __def_f user -nc '${filter}'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), value);
    }
  } finally { bash.dispose(); }
});

test("jq env and $ENV read exported variables independently of jq arguments", async () => {
  const bash = new RustWasmBash();
  try {
    const init = "hidden=secret; declare -a a=(private); export __label=first; ";
    for (const [query, expected] of [
      ["jq -nc 'env | keys'", ["PWD", "__label"]],
      ["jq -nc '[env.__label,$ENV.__label,env.hidden,$ENV.a]'", ["first", "first", null, null]],
      [`jq --arg __label argument --arg ENV other -nc '[env.__label,$__label,$ENV]'`, ["first", "argument", "other"]],
      [`jq -nc 'def env: "overridden"; [env,$ENV.__label]'`, ["overridden", "first"]],
    ]) {
      const result = await bash.exec(init + query);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), expected);
    }
  } finally { bash.dispose(); }
});

test("commands receive exported scalar values without array elements or shell bookkeeping", async () => {
  const bash = new RustWasmBash();
  try {
    const init = "hidden=secret; export __shown=ok; declare -a items=(private); export items; ";
    for (const command of ["printenv", "env", "bash -c printenv"]) {
      const result = await bash.exec(init + command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), ["PWD=/workspace", "__shown=ok"]);
    }
    const restored = await bash.exec(init + "op environment snapshot create check >/dev/null; op environment snapshot restore check --shell bash");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.match(restored.stdout, /__shown/);
    assert.doesNotMatch(restored.stdout, /private|secret|hidden|items|BASH_COMMAND/);
    const result = await bash.exec(init + "printenv 'items[0]' items hidden");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal((await bash.exec(init + "envsubst <<< '$items/$hidden/$__shown'")).stdout, "//ok\n");
  } finally { bash.dispose(); }
});

test("double underscore variables survive exports, shell options and cold checkpoints", async () => {
  const bash = new RustWasmBash({ cwd: "/workspace", env: { __cwd: "cwd-value", __project: "initial" } });
  try {
    const session = bash.createSession();
    const first = await session.exec("export __project=demo; __attr__tag=r; tag=one; tag=two; __umask=text; __set_noexec=1; declare -a __items=([4]=four); echo ok");
    assert.equal(first.stdout, "ok\n");
    assert.equal(first.stderr, "");
    const state = JSON.parse(JSON.stringify(session.state));
    assert.equal(state.cwd, "/workspace");
    assert.equal(state.umask, 0o22);
    assert.equal(state.options.noexec, false);
    assert.equal(state.variables.__attr__tag, "r");
    assert.equal(state.variables.__umask, "text");
    assert.equal(state.exported.includes("__project"), true);
    assert.equal(Object.keys(state.variables).some(name => name.includes("\0")), false);
    const next = await bash.createSession(state).exec(`echo "$__cwd:$tag:\${__items[4]}"; bash -c 'printenv __project'`);
    assert.equal(next.stdout, "cwd-value:two:four\ndemo\n");
  } finally { bash.dispose(); }
});

test("JSON session checkpoints restore bindings without repeating filesystem writes", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    await session.exec("echo once >> /journal; set -- 'two words'; readonly fixed=yes; export KEEP=value; declare -a sparse=([4]=four); f() { echo ok; } > /function-output; export -f f; umask 027; false");
    const checkpoint = JSON.parse(JSON.stringify(session.state));
    await session.exec("EXTRA=gone; unset KEEP; set -- changed");
    session.state = checkpoint;
    for (const restored of [session, bash.createSession(checkpoint)]) {
      const result = await restored.exec('echo "$?:$KEEP:${EXTRA-unset}:$1:${sparse[4]}:$fixed"; bash -c f; cat /function-output /journal; umask');
      assert.equal(result.stdout, "1:value:unset:two words:four:yes\nok\nonce\n0027\n");
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.deepEqual(checkpoint.arrays.sparse.elements, {4: "four"});
    assert.deepEqual(checkpoint.readonlyVariables, ["fixed"]);
    assert.equal(checkpoint.umask, 0o27);
    assert.ok(!("rawHistory" in checkpoint));
  } finally { bash.dispose(); }
});

test("JavaScript and Rust can exchange cold session snapshots", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" });
  js.use(agentCommands());
  const rust = new RustWasmBash({ cwd: "/" });
  try {
    const setup = "export E=value; set -- 'two words'; readonly fixed=1; declare -i number=3; declare -A m=([foo]='bar baz'); declare -a sparse=([5]=a); f() { echo ok; } > /output; readonly -f f; export -f f; shopt -s nullglob; umask 027; false";
    const source = 'echo "$?:$E:$1:${m[foo]}:${sparse[5]}:$fixed"; number=2+3; echo "$number"; f; read -r line < /output; echo "$line"; umask';
    const snapshots = [];
    for (const [from, to] of [[js, rust], [rust, js]]) {
      const session = from.createSession();
      await session.exec(setup);
      const snapshot = JSON.parse(JSON.stringify(session.state));
      snapshots.push(snapshot);
      const restored = to.createSession(snapshot);
      const result = await restored.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "1:value:two words:bar baz:a:1\n5\nok\n0027\n");
    }
    for (const key of ["exported", "readonlyVariables", "exportedFunctions", "readonlyFunctions"]) {
      for (const s of snapshots) s[key].sort();
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
  } finally { await js.dispose(); rust.dispose(); }
});

test("session checkpoints retain associative key order and distinguish unassigned arrays", async () => {
  const bash = new RustWasmBash();
  try {
    const s = bash.createSession();
    await s.exec("declare -A kv=([z]=first [a]=next); declare -a vacant scalar; declare -a empty=()");
    assert.deepEqual(Object.keys(s.state.arrays.kv.elements), ["z", "a"]);
    assert.equal(s.state.arrays.vacant.assigned, false);
    assert.equal(s.state.arrays.empty.assigned, true);
    s.state = JSON.parse(JSON.stringify(s.state));
    assert.equal((await s.exec('echo "${!kv[@]}"; vacant=(); scalar=yes')).stdout, "z a\n");
    assert.equal(s.state.arrays.vacant.assigned, true);
    assert.deepEqual(s.state.arrays.scalar.elements, {0: "yes"});
  } finally { bash.dispose(); }
});

test("restored positional arguments and aliases honor the expansion byte limit", async () => {
  const bash = new RustWasmBash();
  try {
    const limits = { maxExpansionBytes: 5 };
    for (const bindings of [{ positionalParams: ["ab", "😀"] }, { aliases: { foo: "bar" } }]) {
      const s = bash.createSession({ cwd: "/", ...bindings });
      await assert.rejects(s.exec(": > /x", { limits }), { name: "ShellLimitError", limit: "maxExpansionBytes" });
      assert.equal((await bash.exec("test ! -e /x")).exitCode, 0);
    }
    const state = {cwd: "/", positionalParams: ["a", "😀"], aliases: {foo: "ok"}};
    assert.equal((await bash.exec(":", {state, limits})).exitCode, 0);
  } finally { bash.dispose(); }
});

test("session restore only parses function definitions and never runs legacy history", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession({ cwd: "/", functions: { bad: "echo wrong > /bad" } });
    assert.equal((await session.exec("command -v bad; test ! -e /bad")).exitCode, 0);
    assert.throws(() => bash.createSession({rawHistory: ["echo wrong > /bad"]}), /history/i);
    assert.equal((await bash.exec("test ! -e /bad")).exitCode, 0);
  } finally { bash.dispose(); }
});

test("session hooks can supply a checkpoint and observe the committed turn", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    assert.equal(session.state, undefined);
    const seen = [];
    const beforeExec = ({ source, options }) => {
      seen.push([source, options.cwd]);
      return {cwd: "/", variables: {FROM_HOOK: "yes"}};
    };
    const result = await session.exec('echo "$FROM_HOOK"', {
      cwd: "/workspace",
      hooks: { beforeExec, afterExec(state, res) { seen.push(["after", state === res.state]); } },
      onState(state, res) { seen.push(["state", state === session.state && state === res.state]); },
    });
    assert.equal(result.stdout, "yes\n");
    await session.exec(":", { hooks: { beforeExec } });
    assert.deepEqual(seen, [['echo "$FROM_HOOK"', "/workspace"], ["state", true], ["after", true]]);
    session.state = undefined;
    assert.equal((await session.exec('echo "${FROM_HOOK-unset}"')).stdout, "unset\n");
  } finally { bash.dispose(); }
});

test("session turns run in order across async hooks and recover after rejection", async () => {
  const bash = new RustWasmBash();
  try {
    const session = bash.createSession();
    let resume, entered;
    const gate = new Promise(resolve => { resume = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const first = session.exec("echo first >> /order", { hooks: { async afterExec() {
      entered();
      await gate;
      throw new Error("hook failed");
    } } });
    await started;
    const second = session.exec("echo second >> /order");
    await Promise.resolve();
    const beforeRelease = bash.readText("/order");
    resume();
    await assert.rejects(first, /hook failed/);
    await second;
    assert.equal(beforeRelease, "first\n");
    assert.equal(bash.readText("/order"), "first\nsecond\n");
  } finally { bash.dispose(); }
});

test("ordinary calls isolate shell state while sharing filesystem changes", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { BASE: "initial" }, directories: ["/work/sub"] });
  try {
    const r = await bash.exec('pwd; printf "%s" "$BASE" > file; export BASE=changed EXTRA=yes; f() { echo body; }; cd /', { cwd: "/work/sub", env: { BASE: "override" } });
    assert.equal(r.stdout, "/work/sub\n");
    assert.equal(r.cwd, "/");
    const next = await bash.exec('pwd; echo "$BASE/${EXTRA-unset}"; cat sub/file; command -v f');
    assert.equal(next.stdout, "/work\ninitial/unset\noverride");
    assert.equal(next.exitCode, 1);
  } finally { bash.dispose(); }
});

test("explicit sessions share files but start with separate shell state", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { BASE: "initial" } });
  try {
    const a = bash.createSession();
    const b = bash.createSession();
    await a.exec("export BASE=first; printf file > shared");
    assert.equal((await b.exec('echo "$BASE"; cat shared')).stdout, "initial\nfile");
    assert.equal((await bash.exec('echo "$BASE"')).stdout, "initial\n");
    assert.equal((await a.exec('echo "$BASE"')).stdout, "first\n");
  } finally { bash.dispose(); }
});

test("explicit sessions retain the working directory and environment resulting from each turn", async () => {
  const bash = new RustWasmBash({ cwd: "/work", env: { EXISTING: "base" }, directories: ["/work/sub"] });
  try {
    const session = bash.createSession();
    await session.exec("cd sub; export EXISTING=updated", { cwd: "/work", env: { EXISTING: "override", ADDED: "value" } });
    const next = await session.exec('pwd; echo "$EXISTING/$ADDED"');
    assert.equal(next.stdout, "/work/sub\nupdated/value\n");
  } finally { bash.dispose(); }
});

test("symbolic links validate the parent before mutation and report the failing operand", async () => {
  const bash = new RustWasmBash({deviceView: "provided", files: {"/locked/file": "keep"}, symlinks: {"/seed/link": "absent"}});
  try {
    const fs = bash.fs;
    await fs.chmod("/locked", 0o555);
    await assert.rejects(fs.symlink("x", "/missing/link"), {code: "ENOENT", syscall: "symlink", path: "/missing/link"});
    await assert.rejects(fs.stat("/missing"), {code: "ENOENT"});
    await assert.rejects(fs.symlink("x", "/locked/link"), {code: "EACCES"});
    await assert.rejects(fs.readlink("/missing/link"), {code: "ENOENT", syscall: "readlink"});
    await assert.rejects(fs.readlink("/locked/file"), {code: "EINVAL"});
    assert.equal(await fs.readlink("/seed/link"), "absent");
    const signal = AbortSignal.abort(new Error("cancelled"));
    await assert.rejects(fs.symlink("x", "/bad", {signal}), /cancelled/);
    await assert.rejects(fs.readlink("/seed/link", {signal}), /cancelled/);
    await assert.rejects(fs.lstat("/bad"), {code: "ENOENT"});
  } finally { bash.dispose(); }
});

test("gzip compresses repeated bytes and interoperates with an independent decoder", () => {
  const payload = Buffer.from("a repeatable log message\n".repeat(4096));
  const bash = new RustWasmBash({ files: { "/input": payload } });
  try {
    for (const level of [1, 6, 9]) {
      const result = bash.execSync(`gzip -${level}c /input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(gunzipSync(result.stdoutBytes), payload);
      assert.ok(result.stdoutBytes.length < payload.length / 8);
      assert.equal(result.stdoutBytes[8], level === 1 ? 4 : level === 9 ? 2 : 0);
    }
  } finally {
    bash.dispose();
  }
});

test("WASM Bash forceNative rejects incomplete long listings but preserves literal -l filenames", async () => {
  const bash = new RustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });
  await bash.fs.writeFile("/work/-l", "twelve bytes");
  for (const flags of ["-l", "-la", "-lh", "-g", "-o", "-n"]) {
    const result = await bash.exec(`ls ${flags} -- -l`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
  }
  const result = await bash.exec("ls -- -l");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "-l\n");
  bash.dispose();
});

test("WASM Bash forceNative executes compression codecs with genuine magic headers", async () => {
  const bash = new RustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf 'wasm-unit-test-payload\\n' > input.txt
    gzip -c input.txt > out.gz
    bzip2 -c input.txt > out.bz2
    xz -c input.txt > out.xz
    zstd -c input.txt > out.zst
    echo "OK"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout.trim(), "OK");

  const gz = await bash.fs.readFile("/work/out.gz");
  const bz2 = await bash.fs.readFile("/work/out.bz2");
  const xz = await bash.fs.readFile("/work/out.xz");
  const zst = await bash.fs.readFile("/work/out.zst");

  assert.deepEqual([...gz.slice(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual([...bz2.slice(0, 3)], [0x42, 0x5a, 0x68]);
  assert.deepEqual([...xz.slice(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
  assert.deepEqual([...zst.slice(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]);
});

test("WASM Bash forceNative writes genuine SQLite format 3 pages and supports nested timeout and op/gh", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const sqlRes = await bash.exec(`
    sqlite3 /work/test.db "CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'alpha'), (2, 'beta');"
    sqlite3 /work/test.db "SELECT id, v FROM t ORDER BY id;"
  `);
  assert.equal(sqlRes.exitCode, 0, sqlRes.stderr);
  assert.equal(sqlRes.stdout, "1|alpha\n2|beta\n");

  const dbBytes = await bash.fs.readFile("/work/test.db");
  assert.equal(new TextDecoder().decode(dbBytes.slice(0, 16)), "SQLite format 3\0");
  assert.equal(dbBytes.byteLength % 4096, 0);

  const timeoutRes = await bash.exec(
    `timeout 0.1s timeout 1s sh -c 'sleep 0.25; echo SHOULD_NOT_PRINT'`
  );
  assert.equal(timeoutRes.exitCode, 124);
  assert.equal(timeoutRes.stdout, "");

  const opGhRes = await bash.exec(`
    set -e
    which op gh
    op vault create DevVault > /dev/null
    op item create --vault DevVault --category login --title "App" "password=s3cr3t" > /dev/null
    op read "op://DevVault/App/password"
    gh repo create acme/demo > /dev/null
    gh issue create -R acme/demo -t "Bug" > /dev/null
    gh issue list -R acme/demo --json number | jq 'length'
  `);
  assert.equal(opGhRes.exitCode, 0, opGhRes.stderr);
  assert.equal(opGhRes.stdout, "/bin/op\n/bin/gh\ns3cr3t\n1\n");
});

test("WASM Bash forceNative enforces sleep validation, timeout --preserve-status, and -k kill-after", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/" });

  const badSleep = await bash.exec("sleep; echo ec=$?");
  assert.equal(badSleep.stdout.trim(), "ec=1");
  assert.match(badSleep.stderr, /sleep: missing operand/);

  const badInterval = await bash.exec("sleep not_a_duration; echo ec=$?");
  assert.equal(badInterval.stdout.trim(), "ec=1");
  assert.match(badInterval.stderr, /sleep: invalid time interval/);

  const preserve = await bash.exec("timeout --preserve-status -s INT 0.05s sleep 0.2");
  assert.equal(preserve.exitCode, 130);
});

test("WASM Bash forceNative supports op inject literal braces, file attachments, and secret masking", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    op vault create SecVault > /dev/null
    printf 'pem-payload-data' > /work/tls.pem
    op item create --vault SecVault --category login --title "Service" "password=top-secret-pw" 'tls\\.pem[file]=/work/tls.pem' > /dev/null
    echo "FILE=$(op read 'op://SecVault/Service/tls.pem')"
    printf 'escaped={{ "{{keep}}" }} val={{ op://SecVault/Service/password }}\\n' | op inject
    export SECRET_PW="op://SecVault/Service/password"
    op run -- sh -c 'echo "MASKED=$SECRET_PW"'
    op run --no-masking -- sh -c 'echo "RAW=$SECRET_PW"'
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.match(res.stdout, /FILE=pem-payload-data/);
  assert.match(res.stdout, /escaped=\{\{keep\}\} val=top-secret-pw/);
  assert.match(res.stdout, /MASKED=<concealed by 1Password>/);
  assert.match(res.stdout, /RAW=top-secret-pw/);
});

test("WASM Bash forceNative supports SQLite multi-page B-trees, recursive CTEs, and window functions", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    sqlite3 /work/multi.db "
      CREATE TABLE events (id INTEGER PRIMARY KEY, grp TEXT, val INT);
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 130)
      INSERT INTO events(id, grp, val)
      SELECT n, CASE WHEN n % 2 = 0 THEN 'even' ELSE 'odd' END, n FROM seq;
    "
    sqlite3 /work/multi.db "
      SELECT grp, COUNT(*), SUM(val), DENSE_RANK() OVER (ORDER BY SUM(val) DESC)
      FROM events
      GROUP BY grp
      ORDER BY SUM(val) DESC;
    "
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "even|65|4290|1\nodd|65|4225|2\n");

  const bytes = await bash.fs.readFile("/work/multi.db");
  assert.ok(bytes.byteLength >= 12288);
  assert.equal(bytes.byteLength % 4096, 0);
});

test("WASM Bash forceNative supports /dev/* devices, arrays, namerefs, process substitution, and traps", async () => {
  const bash = createRustWasmBash({ deviceView: "provided", forceNative: true, cwd: "/work" });
  bash.mountDevices();
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -euo pipefail
    trap 'echo "EXIT_TRAP_OK"' EXIT
    head -c 4 /dev/zero | xxd -p
    declare -A kv=([k1]="v1" [k2]="v2")
    target="kv[k2]"
    declare -n ref=target
    echo "NAMEREF=\${!target}"
    diff -u <(printf 'x\\ny\\n') <(printf 'x\\ny\\n')
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "00000000\nNAMEREF=v2\nEXIT_TRAP_OK\n");
});

test("WASM Bash forceNative executes tar compressed archives, jq, csvpy, bc, sed, awk, and dot", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf 'col,num\\na,12\\nb,30\\n' > data.csv
    tar -jcf data.tar.bz2 data.csv
    tar -Jcf data.tar.xz data.csv
    tar --zstd -cf data.tar.zst data.csv
    printf 'list(reader)\\nexit()\\n' | csvpy data.csv 2>/dev/null | grep -q "12"
    sum=$(awk -F, 'NR>1 {s+=$2} END {print s}' data.csv)
    doubled=$(echo "$sum * 2" | bc)
    jq -nc --arg d "$doubled" '{result: ($d|tonumber)}'
    echo 'digraph G { x -> y; }' | dot -Tsvg | grep -q '<svg' && echo "DOT_OK"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "{\"result\":84}\nDOT_OK\n");
});

test("in2csv admits JSON table storage under the shell memory limit", () => {
  const bash = new RustWasmBash({
    limits: { maxMemoryBytes: 4096 },
    files: { "/input.json": JSON.stringify(Array.from({ length: 128 }, (_, n) => ({ n }))) },
  });
  try {
    const r = bash.execSync("in2csv /input.json");
    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /memory budget/i);
    assert.equal(r.stdout, "");
    assert.equal(bash.execSync("echo ok").stdout, "ok\n");
  } finally {
    bash.dispose();
  }
});

test("WASM Bash forceNative enforces memoryFsOptions quotas and execution limits", async () => {
  const bash = createRustWasmBash({
    forceNative: true,
    cwd: "/work",
    memoryFsOptions: { maxFileBytes: 32, maxMetadataUnits: 6 },
    limits: { maxLoopIterations: 25 },
  });
  await bash.fs.mkdir("/work", { recursive: true });

  const bigWrite = await bash.exec("head -c 64 /dev/zero > /work/too_big.bin; echo ec=$?");
  assert.match(bigWrite.stdout, /ec=[1-9]/);

  await assert.rejects(() => bash.exec("i=0; while [ $i -lt 100 ]; do i=$((i + 1)); done"), /maxLoopIterations/);
});

test("WASM Bash forceNative supports env -i, -u, -C, and -S split-string execution", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work/sub", { recursive: true });

  const res = await bash.exec(`
    export KEEP="yes" DROP="no"
    env -u DROP -C /work/sub -S 'ONE=1 TWO=2 printenv KEEP ONE TWO'
    env -C /work/sub pwd
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "yes\n1\n2\n/work/sub\n");
});

test("WASM Bash forceNative supports gh pr list --state closed (including merged), release delete, variable, and label", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    gh repo create acme/svc > /dev/null
    gh pr create -R acme/svc -t "PR 1" -H feat-1 > /dev/null
    gh pr create -R acme/svc -t "PR 2" -H feat-2 > /dev/null
    gh pr merge 1 -R acme/svc --squash > /dev/null
    gh pr close 2 -R acme/svc > /dev/null
    echo "CLOSED_PRS=$(gh pr list -R acme/svc --state closed --json number | jq -c 'map(.number)')"
    gh release create v1.0.0 -R acme/svc -t "1.0.0" > /dev/null
    gh release delete v1.0.0 -R acme/svc --yes > /dev/null
    echo "RELEASES=$(gh release list -R acme/svc --json tagName | jq 'length')"
    gh variable set APP_MODE -b "prod" -R acme/svc > /dev/null
    echo "VAR=$(gh variable get APP_MODE -R acme/svc)"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "CLOSED_PRS=[2,1]\nRELEASES=0\nVAR=prod\n");
});

test("WASM Bash forceNative supports zip, unzip -l/-p, and apply_patch", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    printf "line1\nline2\n" > /work/target.txt
    apply_patch <<'PATCH' > /dev/null
*** Begin Patch
*** Update File: /work/target.txt
@@
 line1
-line2
+line2-patched
*** End Patch
PATCH
    zip -q /work/bundle.zip /work/target.txt
    unzip -p /work/bundle.zip work/target.txt
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "line1\nline2-patched\n");
});

test("WASM Bash forceNative supports sqlite3 -json formatting and WITH ... UPDATE correlated subqueries", async () => {
  const bash = createRustWasmBash({ forceNative: true, cwd: "/work" });
  await bash.fs.mkdir("/work", { recursive: true });

  const res = await bash.exec(`
    set -e
    sqlite3 /work/app.db "
      CREATE TABLE users (id INT, tag TEXT);
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2)
      INSERT INTO users SELECT n, 'u-' || n FROM seq;
      WITH patch(id, sfx) AS (VALUES (2, '-vip'))
      UPDATE users SET tag = tag || (SELECT sfx FROM patch WHERE patch.id = users.id)
      WHERE id IN (SELECT id FROM patch);
    "
    sqlite3 -json /work/app.db "SELECT id, tag FROM users ORDER BY id;"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "[{\"id\":1,\"tag\":\"u-1\"},\n{\"id\":2,\"tag\":\"u-2-vip\"}]\n"
  );
});

test("Wasm filesystem removes only entries admitted by rm, unlink and rmdir", async () => {
  const bash = new RustWasmBash({ files: { "/tree/keep": "data" } });
  const { fs } = bash;
  try {
    await assert.rejects(fs.rm("/tree"), { code: "EISDIR" });
    await assert.rejects(fs.unlink("/tree"), { code: "EISDIR" });
    await assert.rejects(fs.rmdir("/tree"), { code: "ENOTEMPTY" });
    await assert.rejects(fs.rmdir("/tree/keep"), { code: "ENOTDIR" });
    await assert.rejects(fs.rm("/tree/.", { recursive: true }), { code: "EINVAL" });
    await assert.rejects(fs.rm("/", { recursive: true }), { code: "EBUSY" });
    assert.equal(bash.readText("/tree/keep"), "data");
    await fs.symlink("/tree", "/alias");
    await fs.unlink("/alias");
    assert.equal(bash.readText("/tree/keep"), "data");
    await fs.rm("/tree", { recursive: true });
    await fs.rm("/tree", { force: true });
    await assert.rejects(fs.rm("/tree"), { code: "ENOENT" });
    await fs.mkdir("/empty");
    await fs.rmdir("/empty");
    await assert.rejects(fs.stat("/empty"), { code: "ENOENT" });
  } finally {
    bash.dispose();
  }
});

test("the default device directory merges null with backing files and is counted once by df", async () => {
  const bash = createRustWasmBash({ files: { "/dev/zero": "ordinary" }, symlinks: { "/discard": "/dev/null" } });
  try {
    const listed = await bash.exec("ls -A /dev; head -c 8 /dev/zero; printf 'discarded' > /discard; wc -c < /dev/null");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stdout, "null\nzero\nordinary0\n");
    const empty = createRustWasmBash();
    try {
      const usage = await empty.exec("df --output=iused,used /");
      assert.match(usage.stdout, /\b6\s+20\s*$/);
      const absent = await empty.exec("test -e /dev/random");
      assert.equal(absent.exitCode, 1);
    } finally { empty.dispose(); }
  } finally { bash.dispose(); }
});

test("provided devices preserve backing files and the mounted test devices remain readable", async () => {
  const provided = createRustWasmBash({ deviceView: "provided", files: { "/dev/null": "kept" } });
  const mounted = createRustWasmBash({ deviceView: "provided", files: { "/dev/hidden": "backing" } });
  mounted.mountDevices();
  try {
    const result = await provided.exec("cat /dev/null; printf updated > /dev/null; cat /dev/null");
    assert.equal(result.stdout, "keptupdated");
    const devices = await mounted.exec("ls /dev; head -c 2 /dev/zero | xxd -p");
    assert.equal(devices.stdout, "null\nrandom\nurandom\nzero\n0000\n");
  } finally { provided.dispose(); mounted.dispose(); }
});

test("random devices use the host entropy source and fail if it is unavailable", async t => {
  const bash = createRustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  try {
    const random = t.mock.method(globalThis.crypto, "getRandomValues", view => view.fill(0x5a));
    const read = await bash.exec("head -c 16 /dev/urandom");
    assert.equal(read.exitCode, 0, read.stderr);
    assert.deepEqual(read.stdoutBytes, new Uint8Array(16).fill(0x5a));
    assert.ok(random.mock.callCount() > 0);
    random.mock.mockImplementation(() => { throw new Error("entropy unavailable"); });
    const failed = await bash.exec("head -c 16 /dev/random");
    assert.notEqual(failed.exitCode, 0);
    assert.equal(failed.stdoutBytes.length, 0);
  } finally { bash.dispose(); }
});

test("Wasm fs.link retains inode identity and reports the failing operand", async () => {
  const bash = new RustWasmBash({deviceView:"provided", files:{"/src/f":"first", "/keep":"original"}, symlinks:{"/sym":"absent"}});
  const {fs} = bash;
  try {
    await fs.link("/src/f", "/alias");
    await fs.writeFile("/alias", "second");
    assert.equal(bash.readText("/src/f"), "second");
    assert.equal((await fs.stat("/src/f")).nlink, 2);
    await fs.link("/sym", "/alias-sym");
    assert.equal((await fs.lstat("/alias-sym")).ino, (await fs.lstat("/sym")).ino);
    assert.equal(await fs.readlink("/alias-sym"), "absent");
    await assert.rejects(fs.link("/missing", "/new"), {code:"ENOENT", syscall:"link", path:"/missing"});
    await assert.rejects(fs.link("/src/f", "/missing/new"), {code:"ENOENT", syscall:"link", path:"/missing/new"});
    await assert.rejects(fs.link("/src/f", "/keep"), {code:"EEXIST", path:"/src/f", dest:"/keep"});
    await assert.rejects(fs.link("/keep", "/new", {signal:AbortSignal.abort()}), {name:"AbortError"});
    await assert.rejects(fs.link("/keep", "/" + "é".repeat(128)), {code:"ENAMETOOLONG"});
    assert.equal(bash.readText("/keep"), "original");
    await fs.unlink("/alias");
    assert.equal((await fs.stat("/src/f")).nlink, 1);
  } finally { bash.dispose(); }
});

test("fs.link protects the default device view, rejects overlays and respects mount boundaries", async () => {
  const bash = new RustWasmBash({files:{"/file":"keep"}});
  const overlay = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    await assert.rejects(bash.fs.link("/absent", "/dev/null"), {code:"EBUSY", path:"/dev/null"});
    await assert.rejects(overlay.fs.link("/absent", "/new"), {code:"ENOTSUP", syscall:"overlay", path:"/new"});
    bash.mountDevices();
    await assert.rejects(bash.fs.link("/dev/null", "/new"), {code:"EXDEV", dest:"/new"});
    await assert.rejects(bash.fs.link("/file", "/dev"), {code:"EBUSY", dest:"/dev"});
    await assert.rejects(bash.fs.link("/dev/null", "/dev/new"), {code:"ENOTSUP", dest:"/dev/new"});
  } finally { overlay.dispose(); bash.dispose(); }
});

test("Wasm rename moves entries and preserves both paths on failure", async () => {
  const bash = new RustWasmBash({ files: { "/src/file": "source", "/other": "keep" } });
  const fs = bash.fs;
  try {
    await fs.chmod("/src/file", 0o640);
    await fs.symlink("missing", "/src/link");
    await fs.rename("/src/file", "/src/file");
    assert.equal(bash.readText("/src/file"), "source");
    await assert.rejects(fs.rename("/src/file", "/other", { noReplace: true }), { code: "EEXIST" });
    await assert.rejects(fs.rename("/src", "/src/child"), { code: "EINVAL" });
    await assert.rejects(fs.rename("/src/file", "/other", { signal: AbortSignal.abort() }), { name: "AbortError" });
    assert.equal(bash.readText("/other"), "keep");
    await fs.rename("/src", "/moved");
    assert.equal(bash.readText("/moved/file"), "source");
    assert.equal((await fs.stat("/moved/file")).mode & 0o777, 0o640);
    await fs.rename("/moved/link", "/other");
    assert.equal(await fs.readlink("/other"), "missing");
    await assert.rejects(fs.lstat("/src"), { code: "ENOENT" });
  } finally {
    bash.dispose();
  }
});

test("overlay rename moves the merged tree without resurrecting hidden children", async () => {
  const bash = new RustWasmBash({
    profile: "overlay-cow-fs",
    files: { "/dir/a": "lower", "/dir/nested/b": "child", "/dir/deleted": "hidden", "/target/old": "old" },
  });
  const fs = bash.fs;
  try {
    await fs.writeFile("/dir/a", "upper");
    await fs.unlink("/dir/deleted");
    await fs.unlink("/target/old");
    await fs.symlink("missing", "/dir/link");
    await assert.rejects(fs.rename("/dir", "/target", { noReplace: true }), { code: "EEXIST" });
    await fs.rename("/dir", "/target");
    assert.equal(bash.readText("/target/a"), "upper");
    assert.equal(bash.readText("/target/nested/b"), "child");
    assert.equal(await fs.readlink("/target/link"), "missing");
    for (const path of ["/dir", "/target/deleted", "/target/old"]) {
      await assert.rejects(fs.lstat(path), { code: "ENOENT" });
    }
  } finally {
    bash.dispose();
  }
});

test("rename preserves hard links and rejects moves across a mount", async () => {
  const bash = new RustWasmBash({ files: { "/dir/file": "source", "/other": "target" } });
  const fs = bash.fs;
  try {
    assert.equal(bash.execSync("ln /dir/file /alias; ln /other /saved").exitCode, 0);
    await fs.rename("/dir", "/tree");
    await fs.rename("/tree/file", "/alias");
    await fs.rename("/tree/file", "/other");
    assert.equal(bash.readText("/alias"), "source");
    assert.equal(bash.readText("/saved"), "target");
    bash.mountDevices();
    await assert.rejects(fs.rename("/other", "/dev/new"), { code: "EXDEV" });
    await assert.rejects(fs.rename("/other/../other", "/alias"), { code: "ENOTDIR" });
    await fs.rename("/other", "/renamed");
    assert.equal(bash.readText("/alias"), "source");
  } finally {
    bash.dispose();
  }
});

test("realpath walks links before parent components and stays inside a mount", async () => {
  const bash = new RustWasmBash({files:{"/tree/sub/file":"data"}});
  const fs = bash.fs;
  try {
    await fs.symlink("/tree/sub", "/alias");
    assert.equal(await fs.realpath("/alias/../sub/file"), "/tree/sub/file");
    assert.equal(await fs.realpath("alias"), "/tree/sub");
    await assert.rejects(fs.realpath("/missing/../tree"), {code:"ENOENT"});
    await assert.rejects(fs.realpath("/tree/sub/file/"), {code:"ENOTDIR"});
    await fs.symlink("/cycle", "/cycle");
    await assert.rejects(fs.realpath("/cycle"), {code:"ELOOP"});
    bash.mountDevices();
    await fs.symlink("/dev", "/through");
    await assert.rejects(fs.realpath("/through/null"), {code:"EACCES"});
    assert.equal(await fs.realpath("/dev/."), "/dev");
  } finally { bash.dispose(); }
});

test("copyFile preserves destinations on failed copies and applies the source mode", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files: {"/dir/source": {content:"bytes",mode:0o640}, "/dest": {content:"keep",mode:0o600}}});
    const fs = bash.fs;
    try {
      await fs.symlink("/dir/source", "/same");
      await fs.symlink("dest", "/alias");
      await fs.symlink("new", "/dangling");
      await assert.rejects(fs.copyFile("/dir/source", "/alias", {exclusive:true}), {code:"EEXIST"});
      await assert.rejects(fs.copyFile("/dir/source", "/dangling", {exclusive:true}), {code:"EEXIST"});
      if (profile === "overlay-cow-fs") {
        // These links belong to the upper layer, while both targets still live only below.
        await assert.rejects(fs.copyFile("/dir/source", "/same"), {code:"ENOENT"});
        await assert.rejects(fs.copyFile("/same", "/alias"), {code:"ENOENT"});
        assert.equal(bash.readText("/dest"), "keep");
        await fs.writeFile("/dir/source", "bytes");
        await fs.writeFile("/dest", "keep");
      }
      await assert.rejects(fs.copyFile("/dir/source", "/same"), {code:"EINVAL"});
      await assert.rejects(fs.copyFile("/dir/source", "/missing/file"), {code:"ENOENT"});
      await assert.rejects(fs.copyFile("/dir/source", "/dest", {signal:AbortSignal.abort()}), {name:"AbortError"});
      assert.equal(bash.readText("/dest"), "keep");
      await fs.copyFile("/same", "/alias");
      assert.equal(bash.readText("/dest"), "bytes");
      assert.equal((await fs.lstat("/dest")).mode & 0o777, 0o640);
      assert.equal(await fs.readlink("/alias"), "dest");
      if (profile) {
        await assert.rejects(fs.copyFile("/same", "/dangling"), {code:"ENOENT"});
        await fs.copyFile("/same", "/new");
      } else {
        await fs.copyFile("/same", "/dangling");
      }
      assert.equal(bash.readText("/new"), "bytes");
      await fs.chmod("/dest", 0o400);
      await assert.rejects(fs.copyFile("/same", "/dest"), {code:"EACCES"});
    } finally {
      bash.dispose();
    }
  }
});

test("writeFile honors exclusive creation, append, permissions and cancellation", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/keep":{content:"old",mode:0o640}}});
    const fs = bash.fs;
    try {
      for (const flag of ["wx", "ax"]) {
        await assert.rejects(fs.writeFile("/keep", "lost", {flag}), {code:"EEXIST"});
      }
      assert.equal(bash.readText("/keep"), "old");
      const accessed = (await fs.stat("/keep")).atimeMs;
      now += 60_000;
      await fs.writeFile("/keep", "!", {flag:"a",mode:0o400});
      assert.equal((await fs.stat("/keep")).atimeMs, accessed);
      assert.equal(bash.readText("/keep"), "old!");
      assert.equal((await fs.stat("/keep")).mode & 0o777, 0o640);
      await fs.symlink("new", "/link");
      await assert.rejects(fs.writeFile("/link", "no", {flag:"wx"}), {code:"EEXIST"});
      if (profile) {
        await assert.rejects(fs.writeFile("/link", "first", {flag:"a"}), {code:"ENOENT"});
        await fs.writeFile("/new", "first", {flag:"ax",mode:0o400});
      } else {
        await fs.writeFile("/link", "first", {flag:"a",mode:0o400});
      }
      assert.equal(bash.readText("/new"), "first");
      await assert.rejects(fs.writeFile("/new", "bad"), {code:"EACCES"});
      await assert.rejects(fs.writeFile("/missing/file", "bad"), {code:"ENOENT"});
      await assert.rejects(fs.writeFile("/keep", "bad", {flag:"r"}), {code:"EINVAL"});
      await assert.rejects(fs.writeFile("/keep", "bad", {mode:0o10000}), {code:"EINVAL"});
      await assert.rejects(fs.writeFile("/keep", "bad", {signal:AbortSignal.abort()}), {name:"AbortError"});
      assert.equal(bash.readText("/keep"), "old!");
      await fs.writeFile("/plain", "created");
      assert.equal((await fs.stat("/plain")).mode & 0o777, 0o666);
    } finally { bash.dispose(); }
  }
});

test("a memory file write publishes its mode and timestamps together", async t => {
  let tick = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => ++tick);
  const bash = new RustWasmBash();
  try {
    for (const flag of ["wx", "a", "w"]) {
      await bash.fs.writeFile("/f", "data", {flag, mode:0o620});
      const {mode, mtimeMs, ctimeMs} = await bash.fs.stat("/f");
      assert.equal(mode & 0o777, 0o620);
      assert.equal(ctimeMs, mtimeMs);
    }
  } finally { bash.dispose(); }
});

test("companion replay uses the original working directory after exec options change", async () => {
  const companion = new RustWasmBash({ directories: ["/other"] });
  const bash = new RustWasmBash({ forceNative: false, companionFactory: () => companion });
  try {
    const options = {};
    assert.equal((await bash.exec("mkdir created", options)).exitCode, 0);
    options.cwd = "/other";
    await bash.fs.realpath("/");
    assert.equal((await companion.fs.stat("/workspace/created")).type, "directory");
    await assert.rejects(companion.fs.stat("/other/created"), { code: "ENOENT" });
  } finally { bash.dispose(); companion.dispose(); }
});

test("failed chmod does not poison the next companion call", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    await assert.rejects(bash.fs.chmod("/missing", 0o644), {code:"ENOENT"});
    await bash.fs.writeFile("/after", "ok");
    assert.equal(await bash.fs.realpath("/after"), "/after");
  } finally { bash.dispose(); }
});

test("companion replay keeps admitted removal flags and file timestamps", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    const controller = new AbortController();
    const removal = {recursive:true, signal:controller.signal};
    await bash.fs.mkdir("/tree");
    await bash.fs.writeFile("/tree/file", "");
    await bash.fs.rm("/tree", removal);
    removal.recursive = false;
    controller.abort();
    const when = new Date(12345);
    await bash.fs.writeFile("/keep", "");
    await bash.fs.utimes("/keep", when, when);
    when.setTime(0);
    await bash.fs.realpath("/");
    await assert.rejects(companion.fs.stat("/tree"), {code:"ENOENT"});
    const stat = await companion.fs.stat("/keep");
    assert.equal(stat.atimeMs, 12345);
    assert.equal(stat.mtimeMs, 12345);
  } finally { bash.dispose(); }
});

test("companion replay retains only completed writes and their original bytes and options", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    const controller = new AbortController();
    const options = {flag:"wx", mode:0o600, signal:controller.signal};
    const bytes = Buffer.from("original");
    await bash.fs.writeFile("/created", bytes, options);
    const appended = Uint8Array.of(33);
    await bash.fs.appendFile("/created", appended, { signal: controller.signal });
    appended.fill(0);
    bytes.fill(0);
    options.mode = 0o400;
    controller.abort();
    await assert.rejects(bash.fs.writeFile("/created", "bad", {flag:"ax"}), {code:"EEXIST"});
    await bash.fs.realpath("/created");
    assert.equal(companion.readText("/created"), "original!");
    await bash.fs.appendFile("/created", "?");
    assert.equal(companion.readText("/created"), "original!?");
    assert.equal((await companion.fs.stat("/created")).mode & 0o777, 0o600);
  } finally { bash.dispose(); companion.dispose(); }
});

test("constructor seeds use the same creation mode as fs.writeFile", async () => {
  const bash = new RustWasmBash({files:{
    "/nested/text":"hello", "/bytes":new Uint8Array([42]), "/object":{content:"value"},
    "/private":{content:"secret",mode:0o600},
  }});
  try {
    for (const path of ["/nested/text", "/bytes", "/object"]) {
      assert.equal((await bash.fs.stat(path)).mode & 0o777, 0o666, path);
    }
    assert.equal((await bash.fs.stat("/private")).mode & 0o777, 0o600);
  } finally { bash.dispose(); }
});

test("readFile enforces read and directory search permissions, byte caps, and aborts", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/dir/file":"data", "/secret":{content:"hidden",mode:0o200}}, symlinks:{"/alias":"secret"}});
    const fs = bash.fs;
    try {
      for (const path of ["/secret", "/alias"]) {
        await assert.rejects(fs.readFile(path), {name:"FsError",code:"EACCES",syscall: profile === "overlay-cow-fs" ? "overlay" : "readFile",path: profile === "overlay-cow-fs" ? "/secret" : path});
      }
      await assert.rejects(fs.readFile("/dir"), {code:"EISDIR"});
      await assert.rejects(fs.readFile("/dir/file", {maxBytes:3}), {code:"EFBIG"});
      await assert.rejects(fs.readFile("/dir/file", {maxBytes:-1}), {code:"EINVAL"});
      await assert.rejects(fs.readFile("/missing", {maxBytes:-1}), {code:profile ? "ENOENT" : "EINVAL"});
      await assert.rejects(fs.readFile("/secret", {maxBytes:-1}), {code:profile === "overlay-cow-fs" ? "EACCES" : "EINVAL"});
      await assert.rejects(fs.readFile("/dir/file", {signal:AbortSignal.abort()}), {name:"AbortError"});
      for (const maxBytes of [4, Infinity]) {
        assert.deepEqual(await fs.readFile("/dir/file", {maxBytes}), new TextEncoder().encode("data"));
      }
      await fs.chmod("/dir", 0o600);
      await assert.rejects(fs.readFile("/dir/file"), {code:"EACCES"});
    } finally { bash.dispose(); }
  }
});


test("mounted streams without EOF cannot be read as whole files", async () => {
  const bash = new RustWasmBash({deviceView:"provided"});
  try {
    bash.mountDevices();
    for (const name of ["zero", "urandom", "random"]) {
      await assert.rejects(bash.fs.readFile("/dev/" + name, {maxBytes:4}), {code:"EFBIG"});
    }
    assert.deepEqual(await bash.fs.readFile("/dev/null", {maxBytes:0}), new Uint8Array());
    await assert.rejects(bash.fs.readFile("/dev/null", {maxBytes:Infinity}), {code:"EINVAL"});
  } finally { bash.dispose(); }
});

test("the strict budget profile mounts the virtual devices used by production", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev"});
  try {
    assert.equal((await bash.exec("ls /dev; head -c 80 /dev/zero | wc -c")).stdout, "null\nrandom\nurandom\nzero\n80\n");
    await bash.fs.writeFile("/dev/null", "discard");
    assert.equal((await bash.fs.readFile("/dev/null")).length, 0);
    await assert.rejects(bash.fs.writeFile("/dev/urandom", "denied"), {code:"EPERM"});
  } finally { bash.dispose(); }
});

test("stat identifies aliases, renames and replacements within one filesystem", async () => {
  const a = new RustWasmBash({files:{"/original":"value"}});
  const b = new RustWasmBash({files:{"/original":"other"}});
  try {
    const key = st => [st.identityScope, st.dev, st.ino];
    const original = await a.fs.stat("/original");
    assert.equal(typeof original.identityScope, "symbol");
    assert.ok(Number.isSafeInteger(original.dev) && Number.isSafeInteger(original.ino));
    assert.notEqual((await b.fs.stat("/original")).identityScope, original.identityScope);
    await a.fs.symlink("/original", "/link");
    assert.deepEqual(key(await a.fs.stat("/link")), key(original));
    assert.notDeepEqual(key(await a.fs.lstat("/link")), key(original));
    await a.fs.rename("/original", "/renamed");
    assert.deepEqual(key(await a.fs.stat("/renamed")), key(original));
    await a.fs.writeFile("/original", "replacement");
    assert.notDeepEqual(key(await a.fs.stat("/original")), key(original));
  } finally { a.dispose(); b.dispose(); }
});

test("overlay reads verify each followed link against the layer that owns it", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/lower/file":"value"}});
  const {fs} = bash;
  try {
    const alias = "/a:b'c";
    await fs.symlink("lower", alias);
    assert.equal((await fs.lstat(alias)).type, "symlink");
    for (const op of ["stat", "readFile", "readdir", "realpath"]) {
      await assert.rejects(fs[op](alias + "/file"), {code:"ENOENT", syscall:"realpath", path:alias + "/file"});
    }
    await assert.rejects(fs.lstat(alias + "/file"), {code:"ENOENT", syscall:"realpath", path:alias});
    await fs.writeFile("/lower/file", "upper");
    assert.equal(new TextDecoder().decode(await fs.readFile(alias + "/file")), "upper");
  } finally { bash.dispose(); }
});

test("memory overlay directory scopes distinguish siblings and keep symlink aliases together", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/src/dir/file":"data"}, symlinks:{"/alias":"/src/dir"}});
  try {
    const parent = await bash.fs.stat("/src"), child = await bash.fs.stat("/src/dir");
    assert.notEqual(parent.identityScope, child.identityScope);
    assert.equal((await bash.fs.stat("/alias")).identityScope, child.identityScope);
    assert.notEqual((await bash.fs.lstat("/alias")).identityScope, child.identityScope);
    const r = await bash.exec("cp -Rx /src /copy");
    assert.equal(r.exitCode, 0, r.stderr);
    assert.deepEqual(await bash.fs.readdir("/copy/dir"), []);
    await bash.fs.chmod("/src", 0o750);
    await bash.fs.writeFile("/src/dir/new", "upper");
    for (const [path, before] of [["/src", parent], ["/src/dir", child]]) {
      const after = await bash.fs.stat(path);
      assert.deepEqual([after.identityScope, after.dev, after.ino], [before.identityScope, before.dev, before.ino]);
    }
    await bash.fs.rename("/src", "/moved");
    assert.notEqual((await bash.fs.stat("/moved")).identityScope, parent.identityScope);

  } finally { bash.dispose(); }
});

test("stat and lstat resolve parents before '..' and report inaccessible entries", async () => {
  const bash = new RustWasmBash({files:{"/tree/sub/file":"data", "/tree/x":"nested", "/x":"root"}, symlinks:{"/alias":"tree/sub"}});
  try {
    for (const op of ["stat", "lstat"]) {
      assert.equal((await bash.fs[op]("/alias/../x")).ino, (await bash.fs.stat("/tree/x")).ino);
      for (const [path, code] of [["/missing/../x","ENOENT"], ["/x/","ENOTDIR"]]) {
        await assert.rejects(bash.fs[op](path), {name:"FsError",syscall:op,path,code});
      }
      await assert.rejects(bash.fs[op]("/x", {signal:AbortSignal.abort()}), {name:"AbortError"});
    }
    await bash.fs.chmod("/tree", 0o600);
    await assert.rejects(bash.fs.lstat("/tree/sub/file"), {code:"EACCES",syscall:"lstat"});
    bash.mountDevices();
    assert.equal((await bash.fs.stat("/dev/zero")).type, "character");
    await assert.rejects(bash.fs.stat("missing"), {code:"ENOENT",syscall:"stat",path:"/missing"});
  } finally { bash.dispose(); }
});

test("open descriptors retain the file across rename, unlink, and replacement", async () => {
  const bash = new RustWasmBash({files:{"/entry":"first"}});
  const fs = bash.fs;
  try {
    const reader = await fs.open("/entry", {access:"read"});
    const writer = await fs.open("/entry", {access:"readwrite"});
    const original = await reader.stat();
    await fs.rename("/entry", "/renamed");
    await fs.writeFile("/entry", "replacement");
    await fs.writeFile("/renamed", "changed");
    await fs.unlink("/renamed");
    assert.equal(await writer.write(Buffer.from("!"), 7), 1);
    assert.equal(await writer.getPosition(), 0);
    const buf = Buffer.alloc(16, 63);
    assert.equal(await reader.read(buf, null), 8);
    assert.equal(buf.toString(), "changed!????????");
    assert.equal(await reader.getPosition(), 8);
    assert.equal((await reader.stat()).ino, original.ino);
    assert.equal((await reader.stat()).nlink, 0);
    assert.equal(await reader.read(buf, null), 0);
    await writer.truncate(2);
    assert.equal((await reader.stat()).size, 2);
    assert.equal(bash.readText("/entry"), "replacement");
    await assert.rejects(reader.write(buf, null), {code:"EBADF"});
    await reader.close();
    await assert.rejects(reader.read(buf, 0), {code:"EBADF"});
    await writer.close();
  } finally { bash.dispose(); }
});

test("descriptor append, sparse writes, cancellation and close preserve cursor ordering", async () => {
  const bash = new RustWasmBash({files:{"/entry":"a"}, symlinks:{"/link":"entry"}});
  try {
    const fs = bash.fs;
    await assert.rejects(fs.open("/link", {access:"write",creation:"exclusive"}), {code:"EEXIST"});
    await assert.rejects(fs.open("/link", {access:"read",noFollow:true}), {code:"ELOOP"});
    const fd = await fs.open("/entry", {access:"readwrite", append:true});
    await fs.writeFile("/entry", "ab");
    await assert.rejects(fd.write(Buffer.from("x"), 0), {code:"EINVAL"});
    assert.equal(await fd.write(Buffer.from("c"), null), 1);
    assert.equal(await fd.getPosition(), 3);
    const controller = new AbortController();
    const first = fd.write(Buffer.from("d"), null);
    const skipped = fd.write(Buffer.from("x"), null, {signal:controller.signal});
    controller.abort();
    const closed = fd.close();
    assert.equal(await first, 1);
    await assert.rejects(skipped, {name:"AbortError"});
    await closed;
    assert.equal(bash.readText("/entry"), "abcd");

    const sparse = await fs.open("/new", {access:"readwrite",creation:"exclusive",mode:0o600});
    await sparse.write(Buffer.from("z"), 3);
    assert.deepEqual([...await fs.readFile("/new")], [0,0,0,122]);
    assert.equal(await sparse.getPosition(), 0);
    await sparse.close();
  } finally { bash.dispose(); }
});

test("mounted descriptors distinguish seekable files from streams and overlay admission", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev"});
  const overlay = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    await assert.rejects(overlay.fs.open("/absent", {}), {code:"ENOTSUP"});
    await assert.rejects(bash.fs.open("/dev/missing", {access:"readwrite",creation:"ifMissing",noFollow:true}), {code:"ENOTSUP"});
    const fd = await bash.fs.open("/dev/zero", {access:"readwrite"});
    const buf = Buffer.alloc(65537, 0xff);
    assert.equal(await fd.read(buf, null), buf.length);
    assert.equal(await fd.getPosition(), buf.length);
    assert.equal(await fd.probeRead(), "ready");
    assert.ok(buf.every(b => b === 0));
    await fd.close();
    const random = await bash.fs.open("/dev/urandom", {access:"write"});
    await assert.rejects(random.write(new Uint8Array(), null), {code:"EPERM"});
    await random.close();
  } finally { bash.dispose(); overlay.dispose(); }
});

test("mv unlinks the source only after a successful cross-device write", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", files:{"/file":"keep", "/tree/a":"child"}});
  try {
    const reader = await bash.fs.open("/file", {access:"read"});
    for (const [args, error] of [
      ["/file/ /dev/null", "ENOTDIR: not a directory, rename '/file/' -> '/dev/null'"],
      ["/file /dev/missing/new", "ENOENT: no such file or directory, rename '/file' -> '/dev/missing/new'"],
      ["-b /file /dev/null", "ENOTSUP: operation not supported, rename '/dev/null' -> '/dev/null~'"],
      ["/dev/missing /dev/new", "ENOENT: no such file or directory, rename '/dev/missing' -> '/dev/new'"],
    ]) {
      const failed = await bash.exec("mv " + args);
      assert.equal(failed.stderr, "mv: " + error + "\n");
      assert.equal(bash.readText("/file"), "keep");
    }
    const rejected = await bash.exec("mv /file /dev/urandom");
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stderr, "mv: EPERM: operation not permitted, writeStream '/dev/urandom'\n");
    assert.equal(bash.readText("/file"), "keep");
    assert.equal((await bash.exec("mv -n /file /dev/new")).exitCode, 1);
    assert.equal((await bash.exec("mv /tree /dev/null")).exitCode, 1);
    assert.equal(bash.readText("/tree/a"), "child");
    const moved = await bash.exec("mv -v /file /dev/null");
    assert.equal(moved.stdout, "renamed '/file' -> '/dev/null'\n");
    assert.equal(moved.exitCode, 0, moved.stderr);
    await assert.rejects(bash.fs.stat("/file"), {code:"ENOENT"});
    const buf = Buffer.alloc(4);
    assert.equal(await reader.read(buf, null), 4);
    assert.equal(buf.toString(), "keep");
    await reader.close();
  } finally { bash.dispose(); }
});

test("seed directories and implicit parents use the production memory filesystem modes", async () => {
  const bash = new RustWasmBash({cwd:"/project/work", directories:["/seed/deep"], files:{"/nested/files/a":"data"}});
  try {
    assert.equal((await bash.fs.stat("/")).mode & 0o7777, 0o755);
    for (const dir of ["/workspace", "/project", "/project/work", "/seed", "/seed/deep", "/nested", "/nested/files"]) {
      assert.equal((await bash.fs.stat(dir)).mode & 0o7777, 0o777, dir);
    }
  } finally { bash.dispose(); }
});

test("mkdir -p applies the shell umask to new parents and -m to the final directory", async () => {
  const bash = new RustWasmBash({directories:["/existing"]});
  try {
    const result = await bash.exec("umask 077; mkdir -pm 750 /existing/private/leaf");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await bash.fs.stat("/existing/private")).mode & 0o7777, 0o700);
    assert.equal((await bash.fs.stat("/existing/private/leaf")).mode & 0o7777, 0o750);
    assert.equal((await bash.fs.stat("/existing")).mode & 0o7777, 0o777);
  } finally { bash.dispose(); }
});

test("fs.mkdir creates only requested entries, respects search permissions and preserves existing modes", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, directories:["/keep"], files:{"/file":"data"}, symlinks:{"/alias":"/keep","/dang":"missing/dir"}});
    const fs = bash.fs;
    try {
      await assert.rejects(fs.mkdir("/absent/leaf"), {code:"ENOENT", path:profile === "overlay-cow-fs" ? "/absent" : "/absent/leaf", syscall:profile === "overlay-cow-fs" ? "overlay" : "mkdir"});
      await assert.rejects(fs.stat("/absent"), {code:"ENOENT"});
      await assert.rejects(fs.mkdir("/keep", {mode:0}), {code:"EEXIST"});
      await fs.mkdir("/keep", {recursive:true, mode:0});
      assert.equal((await fs.stat("/keep")).mode & 0o777, 0o777);
      await fs.mkdir("/new/child", {recursive:true, mode:0o710});
      for (const path of ["/new","/new/child"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o710);
      await assert.rejects(fs.mkdir("/file", {recursive:true}), {code:"EEXIST"});
      await assert.rejects(fs.mkdir("/file/", {recursive:true}), {code:"ENOTDIR"});
      await assert.rejects(fs.mkdir("/locked/child", {recursive:true,mode:0}), {code:"EACCES"});
      assert.equal((await fs.stat("/locked")).mode & 0o777, 0);
      await assert.rejects(fs.mkdir(null), {code:"EINVAL"});
      await assert.rejects(fs.stat("/null"), {code:"ENOENT"});
      await assert.rejects(fs.mkdir("/abort", {signal:AbortSignal.abort()}), {name:"AbortError"});
      await assert.rejects(fs.stat("/abort"), {code:"ENOENT"});
      if (profile === "strict-budgets-mount-dev") {
        await assert.rejects(fs.mkdir("/dev"), {code:"EBUSY"});
        await assert.rejects(fs.mkdir("/dev/foo"), {code:"ENOTSUP"});
        await assert.rejects(fs.mkdir("/dang", {recursive:true}), {code:"ENOENT"});
        await assert.rejects(fs.mkdir("/staged/../file", {recursive:true}), {code:"EEXIST"});
        await assert.rejects(fs.stat("/staged"), {code:"ENOENT"});
      } else if (profile === "overlay-cow-fs") {
        await assert.rejects(fs.mkdir("/dang", {recursive:true}), {code:"ENOTSUP"});
      } else {
        await fs.mkdir("/dang", {recursive:true});
        assert.equal((await fs.stat("/missing/dir")).type, "directory");
      }
    } finally { bash.dispose(); }
  }
});

test("mkdir replay retains parents created before a recursive failure", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    await assert.rejects(bash.fs.mkdir("/unsearchable/child", {recursive:true, mode:0}), {code:"EACCES"});
    assert.equal((await bash.fs.stat("/unsearchable")).mode & 0o777, 0);
    await bash.fs.realpath("/");
    assert.equal((await companion.fs.stat("/unsearchable")).mode & 0o777, 0);
  } finally { bash.dispose(); companion.dispose(); }
});

test("async readdir returns typed entries in JavaScript order and admits bounded listings", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, directories:["/dir/𐀀"], files:{"/dir/":"data"}, symlinks:{"/dir/link":"missing"}});
    try {
      assert.deepEqual(await bash.fs.readdir("/dir", {maxEntries:3}), [
        {name:"link", type:"symlink"}, {name:"𐀀", type:"directory"}, {name:"", type:"file"},
      ]);
      assert.ok(bash.readdir("/dir").every(name => typeof name === "string"));
      await assert.rejects(bash.fs.readdir("/dir", {maxEntries:2}), {code:"EFBIG", path:"/dir"});
      await assert.rejects(bash.fs.readdir("/missing", {maxEntries:-1}), {code:"EINVAL", syscall:"readdir"});
      assert.deepEqual(await bash.fs.readdir("/dir/𐀀", {maxEntries:0}), []);
      if (profile === "strict-budgets-mount-dev") {
        assert.ok((await bash.fs.readdir("/dev")).every(e => e.type === "character"));
        await assert.rejects(bash.fs.readdir("/dev", {maxEntries:Infinity}), {code:"EINVAL"});
      }
      if (profile === "overlay-cow-fs") {
        await bash.fs.unlink("/dir/link");
        await assert.rejects(bash.fs.readdir("/dir", {maxEntries:2}), {code:"EFBIG"});
        await bash.fs.writeFile("/dir/link", "upper");
        assert.equal((await bash.fs.readdir("/dir", {maxEntries:3}))[0].type, "file");
      }
    } finally { bash.dispose(); }
  }
});

test("readdir refuses unreadable directories and resolves ancestors before '..'", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/private/secret":"value", "/readable/file":"data", "/dev/secret":"value"}});
    try {
      if (!profile) {
        await bash.fs.chmod("/dev", 0o100);
        await assert.rejects(bash.fs.readdir("/dev"), {code:"EACCES"});
      }
      await bash.fs.chmod("/private", 0o100);
      await assert.rejects(bash.fs.readdir("/private"), {code:"EACCES"});
      assert.throws(() => bash.readdir("/private"), {code:"EACCES"});
      await assert.rejects(bash.fs.readdir("/readable/file"), {code:"ENOTDIR"});
      await assert.rejects(bash.fs.readdir("/missing/../readable"), {code:"ENOENT"});
      await assert.rejects(bash.fs.readdir("/readable", {signal:AbortSignal.abort()}), {name:"AbortError"});
    } finally { bash.dispose(); }
  }
});

test("ls checks search permission before following children, links or '..'", async () => {
  const bash = new RustWasmBash({files:{"/guard/inner/secret":"data","/guard/plain":"file","/open/file":"ok"},symlinks:{"/alias":"guard/inner","/dang":"absent"}});
  try {
    await bash.fs.chmod("/guard", 0);
    for (const [cmd, path] of [
      ["ls -A /guard/inner", "/guard/inner"],
      ["ls -d /guard/inner/secret", "/guard/inner"],
      ["ls /guard/../open", "/guard/../open"],
      ["ls /alias", "/guard/inner"],
    ]) {
      const r = await bash.exec(cmd);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [1,"",`ls: EACCES: permission denied, lstat '${path}'\n`]);
    }
    await bash.fs.chmod("/guard", 0o400);
    assert.equal((await bash.exec("ls /guard")).stdout, "inner\nplain\n");
    const recursive = await bash.exec("ls -R /guard");
    assert.deepEqual([recursive.exitCode,recursive.stdout,recursive.stderr],
      [1,"/guard:\ninner\nplain\n","ls: EACCES: permission denied, lstat '/guard/inner'\n"]);
    const sorted = await bash.exec("ls -S /guard");
    assert.equal(sorted.exitCode, 1);
    assert.equal(sorted.stdout, "");
    await bash.fs.chmod("/guard", 0o700);
    assert.equal((await bash.exec("ls /alias")).stdout, "secret\n");
    assert.equal((await bash.exec("ls -F /alias /dang")).stdout, "/alias@\n/dang@\n");
  } finally { bash.dispose(); }
});

test("ls reports the original directory operand when access through an alias fails", async () => {
  for (const profile of [undefined,"strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile,files:{"/parent/private/data":"a"},symlinks:{"/link":"parent/private"}});
    try {
      await bash.fs.chmod("/parent/private", 0o100);
      assert.equal((await bash.exec("ls /link")).stderr, "ls: EACCES: permission denied, readdir '/link'\n");
      await bash.fs.chmod("/parent", 0);
      const detail = profile ? "capabilitiesFor '/link'" : "lstat '/parent/private'";
      assert.equal((await bash.exec("ls /link")).stderr, "ls: EACCES: permission denied, " + detail + "\n");
    } finally { bash.dispose(); }
  }
});
test("single-entry removal preserves unseen descendants", async () => {
  for (const cmd of ["find /g -maxdepth 0 -delete", "rmdir /g", "rm -d /g"]) {
    const bash = new RustWasmBash({files:{"/g/sub/data":"KEEP"}});
    try {
      await bash.fs.chmod("/g", 0);
      const result = await bash.exec(cmd);
      await bash.fs.chmod("/g", 0o700);
      assert.equal(bash.readText("/g/sub/data"), "KEEP", cmd);
      assert.deepEqual([result.exitCode, result.stderr], [1, cmd.split(" ")[0] + ": ENOTEMPTY: directory not empty, rmdir '/g'\n"]);
    } finally { bash.dispose(); }
  }
});

test("rmdir checks the parent and removes empty unreadable directories", async () => {
  const bash = new RustWasmBash({files:{"/guard/keep":"data"},symlinks:{"/alias":"/guard"}});
  try {
    await bash.fs.mkdir("/guard/empty", {mode:0});
    await bash.fs.chmod("/guard", 0o500);
    await assert.rejects(bash.fs.rmdir("/guard/empty"), {code:"EACCES", syscall:"rmdir", path:"/guard/empty"});
    await assert.rejects(bash.fs.unlink("/guard/keep"), {code:"EACCES", syscall:"rm", path:"/guard/keep"});
    await assert.rejects(bash.fs.rmdir("/alias/"), {code:"ENOTDIR"});
    await bash.fs.chmod("/guard", 0o700);
    await bash.fs.rmdir("/guard/empty");
    assert.equal(bash.readText("/guard/keep"), "data");
  } finally { bash.dispose(); }
});

test("find does not run depth-first actions when directory traversal fails", async () => {
  const bash = new RustWasmBash({files:{"/g/sub/data":"KEEP","/open/data":"OTHER"},symlinks:{"/alias":"/g/sub"}});
  try {
    await bash.fs.chmod("/g", 0);
    for (const [cmd, output, error] of [
      ["find /g", "/g\n", "EACCES: permission denied, readdir '/g'"],
      ["find /g -maxdepth 0 -empty -o -print", "", "EACCES: permission denied, readdir '/g'"],
      ["find /g -delete","", "EACCES: permission denied, readdir '/g'"],
      ["find /g/../open -delete","", "EACCES: permission denied, lstat '/g/../open'"],
      ["find -L /alias","", "EACCES: permission denied, lstat '/g/sub'"],
    ]) {
      const result = await bash.exec(cmd);
      assert.deepEqual([result.exitCode,result.stdout,result.stderr], [1,output,"find: "+error+"\n"]);
    }
    await bash.fs.chmod("/g", 0o400);
    const result = await bash.exec("find /g -depth");
    assert.deepEqual([result.exitCode,result.stdout,result.stderr], [1,"/g\n","find: EACCES: permission denied, lstat '/g/sub'\n"]);
    await bash.fs.chmod("/g", 0o700);
    assert.equal(bash.readText("/g/sub/data"), "KEEP");
    assert.equal(bash.readText("/open/data"), "OTHER");
  } finally { bash.dispose(); }
});

test("recursive removal checks all nonempty directories before deleting anything", async () => {
  for (const profile of [undefined, "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/tree/first":"A","/tree/z/last":"B","/open/file":"C"}});
    try {
      await bash.fs.chmod("/tree/z", 0o500);
      const r = await bash.exec("rm -rf /tree");
      assert.deepEqual([r.exitCode,r.stderr], [1,"rm: EACCES: permission denied, rm '/tree'\n"]);
      await assert.rejects(bash.fs.rm("/tree", {recursive:true,force:true}), {code:"EACCES"});
      await bash.fs.chmod("/tree/z", 0);
      await assert.rejects(bash.fs.rm("/tree/z/../../open", {recursive:true}), {code:"EACCES"});
      const interactive = await bash.exec("rm -ri /tree/z", {stdin:"y\n"});
      assert.deepEqual([interactive.exitCode,interactive.stderr], [1,"rm: EACCES: permission denied, readdir '/tree/z'\n"]);
      await bash.fs.chmod("/tree/z", 0o700);
      assert.equal(bash.readText("/tree/first"), "A");
      assert.equal(bash.readText("/tree/z/last"), "B");
      assert.equal(bash.readText("/open/file"), "C");
      await bash.fs.rm("/tree", {recursive:true});
      await assert.rejects(bash.fs.stat("/tree"), {code:"ENOENT"});
    } finally { bash.dispose(); }
  }
});

test("overlay removal resolves every ancestor before changing either layer", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/g/sub/data":"lower","/open/keep":"KEEP"},symlinks:{"/link":"/g"}});
  try {
    await bash.fs.writeFile("/g/sub/new", new TextEncoder().encode("upper"));
    await bash.fs.chmod("/g", 0);
    for (const [p,code] of [["/g/../open","EACCES"],["/missing/../open","ENOENT"],["/link/","EACCES"]]) {
      await assert.rejects(bash.fs.rm(p, {recursive:true}), {code});
      assert.equal(bash.readText("/open/keep"), "KEEP");
    }
    await bash.fs.rm("/g", {recursive:true});
    await assert.rejects(bash.fs.lstat("/g/sub/new"), {code:"ENOENT"});
    await assert.rejects(bash.fs.lstat("/g/sub/data"), {code:"ENOENT"});
    assert.equal((await bash.fs.lstat("/link")).type, "symlink");
  } finally { bash.dispose(); }
});

test("fs.utimes preserves both timestamps on the inode and propagates failures", async () => {
  const bash = new RustWasmBash({files:{"/file":"keep"}});
  try {
    await bash.fs.link("/file", "/alias");
    bash.symlink("/file", "/sym");
    await bash.fs.utimes("/sym", -1250.25, 1700000000123.456);
    const {atimeMs, mtimeMs} = await bash.fs.stat("/alias");
    assert.deepEqual([atimeMs, mtimeMs], [-1250.25, 1700000000123.456]);
    assert.equal(bash.execSync("stat -c '%.9X %.9Y' /file").stdout, "-1.250250000 1700000000.123456000\n");
    await assert.rejects(bash.fs.utimes("/missing", NaN, 0), {code:"EINVAL", syscall:"utimes", path:"/missing"});
    await assert.rejects(bash.fs.utimes("/missing", 1, 2), {code:"ENOENT", syscall:"utimes", path:"/missing"});
    await assert.rejects(bash.fs.utimes("/file", 1, 2, {signal:AbortSignal.abort()}), {name:"AbortError"});
    assert.equal((await bash.fs.stat("/file")).mtimeMs, mtimeMs);
  } finally { bash.dispose(); }
});

test("memory file timestamps use the host clock when created, read, written and touched", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({files:{"/file":"a"}});
  try {
    const times = async () => {
      const st = await bash.fs.stat("/file");
      return [st.atimeMs, st.mtimeMs];
    };
    const created = now;
    assert.deepEqual(await times(), [created, created]);
    now += 500;
    await bash.fs.writeFile("/file", new Uint8Array([1]));
    assert.deepEqual(await times(), [created, now]);
    const written = now;
    now += 900;
    await bash.fs.readFile("/file");
    assert.deepEqual(await times(), [now, written]);
    now += 1000;
    assert.equal(bash.execSync("touch /file").exitCode, 0);
    assert.deepEqual(await times(), [now, now]);
  } finally { bash.dispose(); }
});

test("date uses the host clock and prefers an existing numeric reference over epoch seconds", async t => {
  t.mock.method(Date, "now", () => 2208988800123);
  const bash = new RustWasmBash({files:{"/w/5":"x"},cwd:"/w"});
  try {
    await bash.fs.utimes("/w/5", 0, -1.25);
    const result = bash.execSync("SOURCE_DATE_EPOCH=5 date +%s.%N; date -d yesterday +%s.%N; date -r 5 +%s.%N; date -r 6 +%s.%N");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2208988800.123000000\n2208902400.123000000\n-1.998750000\n6.000000000\n");
    assert.equal(bash.execSync("date -r '5.' +%s").stderr, "date: ENOENT: no such file or directory, stat '/w/5.'\n");
    assert.equal(bash.execSync("date -r 999999999999999999999999 +%s").stderr, "date: date is outside the supported range\n");
  } finally { bash.dispose(); }
});

test("chmod changes inode status time without changing modification or birth time", async t => {
  const birth = Date.UTC(2040, 0, 1);
  let now = birth;
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({files:{"/f":"x"}});
  try {
    await bash.fs.link("/f", "/g");
    now += 86_400_000;
    await bash.fs.chmod("/g", 0o600);
    const st = await bash.fs.stat("/f");
    assert.deepEqual([st.birthtimeMs, st.mtimeMs, st.ctimeMs], [birth, birth, now]);
    assert.equal(bash.execSync("stat -c '%W %Y %Z' /g").stdout, "2208988800 2208988800 2209075200\n");
    assert.match(bash.execSync("ls -lc /f").stdout, /2040-01-02 00:00 \/f\n$/);
  } finally { bash.dispose(); }
});

test("find compares the requested inode time at exact minute and day boundaries", async t => {
  const now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash({ files: { "/f": "x" } });
  try {
    await bash.fs.utimes("/f", now + 60_000, now - 60_000);
    for (const [predicate, matches] of [
      ["-amin 0", true], ["-amin -0", true], ["-mmin 1", false],
      ["-mmin 2", true], ["-cmin 0", false], ["-mtime 0", true],
    ]) {
      const result = bash.execSync("find /f " + predicate);
      assert.deepEqual([result.exitCode, result.stdout], [0, matches ? "/f\n" : ""], predicate);
    }
    for (const [predicate, diagnostic] of [
      ["-atime 0", "unsupported expression '-atime'"],
      ["-mmin 9007199254740991", "invalid time '9007199254740991': comparison is out of range"],
      ["-mtime +9007199254740992", "invalid number '9007199254740992'"],
    ]) {
      const result = bash.execSync("find /f " + predicate);
      assert.deepEqual([result.exitCode, result.stderr], [2, "find: " + diagnostic + "\n"]);
    }
  } finally { bash.dispose(); }
});

test("mounted devices retain their creation time while the default null device uses the epoch", async t => {
  let now = Date.UTC(2040, 0, 1);
  t.mock.method(Date, "now", () => now);
  const bash = new RustWasmBash();
  try {
    assert.equal((await bash.fs.stat("/dev/null")).birthtimeMs, 0);
    now += 60_000;
    const mounted = now;
    bash.mountDevices();
    now += 60_000;
    for (const path of ["/dev", "/dev/null", "/dev/zero"]) {
      const st = await bash.fs.stat(path);
      assert.deepEqual([st.birthtimeMs, st.ctimeMs, st.atimeMs, st.mtimeMs], Array(4).fill(mounted));
    }
  } finally { bash.dispose(); }
});

test("chmod reports why a change was denied and leaves permissions intact", async () => {
  const bash = new RustWasmBash({ profile: "overlay-cow-fs", files: { "/w/f": { content: "x", mode: 0o200 } } });
  try {
    await assert.rejects(bash.fs.chmod("/w/f", 0o600), { code: "EACCES", syscall: "overlay", path: "/w/f" });
    await assert.rejects(bash.fs.chmod("/w/f", -1), { code: "EINVAL", syscall: "overlay", path: "/w/f" });
    assert.equal((await bash.fs.stat("/w/f")).mode & 0o7777, 0o200);
    bash.mountDevices();
    await assert.rejects(bash.fs.chmod("/dev/null", 0o600), { code: "ENOTSUP", syscall: "chmod", path: "/dev/null" });
  } finally { bash.dispose(); }
});

test("writeFile reports overlay failures at the resolved operand and prioritizes mount errors", async () => {
  const bash = new RustWasmBash({ profile: "overlay-cow-fs", files: { "/f": { content: "keep", mode: 0o444 } }, symlinks: { "/link": "f" } });
  try {
    await assert.rejects(bash.fs.writeFile("/link", "bad"), { code: "EACCES", syscall: "overlay", path: "/f" });
    await assert.rejects(bash.fs.writeFile("/absent/new", "bad"), { code: "ENOENT", syscall: "overlay", path: "/absent" });
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/f")), "keep");
    bash.mountDevices();
    await assert.rejects(bash.fs.writeFile("/dev", "bad", { flag: "invalid" }), { code: "EBUSY", syscall: "writeFile", path: "/dev" });
    await assert.rejects(bash.fs.writeFile("/dev/absent", "bad"), { code: "ENOENT", syscall: "writeFile", path: "/dev/absent" });
  } finally { bash.dispose(); }
});

test("stat distinguishes absent fields, a zero allocation, and a real inode", async () => {
  const bash = new RustWasmBash({files:{"/f":"content","/g":"other"}});
  try {
    const {fs} = bash;
    const f = await fs.stat("/f");
    const nullDevice = await fs.stat("/dev/null");
    assert.deepEqual([f.dev, f.uid, f.gid, f.ioBlockSize, f.filesystemType, f.allocatedBytes],
                     [0, 0, 0, 65536, "memory", undefined]);
    assert.equal(nullDevice.allocatedBytes, 0);
    assert.equal(nullDevice.ino, 1);
    assert.notEqual(f.identityScope, nullDevice.identityScope);
    assert.equal(bash.execSync("stat -c '%i:%o' /f").stdout, f.ino + ":65536\n");
    assert.notEqual(f.ino, (await fs.stat("/g")).ino);
    assert.equal(bash.execSync("stat -c %b /f").stderr, "stat: ENOTSUP: filesystem does not expose b, stat\n");
    assert.equal(bash.execSync("stat -c %b /dev/null").stdout, "0\n");
    bash.mountDevices();
    const mounted = await fs.stat("/dev/null");
    for (const field of ["uid","gid","nlink","ioBlockSize","filesystemType","allocatedBytes"]) {
      assert.equal(Object.hasOwn(mounted, field), false, field);
    }
    assert.equal(bash.execSync("stat -c %u /dev/null").stderr, "stat: ENOTSUP: filesystem does not expose u, stat\n");
  } finally { bash.dispose(); }
});

test("per-call filesystems never redirect writes into the default Wasm filesystem", async () => {
  const main = new RustWasmBash({ files: { "/file": "original" } });
  const other = new RustWasmBash({ files: { "/file": "other" } });
  try {
    await assert.rejects(main.exec("echo wrong > /file", { fs: other.fs }), /filesystem.*companion/i);
    assert.equal(main.readText("/file"), "original");
    assert.equal(other.readText("/file"), "other");
  } finally { main.dispose(); other.dispose(); }
});

test("explicitly selecting the native filesystem uses the current Wasm files", async () => {
  const bash = new RustWasmBash({ files: { "/file": "original" }, companionFactory() { throw new Error("unexpected companion"); } });
  try {
    const result = await bash.exec("cat /file", { fs: bash.fs });
    assert.equal(result.stdout, "original");
  } finally { bash.dispose(); }
});

test("delegating an external filesystem call preserves the active native filesystem", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const external = new MemoryFileSystem();
  const bash = new RustWasmBash({ cwd: "/", files: { "/file": "original" }, companionFactory() {
    const fs = new MemoryFileSystem();
    return { fs, shell: new Shell({ fs, cwd: "/" }).use(agentCommands()) };
  } });
  try {
    const result = await bash.exec("echo external > /file", { fs: external });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await external.readFile("/file")), "external\n");
    assert.equal((await bash.exec("cat /file")).stdout, "original");
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/file")), "original");
  } finally { bash.dispose(); }
});

test("sort applies locale ordering to records, selected keys and merge inputs", async () => {
  const bash = new RustWasmBash({ files: {
    "/x": Buffer.concat([Buffer.from("z\nä\nZ\na\nÅ\nA\n"), Buffer.of(255, 10, 128, 10)]),
    "/a": "id:Ä\nid:z\n", "/b": "id:å\n", "/out": "keep",
  } });
  try {
    const german = await bash.exec("LC_ALL=de_DE.UTF-8 sort /x");
    assert.deepEqual(Buffer.from(german.stdoutBytes), Buffer.concat([Buffer.from("a\nA\nÅ\nä\nz\nZ\n"), Buffer.of(128, 10, 255, 10)]));
    const swedish = await bash.exec("LC_ALL=sv_SE.UTF-8 sort -t: -k2,2 /a /b");
    assert.equal(swedish.stdout, "id:z\nid:å\nid:Ä\n");
    const merged = await bash.exec("LC_ALL=de_DE.UTF-8 sort -m -t: -k2,2 /a /b");
    assert.equal(merged.stdout, "id:å\nid:Ä\nid:z\n");
    const invalid = await bash.exec("LC_ALL=zz-ZZ sort -o /out /missing");
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stderr, "sort: unsupported collation locale 'zz-ZZ'\n");
    assert.equal(bash.readText("/out"), "keep");
  } finally { bash.dispose(); }
});

test("conditional string ordering uses the locale's default case order", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [script, expected] of [
      ["LC_ALL=de_DE.UTF-8; [[ ä < z ]]", 0],
      ["LC_ALL=sv_SE.UTF-8; [[ ä > z ]]", 0],
      ["LC_ALL=da_DK.UTF-8; [[ A < a ]]", 0],
      ["LC_ALL=da-u-kf-lower.UTF-8; [[ A < a ]]", 1],
      ["LC_ALL=zz_ZZ.UTF-8; [[ a < b ]]", 2],
    ]) {
      const result = await bash.exec(script);
      assert.equal(result.exitCode, expected, script);
      assert.equal(result.stderr, expected === 2 ? "shell: line 1: [[ collation locale: unsupported conditional profile\n" : "");
    }
  } finally { bash.dispose(); }
});

test("the production shell can list files and check permissions on a Wasm filesystem", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  const wasm = new RustWasmBash({ files: { "/dir/file": { content: "data", mode: 0o400 } }, symlinks: { "/link": "/dir/file" } });
  try {
    const r = await shell.exec("ls /dir; [[ -r /link && ! -w /link && ! -x /link ]]", { fs: wasm.fs });
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "file\n");
    assert.equal(r.exitCode, 0);
    await assert.rejects(wasm.fs.access("/absent", 8), {code:"EINVAL", syscall:"access"});
    await assert.rejects(wasm.fs.access("/link", 2), {code:"EACCES", syscall:"access"});
    await assert.rejects(wasm.fs.access("/dev/null/x", 8), {code:"ENOTDIR", path:"/dev/null/x", syscall:undefined});
    const controller = new AbortController(); controller.abort();
    await assert.rejects(wasm.fs.access("/dir", 0, {signal:controller.signal}), {name:"AbortError"});
  } finally { await shell.dispose(); wasm.dispose(); }
});

test("cat reads Wasm file operands and retained reads survive pathname replacement", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  try {
    for (const profile of ["warm-memory-fastpath", "overlay-cow-fs", "strict-budgets-mount-dev"]) {
      const bash = new RustWasmBash({profile, files:{"/f":Uint8Array.of(65,255,66), "/denied":{content:"protected",mode:0}}});
      try {
        const r = await shell.exec("cat /f", {fs:bash.fs});
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(r.stdoutBytes, Uint8Array.of(65,255,66));
        await assert.rejects(bash.fs.openReadFile("/denied"), {code:"EACCES"});
        const aborted = new AbortController();
        const pending = bash.fs.openReadFile("/f", {signal:aborted.signal});
        aborted.abort();
        await assert.rejects(pending, {name:"AbortError"});
        const h = await bash.fs.openReadFile("/f");
        const before = await h.stat();
        await bash.fs.unlink("/f");
        await bash.fs.writeFile("/f", "replacement");
        assert.equal((await h.stat()).ino, before.ino);
        assert.deepEqual(await h.read(1, 2**40), Uint8Array.of(255,66));
        assert.equal(await h.seekEnd(), 3n);
        assert.deepEqual(await h.read(2**40, 1), new Uint8Array());
        await assert.rejects(h.read(0, 0), {code:"EINVAL"});
        await h.close();
        await h.close();
        await assert.rejects(h.read(0, 1), {code:"EBADF"});
      } finally { bash.dispose(); }
    }
  } finally { await shell.dispose(); }
});

test("retained directory metadata survives moves, unlink and overlay copy-up", async () => {
  for (const profile of ["warm-memory-fastpath","overlay-cow-fs","strict-budgets-mount-dev"]) {
    const b = new RustWasmBash({profile, directories:["/d"]});
    try {
      const h = await b.fs.openReadFile("/d", {allowDirectory:true});
      try {
        const original = await h.stat();
        assert.equal(original.type,"directory");
        const listed = await b.fs.stat("/d");
        assert.equal(listed.identityScope, original.identityScope);
        assert.equal(listed.ino, original.ino);
        assert.equal(await h.seekEnd(), (1n << 63n) - 1n);
        await assert.rejects(h.read(0,1), {code:"EISDIR",syscall:"read"});
        await b.fs.mkdir("/d/nested");
        assert.equal((await h.stat()).nlink, profile === "overlay-cow-fs" ? 2 : 3);
        await b.fs.rmdir("/d/nested");
        await b.fs.chmod("/d",0o700);
        if (profile !== "overlay-cow-fs") {
          await b.fs.rename("/d","/moved");
          await b.fs.rmdir("/moved");
        } else {
          await b.fs.rmdir("/d");
        }
        await b.fs.mkdir("/d");
        const removed = await h.stat();
        assert.equal(removed.nlink,profile === "overlay-cow-fs" ? 2 : 0);
        assert.equal(removed.mode,profile === "overlay-cow-fs" ? original.mode : 0o40700);
        assert.equal(removed.ino,original.ino);
      } finally { await h.close(); }
    } finally { b.dispose(); }
  }
});

test("the production shell redirects and appends bytes on a Wasm filesystem", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  const wasm = new RustWasmBash({ files: { "/dest": "old bytes" } });
  try {
    const result = await shell.exec("echo first > /dest && echo second >> /dest && tee /out < /dest", { fs: wasm.fs });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "first\nsecond\n");
    assert.equal(wasm.readText("/dest"), result.stdout);
    assert.equal(wasm.readText("/out"), result.stdout);
    await wasm.fs.appendFile("/binary", Uint8Array.of(0, 255), { mode: 0o400 });
    assert.equal((await wasm.fs.stat("/binary")).mode & 0o777, 0o400);
    await assert.rejects(wasm.fs.appendFile("/binary", "!"), { code: "EACCES", syscall: "appendFile" });
    await assert.rejects(wasm.fs.appendFile("/binary", "!", { signal: AbortSignal.abort() }), { name: "AbortError" });
    assert.deepEqual(await wasm.fs.readFile("/binary"), Uint8Array.of(0, 255));
    await wasm.fs.appendFile("/dev/null", "discard", { mode: -1 });
    await assert.rejects(wasm.fs.appendFile("/dev", "", { mode: -1 }), { code: "EISDIR", syscall: undefined });
  } finally { wasm.dispose(); }
});

test("ffmpeg and ffprobe list the production media registry and codecs", async () => {
  const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
  const { ffmpegCommands } = await import("@poe-platform/safe-bash/commands/ffmpeg");
  const shell = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(ffmpegCommands());
  const wasm = new RustWasmBash();
  try {
    for (const name of ["ffmpeg", "ffprobe"]) {
      for (const flag of ["-version", "-formats", "-muxers", "-demuxers", "-encoders", "-decoders", "-codecs"]) {
        const script = name + " " + flag;
        const expected = await shell.exec(script);
        assert.equal(expected.exitCode, 0, expected.stderr);
        const actual = await wasm.exec(script);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(actual.stdout, expected.stdout, script);
      }
    }
  } finally { wasm.dispose(); }
});

test("cancelled and guarded chmod calls cannot silently change Wasm permissions", async () => {
  const bash = new RustWasmBash({ files: { "/private": { content: "data", mode: 0o600 } } });
  try {
    const reason = new Error("cancel chmod");
    await assert.rejects(bash.fs.chmod("/private", 0o777, { signal: AbortSignal.abort(reason) }), e => e === reason);
    const file = await bash.fs.stat("/private"), root = await bash.fs.stat("/");
    await assert.rejects(bash.fs.chmod("/private", 0o777, { expected: file }), { code: "EINVAL", syscall: "chmod" });
    await assert.rejects(bash.fs.chmod("/private", 0o777, {
      parent: root, expected: file, ancestors: [{ path: "/", stat: root }],
    }), { code: "ENOTSUP", syscall: "chmod" });
    assert.equal((await bash.fs.stat("/private")).mode & 0o777, 0o600);
  } finally { bash.dispose(); }
});

test("chmod forwards the original guard to the active companion", async () => {
  const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const bash = new RustWasmBash({ forceNative: false, companionFactory: () => ({ fs, shell: new Shell({ fs }) }) });
  try {
    await bash.fs.writeFile("/private", "", { mode: 0o600 });
    await bash.fs.realpath("/private");
    const expected = await fs.lstat("/private"), parent = await fs.lstat("/");
    const refused = new Error("guard refused");
    await assert.rejects(bash.fs.chmod("/private", 0o777, {
      expected, parent, ancestors: [{ path: "/", stat: parent }], commitGuard() { throw refused; },
    }), e => e === refused);
    assert.equal((await fs.stat("/private")).mode & 0o777, 0o600);
  } finally { bash.dispose(); }
});

test("yes selects GNU long options and diagnoses the first invalid option byte", async () => {
  const { Shell, MemoryFileSystem, agentCommands, yesCommands } = await import("@poe-platform/safe-bash");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands()).use(yesCommands({ replace: true }));
  const wasm = new RustWasmBash();
  try {
    for (const script of ["yes --bad", "yes -xy", "yes -é", "yes --=x", "yes --ver=x", "yes --v", "yes --he",
      "yes word --v", "POSIXLY_CORRECT= yes word --v | head -n1", "yes word -- --v | head -n1"]) {
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdoutBytes, actual.stderrBytes],
        [expected.exitCode, expected.stdoutBytes, expected.stderrBytes], script);
    }
  } finally { wasm.dispose(); }
});

test("chmod follows only operand symlinks, protects root, and defers restrictive directory changes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  for (const script of [
    "chmod -Rv 100 /tree", "chmod -v +x /link", "chmod -R 700 /", "chmod -R 700 /rootlink",
    "chmod -R --no-preserve-root 755 /", "chmod 777 /absent/../outside", "chmod 777 /outside/",
    "chmod 700 ''", "chmod --reference= /outside", "chmod -v 700 /dangling",
  ]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/", deviceView: "provided" }).use(agentCommands());
    const wasm = new RustWasmBash({ cwd: "/", deviceView: "provided" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.mkdir("/tree");
        await backend.writeFile("/tree/file", Uint8Array.of(1));
        await backend.writeFile("/outside", Uint8Array.of(2), { mode: 0o640 });
        await backend.symlink("/outside", "/tree/escape");
        await backend.symlink("/tree", "/tree/cycle");
        await backend.symlink("/outside", "/link");
        await backend.symlink("/", "/rootlink");
        await backend.symlink("/absent", "/dangling");
      }
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      for (const path of ["/", "/tree", "/tree/file", "/outside"]) {
        assert.equal((await wasm.fs.stat(path)).mode, (await fs.stat(path)).mode, script + ": " + path);
      }
    } finally { wasm.dispose(); }
  }
});

test("du validates options before traversal and formats explicit block sizes like production", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), data = new Uint8Array(1537);
  await fs.writeFile("/f", data);
  const shell = new Shell({ fs }).use(agentCommands());
  const wasm = new RustWasmBash({ files: { "/f": data } });
  try {
    for (const flags of ["--bad", "-bz", "--all=yes", "--block-size", "-X", "-d", "-t", "--exclude", "-as", "-sd2",
      "-d+1", "-d9007199254740992", "-B1.1K", "-B0", "-B9007199254740992", "-B99999999999999999", "-B1g",
      "-tsi", "-t-0", "-t++2", "-tbad", "--b", "--apparent-size -Bsi", "-abBhUmAn", "-abBKiB", "-b -d5000000000",
      "-b --threshold=+1K", "-b -t-2K", "--exclude-from=/missing"]) {
      const script = "du /f " + flags;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
    }
  } finally { wasm.dispose(); }
});

test("install validates modes, accounts and host operations before changing files", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { installCommands } = await import("@poe-platform/safe-bash/commands/install");
  for (const args of ["-s", "-Z", "--context=label", "--preserve-context", "-Z --preserve-context",
    "-oroot", "-gstaff", "-o123", "--group=2", "-o+0x1", "-g08", "-o4294967296", "-o-1",
    "-o0xffffffff", "-mBAD", "-m+777", "-m+w", "--strip-program=x", "-Cp", "-Cs", "--ver",
    "--backup=n", "--backup=wrong", "--backup=", "--help=1", "--bogus", "-q",
    "-D -s /src /new/file", "-d -g0 /new", "-mBAD -t /missing /src", "-t /dst /src"]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(installCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.writeFile("/src", Uint8Array.of(1));
        await backend.writeFile("/dst", Uint8Array.of(2));
      }
      const script = "install " + args + (args.includes("/") ? "" : " /src /dst");
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      assert.equal((await wasm.fs.stat("/dst")).mode, (await fs.stat("/dst")).mode, script);
      for (const backend of [fs, wasm.fs]) await backend.chmod("/dst", 0o644);
      assert.deepEqual(await wasm.fs.readFile("/dst"), await fs.readFile("/dst"), script);
      assert.equal(await wasm.fs.stat("/new").then(() => true, () => false),
        await fs.stat("/new").then(() => true, () => false), script);
    } finally { wasm.dispose(); }
  }
});

test("install replaces directory entries without writing through destination or backup links", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { installCommands } = await import("@poe-platform/safe-bash/commands/install");
  for (const [setup, args] of [
    ["ln -s other dst", "src dst"], ["ln other dst", "src dst"], ["ln -s nowhere dst", "src dst"],
    ["ln -s src dst", "src dst"], ["ln src dst", "src dst"], ["", "src src"], ["ln -s src alias", "alias src"],
    ["ln -s other dst", "-b src dst"], ["ln other dst", "-b src dst"], ["ln -s src dst~; cp other dst", "-b src dst"],
    ["cp other dst; cp src dst~", "-b dst~ dst"], ["ln -s other dst", "--backup=t src dst"],
    ["cp other dst; touch dst.~123456789012345678901~", "--backup=t src dst"],
    ["install src dst", "-C src dst"], ["mkdir dir dst; cp other dir/src", "-t dst src dir/src"],
    ["mkdir dir; ln -s dir dst", "-T src dst"], ["mkdir dir", "-T src dir"],
  ]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(installCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.writeFile("/src", Uint8Array.of(1));
        await backend.writeFile("/other", Uint8Array.of(2), { mode: 0o640 });
      }
      for (const backend of [shell, wasm]) if (setup) assert.equal((await backend.exec(setup)).exitCode, 0, setup);
      const script = "install -v " + args;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      const label = setup + "; " + script;
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], label);
      const snapshot = async backend => {
        const entries = [];
        for (const path of ["/src", "/other", "/dst", "/dst~", "/dst.~1~", "/dst.~123456789012345678902~", "/nowhere"]) {
          const stat = await backend.lstat(path).catch(() => undefined);
          entries.push(stat && [stat.type, stat.mode, stat.nlink, stat.type === "file"
            ? [...await backend.readFile(path)] : stat.type === "symlink" ? await backend.readlink(path) : undefined]);
        }
        return entries;
      };
      assert.deepEqual(await snapshot(wasm.fs), await snapshot(fs), label);
    } finally { wasm.dispose(); }
  }
});

test("install directory failures and symbolic mode masks match production", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { installCommands } = await import("@poe-platform/safe-bash/commands/install");
  for (const args of ["-d /file /new", "-d /file/sub /new", "-d ''", "-d /locked/sub", "-d /dangling",
    "-D /file /locked/sub/file", "-D -t /locked/sub /file", "-d -m g+w /dir", "-d -m +20 /dir",
    "-d -m -20 /dir", "-d -m o=u /dir", "-d -m u+s,u=rx /new", "-d -m a+X /new",
    "-d -m 755 /dir", "-d -m g+w /new", "-d -m a= /new", "-d /dir/child/../sub"]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(installCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.writeFile("/file", Uint8Array.of(1));
        await backend.mkdir("/dir");
        await backend.chmod("/dir", 0o2751);
        await backend.mkdir("/locked");
        await backend.chmod("/locked", 0o555);
        await backend.symlink("/absent", "/dangling");
      }
      const script = "install -v " + args;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      for (const path of ["/file", "/dir", "/new", "/locked/sub", "/dir/sub", "/absent"]) {
        const mode = backend => backend.stat(path).then(st => st.mode, () => undefined);
        assert.equal(await mode(wasm.fs), await mode(fs), script + ": " + path);
      }
    } finally { wasm.dispose(); }
  }
});

test("pdfdetach consumes option values in order and extracts only the selected attachments", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { pdfinfoCommands } = await import("@poe-platform/safe-bash/commands/pdfinfo");
  const { PdfDocument, cosStream, cosArray, cosDict, cosName, cosString, dictSet } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage([10, 10]);
  const attachments = ["one", "two"].map((name, i) => {
    const data = doc.cos.allocateObject(cosStream(Uint8Array.of(i, 255)));
    return doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), UF: cosString(name), EF: cosDict({ UF: data }) }));
  });
  dictSet(doc.cos.resolveDict(doc.cos.rootRef), "AF", cosArray(attachments));
  const bytes = doc.save();
  for (const args of ["--bogus", "--bogus in.pdf", "-o --help in.pdf", "-enc --version", "-h -v",
    "-enc bogus -h", "in.pdf -save", "in.pdf -savefile", "in.pdf -o", "-save -h in.pdf", "-save nope in.pdf",
    "-save 2tail in.pdf", "-save ' +1.9' in.pdf", "-save 0 in.pdf", "-save -1 in.pdf",
    "-save -1 -savefile two in.pdf", "-save -1 -saveall in.pdf", "-save 3 -list in.pdf",
    "-save 1234567890123456789012345 in.pdf", "-savefile '' in.pdf", "-saveall -savefile two in.pdf",
    "-save 1 -savefile two -o selected in.pdf", "-savefile missing in.pdf", "'' in.pdf", "-"]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pdf", bytes);
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(pdfinfoCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/", files: { "/in.pdf": bytes } });
    try {
      const script = "pdfdetach " + args;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      for (const path of ["/one", "/two", "/selected", "/--help"]) {
        assert.deepEqual(await wasm.fs.readFile(path).catch(() => undefined), await fs.readFile(path).catch(() => undefined), script + ": " + path);
      }
    } finally { wasm.dispose(); }
  }
});

test("pdftohtml selects stdin, page ranges and zoom like production", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { pdftotextCommands } = await import("@poe-platform/safe-bash/commands/pdftotext");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  for (const width of [10, 20, 30]) doc.addPage([width, 10]);
  const bytes = doc.save(), fs = new MemoryFileSystem();
  await fs.writeFile("/in.pdf", bytes);
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(pdftotextCommands({ replace: true }));
  const wasm = new RustWasmBash({ cwd: "/", files: { "/in.pdf": bytes } });
  try {
    for (const args of ["", "--bogus", "''", "'' -", "-stdout -f 0x2 in.pdf", "-stdout -l 0b10 in.pdf",
      "-stdout -f 1.5 -l 2.5 in.pdf", "-f 3.25 in.pdf", "-l .5 in.pdf", "-f Infinity in.pdf",
      "-stdout -zoom 2.5pt in.pdf", "-stdout -zoom 1e+2xx in.pdf", "in.pdf ''", "- '' <in.pdf"]) {
      const script = "pdftohtml " + args;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdoutBytes, actual.stderrBytes],
        [expected.exitCode, expected.stdoutBytes, expected.stderrBytes], script);
      for (const path of ["/in.html", "/.html"]) {
        assert.deepEqual(await wasm.fs.readFile(path).catch(() => undefined), await fs.readFile(path).catch(() => undefined), script + ": " + path);
      }
    }
  } finally { wasm.dispose(); }
});

test("exiftool rejects invalid metadata options before creating a backup or changing the input", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage([10, 10]);
  const bytes = doc.save();
  for (const flags of ["--invalid", "-bogus", "--json", "-G", "-G0", "-q", "-u", "-constructor",
    "-@ /missing", "-@ -", "-@ /", "-CONFIG bad", "-charset utf16", "-api bad", "-tagsFromFile -", "-tagsfromfile %f",
    "-G4", "-G1 -j", "-b -X", "-csv -Title#", "-p '$Unknown'", "-if cond"]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/f.pdf", bytes);
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/", files: { "/f.pdf": bytes } });
    try {
      const script = "exiftool " + flags + (flags.startsWith("-p ") || flags.startsWith("-csv ") ? "" : " -Title=changed") + " /f.pdf";
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.equal(expected.exitCode, 1, script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      assert.deepEqual(await wasm.fs.readFile("/f.pdf"), bytes, script);
      await assert.rejects(wasm.fs.stat("/f.pdf_original"), undefined, script);
    } finally { wasm.dispose(); }
  }
});

test("exiftool templates substitute each original tag once for both files and stdin", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  doc.setTitle("one\ntwo  ");
  doc.setAuthor("$Title");
  const bytes = doc.save(), fs = new MemoryFileSystem();
  await fs.writeFile("/f.pdf", bytes);
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
  const wasm = new RustWasmBash({ cwd: "/", files: { "/f.pdf": bytes } });
  try {
    for (const operands of ["f.pdf", "- <f.pdf", "f.pdf f.pdf"]) {
      for (const template of ["", "literal", "$pagecount:$Author-$Title:$Subject", "$filename/$DIRECTORY/$FileSize", "$Title$Title!"]) {
        const script = "exiftool -p '" + template + "' " + operands;
        const expected = await shell.exec(script), actual = await wasm.exec(script);
        assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      }
    }
  } finally { wasm.dispose(); }
});

test("exiftool refuses link operands and unsupported writers without changing the source or its backup", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  const bytes = doc.save();
  for (const [setup, args] of [
    ["ln -s f.pdf link", "-Title=x link"], ["ln -s absent link", "-PageCount link"],
    ["ln -s f.pdf link", "-tagsFromFile link f.pdf"], ["ln f.pdf other", "-Title=x f.pdf"],
    ["chmod 400 f.pdf", "-Title=x f.pdf"], ["", "-Title=x text"], ["", "-Title=x data.docx"],
    ["chmod 000 f.pdf", "-Title=x f.pdf"], ["chmod 000 f.pdf", "-PageCount f.pdf"],
  ]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.writeFile("/f.pdf", bytes);
        await backend.writeFile("/text", Uint8Array.of(1));
        await backend.writeFile("/data.docx", Uint8Array.of(2));
      }
      for (const backend of [shell, wasm]) if (setup) assert.equal((await backend.exec(setup)).exitCode, 0);
      const script = "exiftool " + args;
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.equal(expected.exitCode, 1, script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
      for (const backend of [fs, wasm.fs]) await backend.chmod("/f.pdf", 0o644);
      for (const path of ["/f.pdf", "/text", "/data.docx", "/f.pdf_original", "/link_original", "/text_original", "/data.docx_original"])
        assert.deepEqual(await wasm.fs.readFile(path).catch(() => undefined), await fs.readFile(path).catch(() => undefined), path);
    } finally { wasm.dispose(); }
  }
});

test("exiftool creates named outputs and backups without overwriting occupied names", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  const bytes = doc.save();
  for (const [setup, args] of [
    ["", "-o dest"], ["echo keep >dest", "-o dest"], ["ln -s absent dest", "-o dest"],
    ["ln f.pdf dest", "-o dest"], ["", "-o f.pdf"], ["mkdir dest", "-o dest"],
    ["", "-o missing/out"], ["mkdir dir; chmod 555 dir", "-o dir/out"],
    ["ln -s absent f.pdf_original", ""], ["ln -s other f.pdf_original", ""],
    ["echo keep >f.pdf_original", ""], ["ln -s / dir", "-o dir/dest"],
  ]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
    const wasm = new RustWasmBash({ cwd: "/" });
    try {
      for (const backend of [fs, wasm.fs]) {
        await backend.writeFile("/f.pdf", bytes);
        await backend.writeFile("/other", Uint8Array.of(42));
      }
      for (const backend of [shell, wasm]) if (setup) assert.equal((await backend.exec(setup)).exitCode, 0);
      const script = "exiftool -Title=x " + args + " f.pdf";
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      const label = setup + "; " + script;
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], label);
      for (const path of ["/f.pdf", "/other", "/f.pdf_original", "/dest", "/absent", "/missing/out", "/dir/out"]) {
        const snapshot = async backend => {
          const st = await backend.lstat(path).catch(() => undefined);
          if (!st) return undefined;
          if (st.type !== "file") return [st.type, st.type === "symlink" && await backend.readlink(path)];
          const contents = await backend.readFile(path);
          return [st.mode, st.nlink, Buffer.from(contents).subarray(0,5).toString() === "%PDF-"
            ? [PdfDocument.load(contents).getMetadata().title, Buffer.from(contents).equals(Buffer.from(bytes))] : [...contents]];
        };
        assert.deepEqual(await snapshot(wasm.fs), await snapshot(fs), label + " " + path);
      }
    } finally { wasm.dispose(); }
  }
});

test("exiftool replaces the inode on normal edits and retains it for explicit in-place edits", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  const bytes = doc.save();
  for (const flags of ["", "-overwrite_original", "-overwrite_original_in_place"]) {
    const fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/" });
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
    try {
      for (const [backend, runtime] of [[fs, shell], [wasm.fs, wasm]]) {
        await backend.writeFile("/source.pdf", bytes, { mode: 0o640 });
        const before = await backend.stat("/source.pdf");
        const handle = await backend.open("/source.pdf", { access: "read", creation: "never" });
        try {
          const result = await runtime.exec("exiftool -Title=new " + flags + " /source.pdf");
          assert.equal(result.exitCode, 0, result.stderr);
          const after = await backend.stat("/source.pdf");
          assert.equal(after.ino === before.ino, flags === "-overwrite_original_in_place", flags);
          assert.equal(after.mode, before.mode);
          assert.equal((await handle.stat()).size, flags === "-overwrite_original_in_place" ? after.size : before.size);
          assert.equal(PdfDocument.load(await backend.readFile("/source.pdf")).getMetadata().title, "new");
        } finally { await handle.close(); }
      }
    } finally { wasm.dispose(); }
  }
});

test("exiftool expands physical argument-file lines and carries option state through nested files", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  const bytes = doc.save();
  const files = {
    "/f.pdf": bytes, "/f.pdf  ": bytes, "/-@": bytes,
    "/line": "\uFEFF# ignored\r\n  -p\n#[CSTR]  $FileName\\n\\t\\x41\r\nf.pdf  \n",
    "/nested": "-@\nline\n", "/handoff": "-@\n", "/value": "-p\n", "/literal": "--\n",
    "/cycle": "-@\ncycle\n", "/config": "-config\n", "/common": "-common_args\n",
    "/hash": "  # filename\n", "/empty": "-p\n#[CSTR]\nf.pdf\n",
    "/assign": "-Title  =  spaced  \r\nf.pdf\n",
  };
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/", files });
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
  try {
    for (const [path, body] of Object.entries(files)) await fs.writeFile(path, typeof body === "string" ? new TextEncoder().encode(body) : body);
    for (const args of ["-@ line", "-@ nested", "-@ handoff line", "-@ value -@ f.pdf", "-FileName -@ literal -@", "-@ cycle", "-@ config", "-@ common", "-@ hash", "-@ empty", "-@ assign"]) {
      const script = "exiftool " + args, expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.deepEqual([actual.exitCode, actual.stdout, actual.stderr], [expected.exitCode, expected.stdout, expected.stderr], script);
    }
    for (const backend of [fs, wasm.fs]) assert.equal(PdfDocument.load(await backend.readFile("/f.pdf")).getMetadata().title, " spaced  ");
  } finally { wasm.dispose(); }
});

test("exiftool binary and text rendering preserve selected PDF tag order and value semantics", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.addPage();
  doc.setTitle("title\nwith space  ");
  doc.setAuthor("café");
  const bytes = doc.save(), fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/", files: { "/f.pdf": bytes } });
  await fs.writeFile("/f.pdf", bytes);
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
  try {
    for (const flags of ["-b -Title", "-b -Author -MissingTag -Title -Author", "-b -FileSize", "-b", "-s3", "-s3 -Title", "-S -Author -Title", "-f -G1 -Title -Subject -FileSize -FileTypeExtension", "-G1 -s3 -Title -FileName", "-f -s3 -MissingTag", "-s3 -FileSize# -FileSize", "-n -FileSize"]) {
      for (const operand of ["f.pdf", "- < f.pdf"]) {
        const script = "exiftool " + flags + " " + operand;
        const expected = await shell.exec(script), actual = await wasm.exec(script);
        assert.deepEqual([actual.exitCode, actual.stdoutBytes, actual.stderr], [expected.exitCode, expected.stdoutBytes, expected.stderr], script);
      }
    }
  } finally { wasm.dispose(); }
});

test("exiftool prints decimal file sizes with three significant digits", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/" });
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
  try {
    for (const size of [999, 1000, 1125, 1245, 10250, 100500, 999999, 1000000]) {
      for (const backend of [fs, wasm.fs]) await backend.writeFile("/f", new Uint8Array(size));
      const script = "exiftool -s3 -FileSize f";
      const expected = await shell.exec(script), actual = await wasm.exec(script);
      assert.equal(actual.stdout, expected.stdout, String(size));
      assert.equal(actual.exitCode, 0);
    }
  } finally { wasm.dispose(); }
});

test("exiftool reads and edits standard PNG chunks without altering image data", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { exiftoolCommands } = await import("@poe-platform/safe-bash/commands/exiftool");
  const { crc32 } = await import("node:zlib");
  const base = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const chunk = (type, text) => {
    const data = Buffer.from(text, "latin1"), bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
  };
  const input = Buffer.concat([base.subarray(0, 33), chunk("tEXt", "TITLE\0café"), chunk("tEXt", "Title\0old"), base.subarray(33)]);
  const scalars = Buffer.concat([base.subarray(0, 33), ...[
    ["Title", "001"], ["A", "-3.50e+2"], ["B", "TRUE"], ["C", "1234567890123456"],
    ["D", "a\0b\x1b\x7f\t\n\r\\\""], ["E", "false\n"], ["F", "007"], ["G", ".25"],
  ].map(([k,v]) => chunk("tEXt", k + "\0" + v)), base.subarray(33)]);
  const raw = Buffer.concat([input.subarray(0, 33), chunk("iTXt", "Title\0\0\0\0\0\xff"), input.subarray(33)]);
  const broken = Buffer.from(input); broken[32] ^= 1;
  for (const [source, flags] of [
    [input, "-s3 -Title -ColorType"], [input, "-Title=first -Title='café 雪' -Author=A"], [input, "-Title-=old"],
    [input, "-ModifyDate=2024-02-29T12:34:56.789+05:30"], [input, "-ModifyDate=bad"], [input, "-all="],
    [scalars, "-j"], [scalars, "-j -api structformat=jsonq"], [raw, "-j -G4 -Title -Title -ImageWidth -f -MissingTag"], [input, "-j"],
    [input, "-j -api structformat=jsonq -ImageWidth -FileSize#"], [broken, "-j"], [raw, "-a -b -Title"], [raw, "-a -s3 -Title -Title"], [raw, "-T -a -Title -Title"],
    [Buffer.concat([base.subarray(0, 33), chunk("iTXt", "Title\0\0\0\0\0\xff"), base.subarray(33)]), "-b -Title"],
    [input, "-Title+=bad"], [input, "-Title+=NaN"], [input, "-Title+=2e+"], [input, "-Title+=+.25E2"], [input, "-Title+=1,5"], [input, "-Author=x -Title+=bad"],
    [broken, "-Title+=bad"], [input, "-Subject=x"], [input, "-Comment="], [input, "-tagsFromFile ref.png -Title"], [input, "-tagsFromFile ref.png -ImageWidth"],
    [Buffer.concat([input, Buffer.from("junk")]), "-Title=updated"], [broken, "-Title=updated"],
    [Buffer.concat([input.subarray(0, 33), chunk("vpAg", "private"), input.subarray(33)]), "-all="],
  ]) {
    const fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/", files: { "/f.png": source, "/ref.png": input } });
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(exiftoolCommands({ replace: true }));
    try {
      await fs.writeFile("/f.png", source); await fs.writeFile("/ref.png", input);
      const compare = async script => {
        const want = await shell.exec(script), got = await wasm.exec(script);
        assert.deepEqual([got.exitCode, got.stdoutBytes, got.stderr], [want.exitCode, want.stdoutBytes, want.stderr], script);
      };
      await compare("exiftool " + flags + " f.png");
      for (const path of ["/f.png", "/f.png_original"]) {
        const read = backend => backend.readFile(path).then(bytes => Buffer.from(bytes), e => e.code);
        assert.deepEqual(await read(wasm.fs), await read(fs), flags + ": " + path);
      }
      await compare("exiftool -s3 -Title -Author -ModifyDate f.png");
    } finally { wasm.dispose(); }
  }
});

test("magick writes pixel and alpha streams into a standard PDF from files and canvases", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { imagemagickCommands } = await import("@poe-platform/safe-bash/commands/imagemagick");
  const { createHash } = await import("node:crypto");
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/" });
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(imagemagickCommands({ replace: true }));
  try {
    for (const runtime of [shell, wasm]) assert.equal((await runtime.exec("magick -size 64x48 gradient:red-blue f.png")).exitCode, 0);
    for (const operands of ["f.png", "-size 3x2 xc:none", "f.png -resize 11x7! -colorspace Gray", "-size 9x3 xc:'#aabbcc77'"]) {
      const script = "magick " + operands + " f.pdf";
      const want = await shell.exec(script), got = await wasm.exec(script);
      assert.equal(want.exitCode, 0, want.stderr);
      assert.deepEqual([got.exitCode, got.stdout, got.stderr], [want.exitCode, want.stdout, want.stderr]);
      const digest = bytes => createHash("sha256").update(bytes).digest("hex");
      assert.equal(digest(await wasm.fs.readFile("/f.pdf")), digest(await fs.readFile("/f.pdf")), script);
    }
  } finally { wasm.dispose(); }
});

test("pdftoppm paints embedded RGB and alpha pixels at page coordinates", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { pdftoppmCommands } = await import("@poe-platform/safe-bash/commands/pdftoppm");
  const { PdfDocument, encodePng } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(), page = doc.addPage([15, 10]);
  const pixels = Uint8Array.from({length: 8 * 6 * 4}, (_, i) => (i * 73 + 19) % 256);
  const image = doc.embedPng(encodePng({width: 8, height: 6, data: pixels}));
  page.drawImage(image, { x: 1, y: 2, width: 8, height: 6 });
  page.drawImage(image, { x: 6, y: 1, width: 4, height: 3 });
  const bytes = doc.save(), fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/", files: { "/f.pdf": bytes } });
  await fs.writeFile("/f.pdf", bytes);
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(pdftoppmCommands({ replace: true }));
  try {
    for (const options of ["-r 72", "-r 144", "-r 36", "-scale-to 4", "-r 72 -x 2 -W 8 -y 1 -H 4"]) {
      const script = "pdftoppm -singlefile " + options + " f.pdf out";
      const want = await shell.exec(script), got = await wasm.exec(script);
      assert.equal(want.exitCode, 0, want.stderr);
      assert.deepEqual([got.exitCode, got.stderr], [want.exitCode, want.stderr]);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out.ppm")), Buffer.from(await fs.readFile("/out.ppm")), script);
    }
  } finally { wasm.dispose(); }
});

test("pdfimages lists and extracts the painted image from a real PDF, retaining its soft mask", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { pdfimagesCommands } = await import("@poe-platform/safe-bash/commands/pdfimages");
  const { PdfDocument, encodePng } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(), page = doc.addPage([20, 10]);
  const image = doc.embedPng(encodePng({width: 2, height: 1, data: Uint8Array.of(220, 11, 33, 255, 7, 99, 166, 64)}));
  page.drawImage(image, { x: 8, y: 0, width: 2, height: 1 });
  page.drawImage(image, { x: 0, y: 0, width: 8, height: 4 });
  const bytes = doc.save(), fs = new MemoryFileSystem(), wasm = new RustWasmBash({ cwd: "/", files: { "/f.pdf": bytes } });
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile("/f.pdf", bytes);
  const shell = new Shell({ fs, cwd: "/" }).use(agentCommands()).use(pdfimagesCommands({ replace: true }));
  try {
    for (const args of ["-list f.pdf", "-u -list f.pdf", "-tiff -u f.pdf tiff", "-min-width 3 -list f.pdf", "-png -print-filenames f.pdf img", "-p -print-filenames f.pdf copy"]) {
      const script = "pdfimages " + args, want = await shell.exec(script), got = await wasm.exec(script);
      assert.equal(want.exitCode, 0, want.stderr);
      assert.deepEqual([got.exitCode, got.stdout, got.stderr], [want.exitCode, want.stdout, want.stderr], script);
    }
    for (const path of ["/img-000.png", "/img-001.png", "/copy-001-000.ppm", "/tiff-000.tif"])
      assert.deepEqual(Buffer.from(await wasm.fs.readFile(path)), Buffer.from(await fs.readFile(path)), path);
  } finally { wasm.dispose(); }
});

test("qpdf inspects embedded name trees, associated files and attachment annotations", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { PdfDocument, cosStream, cosArray, cosDict, cosName, cosString, dictSet } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(), page = doc.addPage([30, 40]), root = doc.cos.resolveDict(doc.cos.rootRef);
  const spec = (filename, byte) => {
    const data = doc.cos.allocateObject(cosStream(Uint8Array.of(0, byte, 255)));
    return doc.cos.allocateObject(cosDict({ UF: cosString(filename), EF: cosDict({ UF: data }) }));
  };
  const a = spec("payload.bin", 1), b = spec("payload.bin", 2), c = spec("af.bin", 3);
  dictSet(root, "Names", cosDict({EmbeddedFiles: cosDict({Kids: cosArray([doc.cos.allocateObject(cosDict({
    Names: cosArray([cosString("first"), a, cosString("second"), b, cosString("first"), b]),
  }))])})}));
  dictSet(root, "AF", cosArray([c]));
  dictSet(page.dict, "AF", cosArray([spec("page-only", 4)]));
  dictSet(page.dict, "Annots", cosArray([cosDict({Subtype: cosName("FileAttachment"), FS: spec("annot.bin", 5)})]));
  const bytes = doc.save(), fs = new MemoryFileSystem(), wasm = new RustWasmBash({cwd:"/",files:{"/in.pdf":bytes}});
  await fs.writeFile("/in.pdf", bytes);
  const shell = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const opts of ["--list-attachments", ...["first","second","payload.bin","af.bin","annot.bin","page-only","none"].map(k => "--show-attachment="+k),
      "--list-attachments --show-attachment=second"]) {
      const script = "qpdf in.pdf "+opts, a = await shell.exec(script), b = await wasm.exec(script);
      assert.deepEqual([b.exitCode,b.stdoutBytes,b.stderr],[a.exitCode,a.stdoutBytes,a.stderr], script);
    }
  } finally { wasm.dispose(); }
});

test("qpdf adds, replaces and removes attachments without losing the PDF object graph", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { PdfDocument, encodePng, cosString, dictSet } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(), page = doc.addPage([30,40]);
  doc.setTitle("attachment fixture");
  page.drawImage(doc.embedPng(encodePng({width:1,height:1,data:Uint8Array.of(24,39,88,127)})), {x:3,y:8,width:20,height:10});
  dictSet(doc.cos.resolveDict(doc.cos.rootRef), "Unrelated", cosString("preserve me"));
  const files = {"/base.pdf":doc.save(), "/a":Uint8Array.of(0,255,10), "/b":Uint8Array.of(9,8,7)};
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({cwd:"/",files});
  for (const [p,b] of Object.entries(files)) await fs.writeFile(p,b);
  const shell = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const [args, path] of [
      ["base.pdf --add-attachment a --key=one --filename=thing.bin --description='first file' -- first.pdf","/first.pdf"],
      ["first.pdf --add-attachment=b --key=two --filename=thing.bin -- second.pdf","/second.pdf"],
      ["second.pdf --add-attachment a --key=two -- bad.pdf",null],
      ["second.pdf --add-attachment a --key=two --replace -- replacement.pdf","/replacement.pdf"],
      ["replacement.pdf --remove-attachment=thing.bin kept.pdf","/kept.pdf"],
      ["kept.pdf --remove-attachment=one --replace-input","/kept.pdf"],
      ["base.pdf --copy-attachments-from=second.pdf --prefix=imported_ -- copied.pdf","/copied.pdf"],
      ["copied.pdf --show-attachment=imported_two",null],
      ["copied.pdf --copy-attachments-from second.pdf --prefix=imported_ -- bad.pdf",null],
      ["base.pdf --copy-attachments-from second.pdf -- --remove-attachment=one --add-attachment b --key=two --replace -- mixed.pdf","/mixed.pdf"],
      ["kept.pdf --list-attachments",null],
      ["first.pdf --show-attachment=thing.bin",null],
      ["base.pdf --add-attachment a --key=€Œ --filename=雪.bin --description='résumé 🧪' -- unicode.pdf","/unicode.pdf"],
      ["unicode.pdf --list-attachments",null], ["unicode.pdf --show-attachment=€Œ",null],
      ["base.pdf --copy-attachments-from unicode.pdf --prefix=雪 -- copied-unicode.pdf","/copied-unicode.pdf"],
      ["copied-unicode.pdf --remove-attachment=雪€Œ removed.pdf","/removed.pdf"],
      ["base.pdf --add-attachment missing -- bad.pdf",null],
    ]) {
      const script = "qpdf "+args, a = await shell.exec(script), b = await wasm.exec(script);
      assert.deepEqual([b.exitCode,b.stdoutBytes,b.stderr],[a.exitCode,a.stdoutBytes,a.stderr],script);
      if (path) {
        assert.equal(a.exitCode,0,a.stderr);
        const got = Buffer.from(await wasm.fs.readFile(path)), want = Buffer.from(await fs.readFile(path));
        assert.equal(got.equals(want),true,script + ": first differing byte " + want.findIndex((v,i)=>v!==got[i]));
      }
    }
    const copied = PdfDocument.load(await fs.readFile("/first.pdf"));
    for (const [source,pw] of [["/locked-a","reader"],["/locked-b","second"]]) {
      const bytes = copied.save({encrypt:{userPassword:pw,ownerPassword:"owner"}});
      for (const backend of [fs,wasm.fs]) await backend.writeFile(source,bytes);
    }
    for (const pw of ["wrong","second"]) {
      const cmd = "qpdf base.pdf --copy-attachments-from=locked-a --password=reader --prefix=a- -- "+
        "--copy-attachments-from locked-b --prefix=b- --password="+pw+" -- copied.pdf";
      const want = await shell.exec(cmd), got = await wasm.exec(cmd);
      assert.equal(want.exitCode === 0,pw === "second",want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],cmd);
      assert.deepEqual(await wasm.fs.readFile("/copied.pdf"),await fs.readFile("/copied.pdf"),cmd);
    }
    for (const backend of [fs,wasm.fs]) await assert.rejects(backend.readFile("/bad.pdf"));
  } finally {wasm.dispose();}
});

test("qpdf displays actual PDF objects, stream bytes and nested form image references", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { PdfDocument, cosName, cosNumber, cosArray, cosString, cosDict, cosStream, dictSet } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  const image = doc.cos.allocateObject(cosStream(Uint8Array.of(227,0,155), {dict:cosDict({Subtype:cosName("Image"),Width:cosNumber(1),Height:cosNumber(1)}),compress:true}));
  const resources = cosDict({XObject:cosDict({"Pic 1":image})});
  const form = doc.cos.allocateObject(cosStream(new Uint8Array(),{dict:cosDict({Subtype:cosName("Form"),Resources:resources})}));
  const page = doc.addPage([10,20]);
  dictSet(page.dict,"Resources",cosDict({XObject:cosDict({Nested:form,SameForm:form,Direct:image})}));
  doc.addPage([2,3]);
  const extra = doc.cos.allocateObject(cosArray([cosString("Unicode 雪"), cosName("a/b"), cosNumber(-1.5), cosDict({}),cosArray([])]));
  const fs = new MemoryFileSystem(), input = doc.save(), wasm = new RustWasmBash({cwd:"/",files:{"/in.pdf":input}});
  await fs.writeFile("/in.pdf",input);
  const shell = new Shell({cwd:"/",fs}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const flags of ["--show-object=1","--show-xref","--show-pages","--show-pages --with-images",
      "--show-xref --show-pages","--show-object=9999","--show-object="+extra.objectNumber,
      ...[""," --raw-stream-data"," --filtered-stream-data"," --raw-stream-data --filtered-stream-data"]
        .map(s=>"--show-object="+image.objectNumber+",7"+s)]) {
      const script = "qpdf in.pdf "+flags, want = await shell.exec(script), got = await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stdoutBytes,got.stderr],[want.exitCode,want.stdoutBytes,want.stderr],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf copies the complete graph and materializes inherited page attributes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { cosDict, cosRef, cosString, cosStream, cosArray, cosName, cosNumber, serializeCosDocument } = await import("@poe-code/pdf-ast");
  const box = (w,h) => cosArray([0,0,w,h].map(k => cosNumber(k)));
  const nodes = [
    cosDict({Type:cosName("Catalog"),Pages:cosRef(2),Outlines:cosRef(8)}),
    cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(3)]),Count:cosNumber(2),MediaBox:box(48,80),Resources:cosDict({Font:cosRef(7)})}),
    cosDict({Type:cosName("Pages"),Parent:cosRef(2),Count:cosNumber(2),Kids:cosArray([cosRef(4),cosRef(5)]),Rotate:cosNumber(90),CropBox:box(42,72)}),
    cosDict({Type:cosName("Page"),Parent:cosRef(3),Contents:cosRef(6)}),
    cosDict({Type:cosName("Page"),Parent:cosRef(3),MediaBox:box(30,20),Resources:cosDict({}),Rotate:cosNumber(180)}),
    cosStream(Uint8Array.of(255,0,1,2,10),{compress:true}),cosDict({}),cosDict({Title:cosString("雪")}),
  ];
  const input = serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1),version:"1.4"});
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({cwd:"/", files:{"/in.pdf":input}});
  await fs.writeFile("/in.pdf",input);
  const shell = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const [script,file] of [["qpdf in.pdf out.pdf","/out.pdf"],["cat in.pdf | qpdf - -",null],
      ["qpdf in.pdf --replace-input","/in.pdf"],["qpdf --empty empty.pdf","/empty.pdf"]]) {
      const got=await wasm.exec(script), want=await shell.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stdoutBytes,got.stderr],[want.exitCode,want.stdoutBytes,want.stderr],script);
      if (file) assert.deepEqual(Buffer.from(await wasm.fs.readFile(file)),Buffer.from(await fs.readFile(file)),script);
    }
  } finally {wasm.dispose();}
});

test("qpdf replaces only the destination entry and respects directory permissions", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({cwd:"/"});
  const shell = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const script of [
      "qpdf --empty base.pdf",
      "printf keep > old; ln old dest; chmod 444 old; qpdf base.pdf dest; cat old; stat -c '%a %h' old dest",
      "ln -s old link; qpdf base.pdf link", "readlink link; cat old",
      "ln -s absent dangling; qpdf base.pdf dangling", "readlink dangling; test ! -e absent",
      "mkdir real; ln -s real parent; qpdf base.pdf parent/out; cmp dest real/out",
      "qpdf base.pdf nested/path/out; cmp dest nested/path/out",
      "qpdf base.pdf real", "qpdf base.pdf old/file",
      "chmod 555 real; qpdf base.pdf real/out", "qpdf base.pdf real/new/out", "test ! -e real/new",
    ]) {
      const got=await wasm.exec(script), want=await shell.exec(script);
      assert.deepEqual([got.exitCode,got.stdout,got.stderr],[want.exitCode,want.stdout,want.stderr],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf removes selected catalog and information entries without rewriting unrelated streams", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { cosDict, cosRef, cosString, cosStream, cosArray, cosName, cosNumber, serializeCosDocument } = await import("@poe-code/pdf-ast");
  const fs = new MemoryFileSystem(), wasm = new RustWasmBash({cwd:"/"});
  const shell = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const dated of [false,true]) {
      const nodes = [
        cosDict({Type:cosName("Catalog"), Pages:cosRef(2), Metadata:cosRef(5), PageLabels:cosRef(6),
          StructTreeRoot:cosRef(7), MarkInfo:cosDict({}), AcroForm:cosRef(8), Extra:cosRef(5)}),
        cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(3)]),Count:cosNumber(1)}),
        cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(5)}),
        cosDict({Title:cosString("Private"),Author:cosString("Writer"),...(dated?{ModDate:cosString("D:20261010120000Z")}: {})}),
        cosStream(Uint8Array.of(128,0,255),{compress:true}),cosDict({Nums:cosArray([])}),cosDict({}),cosDict({Fields:cosArray([])}),
      ];
      const input = serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1),infoRef:cosRef(4)});
      await fs.writeFile("/in.pdf",input); await wasm.fs.writeFile("/in.pdf",input);
      for (const flags of ["--remove-info","--remove-metadata","--remove-structure","--remove-acroform","--remove-page-labels",
          "--remove-info --remove-acroform --remove-page-labels --remove-structure"]) {
        const script = "qpdf in.pdf "+flags+" -", want = await shell.exec(script), got = await wasm.exec(script);
        assert.equal(want.exitCode,0,want.stderr);
        assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],flags);
      }
    }
  } finally {wasm.dispose();}
});

test("qpdf rotates selected real pages in order, retaining inherited geometry and content", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { cosDict, cosRef, cosArray, cosNumber, cosName, cosStream, serializeCosDocument } = await import("@poe-code/pdf-ast");
  const nodes = [
    cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),
    cosDict({Type:cosName("Pages"),Count:cosNumber(4),Kids:cosArray([3,4,5,6].map(n=>cosRef(n))),Rotate:cosRef(7),MediaBox:cosArray([0,0,48,62].map(n=>cosNumber(n)))}),
    ...[{}, {Rotate:cosNumber(270)}, {Rotate:cosNumber(90.5)}, {Rotate:cosNumber(-90)}].map(fields=>
      cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(8),...fields})),
    cosNumber(90),cosStream(Uint8Array.of(0,128,255,1),{compress:true}),
  ];
  const input=serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const fs=new MemoryFileSystem(), wasm=new RustWasmBash({cwd:"/",files:{"/in.pdf":input}});
  await fs.writeFile("/in.pdf",input);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [args,code] of [
      ["--rotate=+90",0],["--rotate=-90:1,1 --rotate=180:r2-z --rotate=+90:z-1:even",0],
      ["--rotate=+90:z-1,x3,3,1:odd",0],["--rotate=450: --rotate=+90:1,2,2,3:even",0],
      ["--rotate=bogus",1],["--rotate=45:1",1],["--rotate=90:5",1],["--rotate=90:r0",1],
      ["--rotate=45:1,x1",0],
    ]) {
      const script="qpdf in.pdf "+args+" out.pdf", want=await js.exec(script), got=await wasm.exec(script);
      assert.equal(want.exitCode,code,args);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],args);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out.pdf")),Buffer.from(await fs.readFile("/out.pdf")),args);
    }
  } finally {wasm.dispose();}
});

test("qpdf splits real page objects with their resources, rotations and document metadata", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { cosDict, cosRef, cosArray, cosNumber, cosName, cosString, cosStream, serializeCosDocument } = await import("@poe-code/pdf-ast");
  const box=(...v)=>cosArray(v.map(n=>cosNumber(n)));
  const nodes=[
    cosDict({Type:cosName("Catalog"),Pages:cosRef(2),AcroForm:cosRef(10),OCProperties:cosRef(15)}),
    cosDict({Type:cosName("Pages"),Kids:cosArray([3,4,5].map(n=>cosRef(n))),Count:cosNumber(3),
      Rotate:cosNumber(-90),Resources:cosDict({Font:cosRef(7)}),MediaBox:box(10,20,90,100),CropBox:box(0,0,50,50)}),
    ...[{}, {Rotate:cosNumber(90)}, {MediaBox:box(0,0,80,100)}].map((fields,i)=>
      cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(6),Annots:cosArray(i===2?[]:[cosRef(12+i)]),...fields})),
    cosStream(Uint8Array.of(255,0,128,10),{compress:true}),cosDict({F1:cosRef(8)}),
    cosDict({Type:cosName("Font"),Subtype:cosName("Type1"),BaseFont:cosName("Helvetica")}),
    cosDict({Producer:cosString("Original tool"),Creator:cosString("Other"),Title:cosString("雪"),Author:cosString("Author"),Keywords:cosString("topic")}),
    cosDict({Fields:cosArray([cosRef(11),cosRef(13),cosRef(11)]),DR:cosRef(14),DA:cosString("/F1 10 Tf")}),
    cosDict({FT:cosName("Tx"),T:cosString("Parent field"),Kids:cosRef(16)}),
    cosDict({Type:cosName("Annot"),Subtype:cosName("Widget"),P:cosRef(3)}),
    cosDict({Type:cosName("Annot"),Subtype:cosName("Widget"),FT:cosName("Tx"),T:cosString("Page two"),P:cosRef(4)}),
    cosDict({Font:cosRef(7)}), cosDict({OCGs:cosArray([])}),cosArray([cosRef(12),cosDict({T:cosString("Unselected")})]),
  ];
  const input=serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1),infoRef:cosRef(9)});
  const fs=new MemoryFileSystem(), wasm=new RustWasmBash({cwd:"/",files:{"/in.pdf":input}});
  await fs.writeFile("/in.pdf",input);
  const { pdfuniteCommands } = await import("@poe-platform/safe-bash/commands/pdfunite");
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})).use(pdfuniteCommands({replace:true}));
  try {
    for(const [args,files] of [
      ["--split-pages chunks/x-%02d.pdf",["01","02","03"].map(n=>"/chunks/x-"+n+".pdf")],
      ["--split-pages=2 --rotate=+90:2-z output.pdf",["/output-1-2.pdf","/output-3-3.pdf"]],
      ["--split-pages=3 --remove-info stripped.pdf",["/stripped-1-3.pdf"]],
      ["--split-pages=2junk --rotate=90:1 --remove-info with-edits.pdf",["/with-edits-1-2.pdf","/with-edits-3-3.pdf"]],
      ["--split-pages=3 --remove-acroform noform.pdf",["/noform-1-3.pdf"]],
      ["--split-pages 2 ignored.pdf",["/2-1.pdf","/2-2.pdf","/2-3.pdf"]],
      ["--split-pages --replace-input",["/in-1.pdf","/in-2.pdf","/in-3.pdf"]],
    ]) {
      const script="qpdf in.pdf "+args, want=await js.exec(script), got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],args);
      for(const f of files) assert.deepEqual(Buffer.from(await wasm.fs.readFile(f)),Buffer.from(await fs.readFile(f)),f);
    }
    const merge="pdfunite chunks/x-03.pdf chunks/x-01.pdf chunks/x-02.pdf merged.pdf";
    for(const sh of [js,wasm]) {const r=await sh.exec(merge);assert.equal(r.exitCode,0,r.stderr);}
    assert.deepEqual(Buffer.from(await wasm.fs.readFile("/merged.pdf")),Buffer.from(await fs.readFile("/merged.pdf")),merge);
    const same="qpdf in.pdf --split-pages in.pdf", want=await js.exec(same), got=await wasm.exec(same);
    assert.equal(want.exitCode,2);
    assert.deepEqual([got.exitCode,got.stderr],[want.exitCode,want.stderr]);
  } finally {wasm.dispose();}
});

test("qpdf selects repeated and collated pages with their streams, resources, and base metadata", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosDict,cosRef,cosName,cosArray,cosNumber,cosString,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const document=(label,tag)=>{
    const nodes=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2),OCProperties:cosDict({OCGs:cosArray([])})}),
      cosDict({Type:cosName("Pages"),Kids:cosArray([3,4,5].map(n=>cosRef(n))),Count:cosNumber(3),
        MediaBox:cosArray([0,0,100,80].map(n=>cosNumber(n))),Resources:cosDict({Font:cosRef(9)})}),
      ...[3,4,5].map(n=>cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(n+3),Peer:cosRef(4)})),
      ...[1,2,3].map(n=>cosStream(Uint8Array.of(255,tag,0,n),{compress:true})),
      cosDict({F1:cosRef(10)}),cosDict({Type:cosName("Font"),BaseFont:cosName("Helvetica")}),
      cosDict({Producer:cosString("Original"),Title:cosString(label),Author:cosString("Author"),Subject:cosString("Not copied")})];
    return serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1),infoRef:cosRef(11)});
  };
  const files={"/a.pdf":document("雪",14),"/b.pdf":document("Second",27),"/bad.pdf":Buffer.from("broken")};
  const fs=new MemoryFileSystem(), wasm=new RustWasmBash({cwd:"/",files});
  for(const [path,data] of Object.entries(files))await fs.writeFile(path,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [script,code] of [
      ["qpdf a.pdf --pages . 2,1,2 -- result.pdf",0],
      ["qpdf --empty --pages a.pdf z-1,x2 b.pdf r2-z -- result.pdf",0],
      ["qpdf a.pdf --collate --pages . 2,1,2 b.pdf z-1 -- --rotate=+90:2 result.pdf",0],
      ["qpdf a.pdf --collate=2 --pages b.pdf z-1 . 2,1,2 -- result.pdf",0],
      ["qpdf a.pdf --pages . 1,x1 -- result.pdf",0],
      ["cat a.pdf | qpdf --empty --pages - 1 -- result.pdf",0],
      ["cat a.pdf | qpdf - --pages . 1 -- result.pdf",0],
      ["qpdf a.pdf --pages bad.pdf 1 -- result.pdf",1],
      ["qpdf a.pdf --pages . 9 -- a.pdf",1],
      ["qpdf a.pdf --pages . 9 missing.pdf 1 -- result.pdf",1],
      ["qpdf a.pdf --pages . 9 -- result.pdf",1],
      ["qpdf --empty --pages . 1 -- result.pdf",2],
      ["qpdf a.pdf --pages missing.pdf 1 -- result.pdf",2],
    ]) {
      const want=await js.exec(script), got=await wasm.exec(script);assert.equal(want.exitCode,code,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],script);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/result.pdf")),Buffer.from(await fs.readFile("/result.pdf")),script);
    }
  } finally {wasm.dispose();}
});

test("qpdf counts, inspects and rewrites inline pages in traversal order", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosDict,cosRef,cosName,cosArray,cosNumber,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const page=n=>cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(n)});
  const nodes=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),
    cosDict({Type:cosName("Pages"),Count:cosNumber(3),Kids:cosRef(6),MediaBox:cosArray([0,0,20,30].map(v=>cosNumber(v)))}),
    page(4),cosStream(Uint8Array.of(42,10,0),{compress:false}),cosStream(Uint8Array.of(255,31),{compress:true}),
    cosArray([page(5),cosRef(3),cosDict({Type:cosName("Pages"),Kids:cosArray([page(4)])})])];
  const input=serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const files={"/inline.pdf":input};
  const fs=new MemoryFileSystem(), wasm=new RustWasmBash({cwd:"/",files});await fs.writeFile("/inline.pdf",input);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const flags of ["--show-npages","--show-pages --with-images","--show-xref","--show-object=7","--show-object=8","--check",
      "--rotate=+90:1,3 -","--pages . 3,1,3 -- -","--empty --check"]) {
      const script=flags==="--empty --check"?"qpdf "+flags:"qpdf inline.pdf "+flags;
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      if(flags==="--show-npages")assert.equal(want.stdout,"3\n");
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf inspection validates encoded streams and reports linearization without extracting text", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosDict,cosRef,cosName,cosArray,cosNumber,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const pg=()=>cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(5)});
  const nodes=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),
    cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(3),cosRef(4)]),Count:cosNumber(2)}),pg(),pg(),
    cosStream(Uint8Array.of(254,0,17),{dict:cosDict({Filter:cosName("DCTDecode")}),compress:false}),
    cosDict({Linearized:cosNumber(1),L:cosRef(7),H:cosArray([cosNumber(22),cosRef(7)]),E:cosNumber(30)}),cosNumber(47)];
  const input=serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/lin.pdf":input}});await fs.writeFile("/lin.pdf",input);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const script of ["qpdf lin.pdf --show-npages","qpdf lin.pdf --check --show-npages","qpdf lin.pdf --show-linearization",
      "qpdf lin.pdf --show-pages --show-npages","qpdf lin.pdf --show-npages --show-encryption",
      "qpdf lin.pdf --show-linearization --check","qpdf --empty --show-xref","qpdf --empty --show-pages",
      "qpdf --empty --show-object=2","qpdf --empty --show-encryption","qpdf --empty --show-linearization"]) {
      const want=await js.exec(script),got=await wasm.exec(script);assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf recovers a wrong stream length and writes the recovered bytes with a correct length", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosDict,cosRef,cosName,cosArray,cosNumber,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const payload=Buffer.from("A\x00\xff endstream ignored\r\nreal payload","latin1");
  const nodes=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),
    cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(3)]),Count:cosNumber(1)}),
    cosDict({Type:cosName("Page"),Parent:cosRef(2),Contents:cosRef(4)}),cosStream(payload,{dict:cosDict({Pad:cosNumber(0)}),compress:false}),cosNumber(payload.length)];
  const pdf=Buffer.from(serializeCosDocument({objects:nodes.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)})).toString("latin1");
  const header="/Pad 0\n/Length "+payload.length;
  const replaceHeader=value=>Buffer.from(pdf.replace(header,value.padStart(header.length)),"latin1");
  const embeddedEnd=payload.toString("latin1").replace("endstream ignored","endstream endobj ");
  const files={
    "/wrong.pdf":replaceHeader("/Pad 0\n/Length 02"),
    "/missing.pdf":replaceHeader("/Pad 0\n/Ignore "+payload.length),
    "/indirect.pdf":replaceHeader("/Length 5 0 R"),
    "/repeated.pdf":Buffer.from(pdf.replace(header+"\n", "/Length 1/Length 2"), "latin1"),
    "/declared.pdf":Buffer.from(pdf.replace(payload.toString("latin1"),embeddedEnd),"latin1")
  };
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [path,bytes] of Object.entries(files)) {
      await fs.writeFile(path,bytes);
      for(const flags of ["--check","--show-object=4","--show-object=4 --raw-stream-data","-","--pages . 1 -- -"]) {
        const script="qpdf "+path+" "+flags,want=await js.exec(script),got=await wasm.exec(script);
        assert.equal(want.exitCode,0,want.stderr);
        if(flags.includes("--raw-stream-data"))assert.deepEqual(Buffer.from(want.stdoutBytes),path==="/declared.pdf"?Buffer.from(embeddedEnd,"latin1"):payload);
        assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
      }
    }
  } finally{wasm.dispose();}
});

test("qpdf reads the last row of overlapping xref subsections and stops at a visited revision", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  let body="%PDF-1.7\n";
  const offsets=[0];
  for(const value of ["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 20] >>","(earlier object)"]) {
    offsets.push(body.length);
    body+=offsets.length-1+" 0 obj\n"+value+"\nendobj\n";
  }
  const row=n=>String(n).padStart(10,"0")+" 00000 n \n";
  const old=body.length;
  body+="xref\n0 5\n0000000000 65535 f \n"+offsets.slice(1).map(row).join("")+
    "trailer << /Size 5 /Root 1 0 R >>\nstartxref\n"+old+"\n%%EOF\n";
  const newest=body.length;
  body+="4 0 obj\n(latest object)\nendobj\n";
  const xref=body.length;
  const revisions="xref\n3 2\n0000000000 00000 f \n"+row(offsets[4])+"3 2\n"+row(offsets[3])+row(newest);
  const files={
    "/overlap.pdf":Buffer.from(body+revisions+"trailer << /Size 5 /Prev "+old+" >>\nstartxref\n"+xref+"\n%%EOF"),
    "/deleted.pdf":Buffer.from(body+revisions+"4 1\n0000000000 00001 f \ntrailer << /Size 5 /Prev "+old+" >>\nstartxref\n"+xref+"\n%%EOF"),
    "/visited.pdf":Buffer.from(body+"xref\n1 4\n"+[...offsets.slice(1,4),newest].map(row).join("")+
      "trailer << /Size 5 /Root 1 0 R /Prev "+xref+" >>\nstartxref\n"+xref+"\n%%EOF")
  };
  files["/padded.pdf"]=Buffer.concat([files["/deleted.pdf"],Buffer.alloc(32768,32)]);
  files["/decimal.pdf"]=Buffer.from(files["/deleted.pdf"].toString().replace("startxref\n"+xref+"\n","startxref\n+"+xref+".0\n"));
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [path,data] of Object.entries(files)) {
      await fs.writeFile(path,data);
      for(const flags of ["--show-object=4","--show-pages","--check","--pages . 1 -- -"]) {
        const script="qpdf "+path+" "+flags,want=await js.exec(script),got=await wasm.exec(script);
        assert.equal(want.exitCode,0,want.stderr);
        if(flags==="--show-object=4")assert.equal(want.stdout,["/deleted.pdf","/padded.pdf","/decimal.pdf"].includes(path)?"null\n":"(latest object)\n");
        assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
      }
    }
  } finally {wasm.dispose();}
});
test("qpdf inspects and copies pages indexed by binary cross-reference streams", async () => {
  const {deflateSync}=await import("node:zlib");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const files={};
  for(const encoding of ["sparse","compressed","predicted"]) {
    const compressed=encoding!=="sparse";
    let body="%PDF-1.7\n";
    const offsets=[];
    for(const v of ["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 20] >>"]) {
      offsets.push(body.length);
      body+=offsets.length+" 0 obj\n"+v+"\nendobj\n";
    }
    const at=body.length;
    offsets.push(at);
    const rows=compressed?[0,0,0,255,...offsets.flatMap(n=>[1,n>>8,n&255,0])]:offsets.flatMap(n=>[n>>8,n&255]);
    const predicted=encoding==="predicted";
    const encoded=predicted?rows.flatMap((n,i)=>[...(i%4===0?[2]:[]),(n-(rows[i-4]??0))&255]):rows;
    const bytes=compressed?deflateSync(Buffer.from(encoded)):Buffer.from(encoded);
    body+="4 0 obj\n<< /Type /XRef /Size 5 /Root 1 0 R /W "+
      (compressed?"[1 2 1] /Filter /FlateDecode":"[0 2 0] /Index [1 2 3 2]")+
      (predicted?" /DecodeParms << /Predictor 12 /Columns 4 >>":"")+" /Length "+bytes.length+" >>\nstream\n"+bytes.toString("latin1")+"\nendstream\nendobj\n";
    if(encoding==="compressed") {
      const table=body.length;
      files["/hybrid.pdf"]=Buffer.from(body+"xref\n1 4\n"+"0000000000 00001 f \n".repeat(4)+
        "trailer << /Size 5 /Root 1 0 R /XRefStm "+at+" >>\nstartxref\n"+table+"\n%%EOF","latin1");
    }
    files["/"+encoding+".pdf"]=Buffer.from(body+"startxref\n"+at+"\n%%EOF","latin1");
  }
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [path,data] of Object.entries(files)) {
      await fs.writeFile(path,data);
      for(const flags of ["--check","--show-xref","--show-object=4 --raw-stream-data","--show-pages","--pages . 1 -- -","-"]) {
        const script="qpdf "+path+" "+flags,want=await js.exec(script),got=await wasm.exec(script);
        assert.equal(want.exitCode,0,want.stderr);
        assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
      }
    }
  } finally {wasm.dispose();}
});

test("qpdf decodes chained PDF byte filters, abbreviations and indirect filter arrays", async () => {
  const {deflateSync,deflateRawSync,gzipSync}=await import("node:zlib");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosArray,cosDict,cosName,cosNumber,cosRef,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const plain=Buffer.from([255,0,1,10,127,255,65]);
  const values=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),
    cosDict({Type:cosName("Pages"),Kids:cosArray([cosRef(3)]),Count:cosNumber(1)}),
    cosDict({Type:cosName("Page"),Parent:cosRef(2)})];
  const cases=[
    [cosDict({Filter:cosRef(13)}),Buffer.from(deflateSync(plain).toString("hex")+">ignored"),plain],
    [cosDict({F:cosName("AHx")}),Buffer.from("0f 0\x00B F>"),Buffer.from([15,11,240])],
    [cosDict({Filter:cosName("ASCII85Decode")}),Buffer.from("z 87cUR DZ~>"),Buffer.from([0,0,0,0,...Buffer.from("Hello")])],
    [cosDict({Filter:cosName("RunLengthDecode")}),Buffer.from([1,8,9,253,7,128,0]),Buffer.from([8,9,7,7,7,7])],
    [cosDict({Filter:cosName("RL")}),Buffer.from([254]),Buffer.alloc(3)],
    [cosDict({Filter:cosArray([cosName("DCTDecode"),cosName("Identity")])}),plain,plain],
    [cosDict({Filter:cosName("ASCIIHexDecode")}),Buffer.from("7a"),Buffer.from("z")],
    [cosDict({F:cosName("Fl")}),deflateRawSync(plain),plain],
    [cosDict({Filter:cosName("FlateDecode")}),gzipSync(plain),plain]
  ];
  values.push(...cases.map(([dict,buf])=>cosStream(buf,{dict,compress:false})),
    cosArray([cosRef(14),cosName("Fl")]),cosName("AHx"));
  const bytes=serializeCosDocument({objects:values.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/filters.pdf":bytes}});
  await fs.writeFile("/filters.pdf",bytes);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [i,[,encoded,decoded]] of cases.entries()) for(const [flag,expected] of [["raw",encoded],["filtered",decoded]]) {
      const script="qpdf /filters.pdf --show-object="+(i+4)+" --"+flag+"-stream-data";
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual(Buffer.from(want.stdoutBytes),expected,script);
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf reverses PNG and TIFF row predictors in filtered streams", async () => {
  const {deflateSync}=await import("node:zlib");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosArray,cosDict,cosName,cosNumber,cosRef,cosStream,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const cases=[
    [{Predictor:15,Columns:3,Colors:2},[0,1,2,3,4,5,6,1,1,2,3,4,5,6,2,9,8,7,6,5,4,3,1,2,3,4,5,6,4,1,2,3,4,5,6,2,7],30],
    [{Predictor:10,Columns:9,BitsPerComponent:1},[2,0x91,0x80,2,0x70,0],4],
    [{Predictor:2,Columns:3,Colors:2},[1,2,3,4,5,6,7,8,9,0,1,2],12],
    [{Predictor:2,Columns:3,Colors:2,BitsPerComponent:16},[0,255,0,2,0,1,255,255,0,1,0,4],12],
    ...[1,2,4].map(bits=>[{Predictor:2,Columns:3,BitsPerComponent:bits},[0xff,0x77,0x55],bits===4?2:3])
  ];
  const values=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),cosDict({Type:cosName("Pages"),Kids:cosArray([]),Count:cosNumber(0)})];
  for(const [i,[params,raw]] of cases.entries()) {
    const p=cosDict(Object.fromEntries(Object.entries(params).map(([k,n])=>[k,cosNumber(n)])));
    const dict=i===0?cosDict({Filter:cosArray([cosName("Fl")]),DP:cosArray([cosRef(4)])}):cosDict({Filter:cosName("FlateDecode"),DecodeParms:p});
    values.push(cosStream(deflateSync(Buffer.from(raw)),{compress:false,dict}),p);
  }
  const bytes=serializeCosDocument({objects:values.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/predict.pdf":bytes}});
  await fs.writeFile("/predict.pdf",bytes);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [i,[,,length]] of cases.entries()) {
      const script="qpdf /predict.pdf --show-object="+(3+i*2)+" --filtered-stream-data";
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      assert.equal(want.stdoutBytes.length,length);
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf decodes LZW phrase references, width changes and row predictors", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {cosArray,cosDict,cosName,cosNumber,cosRef,cosStream,serializeCosDocument,encodeLzw}=await import("@poe-code/pdf-ast");
  const sample=Buffer.from("ABABABA".repeat(60));
  const literals=Buffer.from(Array.from({length:2200},(_,i)=>i&255));
  // A clear code and a sequence of literals cross all three dictionary widths.
  function literalCodes(early) {
    const parts=["100000000"];
    const width=n=>n<255-early?9:n<767-early?10:n<1791-early?11:12;
    for(const [n,c] of literals.entries()) parts.push(c.toString(2).padStart(width(n),"0"));
    parts.push((257).toString(2).padStart(width(literals.length),"0"));
    const bits=parts.join("");return Buffer.from(bits.padEnd(Math.ceil(bits.length/8)*8,"0").match(/.{8}/g).map(s=>parseInt(s,2)));
  }
  const cases=[
    [encodeLzw(sample),{},sample],
    ...[0,1].map(n=>[literalCodes(n),{EarlyChange:cosNumber(n)},literals]),
    [encodeLzw(Uint8Array.of(4,3,2)),{Predictor:cosNumber(2),Columns:cosNumber(3)},Buffer.from([4,7,9])]
  ];
  const values=[cosDict({Type:cosName("Catalog"),Pages:cosRef(2)}),cosDict({Type:cosName("Pages"),Kids:cosArray([]),Count:cosNumber(0)}),
    ...cases.map(([raw,params],i)=>cosStream(raw,{compress:false,dict:cosDict({Filter:cosName(i%2?"LZW":"LZWDecode"),DecodeParms:cosDict(params)})}))];
  const bytes=serializeCosDocument({objects:values.map((value,i)=>({objectNumber:i+1,generationNumber:0,value})),rootRef:cosRef(1)});
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/lzw.pdf":bytes}});await fs.writeFile("/lzw.pdf",bytes);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [i,[,,expected]] of cases.entries()) {
      const script="qpdf /lzw.pdf --show-object="+(i+3)+" --filtered-stream-data";
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);assert.deepEqual(Buffer.from(want.stdoutBytes),expected);
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf reads and copies pages stored inside compressed PDF object streams", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {pdfinfoCommands}=await import("@poe-platform/safe-bash/commands/pdfinfo");
  const {pdftotextCommands}=await import("@poe-platform/safe-bash/commands/pdftotext");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("Index 雪");
  doc.addPage([50,55]).drawText("Alpha",{x:2,y:3});doc.addPage([70,75]).drawText("Beta",{x:4,y:5});
  const bytes=doc.save({objectStreams:"generate"});
  const previous=Number(Buffer.from(bytes).toString("latin1").split("startxref").at(-1).split("%%EOF")[0].trim());
  const revision="12 0 obj\n(latest)\nendobj\n";
  const increment=revision+"xref\n12 1\n"+String(bytes.length+1).padStart(10,"0")+" 00000 n \ntrailer << /Size 13 /Prev "+
    previous+" >>\nstartxref\n"+(bytes.length+1+revision.length)+"\n%%EOF";
  const files={"/obj.pdf":bytes,"/increment.pdf":Buffer.concat([bytes,Buffer.from("\n"+increment)])};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [path,data] of Object.entries(files))await fs.writeFile(path,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})).use(pdftotextCommands({replace:true})).use(pdfinfoCommands({replace:true}));
  try {
    const flags=["--show-npages","--show-xref","--show-object=3","--show-pages --with-images","--check","--pages . 2,1 -- -","-"];
    for(const script of [...flags.map(flag=>"qpdf obj.pdf "+flag),"qpdf increment.pdf --show-xref","pdftotext obj.pdf -","pdffonts obj.pdf","pdfinfo obj.pdf"]) {
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,0,want.stderr);
      if(script.endsWith("--show-npages"))assert.equal(want.stdout,"2\n");
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
    }
  } finally {wasm.dispose();}
});

test("qpdf writes generated object streams and binary indexes with production bytes", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument,cosArray,cosDict,cosName,cosNumber,cosRef,cosString,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("Pack 雪");
  doc.addPage([50,55]).drawText("One",{x:2,y:3});doc.addPage([70,75]).drawText("Two",{x:4,y:5});
  const bytes=Buffer.from(doc.save());bytes.write("%PDF-1.4");
  const sparse=(generation)=>serializeCosDocument({version:"1.4",rootRef:cosRef(8,2),objects:[
    {objectNumber:2,generationNumber:generation,value:cosDict({Type:cosName("Pages"),Count:cosNumber(0),Kids:cosArray([])})},
    {objectNumber:8,generationNumber:2,value:cosDict({Type:cosName("Catalog"),Pages:cosRef(2,generation)})}],
    idArray:cosArray([cosString("left"),cosString("right")])});
  const files={"/in.pdf":bytes,"/sparse.pdf":sparse(0),"/direct.pdf":sparse(3)};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [path,data] of Object.entries(files))await fs.writeFile(path,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [script,code] of [
      ["qpdf in.pdf --object-streams=generate -",0],["qpdf --empty --object-streams=generate -",0],
      ["qpdf in.pdf --pages . 2,1 -- --object-streams=generate -",0],
      ["qpdf sparse.pdf --object-streams=generate -",0],["qpdf direct.pdf --object-streams=generate -",0],
      ["qpdf in.pdf --rotate=+90:1 --object-streams=generate packed.pdf",0],
      ["qpdf packed.pdf --show-xref",0],["qpdf packed.pdf --object-streams=generate -",0],
      ["qpdf packed.pdf --object-streams=disable -",0],["qpdf packed.pdf --object-streams=preserve -",0],
      ["qpdf in.pdf --object-streams=bad packed.pdf",2]]) {
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,code,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes],[want.exitCode,want.stderr,want.stdoutBytes],script);
      if(script.endsWith(" packed.pdf"))assert.deepEqual(Buffer.from(await wasm.fs.readFile("/packed.pdf")),Buffer.from(await fs.readFile("/packed.pdf")));
    }
  } finally {wasm.dispose();}
});

test("qpdf stream and normalization options preserve real PDF objects and control packing", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("Original");doc.addPage([30,70]).drawText("Original",{x:1,y:3});
  const bytes=Buffer.from(doc.save());bytes.write("%PDF-1.4");
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/in.pdf":bytes,"/dest.pdf":"previous"}});
  await fs.writeFile("/in.pdf",bytes);await fs.writeFile("/dest.pdf",Buffer.from("previous"));
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [flags,code] of [
      ["--stream-data=preserve",0],["--stream-data=uncompress",0],["--compress-streams=y",0],["--normalize-content=y",0],
      ["--stream-data=compress --pages . 1,1 --",0],["--object-streams=generate --qdf",0],
      ["--qdf --object-streams=generate --normalize-content=n",0],["--object-streams=generate --compress-streams=n",0],
      ["--object-streams=generate --stream-data=uncompress --stream-data=preserve",0],
      ["--object-streams=generate --stream-data=uncompress --stream-data=unknown",0],
      ["--compress-streams=unknown",2],["--normalize-content=unknown",2]]) {
      const script="qpdf in.pdf "+flags+" dest.pdf",want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,code,want.stderr);assert.deepEqual([got.exitCode,got.stderr],[want.exitCode,want.stderr],script);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/dest.pdf")),Buffer.from(await fs.readFile("/dest.pdf")),script);
    }
  } finally {wasm.dispose();}
});

test("qpdf validates JSON options before publishing output", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/out":"unchanged"}});
  await fs.writeFile("/out",Buffer.from("unchanged"));
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    const invalid=["--json=3","--json-key=bad","--json=1 --json-key=qpdf","--json --json-key=objects","--json=2 --json-key=objectinfo",
      "--json-stream-data=external",...["0","2147483648","1,65536","1,","1,2,3","+1","1/a","obj:1"].map(v=>"--json-object="+v)];
    for(const script of [...invalid.map(v=>"qpdf --empty "+v+" out"),"qpdf --empty --json --json-stream-data=file",
      "qpdf --empty --json --json-stream-data=file --json-stream-prefix= out"]) {
      const want=await js.exec(script),got=await wasm.exec(script);
      assert.equal(want.exitCode,2,script);assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],script);
      assert.equal(Buffer.from(await wasm.fs.readFile("/out")).toString(),"unchanged");
    }
  } finally {wasm.dispose();}
});

test("qpdf exports indexed objects, decoded streams and page references in both JSON formats", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument,cosBool,cosDict,cosName,cosString,cosNumber,cosArray,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("Index 雪");doc.addPage([51,52]).drawText("First",{x:1,y:3});doc.addPage([70,90]);
  const cat=doc.cos.resolveDict(doc.cos.rootRef);
  dictSet(cat,"PageLabels",cosDict({Nums:cosArray([cosNumber(0),cosDict({S:cosName("r"),P:cosString("π"),St:cosNumber(3)})])}));
  const stream=doc.cos.allocateObject(cosStream(Uint8Array.of(255,0,77,9),{compress:true}));
  const parent=doc.cos.allocateObject(cosDict({T:cosString("contact"),FT:cosName("Tx"),V:cosString("inherited")}));
  dictSet(doc.cos.resolveDict(parent),"Kids",cosArray([cosDict({T:cosString("address"),Parent:parent})]));
  const box=doc.cos.allocateObject(cosDict({T:cosName("checked"),FT:cosName("Btn"),V:cosName("Yes")}));
  dictSet(cat,"AcroForm",cosDict({NeedAppearances:cosBool(true),Fields:cosArray([parent,box])}));
  const dest=cosArray([doc.getPage(1).ref,cosName("Fit")]);
  const first=doc.cos.allocateObject(cosDict({Title:cosString("first"),Dest:dest}));
  const child=doc.cos.allocateObject(cosDict({Title:cosString("nested"),A:cosDict({D:cosString("second")}),Next:first}));
  dictSet(doc.cos.resolveDict(first),"First",child);
  dictSet(cat,"Outlines",cosDict({First:first}));
  const spec=doc.cos.allocateObject(cosDict({F:cosString("file.bin"),EF:cosDict({F:stream})}));
  dictSet(cat,"Names",cosDict({Dests:cosDict({Names:cosArray([cosString("second"),dest])}),
    EmbeddedFiles:cosDict({Names:cosArray(["9","2","__proto__","attachment"].flatMap(k=>[cosString(k),spec]))})}));
  const input=doc.save(),packed=doc.save({objectStreams:"generate"});
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/a.pdf":input,"/b.pdf":packed}});
  await fs.writeFile("/a.pdf",input);await fs.writeFile("/b.pdf",packed);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const script of ["qpdf a.pdf --json=1 --json-key=pages","qpdf b.pdf --json",
      "qpdf a.pdf --json=2 --json-object=3 --json-object=trailer","qpdf --empty --json=1",
      "qpdf a.pdf --json --json-stream-data=inline --json-object="+stream.objectNumber,
      "qpdf a.pdf --json --json-stream-data=file --json-stream-prefix=data- --json-object="+stream.objectNumber+" dest.json"]) {
      const want=await js.exec(script),got=await wasm.exec(script);assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],script);
      if(script.endsWith("dest.json"))for(const name of ["/dest.json","/data-"+stream.objectNumber])
        assert.deepEqual(Buffer.from(await wasm.fs.readFile(name)),Buffer.from(await fs.readFile(name)));
    }
  } finally {wasm.dispose();}
});

test("qpdf JSON preserves prior files after a late stream decode failure", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument,cosName,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.addPage();
  const first=doc.cos.allocateObject(cosStream(Uint8Array.of(1,2),{compress:false}));
  const bad=cosStream(Uint8Array.of(3),{compress:false});
  dictSet(bad.dict,"Filter",cosName("UnsupportedJsonFilter"));doc.cos.allocateObject(bad);
  const files={"/in.pdf":doc.save(),"/out.json":"original",["/stream-"+first.objectNumber]:"prior"};
  const fs=new MemoryFileSystem(), wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,bytes] of Object.entries(files))await fs.writeFile(name,Buffer.from(bytes));
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const mode of ["inline","file"]) {
      const cmd="qpdf in.pdf --json --json-stream-data="+mode+" --json-stream-prefix=stream- out.json";
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.notEqual(want.exitCode,0);
      assert.deepEqual([got.exitCode,got.stdout,got.stderr],[want.exitCode,want.stdout,want.stderr]);
      for(const name of Object.keys(files).slice(1))assert.equal(Buffer.from(await wasm.fs.readFile(name)).toString(),files[name]);
    }
  } finally {wasm.dispose();}
});

test("qpdf counts the final JSON destination once when a stream has the same filename", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument,cosStream}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.addPage();
  const ref=doc.cos.allocateObject(cosStream(new Uint8Array(1024).fill(5),{compress:true}));
  const input=doc.save(),fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files:{"/in.pdf":input}});
  await fs.writeFile("/in.pdf",input);
  const name="out-"+ref.objectNumber,cmd="qpdf in.pdf --json --json-object="+ref.objectNumber+
    " --json-stream-data=file --json-stream-prefix=out- "+name;
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    const first=await js.exec(cmd);assert.equal(first.exitCode,0,first.stderr);
    const expected=await fs.readFile("/"+name);
    const limit=Math.max(expected.length,1024);
    js.use(qpdfCommands({replace:true,limits:{maxOutputBytes:limit}}));
    const want=await js.exec(cmd),got=await wasm.exec(cmd,{limits:{maxOutputBytes:limit}});
    assert.equal(want.exitCode,0,want.stderr);
    assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout]);
    assert.deepEqual(Buffer.from(await wasm.fs.readFile("/"+name)),Buffer.from(expected));
  } finally {wasm.dispose();}
});

test("qpdf JSON validates the input before report options, including stdin and prefixed PDF headers", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  let body="prefix\n%PDF-1.5\n";const offsets=[];
  for(const [i,value] of ["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [] /Count 0 >>"].entries()) {
    offsets.push(body.length);body+=(i+1)+" 0 obj\n"+value+"\nendobj\n";
  }
  const at=body.length;
  body+="xref\n0 3\n0000000000 65535 f \n"+offsets.map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+
    "trailer << /Root 1 0 R /Size 3 >>\nstartxref\n"+at+"\n%%EOF";
  const files={"/prefixed.pdf":Buffer.from(body),"/bad":Buffer.from("text"),"/out":Buffer.from("prior")};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [k,v] of Object.entries(files))await fs.writeFile(k,v);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const cmd of ["qpdf --json","qpdf missing --json=1 --json-key=qpdf out","qpdf bad --json --json-stream-data=file",
      "cat bad | qpdf - --json out","qpdf prefixed.pdf --json=2"]) {
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.equal(want.exitCode,cmd.includes("prefixed.pdf")?0:2);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],cmd);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out")),files["/out"]);
    }
  } finally {wasm.dispose();}
});

test("qpdf recovers missing cross-references from object bodies, including packed objects", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument,cosStream}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("repaired 雪");doc.addPage().drawText("first",{x:1,y:2});doc.addPage();
  const unreferenced=doc.cos.allocateObject(cosStream(Buffer.from("99 0 obj << /Type /Catalog >> endobj\ntrailer << /Encrypt 123 0 R >>"),{compress:false}));
  const plain=Buffer.from(doc.save()),packed=Buffer.from(doc.save({objectStreams:"generate"}));
  const missing=plain.subarray(0,plain.lastIndexOf("\nxref\n"));
  const previous=Number(plain.toString("latin1").split("startxref").at(-1).split("%%EOF")[0].trim());
  const stray="\n88 0 obj (unindexed) endobj\n";
  const damagedRow="xref\n"+doc.getPage(1).ref.objectNumber+" 1\n0000000001 00000 n \n"+
    unreferenced.objectNumber+" 1\n0000000000 00001 f \ntrailer << /Prev "+previous+" /Size 89 >>\nstartxref\n"+(plain.length+stray.length)+"\n%%EOF";
  const files={
    "/prefixed.pdf":Buffer.concat([Buffer.from("leading bytes\n"),plain]),
    "/partial.pdf":Buffer.concat([plain,Buffer.from(stray+damagedRow)]),
    "/wrong-root.pdf":Buffer.from(plain.toString("latin1").replace("/Root 1 0 R","/Root 2 0 R"),"latin1"),
    "/missing-root.pdf":Buffer.from(plain.toString("latin1").replace("/Root 1 0 R","/FooX 1 0 R"),"latin1"),
    "/bad-row.pdf":Buffer.from(plain.toString("latin1").replace(
      String(plain.indexOf(doc.getPage(1).ref.objectNumber+" 0 obj")).padStart(10,"0")+" 00000 n","0000000001 00000 n"),"latin1"),
    "/missing.pdf":missing,
    "/revised.pdf":Buffer.concat([missing,Buffer.from("\n% 90 0 obj true endobj\n36 1 obj (first) endobj\n37 0 obj (second) endobj\n36 2 obj (latest) endobj\n")]),
    "/bad-pointer.pdf":Buffer.concat([plain.subarray(0,plain.lastIndexOf("startxref")),Buffer.from("startxref\n99999999\n%%EOF")]),
    "/packed.pdf":packed.subarray(0,packed.lastIndexOf("startxref"))
  };
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,bytes] of Object.entries(files))await fs.writeFile(name,bytes);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const name of Object.keys(files))for(const args of ["--check","--json --json-key=pages","--show-xref","--show-pages","--pages . 2,1 -- -","-"]) {
      const cmd="qpdf "+name+" "+args;
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,Buffer.from(got.stdoutBytes)],[want.exitCode,want.stderr,Buffer.from(want.stdoutBytes)],cmd);
    }
  } finally {wasm.dispose();}
});

test("qpdf inspects and saves catalogs without an indirect page tree",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const files={"/prefixed":Buffer.from("prefix\n%PDF-1.ÿ\n1 0 obj << /Type /Catalog >> endobj\n","latin1")};
  for(const [name,pages] of Object.entries({empty:"",dangling:"/Pages 12 0 R",inline:"/Pages << /Type /Pages /Kids [<< /Type /Page /MediaBox [0 0 10 20] >>] >>"})){
    files["/"+name]=Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog "+pages+" >> endobj\n");
  }
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  const rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,bytes] of Object.entries(files)){
      await fs.writeFile(path,bytes);
      for(const args of ["--show-npages","--show-xref","--json","--check","-","--linearize -","--object-streams=generate -"]){
        const cmd="qpdf "+path+" "+args;
        const e=await js.exec(cmd),r=await rs.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr,Buffer.from(r.stdoutBytes)],[e.exitCode,e.stderr,Buffer.from(e.stdoutBytes)],cmd);
      }
      if(path==="/inline"){
        const cmd="qpdf /inline --remove-info --split-pages part.pdf";
        for(const sh of [js,rs])assert.equal((await sh.exec(cmd)).exitCode,0);
        assert.deepEqual(Buffer.from(await rs.fs.readFile("/part-1.pdf")),Buffer.from(await fs.readFile("/part-1.pdf")));
      }
    }
  }finally{rs.dispose();}
});

test("qpdf refuses to replace output when a damaged PDF has no recoverable catalog",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const bytes=Buffer.from("%PDF-1.7\n12 0 obj << /Title (no catalog) >> endobj\ntrailer << /Root 12 0 R >>");
  const files={"/truncated.pdf":bytes,"/out.json":Buffer.from("original")};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,data] of Object.entries(files))await fs.writeFile(name,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const cmd of ["qpdf truncated.pdf --json --json-key=pages out.json",
      "cat truncated.pdf | qpdf - --json=1 --json-key=qpdf out.json",
      "qpdf truncated.pdf --show-pages","qpdf truncated.pdf out.json"]) {
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.equal(want.exitCode,2);assert.match(want.stderr,/no \/Type \/Catalog object found/);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout]);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out.json")),files["/out.json"]);
    }
  } finally {wasm.dispose();}
});

test("qpdf encryption predicates inspect the input bytes before parsing the document",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.addPage();
  const files={"/locked.pdf":doc.save({encrypt:{revision:3,userPassword:"reader",ownerPassword:"owner"}}),
    "/plain.pdf":doc.save(),"/boundary":Buffer.concat([Buffer.alloc(65533,32),Buffer.from("/Encrypt")]),"/noise":Buffer.from("not a pdf")};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,data] of Object.entries(files))await fs.writeFile(name,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const flag of ["--is-encrypted","--requires-password"])for(const input of ["locked.pdf","plain.pdf","boundary","noise","missing","-"]) {
      const cmd=(input==="-"?"cat boundary | ":"")+"qpdf "+input+" "+flag;
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],cmd);
    }
  } finally {wasm.dispose();}
});

test("qpdf authenticates standard PDF passwords and decrypts strings and streams",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("Titel 雪");doc.addPage().drawText("private",{x:2,y:3});
  const locked=doc.save({encrypt:{revision:3,userPassword:"réader",ownerPassword:"öwner"}});
  const empty=doc.save({encrypt:{revision:3,userPassword:"",ownerPassword:"writer"}});
  const files={"/damaged":locked.subarray(0,Buffer.from(locked).lastIndexOf("startxref")),"/locked":locked,"/empty":empty,"/out":Buffer.from("prior")};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,data] of Object.entries(files))await fs.writeFile(name,data);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const cmd of ["qpdf damaged --json out","qpdf damaged --password=öwner --json --json-stream-data=inline",
      "qpdf damaged --password=réader --requires-password","qpdf locked --password=réader --requires-password","qpdf locked --password=öwner --requires-password",
      "qpdf locked --password=wrong --requires-password","qpdf empty --password= --requires-password",
      "qpdf locked --json out","qpdf locked --password=wrong --show-encryption","qpdf locked --password=réader --show-encryption",
      "qpdf locked --password=öwner --check","qpdf locked --password=réader --json --json-stream-data=inline",
      "qpdf empty --json=1","qpdf locked --password=öwner --show-object=4 --filtered-stream-data"]) {
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],cmd);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out")),Buffer.from(await fs.readFile("/out")));
    }
  } finally {wasm.dispose();}
});

test("qpdf rewrites, decrypts and selects pages with each input's password",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("私");doc.addPage().drawText("secret",{x:8,y:9});doc.addPage();
  const files={"/a.pdf":doc.save({encrypt:{revision:3,userPassword:"reader",ownerPassword:"owner"}}),
    "/b.pdf":doc.save({encrypt:{revision:3,userPassword:"second",ownerPassword:"owner2"}}),"/out.pdf":Buffer.from("original")};
  const fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [name,bytes] of Object.entries(files))await fs.writeFile(name,bytes);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const cmd of ["qpdf a.pdf --password=bad --decrypt out.pdf","qpdf a.pdf --password=owner out.pdf",
      "qpdf a.pdf --password=reader --object-streams=generate --decrypt out.pdf",
      "qpdf --password=reader a.pdf --pages . 2,1 b.pdf --password=second 1 -- out.pdf",
      "qpdf --password=reader a.pdf --pages . 1 . --password=bad 2 -- out.pdf",
      "qpdf a.pdf --password=reader --split-pages=1 split-%d.pdf"]) {
      const want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],cmd);
      for(const path of cmd.includes("split-")?["/split-1.pdf","/split-2.pdf"]:["/out.pdf"]){
        assert.deepEqual(Buffer.from(await wasm.fs.readFile(path)).toString("latin1"),Buffer.from(await fs.readFile(path)).toString("latin1"),cmd);
      }
    }
  } finally {wasm.dispose();}
});

test("qpdf opens AES-256 PDFs with user and owner passwords and preserves output on failure",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const doc=PdfDocument.create();doc.setTitle("AES 雪");doc.addPage().drawText("confidential",{x:4,y:6});
  const input=doc.save({encrypt:{revision:6,userPassword:"réader",ownerPassword:"öwner"}});
  const files={"/aes.pdf":input,"/out":Buffer.from("prior")},fs=new MemoryFileSystem(),wasm=new RustWasmBash({cwd:"/",files});
  for(const [k,v] of Object.entries(files))await fs.writeFile(k,v);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const args of ["--password=réader --requires-password","--password=bad --decrypt out","--json out",
      "--password=öwner --show-encryption","--password=réader --json --json-stream-data=inline",
      "--password=öwner --decrypt out","--password=réader --show-object=4 --raw-stream-data"]) {
      const cmd="qpdf aes.pdf "+args,want=await js.exec(cmd),got=await wasm.exec(cmd);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[want.exitCode,want.stderr,want.stdout],cmd);
      assert.deepEqual(Buffer.from(await wasm.fs.readFile("/out")).toString("latin1"),Buffer.from(await fs.readFile("/out")).toString("latin1"),cmd);
    }
  } finally {wasm.dispose();}
});

test("qpdf consumes explicit Crypt filters in order and retains the remaining filters", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { PdfDocument, cosStream } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(), plain = Buffer.from("filtered payload");
  doc.addPage();
  const id = doc.cos.allocateObject(cosStream(plain, {compress:true})).objectNumber;
  const original = Buffer.from(doc.save({encrypt:{userPassword:"reader",ownerPassword:"owner"}})).toString("latin1");
  const prev = Number(original.split("startxref").at(-1).split("%%EOF")[0].trim());
  const object = original.slice(original.indexOf(id+" 0 obj\n"));
  const cipher = Buffer.from(object.split("\nstream\n")[1].split("\nendstream")[0], "latin1");
  const files = {};
  for (const [path, dict, data] of [
    ["/direct", "/Filter /Crypt", plain],
    ["/chain", "/F 50 0 R /DP [null << /Name /StdCF >> null]", Buffer.from(cipher.toString("hex")+">")],
  ]) {
    let source = original + "\n";
    const offsets = [];
    for (const [num, value] of [[id, "<< "+dict+" /Length "+data.length+" >>\nstream\n"+data.toString("latin1")+"\nendstream"],
      [50, "[/ASCIIHexDecode /Crypt /FlateDecode]"]]) {
      offsets.push([num,source.length]);
      source += num+" 0 obj\n"+value+"\nendobj\n";
    }
    const at = source.length;
    source += "xref\n"+offsets.map(([num,offset])=>num+" 1\n"+String(offset).padStart(10,"0")+" 00000 n \n").join("")+
      "trailer << /Size 51 /Prev "+prev+" >>\nstartxref\n"+at+"\n%%EOF\n";
    files[path] = Buffer.from(source, "latin1");
  }
  const fs = new MemoryFileSystem(), rust = new RustWasmBash({cwd:"/",files});
  for (const [path, bytes] of Object.entries(files)) await fs.writeFile(path, bytes);
  const js = new Shell({cwd:"/",fs}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const path of Object.keys(files)) for (const args of ["--show-object="+id+" --filtered-stream-data",
      "--show-object="+id+" --raw-stream-data","--show-object="+id,"--json --json-stream-data=inline","--decrypt out"]) {
      const cmd = "qpdf "+path+" --password=reader "+args, want = await js.exec(cmd), got = await rust.exec(cmd);
      assert.equal(want.exitCode, 0, want.stderr);
      if (args.endsWith("--filtered-stream-data")) assert.equal(want.stdout, plain.toString());
      assert.deepEqual([got.exitCode,got.stderr,got.stdoutBytes], [want.exitCode,want.stderr,want.stdoutBytes], cmd);
      if (args === "--decrypt out") assert.deepEqual(await rust.fs.readFile("/out"), await fs.readFile("/out"), cmd);
    }
  } finally { rust.dispose(); }
});

test("qpdf accepts Unicode passwords from independent revision 5 and 6 writers", async () => {
  const { readFile } = await import("node:fs/promises");
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { qpdfCommands } = await import("@poe-platform/safe-bash/commands/qpdf");
  const { PdfDocument } = await import("@poe-code/pdf-ast");
  const fs = new MemoryFileSystem(), rust = new RustWasmBash({cwd:"/"});
  const js = new Shell({cwd:"/",fs}).use(agentCommands()).use(qpdfCommands({replace:true}));
  const doc = PdfDocument.create();
  doc.addPage();
  const password = "Ｆ\u00ad\u200b\u1100\u1161\u11a8A\u0315\u030a\u0301", canonical = "F 각Ǻ\u0315";
  try {
    for (const [file, pw] of [["pdfjs-saslprep-r6", "SªSL\u00adprep"], ["pypdf-r5-saslprep", "SªSL\u00adprep"],
      ["pdfjs-issue19484_1", ""], ["pdfjs-issue6010_2", "æøå"], [null, password]]) {
      const bytes = file ? await readFile(new URL("../../pdf-ast/src/fixtures/"+file+".pdf", import.meta.url))
        : doc.save({encrypt:{revision:6,userPassword:canonical,ownerPassword:"owner"}});
      await fs.writeFile("/in", bytes);
      await rust.fs.writeFile("/in", bytes);
      const cmd = "qpdf in --password='"+pw+"' --show-npages", expected = await js.exec(cmd), got = await rust.exec(cmd);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.deepEqual([got.exitCode, got.stderr, got.stdout], [0, expected.stderr, expected.stdout], file ?? "combining characters");
    }
  } finally { rust.dispose(); }
});

test("qpdf decrypts a linearized PDF with 40-bit revision 4 object streams", async () => {
  const {readFile} = await import("node:fs/promises");
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const {qpdfCommands} = await import("@poe-platform/safe-bash/commands/qpdf");
  const bytes = await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue19484_1.pdf", import.meta.url));
  const fs = new MemoryFileSystem(), rust = new RustWasmBash({cwd:"/",files:{"/in":bytes}});
  await fs.writeFile("/in",bytes);
  const js = new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for (const args of ["--show-encryption","--json --json-stream-data=inline"]) {
      const want = await js.exec("qpdf in "+args), got = await rust.exec("qpdf in "+args);
      assert.equal(want.exitCode,0,want.stderr);
      assert.deepEqual([got.exitCode,got.stderr,got.stdout],[0,want.stderr,want.stdout]);
    }
    // Ignore linearization for the byte comparison so regenerated hint tables
    // do not mask differences in decrypted objects or stream payloads.
    const unhinted = Buffer.from(bytes);
    unhinted.write("OriginalXX", unhinted.indexOf("/Linearized")+1, "ascii");
    for (const backend of [fs,rust.fs]) await backend.writeFile("/in",unhinted);
    const cmd = "qpdf in --decrypt out", want = await js.exec(cmd), got = await rust.exec(cmd);
    assert.equal(want.exitCode,0,want.stderr);
    assert.deepEqual([got.exitCode,got.stderr],[0,want.stderr]);
    const actual = Buffer.from(await rust.fs.readFile("/out")), expected = Buffer.from(await fs.readFile("/out"));
    assert.ok(actual.equals(expected), "first byte difference: "+expected.findIndex((v,i)=>actual[i]!==v));
  } finally { rust.dispose(); }
});

test("qpdf writes interoperable AES-256 files with separate passwords and permissions", async t => {
  const {PdfDocument,cosDict,cosName,cosString,dictSet,dictGet} = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create();
  doc.setTitle("private metadata");
  doc.addPage().drawText("private text", {x:10,y:10});
  const secret = "custom private string";
  const root = doc.cos.resolveDict(doc.cos.rootRef);
  dictSet(root, "Evidence", cosString(secret));
  dictSet(root, "Signature", cosDict({Type:cosName("Sig"), Contents:cosString("public signature")}));
  const rust = new RustWasmBash({cwd:"/",files:{"/in":doc.save(),"/payload":Buffer.from("private attachment")}});
  try {
    let previous;
    for (const bits of [128,256]) {
      const result = await rust.exec("qpdf in --add-attachment payload -- --encrypt 'réader' owner "+bits+" --print=none --extract=n -- out");
      assert.equal(result.exitCode,0,result.stderr);
      const bytes = Buffer.from(await rust.fs.readFile("/out"));
      assert.throws(()=>PdfDocument.load(bytes,{password:"wrong"}), /Invalid PDF password/);
      for (const password of ["re\u0301ader","owner"]) {
        const parsed = PdfDocument.load(bytes,{password});
        assert.equal(parsed.cos.encryption.revision,6);
        assert.equal(parsed.cos.encryption.permissions.print,false);
        assert.equal(parsed.cos.encryption.permissions.copy,false);
        assert.equal(parsed.cos.encryption.permissions.modify,true);
        assert.match(parsed.extractText(), /private text/);
      }
      assert.ok(!bytes.includes(secret) && !bytes.includes("private attachment"));
      assert.ok(bytes.includes("public signature"));
      assert.equal((await rust.exec("qpdf out --password=owner --show-attachment=payload")).stdout,"private attachment");
      const cos = PdfDocument.load(bytes,{password:"owner"}).cos, key = cos.encryption.fileKey;
      const {createDecipheriv} = await import("node:crypto");
      const decipher = createDecipheriv("aes-256-ecb",key,null);
      decipher.setAutoPadding(false);
      const perms = Buffer.concat([decipher.update(dictGet(cos.resolveDict(cos.encryptRef),"Perms").bytes),decipher.final()]);
      assert.equal(perms.readInt32LE(),-1048);
      assert.deepEqual([...perms.subarray(4,12)],[255,255,255,255,84,97,100,98]);
      if (previous) assert.notDeepEqual(previous,key);
      previous = key;
    }
    for (const cmd of ["pdfinfo out","pdftotext -upw wrong out -","pdfdetach -list out"]) {
      const failure=await rust.exec(cmd);
      assert.equal(failure.exitCode,1,cmd);
      assert.equal(failure.stdout,"");
      assert.match(failure.stderr,/password/i);
    }
    assert.match((await rust.exec("pdftotext -opw owner out -")).stdout,/private text/);
    assert.match((await rust.exec("pdfinfo -upw réader out")).stdout,/yes \(print:no copy:no change:yes addNotes:yes algorithm:AES-256\)/);
    assert.match((await rust.exec("pdfdetach -upw réader -list out")).stdout,/payload/);
    const prior = await rust.fs.readFile("/out");
    t.mock.method(globalThis.crypto,"getRandomValues",()=>{throw new Error("no entropy");});
    const failed = await rust.exec("qpdf in --encrypt user owner 256 -- out");
    assert.notEqual(failed.exitCode,0);
    assert.deepEqual(await rust.fs.readFile("/out"),prior);
  } finally {rust.dispose();}
});

test("wkhtmltopdf writes heading fonts, nested outlines and page destinations as PDF objects",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const fs=new MemoryFileSystem(), files={"/a.html":Buffer.from("<h1>Private</h1><p>First paragraph</p><h2>Nested</h2><h2>Sibling</h2>"),
    "/b.html":Buffer.from("<p>Another page</p><h1>Second</h1>")}, rust=new RustWasmBash({cwd:"/",files});
  for(const [name,data] of Object.entries(files)) await fs.writeFile(name,data);
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true}));
  try {
    for(const opts of ["","--no-outline","--copies 2"]){
      const cmd="wkhtmltopdf "+opts+" a.html b.html out";
      const want=await js.exec(cmd), got=await rust.exec(cmd);
      assert.equal(want.exitCode,0,want.stderr);
      assert.equal(got.exitCode,0,got.stderr);
      const a=Buffer.from(await rust.fs.readFile("/out")), b=Buffer.from(await fs.readFile("/out"));
      assert.ok(a.equals(b),cmd+" byte "+b.findIndex((v,i)=>v!==a[i]));
    }
  } finally {rust.dispose();}
});

test("qpdf writes and repairs fixed-width linearization offsets across edits",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {readFile}=await import("node:fs/promises");
  const doc=PdfDocument.create();doc.addPage().drawText("one",{x:8,y:9});doc.addPage();
  const files={"/in":doc.save(),"/note":Buffer.from("note"),"/old":await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue19484_1.pdf",import.meta.url))};
  const fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files});
  for(const [p,b] of Object.entries(files))await fs.writeFile(p,b);
  const js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  try {
    for(const [src,args] of [["in","--linearize --add-attachment note --"],["out","--linearize"],["old","--decrypt"]]){
      const dest=src==="out"?"again":"out",cmd="qpdf "+src+" "+args+" "+dest;
      const want=await js.exec(cmd),got=await rust.exec(cmd);
      assert.deepEqual([got.exitCode,got.stderr],[want.exitCode,want.stderr]);
      const a=Buffer.from(await rust.fs.readFile("/"+dest)),b=Buffer.from(await fs.readFile("/"+dest));
      assert.ok(a.equals(b),cmd+" byte "+b.findIndex((v,i)=>v!==a[i]));
      assert.match((await rust.exec("pdfinfo "+dest)).stdout,/Optimized:\s+yes/);
    }
  } finally {rust.dispose();}
});

test("pdftk cat and shuffle copy selected objects, bookmarks and attachments into readable PDFs", async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files:{"/a.html":Buffer.from("<title>First</title><h1>Chapter A</h1>"),"/note":Buffer.from("attached")}});
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try {
    const b=PdfDocument.create(); b.addPage().drawText("Second",{x:10,y:20});
    await rust.fs.writeFile("/b",b.save());
    assert.equal((await rust.exec("wkhtmltopdf a.html a.pdf && qpdf a.pdf --add-attachment note -- a")).exitCode,0);
    for(const p of ["/a","/b"])await fs.writeFile(p,await rust.fs.readFile(p));
    for(const mode of ["cat","shuffle Y1 Z1right Z1"]){
      const cmd="pdftk Z=a Y=b "+mode+" output out";
      const expected=await js.exec(cmd),actual=await rust.exec(cmd);
      assert.deepEqual([actual.exitCode,actual.stderr],[expected.exitCode,expected.stderr]);
      const bytes=await rust.fs.readFile("/out"),ref=await fs.readFile("/out");
      assert.ok(Buffer.from(bytes).equals(ref),cmd+" byte "+ref.findIndex((value,i)=>bytes[i]!==value));
      const doc=PdfDocument.load(bytes),want=PdfDocument.load(ref);
      assert.equal(doc.extractText(),want.extractText());
      assert.deepEqual(doc.getPages().map(p=>p.getRotation()),want.getPages().map(p=>p.getRotation()));
      assert.equal((await rust.exec("qpdf out --show-attachment=note")).stdout,"attached");
      const dump="pdftk out dump_data_utf8";
      assert.equal((await rust.exec(dump)).stdout,(await js.exec(dump)).stdout);
    }
  } finally {rust.dispose();}
});

test("pdftk protects copied PDFs with distinct credentials and honors allow permissions",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.addPage().drawText("secret page",{x:10,y:30});
  const data=doc.save(),rust=new RustWasmBash({cwd:"/",files:{"/in":data}}),fs=new MemoryFileSystem();
  await fs.writeFile("/in",data);
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try {
    for(const cmd of ["pdftk in output out user_pw reader owner_pw owner",
      "pdftk in cat 1right owner_pw owner allow Printing CopyContents output out user_pw reader",
      "pdftk out input_pw reader cat 1 output out user_pw reader owner_pw owner allow ModifyAnnotations"]){
      for(const [shell,files] of [[js,fs],[rust,rust.fs]]){
        const result=await shell.exec(cmd);
        assert.equal(result.exitCode,0,result.stderr);
        const bytes=await files.readFile("/out");
        assert.throws(()=>PdfDocument.load(bytes,{password:"wrong"}),/Invalid PDF password/);
        for(const password of ["reader","owner"])assert.match(PdfDocument.load(bytes,{password}).extractText(),/secret page/);
      }
      const read=async files=>PdfDocument.load(await files.readFile("/out"),{password:"reader"});
      const a=await read(rust.fs),b=await read(fs);
      assert.equal(a.getPage(0).getRotation(),b.getPage(0).getRotation());
      assert.deepEqual(a.cos.encryption.permissions,b.cos.encryption.permissions);
    }
    const prior=await rust.fs.readFile("/out");
    const refused=await rust.exec("pdftk in update_info missing output out user_pw secret");
    assert.notEqual(refused.exitCode,0);
    assert.deepEqual(await rust.fs.readFile("/out"),prior);
  } finally {rust.dispose();}
});

test("pdftk burst writes standalone page graphs and the source document report",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.setTitle("Source");doc.setCreator("Authoring app");
  for(const s of ["first","second"])doc.addPage().drawText(s,{x:21,y:32});
  const input=doc.save({encrypt:{userPassword:"reader",ownerPassword:"owner"}});
  const rust=new RustWasmBash({cwd:"/",files:{"/in":input}}),fs=new MemoryFileSystem();
  await fs.writeFile("/in",input);
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try {
    for(const [pattern,outputs] of [["page_%%_%02d",["page_%_01","page_%_02"]],["same",["same"]],["-",[]]]){
      const cmd="pdftk in input_pw reader burst output "+pattern;
      for(const shell of [js,rust]){const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      for(const name of [...outputs,"doc_data.txt"])assert.deepEqual(await rust.fs.readFile("/"+name),await fs.readFile("/"+name),name);
      if(pattern==="-")assert.equal((await rust.exec("test -f /-")).exitCode,1);
    }
  }finally{rust.dispose();}
});

test("pdftk unpacks authenticated attachments using only the last payload for each leaf name",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.addPage();
  const rust=new RustWasmBash({cwd:"/",files:{"/in":doc.save(),"/one":Uint8Array.of(4),"/two":Uint8Array.of(2,0,255)}}),fs=new MemoryFileSystem();
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try {
    const cmd="qpdf in --add-attachment one --filename=../nested/leaf.bin --key=a -- --add-attachment two --filename=../nested/leaf.bin --key=b -- --encrypt reader owner 256 -- secured";
    const secured=await rust.exec(cmd);assert.equal(secured.exitCode,0,secured.stderr);
    await fs.writeFile("/secured",await rust.fs.readFile("/secured"));
    for(const shell of [js,rust]){
      const r=await shell.exec("mkdir out && pdftk secured input_pw reader unpack_files output out");
      assert.equal(r.exitCode,0,r.stderr);
      assert.equal((await shell.exec("test -e /nested")).exitCode,1);
    }
    assert.deepEqual(await rust.fs.readFile("/out/leaf.bin"),await fs.readFile("/out/leaf.bin"));
    assert.deepEqual(await rust.fs.readFile("/out/leaf.bin"),Uint8Array.of(2,0,255));
    const invalid=await rust.exec("qpdf in --add-attachment one --filename=first.bin --key=a -- --add-attachment two --filename=.. --key=b -- invalid");
    assert.equal(invalid.exitCode,0,invalid.stderr);
    const rejected=await rust.exec("pdftk invalid unpack_files output out");
    assert.notEqual(rejected.exitCode,0);
    assert.equal((await rust.exec("test -f /out/first.bin")).exitCode,1);
  }finally{rust.dispose();}
});

test("pdftk update_info edits existing PDF objects and preserves unrelated metadata and streams",async()=>{
  const {PdfDocument,dictGet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.setAuthor("Keep author");
  for(const s of ["first","second"])doc.addPage().drawText(s,{x:20,y:30});
  const data=Buffer.from("InfoBegin\nInfoKey: Title\nInfoValue: &#321;ab\nInfoBegin\nInfoKey: Project Code\nInfoValue: preserved\nPageMediaBegin\nPageMediaNumber: 2\nPageMediaRotation: -80\nPageMediaDimensions: 111 222\nPageMediaRect: 10 20 310 420\nPageMediaCropBox: 4 6 100 120\nPageLabelBegin\nPageLabelPrefix: Appendix\nPageLabelNumStyle: UppercaseRomanNumerals\nBookmarkBegin\nBookmarkTitle: Last\nBookmarkPageNumber: 2\nPdfID0: 112233\n");
  const fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files:{"/base":doc.save(),"/info":data,"/note":Buffer.from("attachment bytes")}});
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try{
    const q=await rust.exec("qpdf base --add-attachment note -- in");assert.equal(q.exitCode,0,q.stderr);
    await fs.writeFile("/in",await rust.fs.readFile("/in"));await fs.writeFile("/info",data);
    for(const flags of ["","compress","uncompress","user_pw reader owner_pw owner"]){
      const cmd="pdftk in update_info_utf8 info output out "+flags;
      for(const shell of [js,rust]){const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      const a=await rust.fs.readFile("/out"),b=await fs.readFile("/out");
      const password=flags.startsWith("user_pw")?"reader":"", parsed=PdfDocument.load(a,{password});
      assert.match(parsed.extractText(),/second/);
      assert.equal((await rust.exec("qpdf out --password="+password+" --show-attachment=note")).stdout,"attachment bytes");
      const dump="pdftk out "+(password?"input_pw reader ":"")+"dump_data_utf8";
      const report=async shell=>(await shell.exec(dump)).stdout.split("\n").filter(line=>!password||!line.startsWith("PdfID"));
      assert.deepEqual(await report(rust),await report(js));
      assert.equal(dictGet(parsed.getPage(1).pageDict,"MediaBox").items[0].value,10);
      if(!password)assert.ok(Buffer.from(a).equals(b),"first different byte "+b.findIndex((v,i)=>v!==a[i]));
    }
  }finally{rust.dispose();}
});

test("pdftk rotate applies only the final matching rotation and keeps every original page",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.setTitle("Source");
  for(const [i,r] of [0,90,180,270].entries()){const p=doc.addPage();p.setRotation(r);p.drawText("page"+i,{x:10,y:15});}
  const small=PdfDocument.create();small.addPage();small.addPage();
  const files={"/in":doc.save(),"/two":small.save()},fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files});
  const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  for(const [p,b] of Object.entries(files))await fs.writeFile(p,b);
  try {
    for(const [mode,ranges] of [["rotate","X1-ENDRIGHTeven X2left Yr1east X99L"],["rotate","Ywestodd Xendright Xend"],["rotate","XrEnd-E"],["cat","Xend-r2L X1-99eVeN Yrightodd"],["shuffle","Xr2-rEndL Y99S"]]){
      const cmd="pdftk X=in Y=two "+mode+" "+ranges+" output result";
      for(const shell of [js,rust]){const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      const a=await rust.fs.readFile("/result"),b=await fs.readFile("/result");
      assert.ok(Buffer.from(a).equals(b),cmd+" byte "+b.findIndex((v,i)=>a[i]!==v));
    }
  }finally{rust.dispose();}
});

test("pdftk reads inherited form values, widget states and choice options from encrypted PDFs",async()=>{
  const {PdfDocument,cosArray,cosString:s,cosNumber:n,cosName:k,cosDict:d,dictSet,cosBool}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create();doc.addPage();const cos=doc.cos;
  const group=d({T:s("Réview"),FT:k("Tx"),TU:s("Résumé"),Q:n(1),Ff:n(1),MaxLen:n(32),DV:s("old")});
  const parent=cos.allocateObject(group),kid=cos.allocateObject(d({T:s("name"),Parent:parent,V:s("Léa")}));
  dictSet(group,"Kids",cosArray([kid]));
  const choice=d({T:s("colors"),FT:k("Ch"),V:cosArray([s("rouge"),k("Blue")]),Opt:cosArray([cosArray([s("1"),s("rouge")]),k("Blue"),k("Blue")])});
  const button=d({T:s("ok"),FT:k("Btn"),V:cosBool(true),Kids:cosArray([d({AP:d({N:d({Off:d({}),Approved:d({})})})})])});
  dictSet(cos.resolveDict(cos.rootRef),"AcroForm",d({Fields:cosArray([parent,choice,button])}));
  const file=doc.save({encrypt:{userPassword:"reader",ownerPassword:"owner"}});
  const fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files:{"/in":file}});
  await fs.writeFile("/in",file);const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try{
    for(const op of ["dump_data_fields","dump_data_fields_utf8"]){
      const cmd="pdftk in input_pw reader "+op;
      const expected=await js.exec(cmd);assert.equal(expected.exitCode,0,expected.stderr);assert.match(expected.stdout,/FieldValue: Approved/);
      assert.equal((await rust.exec(cmd)).stdout,expected.stdout);
      assert.equal((await rust.exec(cmd+" output report")).exitCode,0);
      assert.equal(Buffer.from(await rust.fs.readFile("/report")).toString(),expected.stdout);
    }
    for (const target of ["-","fields.fdf"]){
      const cmd="pdftk in input_pw reader generate_fdf output "+target;
      const jr=await js.exec(cmd),rr=await rust.exec(cmd);assert.equal(rr.exitCode,0,rr.stderr);
      const fdf=async (f,r)=>target==="-"?r.stdout:Buffer.from(await f.readFile("/fields.fdf")).toString();
      const actual=await fdf(rust.fs,rr),expected=await fdf(fs,jr);
      assert.match(expected,/\/Kids \[ << \/T \(name\)/);assert.equal(actual,expected);
    }
  } finally{rust.dispose();}
});

test("pdftk annotation reports retain destinations, action order, and text encoding",async()=>{
  const {PdfDocument,cosArray:a,cosString:s,cosNumber:n,cosName:k,cosDict:d,dictSet,cosBool}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const doc=PdfDocument.create(),page=doc.addPage(),second=doc.addPage(),root=doc.cos.resolveDict(doc.cos.rootRef);
  dictSet(root,"Dests",d({Chapter:a([second.ref,k("Fit")])}));
  const action=d({S:k("GoTo"),D:k("Chapter")}),ref=doc.cos.allocateObject(action);
  dictSet(action,"Next",a([d({S:k("URI"),URI:s("résumé")}),d({S:k("GoToR"),F:d({UF:s("file.pdf")}),D:a([n(4),k("Fit")])}),ref]));
  dictSet(page.pageDict,"Annots",a([d({Subtype:k("Link"),A:ref,Rect:a([1,2,3,4].map(x=>n(x))),Contents:s("café"),Open:cosBool(true),F:n(4),C:a([n(1),n(0),n(1)])}),d({Dest:a([page.ref,k("Fit")])})]));
  const files={"/in":doc.save()},fs=new MemoryFileSystem(),rust=new RustWasmBash({cwd:"/",files});
  await fs.writeFile("/in",files["/in"]);const js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  try{
    for(const op of ["dump_data_annots","dump_data_annots_utf8"]){
      const cmd="pdftk in "+op;
      const expected=await js.exec(cmd);assert.equal(expected.exitCode,0,expected.stderr);assert.match(expected.stdout,/AnnotActionPageNumber: 2/);
      assert.equal((await rust.exec(cmd)).stdout,expected.stdout);
      assert.equal((await rust.exec(cmd+" output report")).exitCode,0);
      assert.equal(Buffer.from(await rust.fs.readFile("/report")).toString(),expected.stdout);
    }
  }finally{rust.dispose();}
});

test("pdftk appends attachments to existing name trees and selected page annotations", async () => {
  const {PdfDocument, cosArray, cosDict, cosString, dictSet, dictGet, serializeCosDocument} = await import("@poe-code/pdf-ast");
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {pdftkCommands} = await import("@poe-platform/safe-bash/commands/pdftk");
  const doc = PdfDocument.create();
  doc.addPage().drawText("keep the page", {x: 30, y: 40});
  const page = doc.addPage(), cos = doc.cos;
  const names = cos.allocateObject(cosArray([cosString("old"), cosDict({})]));
  dictSet(cos.resolveDict(cos.rootRef), "Names", cosDict({EmbeddedFiles: cosDict({Names: cos.allocateObject(names)}), Other: cosDict({})}));
  dictSet(page.pageDict, "Annots", cos.allocateObject(cos.allocateObject(cosArray([cosDict({Contents: cosString("existing note")})]))));
  const blank = PdfDocument.create(); blank.addPage();
  const inline = PdfDocument.create(), embedded = inline.addPage();
  dictSet(inline.cos.resolveDict(dictGet(inline.cos.resolveDict(inline.cos.rootRef),"Pages")), "Kids", cosArray([embedded.pageDict]));
  const files = {"/inline":serializeCosDocument({objects:[...inline.cos.objects.values()],rootRef:inline.cos.rootRef,infoRef:inline.cos.infoRef}), "/in": doc.save(), "/blank": blank.save(), "/secret": doc.save({encrypt:{userPassword:"reader",ownerPassword:"owner"}}), "/data": Uint8Array.of(0, 255, 42)};
  const fs = new MemoryFileSystem(), rust = new RustWasmBash({cwd: "/", files});
  const js = new Shell({cwd: "/", fs}).use(agentCommands()).use(pdftkCommands({replace:true}));
  for (const [p,b] of Object.entries(files)) await fs.writeFile(p,b);
  try {
    for (const cmd of ["pdftk inline attach_files data to_page 1 output out", "pdftk in attach_files data data to_page end output out", "pdftk blank attach_files data output out", "pdftk blank attach_files absent output out", "pdftk in attach_files - to_page 2 output out < data", "pdftk in attach_files data to_page 99 output out compress", "pdftk secret input_pw reader attach_files data to_page 0 output out uncompress"]) {
      for (const shell of [js,rust]) { const r = await shell.exec(cmd); assert.equal(r.exitCode, 0, r.stderr); }
      const expected = await fs.readFile("/out"), actual = await rust.fs.readFile("/out");
      assert.ok(Buffer.from(actual).equals(expected), cmd + ": first different byte " + expected.findIndex((b,i)=>actual[i]!==b));
    }
    const payload = new Uint8Array(32768);
    for (const f of [fs,rust.fs]) await f.writeFile("/data",payload);
    const cmd="pdftk in attach_files data to_page end output out";
    assert.equal((await js.exec(cmd)).exitCode,0);
    const expected=await fs.readFile("/out");
    const r=await rust.exec(cmd,{limits:{maxOutputBytes:expected.length}});
    assert.equal(r.exitCode,0,r.stderr);
    assert.deepEqual(Buffer.from(await rust.fs.readFile("/out")), Buffer.from(expected));
    await rust.fs.writeFile("/out",Buffer.from("original"));
    assert.notEqual((await rust.exec(cmd,{limits:{maxOutputBytes:expected.length-1}})).exitCode,0);
    assert.equal(Buffer.from(await rust.fs.readFile("/out")).toString(),"original");
  } finally { rust.dispose(); }
});

test("pdftk output flags edit the form owner and catalog without replacing the document", async () => {
  const {PdfDocument, cosDict, cosString, cosBool, dictSet} = await import("@poe-code/pdf-ast");
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {pdftkCommands} = await import("@poe-platform/safe-bash/commands/pdftk");
  const fs = new MemoryFileSystem(), js = new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true})), rust = new RustWasmBash({cwd:"/"});
  try {
    for (const direct of [false,true]) {
      const doc=PdfDocument.create(); doc.addPage().drawText("retain",{x:15,y:42});
      const cos=doc.cos, root=cos.resolveDict(cos.rootRef);
      const form=cosDict({XFA:cosString("form XML"), NeedAppearances:cosBool(false)});
      dictSet(root,"AcroForm",direct?form:cos.allocateObject(cos.allocateObject(form)));
      dictSet(root,"Metadata",cos.allocateObject(cosString("catalog metadata")));
      const bytes=doc.save();
      for (const f of [fs,rust.fs]) {await f.writeFile("/in",bytes);await f.writeFile("/data",Buffer.from("payload"));}
      for (const [op,flags] of [["","DROP_XFA"],["","drop_xmp"],["","need_appearances"],["rotate 1east","need_appearances drop_xfa"],["attach_files data","drop_xfa need_appearances"],["update_info data","drop_xmp need_appearances"],["cat 1","drop_xfa drop_xmp compress"],["shuffle 1","need_appearances uncompress"]]) {
        const cmd="pdftk in "+op+" output out "+flags;
        for (const shell of [js,rust]) {const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
        const expected=await fs.readFile("/out"),actual=await rust.fs.readFile("/out");
        assert.ok(Buffer.from(actual).equals(expected),cmd+" (direct="+direct+"), first different byte "+expected.findIndex((b,i)=>actual[i]!==b));
      }
    }
  } finally {rust.dispose();}
});

test("pdftk separates output options from operands and defaults to binary stdout", async () => {
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const d=PdfDocument.create(); d.addPage().drawText("first",{x:20,y:30}); d.addPage();
  const bytes=d.save(),secret=d.save({encrypt:{userPassword:"Key",ownerPassword:"owner"}});
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true})),rust=new RustWasmBash({cwd:"/"});
  try {
    for(const f of [fs,rust.fs]) {await f.writeFile("/In",bytes);await f.writeFile("/Secret",secret);await f.writeFile("/Note",Buffer.from("InfoBegin\nInfoKey: Title\nInfoValue: sample\n"));}
    for(const [cmd,target] of [["pdftk In",null],["pdftk In CaT",null],["pdftk A=In SHUFFLE OUTPUT old A2 OUTPUT Result A1","Result"],["pdftk Secret InPuT_Pw Key ROTATE 2east",null],["pdftk In UPDATE_INFO < Note",null],["pdftk In attach_files output Result Note TO_PAGE 1","Result"],["pdftk In Dump_Data OUTPUT old OUTPUT Report","Report"]]) {
      const expected=await js.exec(cmd),r=await rust.exec(cmd);
      assert.equal(expected.exitCode,0,expected.stderr);assert.equal(r.exitCode,0,r.stderr);
      const a=target?await rust.fs.readFile("/"+target):r.stdoutBytes,b=target?await fs.readFile("/"+target):expected.stdoutBytes;
      assert.ok(b.length>0);assert.ok(Buffer.from(a).equals(b),cmd);
    }
    await assert.rejects(rust.fs.stat("/old"),{code:"ENOENT"});
  } finally {rust.dispose();}
});

test("pdftk keeps the selected input trailer ID across assembly and metadata edits",async()=>{
  const {PdfDocument,cosArray,cosHexString,serializeCosDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true})),rs=new RustWasmBash({cwd:"/"});
  try{
    for(const [path,num] of [["One",0x10],["Two",0x20],["None",null]]){
      const d=PdfDocument.create();d.addPage().drawText(path,{x:10,y:25});
      const ids=num===null?undefined:cosArray([cosHexString(Uint8Array.of(num)),cosHexString(Uint8Array.of(num+1))]);
      const bytes=serializeCosDocument({objects:[...d.cos.objects.values()],rootRef:d.cos.rootRef,infoRef:d.cos.infoRef,idArray:ids});
      for(const f of [fs,rs.fs])await f.writeFile("/"+path,bytes);
    }
    for(const f of [fs,rs.fs])await f.writeFile("/data",Buffer.from("PdfID0: 3456\nPdfID1: 7890\n"));
    for(const [op,flags,last] of [["cat B1 A1","","Two"],["shuffle B1 A1","keep_final_id","Two"],["cat","keep_final_id","None"],["","keep_final_id","None"],["","keep_final_id","Two"],["rotate B1east","keep_final_id","Two"],["attach_files data","keep_final_id","Two"],["update_info data","keep_first_id","Two"],["update_info data","keep_final_id","Two"],["update_info data","keep_final_id","None"]]){
      const cmd="pdftk A=One B="+last+" "+op+" output result "+flags;
      for(const shell of [js,rs]){const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      const a=await rs.fs.readFile("/result"),b=await fs.readFile("/result");
      assert.ok(Buffer.from(a).equals(b),cmd+" first different byte "+b.findIndex((v,i)=>v!==a[i]));
    }
  }finally{rs.dispose();}
});

test("pdftk composites stamp and background streams, resources and page transforms",async()=>{
  const {PdfDocument,cosDict,cosName,cosArray,cosString,cosNumber,dictSet,dictGet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftkCommands({replace:true})),rs=new RustWasmBash({cwd:"/"});
  const dst=PdfDocument.create(),src=PdfDocument.create();
  dst.setTitle("Keep the title");
  for(const [i,r] of [0,90,180,270].entries()){
    const page=dst.addPage();page.setRotation(r);page.drawText("Target "+i,{x:20,y:40});
    dictSet(page.pageDict,"Annots",cosArray([cosDict({Subtype:cosName("Text"),Contents:cosString("keep")})]));
  }
  for(let i=0;i<2;i++){const p=src.addPage();p.drawText("Stamp "+i,{x:30,y:150});p.setRotation(90*i);}
  const shared=dst.cos.allocateObject(dst.getPage(0).getResourcesDict());
  for(const p of dst.getPages())dictSet(p.pageDict,"Resources",shared);
  dictSet(dst.getPage(0).pageDict,"MediaBox",cosArray([dst.cos.allocateObject(cosNumber(0)),cosNumber(0),cosNumber(580),cosNumber(770)]));
  for(const p of src.getPages())dictSet(p.pageDict,"Contents",src.cos.allocateObject(dictGet(p.pageDict,"Contents")));
  const files={"/in":dst.save(),"/src":src.save(),"/protected":dst.save({encrypt:{userPassword:"reader",ownerPassword:"owner"}})};
  try{
    for(const f of [fs,rs.fs])for(const [p,b] of Object.entries(files))await f.writeFile(p,b);
    for(const cmd of ["pdftk in stamp src output out","pdftk in background src output out uncompress","pdftk in multistamp - output out compress < src","pdftk protected input_pw reader multibackground output out < src"]){
      for(const shell of [js,rs]){const r=await shell.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      const got=await rs.fs.readFile("/out"),want=await fs.readFile("/out");
      const parsed=PdfDocument.load(got);
      assert.match(parsed.extractText(),/Stamp/); assert.equal(dictGet(parsed.getPage(0).pageDict,"Annots").items.length,1);
      assert.ok(Buffer.from(got).equals(want),cmd+" first different byte "+want.findIndex((b,i)=>b!==got[i]));
    }
    for(const f of [fs,rs.fs]) {await f.writeFile("/bad",Buffer.from("broken"));await f.writeFile("/out",Buffer.from("prior output"));}
    for(const cmd of ["pdftk in stamp absent output out","pdftk in stamp bad output out","pdftk in stamp protected output out"]){
      const expected=await js.exec(cmd),r=await rs.exec(cmd);
      assert.notEqual(expected.exitCode,0);assert.deepEqual([r.exitCode,r.stderr],[expected.exitCode,expected.stderr]);
      assert.equal(Buffer.from(await rs.fs.readFile("/out")).toString(),"prior output");
    }
  }finally{rs.dispose();}
});

test("qpdf flattens rotations into content and maps page boxes and annotation rectangles",async()=>{
  const {PdfDocument,cosArray:a,cosNumber:n,cosName:k,cosDict:d,dictSet,dictGet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const doc=PdfDocument.create(),c=doc.cos,box=(...values)=>a(values.map(x=>n(x)));
  for(const [i,r] of [0,90,180,270].entries()){
    const p=doc.addPage([180,310]);p.setRotation(r);p.drawText("Paint "+i,{x:20,y:35});
    dictSet(p.pageDict,"TrimBox",box(10,20,160,250));
    const ann=d({Subtype:k("Link"),Rect:box(12,32,66,86)});
    dictSet(p.pageDict,"Annots",i%2?c.allocateObject(a([c.allocateObject(ann)])):a([ann]));
  }
  const first=doc.getPage(0);
  dictSet(first.pageDict,"Rect",box(1,2,11,22));
  const linked=doc.getPage(3).pageDict,annotations=c.resolve(dictGet(linked,"Annots"));
  annotations.items.push(first.ref);
  dictSet(doc.getPage(2).pageDict,"Contents",dictGet(doc.getPage(1).pageDict,"Contents"));
  const last=doc.getPage(3).pageDict;dictSet(last,"Contents",a([dictGet(last,"Contents"),dictGet(doc.getPage(0).pageDict,"Contents")]));
  const input=doc.save(),fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":input}});
  try{
    await fs.writeFile("/in",input);
    for(const flags of ["","--rotate=+90:1","--object-streams=generate","--linearize","--split-pages=2","--pages . 2-4 --"]){
      const cmd="qpdf in --flatten-rotation "+flags+" "+(flags.includes("split-pages")?"part-%d.pdf":"out");
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      for(const name of flags.includes("split-pages")?["part-1-2.pdf","part-3-4.pdf"]:["out"]){
        const b=await fs.readFile("/"+name),v=await rs.fs.readFile("/"+name);
        assert.ok(Buffer.from(v).equals(b),cmd+" "+name+" first different byte "+b.findIndex((x,i)=>x!==v[i]));
      }
    }
  }finally{rs.dispose();}
});

test("qpdf overlays and underlays preserve the PDF and compose selected pages in argument order",async()=>{
  const {PdfDocument,cosDict,cosString,cosArray,dictSet,dictGet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const d=PdfDocument.create(),s=PdfDocument.create();d.setTitle("Original");
  for(let i=0;i<4;i++){const p=d.addPage([220,180]);p.setRotation(i*90);p.drawText("Base "+i,{x:4,y:14});dictSet(p.pageDict,"Annots",cosArray([cosDict({Contents:cosString("keep")})]));}
  dictSet(d.getPage(1).pageDict,"Contents",dictGet(d.getPage(0).pageDict,"Contents"));
  for(let i=0;i<2;i++)s.addPage([110,115]).drawText("Layer "+i,{x:12,y:35});
  const files={"/bad":Buffer.from("broken PDF"),"/in":d.save(),"/src":s.save(),"/secret":s.save({encrypt:{userPassword:"pass",ownerPassword:"owner"}})};
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [p,b] of Object.entries(files))await fs.writeFile(p,b);
    for(const flags of ["--overlay src --","--underlay=src --from=2 --repeat=1 --to=4,2,1 --","--overlay src --to=3,1,3 -- --underlay secret --password=pass --from=2-1 --","--rotate=+90:1 --overlay src -- --flatten-rotation","--pages . 3,1 -- --overlay=- -- --object-streams=generate"]){
      const cmd="qpdf in "+flags+" out < src";
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,r.stderr);}
      const expected=await fs.readFile("/out"),actual=await rs.fs.readFile("/out");
      assert.ok(PdfDocument.load(actual).getPages().length>0);
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((b,i)=>b!==actual[i]));
    }
    for(const cmd of [
      "qpdf --password=pass --decrypt secret --overlay src -- out",
      "qpdf --password=pass --decrypt secret --overlay src --to=1,2,1 -- --underlay src --to=2,1 -- --object-streams=generate out",
      "qpdf in --overlay secret -- out",
      "qpdf in --underlay bad -- out",
      "qpdf in --overlay missing -- out",
      "qpdf in --overlay src --repeat=99 -- out",
    ]){
      const expected=await js.exec(cmd),actual=await rs.exec(cmd);
      assert.deepEqual([actual.exitCode,actual.stderr],[expected.exitCode,expected.stderr],cmd);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")),Buffer.from(await fs.readFile("/out")),cmd);
    }
  }finally{rs.dispose();}
});

test("pdfunite flattens nested bookmarks and remaps destinations in repeated input files",async()=>{
  const {PdfDocument,cosDict,cosName,cosNumber,cosString,cosArray,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdfuniteCommands}=await import("@poe-platform/safe-bash/commands/pdfunite");
  const d=PdfDocument.create(),a=d.addPage(),b=d.addPage(),root=d.cos.resolveDict(d.cos.rootRef);
  const child=d.cos.allocateObject(cosDict({Title:cosString("Résumé 日本"),A:cosDict({D:cosName("last")})}));
  dictSet(root,"Outlines",cosDict({First:cosDict({Title:cosString("First"),Dest:cosArray([a.ref,cosName("Fit")]),First:child})}));
  dictSet(root,"Dests",cosDict({last:cosArray([b.ref,cosName("Fit")])}));
  dictSet(root,"PageLabels",cosDict({Nums:cosArray([cosNumber(0),cosDict({S:cosName("r")})])}));
  const input=d.save(),fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(pdfuniteCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":input}});
  try {
    await fs.writeFile("/in",input);
    for(const sh of [js,rs]){const r=await sh.exec("pdfunite in in merged");assert.equal(r.exitCode,0,r.stderr);}
    const expected=await fs.readFile("/merged"),actual=await rs.fs.readFile("/merged");
    assert.ok(Buffer.from(actual).equals(expected),"first different byte "+expected.findIndex((b,i)=>b!==actual[i]));
  } finally {rs.dispose();}
});

test("qpdf replaces page labels while retaining the existing document",async()=>{
  const {PdfDocument,cosDict,cosArray,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const doc=PdfDocument.create();doc.setTitle("Label test");
  for(let i=0;i<3;i++)doc.addPage().drawText("Page "+i,{x:15,y:25});
  dictSet(doc.cos.resolveDict(doc.cos.rootRef),"PageLabels",doc.cos.allocateObject(cosDict({Nums:cosArray([])})));
  const files={"/in":doc.save(),"/secret":doc.save({encrypt:{userPassword:"pass",ownerPassword:"owner"}}),"/attachment":Buffer.from("example")};
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try {
    for(const [k,b] of Object.entries(files))await fs.writeFile(k,b);
    for(const [args,outputs] of [
      ["in --set-page-labels 1:r/2/前 3:n/Appendix bad 1:D/0 2:A/-2/end 1:前 100000000000000000000000000:r -- out",["out"]],
      ["in --remove-page-labels --linearize --set-page-labels 3: 0:n/zero -- --add-attachment attachment -- out",["out"]],
      ["in --pages . 3,1 -- --set-page-labels bad -- --object-streams=generate out",["out"]],
      ["--password=pass --decrypt secret --set-page-labels 2:D/3/β -- out",["out"]],
      ["in --set-page-labels 1:r/2 3:A -- --split-pages=2 part-%d.pdf",["part-1-2.pdf","part-3-3.pdf"]],
    ]) {
      const cmd="qpdf "+args;
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,cmd+": "+r.stderr);}
      for(const name of outputs){
        const expected=await fs.readFile("/"+name),actual=await rs.fs.readFile("/"+name);
        assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((b,i)=>b!==actual[i]));
      }
    }
  } finally {rs.dispose();}
});

test("pdftk fill_form updates field values, widget appearances and new fields across data formats",async()=>{
  const {PdfDocument,cosDict,cosName,cosString,cosNumber,cosArray,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const d=PdfDocument.create(),page=d.addPage(),alloc=x=>d.cos.allocateObject(x);
  page.drawText("Page before filling",{x:10,y:25});
  const widget=alloc(cosDict({Subtype:cosName("Widget"),Rect:cosArray([20,30,202,64].map(n=>cosNumber(n)))}));
  const name=alloc(cosDict({T:cosString("name"),FT:cosName("Tx"),Q:cosNumber(2),Kids:cosArray([widget])}));
  const choice=cosDict({T:cosString("choice"),FT:cosName("Ch"),Opt:cosArray([cosArray([cosString("x"),cosString("Display")])])});
  const button=alloc(cosDict({T:cosString("check"),FT:cosName("Btn"),AP:cosDict({N:cosDict({Off:cosDict({}),Marked:cosDict({})})})}));
  dictSet(page.pageDict,"Annots",cosArray([widget,button]));
  dictSet(d.cos.resolveDict(d.cos.rootRef),"AcroForm",alloc(cosDict({Fields:alloc(cosArray([name,choice,button])),DA:cosString("/Helv 12 Tf 0.1 0.2 0.3 rg")})));
  const files={"/in":d.save(),"/plain":Buffer.from("name=discard\nname=Zoë (A)\nchoice=x\ncheck=Yes\nnew: value"),"/xml":Buffer.from('<xfdf><fields><field name="name"><value>A&amp;B</value><value>C</value></field></fields></xfdf>'),"/fdf":Buffer.from('%FDF-1.2\n1 0 obj << /FDF << /Fields [2 0 R] >> >> endobj\n2 0 obj << /T (group) /Kids [3 0 R] >> endobj\n3 0 obj << /T (check) /V /Yes >> endobj'),"/report":Buffer.from("FieldName: name\nFieldValue: Andr&#233;"),"/secret":d.save({encrypt:{userPassword:"pass",ownerPassword:"owner"}})};
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(pdftkCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [k,b] of Object.entries(files))await fs.writeFile(k,b);
    for(const cmd of ["pdftk in fill_form plain output out","pdftk in fill_form - output out compress need_appearances < xml","pdftk in fill_form fdf output out","pdftk secret input_pw pass fill_form report output out replacement_font /Courier uncompress","pdftk in fill_form absent output out"]){
      const e=await js.exec(cmd),r=await rs.exec(cmd);assert.deepEqual([r.exitCode,r.stderr],[e.exitCode,e.stderr],cmd);
      const expected=await fs.readFile("/out"),actual=await rs.fs.readFile("/out");
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((v,i)=>v!==actual[i]));
    }
  }finally{rs.dispose();}
});

test("pdftk flattens existing and filled widgets while preserving links and remapping appearance geometry",async()=>{
  const {PdfDocument,cosDict,cosName,cosString,cosNumber,cosArray,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftkCommands}=await import("@poe-platform/safe-bash/commands/pdftk");
  const d=PdfDocument.create(),p=d.addPage(),p2=d.addPage(),alloc=v=>d.cos.allocateObject(v),nums=a=>cosArray(a.map(v=>cosNumber(v)));
  p.drawText("keep",{x:5,y:50});p2.drawText("page two",{x:10,y:45});
  const ap=alloc(cosStream(Buffer.from("q 0 1 0 rg 0 0 10 20 re f Q"),{dict:cosDict({BBox:nums([0,0,10,20]),Matrix:nums([0,1,-1,0,2,3])}),compress:true}));
  const box=alloc(cosDict({Subtype:cosName("Widget"),T:cosString("box"),FT:cosName("Btn"),AS:cosName("Yes"),AP:cosDict({N:cosDict({Yes:ap})}),Rect:nums([20,30,100,50])}));
  const field=alloc(cosDict({T:cosString("name"),FT:cosName("Tx"),V:cosString("Fallback"),Rect:nums([6,8,150,30])}));
  dictSet(p2.pageDict,"Annots",cosArray([field]));
  dictSet(p.pageDict,"Annots",alloc(cosArray([box,cosDict({Subtype:cosName("Link")})])));
  dictSet(d.cos.resolveDict(d.cos.rootRef),"AcroForm",alloc(cosDict({Fields:cosArray([box,field])})));
  const files={"/in":d.save(),"/data":Buffer.from("name=Filled (value)\nextra=Added")};
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(pdftkCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,b] of Object.entries(files))await fs.writeFile(path,b);
    for(const [args,target] of [["flatten output out","out"],["output out flatten uncompress","out"],["fill_form data output out flatten compress","out"],["cat 2 1 output out flatten","out"],["stamp in output out flatten","out"],["burst output page-%d.pdf flatten","page-1.pdf"]]){
      const cmd="pdftk in "+args;
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,cmd+": "+r.stderr);}
      const expected=await fs.readFile("/"+target),actual=await rs.fs.readFile("/"+target);
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((v,i)=>v!==actual[i]));
    }
  }finally{rs.dispose();}
});

test("qpdf generates missing form appearances and respects existing or forced appearances",async()=>{
  const {PdfDocument,cosDict,cosName,cosString,cosNumber,cosArray,cosBool,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  function form(force){
    const d=PdfDocument.create(),p=d.addPage(),alloc=v=>d.cos.allocateObject(v);p.drawText("base",{x:2,y:8});
    const text=alloc(cosDict({T:cosString("name"),FT:cosName("Tx"),V:cosString("Zoë\r\n(a)"),AP:cosDict({N:cosNumber(0)}),Kids:cosArray([cosDict({Subtype:cosName("Widget")})])}));
    const choice=cosDict({T:cosString("choice"),FT:cosName("Ch"),V:cosString("one"),Opt:cosArray([cosArray([cosString("one"),cosString("One option")])])});
    const button=alloc(cosDict({T:cosString("check"),FT:cosName("Btn"),V:cosName("Yes")}));
    dictSet(d.cos.resolveDict(d.cos.rootRef),"AcroForm",alloc(cosDict({DA:cosString("/Cour 10 Tf 0.4 g"),Fields:cosArray([text,choice,button]),NeedAppearances:cosBool(force)})));
    dictSet(p.pageDict,"Annots",cosArray([text,button]));return d.save();
  }
  const files={"/in":form(false),"/force":form(true),"/note":Buffer.from("file")},fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,b] of Object.entries(files))await fs.writeFile(path,b);
    for(const args of ["in out","force out","in --warning-exit-0 --unused-option out","force --set-page-labels=1:D --force-version=1.0 out","force --linearize --no-linearize --min-version=9.0 out","in --remove-acroform out","force --object-streams=generate out","force --linearize --set-page-labels 1:r -- --add-attachment note -- out","in --overlay force -- --split-pages p-%d.pdf"]){
      const cmd="qpdf --generate-appearances "+args,path=args.includes("--split-pages")?"/p-1.pdf":"/out";
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,cmd+": "+r.stderr);}
      const expected=await fs.readFile(path),actual=await rs.fs.readFile(path);
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((v,i)=>v!==actual[i]));
    }
  }finally{rs.dispose();}
});

test("qpdf flattens annotations with shared content, appearance resources and visibility flags",async()=>{
  const {PdfDocument,cosDict,cosName,cosString,cosNumber,cosArray,cosStream,dictGet,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const doc=PdfDocument.create(),page=doc.addPage(),other=doc.addPage(),alloc=v=>doc.cos.allocateObject(v),nums=a=>cosArray(a.map(n=>cosNumber(n)));
  page.drawText("Base",{x:12,y:50});page.setRotation(90);dictSet(other.dict,"Contents",dictGet(page.dict,"Contents"));
  const font=alloc(cosDict({BaseFont:cosName("Courier")}));
  const ap=alloc(cosStream(Buffer.from("BT /F1 10 Tf (paint) Tj ET"),{compress:true,dict:cosDict({BBox:nums([0,0,20,10]),Matrix:nums([0,1,-1,0,10,0]),Resources:cosDict({Font:cosDict({F1:font})})})}));
  const items=[alloc(cosDict({AP:cosDict({N:cosDict({Yes:ap})}),AS:cosName("Yes"),Rect:nums([20,30,40,60])}))];
  for(const flag of [0,2,4,32,36])items.push(alloc(cosDict({Contents:cosString("flag "+flag),F:cosNumber(flag)})));
  for(const subtype of ["Link","Popup"])items.push(alloc(cosDict({Subtype:cosName(subtype),F:cosNumber(2)})));
  dictSet(page.dict,"Annots",alloc(cosArray(items)));
  const input=doc.save(),fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":input}});
  try{
    await fs.writeFile("/in",input);
    for(const flags of ["--flatten-annotations","--flatten-annotations=print","--flatten-annotations=screen","--flatten-rotation --flatten-annotations","--overlay in -- --flatten-annotations=all --generate-appearances","--split-pages --flatten-annotations","--qdf --flatten-annotations","--normalize-content=y --overlay in -- --flatten-annotations"]){
      const cmd="qpdf in "+flags+" out.pdf",path=flags.includes("--split-pages")?"/out-1.pdf":"/out.pdf";
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,cmd+": "+r.stderr);}
      const e=await fs.readFile(path),r=await rs.fs.readFile(path);
      assert.ok(Buffer.from(r).equals(e),cmd+" first different byte "+e.findIndex((v,i)=>v!==r[i]));
    }
  }finally{rs.dispose();}
});

test("qpdf prunes unused resources and follows names in patterns, forms and annotations",async()=>{
  const {PdfDocument,cosDict,cosName,cosArray,cosStream,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const d=PdfDocument.create(),p=d.addPage(),alloc=v=>d.cos.allocateObject(v);
  const stream=s=>alloc(cosStream(Buffer.from(s),{compress:true})),font=alloc(cosDict({BaseFont:cosName("Helvetica")}));
  p.setRawContentStream("/P scn % /K#65ep\n");p.setRotation(90);
  dictSet(p.dict,"Annots",cosArray([cosDict({AP:cosDict({N:stream("/Comment 10 Tf")})})]));
  dictSet(p.dict,"Resources",alloc(cosDict({Pattern:cosDict({P:stream("/Form Do")}),XObject:alloc(cosDict({Form:stream("/Hidden 10 Tf"),Unused:stream("/UnusedFont 9 Tf")})),Font:cosDict({Hidden:font,Comment:font,Keep:font,UnusedFont:font})})));
  const input=d.save(),fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":input}});
  try{
    await fs.writeFile("/in",input);
    for(const flags of ["","=no","=auto --flatten-rotation","=yes --normalize-content=y","=yes --overlay in --","=yes --overlay in -- --normalize-content=y","=yes --split-pages","=invalid"]){
      const cmd="qpdf in --remove-unreferenced-resources"+flags+" out.pdf",path=flags.includes("--split-pages")?"/out-1.pdf":"/out.pdf";
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr],[e.exitCode,e.stderr],cmd);
      const expected=await fs.readFile(path),actual=await rs.fs.readFile(path);
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((v,i)=>v!==actual[i]));
    }
  }finally{rs.dispose();}
});

test("qpdf externalizes inline images above the size threshold without splitting binary data",async()=>{
  const {PdfDocument,cosDict,dictGet,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const d=PdfDocument.create(),a=d.addPage(),b=d.addPage();
  a.setRawContentStream(Buffer.concat([Buffer.from("q BI /W 8 /H 1 /BPC 8 /CS /G ID "),Buffer.from([0,32,69,73,32,1,2,3]),Buffer.from(" EI Q\nBI /F /AHx /W 1 /H 1 ID 00> EI")]));
  dictSet(b.dict,"Contents",dictGet(a.dict,"Contents"));dictSet(a.getResourcesDict(),"XObject",cosDict({ImExt1:cosDict({})}));
  const input=d.save(),fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":input}});
  try{
    await fs.writeFile("/in",input);
    for(const flags of ["--ii-min-bytes=-0tail","--ii-min-bytes=\ufeff1","--ii-min-bytes=\u00851","--ii-min-bytes=1 --ii-min-bytes="+"9".repeat(310),"--ii-min-bytes=9007199254740991","--ii-min-bytes=3","--ii-min-bytes=8 --remove-unreferenced-resources","--ii-min-bytes=1 --stream-data=uncompress --normalize-content=n","--ii-min-bytes=2 --qdf --split-pages",""]){
      const cmd="qpdf in --externalize-inline-images "+flags+" out.pdf";
      for(const sh of [js,rs]){const r=await sh.exec(cmd);assert.equal(r.exitCode,0,cmd+": "+r.stderr);}
      for(const path of flags.includes("--split-pages")?["/out-1.pdf","/out-2.pdf"]:["/out.pdf"]){
        const e=await fs.readFile(path),r=await rs.fs.readFile(path);
        assert.ok(Buffer.from(r).equals(e),cmd+" first different byte "+e.findIndex((v,i)=>v!==r[i]));
      }
    }
    for(const flags of ["out.pdf","--json","--show-pages"]){
      const cmd="qpdf in --externalize-inline-images --ii-min-bytes=9007199254740992 "+flags;
      const before=await rs.fs.readFile("/out.pdf");
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
      assert.deepEqual(await rs.fs.readFile("/out.pdf"),before);
    }
    for(const flags of ["--json=1 --json-stream-data=inline","--json=2 --json-stream-data=file --json-stream-prefix=p-"]){
      const cmd="qpdf in --externalize-inline-images --ii-min-bytes=1 "+flags;
      const e=await js.exec(cmd),r=await rs.exec(cmd);assert.equal(r.exitCode,e.exitCode,r.stderr);
      assert.equal(r.stdout,e.stdout,cmd);
      if(flags.includes("=file"))for(const p of Object.values(JSON.parse(e.stdout).qpdf[1]).map(o=>o.stream?.datafile).filter(Boolean))assert.deepEqual(Buffer.from(await rs.fs.readFile("/"+p)),Buffer.from(await fs.readFile("/"+p)));
    }
  }finally{rs.dispose();}
});

test("qpdf imports and updates JSON object graphs without losing streams or unreferenced objects",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const d=PdfDocument.create();d.addPage([200,400]).drawText("Round trip",{x:10,y:12});
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true}));
  await fs.writeFile("/in",d.save());
  const exported=await js.exec("qpdf in --json=2 --json-stream-data=inline");assert.equal(exported.exitCode,0);
  const json=objects=>Buffer.from(JSON.stringify({objects}));
  const files={"/in":await fs.readFile("/in"),"/json":Buffer.from(exported.stdout),"/data":Buffer.from([0,13,255]),"/update":json({"obj:9 2 R":{value:{"/Title":"u:更新😀",N:"n:Token",Binary:"b:00ff",Array:[true,null,1.25]}},"obj:10 0 R":{stream:{dict:{Filter:"/FlateDecode"},datafile:"data"}},trailer:{value:{"/Info":"9 2 R"}}}),"/more":json({"obj:11 0 R":{value:"u:keep"},"obj:10 0 R":{stream:{dict:{Type:"/Example"}}}}),"/bad":Buffer.from('{"objects":'),"/noroot":json({})};
  const rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [k,v] of Object.entries(files))await fs.writeFile(k,v);
    for(const args of ["--json-input json out","--json-input json --show-xref","--json-input - --json --json-stream-data=inline < json","in --update-from-json=update --update-from-json=more out","--empty --update-from-json=update out","--json-input json --update-from-json=more --rotate=90:1 out","--json-input json --pages . 1,1 -- out","--json-input bad out","--json-input noroot out","in --update-from-json=missing out"]){
      const cmd="qpdf "+args,e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
      const expected=await fs.readFile("/out"),actual=await rs.fs.readFile("/out");
      assert.ok(Buffer.from(actual).equals(expected),cmd+" first different byte "+expected.findIndex((b,i)=>b!==actual[i]));
    }
  }finally{rs.dispose();}
});

test("qpdf JSON errors preserve the output and report native JSON positions",async()=>{
  const rs=new RustWasmBash({cwd:"/",files:{"/out":"original"}});
  try{
    for(const source of ['{"a":1,}', '["😀" x]', '{"a" x}', '[01]', '1e-', '"abc', '"a\\u21!', '["a\\q"]', 'truX', 'undefined', ' '.repeat(24)+'x','{\r\n"a": 1 x}']){
      let message;try{JSON.parse(source);}catch(e){message=e.message;}
      await rs.fs.writeFile("/in",Buffer.from(source));
      const r=await rs.exec("qpdf --json-input in out");
      assert.deepEqual([r.exitCode,r.stderr],[2,"qpdf: in: "+message+"\n"],source);
      assert.equal(Buffer.from(await rs.fs.readFile("/out")).toString(),"original");
    }
  }finally{rs.dispose();}
});

test("qpdf reads each argument-file line literally, once, before parsing options",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {qpdfCommands}=await import("@poe-platform/safe-bash/commands/qpdf");
  const d=PdfDocument.create();d.addPage();const file="é space.pdf";
  const files={["/"+file]:d.save()};
  Object.assign(files,{"/args":Buffer.from("\ufeff"+"\n".repeat(65532)+file+"\r\n\n"),"/show":Buffer.from("--show-npages\r"),"/write":Buffer.from("out file.pdf\r\n"),"/nested":Buffer.from("@args\n--show-npages"),"/version":Buffer.from("--help\n--version"),"/bad":Buffer.from("--normalize-content=invalid\n--version")});
  const fs=new MemoryFileSystem(),js=new Shell({fs,cwd:"/"}).use(agentCommands()).use(qpdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [p,b] of Object.entries(files))await fs.writeFile(p,b);
    for(const cmd of ["qpdf @args @show","qpdf @args @write","qpdf @nested","qpdf --help @missing","qpdf @version","qpdf @bad","qpdf --help=foo"]){
      const e=await js.exec(cmd),r=await rs.exec(cmd);assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
      if(cmd.includes("@write"))assert.deepEqual(Buffer.from(await rs.fs.readFile("/out file.pdf")),Buffer.from(await fs.readFile("/out file.pdf")));
    }
    const cmd="qpdf @args @show", argBytes=files["/args"].length+files["/show"].length;
    for(const shell of [js,rs])await assert.rejects(shell.exec(cmd,{limits:{maxInputBytes:argBytes-1}}),/maxInputBytes/);
    for(const maxInputBytes of [argBytes,argBytes+files["/"+file].length]){
      const opts={limits:{maxInputBytes}};
      const e=await js.exec(cmd,opts),r=await rs.exec(cmd,opts);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],String(maxInputBytes));
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf applies page dimensions, margins and DPI to PDF layout",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={"/in":Buffer.from("<h1>Layout</h1>"+"<p>A paragraph with enough words to wrap on a narrow page.</p>".repeat(8))};
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true}));
  const rs=new RustWasmBash({cwd:"/",files});await fs.writeFile("/in",files["/in"]);
  try{
    for(const args of ["--page-width 3in --page-height 100pt -T 1cm -B 0 --margin-left 2mm -R 0.01m","-s B4 -O landscape","-s executive","-s Ledger","--page-width 288px -d 144 --page-height 12pc","--page-width 0 --page-height 13didot -s A8","-T 1pt -B 2pt -L 3pt -R 4pt","-s wrong","-O sideways","-T 4pt","--page-width 1e2cm","--page-height -1","--dpi 0","--copies 0","--copies 2147483648","--copies 1.5","in -L 10 out","in -g out","--page-width"]){
      const cmd="wkhtmltopdf "+args+((args.startsWith("in ")||args==="--page-width")?"":" in out");
      for(const f of [fs,rs.fs])await f.writeFile("/out",Buffer.from("prior"));
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf writes URI annotations for visible links in headings and paragraphs",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={"/a":Buffer.from('<article><h2 id="h">Visit <a href="/first">here</a></h2><section><p data-x=">">Read <a href=" relative?q=(one)&amp;b=2 "><em>more</em></a> and <a href="#last">again</a></p><script>hidden</script><p><a href="empty"> </a>Plain<br>text</p></section></article>'),"/b":Buffer.from('<p><a href="https://test/雪">Unicode destination</a></p>')};
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [p,b] of Object.entries(files))await fs.writeFile(p,b);
    for(const args of ["a b","--disable-external-links a b","a --disable-external-links b","--disable-external-links a b --enable-external-links","--page-width 100pt --copies 2 a b","--page-height 100pt --copies 2 a b","--page-height 100pt --copies 2 --no-collate a b"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);
      assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
    for(const args of ["","--footer-left Footer"]){
      await rs.fs.writeFile("/out",Buffer.from("prior"));
      const r=await rs.exec("wkhtmltopdf --copies 2147483647 "+args+" a out");
      assert.equal(r.exitCode,1);assert.match(r.stderr,/output exceeds resource limits/);
      assert.equal(Buffer.from(await rs.fs.readFile("/out")).toString(),"prior");
    }
  }finally{rs.dispose();}
});

test("PDF URL inspection follows actions; text and HTML use the annotation rectangle",async()=>{
  const {PdfDocument,cosStream,cosDict,cosArray,cosNumber,cosName,cosString,dictSet}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdfinfoCommands}=await import("@poe-platform/safe-bash/commands/pdfinfo");
  const {pdftotextCommands}=await import("@poe-platform/safe-bash/commands/pdftotext");
  const d=PdfDocument.create(),p=d.addPage(),q=d.addPage();
  p.drawText("First",{x:10,y:35,size:12});p.drawText("Second",{x:10,y:135,size:12});
  const action=cosDict({URI:cosString("https://e/雪?a&b")}), ref=d.cos.allocateObject(action);
  const invalid=cosStream(Buffer.from("bytes"));dictSet(invalid.dict,"URI",cosString("not an action"));
  dictSet(action,"Next",cosArray([cosDict({URI:cosString("nested")}),d.cos.allocateObject(invalid),ref]));
  const annot=(rect,fields)=>cosDict({Subtype:cosName("Link"),Rect:cosArray(rect.map(n=>cosNumber(n))),...fields});
  dictSet(p.dict,"Annots",cosArray([annot([90,65,0,30],{A:ref}),annot([0,130,90,165],{Dest:cosArray([q.ref,cosName("Fit")])}),cosDict({A:cosDict({URI:cosString("no rectangle")})})]));
  q.addLinkAnnotation({uri:"next page",rect:[0,0,10,10]});
  const bytes=d.save(),fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdfinfoCommands({replace:true})).use(pdftotextCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":bytes}});
  try{
    await fs.writeFile("/in",bytes);
    for(const cmd of ["pdfinfo -url in","pdfinfo -url -f 2 in","pdftotext -urls -f 1 -l 1 in -","pdftohtml -xml -stdout in","pdftohtml -stdout in"]){
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
    }
  }finally{rs.dispose();}
});

test("pdftotext orders logical lines, preserves block boundaries and optionally rejoins hyphens",async()=>{
  const {PdfDocument}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftotextCommands}=await import("@poe-platform/safe-bash/commands/pdftotext");
  const d=PdfDocument.create(),p=d.addPage();
  for(const [text,x,y,size] of [["column two",400,140,12],["column two end",400,110,12],["paragraph",10,36,12],["word",10,124,12],["multi-",10,140,12],["Heading",10,155,18],["other column",110,110,12],["separate",10,48,12]])p.drawText(text,{x,y,size});
  const bytes=d.save(),fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftotextCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":bytes}});
  try{
    await fs.writeFile("/in",bytes);
    for(const flags of ["","-colspacing 10","-remove-hyphens no","-remove-hyphens no -remove-hyphens -nopgbrk","-raw"]){
      const cmd="pdftotext "+flags+" in -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout],cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf draws code blocks, quote bars and horizontal rules on physical pages",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={"/code":Buffer.from('<pre>A &lt; B\n\n  x(1) <code>+ y</code><br>next</pre>'),"/quote":Buffer.from('<blockquote><p>Quoted <b>words</b> wrap on a narrow sheet.</p><p>Second line with a <a href="/quote">link</a>.</p></blockquote>'),"/rule":Buffer.from('<hr><hr>'),"/blank":Buffer.from('<div></div>'),"/intro":Buffer.from('<h1>Intro</h1><p><a href="/intro">Contents</a></p><hr><blockquote>Example</blockquote><pre>test</pre><p>End</p>')};
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,bytes] of Object.entries(files))await fs.writeFile(path,bytes);
    for(const args of ["code","quote","rule","blank","intro","-g intro","--grayscale code quote rule","--page-width 120pt --page-height 100pt --copies 2 --no-collate intro code quote rule"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);
      assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf preserves nested list order, continuation indentation and definition spacing",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={"/ordered":Buffer.from('<h2>Steps</h2><ol><li>Start<ul><li>Indented <b>item</b> with enough words to wrap twice on a narrow page</li></ul>continue here</li><li><ol><li>nested</li></ol></li><li></li></ol><p>End</p>'),"/definitions":Buffer.from('<dl><dt>Term</dt><dd>First definition</dd><dd>Another definition</dd><dt>New</dt><dd>Last definition</dd><dt>Unused</dt></dl><dl><dt>A<dd>B<dt>C<dd>D</dl><hr><ul><li>One</li><li><a href="/hidden">Two</a></li></ul>')};
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,bytes] of Object.entries(files))await fs.writeFile(path,bytes);
    for(const args of ["ordered","definitions","--page-width 132pt --page-height 110pt --copies 2 --no-collate ordered definitions"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);
      assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf draws table rows, column spans and multiline cells across pages",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const table='<table><thead><tr><th colspan="2">Parts</th><td>Qty</td></tr></thead><tbody><tr><td>A<br>  B</td><td colspan="2"><b>€</b>\t(C)</td></tr><tr><td></td><td colspan="0">Second</td></tr><tr></tr></tbody></table>';
  const files={"/table":Buffer.from('<h2>Inventory</h2>'+table+'<p>End</p>'),"/nested":Buffer.from('<ol><li>Before'+table+'After</li></ol><table><tr><td>A<table><tr><td>inner</td></tr></table>B</td></tr></table>')};
  files["/spans"]=Buffer.from(["0x2","2.5","Inf","Infinity","1e999"].map(n=>'<table><tr><td colspan="'+n+'">Wide</td><td>End</td></tr><tr><td>A</td></tr></table>').join(""));
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,bytes] of Object.entries(files))await fs.writeFile(path,bytes);
    for(const args of ["table","nested","spans","-g --page-height 115pt --copies 2 --no-collate table nested"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);
      assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("HTML table parsing closes cells and inserts implicit row groups in source order",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const html=Buffer.from('<table><thead><tr><th>A<th>B<tbody><tr><td>1<td>2<tr><td>3<td>4</tbody><tr><td>5<td>6<tfoot><tr><td>7<td>8</tfoot><tr><td>9<td>10</table><p>After</p>');
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":html}});
  try{
    await fs.writeFile("/in",html);
    for(const cmd of ["htmlq 'table > *' < in","htmlq -t 'tbody > tr > td' < in","htmlq p < in","wkhtmltopdf in -"]){
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf draws inline SVG rectangles and labels in order and reserves the diagram height",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={"/chart":Buffer.from('<h2>Chart</h2><p><a href="/key">Legend</a></p><svg width="200" height="64"><g><rect x="2" y="4" width="73.5" height="18"/><text x="8" y="16">Part <tspan>A</tspan></text></g><rect x="0x4" y="24"/><text y="39"> B &amp; C </text><circle r="15"/></svg><p>After diagram</p>'),"/empty":Buffer.from('<svg height="61"><circle r="15"/></svg><p>After empty figure</p>')};
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files});
  try{
    for(const [path,bytes] of Object.entries(files))await fs.writeFile(path,bytes);
    for(const args of ["chart","-g chart","--page-height 110pt --copies 2 --no-collate chart empty"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf embeds opaque and transparent PNG pixels with per-page image resources",async()=>{
  const {encodePng}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const image=(alpha)=>Buffer.from(encodePng({width:2,height:1,data:Uint8Array.from([255,64,0,255,0,128,255,alpha])})).toString("base64");
  const html=Buffer.from('<img src="data:image/png;base64,'+image(128)+'" width="40" height="20"/><p><a href="/caption">Caption</a></p><img src="data:image/png;base64,'+image(255)+'"/><h2>Heading</h2><img src="missing.png"/><img src="data:image/png;base64,invalid"/>');
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":html}});
  try{
    await fs.writeFile("/in",html);
    for(const args of ["","-g","--page-height 100pt --copies 2 --no-collate"]){
      const cmd="wkhtmltopdf "+args+" in -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
    const invalid=Buffer.from('<img src="data:image/png;base64,'+image(255)+'" height="-Infinity"/>');
    for(const f of [fs,rs.fs]){await f.writeFile("/in",invalid);await f.writeFile("/out",Buffer.from("prior"));}
    for(const cmd of ["wkhtmltopdf in -","true\nwkhtmltopdf in out"]){
      const e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.deepEqual([r.exitCode,r.stderr,r.stdout],[e.exitCode,e.stderr,e.stdout]);assert.equal(Buffer.from(await rs.fs.readFile("/out")).toString(),"prior");
    }
  }finally{rs.dispose();}
});

test("pdftohtml publishes painted PDF images and inlines the same pixels in HTML and XML",async()=>{
  const {PdfDocument,encodePng}=await import("@poe-code/pdf-ast");
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {pdftotextCommands}=await import("@poe-platform/safe-bash/commands/pdftotext");
  const doc=PdfDocument.create(),p=doc.addPage(),q=doc.addPage(),image=doc.embedPng(encodePng({width:13,height:10,data:Uint8Array.from({length:520},(_,i)=> i%4===3?(i<200?128:255):i*71)}));
  for(const page of [p,q,p])page.drawImage(image,{x:10,y:15,width:28,height:20});
  const bytes=doc.save(),fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(pdftotextCommands({replace:true})),rs=new RustWasmBash({cwd:"/",files:{"/in":bytes}});
  try{
    await fs.mkdir("/tmp",{recursive:true});await fs.writeFile("/in",bytes);
    for(const args of ["-i -stdout","-stdout","-dataurls -stdout","-xml -f 2 -dataurls -stdout","-fmt png","-fmt jpg","-fmt jpg -dataurls -stdout"]){
      const files=!args.includes("-stdout"),cmd="pdftohtml "+args+" in"+(files?" doc.html":""),e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);assert.equal(r.stdout,e.stdout,cmd);
      if(files)for(const path of ["/doc.html",...["page1_1","page1_2","page2_1"].map(f=>"/"+f+"."+args.slice(-3))])assert.deepEqual(Buffer.from(await rs.fs.readFile(path)),Buffer.from(await fs.readFile(path)),path);
    }
  }finally{rs.dispose();}
});

test("pdftohtml preserves nested outline destinations and sibling order in HTML and XML",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const {pdftotextCommands}=await import("@poe-platform/safe-bash/commands/pdftotext");
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})).use(pdftotextCommands({replace:true}));
  await fs.mkdir("/tmp",{recursive:true});await fs.writeFile("/a",Buffer.from("<h1>A &amp; B</h1><h2>Section</h2><h3>Nested</h3><h3>Sibling</h3>"));await fs.writeFile("/b",Buffer.from("<h2>Continued</h2><h1>End</h1>"));
  const generated=await js.exec("wkhtmltopdf a b in");assert.equal(generated.exitCode,0,generated.stderr);
  const rs=new RustWasmBash({cwd:"/",files:{"/in":await fs.readFile("/in")}});
  try{for(const args of ["-stdout","-xml -stdout","-f 2 -stdout"]){
    const cmd="pdftohtml "+args+" in",e=await js.exec(cmd),r=await rs.exec(cmd);assert.equal(e.exitCode,0,e.stderr);assert.deepEqual([r.stdout,r.stderr,r.exitCode],[e.stdout,e.stderr,e.exitCode],cmd);
  }}finally{rs.dispose();}
});

test("wkhtmltopdf paginates at block page breaks and preserves intentional blank sheets",async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands}=await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const files={
    "/classes":'<h1>Start</h1><section class="note page-break"><h2>Next</h2><p>Tail</p></section>',
    "/avoid":'<p>Start</p><div style="page-break-before: always; PAGE-BREAK-BEFORE : avoid">Kept together</div>',
    "/blank":'<div class="page-break"></div><article class="page-break" style="page-break-after: ALWAYS">Body</article>',
    "/styles":'<section style="page-break-after:always"><p>One <span class="page-break">line</span></p></section><div>Two</div><script>page-break-before: always</script>',
    "/literal":'<p>Examples: page-break-before, page-break-after</p><p>Tail</p>',
    "/empty":'<hr class="page-break" style="page-break-after:always"/>'
  };
  const fs=new MemoryFileSystem(),js=new Shell({cwd:"/",fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace:true})),rs=new RustWasmBash({cwd:"/"});
  try{
    for(const [path,html] of Object.entries(files))for(const f of [fs,rs.fs])await f.writeFile(path,Buffer.from(html));
    for(const args of [...Object.keys(files),"--copies 2 --no-collate blank styles classes"]){
      const cmd="wkhtmltopdf "+args+" -",e=await js.exec(cmd),r=await rs.exec(cmd);
      assert.equal(e.exitCode,0,e.stderr);assert.equal(r.exitCode,0,r.stderr);assert.ok(Buffer.from(e.stdoutBytes).equals(r.stdoutBytes),cmd);
    }
  }finally{rs.dispose();}
});

test("wkhtmltopdf numbers headers and footers after laying out physical sheets", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {wkhtmltopdfCommands} = await import("@poe-platform/safe-bash/commands/wkhtmltopdf");
  const fs = new MemoryFileSystem();
  const js = new Shell({cwd: "/", fs}).use(agentCommands()).use(wkhtmltopdfCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/blank", Buffer.from('<section class="page-break"></section><h2 class="page-break">Body</h2>'));
      await f.writeFile("/flow", Buffer.from("<title>Flow</title>" + "<p>Next paragraph</p>".repeat(9)));
    }
    for (const args of [
      "--footer-right '[page]/[topage]' blank",
      "--header-center '[webpage]' --footer-left '[title]' --page-height 150pt flow",
      "--page-offset 3 --header-left '[page]/[toPage]' --footer-line --copies 2 --no-collate cover blank flow",
      "--default-header blank --footer-font-size 7 --footer-center 'Sheet [page]' flow",
      "--header-line --footer-line blank",
      "--grayscale --replace tag Report blank --header-right '[tag] [date] [isodate]' flow --footer-center '[section] [page]'",
    ]) {
      const cmd = "wkhtmltopdf " + args + " -";
      const expected = await js.exec(cmd), actual = await rs.exec(cmd);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.ok(Buffer.from(expected.stdoutBytes).equals(actual.stdoutBytes), cmd);
    }
  } finally { rs.dispose(); }
});

test("tar writes interoperable PAX metadata and refuses unrepresentable USTAR entries", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  const long = "é".repeat(70) + "\nleaf";
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/plain", Buffer.from("a\0b"));
      await f.writeFile("/" + long, Buffer.from("payload"));
    }
    for (const args of ["plain", "--format=pax plain", "--format ustar plain", "--format=posix --owner=4000000 --group=5000000 '" + long + "'", "--format=ustar '" + long + "'", "--format=ustar --owner=4000000 plain"]) {
      for (const f of [fs, rs.fs]) {
        await f.utimes("/plain", 12345.25, 67890.5);
        await f.utimes("/" + long, 0.9765625, -1250.25);
        await f.writeFile("/out", Buffer.from("prior"));
      }
      const cmd = "tar -cf out " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")), cmd);
      if (!a.exitCode) {
        for (const list of ["tar -tf out", "tar -tvf out --full-time", "tar --utc --full-time -tf out"]) {
          const expected = await js.exec(list), actual = await rs.exec(list);
          assert.equal(expected.exitCode, 0, expected.stderr);
          assert.deepEqual([actual.exitCode, actual.stderr, actual.stdout], [expected.exitCode, expected.stderr, expected.stdout], list);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("tar leaves archives untouched when a source cannot be read", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.mkdir("/dir", {recursive: true});
      await f.symlink("../missing", "/dir/link");
      await f.mkdir("/cycle", {recursive: true});
      await f.symlink(".", "/cycle/again");
      await f.writeFile("/good", Buffer.from("ok"));
    }
    const seed = await js.exec("tar -cf - good");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const cmd of ["tar -cf out good missing", "tar -cf - missing", "tar -chf out dir", "tar -chf out cycle", "tar -rf out missing", "tar -uf out missing", "tar --exclude=missing -cf - missing"]) {
      for (const f of [fs, rs.fs]) await f.writeFile("/out", seed.stdoutBytes);
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdoutBytes], [a.exitCode, a.stderr, a.stdoutBytes], cmd);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")), Buffer.from(seed.stdoutBytes), cmd);
    }
  } finally { rs.dispose(); }
});

test("tar refuses explicit archive aliases and omits them from recursive inputs", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  for (const args of ["-cf dir/out dir/out", "-czf dir/out alias", "-chf dir/out link", "-cf link file", "-cf dir file", "-cf dir/out dir", "--format=ustar --mtime=@0 -cf dir/out link", "-rf dir/out file", "--delete -f dir/out file", "-rf dir/out alias", "-uf dir/out alias", "-Af dir/out alias"]) {
    const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
    const rs = new RustWasmBash({cwd: "/"});
    try {
      await fs.writeFile("/file", Buffer.from("seed"));
      const seed = await js.exec("tar -cf - file");
      assert.equal(seed.exitCode, 0, seed.stderr);
      for (const f of [fs, rs.fs]) {
        await f.mkdir("/dir", {recursive: true});
        await f.writeFile("/file", Buffer.from("seed"));
        await f.writeFile("/dir/out", seed.stdoutBytes);
        await f.link("/dir/out", "/alias");
        await f.symlink("dir/out", "/link");
        await f.chmod("/dir/out", 0o640);
        await f.utimes("/file", 10000, 10000);
        await f.utimes("/dir", 10000, 10000);
      }
      const cmd = "tar " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/dir/out")), Buffer.from(await fs.readFile("/dir/out")), cmd);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/alias")), Buffer.from(seed.stdoutBytes), cmd);
      assert.equal((await rs.fs.stat("/dir/out")).mode, (await fs.stat("/dir/out")).mode, cmd);
    } finally { rs.dispose(); }
  }
});

test("tar never rewrites a compressed archive during mutation", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.writeFile("/input", Buffer.from("contents"));
    const plain = await js.exec("tar cf - input");
    assert.equal(plain.exitCode, 0, plain.stderr);
    for (const flag of ["z", "j", "J"]) {
      const encoded = await js.exec("tar -c" + flag + "f - input");
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      for (const cmd of ["tar rf packed missing", "tar uf packed input", "tar --delete -f packed input", "tar Af plain packed", "tar -" + flag + "rf absent input"]) {
        for (const f of [fs, rs.fs]) {
          await f.writeFile("/plain", plain.stdoutBytes);
          await f.writeFile("/packed", encoded.stdoutBytes);
        }
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([a.exitCode, a.stdout, a.stderr], [2, "", "tar: cannot modify compressed archives\n"], cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
        assert.deepEqual(Buffer.from(await rs.fs.readFile("/packed")), Buffer.from(encoded.stdoutBytes), cmd);
        assert.deepEqual(Buffer.from(await rs.fs.readFile("/plain")), Buffer.from(plain.stdoutBytes), cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("tar validates raw mutation records and preserves untouched member bytes", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/new", Buffer.from("new"));
      await f.utimes("/new", 1000, 1000);
    }
    const seed = await js.exec("tar --format=ustar --mtime=@1 -cf - new");
    assert.equal(seed.exitCode, 0, seed.stderr);
    const tar = Buffer.from(seed.stdoutBytes);
    const checksum = Buffer.from(tar);
    checksum[0] ^= 1;
    const extension = (kind, payload) => {
      const head = Buffer.from(tar.subarray(0, 512));
      head[156] = kind.charCodeAt(0);
      head.write(payload.length.toString(8).padStart(11, "0"), 124);
      head.fill(32, 148, 156);
      head.write(head.reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
      const body = Buffer.alloc(512);
      body.write(payload);
      return Buffer.concat([head, body]);
    };
    const optional = extension("x", "21 SCHILY.fflags=foo\n");
    const extended = Buffer.concat([optional, tar]);
    const zeros = Buffer.alloc(1024);
    const cases = [
      [checksum, "header checksum mismatch"], [tar.subarray(0, 400), "truncated archive"],
      [tar.subarray(0, 513), "archive changed during preparation"], [tar.subarray(0, 1536), "truncated archive"],
      [Buffer.concat([tar, Buffer.alloc(1)]), "truncated archive trailing record"],
      [Buffer.concat([tar, tar]), "nonzero trailing archive data or concatenated archive is unsupported"],
      [Buffer.concat([tar.subarray(0, 1536), tar]), "missing second end-of-archive block"],
      [Buffer.concat([optional, zeros]), "orphan extended header at end of archive"],
      [Buffer.concat([extension("g", "21 SCHILY.fflags=foo\n"), tar]), "global PAX headers are unsupported for archive mutation"],
      [Buffer.concat([extension("x", "20 SCHILY.fflags=foo\n"), tar]), "invalid PAX record framing"],
      [Buffer.concat([extension("x", "11 alien=x\n"), tar]), "unsupported PAX keyword: alien"],
      [extended, undefined],
    ];
    for (const [input, error] of cases) {
      for (const cmd of ["tar rf out new", "tar Af base out", "tar --delete -f out new"]) {
        for (const f of [fs, rs.fs]) {
          await f.writeFile("/out", input);
          await f.writeFile("/base", tar);
          await f.utimes("/new", 1000, 1000);
        }
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        const diagnostic = cmd.includes("--delete") && error === "archive changed during preparation" ? "truncated archive body" : error;
        assert.deepEqual([a.exitCode, a.stderr], diagnostic ? [2, "tar: " + diagnostic + "\n"] : [0, ""], cmd);
        assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd + ": " + error);
        for (const path of ["/out", "/base"]) {
          const expected = Buffer.from(await fs.readFile(path));
          if (error) assert.deepEqual(expected, path === "/out" ? input : tar);
          assert.deepEqual(Buffer.from(await rs.fs.readFile(path)), expected, cmd + " " + path);
        }
      }
    }
    const joined = Buffer.concat([extended, tar]);
    for (const cmd of ["tar --ignore-zeros --delete --occurrence=2 -f out new", "tar -irf out new"]) {
      for (const f of [fs, rs.fs]) {
        await f.writeFile("/out", joined);
        await f.utimes("/new", 1000, 1000);
      }
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout]);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")), Buffer.from(await fs.readFile("/out")));
    }
  } finally { rs.dispose(); }
});

test("tar update uses the newest archived mtime and preserves a no-op archive", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.writeFile("/f", Buffer.from("old"));
    const newer = await js.exec("tar --format=ustar --mtime=@3 -cf - f");
    const older = await js.exec("tar --format=ustar --mtime=@1 -cf - f");
    assert.equal(newer.exitCode, 0, newer.stderr);
    assert.equal(older.exitCode, 0, older.stderr);
    for (const [input, mtime] of [[newer.stdoutBytes, 3000], [Buffer.concat([newer.stdoutBytes.slice(0, -1024), older.stdoutBytes]), 2000], [newer.stdoutBytes, 4000]]) {
      for (const f of [fs, rs.fs]) {
        await f.writeFile("/f", Buffer.from("new"));
        await f.utimes("/f", mtime, mtime);
        await f.writeFile("/out", input);
      }
      const cmd = "tar --totals -uf out f";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout]);
      const result = Buffer.from(await fs.readFile("/out"));
      assert.equal(result.equals(input), mtime <= 3000);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")), result);
    }
  } finally { rs.dispose(); }
});

test("tar append and update apply creation metadata to new entries and list only additions", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    const file = "/a b";
    await fs.writeFile(file, Buffer.from("old"));
    const seed = await js.exec("tar --format=ustar --mtime=@2 -cf - 'a b'");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const [op, mtime, added] of [["r", 2000, true], ["u", 1000, false], ["u", 3000, true]]) {
      for (const f of [fs, rs.fs]) {
        await f.writeFile(file, Buffer.from("new"));
        await f.utimes(file, mtime, mtime);
        await f.writeFile("/out", seed.stdoutBytes);
      }
      const cmd = "tar -" + op + "vf out --quoting-style=c --mtime=@" + (added ? "0" : "9") + " --mode=701 --owner=51 --group=63 'a b'";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stdout, a.stderr], [0, added ? '"a b"\n' : "", ""]);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
      assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")), Buffer.from(await fs.readFile("/out")), cmd);
    }
  } finally { rs.dispose(); }
});

test("tar reads valid members up to the first damaged header, body, or end record", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [name, value] of [["a", "one"], ["b", "two"]]) await fs.writeFile("/" + name, Buffer.from(value));
    const seed = await js.exec("tar --mtime=@1 --format=ustar -cf - a b");
    assert.equal(seed.exitCode, 0, seed.stderr);
    const plain = Buffer.from(seed.stdoutBytes);
    const damaged = Buffer.from(plain);
    damaged[1024] ^= 1;
    const {gzipSync} = await import("node:zlib");
    for (const [bytes, error] of [
      [Buffer.alloc(0), "truncated archive"], [damaged.subarray(1024), "header checksum mismatch"],
      [damaged, "header checksum mismatch"], [gzipSync(damaged), "header checksum mismatch"],
      [plain.subarray(0, 1537), "truncated archive body"], [plain.subarray(0, 1539), "truncated archive body"],
      [plain.subarray(0, 2560), "truncated archive"], [Buffer.concat([plain, plain]), "nonzero trailing archive data or concatenated archive is unsupported"],
      [plain, undefined], [gzipSync(plain), undefined],
    ]) {
      for (const cmd of ["tar --totals -tvf in", "tar -xvOf in", "tar -xvf in -C dest"]) {
        for (const f of [fs, rs.fs]) {
          await f.mkdir("/dest", {recursive: true});
          for (const name of ["a","b"]) await f.writeFile("/dest/" + name, Buffer.from("old"));
          await f.writeFile("/in", bytes);
        }
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.equal(a.exitCode, error ? 2 : 0, a.stderr);
        if (error) assert.ok(a.stderr.endsWith("tar: " + error + "\n"), a.stderr);
        assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], cmd + ": " + error);
        for (const name of ["a","b"]) assert.deepEqual(Buffer.from(await rs.fs.readFile("/dest/" + name)), Buffer.from(await fs.readFile("/dest/" + name)), name);
      }
    }
  } finally { rs.dispose(); }
});

test("tar reads global and local PAX fields and GNU long names in member order", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.writeFile("/f", Buffer.from("abc"));
    const seed = await js.exec("tar --format=ustar --mtime=@1 -cf - f");
    assert.equal(seed.exitCode, 0, seed.stderr);
    const tar = Buffer.from(seed.stdoutBytes);
    const member = tar.subarray(0, 1024);
    function extension(kind, payload) {
      const record = Buffer.from(member);
      record[156] = kind.charCodeAt(0);
      record.write(Buffer.byteLength(payload).toString(8).padStart(11, "0"), 124);
      record.fill(32, 148, 156);
      record.write(record.subarray(0, 512).reduce((a, b) => a + b).toString(8).padStart(6, "0") + "\0 ", 148);
      record.fill(0, 512);
      record.write(payload, 512);
      return record;
    }
    const global = extension("g", "18 uid=4294967297\n10 gid=42\n");
    const input = Buffer.concat([global, member, extension("x", "7 uid=\n9 path=z\n"), member, extension("L", "a GNU name\0"), member, tar.subarray(1024)]);
    for (const f of [fs, rs.fs]) await f.writeFile("/archive", input);
    for (const cmd of ["tar -tvf archive", "tar -xOf archive z 'a GNU name'", "tar --totals -tf archive missing"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      if (!cmd.includes("missing")) assert.equal(a.exitCode, 0, a.stderr);
      if (cmd.includes("-tvf")) {
        assert.match(a.stdout, /4294967297\/42/);
        assert.match(a.stdout, /-\/42/);
      }
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("tar confines member paths to real extraction directories", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.writeFile("/f", Buffer.from("member"));
    const seed = await js.exec("tar --format=ustar -cf - f");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const f of [fs, rs.fs]) {
      await f.mkdir("/dest", {recursive: true});
      await f.mkdir("/outside", {recursive: true});
      await f.symlink("/outside", "/dest/link");
      await f.symlink("/dest", "/root-link");
    }
    for (const [name, args] of [
      ["link/f", "-xvf in -C dest"], ["f", "-xf in -C root-link"],
      ["/outside/f", "-xvf in -C dest"], ["leaf", "-xf in -C dest"], ["hard", "-xf in -C dest"], ["in", "-xf in"], ["../outside/f", "-xOf in"], ["../outside/f", "-xf in -C dest other"],
      ["link/../outside/f", "--strip-components=2 -xf in -C dest"], [".", "-xf in -C dest"],
    ]) {
      const input = Buffer.from(seed.stdoutBytes);
      input.fill(0, 0, 100); input.write(name);
      input.fill(32, 148, 156);
      input.write(input.subarray(0, 512).reduce((a, b) => a + b).toString(8).padStart(6, "0") + "\0 ", 148);
      for (const f of [fs, rs.fs]) {
        await f.writeFile("/in", input);
        await f.writeFile("/outside/f", Buffer.from("untouched"));
        if (name === "leaf") await f.symlink("/outside/f", "/dest/leaf");
        if (name === "hard") await f.link("/outside/f", "/dest/hard");
      }
      const cmd = "tar " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, name.startsWith("/") || ["f", "leaf", "hard"].includes(name) ? 0 : 2, a.stderr);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], name + ": " + cmd);
      assert.equal(Buffer.from(await rs.fs.readFile("/outside/f")).toString(), "untouched");
      if (["f", "leaf", "hard"].includes(name)) assert.equal(Buffer.from(await rs.fs.readFile("/dest/" + name)).toString(), "member");
      if (name === "in") assert.deepEqual(Buffer.from(await rs.fs.readFile("/in")), input);
      if (name.startsWith("/")) assert.equal(Buffer.from(await rs.fs.readFile("/dest/outside/f")).toString(), "member");
    }
  } finally { rs.dispose(); }
});

test("tar verifies symlink targets against the extraction root before changing the destination", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  for (const [target, allowed] of [["../ok", true], ["dangling", true], ["local/f", true], ["../../escape", false], ["/absolute", false], ["inner/../file", false], ["alias/f", false], ["loop", false]]) {
    const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
    const rs = new RustWasmBash({cwd: "/"});
    try {
      await fs.mkdir("/src/sub", {recursive: true});
      await fs.symlink(target, "/src/sub/link");
      const seed = await js.exec("tar --format=ustar -cf - -C src sub/link");
      assert.equal(seed.exitCode, 0, seed.stderr);
      for (const f of [fs, rs.fs]) {
        await f.mkdir("/dest/sub", {recursive: true});
        await f.symlink("/dest/ok", "/dest/sub/local");
        await f.symlink("/outside", "/dest/sub/alias");
        await f.symlink("loop", "/dest/sub/loop");
        await f.writeFile("/dest/sub/link", Buffer.from("original"));
        await f.writeFile("/in", seed.stdoutBytes);
      }
      const cmd = "tar -xvf in -C dest";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, allowed ? 0 : 2, target + ": " + a.stderr);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], target);
      for (const f of [fs, rs.fs]) {
        if (allowed) assert.equal(await f.readlink("/dest/sub/link"), target);
        else assert.equal(Buffer.from(await f.readFile("/dest/sub/link")).toString(), "original");
      }
    } finally { rs.dispose(); }
  }
});

test("tar recreates hard links only to files published earlier in this extraction", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.mkdir("/src", {recursive: true});
    await fs.writeFile("/src/a", Buffer.from("payload"));
    await fs.link("/src/a", "/src/b");
    const seed = await js.exec("tar --format=ustar -cf - src/a src/b");
    assert.equal(seed.exitCode, 0, seed.stderr);
    const tar = Buffer.from(seed.stdoutBytes);
    assert.equal(tar[1024 + 156], 49);
    for (const [flags, operand, allowed] of [
      ["", "", true], ["--strip-components=1", "", true], ["--transform=s/src/dst/", "", true], ["", "src/b", false],
    ]) {
      for (const f of [fs, rs.fs]) {
        await f.mkdir("/extract/src", {recursive: true});
        await f.writeFile("/in", tar);
        await f.writeFile("/extract/src/a", Buffer.from("existing"));
      }
      const cmd = "tar -xvf in -C extract " + flags + " " + operand;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, allowed ? 0 : 2, a.stderr);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
      if (allowed) {
        const base = flags.includes("strip") ? "/extract/" : flags.includes("transform") ? "/extract/dst/" : "/extract/src/";
        for (const f of [fs, rs.fs]) {
          assert.equal(Buffer.from(await f.readFile(base + "b")).toString(), "payload");
          assert.equal((await f.stat(base + "a")).ino, (await f.stat(base + "b")).ino);
        }
      }
    }
    const link = tar.subarray(1024, 1536);
    const forward = Buffer.concat([link, tar.subarray(0, 1024), tar.subarray(1536)]);
    const self = Buffer.from(link);
    self.fill(0, 157, 257); self.write("src/b", 157);
    self.fill(32, 148, 156);
    self.write(self.reduce((a, b) => a + b).toString(8).padStart(6, "0") + "\0 ", 148);
    for (const [bytes, diagnostic] of [[forward, "hardlink target was not previously extracted (forward or unselected target): src/a"], [Buffer.concat([self, tar.subarray(1536)]), "self-referential hardlink entry is unsupported"]]) {
      for (const f of [fs, rs.fs]) {
        await f.writeFile("/extract/src/b", Buffer.from("keep"));
        await f.writeFile("/in", bytes);
      }
      const cmd = "tar -xf in -C extract";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stderr], [2, "tar: " + diagnostic + "\n"]);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout]);
      assert.equal(Buffer.from(await rs.fs.readFile("/extract/src/b")).toString(), "keep");
    }
  } finally { rs.dispose(); }
});

test("tar creation binds hard links to the earliest still-live archive name", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.mkdir("/src", {recursive: true});
      await f.mkdir("/other", {recursive: true});
      await f.writeFile("/src/a", Buffer.from("shared"));
      await f.link("/src/a", "/src/b");
      await f.link("/src/a", "/src/c");
      await f.writeFile("/other/a", Buffer.from("replaced"));
      await f.symlink("a", "/src/s");
      await f.utimes("/src/a", 1000, 1000);
    }
    const seed = await js.exec("tar --format=ustar --mtime=@0 -cf - -C other a");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const [op, names] of [
      ["c", "a b c"], ["c", "a a ./a b a"], ["c", "a b -C /other a -C /src c"],
      ["c", "--transform=s/a/x/ a b"], ["c", "--transform=s/[ab]/n/ a b c"], ["c", "-h s a"],
      ["r", "a b c"], ["u", "a b c"], ["c", "--format=pax a b c"],
      ["c", "--no-recursion . a b"],
    ]) {
      for (const f of [fs, rs.fs]) {
        await f.utimes("/src/a", 1000, 1000);
        await f.writeFile("/out", seed.stdoutBytes);
      }
      const cmd = "tar --format=ustar --mtime=@1 -" + op + "f out -C src " + names;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")), cmd);
      if (op === "c" && names === "a b c") {
        await rs.fs.mkdir("/dest", {recursive: true});
        const result = await rs.exec("tar xf out -C dest");
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal((await rs.fs.stat("/dest/a")).ino, (await rs.fs.stat("/dest/c")).ino);
      }
    }
  } finally { rs.dispose(); }
});

test("tar refuses hard-linked symlinks unless dereferenced, while ZIP stores each operand", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/f", Buffer.from("payload"));
      await f.link("/f", "/alias");
      await f.symlink("f", "/sym");
      await f.link("/sym", "/sym2");
      await f.writeFile("/out", Buffer.from("original"));
    }
    for (const flags of ["-cf", "-chf"]) {
      const cmd = "tar --format=ustar --mtime=@0 " + flags + " out sym2 f alias";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, flags === "-cf" ? 2 : 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout]);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")));
      if (a.exitCode) assert.equal(Buffer.from(await rs.fs.readFile("/out")).toString(), "original");
    }
    const zip = await rs.exec("zip -q separate.zip f alias && unzip -p separate.zip f && unzip -p separate.zip alias");
    assert.deepEqual([zip.exitCode, zip.stderr, zip.stdout], [0, "", "payloadpayload"]);
  } finally { rs.dispose(); }
});

test("tar stores relative member names while reading the original operand path", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.mkdir("/base/deep/sub", {recursive: true});
      await f.writeFile("/base/deep/sub/file", Buffer.from("nested"));
      await f.symlink("deep/sub", "/base/dirlink");
      await f.writeFile("/base/deep/file", Buffer.from("through link"));
      await f.writeFile("/base/file", Buffer.from("parent"));
      await f.writeFile("/base/name..ok", Buffer.from("literal"));
    }
    const seed = await js.exec("tar --mtime=@0 --format=ustar -cf - -C base file");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const args of [
      "-cf out /base/deep", "-cf out /base/deep/../file", "-cf out -C /base/deep ../file",
      "-cf out -C /base deep/sub/..", "-cf out -C /base deep/../name..ok", "-cf out -C /base name..ok",
      "-cf out -C /base ./deep//sub/./file", "-cf out -C /base dirlink/../file", "-cf out -C /base missing/../file", "-rf out /base/deep/sub/../sub", "-uf out /base/deep",
    ]) {
      for (const f of [fs, rs.fs]) await f.writeFile("/out", seed.stdoutBytes);
      const cmd = "tar --mtime=@1 --format=ustar --sort=name " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, args.includes("missing") ? 2 : 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")), cmd);
    }
  } finally { rs.dispose(); }
});

test("tar --exclude-caches skips contents only for directories bearing the cache signature", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    const signature = "Signature: 8a477f597d28d172789f06886806bc55";
    for (const f of [fs, rs.fs]) {
      for (const [dir, tag] of [["valid", signature], ["comment", signature + "\n# description"], ["short", signature.slice(0, -1)], ["wrong", " " + signature], ["symlink", null], ["dir", null], ["absent", null]]) {
        await f.mkdir("/files/" + dir, {recursive: true});
        await f.writeFile("/files/" + dir + "/data", Buffer.from(dir));
        if (tag !== null) await f.writeFile("/files/" + dir + "/CACHEDIR.TAG", Buffer.from(tag));
      }
      await f.symlink("../valid/CACHEDIR.TAG", "/files/symlink/CACHEDIR.TAG");
      await f.mkdir("/files/dir/CACHEDIR.TAG", {recursive: true});
    }
    for (const cmd of ["tar --sort=name --format=ustar --mtime=@1 --exclude-caches -cf out files", "tar --sort=name --format=ustar --mtime=@1 --exclude-caches -rf out files/short"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stderr], [0, ""]);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout]);
      const listing = (await js.exec("tar tf out")).stdout;
      for (const dir of ["short", "wrong", "dir", "absent"]) assert.ok(listing.includes("files/" + dir + "/data\n"));
      for (const dir of ["valid", "comment", "symlink"]) assert.ok(!listing.includes("files/" + dir + "/data\n"));
      assert.equal((await rs.exec("tar tf out")).stdout, listing);
      assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(await fs.readFile("/out")));
    }
  } finally { rs.dispose(); }
});

test("tar pads newly written archives to the requested record size before compression", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/f", Buffer.from("data"));
      await f.utimes("/f", 0, 0);
    }
    for (const [args, length] of [
      ["-cf out -b 16 f", 8192], ["-rf out --record-size +8K f", 8192],
      ["--delete -f out -b3 --occurrence=1 f", 3072], ["-uf out --record-size=8K f", 3072],
      ["-cf out --blocking-factor=10 --record-size=2K f", 2048],
      ["-czf out --record-size=5K f", 5120], ["-cf out --record-size=9007199254745088 f", null],
    ]) {
      const cmd = "tar --format=ustar --mtime=@0 --totals " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, length === null ? 2 : 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      let expected = Buffer.from(await fs.readFile("/out")), actual = Buffer.from(await rs.fs.readFile("/out"));
      if (args.includes("-czf") || length === null) { expected = gunzipSync(expected); actual = gunzipSync(actual); }
      if (length !== null) assert.equal(expected.length, length);
      assert.ok(actual.equals(expected), cmd);
    }
    const before = Buffer.from(await rs.fs.readFile("/out"));
    await assert.rejects(rs.exec("tar --record-size=1G -cf out f", {limits: {maxMemoryBytes: 65536}}), /maxMemoryBytes/);
    assert.ok(Buffer.from(await rs.fs.readFile("/out")).equals(before));
  } finally { rs.dispose(); }
});

test("tar compares filesystem metadata and hard-link identity as well as file contents", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.mkdir("/src/d", {recursive: true});
    await fs.writeFile("/src/d/a", Buffer.from("old"));
    await fs.link("/src/d/a", "/src/d/b");
    await fs.link("/src/d/a", "/src/d/c");
    await fs.symlink("a", "/src/d/s");
    await fs.writeFile("/src/d/line\nbreak", Buffer.from("gone"));
    const seed = await js.exec("tar --format=ustar --sort=name --mtime=@3 --mode=700 --owner=77 --group=88 -cf - -C src d");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const f of [fs, rs.fs]) {
      await f.mkdir("/live/d", {recursive: true});
      await f.writeFile("/live/d/a", Buffer.from("new"));
      await f.link("/live/d/a", "/live/d/c");
      await f.writeFile("/live/d/b", Buffer.from("new"));
      await f.symlink("b", "/live/d/s");
      for (const p of ["/live/d", "/live/d/a", "/live/d/b"]) await f.utimes(p, 1000, 1000);
      await f.writeFile("/in", seed.stdoutBytes);
    }
    for (const operand of ["d/a", "d/b", "d/c", "d/s", "d", "none"]) {
      const cmd = "tar --totals -dvf in -C live " + operand;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, operand === "none" ? 2 : 1);
      if (operand === "d/b") assert.match(a.stdout, /Not linked to archive target/);
      if (operand === "d/c") assert.doesNotMatch(a.stdout, /Not linked/);
      if (operand === "d/a") assert.match(a.stdout, /Uid differs\nd\/a: Gid differs/);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("tar restores file permissions and PAX times, honoring touch and permission overrides", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.writeFile("/member", Buffer.from("file"));
    for (const format of ["pax", "ustar"]) {
      await fs.utimes("/member", 123456, 45789);
      const seed = await js.exec("tar --format=" + format + " --mode=6777 -cf - member");
      assert.equal(seed.exitCode, 0, seed.stderr);
      for (const f of [fs, rs.fs]) await f.writeFile("/in", seed.stdoutBytes);
      for (const flags of ["", "--no-same-permissions", "--no-same-permissions -p", "-p --no-same-permissions", "-m", "--touch"]) {
        const cmd = "tar -xf in " + flags;
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stderr, b.stdout], [0, "", ""], cmd);
        assert.equal(a.exitCode, 0, a.stderr);
        const expected = await fs.stat("/member"), actual = await rs.fs.stat("/member");
        assert.equal(actual.mode, expected.mode, cmd);
        if (flags === "-m" || flags === "--touch") {
          for (const st of [expected, actual]) assert.ok(st.atimeMs > 123456 && st.mtimeMs > 45789);
        } else {
          assert.deepEqual([actual.atimeMs, actual.mtimeMs], [expected.atimeMs, expected.mtimeMs], cmd);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("tar restores directory metadata at archive end or when leaving a subtree", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    await fs.mkdir("/dir/nested", {recursive: true});
    await fs.mkdir("/sibling");
    await fs.writeFile("/last", Buffer.from("end"));
    const seed = await js.exec("tar --format=ustar --mtime=@123 --mode=577 -cf - dir sibling last");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const [index, [flags, corrupt]] of [
      ["--no-same-permissions", false], ["--touch", false], ["", true],
      ["--no-delay-directory-restore", true], ["--no-delay-directory-restore --delay-directory-restore", true],
    ].entries()) {
      const bytes = Buffer.from(seed.stdoutBytes);
      if (corrupt) {
        assert.equal(bytes.subarray(1536, 1540).toString(), "last");
        bytes[1536] ^= 1;
      }
      const dest = "/out" + index;
      for (const f of [fs, rs.fs]) { await f.writeFile("/in", bytes); await f.mkdir(dest); }
      const cmd = "tar -xf in -C " + dest + " " + flags;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, corrupt ? 2 : 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr], [a.exitCode, a.stderr], cmd);
      for (const dir of ["dir", "dir/nested", "sibling"]) {
        const path = dest + "/" + dir;
        const snapshot = st => [st.mode & 0o777, st.atimeMs === 123000, st.mtimeMs === 123000];
        assert.deepEqual(snapshot(await rs.fs.stat(path)), snapshot(await fs.stat(path)), cmd + ": " + dir);
      }
    }
  } finally { rs.dispose(); }
});

test("tar honors the last overwrite policy and finishes extracting after kept conflicts", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const path of ["/a", "/b"]) await fs.writeFile(path, Buffer.from("new"));
    const seed = await js.exec("tar -cf - a b");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const f of [fs, rs.fs]) await f.writeFile("/in", seed.stdoutBytes);
    for (const [index, flags] of ["-k", "-k --skip-old-files", "--skip-old-files --keep-old-files", "-k --overwrite"].entries()) {
      const dest = "/d" + index;
      for (const f of [fs, rs.fs]) { await f.mkdir(dest); await f.writeFile(dest + "/a", Buffer.from("old")); }
      const cmd = "tar --totals -xvf in -C " + dest + " " + flags;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, index % 2 === 0 ? 2 : 0, a.stderr);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      for (const p of ["/a", "/b"]) assert.deepEqual(Buffer.from(await rs.fs.readFile(dest+p)), Buffer.from(await fs.readFile(dest+p)));
    }
  } finally { rs.dispose(); }
});

test("tar parses substitution expressions before publishing and preserves escaped delimiters", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/a,a;A", Buffer.from("payload"));
      await f.writeFile("/archive", Buffer.from("original archive"));
    }
    for (const expr of ["s/[z-a]/x/", "s,a,b,q", "", "g/a/b/", "s", "s\\a", "s,a,b", "s,,b,", "s,a,b,;x",
      String.raw`s/a/\U&/`, String.raw`s/(a)/\1/`, String.raw`s/(a)/\2/x`]) {
      const cmd = "tar -cf archive --transform='" + expr + "' 'a,a;A'";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, 2, cmd);
      assert.deepEqual([b.exitCode, b.stderr], [2, a.stderr], cmd);
      for (const f of [fs, rs.fs]) assert.equal(Buffer.from(await f.readFile("/archive")).toString(), "original archive");
    }
    for (const [expr, name] of [
      [String.raw`s,\,,.,;s;A;z;ig`, "z.z;z"],
      [String.raw`s/(a)/[\1]/gix`, "[a],[a];[A]"],
      [String.raw`s/\(a\)/{\1}/g`, "{a},{a};A"],
      [String.raw`s/a;/a\//`, "a,a/A"],
      ["s/(a)/literal/", "a,a;A"],
    ]) {
      const cmd = "tar -cf archive --xform '" + expr + "' 'a,a;A' && tar -tf archive";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stderr, a.stdout], [0, "", name + "\n"], cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("sed and tar distinguish literal BRE punctuation from repetition and reject unfinished groups", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(sedCommands({replace: true})).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    const name = "aa a+ a? a{2} a|b";
    for (const f of [fs, rs.fs]) await f.writeFile("/" + name, Buffer.from("x"));
    for (const [pattern, replacement, extended, status] of [
      ["a+", "x", false, 0], ["a?", "x", false, 0], ["a{2}", "x", false, 0],
      [String.raw`\(a\)\+`, "x", false, 0], [String.raw`a\{2\}`, "x", false, 0],
      [String.raw`a\+`, "x", true, 0], [String.raw`a\|b`, "x", true, 0],
      [String.raw`\(?:a\)\(a\)`, String.raw`<\1>`, false, 0],
      ["(?:a)", String.raw`\1`, true, 2], [String.raw`\(a`, "x", false, 2],
      [")", "x", true, 2], ["[a", "x", false, 2],
      ["[z-a]", "x", false, 2], ["[[:missing:]]", "x", true, 2],
      ["[[.a.]]", "x", false, 2], ["[[=a=]]", "x", true, 2],
      [String.raw`[a-\d]`, "x", false, 2], [String.raw`[\w-z]`, "x", true, 2],
      [String.raw`[a-\n]`, "x", false, 2], ["[]a-]", "x", true, 0],
      ["[[:alpha:]0-9]", "x", false, 0],
    ]) {
      for (const cmd of [
        "echo '" + name + "' | sed " + (extended ? "-E " : "") + "'s/" + pattern + "/" + replacement + "/g'",
        "tar -cf archive --transform='s/" + pattern + "/" + replacement + "/g" + (extended ? "x" : "") + "' '" + name + "' && tar -tf archive",
      ]) {
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.equal(a.exitCode, status, cmd + ": " + a.stderr);
        assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      }
    }
    const cmd = "echo 'aa' | sed -n '/a+/p'";
    assert.equal((await js.exec(cmd)).stdout, "");
    assert.equal((await rs.exec(cmd)).stdout, "");
  } finally { rs.dispose(); }
});

test("tar rejects empty intermediate transformed member and link names", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {tarCommands} = await import("@poe-platform/safe-bash/commands/tar");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(tarCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) {
      await f.writeFile("/a", Buffer.from("data"));
      await f.symlink("other", "/link");
      await f.mkdir("/out");
    }
    const seed = await js.exec("tar --format=ustar -cf - link a");
    assert.equal(seed.exitCode, 0, seed.stderr);
    for (const f of [fs, rs.fs]) await f.writeFile("/in", seed.stdoutBytes);
    for (const [args, pattern] of [
      ["-cf in a", "a"], ["-rf in link", "other"], ["-tvf in --show-transformed-names", "other"],
      ["-xf in -C out", "link"], ["-xf in -C out a", "other"], ["-xOf in a", "other"],
    ]) {
      const cmd = "tar " + args + " --transform='s/^" + pattern + "$//;s/^$/recovered/'";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stderr], [2, "tar: invalid empty, NUL, or non-Unicode path\n"], cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      for (const f of [fs, rs.fs]) {
        assert.ok(Buffer.from(await f.readFile("/in")).equals(Buffer.from(seed.stdoutBytes)));
        assert.deepEqual(await f.readdir("/out"), []);
      }
    }
  } finally { rs.dispose(); }
});

test("whole-line searches honor anchors and preserve them as text in fixed-string mode", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(sedCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) await f.writeFile("/in", Buffer.from("abc\nxabc\nabcx\n^abc$\nabc$\n\nxy\n"));
    for (const bin of ["grep -E", "rg"]) {
      for (const [flags, pat, expected] of [
        ["-x", "^abc$", "abc\n"], ["-x", "abc$", "abc\n"], ["-x", "^$", "\n"],
        ["-x", "^abc$|xy$", "abc\nxy\n"], ["-x", "abc\\$", "abc$\n"],
      ]) {
        const cmd = bin + " " + flags + " '" + pat + "' in";
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([a.exitCode, a.stderr, a.stdout], [0, "", expected], cmd);
        assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
      }
    }
    for (const bin of ["grep", "rg"]) {
      const cmd = bin + " -Fx '^abc$' in";
      for (const sh of [js, rs]) assert.equal((await sh.exec(cmd)).stdout, "^abc$\n");
    }
    for (const [cmd, expected] of [
      ["grep -Ex '(a|abc)' in", "abc\n"],
      ["rg -o '(a|abc)$' in", "abc\nabc\n"],
      ["rg -o '(a$|^abc)' in", "abc\nabc\nabc\n"],
      [String.raw`sed -E 's/(a|abc)$/[\1]/' in`, "[abc]\nx[abc]\nabcx\n^abc$\nabc$\n\nxy\n"],
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode, a.stderr, a.stdout], [0, "", expected], cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("regex character classes select punctuation, controls, and complements inside unions", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(sedCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) await f.writeFile("/in", Buffer.from("A1_z !\t\v=é\n"));
    for (const c of ["blank", "cntrl", "graph", "print", "punct", "space"]) {
      for (const cmd of ["sed 's/[[:CLASS:]]/X/g' in", "grep -Eo '[[:CLASS:]]' in", "rg -o '[[:CLASS:]]' in"]) {
        const script = cmd.replace("CLASS", c);
        const a = await js.exec(script), b = await rs.exec(script);
        assert.equal(a.exitCode, 0, script + ": " + a.stderr);
        assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], script);
      }
    }
    for (const pat of [String.raw`[\D]`, String.raw`[^\D]`, String.raw`[\S]`, String.raw`[\W_]`, "[!a]", "[A-z]"]) {
      const cmd = "sed 's/" + pat + "/X/gi' in";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.exitCode, 0, a.stderr);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("rg dotall matches digits as well as newlines", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const f of [fs, rs.fs]) await f.writeFile("/in", Buffer.from("a1b\na\nb\na.b\n"));
    for (const [pat, expected] of [["a.b", "a1b\na\nb\na.b\n"], [String.raw`a\.b`, "a.b\n"]]) {
      const cmd = "rg -U --multiline-dotall -o '" + pat + "' in";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode,a.stderr,a.stdout], [0,"",expected],cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("regex groups treat parentheses and alternatives inside brackets as characters", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands()).use(sedCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [line, pat] of [
      ["a)b", "(a[)]b)"], ["a(b", "(a[(]b)"], ["a)b", "(a[[:alpha:])]b|q)"],
      ["a|b", "(a[]|)]b|q)"], ["q", "(a[]|)]b|q)"], ["q!", "((a[)]b|q)+!)"],
    ]) {
      for (const f of [fs, rs.fs]) await f.writeFile("/in", Buffer.from(line + "\n"));
      const cmd = "sed -E 's/" + pat + "/[\\1]/' in";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode,a.stderr,a.stdout], [0,"","[" + line + "]\n"],cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep, rg, and sed choose nonoverlapping alternatives in their dialect order", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands()).use(sedCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [cmd, expected] of [
      ["echo ab | grep -Eo '(a|ab)'", "ab\n"], ["echo ab | rg -o '(a|ab)'", "a\n"],
      [String.raw`echo ab | sed -E 's/((a|ab))/<\1,\2>/'`, "<ab,ab>\n"],
      [String.raw`echo ababx | sed -E 's/(a|ab)+x/<\1>/'`, "<ab>\n"],
      [String.raw`echo ab | sed -E 's/a|(ab)/[\1]/'`, "[ab]\n"],
      [String.raw`echo bc | sed -E 's/((a)|(b))(c)/<\1,\2,\3,\4>/'`, "<b,,b,c>\n"],
      ["echo ababx | rg -o '(a|ab)+x'", "ababx\n"],
      ["echo ab | rg -o 'a|ab'", "a\n"], ["echo ab | grep -Eo 'a|ab'", "ab\n"],
      ["echo ab | rg -o -e ab -e a", "ab\n"], ["echo ab | grep -o -e a -e ab", "ab\n"],
      ["echo xaaa | rg -o 'xa|aa'", "xa\naa\n"], ["echo ab | sed -E 's/a|ab/X/'", "X\n"],
      ["echo abb | rg --count-matches 'ab|b'", "2\n"],
      ["echo bcd | rg -o '^a|cd'", "cd\n"],
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode,a.stderr,a.stdout], [0,"",expected],cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep handles overlapping repetitions when the required suffix is absent", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({cwd: "/", fs}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    const line = "a".repeat(96);
    for (const f of [fs, rs.fs]) await f.writeFile("/lines", Buffer.from(line + "\n" + line + "z\n"));
    const cmd = "grep -Ex 'a*a*a*a*a*a*a*z' lines";
    const a = await js.exec(cmd);
    assert.equal(a.stdout, line + "z\n");
    const b = await rs.exec(cmd);
    assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout]);
  } finally { rs.dispose(); }
});

test("substitutions use original capture boundaries and count eligible empty matches", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const {sedCommands} = await import("@poe-platform/safe-bash/commands/sed");
  const {awkCommands} = await import("@poe-platform/safe-bash/commands/awk");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands()).use(sedCommands({replace: true})).use(awkCommands({replace: true}));
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [cmd, expected] of [
      [String.raw`echo aaa | sed -E 's/\b(a)|(a)/<\1,\2>/g'`, "<a,><,a><,a>\n"],
      ["echo abc | sed 's/a*/X/g'", "XbXcX\n"], ["echo abc | sed 's/a*/X/2'", "abXc\n"],
      ["echo aba | sed 's/a*/X/2g'", "abX\n"], ["echo éaé | sed 's/a*/_/g'", "_é_é_\n"],
      ["echo abc | awk '{n=gsub(/a*/, \"X\"); print n,$0}'", "3 XbXcX\n"],
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([a.exitCode,a.stderr,a.stdout], [0,"",expected],cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("rg replacements use the captures selected in the original input", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  const pattern = String.raw`'\b(a)|(a)' -r '<$1,$2>'`;
  try {
    for (const [cmd, expected] of [
      [`echo aaa | rg ${pattern}`, "<a,><,a><,a>\n"],
      [`echo aaa | rg -no ${pattern}`, "1:<a,>\n1:<,a>\n1:<,a>\n"],
      [`printf 'x\\naaa\\ny\\n' | rg -n -C1 ${pattern}`, "1-x\n2:<a,><,a><,a>\n3-y\n"],
      [`echo aaa | rg -Uo ${pattern}`, "<a,>\n<,a>\n<,a>\n"],
      ["echo abc | rg -o 'a*' -r X", "X\nX\nX\n"],
      ["printf 'abc\\na\\n\\n' | rg --count-matches 'a*'", "5\n"],
      ["echo aba | rg '(|a)(b?)' -r '[$0:$1:$2:$3]'", "[:::]a[b::b:]a[:::]\n"],
      ["echo ba | rg -o -e '(a)' -e '(b)' -r '<$0,$1,$2>'", "<b,,b>\n<a,a,>\n"],
      ["echo ba | rg -o -e '(?P<one>a)' -e '(?P<two>b)' -r '<$one,$two>'", "<,b>\n<a,>\n"],
      ["echo a | rg '(a)' -r '${}|${bad-$1}|${1}|$$'", "${}|${bad-a}|a|$\n"],
    ]) {
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0, "", expected], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg multiline replacement renders each selected block once", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [input, args, expected] of [
      ["aa\\naa\\n", "-Unob --column a -r XX", "1:1:0:XX\n1:2:1:XX\n2:1:3:XX\n2:2:4:XX\n"],
      ["aa\\naa\\n", "-U '^a' -r X", "Xa\nXa\n"],
      ["aaa\\n", String.raw`-U '\b(a)|(a)' -r '<$1,$2>'`, "<a,><,a><,a>\n"],
      ["xa\\nba\\nby\\n", String.raw`-U '(a)\n(b)' -r '<$1-$2>'`, "x<a-b><a-b>y\n"],
      ["before\\nxa\\nby\\nafter\\n", String.raw`-Unb --column -C1 '(a)\n(b)' -r '$2` + "\n" + "$1'", "1-0-before\n2:2:7:xb\n3:2:10:ay\n4-13-after\n"],
      ["a\\n", String.raw`-Unb '(a)\n' -r '$0'`, "1:0:a\n"],
      ["xa\\nby\\nxa\\nby\\n", String.raw`-Um1 '(a)\n(b)' -r X`, "xXy\n"],
      ["xa\\nba\\nby\\n", String.raw`-Unob --column '(a)\n(b)' -r X`, "1:2:1:X\n1:3:2:X\n"],
      ["é\\r\\n🦊foo\\nbar\\n", String.raw`-Unob --column '(foo)\n(bar)' -r '$2-$1'`, "2:5:8:bar-foo\n"],
    ]) {
      const cmd = `printf '${input}' | rg ${args}`;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0, "", expected], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq regex filters use original capture slots and preserve missing values", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [input, filter, values] of [
      ["aaa", String.raw`scan("\\b(a)|(a)")`, [["a",null],[null,"a"],[null,"a"]]],
      ["🦊aab", 'match("a|aa";"g") | .offset', [1,2]],
      ["🦊aab", 'splits("a|aa")', ["🦊","","b"]],
      ["🦊ab", 'match("(?<x>a)|(b)";"g") | .captures | map(.offset)', [[1,-1],[-1,2]]],
      ["aaa", 'scan("a|aa")', ["a","a","a"]],
      ["ab", 'scan("a*")', ["a","",""]],
      ["ab", 'capture("(a)(?<tail>b)")', [{tail:"b"}]],
      ["aaa", 'capture("(?<x>a)";"g")', [{x:"a"},{x:"a"},{x:"a"}]],
      ["aaa", 'capture("(?<x>b)")', []],
      ["aaa", 'capture("(?<a>x)|(?<b>a)")', [{a:null,b:"a"}]],
      ["aaa", String.raw`gsub("(?<start>\\ba)|(?<inside>a)"; .inside // "-")`, ["-aa"]],
      ["ab", 'gsub("";"-")', ["-a-b-"]],
      ["ab", 'sub("a"; "&")', ["&b"]],
      ["ab", 'sub("a"; .|type)', ["objectb"]],
    ]) {
      const cmd = `echo '${JSON.stringify(input)}' | jq -c '[${filter}]'`;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0,"",JSON.stringify(values) + "\n"], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq nonempty matching retries alternatives and empty patterns count UTF-8 boundaries", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [filter, values] of [
      ['scan("")', Array(6).fill("")], ['match("";"g")|.offset', [0,1,1,1,1,2]],
      ['capture("";"g")', [{},{},{}]], ['scan("(|a)";"n")', [["a"]]],
      ['capture("(?<x>|a)";"n")', [{x:"a"}]], ['match("|a";"gn")|.offset', [1]],
      ['test("x*";"n")', [false]], ['gsub("|a";"X";"n")', ["🦊X"]],
      ['splits("|a";"n")', ["🦊",""]],
    ]) {
      const cmd = `echo '"🦊a"' | jq -c '[${filter}]'`;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0,"",JSON.stringify(values) + "\n"], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq regex generators consume patterns and flags only as requested", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [filter, stdout, error = ""] of [
      ['first(scan(("a",error("late"))))', '"a"\n'],
      ['[scan(("a","b"))]', '["a","b"]\n'],
      ['[capture(("(?<x>a)","(?<y>b)"))]', '[{"x":"a"},{"y":"b"}]\n'],
      ['[match(("a","b");("","i"))|.string]', '["a","a","b","b"]\n'],
      ['[test((["a","i"],["c","g"]))]', '[true,false]\n'],
      ['[scan(empty)]', '[]\n'],
      ['scan(["a"])', '', 'array (["a"]) is not a string'],
      ['scan("a";3)', '', 'number (3) is not a string'],
      ['match("a";"l")', '', 'l is not a valid modifier string'],
    ]) {
      const cmd = `echo '"ab"' | jq -c '${filter}'`;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout],
          [error ? 5 : 0, error ? "jq: error (at <stdin>:1): " + error + "\n" : "", stdout], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq regex modifiers preserve literal characters and select multiline dot behavior", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [input, filter, expected, diagnostic = ""] of [
      ["ab", 'test("a b";"x")', true],
      ["ab", String.raw`capture("(?<first>a) # skip\n (b)";"x")`, {first:"a"}],
      ["a #b", String.raw`test("a\\ [#] b";"x")`, true],
      ["a+b", String.raw`test("a\\+b")`, true],
      ["a\nb", 'test("a.b";"m")', true],
      ["a\nb", 'match("a.b";"p")|.string', "a\nb"],
      ["a\nb", 'test("a.b";"s")', false],
      ["a\nb", 'gsub("a.b";"joined";"m")', "joined"],
      ["ab", 'gsub("a b";"joined";"x")', null, "xg is not a valid modifier string"],
    ]) {
      const cmd = `printf '%s' '${JSON.stringify(input)}' | jq -c '${filter}'`;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode,result.stderr,result.stdout],
          diagnostic ? [5, "jq: error (at <stdin>:0): " + diagnostic + "\n", ""] : [0,"",JSON.stringify(expected)+"\n"], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq lookaround preserves assertion captures without consuming input", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [input, filter, expected] of [
      ["aaa", 'match("(?<=a)(a)";"g")|.offset', [1,2]],
      ["🦊a🦊a", 'match("(?<=(?<prev>🦊))a";"g")|.captures[0].offset', [0,2]],
      ["aabb", 'scan("(?<=(a+))b")', [["aa"]]],
      ["abac", 'scan("a(?=(b|c))")', [["b"],["c"]]],
      ["abac", 'scan("a(?!b)(.)")', [["c"]]],
      ["abba", 'match("(?<!a)b";"g")|.offset', [2]],
      ["abab", String.raw`scan("(a)(?=b\\1)b")`, [["a"]]],
      ["aa", 'scan("(?<=a(?=a))a")', ["a"]],
      ["a", 'match("(?=())a";"n")|.string', []],
    ]) {
      const cmd = `echo '${JSON.stringify(input)}' | jq -c '[${filter}]'`;
      for (const shell of [js, rs]) {
        const r = await shell.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr,r.stdout], [0,"",JSON.stringify(expected)+"\n"], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq regex filters reject malformed patterns and report parser errors through try", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [filter, diagnostic] of [
      ['test("[")', "premature end of char-class"],
      ['match("(a")', "end pattern with unmatched parenthesis"],
      ['capture("a)")', "unmatched ')' in regular expression"],
      ['scan("[z-a]")', "empty range in char class"],
      ['capture("[z-a]")', "reversed character range"],
      ['sub("*a";".")', "target of repeat operator is not specified"],
      ['capture("*a")', "quantifier without an expression"],
      ['splits("a++")', "nested quantifier is not supported"],
      ['test("a{ 1}")', "invalid repetition interval"],
      ['gsub("a{3,1}";"-")', "invalid or excessive repetition interval"],
      [String.raw`test("(a\\1)")`, "pattern references an undefined or open capture group"],
      [String.raw`scan("\\")`, "trailing backslash in regular expression"],
      ['test("[[:bogus:]]")', "unsupported character class 'bogus'"],
      ['test("(?<missing")', "invalid named capture"],
    ]) {
      for (const caught of [false,true]) {
        const cmd = `echo '"aaa"' | jq -c '${caught ? "try "+filter+" catch ." : filter}'`;
        for (const shell of [js,rs]) {
          const r=await shell.exec(cmd), message="Regex failure: "+diagnostic;
          assert.deepEqual([r.exitCode,r.stdout,r.stderr], caught ? [0,JSON.stringify(message)+"\n",""] :
            [5,"","jq: error (at <stdin>:1): "+message+"\n"],cmd);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("jq bracket ranges decode escaped endpoints before comparing them", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [input,pattern,expected] of [
      ["\f", String.raw`[\n-\r]`, true], ["Q",String.raw`[A-\Z]`, true],
      ["\u0007",String.raw`[\a-\t]`,true], ["^","[]-a]",true], ["-","[a-]",true],
      ["x",String.raw`[\w-z]`,"Regex failure: character class cannot be a range endpoint"],
      ["x",String.raw`[a-\d]`,"Regex failure: character class cannot be a range endpoint"],
      ["x","[[=a=]]","Regex failure: collating and equivalence classes are not supported"],
      ["x","[[:abc]","Regex failure: unsupported character class ''"],
    ]) {
      const cmd = `printf '%s\\n' '${JSON.stringify(input)}' | jq -c 'try test(${JSON.stringify(pattern)}) catch .'`;
      for (const shell of [js,rs]) {
        const r=await shell.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr,r.stdout],[0,"",JSON.stringify(expected)+"\n"],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("jq inline regex flags apply to the enclosing group and restore outer modes", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [input,pattern,flags,expected] of [
      ["aA","(?i:a)(?-i:A)","",true], ["aAA","(?i)a(a)(?-i)a","",false],
      ["aAa","(?i)a(a)(?-i)a","",true], ["aB","(?i:a)b","",false],
      ["Éé",String.raw`(?i:(é)\1)`,"",true], ["é","[À-Ö]","i",true],
      ["ß","[S]","i",false], ["ß","[S-T]","i",true], ["İ","[i]","i",false],
      ["ΟΣος",String.raw`(ΟΣ)\1`,"i",true],
      ["a\nb","(?m:^b)","",true], ["a\nb","a(?s:.)b","",true],
      ["a\nb","a(?-s:.)b","m",false], ["b\n","b$","",true],
      ["x","(?-:x)","","Regex failure: empty inline regular expression flags"],
      ["x","(?ix:x)","","Regex failure: unsupported inline regular expression flag"],
      ["x","(?i","","Regex failure: unterminated inline regular expression flags"],
      ["x","(?P<x>x)","","Regex failure: unsupported jq regular expression group"],
    ]) {
      const cmd = `printf '%s\\n' '${JSON.stringify(input)}' | jq -c 'try test(${JSON.stringify(pattern)};${JSON.stringify(flags)}) catch .'`;
      for (const shell of [js,rs]) {
        const r=await shell.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr,r.stdout],[0,"",JSON.stringify(expected)+"\n"],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("deep jq regex groups compile and discard invalid patterns without exhausting the stack", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  const nested = "(?:".repeat(6000)+"a"+")".repeat(6000);
  try {
    for (const [pattern,expected] of [
      [nested,true], ["(?<="+nested+")b",true],
      [nested+"[","Regex failure: premature end of char-class"], ["a",true],
    ]) {
      const cmd = `echo '"ab"' | jq -c 'try test(${JSON.stringify(pattern)}) catch .'`;
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,JSON.stringify(expected)+"\n",""]);
      }
    }
  } finally { rs.dispose(); }
});

test("jq character classes use UTF-16 range order across the surrogate interval", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [input,pattern,expected] of [
      ["🦊","[a-\uffff]",true], ["\ue000","[a-🦊]",false], ["\ue000","[🦊-\uffff]",true],
      ["🦊","[\ue000-🦊]","Regex failure: empty range in char class"], ["x","[^🦊-\uffff]",true],
    ]) {
      const cmd = `echo '${JSON.stringify(input)}' | jq -c 'try test(${JSON.stringify(pattern)}) catch .'`;
      for (const shell of [js,rs]) {
        const r=await shell.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr,r.stdout],[0,"",JSON.stringify(expected)+"\n"],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("awk uses extended regex escapes consistently in rules, fields and functions", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const {awkCommands} = await import("@poe-platform/safe-bash/commands/awk");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()).use(awkCommands({replace:true}));
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [cmd,expected] of [
      [String.raw`printf 'a\n|||\nc\n' | awk '/^\|\|\|/{print}'`, "|||\n"],
      [String.raw`echo 'x|y' | awk '{n=gsub(/\|/,"#");print n,$0}'`, "1 x#y\n"],
      [String.raw`echo 'x|y' | awk '{print gensub(/\|/,"-",1)}'`, "x-y\n"],
      [String.raw`echo 'x|y' | awk '{print split($0,a,/\|/),a[2]}'`, "2 y\n"],
      [String.raw`echo 'x|y' | awk -F '\|' '{print NF,$2}'`, "2 y\n"],
      [String.raw`echo abc | awk '{p="\\|"; print ($0 !~ p),($0 ~ /\|/)}'`, "1 0\n"],
      [String.raw`echo 'x|y' | awk '{print match($0,/\|/,a),a[0]}'`, "2 |\n"],
      [String.raw`echo '🦊ax' | awk '{print match($0,/a(x)?(b)?/,m),RLENGTH,(2 in m),m[0]}'`, "5 2 0 ax\n"],
      [String.raw`echo aa | awk '{print match($0,/(a|aa)/,a),RLENGTH,a[0],a[1]}'`, "1 2 aa aa\n"],
      [String.raw`echo a | awk '{print ($0 ~ /\b(a)/)}'`, "0\n"],
    ]) {
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,expected,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg multiline counts, inverts and limits the selected records", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [args, expected, code = 0] of [
      [String.raw`-Uc '\S'`, "6\n"], [String.raw`-Uc '[^\n]'`, "6\n"],
      [String.raw`-Uc '[a\S]'`, "6\n"], ["-Uc --multiline-dotall a", "3\n"],
      ["-UFc --multiline-dotall a", "2\n"], ["--multiline-dotall -c a", "2\n"], ["-Uc '(?s:a)'", "2\n"],
      ["-Uc a", "2\n"], ["-Uoc a", "3\n"], ["-Um0 a", "", 1],
      [String.raw`-Uvc 'a\nb'`, "1\n"], [String.raw`-Uoc 'a\nb'`, "2\n"],
      [String.raw`-Unvm1 -r X 'a\nb'`, "5:z\n"], [String.raw`-Unm1 'a\nb'`, "1:aa\n"],
      [String.raw`-Unom1 'a\nb'`, "1:a\n2:b\n"], [String.raw`-Uocm1 'a\nb'`, "1\n"],
      [String.raw`-Unob --column 'a\nb'`, "1:2:1:a\n2:2:1:b\n3:1:5:a\n4:1:5:b\n"],
    ]) {
      const cmd = "printf 'aa\\nb\\na\\nb\\nz\\n' | rg " + args;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stderr, result.stdout], [code, "", expected], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg multiline anchors and inline flags follow the scope of each group", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [args, expected, code = 0, stderr = ""] of [
      [String.raw`-Un '^a\nb$'`, "2:a\n3:b\n"],
      [String.raw`-Unx 'a\nb'`, "2:a\n3:b\n"],
      [String.raw`-Un '(?-m:^a\nb$)'`, "", 1],
      ["-Un '(?-m:^a)'", "", 1], ["-Un '(?-m:b$)'", "7:b\n"],
      [String.raw`-Uni '(?-i:A)\n(?i:b)'`, "4:A\n5:B\n"],
      ["-Un '(?s:^a.b$)'", "2:a\n3:b\n"],
      ["-Un --multiline-dotall '(?-s:^a.b$)'", "", 1],
      ["-Un '(?i:é)'", "", 1],
      ["-Un '(?i-:x)'", "", 2, "rg: empty inline regular expression flags\n"],
    ]) {
      const cmd = "printf 'z\\na\\nb\\nA\\nB\\nÉ\\nb' | rg " + args;
      for (const shell of [js, rs]) {
        const result = await shell.exec(cmd);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [code, expected, stderr], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg keeps selection, columns and replacement spans through the last context record", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd: "/", fs: new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [input, args, expected] of [
      ["x\na\nxa\nb\na\nb", String.raw`-Um1 -A1 -r X 'a\nb'`, "xX\nX\n"],
      ["z\nba\nb\n", String.raw`-Um1 -A1 -r X '\S'`, "X\nXX\n"],
      ["a\\nb\\nc\\n", String.raw`-Unm1 -A1 'a\nb'`, "1:a\n2:b\n"],
      ["z\\nbaa\\naaz\\nza", "-nm1 -A1 --column a", "2:2:baa\n3:1:aaz\n"],
      ["z\\nbaa\\naaz\\nza", "-nm1 -A2 -v --column -r X a", "1:z\n2-2-baa\n3-1-aaz\n"],
      ["z\\nbaa\\naaz\\nza", "-nm1 -A3 -v a", "1:z\n2-baa\n3-aaz\n4:za\n"],
      ["x\\naa\\nb\\nz\\na\\nb\\nx", "-no -C1 -r X a", "1-x\n2:X\n2:X\n3-b\n4-z\n5:X\n6-b\n"],
      ["z\\nbaa\\naaz\\nza", "-nm1 -A2 -o a", "2:a\n2:a\n3:a\n3:a\n4:a\n"],
      ["x\\naa\\nb\\nz\\na\\nb\\nx", String.raw`-Unb --column -C1 'a\nb'`, "1-0-x\n2:2:2:aa\n3:1:5:b\n4-7-z\n5:1:9:a\n6:1:11:b\n7-13-x\n"],
    ]) {
      const cmd = `printf '${input}' | rg ${args}`;
      for (const shell of [js, rs]) {
        const r = await shell.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,expected,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg visits UTF-8 byte offsets for empty matches and preserves split replacement bytes", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [cmd, bytes] of [
      ["echo é | rg -ob '()'", "0:\n1:\n2:\n"],
      ["printf 🦊a | rg -ob ''", "0:\n1:\n2:\n3:\n4:\n"],
      ["echo 🦊a | rg -ob 'a*'", "0:\n1:\n2:\n3:\n4:a\n"],
      [String.raw`echo 🦊a | rg -ob '\B'`, "0:\n1:\n2:\n3:\n"],
      ["echo 🦊a | rg -ob '(.|)'", "0:🦊\n4:a\n"],
      ["echo é | rg -o '()' -r '<$1>'", "<>\n<>\n<>\n"],
      ["echo é | rg '()' -r X", Uint8Array.of(88,195,88,169,88,10)],
      ["echo é | rg -U '(a\\n)?' -r X", Uint8Array.of(88,195,88,169,88,10)],
    ]) {
      for (const sh of [js,rs]) {
        const r = await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stderr],[0,""],cmd);
        assert.deepEqual(r.stdoutBytes, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg null-data keeps record delimiters independent of count and filename output", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [args,expected] of [
      ["-n a","1:aa\0"+"3:a\0"], ["-nv a","2:b\nc\0"], ["-0Hc a","f\0"+"2\n"],
      ["-nob .","1:0:a\0"+"1:1:a\0"+"2:3:b\0"+"2:5:c\0"+"3:7:a\0"],
      [String.raw`-Unbo --column 'b\nc'`,"2:4:3:b\nc\0"], [String.raw`-Unom1 '\S'`,"1:a\0"+"1:a\0"+"2:b\0"],
      ["-Unob --multiline-dotall 'a.b'","1:1:a\0"+"2:1:b\0"],
      ["--crlf -o a","a\0a\0a\0"], ["-l a","f\n"], ["-nr X a","1:XX\0"+"3:X\0"],
    ]) {
      const cmd = "printf 'aa\\0b\\nc\\0a\\0' >f; rg --null-data " + args + " f";
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,expected,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg chooses record anchors for ordinary ASCII searches in NUL-delimited batches", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [input,args,expected] of [
      ["b\\nc\\0", "'^b$'", ""], ["b\\nc\\0", "'(?m:^b$)'", "1:b\nc\0"],
      ["b\\nc\\0", "-r '$0' '^b$'", "1:b\nc\0"], ["b\\né\\0", "'^b$'", "1:b\né\0"],
      ["b\\nc\\0é\\0", "'^b$'", "1:b\nc\0"], ["b\\nc\\0é", "'^b$'", ""],
      ["b\\nc\\0é\\0", "-m1 '^b$'", ""], ["b\\nc\\0", "-x b", ""],
      ["b\\nc\\0", "'b$|()'", "1:b\nc\0"],
    ]) {
      const cmd = `printf '${input}' >f; rg --null-data -Un ${args} f`;
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[expected ? 0 : 1,expected,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg file listing status and quiet diagnostics follow target order", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const sh of [js,rs]) await sh.exec("echo x >b; echo x >a; echo y >y; touch empty");
    const missing = "rg: ENOENT: no such file or directory, stat '/absent'\n";
    for (const [cmd,code,stdout,stderr = ""] of [
      ["rg --files-without-match x y",0,"y\n"], ["rg --files-without-match x b",1,""],
      ["rg -q --files-without-match x b",1,""], ["rg -q --files-without-match x empty",0,""],
      ["rg -m0 --files-without-match x absent",1,""], ["rg -c --include-zero -m0 x y",1,""],
      ["echo y | rg --files-without-match x",0,"<stdin>\n"],
      ["echo x | rg -l --sort=path x b - a",0,"b\n<stdin>\na\n"],
      ["rg -q x b absent",0,""], ["rg -q x absent b",0,"",missing],
      ["rg -q --files-without-match x b absent",2,"",missing],
      ["rg --files-without-match x absent y",2,"y\n",missing],
    ]) {
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[code,stdout,stderr],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg distinguishes text, explicit binary inputs and discovered binary files", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const sh of [js,rs]) await sh.exec("mkdir d; printf 'x\\0y\\nx\\n' >d/blob; echo z >d/plain");
    const notice = 'binary file matches (found "\\0" byte around offset 1)\n';
    for (const [cmd,code,stdout] of [
      ["rg -a -n x d",0,"d/blob:1:x\0y\nd/blob:2:x\n"],
      ["rg -n x d",1,""], ["rg -n '^y$' d/blob",0,notice], ["cat d/blob | rg x",0,notice],
      ["rg -Uc '(?s:.*x)' d/blob",0,"2\n"], ["rg -Uac '(?s:.*x)' d/blob",0,"1\n"],
      ["rg --binary -c '^x$' d",0,"d/blob:2\n"], ["rg --files-without-match z d",1,""],
      ["rg -uuu -a -ob . d/blob",0,"0:x\n1:\0\n2:y\n4:x\n"],
      ["rg -a -uuu x d",0,"d/blob: "+notice], ["rg --binary --no-binary x d",1,""],
      ["rg --text --no-text -c '^y$' d/blob",0,"1\n"], ["rg -B1 y d/blob",1,""],
    ]) {
      for (const sh of [js,rs]) {
        const r=await sh.exec(cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[code,stdout,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("rg searches invalid UTF-8 at its original byte offsets and writes original bytes", async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const data = Uint8Array.of(255,97,195,169,10,226,130,10);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/blob",data);
  const js = new Shell({cwd:"/",fs}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/",files:{"/blob":data}});
  try {
    for (const [options,expected,filter] of [
      ["-ob .",[49,58,97,10,50,58,195,169,10]],
      ["-a -ob '�'",[48,58,255,10,53,58,226,10,54,58,130,10]],
      ["-a -r '<$1>' '(�)'",[60,255,62,97,195,169,10,60,226,62,60,130,62,10]],
      ["-a '�'",data], ["-a -o 'é'",[195,169,10]], ["-a -o -M1 '�'",[255,10,226,10,130,10]],
      ["-bo 'a$'",[]], ["-bo '(é)$'",[50,58,195,169,10]],
      ["--json -a '�'",
        new TextEncoder().encode('[{"bytes":"/2HDqQo="},{"bytes":"/w=="}]\n[{"bytes":"4oIK"},{"bytes":"4g=="}]\n'),
        "jq -c 'select(.type==\"match\") | [.data.lines,.data.submatches[0].match]'"],
    ]) {
      for (const search of ["rg "+options+" /blob", "cat /blob | rg "+options]) {
        const cmd = filter ? search+" | "+filter : search;
        for (const sh of [js,rs]) {
          const r=await sh.exec(cmd);
          assert.deepEqual([r.exitCode,r.stderr],[expected.length ? 0 : 1,""],cmd);
          assert.deepEqual(r.stdoutBytes,Uint8Array.from(expected),cmd);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("rg preserves carriage returns in records and applies CRLF to match and omission output", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const [cmd,expected] of [
      ["rg -n x","1:ax\r\n"], ["grep -n x","1:ax\r\n"], ["rg '^ax$'",""],
      ["rg --crlf -n '^ax$'","1:ax\r\n"], ["rg --crlf -C1 -n -M1 x","1:[Omitted long matching line]\r\n2-[Omitted long context line]\r\n"],
      [String.raw`rg -Uno --crlf -M1 'ax\r\nby'`,"1:[Omitted long matching line]\r\n2:[Omitted long matching line]\r\n"],
      [String.raw`rg -Unob --crlf 'ax\r\nby'`,"1:0:ax\r\r\n2:0:by\r\n"],
      [String.raw`rg -Un --crlf -o --trim -r ' Z' 'ax\r\nby'`,"1:Z\r\n"],
    ]) {
      for (const sh of [js,rs]) {
        const r=await sh.exec("printf 'ax\\r\\nby\\r\\n' | "+cmd);
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[expected ? 0 : 1,expected,""],cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("grep validates plain ASCII searches record by record and preserves earlier output", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({cwd:"/",fs}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const invalid of [0,255]) {
      const data=Uint8Array.of(97,195,169,10,97,invalid,10,97,10);
      await fs.writeFile("/blob",data); rs.writeFile("/blob",data);
      for (const [cmd,code,expected] of [
        ["grep a /blob",2,data.slice(0,4)], ["cat /blob | grep '^a'",2,data.slice(0,4)],
        ["grep -E a /blob",0,data], ["grep -a a /blob",0,data],
        ["grep -- a /blob",0,data], ["cat /blob | grep a -ai",0,data],
      ]) {
        for (const sh of [js,rs]) {
          const r=await sh.exec(cmd);
          assert.deepEqual([r.exitCode,r.stderr,r.stdoutBytes],[code,code===2 ?
            "grep: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n" : "",expected],cmd);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("rg JSON end and summary records account for each input and emitted byte", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({cwd:"/",fs}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const sh of [js,rs]) await sh.exec("mkdir d; printf 'éx\nx\nz\nx' > d/a; echo z > d/b; printf 'x\\0z\\nx\n' > d/bin");
    for (const args of ["x d/a d/b", "x d/bin", "x d", "-m1 -A1 x d/a", "-m1 x d/a d/b", "-C1 -v x d/a",
      "-q x d/a d/bin", "missing d", "x nofile", "-Ua -C1 'x\\nz' d/a", "--crlf x d/a"]) {
      const cmd="rg --json "+args;
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout],[a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("rg rejects malformed regexes before searching and treats fixed patterns literally", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const sh of [js,rs]) await sh.exec("printf 'x\\n(\\n' >f");
    for (const [opts,pat] of [
      ...["(",")","(?=x)","(?<!x)","(x)\\1","(?z:x)","[","[z-a]","[[:oops:]]","x\\",
        "*","^*","a{","a{foo}","a{2,1}","a{,3}","a{1001}","a{1, 2}","a{99999999999999999}",
        "\\n","[\\n]","x\ny","(?m:x\\ny)","[[=x=]]","[a-\\w]","[\\s-x]","[[:digit:]-z]","[z-[:digit:]]",
        "(?<1>x)","(?<>x)","(?<a>x)(?<a>x)","(?P<name","(?<x.y>a)"].map(p=>["",p]),
      ["-F","x\ny"],["-F","("],["-U","x\\n"],["-U","[\\n]"],["","x{0,1000}"],["","\\("],
    ]) {
      const cmd="rg "+opts+" '"+pat+"' f";
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd);
    }
  } finally { rs.dispose(); }
});

test("rg whole-word matching follows the matcher selected for each record batch", async () => {
  const {Shell,MemoryFileSystem,agentCommands} = await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({cwd:"/",fs}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const [data,options] of [
      ["x.\n.\n","-w '^'"], ["x.\n.\n","-aw '^'"], ["x.\n","-w '(?i:x.)'"],
      ["x.\né\n","-w 'x.'"], ["x.\né","-w 'x.'"], ["x.\né\n","-w -m1 'x.'"],
      ["x.\né\n","-wq --json 'x.'"], ["x.\0é\n","-w 'x.'"], ["ééaé\n","-w é"],
      ["x.\né\n","-wx 'x.'"], ["x.\né\n","-aw -o '.*'"],
    ]) {
      await fs.writeFile("/f",new TextEncoder().encode(data)); rs.writeFile("/f",data);
      const cmd="rg "+options+" /f";
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd+" on "+JSON.stringify(data));
    }
  } finally { rs.dispose(); }
});

test("grep validates bounded regex batches before emitting matches, counts or filenames", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({cwd:"/",fs}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const [file,data] of [["good",[97,10]],["bad",[97,10,255,97,10]],["nul",[97,10,0,10]]]) {
      const bytes=Uint8Array.from(data); await fs.writeFile("/"+file,bytes); rs.writeFile("/"+file,bytes);
    }
    for (const cmd of [
      "grep -ob . bad","cat bad | grep -ob .","grep -n . good bad","grep -cs . bad good",
      "grep -m2 -b . bad","grep -m1 -A1 . bad","grep -ql . bad","grep -L . bad","egrep -so . bad",
      "grep -Eob 'a|z' bad","grep -Fo a bad","grep -Eo a bad","grep -o '\\ba' bad",
      "grep -c . nul","grep -Ic . nul","grep -Iq . nul","grep -IL . nul","grep -zoc . nul",
    ]) {
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdoutBytes,b.stderr],[a.exitCode,a.stdoutBytes,a.stderr],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep -o selects empty matches without printing them or inverted records", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for (const args of ["-nob '^'","-ob 'a*'","-aob '^'","-o -e '' -e a","-ov a","-ovc a","-ovn '^'","-A1 -no a","-B1 -no a"]) {
      const cmd="printf 'aab\\nz\\nz\\naz\\n' | grep "+args;
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd);
    }
    const cmd="echo a >f; grep -B1 -o '^' f f";
    for (const sh of [js,rs]) {
      const r=await sh.exec(cmd);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"--\n",""],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep preserves bytes and precedence of pattern files and argument patterns", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({cwd:"/",fs}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for(const [file,bytes] of [["f",[195,169,10,195,131,194,169,10,97,13,10,97,97,10]],
      ["p",[233,10]],["cr",[97,13,10]],["short",[97,10]],["empty",[]]]) {
      const data=Uint8Array.from(bytes); await fs.writeFile("/"+file,data); rs.writeFile("/"+file,data);
    }
    for(const cmd of ["grep -aob é f","grep -aFob é f","grep -Fob é f","grep -Eob '(?i:é)' f",
      "grep -aof p f","grep -ao --file=p f","cat p | grep -ao -f - f","grep -Fof cr f",
      "grep f -a -f short -o -e aa","grep f -e a","grep -f empty -c f","grep -f missing --help | head -1"]) {
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdoutBytes,b.stderr],[a.exitCode,a.stdoutBytes,a.stderr],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep reports out-of-profile pattern bytes before opening the target", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for(const sh of [js,rs]) await sh.exec("printf 'xé\\n' >p; echo a >f");
    for(const args of ["é absent","-xf p f","-Eo '(x)é' f","-o 'a+é' f","-Eo '\\dé' f",
      "-Eo '[\\w]é' f","-o '\\qé' f","-Eo '(?:a){02,2}é' f","-Eo '(?<abc>a)é' f",
      "-e é -e '\\ba' f","-F é f","-a 'é' f","-o '\\(a\\)é' f","-o '*' f","-o 'a\\{02,02\\}é' f"]) {
      const cmd="grep "+args;
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep and rg apply stacked repetitions only in profiles that execute them", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for(const sh of [js,rs]) await sh.exec("printf 'abaac\\n42\\n' >f");
    for(const cmd of [
      "rg -ao 'a*??' f","grep -Ex '(a?)++' f","rg -a -r '<$1>' '(a?)?{2,3}' f",
      "grep -Eo 'a++' f","grep -Ex 'a++' f","rg '(?<word>a)++' f","rg '🦊a++' f","rg '\\d++' f",
      "rg -e 'a++' -e '' f","rg '(?:a)++' missing","grep -Eaob 'a++' f","grep -Eo 'a++?' f",
      "grep -Eob -e 'a?+' -e '\\b' f","rg -o '(?i:a+*)' f","rg -Uo '[^x]++' f",
      "rg -a -r '<$1>' '(a+){1,2}+' f","rg -a -o '(a?)*+' f","grep -o 'a*\\+' f",
    ]) {
      const a=await js.exec(cmd), b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep bounded whole-word regexes report byte-sized matches inside UTF-8", async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rs=new RustWasmBash({cwd:"/"});
  try {
    for(const sh of [js,rs]) await sh.exec("printf 'é\\naé.\\n🦊\\n' >f");
    for(const opts of ["-wob .","-wob '[^a]'","-xwob ..","-xwob .","-xawob .","-Fwob é","-wob '\\b.'","-ob ."]) {
      const cmd="grep "+opts+" f"; const a=await js.exec(cmd),b=await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdoutBytes],[a.exitCode,a.stderr,a.stdoutBytes],cmd);
    }
  } finally { rs.dispose(); }
});

test("grep option spelling and arguments match production for short and long forms", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const sh of [js, rs]) await sh.exec("printf 'a\\nb\\na\\n' >f");
    for (const args of [
      "-U a f", "--count-matches a f", "--binary a f", "--binary=yes", "--count=", "--unknown=value",
      "--file", "--regexp", "--before-context", "--colour", "--include", "-nA", "-m", "-B", "-C",
      "-n1 a f", "-1n a f", "-1 a f", "-A -23 a f", "-e -1 <<< -C1", "-A+1 a f", "-m0 a f", "--context=+1 a f",
      "--max-count 9007199254740992 a f", "--regexp=a --max-count=1 f", "--regexp a --max-count 1 f",
      "--regexp= --label=x", "-e-- -", "--help -EF", "-- -U f",
    ]) {
      const cmd = "grep " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdoutBytes], [a.exitCode, a.stderr, a.stdoutBytes], cmd);
    }
  } finally { rs.dispose(); }
});

test("grep walks directories, applies basename filters in order and reports filesystem errors", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const setup = "mkdir -p d/.git d/sub; cd d; echo yes >a; cp a sub/a; cp a .git/a; cp a b; ln -s a alink; ln -s sub sublink; echo a >patterns; cp a denied; chmod 000 denied";
    for (const sh of [js, rs]) await sh.exec(setup);
    for (const cmd of [
      "cd d; grep -r yes", "grep -r --exclude-dir=sub yes d", "grep -r --exclude-dir=a yes d",
      "grep -r --exclude=sub yes d", "grep -r --exclude=a --include=a yes d",
      "grep -r --include='sub/a' yes d", "grep --exclude=a yes d/a", "grep --exclude-dir=a yes d/a",
      "grep -R --exclude-dir=sub yes d/sublink", "grep -r yes d/alink",
      "grep --exclude=missing yes missing", "grep -r --exclude=missing yes missing",
      "grep -E yes ./missing", "grep ^ missing", "grep -l yes <<< yes", "egrep yes d", "grep yes d/denied", "grep --label=test yes d/denied",
      "grep -f d/denied d/a", "grep --file= d/a", "grep -f d d/a", "grep --exclude-from=d/a/no yes d",
      "grep -m0 -c yes missing", "grep -m0 -L yes missing", "grep -Dskip -m0 yes missing",
      "cd d; ln -s . sub/loop; grep -R yes sub",
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdoutBytes], [a.exitCode, a.stderr, a.stdoutBytes], cmd);
    }
  } finally { rs.dispose(); }
});

test("rg file listing and searching use the same traversal and symlink rules", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const sh of [js, rs]) await sh.exec("mkdir -p d/sub d/empty d/.git; echo a >d/file; cp d/file d/.git/f; cp d/file d/sub/f; ln -s file d/link; ln -s sub d/sublink; ln -s missing d/bad");
    for (const cmd of [
      "rg a d", "rg --files d", "rg --files --hidden d", "rg --files ./d", "rg -L a d",
      "rg --follow --files d", "rg -L --no-follow --files d", "rg --files -q d",
      "rg --files --no-messages d/bad", "rg --files d/empty", "rg --files d/link",
      "rg --max-filesize=1 --files d/file", "rg -g '*.js' a d/file", "rg --files --sort=path d/sub d/file",
      "rg --files -", "rg --files -q missing d/file", "rg --files -q d/file missing",
      "rg --files --stats d/sub", "rg --files -q --stats d/sub missing",
      "cd d; rg a .", "cd d; rg a", "cd d; rg --files",
      "ln -s .. d/sub/up; rg --follow a d", "rg -L --files d", "rg -Lq a d", "rg -L --files -q d",
      "chmod 000 d/file; rg a d/link", "rg --no-messages a d/file", "rg --files d/file",
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("rg statistics count searched records and printed matches in each output mode", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const setup = "printf 'aa\\nx\\nb\\na\\nc' >t; printf 'aa\\nx\\0b\\na\\nc' >n; printf 'x\\0a\\n' >b";
    for (const sh of [js, rs]) await sh.exec(setup);
    for (const args of ["-c a t", "-l a t", "--files-without-match z n", "-o a n", "-B1 a b",
      "-q a missing t", "-q a t missing", "-q z t missing", "--json -q a t missing",
      "-q --files-without-match z t missing", "-m1 a t", "-m1 -q a t", "-m1 --count-matches a t", "-m1 -A1 a t", "-m1 -A1 -v a t",
      "-m1 -C4 a t", "-v a n", "--json -m1 -C4 a t", "-Uom1 'a\\nx' t"]) {
      const cmd = "rg --stats " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("rg groups output records across operands and only prints each heading once", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const sh of [js, rs]) await sh.exec("printf 'a\\nx\\ny\\nz\\na\\nb\\n' >f; cp f g; echo x >empty");
    for (const args of ["-A1 a f empty g", "-C1 --context-separator=SEP a f g f",
      "-A1 --heading a f g f", "--heading -0 a f g", "--heading a f f",
      "--stats -C1 a f g", "-UoA1 'a\\nb' f g", "-UC1 -r X 'a\\nb' f g",
      "-UC1 --heading -r X 'a\\nb' f g f", "-C1 --no-context-separator a f g",
      "-U --heading -o 'a\\nb' f g f"]) {
      const cmd = "rg " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdoutBytes], [a.exitCode, a.stderr, a.stdoutBytes], cmd);
    }
  } finally { rs.dispose(); }
});

test("rg numeric options keep their spelling, size units and safe integer bounds", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const sh of [js, rs]) await sh.exec("mkdir d; printf 'a\\nx\\na\\n' >d/file");
    for (const args of ["--threads=1 a d", "--maxdepth bad a d", "--max-count=", "-nA", "-A+1 a d",
      "--context=1 a d", "--after-context 1 a d", "--A=2 a d", "--max-depth 0 --files d",
      "--max-filesize=1k --files d", "--max-filesize=4194304K --files d", "--max-filesize=8589934592M --files d",
      "--max-filesize=9007199254740992G a d", "--max-filesize ' 4' --files d", "--max-filesize=0 --files d",
      "--json -A4294967295 a d/file", "-M9007199254740992 a d", "-j9007199254740991 a d", "-m"]) {
      const cmd = "rg " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op validates root flags before selecting help or version", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const args of ["--unknown", "--unknown=yes", "--unknown --help", "-z", "-zv", "-z=1", "-",
      "--debug", "--cache=false", "--version=false", "--version=bad", "-hv", "--no-color --version",
      "-- --not-a-flag", "--format json", "--format", "--config demo --version", "--encoding=x --version",
      "--account=sample", "--session sample", "--encoding=x --help", "--encoding=x", "--format=bad --version",
      "--version --version=false", "-vh=false", "--format=invalid --format=json",
      "--cache=t --debug=F", "--format="]) {
      const cmd = "op " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout], [a.exitCode,a.stderr,a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op resolves help for catalog commands, groups and aliases without executing them", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const { opCatalogNodes } = await import("../../safe-bash-command-op/dist/catalog.js");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const cases = ["--help account list", "--format json --help account", "help vault missing", "help unknown",
      "vault create Example --help=true", "vault list --format=json", "help vault get Example", "vault -- help"];
    for (const { path, aliases, availability } of opCatalogNodes) {
      if (!path.length || availability === "beta") continue;
      cases.push("help " + path.join(" "), path.join(" ") + " --help");
      for (const alias of aliases) cases.push([...path.slice(0, -1), alias, "-h"].join(" "));
      if (opCatalogNodes.some(node => node.path.length > path.length && path.every((part, i) => node.path[i] === part))) {
        cases.push(path.join(" "));
      }
    }
    for (const args of cases) {
      const cmd = "op " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op read rejects non-ASCII scheme prefixes and op run stops on unresolved references", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["op read '😀😀'", "op read 'op:/é'", "op --version",
      "TOKEN=op://missing/item/password op run -- touch ran",
      "TOKEN='{{ op://missing/item/password }}' op run --no-masking -- touch ran",
      "test -e ran"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op masks the longest original byte match in run and snapshot child output", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const fields = ["A=text", "B=text-end", "C=concealed", "D=é"];
  const setup = "op vault create Demo >/dev/null; op item create --vault Demo --category login --title Item " + fields.join(" ") + " >/dev/null";
  const refs = fields.map(field => field[0] + "=op://Demo/Item/" + field[0]).join(" ");
  try {
    for (const cmd of [setup, fields.join(" ") + " op environment snapshot create demo --vars A,B,C,D >/dev/null"]) {
      for (const sh of [js, rs]) { const r = await sh.exec(cmd); assert.equal(r.exitCode, 0, r.stderr); }
    }
    for (const prefix of [refs + " op run", "op environment snapshot restore demo"]) {
      for (const option of ["", " --no-masking"]) {
        const cmd = prefix + option + ' -- sh -c \'printf "\\377text-endétext"; echo concealedtext-end >&2; exit 3\'';
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, [...b.stdoutBytes], [...b.stderrBytes]], [a.exitCode, [...a.stdoutBytes], [...a.stderrBytes]], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("op only sees exported variables and command assignments", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["TOKEN=op://missing/item/field; op run -- echo ok",
      "export TOKEN; op run -- echo ok", "unset TOKEN; TOKEN=local; op run -- printenv TOKEN",
      "TOKEN=override op run -- printenv TOKEN", "OP_FORMAT=broken; op --version",
      "export OP_FORMAT; op --version", "unset OP_FORMAT; op --version"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op rejects explicit account and session selectors before accessing the default object store", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["op vault create Demo >/dev/null", "op item create --vault Demo --category login --title Fixture password=sample >/dev/null",
      "op account list --session=test", "op --session test account list", "op account --account=test list",
      "op --account='' whoami", "op whoami --session test --account test", "OP_SESSION=test op vault list",
      "OP_ACCOUNT=test op vault delete Demo", "op --session=test read op://Demo/Fixture/password",
      "op read op://Demo/Fixture/password --session test -o result", "test -e result",
      "op --session=test inject <<< '{{ op://Demo/Fixture/password }}'", "op --session=test inject <<< literal",
      "TOKEN=op://Demo/Fixture/password op run --session=test -- touch ran", "test -e ran",
      "op run --session=test -- echo literal", "op run -- echo --session=test", "op --account=test vault list --help",
      "op item get --session=test", "op item edit --account=test", "op document edit --session=test",
      "op item get Fixture --session=test", "op item edit Fixture --account=test", "op document edit Fixture --session=test",
      "op vault list extra --session=test", "op document get --session=test", "op read op://Demo/Fixture/password"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op resolves global and command flags against the selected catalog command", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["op --debug account list", "op account --format json ls", "op --cache bogus --version",
      "op -vv whoami", "op -hv whoami", "op --version=false whoami", "op --format account list",
      "op --no-color --config test account --session=x ls", "op vault create Demo >/dev/null",
      "op vault delete --shell --session=x Demo", "op vault list --bogus", "op --format=json vault ls",
      "op --format=bad --format=json account ls", "OP_DEBUG=bad op --debug=false account list",
      "op --help=false whoami", "op read -hn", "op -n read", "op read -n --", "op vault list --help=false --format json",
      "A=text op environment snapshot create selection --vars A >/dev/null",
      "op environment snapshot restore selection --no-masking --no-masking=false -- echo text",
      "op run echo hi --no-masking=true", "op run echo -- --cache",
      "op --format=json run -- echo --format=bad", "op run -- echo -vv",
      "op account list --help=false --encoding=x", "op read --help --encoding=x"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr, b.stdout], [a.exitCode, a.stderr, a.stdout], cmd);
    }
  } finally { rs.dispose(); }
});

test("op item hides sensitive field values unless the parsed output flags allow them", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const marker = "(use 'op item get --reveal' to reveal)";
  const values = ["sample-secret", "sample-pin", "sample-otp", "visible-user"];
  try {
    for (const args of ["vault create Demo", "item create --vault Demo --category login --title Fixture username=visible-user password=sample-secret 'pin[concealed]=sample-pin' 'code[otp]=sample-otp'",
      "item get Fixture", "item get Fixture --fields password,pin,code,username",
      "item get Fixture --fields pin --reveal", "item get Fixture --reveal --reveal=false",
      "item get Fixture --format=json", "item edit Fixture --title --reveal",
      "read op://Demo/--reveal/password"]) {
      const cmd = "op " + args;
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      for (const r of [a,b]) assert.equal(r.exitCode, 0, r.stderr);
      const visible = r => [marker, ...values].map(v => r.stdout.includes(v));
      assert.deepEqual(visible(b), visible(a), cmd);
      if (args.includes("--fields") || args.startsWith("read ")) assert.equal(b.stdout, a.stdout, cmd);
    }
  } finally { rs.dispose(); }
});

test("op confines item and document operations to the selected vault", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["op vault create A >/dev/null; op vault create B >/dev/null",
      "op item create --vault A --category login --title Shared password=first >/dev/null",
      "op item create --vault B --category login --title Shared password=second >/dev/null",
      "op document create --vault A --title Shared <<< first >/dev/null",
      "op document create --vault B --title Shared <<< second >/dev/null",
      "op item get Shared --vault Missing --fields password --reveal", "op item list --vault Missing",
      "op item edit Shared --vault Missing password=changed", "op item delete Shared --vault Missing",
      "op item delete Shared", "op document get Shared --vault Missing -o result", "test -e result",
      "op document list --vault Missing", "op document edit Shared --vault Missing <<< changed",
      "op document delete Shared --vault Missing", "op document delete Shared",
      "op document create --vault Missing --title New <<< text", "op item create --title New",
      "op document create --title New <<< text", "op item get Shared --vault a --fields password --reveal",
      "op item get Shared --vault B --fields password --reveal", "op document get Shared --vault A",
      "op document edit Shared --vault B <<< updated >/dev/null", "op document get Shared --vault B",
      "op document delete Shared --vault B", "op document get Shared --vault A",
      "op vault create A >/dev/null", "op item list --vault a", "op document list --vault A"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout],[a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("op requires an unambiguous vault for reference reads and vault mutations", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const cmd of ["op vault create Demo >/dev/null", "op item create --vault Demo --category login --title Example password=fixture >/dev/null",
      "op vault delete ''", "op item get Example --vault=''", "op vault group list ''",
      "op vault delete Demo", "op vault edit Demo --name Renamed --icon invalid", "op read op://Demo/Example/password", "op vault create dEMO --format=json | jq -r .id >other-id",
      "op read op://Demo/Example/password", "op vault edit DEMO --name Renamed", "op vault delete Demo",
      "op vault list --format=json", 'op vault delete "$(cat other-id)"',
      "op item delete Example --vault Demo", "op vault delete Demo", "op vault list --format=json"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout],[a.exitCode,a.stderr,a.stdout],cmd);
    }
  } finally { rs.dispose(); }
});

test("op computes OTPs for the stored field and clock using RFC 6238", async (t) => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const keys = {
    SHA1: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    SHA256: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
    SHA512: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
  };
  let now = 59000;
  t.mock.method(Date, "now", () => now);
  try {
    for (const shell of [js, rs]) {
      const cmd = "op vault create Demo >/dev/null; op item create --vault Demo --category login --title Test >/dev/null";
      assert.equal((await shell.exec(cmd)).exitCode, 0);
      assert.equal((await shell.exec("op item get Test --otp")).stderr, "op: OTP field is unavailable\n");
    }
    for (const [algorithm, seconds, period, expected] of [
      ["SHA1", 59, 30, "94287082"], ["SHA256", 59, 30, "46119246"], ["SHA512", 59, 30, "90693936"],
      ["SHA1", 1111111109, 30, "07081804"], ["SHA256", 119, 60, "46119246"]]) {
      now = seconds * 1000;
      for (const sh of [js, rs]) {
        const edit = await sh.exec("op item edit Test 'code[otp]=otpauth://totp/Example?digits=8&secret=" + keys[algorithm] + "&period=" + period + "&algorithm=" + algorithm + "' >/dev/null");
        assert.equal(edit.exitCode, 0, edit.stderr);
        const r = await sh.exec("op item get Test --otp");
        assert.equal(r.stdout, expected + "\n", r.stderr);
      }
    }
    for (const cmd of ["op item list --format=json | op item get - --otp",
      "printf '[]' | op item get - --otp", "op item get Test --fields code --otp",
      "op item get Test --fields absent --otp"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout],[a.exitCode,a.stderr,a.stdout],cmd);
    }
    for (const value of ["not-a-key!", "otpauth://hotp/A?secret=A", "otpauth://totp/test?secret=%41AAA&period=0",
      "otpauth://totp/test?secret=AAAA&algorithm=MD5", "otpauth://@@totp/test?secret=AAAA",
      "otpauth://totp/test?secret=AAAA&digits=0x8&period=0b11110", "otpauth://totp/A?secret=%47EZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"]) {
      const cmd = "op item edit Test 'code[otp]=" + value + "' >/dev/null; op item get Test --otp";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stderr,b.stdout],[a.exitCode,a.stderr,a.stdout],value);
    }
  } finally { rs.dispose(); }
});

test("cal and ncal select the current UTC month or the supplied epoch", async (t) => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2032, 0, 1) });
  try {
    for (const name of ["cal", "ncal"]) {
      for (const source of [name, name + " -3", name + " -m March",
        "SOURCE_DATE_EPOCH=-0.1 " + name, "SOURCE_DATE_EPOCH='' " + name,
        "SOURCE_DATE_EPOCH=0x10000000 " + name, "SOURCE_DATE_EPOCH=invalid " + name,
        "SOURCE_DATE_EPOCH=invalid " + name + " 2 2024"]) {
        const a = await js.exec(source), b = await rs.exec(source);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], source);
      }
    }
  } finally { rs.dispose(); }
});

test("gunzip checks each member's optional header and trailer", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const valid = Buffer.from("1f8b081a0000000000036e616d65006e6f746500c78b03000000000000000000", "hex");
  const corrupt = (index) => { const b = Buffer.from(valid); b[index] ^= 1; return b; };
  try {
    for (const data of [valid, Buffer.concat([valid, valid]), corrupt(20),
      Buffer.concat([valid, corrupt(20)]), corrupt(24), corrupt(28),
      Buffer.alloc(0), valid.subarray(0, 1), valid.subarray(0, 9),
      valid.subarray(0, 16), valid.subarray(0, 20), valid.subarray(0, 21),
      Buffer.from("1f8b08e0000000000000", "hex")]) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/input.gz", data);
      const cmd = "gunzip -t < /input.gz";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stderr], [a.exitCode, a.stderr], data.toString("hex"));
    }
  } finally { rs.dispose(); }
});

test("gzip and bzip2 only pass unrecognized input through in supported force modes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [name, short, corrupt] of [
      ["gunzip", "1f8b", "1f8bffe0000000000000"], ["bunzip2", "425a68", "425a6839000000000000"],
    ]) {
      for (const hex of ["", short, corrupt, "706c61696e"]) {
        for (const vfs of [fs, rs.fs]) await vfs.writeFile("/input", Buffer.from(hex, "hex"));
        for (const args of ["-c /input", "-t /input", "-fc /input", "-ft /input", "-fc < /input", "-t < /input"]) {
          const cmd = name + " " + args;
          const a = await js.exec(cmd), b = await rs.exec(cmd);
          assert.deepEqual([b.exitCode, b.stderr, b.stdoutBytes], [a.exitCode, a.stderr, a.stdoutBytes], cmd + ": " + hex);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("pr timestamps stdin and merged pages from the clock and files from their mtime", async (t) => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  t.mock.method(Date, "now", () => Date.UTC(2032, 0, 1));
  try {
    for (const vfs of [fs, rs.fs]) {
      await vfs.writeFile("/a", Buffer.from("one\n"));
      await vfs.utimes("/a", 1000, 1000);
    }
    for (const [cmd, stamp] of [
      ["echo data | pr --date-format=%s", "1956528000"],
      ["echo data | SOURCE_DATE_EPOCH=0 pr --date-format=%s", "1956528000"],
      ["pr -m --date-format=%s /a /a", "1956528000"],
      ["pr --date-format=%s /a", "1"],
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(a.stdout.trimStart().split(" ")[0], stamp);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("bzip2 blocks with equal rotations and long shared prefixes decode in production", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["a", "abba".repeat(2048), "abc".repeat(8191) + "z" + "abc".repeat(8191)]) {
      const bytes = Buffer.from(text);
      await rs.fs.writeFile("/input", bytes);
      const packed = await rs.exec("bzip2 -1c /input");
      assert.equal(packed.exitCode, 0, packed.stderr);
      await fs.writeFile("/archive", packed.stdoutBytes);
      const unpacked = await js.exec("bunzip2 -c /archive");
      assert.equal(unpacked.exitCode, 0, unpacked.stderr);
      assert.deepEqual(Buffer.from(unpacked.stdoutBytes), bytes);
    }
  } finally { rs.dispose(); }
});

test("bzip2 splits blocks by encoded run length before the level's block limit", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  // A run of four equal bytes takes five bytes inside the block.
  const bytes = Buffer.alloc(96000);
  let seed = 1;
  for (let i = 0; i < bytes.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes.fill(seed >>> 24, i, i + 4);
  }
  try {
    await rs.fs.writeFile("/input", bytes);
    const packed = await rs.exec("bzip2 -1c /input");
    assert.equal(packed.exitCode, 0, packed.stderr);
    for (const [sh, vfs] of [[js, fs], [rs, rs.fs]]) {
      await vfs.writeFile("/archive", packed.stdoutBytes);
      const unpacked = await sh.exec("bunzip2 -c /archive");
      assert.equal(unpacked.exitCode, 0, unpacked.stderr);
      assert.deepEqual(Buffer.from(unpacked.stdoutBytes), bytes);
    }
  } finally { rs.dispose(); }
});

test("unzstd switches codecs after each gzip member in a mixed stream", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ cwd: "/", fs: new MemoryFileSystem() }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const sh of [js, rs]) {
      const stream = "(printf one | gzip; printf two | zstd; printf three | gzip; printf four | gzip; printf five | zstd)";
      const result = await sh.exec(stream + " | unzstd -c");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "onetwothreefourfive");
    }
  } finally { rs.dispose(); }
});

test("zstd probes the frame header before passing through unknown input", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const hex of ["", "28b5", "706c61696e", "28b52ffd", "1f8b0800", "04224d18",
      "28b52ffd18", "28b52ffd1800", "28b52ffd3000010000", "28b52ffd2000070000",
      "502a4d1888ffffff", "502a4d1889ffffff", "502a4d18ffffffff"]) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/input", Buffer.from(hex, "hex"));
      for (const cmd of ["zstdcat < /input", "unzstd -c /input", "unzstd -fc /input",
        "unzstd --pass-through -t /input", "zstdcat -f --no-pass-through /input"]) {
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], cmd + ": " + hex);
      }
    }
  } finally { rs.dispose(); }
});

test("xz and lzma distinguish truncated headers, bad data and forced plaintext", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const hex of ["", "fd", "fd377a585a00", "fd377a585a000000ff12d941",
      "fd377a585a000000000000000000", "706c61696e", "5d0000", "5d12345678",
      "5d00001000ffffffffffffffff", "5d000010000000000000000000"]) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/input", Buffer.from(hex, "hex"));
      for (const cmd of ["xzcat < /input", "unlzma -c /input", "unxz -t /input",
        "unxz --format=xz -c /input", "unlzma -fc /input", "unxz -fc /input"]) {
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], cmd + ": " + hex);
      }
    }
  } finally { rs.dispose(); }
});

test("xz integrity checks distinguish incomplete production blocks, indexes and footers", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const packed = await js.exec("printf 'abcdefabcdefabcdefabcdefabcdefabcdef' | xz -c");
    assert.equal(packed.exitCode, 0, packed.stderr);
    for (let i = 0; i <= packed.stdoutBytes.length; i++) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/xz", packed.stdoutBytes.slice(0, i));
      const a = await js.exec("xz -t /xz"), b = await rs.exec("xz -t /xz");
      assert.deepEqual([b.exitCode, b.stderr], [a.exitCode, a.stderr], "cut at byte " + i);
    }
  } finally { rs.dispose(); }
});

test("lzma encodes preset dictionaries, repeated matches and a streaming end marker", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [level, bytes] of [
      [0, Buffer.alloc(0)], [1, Buffer.from("a")], [2, Buffer.from("aaa")], [4, Buffer.from("abc")],
      [6, Buffer.from("a".repeat(65536))], [1, Buffer.from("key=value\n".repeat(6554))],
    ]) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/in", bytes);
      const cmd = "lzma -" + level + "c /in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(b.exitCode, 0, b.stderr);
      assert.equal(a.exitCode, 0, a.stderr);
      assert.deepEqual(b.stdoutBytes, a.stdoutBytes, cmd + ": " + bytes.length + " bytes");
      await fs.writeFile("/archive", b.stdoutBytes);
      const decoded = await js.exec("unlzma -c /archive");
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(Buffer.from(decoded.stdoutBytes), bytes);
    }
  } finally { rs.dispose(); }
});

test("xz emits compressed LZMA2 blocks and stores incompressible chunks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const mixed = Buffer.alloc(2097152 + 8192);
    let seed = 5;
    for (let i = 0; i < 66000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      mixed[i] = seed >>> 24;
    }
    mixed.fill("xyz", 66000);
    for (const [level, bytes] of [[0, Buffer.from("abc")], [1, Buffer.from("key=value\n".repeat(6554))], [3, mixed]]) {
      for (const vfs of [fs, rs.fs]) await vfs.writeFile("/in", bytes);
      const cmd = "xz -" + level + "c /in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.equal(b.exitCode, 0, b.stderr);
      assert.equal(a.exitCode, 0, a.stderr);
      if (bytes === mixed) assert.ok(b.stdoutBytes.length < 68000, "compressed length: " + b.stdoutBytes.length);
      else assert.deepEqual(b.stdoutBytes, a.stdoutBytes);
      for (const [sh, vfs, packed] of [[js, fs, b], [rs, rs.fs, b], [rs, rs.fs, a]]) {
        await vfs.writeFile("/archive", packed.stdoutBytes);
        const decoded = await sh.exec("unxz -c /archive");
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.equal(Buffer.from(decoded.stdoutBytes).equals(bytes), true);
      }
    }
  } finally { rs.dispose(); }
});

test("unxz reverses delta filters in block order before checking the output", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 17) ^ (i >> 3));
  try {
    await fs.writeFile("/in", bytes);
    for (const flags of ["--check=none --delta", "--check=crc64 --delta=dist=256", "--delta=dist=3 --delta=dist=7"]) {
      const packed = await js.exec("xz -c --block-size=1KiB " + flags + " --lzma2 /in");
      assert.equal(packed.exitCode, 0, packed.stderr);
      await rs.fs.writeFile("/z", packed.stdoutBytes);
      const read = await rs.exec("unxz -c /z");
      assert.equal(read.exitCode, 0, read.stderr);
      assert.ok(Buffer.from(read.stdoutBytes).equals(bytes), flags);
    }
  } finally { rs.dispose(); }
});

test("unxz decodes x86 and ARM64 branches at the block's declared start offset", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [name, pattern, start] of [
      ["x86", "e810000000e9ffffff00e8e9e80001ffffffffe800ffef0000", 4294967280],
      ["arm64", "01000094ffffb39720000090210000d0fefffff000000014c0035fd6", 4092],
    ]) {
      const bytes = Buffer.from(pattern.repeat(320) + "00ff", "hex");
      await fs.writeFile("/in", bytes);
      for (const offset of ["", "=start=" + start]) {
        const cmd = "xz -c --block-size=1KiB --" + name + offset + " --delta=dist=3 --lzma2 /in";
        const packed = await js.exec(cmd);
        assert.equal(packed.exitCode, 0, packed.stderr);
        await rs.fs.writeFile("/z", packed.stdoutBytes);
        const decoded = await rs.exec("unxz -c /z");
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.ok(Buffer.from(decoded.stdoutBytes).equals(bytes), cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("unxz reads PowerPC, ARM, Thumb, SPARC and IA-64 executable filters", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    // liblzma archives with a start offset of 0xfffffff0 and a partial final instruction.
    for (const [name, pattern, archive] of [
      ["powerpc", "480000054bfffffd4800000248000001", "fd377a585a000004e6d6b44603010504f0ffffff2101000041c1b12ce0004100275d0025bfedeb086ef319f20003490c4f2da1814fec876b382fb23aba6d90a015e7d6752eb90f7d20000000ed084abddae1a86f00014742554c6c071fb6f37d010000000004595a"],
      ["arm", "010000ebfeffffeb000000ea", "fd377a585a000004e6d6b44603010704f0ffffff210100007c114428e00031001d5d007fe836dfb08600d9833382cccded6c2147cb2bb61ae16a27729578000000000000fc2b474447eed44700013d3215acb9821fb6f37d010000000004595a"],
      ["armthumb", "00f001f8fff7feff000000f002f8", "fd377a585a000004e6d6b44603010804f0ffffff21010000f14a4fd9e0003900255d007fbddb622e300fcddf7093b5515214f9f583f0d63939ab95dfec6f9bb45922947ff6da6400000000009c1bd4a9236f0ad00001453ad9d7846b1fb6f37d010000000004595a"],
      ["sparc", "400000017fffffff4000000081c7e008", "fd377a585a000004e6d6b44603010904f0ffffff21010000cf218d36e0004100295d003fbfedfb086fc2c48df1e1c8307bfa4dc01fdbbbd9967b94366cc635e08164ded2f3f572bf5c86000000000000a2a7a86ac16720c300014942db61ef991fb6f37d010000000004595a"],
      ["ia64", "16000400001400100000280030000050", "fd377a585a000004e6d6b44603010604f0ffffff21010000427a86c7e0004100285d000b00338505c6c6cce182e35fdded9ee46bb9375f3458cb998604ac5febf1e4f506e4ce0c75ac00000063d9afb6cbf50fc7000148429a50f4801fb6f37d010000000004595a"],
    ]) {
      for (const [shell, vfs] of [[js, fs], [rs, rs.fs]]) {
        await vfs.writeFile("/z", Buffer.from(archive, "hex"));
        const result = await shell.exec("unxz -c /z");
        assert.equal(result.exitCode, 0, name + ": " + result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(pattern.repeat(4) + "aaff", "hex"), name);
      }
    }
  } finally { rs.dispose(); }
});

test("unxz restores RISC-V jumps and AUIPC pairs", async () => {
  // The payload contains JAL, packed AUIPC, and a literal pair that resembles AUIPC.
  const archive = Buffer.from("fd377a585a000000ff12d94103010b04fc0f00002101000024b2092f010023ef004433ef02010297020000e780020017310128aabbccdd1710000000000000ef001234000001382401ed1a0b06729e7a010000000000595a", "hex");
  const rs = new RustWasmBash({ files: { "/z": archive } });
  try {
    const result = await rs.exec("unxz -c /z");
    assert.equal(result.exitCode, 0, result.stderr);
    // Decoded independently by the production liblzma runtime.
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ef70b006eff24fa017710e280000000097c2bbaa138012cd1710000000000000ef001234");
  } finally { rs.dispose(); }
});

test("unxz checks optional block sizes even when the index and checksums are valid", async () => {
  const { crc32 } = await import("node:zlib");
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ cwd: "/", fs }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const archive = Buffer.from("fd377a585a0000016922de360200210116000000742fe5a30100066578616d706c6500009f9bec6e00011b0712ebd4179042990d010000000001595a", "hex");
  try {
    for (const [packed, unpacked] of [[11, 7], [10, 7], [12, 7], [11, 6], [11, 8]]) {
      archive.set([2, 0xc0, packed, unpacked, 0x21, 1, 0x16, 0], 12);
      archive.writeUInt32LE(crc32(archive.subarray(12, 20)), 20);
      for (const [vfs, shell] of [[fs, js], [rs.fs, rs]]) {
        await vfs.writeFile("/z", archive);
        const r = await shell.exec("unxz -c /z");
        const valid = packed === 11 && unpacked === 7;
        assert.equal(r.exitCode, valid ? 0 : 1, packed + "/" + unpacked);
        assert.equal(r.stdout, valid ? "example" : "");
      }
    }
  } finally { rs.dispose(); }
});

test("expr counts and slices bytes or characters using LC_CTYPE, and orders strings using LC_COLLATE", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const script of [
      "LC_ALL=C expr length é", "LC_ALL=POSIX expr substr é 1 1",
      "LC_ALL=C expr index aéz z", "LC_ALL=C expr index é è",
      "LC_ALL=C.UTF-8 expr index é è", "LC_ALL=UTF8 expr substr a😀z 2 1",
      "LANG=C LC_CTYPE=de_DE.UTF8 expr length é", "LC_ALL=C LC_CTYPE=UTF-8 expr length é",
      "LC_ALL=C expr length substr é 2 1", "LC_ALL=C expr substr é 2 1 '>' z",
      "LC_ALL=invalid expr length a", "LC_ALL=invalid expr 1 '|' length é",
      "LC_ALL=C LC_COLLATE=en_US.UTF-8 expr a '<' A", "LC_ALL=en_US.UTF-8 expr a '<' A",
      "LC_COLLATE=fr_FR.UTF-8 LC_ALL='' expr é '<' z", "LC_ALL=invalid expr a '<' b",
      "LC_ALL=invalid expr a = b", "LC_ALL=invalid expr 100 '>' 2",
    ]) {
      const a = await js.exec(script), b = await rs.exec(script);
      assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], script);
    }
  } finally { rs.dispose(); }
});

test("expr uses anchored basic regular expressions for match and colon", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [text, pattern] of [
      ["(ab)+?", "(ab)+?"], ["abcd", "a\\|abcd"], ["bc", "a\\|c"], ["", "^$"],
      ["ababa", "\\(a\\|ab\\)\\1"], ["aaaa", "\\(a\\{1,3\\}\\)a"],
      ["abab", "\\(a\\(b\\)\\?\\)*\\2"], ["ab", "\\(a*\\)\\{1,3\\}b"],
      ["bb", "a\\(a\\)\\|bb"], ["9f", "[[:xdigit:]]*"], ["a\nb", ".*"],
      ["a", "["], ["a", "[a"], ["a", "b\\"], ["a", "\\(x"], ["a", "\\)"],
      ["a", "\\1"], ["a", "a\\{3,2\\}"], ["a", "[[:unknown:]]"], ["a", "a**"],
      ["a", "\\w"], ["a", "[[.a.]]"], ["é", "."], ["a", "é"], ["é", "["],
      ["a", "\\(a*\\)*\\1"],
    ]) {
      for (const args of ["'" + text + "' : '" + pattern + "'", "match '" + text + "' '" + pattern + "'"]) {
        const script = "expr " + args;
        const a = await js.exec(script), b = await rs.exec(script);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], script);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq keeps the document root distinct from a list of selected blocks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["", "one\n\ntwo\n", "# First\n\none\n\n# Second\n\ntwo\n"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["", "-q", "--no-br", "-o json", "-o plain", "'P:'", "-o json 'P:'", "-q '# absent'"]) {
        const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq builds sections from ATX and Setext headings, including empty titles", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const input = "\uFEFF# Parent ###\r\n\r\nchild title\r\n  ---\r\n\r\ntext\r\n\r\n#\r\n\r\nSibling\r\n=====\r\n\r\n###\tA#\r\n\r\nend\r\n";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
    for (const flags of ["", "-o json", "'#'", "'#{2}'", "'# Parent | P:'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});
