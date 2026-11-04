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

test("head and tail accept safe counts larger than Wasm memory", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, code, stdout, stderr] of [
      ["head -c4294967296", 0, "xy", ""], ["tail -n+4294967296", 0, "", ""],
      ["tail -c-9007199254740991", 0, "xy", ""],
      ["head -c9007199254740992", 2, "", "head: invalid number '9007199254740992'\n"],
    ]) {
      const r = await bash.exec(cmd, { stdin: "xy" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], cmd);
    }
  } finally { bash.dispose(); }
});

test("join reads only the selected input and keeps emitted rows on failure", async () => {
  const bash = new RustWasmBash({ files: { "/f": "a\nb\nc\n", "/g": "1\n" } });
  try {
    const limits = { maxInputBytes: 4 };
    for (const [script, opts, code, stdout, stderr] of [
      ["join --header - /g; cat", { stdin: "x\ny\nz" }, 0, "x\n", ""],
      ["{ join /g /g; head -c1; } </f", { limits }, 0, "1\na", ""],
      ["{ join -a2 /dev/null -; cat; } </f", { limits }, 0, "a\nb\n", "join: EFBIG: file too large, read '/f'\n"],
      ["{ join --nocheck-order /dev/null -; head -c1; } </f", { limits }, 1, "", "head: EFBIG: file too large, read '/f'\n"],
    ]) {
      const r = await bash.exec(script, opts);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], script);
    }
    await assert.rejects(bash.exec("join /g /g", { limits: { maxInputBytes: 3 } }), /maxInputBytes/);
  } finally { bash.dispose(); }
});

test("join stops at its output limit before fetching the next input chunk", async () => {
  const bash = new RustWasmBash({ files: { "/left": "key left\n" + "a\n".repeat(40000), "/right": "key right\n" } });
  try {
    await assert.rejects(bash.exec("join --header -a1 --nocheck-order /left /right", {
      limits: { maxOutputBytes: 2, maxInputBytes: 65546 },
    }), /maxOutputBytes/);
  } finally { bash.dispose(); }
});

test("comm merges readers in order and preserves complete rows on a later read error", async () => {
  const bash = new RustWasmBash({ files: { "/f": "a\nb\nc\n", "/g": "1\n", "/blocked": { content: "x", mode: 0o200 } } });
  try {
    const limits = { maxInputBytes: 4 };
    for (const [script, opts, stdout, stderr] of [
      ["{ comm /g /g; head -c1; } </f", { limits }, "\t\t1\na", ""],
      ["comm --total - -; cat", { stdin: "x\ny\nz" }, "x\n\ty\nz\n", "comm: -: Bad file descriptor\n"],
      ["{ comm /dev/null -; cat; } </f", { limits }, "\ta\n\tb\n", "comm: EFBIG: file too large, read '/f'\n"],
      ["comm - /blocked; cat", { stdin: "x" }, "", "comm: EACCES: permission denied, readStream '/blocked'\n"],
    ]) {
      const r = await bash.exec(script, opts);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, stderr], script);
    }
    await assert.rejects(bash.exec("comm /g /g", { limits: { maxInputBytes: 3 } }), /maxInputBytes/);
  } finally { bash.dispose(); }
});

test("paste shares a reader for repeated stdin and opens named columns before reading rows", async () => {
  const bash = new RustWasmBash({ files: { "/f": "a\nb\nc\n", "/g": "1\n", "/blocked": { content: "xx", mode: 0o200 } } });
  try {
    const limits = { maxInputBytes: 4 };
    for (const [script, opts, code, stdout, stderr] of [
      ["paste - -; cat", { stdin: "x\ny\nz" }, 0, "x\ty\nz\t\n", ""],
      ["{ paste /g; head -c1; } </f", { limits }, 0, "1\na", ""],
      ["{ paste - -; cat; } </f", { limits }, 0, "a\tb\n", "paste: EFBIG: file too large, read '/f'\n"],
      ["paste - /blocked /missing; cat", { stdin: "x" }, 0, "x", "paste: ENOENT: no such file or directory, stat '/missing'\n"],
      ["paste - /blocked; cat", { stdin: "x" }, 0, "", "paste: EACCES: permission denied, readStream '/blocked'\n"],
      ["paste -s /g /blocked /g", {}, 1, "1\n", "paste: EACCES: permission denied, readStream '/blocked'\n"],
      ["paste -s /g /missing /g", { limits }, 1, "1\n1\n", "paste: ENOENT: no such file or directory, stat '/missing'\n"],
    ]) {
      const r = await bash.exec(script, opts);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], script);
    }
    await assert.rejects(bash.exec("paste /g /g /g", { limits }), /maxInputBytes/);
  } finally { bash.dispose(); }
});

test("date reads batch lines from the selected source and preserves output before read failures", async () => {
  const bash = new RustWasmBash({ files: { "/dates": "@0\n@1\n", "/blocked": { content: "@1", mode: 0o200 } } });
  try {
    const limits = { maxInputBytes: 4 };
    for (const [script, opts, code, stdout, stderr] of [
      ["{ date -ud @0 +%s; head -c1; } </dates", { limits }, 0, "0\n@", ""],
      ["date -f - +%s; cat", { stdin: "\uFEFF@4\r\n@9" }, 0, "4\n9\n", ""],
      ["date -f - +%s", {}, 0, "", ""],
      ["true\n{ date -f - +%s; head -c1; } </dates", { limits }, 0, "0\n", "shell: line 2: EFBIG: file too large, read '/dates'\n"],
      ["date -f /blocked +%s", {}, 1, "", "date: EACCES: permission denied, readStream '/blocked'\n"],
    ]) {
      const r = await bash.exec(script, opts);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], script);
    }
    await assert.rejects(bash.exec("date -f /dates +%s", { limits }), /maxInputBytes/);
  } finally { bash.dispose(); }
});

test("date rejects conflicting input sources before consuming stdin", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, diagnostic] of [
      ["-r 2 -d @1", "--date and --reference"],
      ["-f - -d @1", "--file, --date and --reference"],
      ["--reference=file --file=-", "--file, --date and --reference"],
    ]) {
      const r = await bash.exec("date " + args + "; echo $?; cat", { stdin: "@4\n" });
      assert.deepEqual([r.stdout, r.stderr], ["1\n@4\n", "date: " + diagnostic + " are mutually exclusive\n"]);
    }
  } finally { bash.dispose(); }
});

test("redirected devices read on demand and share the input quota across descriptor copies", async t => {
  const bash = new RustWasmBash({ deviceView: "provided" });
  bash.mountDevices();
  const requests = [];
  t.mock.method(globalThis.crypto, "getRandomValues", bytes => {
    requests.push(bytes.length);
    bytes.fill(requests.length);
    return bytes;
  });
  const limits = { maxInputBytes: 4 };
  try {
    const unused = await bash.exec("echo ok </dev/random", { limits });
    assert.deepEqual([unused.exitCode, unused.stdout, unused.stderr, requests], [0, "ok\n", "", []]);
    const shared = await bash.exec("{ head -c1 <&3; head -c2 <&3; } 3</dev/urandom", { limits });
    assert.deepEqual([shared.exitCode, [...shared.stdoutBytes], shared.stderr, requests], [0, [1, 2, 2], "", [1, 2]]);
    const eof = await bash.exec("cat </dev/zero", { limits });
    assert.deepEqual([eof.exitCode, [...eof.stdoutBytes], eof.stderr],
      [1, [0, 0, 0, 0], "cat: EFBIG: file too large, read '/dev/zero'\n"]);
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
    await assert.rejects(bash.exec("cat /long >/out", { limits: { maxInputBytes: 65536 } }), {limit:"maxInputBytes"});
    assert.equal((await bash.fs.readFile("/out")).length,65536);
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

test("utilities leave redirected input for the next command when operands supply their data", async () => {
  const bash = new RustWasmBash({ files: { "/large": "abcdefghijklmn", "/small": "abc" } });
  try {
    for (const [cmd, expected] of [
      ["rev /small", "cba"], ["factor 15", "15: 3 5\n"],
      ["envsubst -v '$Z'", "Z\n"], ["numfmt 15", "15\n"],
    ]) {
      const r = await bash.exec(`{ ${cmd}; head -c1; } </large`, { limits: { maxInputBytes: 4 } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected + "a", ""], cmd);
    }
  } finally { bash.dispose(); }
});

test("factor, envsubst and numfmt consume their shared stdin once", async () => {
  const bash = new RustWasmBash({ files: { "/numbers": "15 9\n" } });
  try {
    for (const [cmd, expected] of [
      ["factor", "15: 3 5\n9: 3 3\n"], ["envsubst", "15 9\n"], ["numfmt", "15 9\n"],
    ]) {
      for (const script of [`${cmd}; cat`, `{ ${cmd}; cat; } </numbers`]) {
        const r = await bash.exec(script, { stdin: "15 9\n" });
        assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], script);
      }
    }
  } finally { bash.dispose(); }
});

test("factor reads byte tokens and quotes invalid values from stdin and argv", async () => {
  const bash = new RustWasmBash();
  try {
    const r = await bash.exec("factor", { stdin: Uint8Array.of(51, 13, 10, 52, 0, 120, 9, 255, 32, 48) });
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "4: 2 2\n0:\n",
      "factor: '3\\r' is not a valid positive integer\nfactor: '\\377' is not a valid positive integer\n"]);
    const arg = await bash.exec("factor 'é' '  +6'");
    assert.deepEqual([arg.exitCode, arg.stdout, arg.stderr], [1, "6: 2 3\n",
      "factor: '\\303\\251' is not a valid positive integer\n"]);
  } finally { bash.dispose(); }
});

test("numfmt preserves completed fields, header terminators and blank separators", async () => {
  const bash = new RustWasmBash({ env: { LC_ALL: "C" } });
  try {
    for (const [cmd, stdin, code, stdout, stderr] of [
      ["--field=2", "tag  x\n", 2, "tag ", "numfmt: invalid number: 'x'\n"],
      ["-d, --field=2", "tag,x,tail\n", 2, "tag,", "numfmt: invalid number: 'x'\n"],
      ["-z", "15\n20\nno\n31\0", 0, "15 20 no 31\0", ""],
      ["--header", "header\0lost\n31\0lost\n", 0, "header31\n", ""],
      ["", "\n", 2, "", "numfmt: invalid number: ''\n"],
    ]) {
      const r = await bash.exec("numfmt " + cmd, { stdin });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], cmd);
    }
  } finally { bash.dispose(); }
});

test("numfmt stops pulling on conversion failure and keeps records split across chunks", async () => {
  const bash = new RustWasmBash({ files: {
    "/bad": "2\nwrong\n" + "x".repeat(65528) + "Z",
    "/split": "0".repeat(65535) + "14\n12",
  } });
  try {
    const r = await bash.exec("{ numfmt; head -c1; } </bad");
    assert.deepEqual([r.stdout, r.stderr], ["2\nZ", "numfmt: invalid number: 'wrong'\n"]);
    const split = await bash.exec("numfmt </split");
    assert.deepEqual([split.exitCode, split.stdout, split.stderr], [0, "14\n12", ""]);
  } finally { bash.dispose(); }
});

test("text utilities report redirected input errors after the bytes already read", async () => {
  const bash = new RustWasmBash({ files: { "/large": "15 \n2222222222" } });
  try {
    for (const [cmd, expected, error] of [
      ["rev", " 51\n", "rev: EFBIG: file too large, read '/large'"],
      ["envsubst", "", "shell: line 2: EFBIG: file too large, read '/large'"],
      ["factor", "", "factor: standard input: EFBIG: file too large, read '/large'"],
      ["numfmt", "15 \n", "numfmt: error reading input: File too large"],
    ]) {
      const r = await bash.exec(`true\n{ ${cmd}; head -c1; } </large`, { limits: { maxInputBytes: 4 } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, error + "\n"], cmd);
    }
  } finally { bash.dispose(); }
});

test("shuf stops unbounded output at the sink and keeps records written before random input ends", async () => {
  const bash = new RustWasmBash({files:{"/rand":Uint8Array.of(2),"/o":"old"}});
  try {
    for (const args of ["-r -e X","-i 0-4294967295"]) {
      await assert.rejects(bash.exec("shuf " + args, {limits:{maxOutputBytes:3}}), {limit:"maxOutputBytes"});
    }
    for (const output of [""," -o /o"]) {
      const r = await bash.exec("shuf -r -e A B --random-source=/rand" + output);
      const records = "A\nB\nA\nA\nA\nA\nA\nA\n";
      assert.deepEqual([r.exitCode,r.stdout,r.stderr,bash.readText("/o")],
        [1,output ? "" : records,"shuf: '/rand': end of file\n",output ? records : "old"]);
    }
    const empty = await bash.exec("shuf -r -e -o /o");
    assert.deepEqual([empty.exitCode,empty.stderr,bash.readText("/o")], [1,"shuf: no lines to repeat\n",""]);
  } finally { bash.dispose(); }
});

test("shuf draws from host entropy in the same byte order as a named random source", async t => {
  const bash = new RustWasmBash();
  try {
    const draws = [];
    t.mock.method(globalThis.crypto, "getRandomValues", bytes => {
      draws.push(bytes.length);
      bytes.fill(2);
      return bytes;
    });
    const r = await bash.exec("shuf -r -n4 -e A B");
    assert.deepEqual([r.exitCode,r.stdout,r.stderr,draws], [0,"A\nB\nA\nA\n","",[4096]]);
  } finally { bash.dispose(); }
});

test("shuf samples a stream using the random source and charges only the selected input", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/rand":Uint8Array.of(23,157,48,17,81,202),"/empty":"","/i":"X\nX\n"}});
  try {
    for (const [args, limits, code, expected, err, pulls] of [
      ["-n2 --random-source=/rand", {}, 0, "f\na\n", "", 6],
      ["-n2 --random-source=/empty", {}, 1, "", "shuf: '/empty': end of file\n", 2],
      ["-n1 --random-source=/missing", {}, 1, "", "shuf: /missing: No such file or directory\n", 0],
      ["-n0 /missing", {}, 0, "", "", 0],
      ["-e only", {maxInputBytes:0}, 0, "only\n", "", 0],
      ["-n1", {maxInputBytes:3}, null, "", "", 2],
      ["-n1 /i", {maxInputBytes:3}, null, "", "", 0],
      ["-rn0 /missing", {maxInputBytes:3}, null, "", "", 2],
    ]) {
      let seen = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const x of ["a\n","b\n","c\n","d\n","e\n","f"]) { seen++; yield Buffer.from(x); }
      }};
      const run = bash.exec("shuf " + args, {stdin,limits});
      if (code === null) await assert.rejects(run, {limit:"maxInputBytes"});
      else { const r = await run; assert.deepEqual([r.exitCode,r.stdout,r.stderr], [code,expected,err], args); }
      assert.equal(seen,pulls,args);
    }
  } finally { bash.dispose(); }
});

test("dd reads the opened input one record at a time when the output aliases it", async () => {
  for (const [args, expected, records] of [
    ["bs=1", "", "0+0"],
    ["bs=1 seek=1 conv=notrunc count=4", "111116", "4+0"],
    ["ibs=2 obs=1 seek=1 count=2", "111", "0+2"],
    ["bs=2 seek=1B count=3B", "111", "0+2"],
    ["ibs=2 obs=1 seek=1 conv=notrunc count=2", "112246", "2+0"],
  ]) {
    const bash = new RustWasmBash({files:{"/i":"123456"}});
    try {
      const r = await bash.exec("ln /i /o; dd if=/i of=/o status=noxfer " + args);
      assert.deepEqual([r.exitCode, r.stderr.split("\n").find(line => line.endsWith(" records in")), bash.readText("/i")], [0, records + " records in", expected], args);
    } finally { bash.dispose(); }
  }
});

test("dd opens named output before stdin and publishes completed records according to the filesystem", {skip: !WebAssembly.Suspending}, async () => {
  for (const overlay of [false,true]) {
    const bash = new RustWasmBash({...(overlay ? {profile:"overlay-cow-fs"} : {}),files:{"/o":"old"}});
    try {
      const seen = [];
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const chunk of ["ab","c","defg","hijk"]) { seen.push(bash.readText("/o")); yield Buffer.from(chunk); }
      }};
      await assert.rejects(bash.exec("dd bs=4 of=/o status=none", {stdin,limits:{maxOutputBytes:5}}), {limit:"maxOutputBytes"});
      assert.deepEqual([seen, bash.readText("/o")], overlay ? [["old","old","old","old"],"old"] : [["","","","abcd"],"abcd"]);
      seen.length = 0;
      const failed = await bash.exec("dd of=/missing/o status=none", {stdin});
      assert.deepEqual([failed.exitCode,failed.stderr,seen], [1,"dd: failed to open '/missing/o': No such file or directory\n",[]]);
    } finally { bash.dispose(); }
  }
});

test("dd charges open, descriptor inspection and each named output record in order", {skip: !WebAssembly.Suspending}, async () => {
  for (const [limit, pulls, content] of [[2,0,"old"],[3,0,""],[4,1,""],[5,2,"A"]]) {
    const bash = new RustWasmBash({files:{"/o":"old"}});
    try {
      let seen = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const byte of [65,66]) { seen++; yield Uint8Array.of(byte); }
      }};
      await assert.rejects(bash.exec("dd bs=1 of=/o status=none", {stdin,limits:{maxFileSystemOperations:limit}}), {limit:"maxFileSystemOperations"});
      assert.deepEqual([seen,bash.readText("/o")], [pulls,content]);
    } finally { bash.dispose(); }
  }
});

test("dd keeps writing the opened inode after its name is replaced", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/o":"abcdef"}});
  try {
    const stdin = {async *[Symbol.asyncIterator]() {
      yield Buffer.from("12");
      assert.equal(bash.readText("/o"), "ab12ef");
      await bash.fs.rename("/o","/moved");
      await bash.fs.writeFile("/o","replacement");
      yield Buffer.from("3");
    }};
    const r = await bash.exec("dd bs=2 seek=1 of=/o conv=notrunc status=none", {stdin});
    assert.deepEqual([r.exitCode,r.stderr,bash.readText("/o"),bash.readText("/moved")], [0,"","replacement","ab123f"]);
  } finally { bash.dispose(); }
});

test("dd rejects unsupported flags at open time before copying or truncating", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/target":"keep"}});
  try {
    for (const [args, message] of [
      ["iflag=nonblock,direct of=/target", "nonblock: Operation not supported by the filesystem stream adapter"],
      ["iflag=direct,nocache of=/target", "cannot combine direct and nocache"],
      ["if=/missing oflag=direct", "failed to open '/missing': No such file or directory"],
      ["of=/target oflag=direct", "direct: Operation not supported by the filesystem stream adapter"],
      ["oflag=sync", "sync: Operation not supported by the filesystem stream adapter"],
      ["conv=fdatasync", "fdatasync: Operation not supported by the filesystem stream adapter"],
      ["oflag=append", "append with truncation: Operation not supported by the filesystem stream adapter"],
    ]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65); }};
      const r = await bash.exec("dd " + args + " status=noxfer", {stdin});
      assert.deepEqual([r.exitCode, r.stdout, r.stderr, pulls, bash.readText("/target")],
        [1, "", "dd: " + message + "\n", 0, "keep"], args);
    }
  } finally { bash.dispose(); }
});

test("dd stops pulling input when a converted output record exceeds the limit", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, pullsAtLimit] of [
      ["bs=4", 2],
      ["ibs=4 obs=3 conv=swab,ucase", 3],
      ["ibs=4 obs=4 cbs=6 conv=block", 2],
    ]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 5; i++) { pulls++; yield Uint8Array.of(97,98,99,10); }
      }};
      await assert.rejects(bash.exec(`dd ${args} status=none`, {stdin,limits:{maxOutputBytes:6}}), {limit:"maxOutputBytes"});
      assert.equal(pulls, pullsAtLimit, args);
    }
  } finally { bash.dispose(); }
});

test("dd honors count, charges the producer chunk, and leaves its unread suffix for the next command", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/in":"FILE"}});
  try {
    for (const [cmd, limits, expected, expectedPulls] of [
      ["dd bs=4 count=1 status=none", {}, "abcd", 3],
      ["dd bs=2 count=1 status=none; head -c1", {}, "abc", 2],
      ["dd bs=99 count=0 status=none", {}, "", 0],
      ["dd if=/in status=none; head -c2", {}, "FILEab", 1],
      ["{ dd bs=2 count=1 status=none; head -c1; } </in", {}, "FIL", 0],
      ["dd bs=1 count=1 status=none", {maxInputBytes:1}, "maxInputBytes", 1],
    ]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const c of ["ab","c","defg","hijk"]) { pulls++; yield new TextEncoder().encode(c); }
      }};
      const run = bash.exec(cmd, {stdin,limits});
      if (expected === "maxInputBytes") await assert.rejects(run, {limit:expected});
      else { const r = await run; assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,expected,""], cmd); }
      assert.equal(pulls,expectedPulls,cmd);
    }
  } finally { bash.dispose(); }
});

test("od accepts safe integer ranges, including hexadecimal quantities with suffixes", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, code, stdout, stderr] of [
      ["-N4294967296", 0, "0000000 000101\n0000002\n", ""],
      ["-N9007199254740991", 0, "0000000 000101\n0000002\n", ""],
      ["-N0x1K", 0, "0000000 000101\n0000002\n", ""],
      ["-j4294967296", 1, "", "od: cannot skip past end of input\n"],
      ["-S4294967296", 0, "", ""],
      ["-N0x+1", 2, "", "od: invalid number '0x+1'\n"],
      ["-j0x20000000000000", 2, "", "od: number out of range '0x20000000000000'\n"],
      ["-N8796093022208KiB", 2, "", "od: number out of range '8796093022208KiB'\n"],
      ["-w9007199254740991 -tx4", 0, "0000000 00000041\n0000002\n", "od: warning: invalid width 9007199254740991; using 4 instead\n"],
      ["-S1 -w9007199254740991 -tx1", 0, "0000000 A\n", ""],
    ]) {
      const result = await bash.exec("od " + args, {stdin:Uint8Array.of(65,0)});
      assert.deepEqual([result.exitCode,result.stdout,result.stderr], [code,stdout,stderr], args);
    }
  } finally { bash.dispose(); }
});

test("od formats single and double precision at fixed and exponential boundaries", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [size, expected] of [
      [4, ["1e-05","0.0001","1e+06","1.0000001","1e-45","-0","inf","nan"]],
      [8, ["1e-05","0.0001","1000000","1.0000001192092896","5e-324","-0","inf","nan"]],
    ]) {
      const bytes = new Uint8Array(size * expected.length);
      const view = new DataView(bytes.buffer);
      [1e-5,1e-4,1e6,1.0000001192092896,size === 4 ? 2 ** -149 : Number.MIN_VALUE,-0,Infinity,NaN].forEach((n,i) => {
        if (size === 4) view.setFloat32(i*size,n,true); else view.setFloat64(i*size,n,true);
      });
      const r = await bash.exec("od -An -v -w" + size + " -tf" + size, {stdin:bytes});
      assert.deepEqual([r.exitCode, r.stdout.trimEnd().split("\n").map(line => line.trim())], [0,expected]);
    }
  } finally { bash.dispose(); }
});

test("od admits whole chunks but stops reading as soon as its range or output ends", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, limits, outcome, count] of [
      ["od -N0", {}, "0000000\n", 0], ["od -j5 -N0", {}, "0000005\n", 2],
      ["od -tx1 -N1", {maxInputBytes:3}, "maxInputBytes", 1],
      ["od -w4", {maxOutputBytes:6}, "maxOutputBytes", 1],
      ["od -S2", {maxOutputBytes:6}, "maxOutputBytes", 1],
    ]) {
      let pulls = 0, closes = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        try { for (const c of ["abc","def","ghi"]) { pulls++; yield new TextEncoder().encode(c + "\0"); } }
        finally { closes++; }
      }};
      const run = bash.exec(cmd, {stdin,limits});
      if (outcome.startsWith("max")) await assert.rejects(run, {limit:outcome});
      else assert.equal((await run).stdout, outcome);
      assert.deepEqual([pulls,closes], [count,Number(count > 0)], cmd);
    }
  } finally { bash.dispose(); }
});

test("od checks only the operands its range needs and emits diagnostics in read order", async () => {
  const bash = new RustWasmBash({files:{"/f":"abcd"}});
  try {
    for (const [cmd, code, output] of [
      ["od -N0 /missing /f",1,"od: ENOENT: no such file or directory, stat '/missing'\n"],
      ["od -N0 /f /missing",0,"0000000\n"],
      ["od -N1 -tx1 /f /missing",0,"0000000 61\n0000001\n"],
      ["od -An -w3 -tx2 /f /missing",1,"od: warning: invalid width 3; using 2 instead\n 6261\n 6463\nod: ENOENT: no such file or directory, readStream '/missing'\n"],
    ]) {
      const r = await bash.exec(cmd + " 2>&1");
      assert.deepEqual([r.exitCode,r.stdout], [code,output], cmd);
    }
  } finally { bash.dispose(); }
});

test("fold stops at the producer chunk that exhausts output", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, count] of [["fold -w3",2], ["fold /missing - 2>&1",0]]) {
      let pulls = 0, closes = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        try { for (const line of ["abc","def","ghi"]) { pulls++; yield new TextEncoder().encode(line + "\n"); } }
        finally { closes++; }
      }};
      await assert.rejects(bash.exec(cmd, {stdin, limits:{maxOutputBytes:6}}), {limit:"maxOutputBytes"});
      assert.deepEqual([pulls, closes], [count, Number(count > 0)], cmd);
    }
  } finally { bash.dispose(); }
});

test("fold reports operand errors before wrapping later input", async () => {
  const bash = new RustWasmBash();
  try {
    const r = await bash.exec("fold -w2 /missing - 2>&1", {stdin:"abcd"});
    assert.deepEqual([r.exitCode,r.stdout], [1,"fold: ENOENT: no such file or directory, stat '/missing'\nab\ncd"]);
  } finally { bash.dispose(); }
});

test("nl validates the last option values in production order, independently of Wasm word size", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, input, stdout, stderr] of [
      ["-wbad --number-width=2 -vbad -v1 -ba -l0","\n"," 1\t\n",""],
      ["-vbad -bQ","","","nl: invalid numbering style: 'Q'\n"],
      ["-v9223372036854775808","","","nl: line number out of range: '9223372036854775808'\n"],
      ["-w' 2'","","","nl: invalid number ' 2'\n"],
      ["-w4294967296","\\:\n","\n",""],
      ["-w9007199254740991","","","nl: EFBIG: stream-format number field limit exceeded\n"],
      ["--no-renumber=no","","","nl: option '--no-renumber' does not take an argument\n"],
    ]) {
      const r = await bash.exec("nl " + args, {stdin:input});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [stderr ? 1 : 0,stdout,stderr], args);
    }
  } finally { bash.dispose(); }
});

test("nl stops pulling stdin on output failure and closes it on line number overflow", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, limit, expectedPulls] of [["nl",6,1], ["nl",19,3], ["nl -v9223372036854775807",100,2]]) {
      let pulls = 0, closes = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        try { for (let i = 0; i < 5; i++) { pulls++; yield Uint8Array.of(97,10); } } finally { closes++; }
      }};
      const run = bash.exec(cmd, {stdin, limits:{maxOutputBytes:limit}});
      if (limit < 100) await assert.rejects(run, {limit:"maxOutputBytes"});
      else {
        const r = await run;
        assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "9223372036854775807\ta\n", "nl: line number overflow\n"]);
      }
      assert.deepEqual([pulls, closes], [expectedPulls, 1]);
    }
  } finally { bash.dispose(); }
});

test("nl writes diagnostics in operand order and carries blank groups across page boundaries", async () => {
  const bash = new RustWasmBash();
  try {
    const r = await bash.exec("nl -ba -l2 /missing - 2>&1", {stdin:"\n\\:\\:\n\n"});
    assert.deepEqual([r.exitCode, r.stdout], [1, "nl: ENOENT: no such file or directory, stat '/missing'\n       \n\n     1\t\n"]);
  } finally { bash.dispose(); }
});

test("tee admits targets before reading and keeps each accepted chunk on quota failure", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, limit, seenExpected, final] of [
      ["tee /t", 7, ["", "abc"], "abc"], ["tee -a /t", 11, ["old", "oldabc"], "oldabc"],
      ["tee --output-error=exit /absent/f /t", 100, [], "old"],
    ]) {
      await bash.fs.writeFile("/t", "old");
      const seen = [];
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const chunk of ["abc","def","ghi"]) { seen.push(bash.readText("/t")); yield new TextEncoder().encode(chunk); }
      }};
      const run = bash.exec(cmd, {stdin, limits:{maxOutputBytes:limit}});
      if (limit !== 100) await assert.rejects(run, {limit:"maxOutputBytes"});
      else assert.equal((await run).exitCode, 1);
      assert.deepEqual([seen, bash.readText("/t")], [seenExpected, final], cmd);
    }
  } finally { bash.dispose(); }
});

test("tee keeps writing the open inode after a rename, including an append-only target", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/t":{content:"old",mode:0o200}}});
  try {
    const r = await bash.exec("tee -a /t", {stdin:{async *[Symbol.asyncIterator]() {
      yield Uint8Array.of(0,255);
      await bash.fs.rename("/t","/renamed");
      await bash.fs.writeFile("/t","replacement");
      yield Uint8Array.of(65);
    }}});
    await bash.fs.chmod("/renamed", 0o644);
    assert.deepEqual([r.exitCode, [...r.stdoutBytes], r.stderr, bash.readText("/t"), [...await bash.fs.readFile("/renamed")]],
      [0, [0,255,65], "", "replacement", [111,108,100,0,255,65]]);
  } finally { bash.dispose(); }
});

test("tee leaves an overlay destination intact until the stream succeeds", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs",files:{"/t":"old"}});
  try {
    for (const limit of [7,100]) {
      const seen = [];
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const chunk of ["abc","def","ghi"]) { seen.push(bash.readText("/t")); yield new TextEncoder().encode(chunk); }
      }};
      const run = bash.exec("tee /t", {stdin,limits:{maxOutputBytes:limit}});
      if (limit === 7) await assert.rejects(run, {limit:"maxOutputBytes"});
      else assert.equal((await run).stdout, "abcdefghi");
      assert.deepEqual([seen, bash.readText("/t")], limit === 7 ? [["old","old"],"old"] : [["old","old","old"],"abcdefghi"]);
    }
  } finally { bash.dispose(); }
});

test("tee reports overlay errors against the failing entry", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/readonly":{content:"keep", mode:0o444}, "/dir/file":"keep"}});
  try {
    for (const [path, error] of [
      ["/readonly", "EACCES: permission denied, overlay '/readonly'"],
      ["/dir", "EISDIR: illegal operation on a directory, overlay '/dir'"],
      ["/missing/file", "ENOENT: no such file or directory, overlay '/missing'"],
      ["/dir/file/x", "ENOTDIR: not a directory, overlay '/dir/file'"],
    ]) {
      const r = await bash.exec("tee " + path + " 2>&1", {stdin:"input"});
      assert.deepEqual([r.exitCode, r.stdout], [1, "tee: " + error + "\ninput"]);
    }
  } finally { bash.dispose(); }
});

test("xxd negative seeks stat the requested path before a zero-length range", async () => {
  const bash = new RustWasmBash({files:{"/f":"x"}});
  try {
    for (const [path, code, message] of [
      ["/missing/../f", 2, "ENOENT: no such file or directory, stat '/missing/../f'"],
      ["/f/", 1, "ENOTDIR: not a directory, stat '/f/'"], ["''", 2, "negative seek requires an input file"],
    ]) {
      const r = await bash.exec("xxd -s-1 -l0 " + path);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, "", "xxd: " + message + "\n"]);
    }
  } finally { bash.dispose(); }
});

test("xxd traverses output parents before resolving .. and honors file permissions", async () => {
  const bash = new RustWasmBash({files:{"/out":"keep","/readonly":{content:"keep",mode:0o444}}});
  try {
    await bash.exec("mkdir -p /real/sub; ln -s /real/sub /link");
    for (const [flags, missing, denied] of [
      ["-p", "writeFile '/missing/../out'", "writeFile"], ["-rp", "lstat '/missing'", "open"],
    ]) {
      const missingParent = await bash.exec("xxd " + flags + " - /missing/../out", {stdin:"41"});
      assert.deepEqual([missingParent.exitCode, missingParent.stderr, bash.readText("/out")],
        [2, "xxd: ENOENT: no such file or directory, " + missing + "\n", "keep"]);
      const readonly = await bash.exec("xxd " + flags + " - /readonly", {stdin:"41"});
      assert.deepEqual([readonly.exitCode, readonly.stderr, bash.readText("/readonly")],
        [1, "xxd: EACCES: permission denied, " + denied + " '/readonly'\n", "keep"]);
      const written = await bash.exec("umask 077; xxd " + flags + " - /link/../" + denied + "; stat -c %a /real/" + denied, {stdin:"41"});
      assert.deepEqual([written.exitCode, written.stdout, written.stderr], [0, "600\n", ""]);
    }
  } finally { bash.dispose(); }
});

test("xxd reverse patches the opened file without truncating or reopening it", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/target":"abcdef"}});
  try {
    const stdin = { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("2: 5859\n");
      assert.equal(bash.readText("/target"), "abXYef");
      await bash.fs.rename("/target", "/moved");
      await bash.fs.writeFile("/target", "replacement");
      yield new TextEncoder().encode("0: 5a\n8: ff");
    }};
    const r = await bash.exec("xxd -r - /target", {stdin});
    assert.deepEqual([r.exitCode, r.stderr, bash.readText("/target"), [...await bash.fs.readFile("/moved")]],
      [0, "", "replacement", [90,98,88,89,101,102,0,0,255]]);
    const w = await bash.exec("chmod 200 /target; xxd -rp -s1 - /target; chmod 600 /target", {stdin:"58"});
    assert.deepEqual([w.stderr, bash.readText("/target")], ["", "rXplacement"]);
    const empty = await bash.exec("umask 077; xxd -rp -s8 - /new; stat -c %a /new");
    assert.deepEqual([empty.stdout, bash.readText("/new")], ["600\n", ""]);
  } finally { bash.dispose(); }
});

test("xxd reads named input in 8192-byte blocks when its output aliases the same file", async () => {
  const input = "2000: 6666\n".padEnd(8192, " ") + "\n0: 58";
  const bash = new RustWasmBash({files:{"/src":input}});
  try {
    const r = await bash.exec("ln /src /alias; xxd -r /src /alias");
    assert.deepEqual([r.exitCode, r.stderr, bash.readText("/src")], [1,
      "xxd: invalid input: expected hexadecimal address and colon\n", input.slice(0, 8192) + "ff: 58"]);
  } finally { bash.dispose(); }
});

test("xxd reverse retains emitted rows and padding on invalid input", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, input, bytes, error] of [
      ["-r", "0: 61\n0: ff\n", [97], "invalid input: cannot seek backwards on output stream"],
      ["-r", "0: 61\n2: 7\n", [97,0], "invalid input: malformed hexadecimal data field"],
      ["-r", "0: 61\nbad", [97], "invalid input: expected hexadecimal address and colon"],
      ["-r -s-1", "1: 58", [88], ""],
    ]) {
      const r = await bash.exec("xxd " + args, {stdin:input});
      assert.deepEqual([r.exitCode, [...r.stdoutBytes], r.stderr], [error ? 1 : 0, bytes, error ? "xxd: " + error + "\n" : ""]);
    }
  } finally { bash.dispose(); }
});

test("xxd reverse charges streamed writes before pulling more input", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/target":"abcdef"}});
  try {
    for (const [args, limit, expectedPulls] of [["-rp -s8193 >/pad",8192,0], ["-rp -s2 - /target",1,2]]) {
      let pulls = 0;
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const chunk of ["58","59","5a"]) { pulls++; yield new TextEncoder().encode(chunk); }
      }};
      await assert.rejects(bash.exec("xxd " + args, {stdin,limits:{maxOutputBytes:limit}}), {limit:"maxOutputBytes"});
      assert.equal(pulls, expectedPulls, args);
    }
    assert.deepEqual([bash.readText("/pad"), bash.readText("/target")], ["\0".repeat(8192), "abXdef"]);
  } finally { bash.dispose(); }
});

test("xxd validates all numeric options after opening named output and uses wide addresses", async () => {
  const bash = new RustWasmBash({ files: { "/out": "old" } });
  try {
    for (const [args, code, stdout, stderr] of [
      ["-gBAD -pb - /out", 2, "", "xxd: incompatible display modes\n"],
      ["-sbad -s1", 2, "", "xxd: invalid number 'bad'\n"],
      ["-c1 -s-0 -o4294967296", 0, "100000000: 78  x\n", ""],
      ["-o9007199254740992", 2, "", "xxd: number out of range '9007199254740992'\n"],
      ["-i -n var -s9", 4, "", "xxd: Sorry, cannot seek.\n"],
    ]) {
      const r = await bash.exec("xxd " + args, { stdin: "x" });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr, bash.readText("/out")], [code, stdout, stderr, ""], args);
    }
  } finally { bash.dispose(); }
});

test("xxd opens only the input needed by the selected range", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [args, code, stdout, pulls] of [
      ["-p -l0", 0, "", 0], ["-p -l0 /absent", 0, "", 0],
      ["-p -s1 -l1", 0, "62\n", 1], ["-p -s2 -l0", 0, "", 1],
      ["-p -s9 -l0", 4, "", 3], ["-p -s-1", 2, "", 0],
    ]) {
      let n = 0;
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const text of ["ab", "cd", "ef"]) { n++; yield new TextEncoder().encode(text); }
      }};
      const r = await bash.exec("xxd " + args, { stdin });
      assert.deepEqual([r.exitCode, r.stdout, n], [code, stdout, pulls], args);
    }
  } finally { bash.dispose(); }
});

test("xxd publishes complete rows before pulling stdin and preserves them on failure", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({ files: { "/out": "previous" } });
  try {
    const first = "00000000: 6162  ab\n";
    for (const [args, seenPrefix] of [["-c2", first], ["-i -n var -c2", "unsigned char var[] = {\n"]]) {
      const seen = [];
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const text of ["ab", "cd", "ef"]) {
          seen.push(bash.readText("/out"));
          yield new TextEncoder().encode(text);
        }
      }};
      await assert.rejects(bash.exec("xxd " + args + " - /out", {stdin, limits: {maxInputBytes: 2}}), {limit:"maxInputBytes"});
      assert.deepEqual(seen, ["", seenPrefix], args);
      assert.ok(bash.readText("/out").startsWith(seenPrefix), args);
    }
    const invalid = await bash.exec("xxd -pb - /out");
    assert.deepEqual([invalid.exitCode, bash.readText("/out")], [2, ""]);
  } finally { bash.dispose(); }
});

test("tab conversion commits each input chunk and stops reading on output failure", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd, chunks, expected] of [
      ["expand -t4", ["a\t", "b\n", "\t", "later"], ["", "a   ", "a   b\n"]],
      ["unexpand -a -t4", ["a   ", "b\n", "    c\n", "later"], ["", "a", "a\tb\n"]],
    ]) {
      const seen = [];
      const stdin = { async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          seen.push(bash.readText("/out"));
          yield new TextEncoder().encode(chunk);
        }
      }};
      await assert.rejects(bash.exec(cmd + " >/out", { stdin, limits: { maxOutputBytes: 6 } }), { limit: "maxOutputBytes" });
      assert.deepEqual([seen, bash.readText("/out")], [expected, expected.at(-1)], cmd);
    }
    await assert.rejects(bash.exec("expand -t65536 >/out", { stdin: "\t", limits: { maxOutputBytes: 17000 } }), { limit: "maxOutputBytes" });
    assert.equal(bash.readText("/out"), " ".repeat(16384));
  } finally { bash.dispose(); }
});

test("tab conversion maintains columns across named inputs and interleaves file diagnostics", async () => {
  const bash = new RustWasmBash({ files: { "/prefix": "ab", "/tail": "\tX" } });
  try {
    for (const [cmd, tail] of [["expand", "      X"], ["unexpand", "\tX"]]) {
      const r = await bash.exec(cmd + " /prefix /missing /tail 2>&1", { limits: { maxInputBytes: 1 } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1,
        `ab${cmd}: ENOENT: no such file or directory, stat '/missing'\n${tail}`, ""]);
    }
  } finally { bash.dispose(); }
});

test("rev publishes completed lines before pulling stdin and stops on quota failure", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    const seen = [];
    let closed = 0;
    const stdin = { async *[Symbol.asyncIterator]() {
      try {
        for (const chunk of ["ab\nc", "d\n", "ef\n", "later"]) {
          seen.push(bash.readText("/out"));
          yield new TextEncoder().encode(chunk);
        }
      } finally { closed++; }
    }};
    await assert.rejects(bash.exec("rev >/out", { stdin, limits: { maxOutputBytes: 6 } }), { limit: "maxOutputBytes" });
    assert.deepEqual([seen, closed, bash.readText("/out")], [["", "ba\n", "ba\ndc\n"], 1, "ba\ndc\n"]);
  } finally { bash.dispose(); }
});

test("rev retains diagnostic order for invalid UTF-8 and continues to the next file", async () => {
  const bash = new RustWasmBash({ files: { "/bad": Uint8Array.of(97,10,98,99,255,10), "/ok": "12" } });
  try {
    const r = await bash.exec("LC_ALL=UTF-8 rev /missing /bad /ok 2>&1");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1,
      "rev: ENOENT: no such file or directory, stat '/missing'\nrev: /bad: Illegal byte sequence\na\ncb\n21", ""]);
  } finally { bash.dispose(); }
});

test("rev requires a complete UTF-8 encoding name before reading input", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [locale, valid] of [
      ["UTF-8", true], ["en_US.uTf8@euro", true], ["x-UTF8", true], ["xutf8", false], ["utf8.old", false],
    ]) {
      const r = await bash.exec("rev; cat", { stdin: "aé", env: { LC_ALL: locale } });
      assert.deepEqual([r.stdout, r.stderr], valid ? ["éa", ""] :
        ["aé", `rev: unsupported character encoding locale: '${locale}'\n`], locale);
    }
  } finally { bash.dispose(); }
});

test("rev reports named file errors and continues with later files", async () => {
  const bash = new RustWasmBash({
    files: { "/denied": { content: "private", mode: 0o200 }, "/ok": "ab" },
    symlinks: { "/alias": "/denied", "/loop": "/loop" },
  });
  try {
    const r = await bash.exec("rev /alias /loop /ok/sub '' /ok");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "ba",
      "rev: EACCES: permission denied, readStream '/alias'\n" +
      "rev: ELOOP: too many symbolic links encountered '/loop'\n" +
      "rev: ENOTDIR: not a directory, stat '/ok/sub'\n" +
      "rev: ENOENT: no such file or directory ''\n"]);
  } finally { bash.dispose(); }
});

test("rev stops reading a shared descriptor after an invalid UTF-8 record", async () => {
  const bytes = new Uint8Array(65540).fill(97);
  bytes.set([98, 99, 255, 10]);
  bytes[65536] = 90;
  const prefix = "x".repeat(65535);
  const bash = new RustWasmBash({ env: { LC_ALL: "C.UTF-8" }, files: { "/bad": bytes, "/valid": prefix + "é\nab" } });
  try {
    const valid = await bash.exec("rev </valid");
    assert.deepEqual([valid.exitCode, valid.stdout, valid.stderr], [0, "é" + prefix + "\nba", ""]);
    const r = await bash.exec("{ rev; head -c1; } </bad");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "cb\nZ", "rev: stdin: Illegal byte sequence\n"]);
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

test("cat reads only the original bytes when appending a named file to itself", async () => {
  const bash = new RustWasmBash({ files: { "/f": "ab\n" } });
  try {
    const result = await bash.exec("cat /f >>/f", { limits: { maxOutputBytes: 32 } });
    assert.deepEqual([result.exitCode, result.stderr, bash.readText("/f")], [0, "", "ab\nab\n"]);
  } finally { bash.dispose(); }
});

test("cat and tr publish each chunk before pulling more stdin", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    for (const [cmd,expected] of [["cat","a\r"],["cat -E","a"],["tr a x","x\r"]]) {
      const seen = [];
      let closed = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        try {
          for (const chunk of ["a\r","\nb\n","c\n","later"]) {
            seen.push(bash.readText("/copy"));
            yield new TextEncoder().encode(chunk);
          }
        } finally { closed++; }
      }};
      await assert.rejects(bash.exec(cmd + " > /copy",{stdin,limits:{maxOutputBytes:6}}), {limit:"maxOutputBytes"});
      assert.equal(seen[1], expected, cmd);
      assert.equal(closed, 1, cmd);
      assert.equal(seen.length, cmd === "cat -E" ? 2 : 3, cmd);
      assert.equal(bash.readText("/copy"), seen.at(-1), cmd);
    }
  } finally { bash.dispose(); }
});

test("base encoders admit stdin chunks before writing and stop decoding invalid input", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({ files: { "/src": "f" } });
  try {
    for (const [cmd, encoded, prefix] of [["base64", "Zg==", "Z"], ["base32", "MY======", "M"]]) {
      let pulls = 0;
      const input = (...chunks) => ({async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) { pulls++; yield new TextEncoder().encode(chunk); }
      }});
      await assert.rejects(bash.exec(cmd + " >/copy", {
        stdin: input("f", "oo", "bar"), limits: { maxInputBytes: 2 }
      }), { limit: "maxInputBytes" });
      assert.equal(bash.readText("/copy"), prefix);
      assert.equal(pulls, 2);
      pulls = 0;
      const file = await bash.exec(cmd + " /src", { stdin: input("unused") });
      assert.equal(file.stdout, encoded + "\n");
      assert.equal(pulls, 0);
      const invalid = await bash.exec(cmd + " -d", { stdin: input(encoded, "!".repeat(encoded.length), "unread") });
      assert.deepEqual([invalid.stdout, invalid.stderr, invalid.exitCode, pulls], ["f", cmd + ": invalid input\n", 1, 2]);
    }
  } finally { bash.dispose(); }
});

test("pagers share one input allowance across files and stdin", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/f":"x"}});
  try {
    for (const cmd of ["less", "more"]) for (const flag of ["", " -N"]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const data of [[0xc3], [0xa9, 10], [65]]) { pulls++; yield Uint8Array.from(data); }
      }};
      await assert.rejects(bash.exec(cmd + flag + " /f - >/o", {stdin, limits:{maxInputBytes:3}}), {limit:"maxInputBytes"});
      assert.equal(pulls, 2);
      assert.deepEqual([...await bash.fs.readFile("/o")], flag ? [] : [120, 0xc3]);
    }
  } finally { bash.dispose(); }
});

test("pagers report missing operands in order and decode formatted input per operand", async () => {
  const bash = new RustWasmBash({files:{"/lead":Uint8Array.of(0xc3),"/tail":Uint8Array.of(0xa9)}});
  try {
    for (const cmd of ["less", "more"]) {
      const raw = await bash.exec(cmd + " /lead /missing /tail 2>&1");
      const diagnostic = cmd + ": /missing: ENOENT: no such file or directory, readFile '/missing'\n";
      assert.equal(raw.exitCode, 1);
      assert.deepEqual([...raw.stdoutBytes], [0xc3, ...new TextEncoder().encode(diagnostic), 0xa9]);
      const text = await bash.exec(cmd + " -N /lead -", {stdin:Uint8Array.of(0xa9,10)});
      assert.equal(text.stdout, "     1  ��\n");
    }
  } finally { bash.dispose(); }
});

test("pager searches validate extended expressions and preserve quoted operators", async () => {
  const bash = new RustWasmBash({files:{"/lines":"ignore\na(b)\nabab\n"}});
  try {
    for (const [pat, reason] of [["[","unterminated bracket expression"], ["(?=x)","quantifier without an expression"],
      ["a**","nested quantifier is not supported"], ["\\1","pattern references an undefined or open capture group"]]) {
      const r = await bash.exec("less -p '" + pat + "' /lines");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "", "less: " + reason + "\n"]);
    }
    const r = await bash.exec("more '+/a\\(b\\)' /lines");
    assert.deepEqual([r.exitCode, r.stdout], [0, "a(b)\nabab\n"]);
    assert.equal((await bash.exec("less -p '[' </dev/null")).exitCode, 0);
  } finally { bash.dispose(); }
});

test("checksum commands charge operands together and publish results before pulling stdin", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/f":"abc"}});
  try {
    for (const cmd of ["sha224sum","sha256sum","sha384sum","sha512sum","sha1sum","md5sum","b2sum","cksum"]) {
      const expected = await bash.exec(cmd + " /f");
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const chunk of ["a","bb","unread"]) { pulls++; yield new TextEncoder().encode(chunk); }
      }};
      await assert.rejects(bash.exec(cmd + " /f - >/o 2>&1", {stdin,limits:{maxInputBytes:5}}), {limit:"maxInputBytes"});
      assert.equal(pulls, 2, cmd);
      assert.equal(bash.readText("/o"), expected.stdout, cmd);
      assert.equal((await bash.exec(cmd + " --invalid", {stdin})).exitCode, 2);
      assert.equal(pulls, 2);
    }
  } finally { bash.dispose(); }
});

test("checksum verification publishes each report before reading the next manifest chunk", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/f":"abc"}});
  const line = "900150983cd24fb0d6963f7d28e17f72  /f\n";
  try {
    for (const cmd of ["md5sum -cw", "cksum -cw -a md5"]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const part of [line.slice(0,10),line.slice(10),"invalid\n",line]) {
          pulls++; yield new TextEncoder().encode(part);
        }
      }};
      await assert.rejects(bash.exec(cmd + " >/o 2>&1", {stdin,limits:{maxOutputBytes:8}}), {limit:"maxOutputBytes"});
      assert.deepEqual([pulls,bash.readText("/o")], [3,"/f: OK\n"]);
    }
  } finally { bash.dispose(); }
});

test("checksum verification uses the last reporting option and validates records as UTF-8", async () => {
  const hash = "900150983cd24fb0d6963f7d28e17f72";
  const bash = new RustWasmBash({files:{"/f":"abc", "/m":Uint8Array.from([
    ...new TextEncoder().encode(hash + "  /"), 255, 10, ...new TextEncoder().encode(hash + "  /f\n")
  ])}});
  try {
    for (const cmd of ["md5sum", "cksum -a md5"]) {
      const name = cmd.split(" ")[0];
      const r = await bash.exec(cmd + " -c --status --warn /m 2>&1");
      assert.deepEqual([r.exitCode,r.stdout],[0,name + ": /m: 1: improperly formatted md5 checksum line\n/f: OK\n" +
        name + ": WARNING: 1 improperly formatted checksum line(s)\n"]);
    }
  } finally { bash.dispose(); }
});

test("SHA3 combines the suffix and final padding bit in the last byte of a block", async () => {
  const {createHash} = await import("node:crypto");
  const bash = new RustWasmBash();
  try {
    for (const bits of [224,256,384,512]) {
      const rate = 200 - bits / 4;
      for (const length of [rate - 1, rate, 2 * rate - 1]) {
        const data = Buffer.alloc(length, 0xa5);
        const r = await bash.exec("cksum --raw -a sha3 -l " + bits, {stdin:data});
        assert.deepEqual(Buffer.from(r.stdoutBytes), createHash("sha3-" + bits).update(data).digest());
      }
    }
  } finally { bash.dispose(); }
});

test("checksum working memory stays bounded as the stdin stream grows", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash(), block = Buffer.alloc(16381, 0xb7);
  const stdin = count => ({async *[Symbol.asyncIterator]() { for (let i = 0; i < count; i++) yield block; }});
  try {
    for (const algo of ["md5","sha1","sha224","sha256","sha384","sha512","sm3","sha3 -l 256","blake2b -l 256"]) {
      const cmd = "cksum -a " + algo;
      assert.equal((await bash.exec(cmd, {stdin:stdin(4)})).exitCode, 0);
      const warm = bash.exports.memory.buffer.byteLength;
      assert.equal((await bash.exec(cmd, {stdin:stdin(128)})).exitCode, 0);
      assert.ok(bash.exports.memory.buffer.byteLength - warm < block.length * 16, algo);
    }
  } finally { bash.dispose(); }
});

test("wc enforces input byte limits and counts UTF-8 across chunks", async () => {
  const bash = new RustWasmBash({files:{"/words":"abcd"}});
  const chunks = [Uint8Array.of(0x61,0xc3),Uint8Array.of(0xa9,10,0xe2),Uint8Array.of(0x82),Uint8Array.of(0xac)];
  const stdin = {async *[Symbol.asyncIterator]() {yield* chunks;}};
  try {
    for (const cmd of ["wc -c","wc -wm -","wc /words"]) {
      await assert.rejects(bash.exec(cmd,{stdin, limits:{maxInputBytes:3}}), {limit:"maxInputBytes"});
    }
    const r = await bash.exec("LC_ALL=C.UTF-8 wc -lwmcL - -",{stdin});
    assert.deepEqual([r.exitCode,r.stderr,r.stdout.trim().split(/\s+/)],
      [0,"",["1","2","4","7","2","-","0","0","0","0","0","-","1","2","4","7","2","total"]]);
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

test("async Rust commands pull stdin on demand and resume independently", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    const events = [];
    const unused = { [Symbol.asyncIterator]() { events.push("open"); return {
      next() { events.push("read"); return {done:true}; }, return() { events.push("close"); },
    }; } };
    assert.equal((await bash.exec("echo ok",{stdin:unused})).stdout, "ok\n");
    assert.deepEqual(events, ["open","close"]);
    for (const order of [[0,1],[1,0]]) {
      const entered = order.map(()=>Promise.withResolvers()), gates = order.map(()=>Promise.withResolvers());
      const jobs = gates.map((gate,i)=>bash.exec(`echo ready > /flag${i}; sleep ${i+1}; { head -c1 <&3; head -c1; } 3<&0; echo :$SECONDS`,{
        stdin:{async *[Symbol.asyncIterator]() {
          entered[i].resolve(); await gate.promise;
          yield Uint8Array.of(65+i,97+i); throw Error("unexpected extra pull");
        }},
      }));
      await Promise.all(entered.map(e=>e.promise));
      assert.equal(bash.execSync("cat /flag0 /flag1").stdout,"ready\nready\n");
      bash.exports.memory.grow(1);
      for (const i of order) gates[i].resolve();
      for (const [i,r] of (await Promise.all(jobs)).entries()) {
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0, i===0 ? "Aa:1\n" : "Bb:2\n",""]);
      }
    }
    const failed = await bash.exec("cat; echo rest",{stdin:{async *[Symbol.asyncIterator](){yield Uint8Array.of(120);throw Error("private");}}});
    assert.deepEqual([failed.stdout,failed.stderr],["xrest\n","cat: internal error\n"]);
    const malformed = {[Symbol.asyncIterator](){ return {
      next(){return {value:"text"};}, return(){throw Error("cleanup after read failure");},
    };}};
    const invalid = await bash.exec("cat",{stdin:malformed});
    assert.deepEqual([invalid.exitCode,invalid.stderr],[1,"cat: internal error\n"]);
  } finally { bash.dispose(); }
});

test("standalone plugins run async handlers in Rust pipelines and sessions", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const bash = new RustWasmBash({cwd:"/"});
  const trace = [];
  try {
    bash.use({name:"probe", async setup(host) {
      await Promise.resolve();
      trace.push("setup");
      host.commands.register({name:"probe", async execute(ctx) {
        trace.push([ctx.cwd, ctx.argv0, ctx.env.EXPORTED, ctx.env.LOCAL, ...ctx.args]);
        await Promise.resolve();
        for await (const chunk of ctx.stdin) await ctx.stdout.write(chunk);
        await ctx.stderr.write(Uint8Array.of(254));
        return {exitCode:23};
      }});
    }});
    const r = await bash.exec("LOCAL=private; export EXPORTED=ok; /bin/probe arg > /out", {stdin:Uint8Array.of(255,0)});
    assert.deepEqual([r.exitCode, ...r.stderrBytes], [23,254]);
    assert.deepEqual([...bash.readFile("/out")], [255,0]);
    assert.deepEqual(trace, ["setup", ["/","/bin/probe","ok",undefined,"arg"]]);
    const session = bash.createSession();
    try {
      const piped = await session.exec("printf yes | probe | cat");
      assert.equal(piped.stdout, "yes");
      assert.deepEqual([...piped.stderrBytes], [254]);
    } finally { await session.dispose(); }
  } finally { await bash.dispose(); }
});

test("middleware wraps live shell commands, functions and plugin handlers",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), js=new Shell({fs,cwd:"/"}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
  const run=async(sh,fs)=>{
    await fs.mkdir("/dir");
    const trace=[];
    sh.use(async(ctx,next)=>{trace.push("before:"+ctx.command);const r=await next();trace.push("after:"+ctx.command+":"+r.exitCode);return r;});
    sh.use({name:"gate",setup(host){
      host.use(async(ctx,next)=>{
        if(ctx.command==="denied")return {exitCode:23};
        if(ctx.command==="probe")await ctx.stdout.write(Uint8Array.of(65));
        const r=await next();
        if(ctx.command==="probe")await ctx.stdout.write(Uint8Array.of(67));
        return r;
      });
      host.commands.register({name:"probe",async execute(ctx){await ctx.stdout.write(Uint8Array.of(66));return {exitCode:0};}});
    }});
    const r=await sh.exec("cd /dir; export V=value; f(){ probe; }; f >result; pwd; denied");
    return {code:r.exitCode,out:r.stdout,err:r.stderr,bytes:[...await fs.readFile("/dir/result")],trace};
  };
  try {
    const expected=await run(js,fs);
    assert.deepEqual([expected.code,expected.out,expected.bytes],[23,"/dir\n",[65,66,67]]);
    assert.deepEqual(await run(rust,rust.fs),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("middleware writes to the active redirect before and after the native command",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(),js=new Shell({fs:ref,cwd:"/"}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  const run=async(sh,fs)=>{
    const trace=[], views=[];
    sh.use(async(ctx,next)=>{
      trace.push(ctx.command);
      if(ctx.command!=="cat") return next();
      await ctx.stdout.write(Uint8Array.of(65));
      views.push([...await ctx.fs.readFile("/out")]);
      const result=await next();
      views.push([...await ctx.fs.readFile("/out")]);
      await ctx.stdout.write(Uint8Array.of(67));
      return result;
    });
    const a=await sh.exec("cat > /out",{stdin:Uint8Array.of(66)});
    const b=await sh.exec("builtin printf x; command printf y; exec > /permanent; printf Z");
    return [trace,views,[...await fs.readFile("/out")],[...await fs.readFile("/permanent")],a.stdout,b.stdout];
  };
  try{
    const expected=await run(js,ref);assert.deepEqual(expected[1],[[65],[65,66]]);
    assert.deepEqual(await run(rust,rust.fs),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("middleware pulls stdin only when read and next sees the remaining chunks",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const js=new Shell({fs:new MemoryFileSystem(),cwd:"/"}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  const run=async sh=>{
    const reads=[];let pulls=0;
    sh.use(async(ctx,next)=>{
      reads.push([ctx.command,pulls]);
      if(ctx.command==="stop") return ctx.invoke("true",[]);
      if(ctx.command==="cat"){
        for await(const bytes of ctx.stdin){reads.push([...bytes]);break;}
      }
      return next();
    });
    async function* source(){for(const n of [65,66,67]){pulls++;yield Uint8Array.of(n);}}
    const result=await sh.exec("stop; cat",{stdin:source()});
    return [reads,result.stdout,result.stderr,result.exitCode];
  };
  try{const expected=await run(js);assert.equal(expected[0][0][1],0);assert.deepEqual(await run(rust),expected);}
  finally{await js.dispose();await rust.dispose();}
});

test("middleware and the selected plugin handler share streams, cleanup and thrown errors",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const run=async sh=>{
    const trace=[]; let context, pulls=0;
    sh.use(async(ctx,next)=>{
      context=ctx;
      ctx.registerCleanup(()=>trace.push("outer cleanup"));
      try{const r=await next();trace.push("after");return r;}
      catch(e){trace.push(e.message);return {exitCode:42};}
    });
    sh.register({name:"probe",async execute(ctx){
      trace.push([ctx.command,ctx.argv0,ctx.stdin===context.stdin,pulls]);
      ctx.registerCleanup(()=>trace.push("handler cleanup"));
      if(ctx.args.length) throw new Error("from handler");
      return {exitCode:0};
    }});
    const input=()=> (async function*(){pulls++;yield Uint8Array.of(1);})();
    const a=await sh.exec("probe",{stdin:input()});
    const b=await sh.exec("/bin/probe fail",{stdin:input()});
    return [a.exitCode,b.exitCode,b.stderr,trace];
  };
  const js=new Shell({fs:new MemoryFileSystem(),cwd:"/"}),rust=new RustWasmBash({cwd:"/"});
  try{const expected=await run(js);assert.equal(expected[1],42);assert.deepEqual(await run(rust),expected);}
  finally{await js.dispose();await rust.dispose();}
});

test("middleware cwd and environment apply during lookup and restore around shell mutations",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh)=>{
    sh.use((ctx,next)=>{
      if(["inspect","change","tool","cd"].includes(ctx.command)){
        ctx.cwd="/work";
        if(ctx.command!=="cd"){
          ctx.env={...ctx.env,MARK:"temporary",PATH:".",LOCAL:"visible"};
          delete ctx.env.DROP;
        }
      }
      return next();
    });
    const r=await sh.exec(`mkdir -p /work/next
printf '#!/bin/bash\\npwd; echo "$MARK"\\n' > /work/tool; chmod +x /work/tool
export MARK=old DROP=original; LOCAL=private
inspect(){ pwd; echo "$MARK:\${DROP-absent}:$LOCAL"; }
change(){ cd next; export MARK=committed; }
inspect; tool; pwd; echo "$MARK:$DROP:$LOCAL"; change; pwd; echo "$MARK:$DROP:$LOCAL"`);
    return [r.exitCode,r.stdout,r.stderr];
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{
    const expected=await run(js);
    assert.deepEqual(expected,[0,"/work\ntemporary:absent:visible\n/work\ntemporary\n/\nold:original:private\n/work/next\ncommitted:original:private\n",""]);
    assert.deepEqual(await run(rust),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("middleware restores arrays, preserves replacements and honors directory stack changes",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh)=>{
    const trace=[];
    sh.use(async(ctx,next)=>{
      if(ctx.command!=="f")return next();
      ctx.cwd="/work";ctx.env.A="temp";
      try{return await next();}catch(error){trace.push(error.message);return {exitCode:41};}
    });
    const results=[];
    for(const script of [
      'A=(one two); f(){ echo "${A[*]}"; }; f; echo "${A[*]}"',
      'readonly -a A=(one two); f(){ echo unexpected; }; f; echo "${A[*]}"',
      'A=(one two); f(){ A=(temp new); }; f; echo "${A[*]}"',
      'mkdir -p /work; f(){ pushd /work; }; f; pwd'
    ]){const r=await sh.exec(script);results.push([r.exitCode,r.stdout,r.stderr]);}
    return [results,trace];
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{assert.deepEqual(await run(rust),await run(js));}finally{await js.dispose();await rust.dispose();}
});

test("ctx.invoke inherits the current context before, inside and after the middleware terminal",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh)=>{
    sh.use({name:"child-test",setup(host){
      host.commands.register({name:"parent",async execute(ctx){
        await ctx.invoke("inspect",[]);
        ctx.env={...ctx.env,MARK:"handler"};
        await ctx.invoke("inspect",[],{cwd:"next",env:{EXTRA:"explicit"}});
        return {exitCode:0};
      }});
    }});
    sh.use(async(ctx,next)=>{
      if(ctx.command!=="parent")return next();
      ctx.cwd="/work";ctx.env.MARK="middleware";delete ctx.env.DROP;
      await ctx.invoke("inspect",[]);
      const r=await next();
      await ctx.invoke("inspect",[]);
      return r;
    });
    const r=await sh.exec('mkdir -p /work/next; export MARK=original DROP=old; inspect(){ pwd; echo "$MARK:${DROP-absent}:${EXTRA-absent}"; }; parent; inspect');
    return [r.exitCode,r.stdout,r.stderr];
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{
    const expected=await run(js);
    assert.deepEqual(expected,[0,"/work\nmiddleware:absent:absent\n/work\nmiddleware:absent:absent\n/work/next\nhandler:absent:explicit\n/work\nhandler:absent:absent\n/\noriginal:old:absent\n",""]);
    assert.deepEqual(await run(rust),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("host commands inherit exported functions and can remove them from external invocations",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh)=>{
    let definition;
    sh.use({name:"function-env",setup(host){
      host.commands.register({name:"driver",async execute(ctx){
        definition=ctx.env["BASH_FUNC_f%%"];
        await ctx.invoke("f",[],{externalInvocation:true});
        delete ctx.env["BASH_FUNC_f%%"];
        return ctx.invoke("f",[],{externalInvocation:true});
      }});
    }});
    const r=await sh.exec('f(){ echo inherited; }; export -f f; driver');
    return [definition,r.exitCode,r.stdout,r.stderr];
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{
    const expected=await run(js);
    assert.equal(expected[1],127);
    assert.equal(expected[2],"inherited\n");
    assert.deepEqual(await run(rust),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("middleware replacements reach builtins, functions and registered commands with literal byte arguments",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const {createCommandArguments}=await import("safe-bash-contracts");
  for(const sh of [new Shell({fs:new MemoryFileSystem(),cwd:"/"}).use(agentCommands()),new RustWasmBash({cwd:"/"})]){
    sh.use({name:"rewrite-target",setup(host){host.commands.register({name:"raw",async execute(ctx){
      await ctx.stdout.write(ctx.argumentValues.bytes(0));return {exitCode:0};
    }});}});
    sh.use((ctx,next)=>{
      if(ctx.command==="rewrite"){
        ctx.command=ctx.args[0];
        ctx.argumentValues=createCommandArguments([...(ctx.command==="printf"?["%s"]:[]),Uint8Array.of(255,65)]);
        ctx.args=ctx.argumentValues.args;
      }
      return next();
    });
    try{
      const r=await sh.exec('f(){ printf "%s" "$1"; }; rewrite printf; rewrite f; rewrite /bin/raw');
      assert.equal(r.exitCode,0,r.stderr);
      assert.deepEqual(r.stdoutBytes,Uint8Array.of(255,65,255,65,255,65));
    }finally{await sh.dispose();}
  }
});

test("middleware can observe or catch exit, return, break and continue",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh,swallow)=>{
    const trace=[];
    sh.use(async(ctx,next)=>{
      try {const r=await next();trace.push([ctx.command,"done",r.exitCode]);return r;}
      catch(e) {trace.push([ctx.command,e.name,e.kind,e.status,e.levels,e.previousStatus]);if(swallow)return {exitCode:7};throw e;}
    });
    const results=[];
    for(const script of ["false; exit 5; printf X","f(){ false; return 4; printf Y; }; f","for i in a b; do break; printf Z; done","for i in a b; do continue; printf W; done","exec /bin/false; printf Q"]){
      const r=await sh.exec(script);results.push([r.exitCode,r.stdout,r.stderr]);
    }
    return [results,trace];
  };
  for(const swallow of [false,true]){
    const js=new Shell({fs:new MemoryFileSystem(),cwd:"/"}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
    try{assert.deepEqual(await run(rust,swallow),await run(js,swallow));}finally{await js.dispose();await rust.dispose();}
  }
});

test("plugin-provided capabilities reach nested commands and explicit invocation settings win",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem}=await import("@poe-platform/safe-bash");
  for(const sh of [new Shell({fs:new MemoryFileSystem(),cwd:"/"}),new RustWasmBash({cwd:"/"})]){
    let provided;
    const marker={}, seen=[];
    sh.use({name:"defaults",setup(host){
      provided=host.provideCapabilities;
      host.provideCapabilities({services:marker,choice:"default"});
      host.commands.register({name:"child",async execute(ctx){
        seen.push([ctx.capabilities.services===marker,ctx.capabilities.choice,Object.isFrozen(ctx.capabilities)]);
        return {exitCode:0};
      }});
      host.commands.register({name:"parent",execute:ctx=>ctx.invoke("child",[])});
    }});
    try{
      for(const choice of [undefined,"explicit",undefined]){
        const r=await sh.exec("parent",choice?{capabilities:{choice}}:{});
        assert.equal(r.exitCode,0,r.stderr);
      }
      assert.deepEqual(seen,[[true,"default",true],[true,"explicit",true],[true,"default",true]]);
    }finally{await sh.dispose();}
    assert.throws(()=>provided({choice:"late"}),/disposed/i);
  }
});

test("suspended plugin commands keep their own inputs, output limits and cancellation", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const bash = new RustWasmBash({cwd:"/"});
  let release, entered;
  const held = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  bash.register({name:"hold", async execute(ctx) {
    if (ctx.args[0] === "wait") { entered(); await held; }
    for await (const bytes of ctx.stdin) await ctx.stdout.write(bytes);
    return {exitCode:0};
  }});
  bash.register({name:"bad", async execute(ctx) {
    await ctx.stderr.write(Uint8Array.of(88));
    throw new Error("private handler failure");
  }});
  try {
    const slow = bash.exec("hold wait >/slow", {stdin:"first"});
    await started;
    assert.equal((await bash.exec("hold", {stdin:"other"})).stdout, "other");
    release();
    assert.equal((await slow).exitCode, 0);
    assert.equal(bash.readText("/slow"), "first");
    await assert.rejects(bash.exec("hold; touch /late", {stdin:"abcd", limits:{maxOutputBytes:1}}), {limit:"maxOutputBytes"});
    await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
    const bad = await bash.exec("true\nbad");
    assert.deepEqual([bad.exitCode,bad.stderr], [1,"Xshell: line 2: internal error\n"]);
    const ctrl = new AbortController(), reason = new Error("stop");
    bash.register({name:"cancelme", execute() { ctrl.abort(reason); return new Promise(() => {}); }});
    await assert.rejects(bash.exec("cancelme; touch /late", {signal:ctrl.signal}), e => e === reason);
    await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
  } finally { release(); await bash.dispose(); }
});

test("plugin filesystem streams pin memory bytes on first pull, obey ranges and charge once", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  for (const [sh, volume] of [[js,fs],[rust,rust.fs]]) {
    let held;
    sh.register({name:"streamprobe", async execute(c) {
      const source = c.fs.readStream("/file",{chunkSize:2, start:1, endExclusive:6});
      held = source[Symbol.asyncIterator]();
      await volume.writeFile("/file", Uint8Array.of(0,255,2,3,4,5,6));
      const first = await held.next();
      await volume.writeFile("/file", Uint8Array.of(9,9,9,9));
      await c.stdout.write(first.value);
      await c.stdout.write((await held.next()).value);
      return {exitCode:0};
    }});
    sh.register({name:"cancelstream", async execute(c) {
      const controller = new AbortController();
      const source = c.fs.readStream("/file",{chunkSize:1,signal:controller.signal})[Symbol.asyncIterator]();
      await source.next(); controller.abort(false);
      await assert.rejects(source.next(), e=>e===false);
      return {exitCode:0};
    }});
    try {
      await volume.writeFile("/file",Uint8Array.of(0));
      const r = await sh.exec("streamprobe",{limits:{maxFileSystemOperations:1}});
      assert.equal(r.exitCode,0,r.stderr); assert.deepEqual([...r.stdoutBytes],[255,2,3,4]);
      await assert.rejects(held.next(),/closed|finished/i);
      await assert.rejects(sh.exec("streamprobe",{limits:{maxFileSystemOperations:0}}),{limit:"maxFileSystemOperations"});
      const c = await sh.exec("cancelstream"); assert.equal(c.exitCode,0,c.stderr);
    } finally { await sh.dispose(); }
  }
});

test("returning a memory stream releases its pinned bytes even after unlink",async () => {
  const {MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const bash = new RustWasmBash({memoryFsOptions:{maxBytes:100}});
  try {
    for (const fs of [new MemoryFileSystem({maxBytes:100}),bash.fs]) {
      await fs.writeFile("/f",new Uint8Array(80));
      const stream = fs.readStream("/f",{chunkSize:1})[Symbol.asyncIterator]();
      assert.equal((await stream.next()).value.length,1);
      await fs.unlink("/f");
      await assert.rejects(fs.writeFile("/large",new Uint8Array(90)),{code:"ENOSPC"});
      await stream.return();
      await fs.writeFile("/large",new Uint8Array(90));
    }
  } finally { await bash.dispose(); }
});

test("plugin file output shares the shell byte limit with child commands and refunds short writes", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {writeFileOutput,writeFileOutputCounted} = await import("safe-bash-contracts/filesystem-output-budget");
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  for (const sh of [new Shell({fs:new MemoryFileSystem(),cwd:"/"}),new RustWasmBash({cwd:"/"})]) {
    let touched = false;
    sh.register({name:"child",async execute(c) { await c.stdout.write(Uint8Array.of(120)); return {exitCode:0}; }});
    sh.register({name:"publish",async execute(c) {
      const bytes = Uint8Array.of(0,255,1);
      Object.defineProperty(bytes,"length",{value:0});
      await writeFileOutput(c,bytes,async () => { touched = true; });
      await writeFileOutputCounted(c,bytes,async () => {
        await c.invoke("child",[]);
        return 1;
      });
      await c.stdout.write(bytes);
      return {exitCode:0};
    }});
    try {
      const exec = limit => sh.exec("publish",{limits:{maxOutputBytes:limit}});
      await assert.rejects(exec(2),/maxOutputBytes/);
      assert.equal(touched,false);
      await assert.rejects(exec(7),/maxOutputBytes/);
      const result = await exec(8);
      assert.equal(result.exitCode,0,result.stderr);
      assert.deepEqual([...result.stdoutBytes],[120,0,255,1]);
    } finally { await sh.dispose(); }
  }
});

test("conditional plugin publication checks parent and destination receipts before editing hard links", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const reference = new MemoryFileSystem(), js = new Shell({fs:reference,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  for (const [sh,volume] of [[js,reference],[rust,rust.fs]]) {
    await volume.mkdir("/dir");
    sh.register({name:"publish",async execute(c) {
      const fs=c.fs, parent=await fs.stat("/dir"), file="/dir/out";
      assert.equal((await fs.capabilitiesFor(file)).atomicFileMutation,true);
      const created=await fs.writeFileConditional(file,Uint8Array.of(1),{parent,expected:null,mode:0o640});
      assert.equal(created.mode & 0o777,0o640);
      await volume.link(file,"/alias");
      await assert.rejects(fs.writeFileConditional(file,Uint8Array.of(9),{parent,expected:created}),{code:"EAGAIN"});
      const expected=await fs.lstat(file);
      const updated=await fs.writeFileConditional(file,Uint8Array.of(255),{parent,expected,append:true,atimeMs:123,mtimeMs:456});
      assert.equal(updated.ino,expected.ino); assert.equal(updated.mtimeMs,456); assert.equal(updated.atimeMs,123);
      assert.deepEqual([...await volume.readFile("/alias")],[1,255]);
      await assert.rejects(fs.removeFileConditional(file,{parent,expected}),{code:"EAGAIN"});
      await fs.removeFileConditional(file,{parent,expected:updated});
      await assert.rejects(volume.stat(file),{code:"ENOENT"});
      await volume.rename("/dir","/before"); await volume.mkdir("/dir");
      await assert.rejects(fs.writeFileConditional(file,Uint8Array.of(0),{parent,expected:null}),{code:"EAGAIN"});
      return {exitCode:0};
    }});
    try { let cause; const r = await sh.exec("publish",{onInternalError:e => {cause=e;}}); assert.equal(r.exitCode,0,(sh === js ? "JS: " : "Rust: ")+(cause?.stack ?? r.stderr)); }
    finally { await sh.dispose(); }
  }
});

test("ranged filesystem streams keep large regular chunks and bound infinite device reads",async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev",files:{"/data":new Uint8Array(100005)}});
  async function sizes(path,options) {
    const result = [];
    for await (const chunk of bash.fs.readStream(path,options)) result.push(chunk.length);
    return result;
  }
  try {
    assert.deepEqual(await sizes("/data",{chunkSize:100000,start:3}),[100000,2]);
    assert.deepEqual(await sizes("/dev/zero",{chunkSize:100000,start:3,endExclusive:100005}),[65536,34466]);
    assert.deepEqual(await sizes("/dev/null",{}),[]);
    await assert.rejects(sizes("/absent",{}),{code:"ENOENT"});
    await assert.rejects(sizes("/data",{start:5,endExclusive:4}),{code:"EINVAL"});
  } finally { await bash.dispose(); }
});

test("ZIP newline conversion preserves binary members and uses the compression method's text probe", async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/"});
  const prefix = new Uint8Array(32770).fill(65);
  prefix.set([0,13,10],8192);
  try {
    for (const [options,name,bytes] of [
      ["-0 -l","binary",[65,0,10]], ["-ll","binary",[65,14,13,10]],
      ["-l","no-text",[9,10,13]], ["--to-crlf","mixed",[65,13,10,66,10]],
      ["-qll","grouped",[65,13,10]], ["-ll -l","last",[65,13,10]],
      ["-0 -l","store",prefix], ["-l","deflate",prefix], ["-l -n .data","suffix.data",prefix],
    ]) {
      const run = async (shell,volume) => {
        await volume.writeFile("/"+name,Uint8Array.from(bytes));
        const created = await shell.exec("zip -q "+options+" sample.zip "+name);
        assert.equal(created.exitCode,0,created.stderr || created.stdout);
        const extracted = await shell.exec("unzip -p sample.zip "+name);
        assert.equal(extracted.exitCode,0,extracted.stderr);
        await volume.unlink("/sample.zip");
        return Buffer.from(extracted.stdoutBytes);
      };
      const expected = await run(js,fs), actual = await run(rust,rust.fs);
      assert.equal(actual.compare(expected),0,options+" "+name);
    }
  } finally { await rust.dispose(); await js.dispose(); }
});

test("ZIP updates exclude archive aliases, preserve retained readers, and validate destinations before moving inputs", async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  for (const [link,command] of [
    ["none","-qm out.zip out.zip two"], ["none","-qm out.zip out.zip"],
    ["hard","-qm out.zip alias two"], ["sym","-qm out.zip alias two"],
    ["sym","-qm alias two"], ["sym","-qm -O alias out.zip two"],
    ["none","-qm -O copy.zip out.zip copy.zip two"], ["hard","-qm -O copy.zip out.zip two"],
    ["none","-qm -O out.zip out.zip two"], ["none","-qm -s64k out.zip two"],
  ]) {
    const base = new MemoryFileSystem(), js = new Shell({fs:base,cwd:"/"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/"});
    const run = async (sh,fs) => {
      for (const [p,n] of [["one",1],["two",2],["copy.zip",3]]) {
        await fs.writeFile("/"+p,Uint8Array.of(n));
        await fs.utimes("/"+p,1700000000000,1700000000000);
      }
      assert.equal((await sh.exec("zip -q0 out.zip one")).exitCode,0);
      await fs.chmod("/out.zip",0o751);
      if (link === "hard") await fs.link("/out.zip","/alias.zip");
      if (link === "sym") await fs.symlink("/out.zip","/alias.zip");
      const old = await fs.stat("/out.zip");
      const reader = await fs.openReadFile("/out.zip");
      try {
        const r = await sh.exec("zip "+command.replaceAll("alias","alias.zip"));
        const states = [];
        for (const name of ["out.zip","copy.zip","two","alias.zip"]) {
          const st = await fs.lstat("/"+name).catch(()=>null);
          states.push(!st ? null : [st.type,st.mode & 0o777, st.ino === old.ino, Buffer.from(await fs.readFile("/"+name)).toString("hex")]);
        }
        return [r.exitCode,r.stdout,r.stderr,states,Buffer.from(await reader.read(0,1024)).toString("hex")];
      } finally { await reader.close(); }
    };
    try { assert.deepEqual(await run(rust,rust.fs),await run(js,base),command+" "+link); }
    finally { await rust.dispose(); await js.dispose(); }
  }
});

test("zip -m keeps protected inputs after publication and removes writable sources and their aliases", async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  const reference = new MemoryFileSystem(), js = new Shell({fs:reference,cwd:"/"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/"});
  try {
    const run = async (sh,fs) => {
      await fs.mkdir("/keep"); await fs.writeFile("/keep/file",Uint8Array.of(1)); await fs.chmod("/keep",0o500);
      await fs.mkdir("/tree"); await fs.writeFile("/tree/file",Uint8Array.of(2)); await fs.link("/tree/file","/tree/alias");
      await fs.symlink("keep/file","/link");
      const r = await sh.exec("zip -qrm out.zip keep/file tree link");
      for (const name of ["/tree","/link"]) await assert.rejects(fs.lstat(name),{code:"ENOENT"});
      assert.deepEqual([...await fs.readFile("/keep/file")],[1]);
      const read = await sh.exec("unzip -p out.zip tree/alias");
      return [r.exitCode,r.stdout,r.stderr,read.exitCode,[...read.stdoutBytes]];
    };
    const expected=await run(js,reference);
    assert.deepEqual(expected,[0,"","",0,[2]]);
    assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose(); await rust.dispose();}
});

test("ZIP progress reports entry updates, encoded sizes and move warnings in order",async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  const reference = new MemoryFileSystem(), js = new Shell({fs:reference,cwd:"/"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/"});
  try {
    const run = async (sh,fs) => {
      await fs.mkdir("/keep"); await fs.writeFile("/keep/file",Uint8Array.of(1)); await fs.chmod("/keep",0o500);
      await fs.writeFile("/compress",new Uint8Array(1024).fill(65));
      await fs.writeFile("/é",Uint8Array.of(255));
      await fs.writeFile("/token=test",Uint8Array.of(1));
      const rows = [];
      for (const command of ["zip out.zip keep/file", "zip -m out.zip keep/file", "zip -v out.zip compress é token=test"]) {
        const r=await sh.exec(command); rows.push([r.exitCode,r.stdout,r.stderr]);
      }
      return rows;
    };
    const expected=await run(js,reference);
    assert.equal(expected[1][1],"updating: keep/file (stored 0%)\n\tzip warning: error deleting keep/file\n");
    assert.match(expected[2][1],/deflated 99%/);
    assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose();await rust.dispose();}
});

test("ZIP rejects reserved move switches before replacing an archive or deleting a source", async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  const ref = new MemoryFileSystem(), js = new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/"});
  try {
    const run = async (sh,fs) => {
      await fs.writeFile("/original",Uint8Array.of(1));
      await sh.exec("zip -q out.zip original");
      const before = await fs.readFile("/out.zip");
      await fs.writeFile("/input",Uint8Array.of(2));
      for (const option of ["-mm","-qmmt","-qmm"]) {
        const r = await sh.exec("zip "+option+" out.zip input");
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[16,"\nzip error: Invalid command arguments (unsupported option: -mm)\n",""]);
        assert.deepEqual(await fs.readFile("/out.zip"),before);
        assert.deepEqual([...await fs.readFile("/input")],[2]);
      }
      const r=await sh.exec("zip --move -q out.zip input");
      assert.equal(r.exitCode,0,r.stderr || r.stdout);
      await assert.rejects(fs.lstat("/input"),{code:"ENOENT"});
    };
    await run(js,ref); await run(rust,rust.fs);
  } finally {await js.dispose();await rust.dispose();}
});

test("ZIP update, delete and copy keep the compressed records of untouched members",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  function retained(bytes) {
    const b=Buffer.from(bytes), end=b.length-22;
    let p=b.readUInt32LE(end+16);
    while (p<end) {
      const size=b.readUInt32LE(p+20), n=b.readUInt16LE(p+28), x=b.readUInt16LE(p+30), c=b.readUInt16LE(p+32);
      const off=b.readUInt32LE(p+42), next=p+46+n+x+c;
      if (b.toString("utf8",p+46,p+46+n)==="keep") {
        const central=Buffer.from(b.subarray(p,next)); central.writeUInt32LE(0,42);
        const data=off+30+b.readUInt16LE(off+26)+b.readUInt16LE(off+28);
        assert.equal(b.readUInt16LE(p+10),8,"keep must remain deflated");
        return [central,b.subarray(off,data+size)];
      }
      p=next;
    }
    assert.fail("missing retained member");
  }
  try {
    await ref.writeFile("/first",Uint8Array.of(1));
    await ref.writeFile("/keep",new Uint8Array(4096).fill(65));
    assert.equal((await js.exec("zip -q base.zip first keep")).exitCode,0);
    const seed=await ref.readFile("/base.zip"), original=retained(seed);
    for (const [sh,fs] of [[js,ref],[rust,rust.fs]]) {
      await fs.writeFile("/work.zip",seed);
      await fs.writeFile("/first",new Uint8Array(160).fill(2));
      for (const [script,path] of [["zip -q0 work.zip first","work"],["zip -qd work.zip first","work"],["zip -qU -O copy.zip work.zip keep","copy"]]) {
        const r=await sh.exec(script); assert.equal(r.exitCode,0,r.stderr || r.stdout);
        assert.deepEqual(retained(await fs.readFile("/"+path+".zip")),original);
        assert.deepEqual((await sh.exec("unzip -p "+path+".zip keep")).stdoutBytes,new Uint8Array(4096).fill(65));
      }
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("ZIP editing verifies a retained data descriptor before moving the source",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    await ref.writeFile("/keep",new Uint8Array(4096).fill(65));
    assert.equal((await js.exec("zip -q -fd seed.zip keep")).exitCode,0);
    const seed=Buffer.from(await ref.readFile("/seed.zip"));
    const marker=seed.indexOf(Buffer.from([80,75,7,8]));
    assert.ok(marker>30); const broken=Buffer.from(seed); broken[marker+8]^=1;
    const run=async (sh,fs) => {
      await fs.writeFile("/unsafe.zip",broken); await fs.writeFile("/input",Uint8Array.of(66));
      const fail=await sh.exec("zip -qm unsafe.zip input");
      assert.notEqual(fail.exitCode,0);
      assert.deepEqual(await fs.readFile("/unsafe.zip"),new Uint8Array(broken));
      assert.deepEqual([...await fs.readFile("/input")],[66]);
      await fs.writeFile("/valid.zip",seed);
      const r=await sh.exec("zip -qm valid.zip input"); assert.equal(r.exitCode,0,r.stderr);
      const b=Buffer.from(await fs.readFile("/valid.zip"));
      assert.equal(b.readUInt16LE(6)&8,0);
      return [fail.exitCode,fail.stdout,fail.stderr,b.subarray(0,marker)];
    };
    const expected=await run(js,ref); assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose();await rust.dispose();}
});

test("a ZIP member named __ZIP_COMMENT__ remains distinct from the archive comment",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    const name="__ZIP_COMMENT__", payload=Uint8Array.of(0,255,1);
    await ref.writeFile("/"+name,payload);
    const made=await js.exec("zip -qz seed.zip "+name,{stdin:"archive comment\n.\n"});
    assert.equal(made.exitCode,0,made.stderr); const seed=await ref.readFile("/seed.zip");
    for(const [sh,fs] of [[js,ref],[rust,rust.fs]]) {
      await fs.writeFile("/work.zip",seed);
      await fs.writeFile("/extra",Uint8Array.of(9));
      const r=await sh.exec("zip -q work.zip extra"); assert.equal(r.exitCode,0,r.stderr);
      assert.deepEqual((await sh.exec("unzip -p work.zip "+name)).stdoutBytes,payload);
      const b=Buffer.from(await fs.readFile("/work.zip")), end=b.lastIndexOf(Buffer.from([80,75,5,6]));
      assert.equal(b.subarray(end+22).toString(),"archive comment");
      assert.equal(b.readUInt16LE(end+10),2);
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("ZIP archive comments preserve input bytes, line limits and prompt order",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    const run=async (sh,fs) => {
      await fs.writeFile("/file",Uint8Array.of(1));
      const rows=[];
      for(const [command,stdin] of [
        ["zip -z a.zip file","first\nsecond\n.\nignored"],
        ["zip -z a.zip",Uint8Array.of(255,0,65,10,10,46)],
        ["zip -qz a.zip","x".repeat(65535)],
        ["zip -qz a.zip","x".repeat(65536)],
        ["zip -qz a.zip","\n.\n"],
      ]) {
        const r=await sh.exec(command,{stdin});
        const b=Buffer.from(await fs.readFile("/a.zip")), p=b.lastIndexOf(Buffer.from([80,75,5,6]));
        const comment=b.subarray(p+22);
        assert.equal(b.readUInt16LE(p+20),comment.length);
        rows.push([r.exitCode,Buffer.from(r.stdoutBytes),r.stderr,comment.length,comment.subarray(0,32)]);
      }
      return rows;
    };
    const expected=await run(js,ref);
    assert.deepEqual(expected.map(row=>row[0]),[0,0,0,2,0]);
    assert.equal(expected[0][4].toString(),"first\r\nsecond");
    assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose();await rust.dispose();}
});

test("unzip renders binary archive comments only in modes that display them",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    await ref.writeFile("/f",Uint8Array.of(65));
    assert.equal((await js.exec("zip -q0 sample.zip f")).exitCode,0);
    const plain=Buffer.from(await ref.readFile("/sample.zip"));
    for(const comment of [Buffer.from([255,13,10,19,27,65,0,66]),Buffer.from([13,19,0,65])]) {
      const seed=Buffer.concat([plain,comment]); seed.writeUInt16LE(comment.length,plain.length-2);
      for(const fs of [ref,rust.fs]) {await fs.writeFile("/sample.zip",seed); await fs.writeFile("/f",Uint8Array.of(65));}
      for(const flags of ["-z","-qz","-t","-qt","-l","-c","-p","-Z1","-n","-qn"]) {
        const cmd="unzip "+flags+" sample.zip", expected=await js.exec(cmd), actual=await rust.exec(cmd);
        assert.equal(expected.exitCode,0,cmd);
        assert.deepEqual([actual.exitCode,actual.stdoutBytes,actual.stderr],[expected.exitCode,expected.stdoutBytes,expected.stderr],cmd);
      }
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("unzip preserves existing files unless overwrite is selected and checks renamed destinations",async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    assert.equal((await js.exec("echo first > a; echo second > b; zip -q seed.zip a b")).exitCode,0);
    await rust.fs.writeFile("/seed.zip",await ref.readFile("/seed.zip"));
    for(const [flags,stdin] of [["",""],["","n\ny\n"],["","A\n"],["","N\n"],["-no",""],["","invalid!!yes\nn\n"],["","r\n\nsub/new\ny\n"],["","r\n../outside\n"],["","r\n"],["","r\nb\nN\n"]]) {
      const run=async sh=>{
        assert.equal((await sh.exec("rm -rf box; mkdir box; echo old-a > box/a; echo old-b > box/b")).exitCode,0);
        const r=await sh.exec("unzip -q "+flags+" -d box seed.zip",{stdin});
        const contents=await sh.exec("cat box/a box/b; test ! -e box/sub/new || cat box/sub/new; test ! -e outside");
        return [r.exitCode,r.stdout,r.stderr,contents.stdout,contents.exitCode];
      };
      const expected=await run(js); assert.deepEqual(await run(rust),expected,JSON.stringify([flags,stdin]));
    }
    const prompt="replace box/a? [y]es, [n]o, [A]ll, [N]one, [r]ename: ";
    for(const [sh,fs] of [[js,ref],[rust,rust.fs]]) {
      await fs.writeFile("/box/a",Uint8Array.of(90));
      await assert.rejects(sh.exec("unzip -q -d box seed.zip a",{stdin:"y\n",limits:{maxOutputBytes:prompt.length+1}}),/maxOutputBytes/);
      assert.deepEqual(await fs.readFile("/box/a"),Uint8Array.of(90));
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("unzip update and freshen compare DOS timestamps before prompting and skip absent freshen paths",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  const base=1700000000000;
  try {
    await ref.mkdir("/nested");
    for(const name of ["rounded","old","new","nested/missing"]){
      await ref.writeFile("/"+name,Uint8Array.of(65));await ref.utimes("/"+name,base,base);
    }
    const zip=await js.exec("zip -0q seed.zip rounded old new nested/missing");assert.equal(zip.exitCode,0,zip.stderr);
    await rust.fs.writeFile("/seed.zip",await ref.readFile("/seed.zip"));
    for(const [sh,fs] of [[js,ref],[rust,rust.fs]])for(const [flags,missing] of [["uf",false],["fu",true]]) {
      const dest="/"+flags;
      await fs.mkdir(dest);
      for(const [name,delta] of [["rounded",-1],["old",-2000],["new",2000]]) {
        await fs.writeFile(dest+"/"+name,Uint8Array.of(66));await fs.utimes(dest+"/"+name,base+delta,base+delta);
      }
      const result=await sh.exec("unzip -q"+flags+" -d "+flags+" seed.zip",{stdin:"r\nrenamed\n"});
      assert.equal(result.exitCode,0,result.stderr);
      assert.equal(result.stderr,"replace "+flags+"/old? [y]es, [n]o, [A]ll, [N]one, [r]ename: new name: ");
      for(const name of ["rounded","old","new"])assert.deepEqual(await fs.readFile(dest+"/"+name),Uint8Array.of(66));
      assert.deepEqual(await fs.readFile(dest+"/renamed"),Uint8Array.of(65));
      if(missing)assert.deepEqual(await fs.readFile(dest+"/nested/missing"),Uint8Array.of(65));
      else await assert.rejects(fs.stat(dest+"/nested"),{code:"ENOENT"});
    }
  }finally{await js.dispose();await rust.dispose();}
});

test("unzip contains extracted members and protects existing links and the input archive",async () => {
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    const cases=[
      ["../outside","-d box"],["../outside","-j -d box"],["/outside","-d box"],
      ["dir/../outside","-d box"],[".","-d box"],["through/file","-d box"],
      ["leaf","-d box"],["file","-d box/through"],["file","-d box/through/../new"],
      ["input.zip",""],["alias.zip",""],["hard","-d box"],
    ];
    for(const [name,opts] of cases) {
      const placeholder="x".repeat(name.length);
      await ref.writeFile("/"+placeholder,Uint8Array.of(90));
      assert.equal((await js.exec("zip -0q - "+placeholder+" > fixture")).exitCode,0);
      const seed=Buffer.from(await ref.readFile("/fixture"));
      seed.write(name,30,"ascii");
      seed.write(name,seed.lastIndexOf(Buffer.from([80,75,1,2]))+46,"ascii");
      const run=async (sh,fs) => {
        const setup=await sh.exec("rm -rf box elsewhere outside input.zip alias.zip; mkdir box elsewhere; echo intact > outside; ln -s /elsewhere box/through; ln -s /outside box/leaf; ln outside box/hard");
        assert.equal(setup.exitCode,0,setup.stderr);
        await fs.writeFile("/input.zip",seed);
        assert.equal((await sh.exec("ln input.zip alias.zip")).exitCode,0);
        const result=await sh.exec("unzip -qo input.zip "+opts);
        assert.deepEqual(Buffer.from(await fs.readFile("/input.zip")),seed,name);
        const effects=await sh.exec("cat outside; ls -A elsewhere; ls -A box; cat box/hard");
        return [result.exitCode,result.stderr,effects.stdout];
      };
      const expected=await run(js,ref);
      assert.equal(expected[0],name==="hard"?0:2,name+" "+opts);
      assert.deepEqual(await run(rust,rust.fs),expected,name+" "+opts);
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("ZIP update and freshen select newer members and leave a current archive untouched",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    const run=async (sh,fs) => {
      const results=[], base=1700000000000;
      const file=async (path,byte,time) => {await fs.writeFile(path,Uint8Array.of(byte));await fs.utimes(path,time,time);};
      const zip=async args=>{const r=await sh.exec("zip "+args);results.push([r.exitCode,r.stdout,r.stderr]);};
      await file("/member",65,base);
      await zip("-q out.zip member");
      const before=await fs.readFile("/out.zip"), initial=await fs.lstat("/out.zip");
      await file("/member",66,base+999); await file("/extra",67,base);
      await zip("-u out.zip member");
      assert.deepEqual(await fs.readFile("/out.zip"),before,"equal second must not republish the archive");
      await file("/member",66,base-1000);
      await zip("-f out.zip member extra");
      assert.deepEqual(await fs.readFile("/out.zip"),before,"freshen must ignore new names");
      assert.equal((await fs.lstat("/out.zip")).revision,initial.revision);
      await file("/member",68,base+1000);
      await zip("-f out.zip");
      results.push((await sh.exec("unzip -p out.zip member")).stdout);
      await zip("-u out.zip extra"); results.push((await sh.exec("unzip -p out.zip extra")).stdout);
      await zip("-um out.zip member"); await assert.rejects(fs.lstat("/member"),{code:"ENOENT"});
      await zip("-f missing.zip extra");
      await assert.rejects(fs.lstat("/missing.zip"),{code:"ENOENT"});
      return results;
    };
    const expected=await run(js,ref); assert.equal(expected[4],"D"); assert.equal(expected[6],"C");
    assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose();await rust.dispose();}
});

test("native zip splits at record boundaries and preserves occupied volume destinations on failure", async () => {
  const {Shell, MemoryFileSystem, archiveCommands} = await import("@poe-platform/safe-bash");
  for (const [size, flags, obstacle] of [
    [157000,"-s 64k"], [25,"--split-size=64k"], [65420,"-sv -s64K"], [65491,"-s 65536"],
    [157000,"-qs=64k","hardlink"], [157000,"--split-size 64K","replace"], [157000,"-m -s 64k"],
    [157000,"-s 12k"], [157000,"-s 0"], [25,"-sp -s 64k"],
    [157000,"-m -s 64k","symlink"], [157000,"-s 64k","directory"], [157000,"-s 64k","input"],
  ]) {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/case");
    const js = new Shell({fs,cwd:"/case"}).use(archiveCommands()), rust = new RustWasmBash({cwd:"/case"});
    const run = async (sh, store) => {
      for (const [p,n] of [["/case/first",size],["/case/last",5]]) {
        await store.writeFile(p,Uint8Array.from({length:n}, (_,i) => i % 197));
        await store.utimes(p, 1700000000000, 1700000000000);
      }
      if (obstacle === "symlink") await store.symlink("last","/case/a.z02");
      else if (obstacle === "directory") await store.mkdir("/case/a.z02");
      else if (obstacle === "input") await store.writeFile("/case/a.z02", Uint8Array.of(67));
      if (obstacle === "hardlink") await store.link("/case/last", "/case/a.z02");
      if (obstacle === "replace") await store.writeFile("/case/a.z02", Uint8Array.of(22), {mode:0o751});
      const r = await sh.exec("zip -q -0 " + flags + " a.zip first last" + (obstacle === "input" ? " a.z02" : ""));
      const entries = [];
      for (const {name} of (await store.readdir("/case")).sort((a,b) => a.name.localeCompare(b.name))) {
        const st = await store.lstat("/case/"+name);
        const data = st.type === "file" ? await store.readFile("/case/"+name) : new Uint8Array();
        entries.push([name,st.type,st.mode & 0o777,data.length,Buffer.from(await crypto.subtle.digest("SHA-256",data)).toString("hex")]);
      }
      return [r.exitCode,r.stdout,r.stderr,entries];
    };
    try { assert.deepEqual(await run(rust,rust.fs),await run(js,fs),[size,flags,obstacle].join(" ")); }
    finally { await rust.dispose(); await js.dispose(); }
  }
});

test("unzip lists metadata without inflating unselected payloads and tests only selected members",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    await ref.writeFile("/bad",Uint8Array.of(66));
    await ref.writeFile("/good",new Uint8Array(4096).fill(65));
    assert.equal((await js.exec("zip -q seed.zip bad good")).exitCode,0);
    const b=Buffer.from(await ref.readFile("/seed.zip"));
    b[30+b.readUInt16LE(26)+b.readUInt16LE(28)]^=1;
    for(const fs of [ref,rust.fs]) await fs.writeFile("/split.zip",b);
    for(const args of ["-v split.zip","-l split.zip good","-Z1 split.zip","-z split.zip","-t split.zip good","-qqt split.zip good",
      "-t split.zip -x bad","-t split.zip absent","-t split.zip bad","-c split.zip good","-p split.zip good","-o split.zip good -d dest"]) {
      const cmd="unzip "+args,expected=await js.exec(cmd),actual=await rust.exec(cmd);
      assert.deepEqual([actual.exitCode,actual.stderr,actual.stdoutBytes],[expected.exitCode,expected.stderr,expected.stdoutBytes],cmd);
    }
    assert.deepEqual(await rust.fs.readFile("/dest/good"),await ref.readFile("/dest/good"));
  } finally {await js.dispose();await rust.dispose();}
});

test("unzip validates disk numbers, local headers and record coverage before extraction",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    await ref.writeFile("/item",Uint8Array.of(65));
    for(const split of [false,true]) {
      assert.equal((await js.exec("zip -q0 -fd "+(split?"-s64k ":"")+(split?"split":"plain")+".zip item")).exitCode,0);
      const seed=Buffer.from(await ref.readFile(split?"/split.zip":"/plain.zip"));
      const central=seed.indexOf(Buffer.from([80,75,1,2])), end=seed.lastIndexOf(Buffer.from([80,75,5,6]));
      const local=seed.readUInt32LE(central+42);
      for(const kind of ["valid","disk","count","local name","method","CRC","descriptor","tail gap","overlap",...(split?["marker gap"]:[])]) {
        let b=Buffer.from(seed);
        if(kind==="disk") b.writeUInt16LE(1,central+34);
        if(kind==="count") b.writeUInt16LE(0,end+8);
        if(kind==="local name") b[local+30]^=1;
        if(kind==="method") b[local+8]^=1;
        if(kind==="CRC") b.writeUInt32LE(123,local+14);
        if(kind==="descriptor") b[central-1]^=1;
        if(kind==="tail gap") {b.writeUInt32LE(central+1,end+16);b=Buffer.concat([b.subarray(0,central),Buffer.alloc(1),b.subarray(central)]);}
        if(kind==="marker gap") {b.writeUInt32LE(local+1,central+42);b.writeUInt32LE(central+1,end+16);b=Buffer.concat([b.subarray(0,local),Buffer.alloc(1),b.subarray(local)]);}
        if(kind==="overlap") {
          b.writeUInt16LE(2,end+8);b.writeUInt16LE(2,end+10);b.writeUInt32LE(2*(end-central),end+12);
          b=Buffer.concat([b.subarray(0,end),b.subarray(central,end),b.subarray(end)]);
        }
        const run=async (sh,fs) => {
          await fs.writeFile("/input.zip",b); await fs.writeFile("/item",Uint8Array.of(90));
          const r=await sh.exec("unzip -qo input.zip");
          return [r.exitCode,r.stderr,...await fs.readFile("/item")];
        };
        const expected=await run(js,ref);
        assert.deepEqual([expected[0],expected[2]],kind==="valid"?[0,65]:[2,90],kind);
        assert.deepEqual(await run(rust,rust.fs),expected,kind+" split="+split);
      }
      await ref.writeFile("/item",Uint8Array.of(65));
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("zip writes signed descriptors for selected members and keeps them whole across split volumes",async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    const run=async (sh,fs)=>{
      await fs.mkdir("/dir"); await fs.utimes("/dir",1700000000000,1700000000000);
      for(const [name,data] of [["a",Uint8Array.of(65)],["empty",new Uint8Array()],["big",new Uint8Array(65475).fill(66)]]) {
        await fs.writeFile("/"+name,data); await fs.utimes("/"+name,1700000000000,1700000000000);
      }
      const outputs=[];
      for(const [args,files] of [
        ["-q0 plain.zip a",["plain.zip"]],
        ["-qfd plain.zip empty dir",["plain.zip"]],
        ["--force-descriptors -q def.zip a",["def.zip"]],
        ["-sp -q sp.zip a",["sp.zip"]],
        ["-q0 -fd -s64k split.zip big a",["split.z01","split.zip"]],
        ["-qfd- invalid.zip a",[]],
      ]) {
        const r=await sh.exec("zip "+args);
        assert.equal(r.exitCode,files.length?0:16,r.stderr||r.stdout);
        outputs.push([r.stdout,r.stderr,...await Promise.all(files.map(f=>fs.readFile("/"+f)))]);
      }
      return outputs;
    };
    const expected=await run(js,ref);
    assert.deepEqual(await run(rust,rust.fs),expected);
  } finally {await js.dispose();await rust.dispose();}
});

test("split ZIP reserves all volumes before replacing files or removing move sources", async () => {
  const bash = new RustWasmBash({cwd:"/case", memoryFsOptions:{maxBytes:250000}});
  try {
    const original = new Uint8Array(150000);
    await bash.fs.writeFile("/case/input",original);
    await bash.fs.writeFile("/case/out.z01","keep");
    const result = await bash.exec("zip -qm0 -s64k out.zip input");
    assert.notEqual(result.exitCode,0);
    assert.deepEqual(await bash.fs.readFile("/case/input"),original);
    assert.deepEqual(await bash.fs.readFile("/case/out.z01"),new TextEncoder().encode("keep"));
    assert.deepEqual((await bash.fs.readdir("/case")).map(e=>e.name).sort(),["input","out.z01"]);
  } finally { await bash.dispose(); }
});

test("split ZIP publishes in mounted and overlay directories and opens with the JavaScript volume resolver", async () => {
  const {Shell,MemoryFileSystem,archiveCommands} = await import("@poe-platform/safe-bash");
  const input = Uint8Array.from({length:145000},(_,i)=>i%223);
  for (const profile of ["strict-budgets-mount-dev","overlay-cow-fs"]) {
    const rust = new RustWasmBash({profile,files:{"/src":input,"/dest/sub/out.z02":{content:"old",mode:0o751}}});
    const fs = new MemoryFileSystem();
    const js = new Shell({fs,cwd:"/"}).use(archiveCommands({zipHost:{volume:({disk})=>"/out.z"+String(disk+1).padStart(2,"0")}}));
    try {
      const r = await rust.exec("cd /; zip -q0 -s64k /dest/sub/out.zip src");
      assert.equal(r.exitCode,0,profile+": "+r.stderr);
      assert.equal((await rust.fs.stat("/dest/sub/out.z02")).mode & 0o777,0o751);
      for (const ext of ["z01","z02","zip"]) await fs.writeFile("/out."+ext,await rust.fs.readFile("/dest/sub/out."+ext));
      const result = await js.exec("unzip -q out.zip");
      assert.equal(result.exitCode,0,result.stderr);
      assert.deepEqual(await fs.readFile("/src"),input);
    } finally { await js.dispose(); await rust.dispose(); }
  }
});

test("Rust owned staging satisfies the shared atomic filesystem contract",async t=>{
  const {createAtomicFileSystemConformance}=await import("@poe-code/safe-fs/testing/atomic");
  for(const c of createAtomicFileSystemConformance({includeSymlinks:true,async createFixture(){
    const sh=new RustWasmBash({cwd:"/root",deviceView:"provided"});
    return {fs:sh.fs,root:"/root",dispose:()=>sh.dispose()};
  }})) await t.test(c.name,()=>c.run());
});

test("Rust owned staging rejects a replaced ancestor even when the destination parent survives",async()=>{
  const sh=new RustWasmBash({cwd:"/",directories:["/tree/leaf"]}), fs=sh.fs;
  try {
    const root=await fs.lstat("/"), leaf=await fs.lstat("/tree/leaf");
    const ancestors=[{path:"/",stat:root},{path:"/tree",stat:await fs.lstat("/tree")},{path:"/tree/leaf",stat:leaf}];
    const staging=await fs.createStagedFile("/.stage","entry",{type:"file",data:Uint8Array.of(7)},{parent:root});
    await fs.rename("/tree","/old");await fs.mkdir("/tree");await fs.rename("/old/leaf","/tree/leaf");
    await assert.rejects(fs.publishStagedFile(staging,"/tree/leaf/output",{parent:leaf,destination:null,ancestors}),{code:"EAGAIN"});
    assert.deepEqual(await fs.readdir("/tree/leaf"),[]);
    assert.deepEqual(await fs.readFile(staging.file.path),Uint8Array.of(7));
    await fs.removeStagedFile(staging);
  } finally {await sh.dispose();}
});

test("aborting plugin staging cleans only the original unchanged entries",{skip:!WebAssembly.Suspending},async()=>{
  for(const replace of [false,true]){
    const sh=new RustWasmBash({cwd:"/"}), ctrl=new AbortController(), reason=new Error("stop");
    sh.register({name:"stage",async execute({fs}){
      const stage=await fs.createStagedFile("/.stage","entry",{type:"file",data:Uint8Array.of(1)},{parent:await fs.lstat("/")});
      if(replace) await fs.writeFile(stage.file.path,Uint8Array.of(2));
      ctrl.abort(reason);
      return {exitCode:0};
    }});
    try{
      await assert.rejects(sh.exec("stage",{signal:ctrl.signal}),e=>e===reason);
      if(replace) assert.deepEqual(await sh.fs.readFile("/.stage/entry"),Uint8Array.of(2));
      else await assert.rejects(sh.fs.lstat("/.stage"),{code:"ENOENT"});
    }finally{await sh.dispose();}
  }
});

test("plugin staging validates the exact paths and command signal used for the mutation",{skip:!WebAssembly.Suspending},async()=>{
  const sh=new RustWasmBash({cwd:"/",directories:["/one/two/three"]}), fs=sh.fs;
  const ctrl=new AbortController(), reason=new Error("stop");
  const root=await fs.lstat("/");
  const make=(dir,parent)=>fs.createStagedFile(dir,"file",{type:"file",data:Uint8Array.of(1)},{parent});
  const deep=await make("/one/two/three/.stage",await fs.lstat("/one/two/three"));
  const stage=await make("/.stage",root);
  let removed=false;
  sh.register({name:"probe",async execute(ctx){
    // A receipt getter must not be validated against one name then used with another.
    const receipt=Object.fromEntries(["parent","directory","file"].map(key=>{
      let reads=0;
      return [key,{stat:deep[key].stat,get path(){return ++reads===1 ? stage[key].path : deep[key].path;}}];
    }));
    try {await ctx.fs.removeStagedFile(receipt);removed=true;} catch {}
    await ctx.fs.publishStagedFile(stage,"/out",{parent:root,get destination(){ctrl.abort(reason);return null;}});
    return {exitCode:0};
  }});
  try{
    await assert.rejects(sh.exec("probe",{signal:ctrl.signal,limits:{maxPathnameComponents:3}}),e=>e===reason);
    assert.equal(removed,false);
    assert.deepEqual(await fs.readFile(deep.file.path),Uint8Array.of(1));
    await assert.rejects(fs.lstat("/out"),{code:"ENOENT"});
  }finally{await sh.dispose();}
});

test("retained staging writers serialize appends and cleanup follows the original parent",async()=>{
  const sh=new RustWasmBash({cwd:"/",directories:["/parent"]}), fs=sh.fs;
  try{
    const parent=await fs.lstat("/parent");
    const stage=await fs.createStagedFile("/parent/.stage","f",{type:"file",data:Uint8Array.of(1)},{parent,retainCleanup:true,mode:0o400,mtimeMs:123});
    await Promise.all([stage.writer.write(Uint8Array.of(2)),stage.writer.write(Uint8Array.of(3))]);
    const before=await fs.lstat(stage.file.path), stat=await stage.writer.finish();
    assert.notEqual(stat.revision,before.revision);assert.equal(stat.mtimeMs,123);
    assert.deepEqual(await fs.readFile(stage.file.path),Uint8Array.of(1,2,3));
    await assert.rejects(stage.writer.write(Uint8Array.of(4)),{code:"EBADF"});
    await fs.rename("/parent","/moved");
    await fs.mkdir("/parent/.stage",{recursive:true});
    await fs.writeFile("/parent/.stage/f",Uint8Array.of(9));
    await stage.cleanup.remove();await stage.cleanup.remove();await stage.cleanup.close();
    assert.deepEqual(await fs.readdir("/moved"),[]);
    assert.deepEqual(await fs.readFile(stage.file.path),Uint8Array.of(9));
  }finally{await sh.dispose();}
});

test("an oversized staged filename leaves no private directory",async()=>{
  const sh=new RustWasmBash({cwd:"/"}),fs=sh.fs;
  try{
    const parent=await fs.lstat("/");
    for(const retainCleanup of [false,true]){
      await assert.rejects(fs.createStagedFile("/.stage","é".repeat(128),{type:"file",data:Uint8Array.of(1)},{parent,retainCleanup}),{code:"ENAMETOOLONG"});
      await assert.rejects(fs.lstat("/.stage"),{code:"ENOENT"});
    }
  }finally{await sh.dispose();}
});

test("unlinked retained staging bytes count against the memory budget until cleanup closes",async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const sh=new RustWasmBash({cwd:"/",memoryFsOptions:{maxBytes:8}});
  try{
    for(const fs of [new MemoryFileSystem({maxBytes:8}),sh.fs]){
      const stage=await fs.createStagedFile("/.stage","file",{type:"file",data:new Uint8Array(8)},{parent:await fs.lstat("/"),retainCleanup:true});
      await fs.unlink(stage.file.path);
      await assert.rejects(fs.writeFile("/new",Uint8Array.of(9)),{code:"ENOSPC"});
      await stage.cleanup.close();
      await fs.writeFile("/new",Uint8Array.of(9));
      assert.deepEqual(await fs.readFile("/new"),Uint8Array.of(9));
    }
  }finally{await sh.dispose();}
});

test("split ZIP plugins stage complete volumes and extract through checked ancestors",{skip:typeof WebAssembly.Suspending!=="function"},async()=>{
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const bytes=Uint8Array.from({length:145000},(_,i)=>i%223),fs=new MemoryFileSystem(),plugin=()=>archiveCommands({zipHost:{volume:({disk})=>"/out.z"+String(disk+1).padStart(2,"0")}});
  const js=new Shell({fs,cwd:"/"}).use(plugin()),rust=new RustWasmBash({cwd:"/"}).use(plugin());
  try {
    const run=async(sh,fs)=>{
      await fs.writeFile("/source",bytes);await fs.utimes("/source",1700000000000,1700000000000);
      const write=await sh.exec("zip -q0 -s64k out.zip source");assert.equal(write.exitCode,0,write.stderr);
      const unpack=await sh.exec("unzip -qo out.zip -d dest");assert.equal(unpack.exitCode,0,unpack.stderr);
      assert.deepEqual(await fs.readFile("/dest/source"),bytes);
      assert.deepEqual((await fs.readdir("/dest")).map(e=>e.name),["source"]);
      assert.ok(!(await fs.readdir("/")).some(e=>e.name.startsWith(".zip")));
      return Promise.all(["/out.zip","/out.z01","/out.z02"].map(p=>fs.readFile(p)));
    };
    assert.deepEqual(await run(rust,rust.fs),await run(js,fs));
  }finally{await js.dispose();await rust.dispose();}
});

test("Rust plugin directories support conditional creation and metadata restoration", {skip:typeof WebAssembly.Suspending!=="function"}, async () => {
  const {Shell,MemoryFileSystem,archiveCommands}=await import("@poe-platform/safe-bash");
  const ref=new MemoryFileSystem(), js=new Shell({fs:ref,cwd:"/"}).use(archiveCommands()), rust=new RustWasmBash({cwd:"/"});
  try {
    await ref.mkdir("/member",{mode:0o751});await ref.utimes("/member",1700000000000,1700000000000);
    assert.equal((await js.exec("zip -q0 -s64k input.zip member")).exitCode,0);
    await rust.fs.writeFile("/input.zip",await ref.readFile("/input.zip"));rust.use(archiveCommands());
    for(const [sh,fs] of [[js,ref],[rust,rust.fs]]) {
      const r=await sh.exec("unzip -qo input.zip -d output");
      assert.equal(r.exitCode,0,r.stderr);
      const member=await fs.lstat("/output/member"); assert.equal(member.mode&0o777,0o751);assert.equal(member.mtimeMs,1700000000000);
      const root=await fs.lstat("/");
      const dir=await fs.prepareDirectory("/new",{parent:root,expected:null,mode:0o700});
      await fs.writeFile("/new/file",Uint8Array.of(1));
      const changed=await fs.prepareDirectory("/new",{parent:root,expected:dir,atimeMs:-1.5,mtimeMs:123.5});
      assert.deepEqual([changed.mode&0o777,changed.atimeMs,changed.mtimeMs],[0o700,-1.5,123.5]);
      await assert.rejects(fs.prepareDirectory("/new",{parent:root,expected:null}),{code:"EAGAIN"});
      await fs.rm("/new",{recursive:true});await fs.mkdir("/new");
      await assert.rejects(fs.prepareDirectory("/new/child",{parent:dir,expected:null}),{code:"EAGAIN"});
      await assert.rejects(fs.prepareDirectory("/new",{parent:root,expected:dir,mode:0}),{code:"EAGAIN"});
      await assert.rejects(fs.prepareDirectory("/invalid",{parent:root,expected:null,mtimeMs:NaN}),{code:"EINVAL"});
      await assert.rejects(fs.lstat("/invalid"),{code:"ENOENT"});
    }
  } finally {await js.dispose();await rust.dispose();}
});

test("plugin stdin reports the source of the current descriptor", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const js = new Shell({fs:new MemoryFileSystem(),cwd:"/"}).use(agentCommands()), rust = new RustWasmBash({cwd:"/"});
  const probe = {name:"probe", async execute(ctx) {
    await ctx.stdout.write(new TextEncoder().encode(String(ctx.stdinIsDefault) + "\n"));
    return {exitCode:0};
  }};
  try {
    for (const sh of [js, rust]) sh.register(probe);
    for (const script of [
      "probe", "probe <&0", ": | probe; probe", "probe </dev/null; probe", "probe <&-; probe",
      "{ probe; } <<<x; probe", "f() { probe; }; f </dev/null; f", "probe 3<&0 <&3",
      "exec 3<&0; probe </dev/null; probe <&3", "exec </dev/null; probe",
      "printf hi > >(probe)", "exec 3<&0; : | probe <&3", "shopt -s lastpipe; : | { exec 0<&-; probe; }; probe",
      "exec 3<&0; exec 0</dev/null; exec 0<&3; probe", "probe 3<&0-; probe",
    ]) {
      for (const input of [undefined, "", Uint8Array.of(97), () => (async function*(){})()]) {
        const run = async sh => {
          const r = await sh.exec(script, {stdin:typeof input === "function" ? input() : input});
          return [r.exitCode,r.stdout,r.stderr];
        };
        assert.deepEqual(await run(rust), await run(js), script);
      }
    }
  } finally { await js.dispose(); await rust.dispose(); }
});

test("plugin reads and writes reject closed or incompatible descriptors on use", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const {PublicDiagnostic} = await import("safe-bash-contracts/diagnostics");
  const js = new Shell({fs:new MemoryFileSystem(),cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  const run = async (sh, redirect) => {
    const events = [];
    sh.register({name:"probe", async execute(ctx) {
      const iterator = ctx.stdin[Symbol.asyncIterator]();
      for (const op of [() => iterator.next(), () => iterator.next(), () => ctx.stdout.write(Uint8Array.of(65)), () => ctx.stderr.write(new Uint8Array())]) {
        try { events.push((await op())?.done ?? "wrote"); }
        catch (e) { events.push([e instanceof PublicDiagnostic, e.code, e.message]); }
      }
      return {exitCode:0};
    }}, {replace:true});
    const result = await sh.exec("probe " + redirect);
    return [events,result.stdout,result.stderr,result.exitCode];
  };
  try {
    for (const redirect of ["", "<&-", ">&-", "2>&-", "0>&1", "1<&0", "1</dev/null", "2<&0", "0>/out", "<>/out", "7<&0 1<&7", "2>&1"]) {
      assert.deepEqual(await run(rust, redirect), await run(js, redirect), redirect);
    }
    const write = {name:"emit", async execute(ctx) { await ctx.stdout.write(Uint8Array.of(65)); return {exitCode:0}; }};
    for (const sh of [js,rust]) sh.register(write);
    for (const redirect of [">&-", ">&- 2>&-", "2<&0 >&-"]) for (const maxOutputBytes of [0,200]) {
      const result = sh => sh.exec("emit " + redirect, {limits:{maxOutputBytes}}).then(r => [r.exitCode,r.stderr], e => e.limit ?? e.message);
      assert.deepEqual(await result(rust), await result(js), redirect);
    }
  } finally { await js.dispose(); await rust.dispose(); }
});

test("plugin command failures preserve public diagnostics and redact private errors", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const {PublicDiagnostic} = await import("safe-bash-contracts/diagnostics");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  const command = {name:"failcmd", async execute(ctx) {
    await ctx.stderr.write(Uint8Array.of(65));
    if (ctx.args[0] === "file") await ctx.fs.readFile("/missing");
    if (ctx.args[0] === "empty") throw new PublicDiagnostic("");
    if (ctx.args[0] === "public") throw new PublicDiagnostic("malformed entry", {cause:new Error("private cause")});
    throw new Error("private message");
  }};
  try {
    for (const sh of [js,rust]) sh.register(command);
    for (const kind of ["file","public","empty","private"]) {
      for (const redirect of ["","2>&1","2>/err"]) {
        const run = async (sh, store) => {
          const r = await sh.exec("true\nfailcmd " + kind + " " + redirect);
          return [r.exitCode,r.stdout,r.stderr,redirect === "2>/err" ? await store.readFile("/err") : null];
        };
        assert.deepEqual(await run(rust, rust.fs), await run(js, fs), kind + redirect);
      }
    }
  } finally { await js.dispose(); await rust.dispose(); }
});

test("plugin internal errors reach the selected hook without exposing private details", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const {PublicDiagnostic} = await import("safe-bash-contracts/diagnostics");
  const run = async create => {
    const events = [], reason = new Error("private detail");
    const hook = which => e => { events.push([which, e === reason ? "original" : e.message]); throw new Error("hook failed"); };
    const shellHook = hook("shell"), callHook = hook("call");
    const sh = create(shellHook);
    try {
      sh.register({name:"failcmd", execute(ctx) {
        events.push(ctx.onInternalError === shellHook ? "shell" : ctx.onInternalError === callHook ? "call" : "neither");
        if (ctx.args[0] === "cause") throw new PublicDiagnostic("visible", {cause:reason});
        if (ctx.args[0] === "public") throw new PublicDiagnostic("visible");
        if (ctx.args[0] === "invalid") return {exitCode:-1};
        throw reason;
      }});
      for (const arg of ["private","cause","public","invalid"]) for (const onInternalError of [undefined,callHook]) {
        const result = await sh.exec("failcmd " + arg, {onInternalError});
        events.push([result.exitCode,result.stderr]);
      }
      await assert.rejects(sh.exec("failcmd", {onInternalError:42}), {name:"TypeError",message:"onInternalError must be callable"});
      return events;
    } finally { await sh.dispose(); }
  };
  const expected = await run(onInternalError => new Shell({fs:new MemoryFileSystem(),onInternalError}));
  assert.deepEqual(await run(onInternalError => new RustWasmBash({onInternalError})), expected);
  assert.throws(() => new RustWasmBash({onInternalError:42}), {name:"TypeError",message:"onInternalError must be callable"});
});

test("plugin writes to a duplicated output descriptor retain their byte order", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem, getCommandArguments} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const js = new Shell({fs, cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  const cmd = {name:"ordered", async execute(ctx) {
    await ctx.stderr.write(Uint8Array.of(69));
    await ctx.stdout.write(getCommandArguments(ctx).bytes(0));
    await ctx.stderr.write(Uint8Array.of(70));
    return {exitCode:17};
  }};
  try {
    for (const sh of [js,rust]) sh.register(cmd);
    for (const redirects of ["2>&1", "1>&2", "> /out 2>&1", "2>/err >/out"]) {
      const script = "ordered $'\\377' " + redirects;
      const result = [];
      for (const [sh, store] of [[js, fs], [rust, rust.fs]]) {
        const r = await sh.exec(script);
        result.push([r.exitCode, r.stdoutBytes, r.stderrBytes, ...await Promise.all(
          ["/out", "/err"].map(path => store.readFile(path).catch(() => null)))]);
      }
      assert.deepEqual(result[1], result[0], redirects);
    }
  } finally { await js.dispose(); await rust.dispose(); }
});

test("aborting a plugin preserves completed redirect writes and stops the script", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  for (const reason of ["limit","cancel"]) {
    const bash = new RustWasmBash({cwd:"/"});
    const controller = new AbortController(), stopped = new Error("stop");
    bash.register({name:"emit", async execute(ctx) {
      await ctx.stdout.write(Uint8Array.of(255));
      if (reason === "cancel") controller.abort(stopped);
      await ctx.stdout.write(Uint8Array.of(0));
      return {exitCode:0};
    }});
    try {
      await assert.rejects(bash.exec("emit >/out; touch /late", {signal:controller.signal, limits:{maxOutputBytes:1}}),
        e => reason === "cancel" ? e === stopped : e.limit === "maxOutputBytes");
      assert.deepEqual([...bash.readFile("/out")], [255], reason);
      await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
    } finally { await bash.dispose(); }
  }
});

test("plugin file reads share the script's filesystem quota and obey path and size limits", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const bash = new RustWasmBash({cwd:"/", files:{"/input":Uint8Array.of(255,0)}});
  let captured, seen;
  bash.register({name:"inspect", async execute(ctx) {
    captured = ctx.fs;
    try { seen.push([...await ctx.fs.readFile(ctx.args[0], ctx.args[1] ? {maxBytes:1} : {})]); }
    catch (error) { seen.push(error.limit ?? error.code ?? error.name); }
    return {exitCode:0};
  }});
  try {
    seen = [];
    await assert.rejects(bash.exec("inspect /input; inspect /input; touch /late", {limits:{maxFileSystemOperations:1}}), {limit:"maxFileSystemOperations"});
    assert.deepEqual(seen, [[255,0],"maxFileSystemOperations"]);
    await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
    seen = [];
    await bash.exec("inspect /input short; inspect /a/b; inspect /input", {limits:{maxPathnameComponents:1}});
    assert.deepEqual(seen, ["EFBIG","ENAMETOOLONG",[255,0]]);
    await assert.rejects(captured.readFile("/input"), /finished/);
  } finally { await bash.dispose(); }
});

test("plugin filesystem capabilities allow private output and inspection of links and permissions", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  async function run(sh, fs, maxFileSystemOperations) {
    const seen = [];
    await fs.writeFile("/target",Uint8Array.of(1));
    await fs.symlink("/target","/alias");
    sh.register({name:"saveprivate",async execute({fs}) {
      const caps = fs.capabilities;
      for (const key of ["read","write","append","exclusiveCreate","stat","realpath","access"]) assert.equal(caps[key],true,key);
      seen.push(await fs.readlink("/alias"), await fs.realpath("/alias"));
      await fs.access("/target",4);
      await fs.writeFile("/private",Uint8Array.of(2),{flag:"wx",mode:0o600});
      try { await fs.writeFile("/private",Uint8Array.of(3),{flag:"wx"}); } catch (error) { seen.push(error.code); }
      await fs.chmod("/private",0o640);
      return {exitCode:0};
    }});
    try {
      const result = await sh.exec("saveprivate",{onInternalError:e=>seen.push(e.message),limits:{maxFileSystemOperations}}).then(r=>[r.exitCode,r.stderr],e=>e.limit??e.message);
      return [result,seen,await fs.stat("/private").then(s=>s.mode&0o777,()=>null)];
    } finally { await sh.dispose(); }
  }
  for (const limit of [3,5,6]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
    assert.deepEqual(await run(rust,rust.fs,limit),await run(js,fs,limit),"limit "+limit);
  }
});

test("plugin filesystem queries resolve permissions at the target, including device aliases and exclusive creation", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  async function run(sh,fs) {
    const seen = [];
    await fs.symlink("/dev/null","/alias");
    sh.register({name:"query", async execute({fs}) {
      for (const path of ["/absent","/absent/child","/dev","/dev/null","/alias","/"]) {
        for (const opts of [{},{creation:"exclusive"},{create:true},{create:false}]) {
          try {
            const c = await fs.capabilitiesFor(path,opts);
            seen.push(["read","write","exclusiveCreate","permissions","readlink","readdir"].map(key=>c[key]));
          } catch (e) { seen.push([e.code,e.syscall,e.path]); }
        }
      }
      return {exitCode:0};
    }});
    try {
      const r = await sh.exec("query");
      assert.equal(r.exitCode,0,r.stderr);
      return seen;
    } finally { await sh.dispose(); }
  }
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  assert.deepEqual(await run(rust,rust.fs),await run(js,fs));
});

test("plugin descriptors share the execution quota and retain position and file identity", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  async function run(sh,fs,limit) {
    const seen = [];
    let fd;
    sh.register({name:"editfd",async execute({fs}) {
      fd = await fs.open("/out",{access:"readwrite",creation:"exclusive"});
      seen.push((await fd.stat()).mode & 0o777);
      await fd.write(Uint8Array.of(0,255,4),null);
      seen.push(await fd.getPosition());
      const bytes = new Uint8Array(1);
      await fd.read(bytes,1);
      seen.push(bytes[0],await fd.getPosition());
      await fs.rm("/out");
      await fs.writeFile("/out",Uint8Array.of(7,8));
      await fd.truncate(1);
      seen.push((await fd.stat()).size);
      await fd.sync(true);
      return {exitCode:0};
    }});
    try {
      const r = await sh.exec("umask 077; editfd",{limits:{maxFileSystemOperations:limit}}).then(r=>[r.exitCode,r.stderr],e=>e.limit);
      const late = fd && await fd.write(Uint8Array.of(5),0).then(()=>"wrote",()=>"rejected");
      return [r,seen,late,await fs.readFile("/out").then(b=>[...b],()=>null)];
    } finally { await sh.dispose(); }
  }
  for (const limit of [0,1,3,6,9,12,20]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
    const expected = await run(js,fs,limit);
    if (limit === 20) assert.deepEqual(expected,[[0,""],[0o600,3,255,3,1],"rejected",[7,8]]);
    assert.deepEqual(await run(rust,rust.fs,limit),expected,"quota "+limit);
  }
});

test("plugin rename, symlink, and unlink validate entry paths before changing them", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  async function run(sh,fs,limit) {
    await fs.writeFile("/src",Uint8Array.of(1));
    await fs.writeFile("/dest",Uint8Array.of(2));
    const events = [];
    sh.register({name:"paths",async execute({fs}) {
      for (const call of [
        ()=>fs.rename("/src","/too/deep"),
        ()=>fs.rename("/src","/dest",{noReplace:true}),
        ()=>fs.symlink("/still/missing","/alias"),
        ()=>fs.rename("/alias","/link"),
        ()=>fs.unlink("/link"),
        ()=>fs.rename("/src","/dest"),
      ]) {
        try { await call(); events.push("ok"); }
        catch(e) { events.push(e.limit ?? e.code); }
      }
      return {exitCode:0};
    }});
    try {
      const r = await sh.exec("paths",{limits:{maxPathnameComponents:1,maxFileSystemOperations:limit}}).then(r=>[r.exitCode,r.stderr],e=>e.limit);
      const entries = await Promise.all(["src","dest","alias","link"].map(async name => {
        const p = "/"+name, st = await fs.lstat(p).catch(()=>null);
        return st?.type === "symlink" ? fs.readlink(p) : st ? [...await fs.readFile(p)] : null;
      }));
      return [r,events,entries];
    } finally { await sh.dispose(); }
  }
  for (const limit of [2,3,4,5,6]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
    const expected = await run(js,fs,limit);
    if (limit === 6) assert.deepEqual(expected,[[0,""],["ENAMETOOLONG","EEXIST","ok","ok","ok","ok"],[null,[1],null,null]]);
    assert.deepEqual(await run(rust,rust.fs,limit),expected,"quota "+limit);
  }
});

test("plugin retained reads share quotas, survive replacement, and close at command exit", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem} = await import("@poe-platform/safe-bash");
  async function run(sh,fs,limit) {
    await fs.writeFile("/a",Uint8Array.of(0,255,4));
    let handle;
    const seen = [];
    sh.register({name:"retain",async execute({fs}) {
      handle = await fs.openReadFile("/a");
      seen.push((await handle.stat()).size);
      await fs.rm("/a");
      await fs.writeFile("/a",Uint8Array.of(99));
      seen.push([...await handle.read(1,2)]);
      return {exitCode:0};
    }});
    try {
      const r = await sh.exec("retain",{limits:{maxFileSystemOperations:limit}}).then(r=>[r.exitCode,r.stderr],e=>e.limit);
      const late = handle && await handle.read(0,1).then(()=>"read",()=>"rejected");
      return [r,seen,late];
    } finally { await sh.dispose(); }
  }
  for (const limit of [0,1,2,3,4,5]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
    assert.deepEqual(await run(rust,rust.fs,limit),await run(js,fs,limit),"quota "+limit);
  }
});

test("unfinished plugin readers release unlinked storage before the next command", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const bash = new RustWasmBash({cwd:"/",memoryFsOptions:{maxBytes:100},files:{"/f":new Uint8Array(80)}});
  try {
    bash.register({name:"hold", async execute({fs}) {
      await fs.openReadFile("/f");
      await fs.rm("/f");
      return {exitCode:0};
    }});
    const r = await bash.exec("hold");
    assert.equal(r.exitCode,0,r.stderr);
    await bash.fs.writeFile("/later",new Uint8Array(90));
  } finally { await bash.dispose(); }
});

test("plugin directory creation and removal honor umask and share the execution quota", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const run = async (sh, fs, maxFileSystemOperations) => {
    let scoped;
    sh.register({name:"editdirs", async execute(ctx) {
      scoped = ctx.fs;
      await scoped.mkdir("/a/b",{recursive:true});
      await scoped.mkdir("/keep", {mode:0o751});
      await scoped.rm("/absent", {force:true});
      await scoped.rm("/a/b", {recursive:true});
      return {exitCode:0};
    }});
    try {
      const outcome = await sh.exec("umask 073; editdirs", {limits:{maxFileSystemOperations}}).then(
        r => [r.exitCode,r.stderr], e => e.limit ?? e.message);
      const modes = await Promise.all(["/a","/a/b","/keep"].map(p => fs.stat(p).then(s => s.mode & 0o777, () => null)));
      const late = await Promise.resolve().then(() => scoped.rm("/keep")).then(() => "removed", () => "rejected");
      return [outcome,modes,late];
    } finally { await sh.dispose(); }
  };
  for (const operations of [0,1,2,3,4,5]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
    assert.deepEqual(await run(rust,rust.fs,operations), await run(js,fs,operations), "quota " + operations);
  }
});

test("plugin writes share quotas, apply umask on creation, and stop after the handler", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  try {
    for (const [sh,store] of [[js,fs],[rust,rust.fs]]) {
      let saved;
      sh.register({name:"save", async execute(ctx) {
        saved = ctx.fs;
        await ctx.fs.writeFile(ctx.args[0], Uint8Array.of(255), {flag:"wx"});
        await ctx.fs.appendFile(ctx.args[0], Uint8Array.of(0));
        return {exitCode:0};
      }});
      const script = "umask 077; save /out";
      const r = await sh.exec(script, {limits:{maxOutputBytes:0}});
      assert.deepEqual([r.exitCode,r.stderr], [0,""]);
      assert.deepEqual([...await store.readFile("/out")], [255,0]);
      assert.equal((await store.stat("/out")).mode & 0o777, 0o600);
      await assert.rejects(sh.exec("save /partial; touch /late", {limits:{maxFileSystemOperations:1}}), {limit:"maxFileSystemOperations"});
      assert.deepEqual([...await store.readFile("/partial")], [255]);
      await assert.rejects(store.stat("/late"), {code:"ENOENT"});
      if (sh === rust) {
        await assert.rejects(saved.writeFile("/late", Uint8Array.of(1)), /finished/);
        await assert.rejects(store.stat("/late"), {code:"ENOENT"});
      }
    }
  } finally { await js.dispose(); await rust.dispose(); }
});

test("native readlink resolves parent components and charges before filtering link errors", async () => {
  const {Shell, MemoryFileSystem, readlinkCommands} = await import("@poe-platform/safe-bash");
  for (const deviceView of ["default","provided"]) {
    const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/",deviceView}).use(readlinkCommands()), rust = new RustWasmBash({cwd:"/",deviceView});
    try {
      for (const store of [fs,rust.fs]) {
        await store.mkdir("/t/sub", {recursive:true});
        await store.mkdir("/locked");
        await store.chmod("/locked", 0);
      }
      const compare = async (script, limits) => {
        const run = sh => sh.exec(script, {limits}).then(r => [r.exitCode,r.stdout,r.stderr], e => e.limit ?? e.message);
        assert.deepEqual(await run(rust), await run(js), deviceView + ": " + script);
      };
      await compare("readlink /locked/f");
      await compare("readlink /locked/ENOENT");
      await compare("readlink -v /t/.. /missing/.. /missing");
      for (const store of [fs,rust.fs]) {
        await store.symlink("loop", "/loop");
        await store.writeFile("/t/file", Uint8Array.of(1));
        await store.symlink("file", "/t/link");
        await store.symlink("/t/sub", "/s");
      }
      for (const [script, limits] of [
        ["readlink /loop/sub"], ["readlink /s/../link"], ["readlink -v /missing/../t/link"], ["readlink /t/file/../link"],
        ["readlink /t/link/"], ["readlink /locked/f"], ["readlink -q /locked/f"], ["readlink -v '' /t/file"],
        ["readlink /t/link", {maxPathnameComponents:1}], ["readlink /t/link", {maxFileSystemOperations:1}],
        ["readlink /t/link", {maxFileSystemOperations:2}],
      ]) {
        await compare(script, limits);
      }
    } finally { await js.dispose(); rust.dispose(); }
  }
});

test("native du exclusions match UTF-16 units and literal extended-glob syntax", async () => {
  const {Shell, MemoryFileSystem, duCommands} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}).use(duCommands()), rust = new RustWasmBash({cwd:"/"});
  try {
    for (const store of [fs,rust.fs]) {
      await store.mkdir("/sample");
      for (const n of ["𐀀", "x", "5", "[]", "*", "@(x|5)", "a-b"]) await store.writeFile("/sample/"+n, Uint8Array.of(1));
    }
    for (const pat of ["?", "??", "[!5]", "[*]", "@(x|5)", "[[:digit:]]", "sample/?", "a\\-b"]) {
      const cmd = "du -abc --exclude='" + pat + "' /sample";
      const expected = await js.exec(cmd), got = await rust.exec(cmd);
      assert.deepEqual([got.exitCode,got.stdout,got.stderr], [expected.exitCode,expected.stdout,expected.stderr], pat);
    }
  } finally { await js.dispose(); rust.dispose(); }
});

test("native du validates a whole directory before reporting sorted children", async () => {
  const {Shell, MemoryFileSystem, duCommands} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}).use(duCommands()), rust = new RustWasmBash({cwd:"/"});
  try {
    for (const store of [fs,rust.fs]) {
      for (const path of ["/order","/invalid","/denied"]) await store.mkdir(path);
      for (const path of ["/order/𐀀","/order/\ue000","/invalid/a","/invalid/z\\x"]) await store.writeFile(path, Uint8Array.of(1));
      await store.chmod("/denied", 0o100);
    }
    for (const operand of ["/order//","/invalid","/denied//"]) {
      const script = "du -abc " + operand;
      const expected = await js.exec(script), actual = await rust.exec(script);
      assert.deepEqual([actual.exitCode,actual.stdout,actual.stderr], [expected.exitCode,expected.stdout,expected.stderr], operand);
    }
  } finally { await js.dispose(); rust.dispose(); }
});

test("the du plugin walks directories and follows symlinks through scoped Wasm metadata", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem, createDuCommand} = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({fs,cwd:"/"}), rust = new RustWasmBash({cwd:"/"});
  try {
    for (const [sh,store] of [[js,fs],[rust,rust.fs]]) {
      await store.mkdir("/dir");
      await store.writeFile("/dir/data", Uint8Array.of(1,2,3));
      await store.symlink("/dir", "/link");
      const du = createDuCommand();
      sh.register({...du, name:"inspect-du"});
    }
    for (const flags of ["-ab","-Lab"]) {
      const script = "inspect-du " + flags + " /link";
      const expected = await js.exec(script), got = await rust.exec(script);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.deepEqual([got.exitCode,got.stdout,got.stderr], [expected.exitCode,expected.stdout,expected.stderr]);
    }
    for (const sh of [js,rust]) {
      await assert.rejects(sh.exec("inspect-du -Lab /link; : >/late", {limits:{maxFileSystemOperations:1}}), {limit:"maxFileSystemOperations"});
    }
    await assert.rejects(rust.fs.stat("/late"), {code:"ENOENT"});
  } finally { await js.dispose(); await rust.dispose(); }
});

test("document plugin cleanup drains before the next command and preserves failures", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell, MemoryFileSystem} = await import("@poe-platform/safe-bash");
  const {docxCommands} = await import("@poe-platform/safe-bash/commands/docx");
  for (const native of [false, true]) {
    const fs = new MemoryFileSystem();
    const sh = native ? new RustWasmBash({cwd:"/"}) : new Shell({fs,cwd:"/"});
    const store = native ? sh.fs : fs, trace = [];
    const failures = [new Error("first"), new Error("second")];
    sh.use(docxCommands({engine:{async execute(req) {
      const count = Number(new TextDecoder().decode(req.args[0]));
      trace.push("run");
      for (let i = 0; i < 2; i++) req.registerCleanup(async () => {
        await Promise.resolve();
        trace.push(i);
        await req.stdout.write(i === 0 ? Uint8Array.of(65) : new Uint8Array());
        if (i < count) throw failures[i];
      });
      await req.stdout.write(Uint8Array.of(255));
      return {exitCode:17};
    }}}));
    try {
      const r = await sh.exec("docx 0; docx 0");
      assert.deepEqual([r.exitCode, ...r.stdoutBytes], [17,255,65,255,65]);
      assert.deepEqual(trace, ["run",0,1,"run",0,1]);
      for (const count of [1,2]) {
        await assert.rejects(sh.exec("docx " + count + " >/out; : >/late"), error =>
          count === 1 ? error === failures[0] : error instanceof AggregateError && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
        assert.deepEqual([...await store.readFile("/out")], [255,65]);
        await assert.rejects(store.stat("/late"), {code:"ENOENT"});
      }
    } finally { await sh.dispose(); }
  }
});

test("disposing a plugin shell cancels suspended handlers and attempts every plugin cleanup", {skip: typeof WebAssembly.Suspending !== "function"}, async () => {
  const bash = new RustWasmBash();
  const trace = [], failure = new Error("cleanup failed");
  let enter, signal, write;
  const started = new Promise(resolve => { enter = resolve; });
  bash.use({setup() {}, dispose() { trace.push("first"); }});
  bash.use({setup({commands}) {
    commands.register({name:"hold", execute(ctx) {
      signal = ctx.signal;
      write = () => ctx.stdout.write(Uint8Array.of(65));
      enter();
      return new Promise(() => {});
    }});
  }, dispose() { trace.push("second"); throw failure; }});
  const pending = bash.exec("hold; touch /late");
  await started;
  const cleanup = bash.dispose();
  try {
    assert.equal(signal.aborted, true);
    await assert.rejects(pending, e => e === signal.reason);
    await assert.rejects(write(), e => e === signal.reason);
    await assert.rejects(cleanup, e => e instanceof AggregateError && e.errors[0] === failure);
    assert.deepEqual(trace, ["second","first"]);
    assert.equal(bash.dispose(), cleanup);
  } finally { await cleanup.catch(() => {}); }
});

test("a cancelled execution does not wait for unfinished plugin setup", async () => {
  const bash = new RustWasmBash(), controller = new AbortController();
  let resume;
  const held = new Promise(resolve => { resume = resolve; });
  bash.use({setup: () => held});
  const outcome = bash.exec("touch /late", {signal:controller.signal}).catch(e => e);
  const reason = new Error("cancel during setup");
  controller.abort(reason);
  try {
    assert.equal(await Promise.race([outcome, new Promise(resolve => setImmediate(resolve))]), reason);
    await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
  } finally { resume(); await outcome; await bash.dispose(); }
});

test("disposal waits for queued plugin setup before releasing the shell", async () => {
  const bash = new RustWasmBash();
  const trace = [];
  bash.use({async setup(host) {
    await Promise.resolve();
    host.registerFileSystem("custom", () => bash.fs);
    trace.push("setup");
  }, dispose() { trace.push("disposed"); }});
  const cleanup = bash.dispose();
  await assert.rejects(bash.exec("true"), /disposed/);
  await cleanup;
  assert.deepEqual(trace, ["setup","disposed"]);
});

test("standalone plugin invocation preserves literal bytes, recursive state, environment and output budgets", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const {Shell,MemoryFileSystem,getCommandArguments} = await import("@poe-platform/safe-bash");
  const js = new Shell({fs:new MemoryFileSystem(),cwd:"/",env:{HOME:"/original"}}), rust = new RustWasmBash({cwd:"/",env:{HOME:"/original"}});
  for (const sh of [js,rust]) {
    sh.register({name:"emit",async execute(c) {
      await c.stdout.write(getCommandArguments(c).bytes(0));
      if (c.argv0) await c.stderr.write(Buffer.from([c.argv0,c.cwd,c.env.X,c.env.HOME].join(":")));
      return {exitCode:17};
    }});
    sh.register({name:"delegate", async execute(c) {
      if (c.args[0] === "again") return c.invoke("delegate",c.args.slice(1));
      const carrier = getCommandArguments(c).slice(1);
      return c.invoke("emit",carrier.args,{argumentValues:carrier,externalInvocation:true,replaceEnv:true,env:{X:"chosen"},
        ...(c.args[0] === "metadata" && {argv0:"child",cwd:"sub"}),
        ...(c.args[0] === "custom" && {stdout:{write:bytes=>c.stdout.write(bytes)}}),
        ...(c.args[0] === "reenter" && {stdout:{write:()=>c.invoke("emit",["nested"],{externalInvocation:true})}})});
    }});
  }
  const run = async (sh,src,limit) => {
    try {const r = await sh.exec(src,{limits:{maxOutputBytes:limit}});return [r.exitCode,[...r.stdoutBytes],r.stderr];}
    catch(e){return e.limit ?? e.message;}
  };
  try {
    for (const [src,limit] of [
      ["emit() { :; }; delegate metadata $'\\377'",1000], ["delegate again plain '$(touch /bad);*'",100],
      ["delegate reenter abc",100], ["delegate plain abc",3], ["delegate custom abc",3], ["delegate custom abc",6], ["delegate again plain abc",3],
    ]) assert.deepEqual(await run(rust,src,Number(limit)),await run(js,src,Number(limit)),src);
  } finally { await rust.dispose(); await js.dispose(); }
});

test("nested plugin input limits and cancellation stop child effects and release suspended callbacks", {skip:typeof WebAssembly.Suspending !== "function"}, async () => {
  const shell = new RustWasmBash();
  const started = Promise.withResolvers(), controller = new AbortController();
  shell.register({name:"wait_child",async execute(c) {
    started.resolve();
    await new Promise(resolve=>c.signal.addEventListener("abort",resolve,{once:true}));
    await c.fs.writeFile("/late",Uint8Array.of(42));
    return {exitCode:0};
  }});
  shell.register({name:"call_child",execute:c=>c.invoke("wait_child",[])});
  shell.register({name:"too_much",async execute(c) {
    try { await c.invoke("touch",["/late"],{stdin:[Uint8Array.of(1,2,3)]}); } catch {}
    try { await c.fs.writeFile("/late",Uint8Array.of(4)); } catch {}
    return {exitCode:0};
  }});
  try {
    await assert.rejects(shell.exec("too_much",{limits:{maxInputBytes:2}}),{limit:"maxInputBytes"});
    const running = shell.exec("call_child",{signal:controller.signal});
    await started.promise; controller.abort(false);
    await assert.rejects(running,e=>e===false);
    await assert.rejects(shell.fs.stat("/late"),{code:"ENOENT"});
    assert.equal((await shell.exec("echo ok")).stdout,"ok\n");
  } finally { await shell.dispose(); }
});

test("Wasm host commands can yield a literal child call and resume with binary output and status", async () => {
  const bash = new RustWasmBash({cwd:"/"}), x = bash.exports;
  const table = x.__indirect_function_table, slot = table.grow(1);
  const adapter = new WebAssembly.Module(Uint8Array.of(
    0,97,115,109,1,0,0,0, 1,8,1,96,3,127,127,127,1,127,
    2,9,1,0,4,110,101,120,116,0,0, 7,8,1,4,110,101,120,116,0,0,
  ));
  const word = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const field = v => { const b = Buffer.from(v); return Buffer.concat([word(b.length),b]); };
  const request = Buffer.concat([word(0),word(2),word(0),field("printf"),field("%s"),field([255,36,40,41]),field([])]);
  let calls = 0, received;
  table.set(slot,new WebAssembly.Instance(adapter,{"":{next(_ptr,_len,reply) {
    const header = new DataView(x.memory.buffer);
    if (calls++ === 0) {
      const p = bash._allocBytes(request), view = new DataView(x.memory.buffer);
      view.setUint32(reply+44,p.ptr,true); view.setUint32(reply+48,p.len,true);
      return -7;
    }
    const status = header.getInt32(reply+72,true);
    const ptr = header.getUint32(reply+64,true), len = header.getUint32(reply+68,true);
    received = [status,Buffer.from(new Uint8Array(x.memory.buffer,ptr,len))];
    return 19;
  }}}).exports.next);
  const name = bash._allocBytes(Buffer.from("requestchild"));
  try {
    assert.equal(x.safe_bash_register_command(bash.sessionId,name.ptr,name.len,slot),0);
    const result = await bash.exec("requestchild");
    assert.equal(result.exitCode,19,result.stderr);
    assert.deepEqual(received,[0,Buffer.concat([word(0),field([255,36,40,41]),field([])])]);
    calls = 0;
    await assert.rejects(bash.exec("requestchild; touch /late",{limits:{maxCommands:1}}),{limit:"maxCommands"});
    assert.equal(received[0],-2);
    await assert.rejects(bash.fs.stat("/late"),{code:"ENOENT"});
  } finally { bash._freeBytes(name); table.set(slot,null); await bash.dispose(); }
});

test("Wasm host commands inherit exported bindings and preserve bytes in native pipelines", async () => {
  const bash = new RustWasmBash({cwd:"/", env:{BASE:"initial"}});
  const x = bash.exports, table = x.__indirect_function_table, slot = table.grow(1);
  const adapter = new WebAssembly.Module(Uint8Array.of(
    0,97,115,109,1,0,0,0, 1,8,1,96,3,127,127,127,1,127,
    2,9,1,0,4,110,101,120,116,0,0, 7,8,1,4,110,101,120,116,0,0,
  ));
  const decoder = new TextDecoder(), seen = [];
  table.set(slot, new WebAssembly.Instance(adapter, {"":{next(ptr, len, reply) {
    const end = ptr + len, view = new DataView(x.memory.buffer);
    const word = () => { const n = view.getUint32(ptr, true); ptr += 4; return n; };
    const bytes = () => { const n = word(), b = new Uint8Array(x.memory.buffer, ptr, n).slice(); ptr += n; return b; };
    const argc = word(), envc = word(), hasArgv0 = word(), cwd = decoder.decode(bytes());
    const argv0 = hasArgv0 ? decoder.decode(bytes()) : undefined;
    const args = Array.from({length:argc}, () => [...bytes()]);
    const env = Object.fromEntries(Array.from({length:envc}, () => [decoder.decode(bytes()),decoder.decode(bytes())]));
    const input = new Uint8Array(x.memory.buffer, ptr, end - ptr).slice();
    seen.push({cwd, argv0, args, env, input:[...input]});
    const consumed = args[0]?.[0] === 49 ? Math.min(1, input.length) : input.length;
    new DataView(x.memory.buffer).setUint32(reply + 16, argv0 === "bad-count" ? input.length + 1 : consumed, true);
    for (const [index, out] of [input, Uint8Array.of(254)].entries()) {
      const p = out.length ? x.safe_bash_alloc(out.length) : 0;
      new Uint8Array(x.memory.buffer,p,out.length).set(out);
      const v = new DataView(x.memory.buffer);
      v.setUint32(reply + index * 8, p, true);
      v.setUint32(reply + index * 8 + 4, out.length, true);
    }
    return argv0 === "bad-status" ? 256 : argv0 === "internal" ? -4 : 23;
  }}}).exports.next);
  const name = bash._allocBytes(new TextEncoder().encode("probe"));
  try {
    assert.equal(x.safe_bash_register_command(bash.sessionId, name.ptr, name.len, slot), 0);
    const result = await bash.exec("LOCAL=private; export PUB=public; TMP=once /bin/probe $'\\377' < /data > /out", {});
    // A failed redirect must not call the host.
    assert.notEqual(result.exitCode, 0);
    assert.equal(seen.length, 0);
    bash.writeFile("/data", Uint8Array.of(0,255,65));
    const r = await bash.exec("LOCAL=private; export PUB=public; TMP=once /bin/probe $'\\377' </data >/out");
    assert.equal(r.exitCode, 23);
    assert.deepEqual([...r.stderrBytes], [254]);
    assert.deepEqual([...bash.readFile("/out")], [0,255,65]);
    assert.deepEqual(seen, [{cwd:"/", argv0:"/bin/probe", args:[[255]], env:{BASE:"initial",PWD:"/",PUB:"public",TMP:"once"}, input:[0,255,65]}]);
    const piped = await bash.exec("printf ok | probe | cat");
    assert.equal(piped.stdout, "ok");
    assert.equal(seen.at(-1).argv0, undefined);
    const alias = await bash.exec("exec -a '' probe");
    assert.equal(alias.exitCode, 23);
    assert.equal(seen.at(-1).argv0, "");
    await assert.rejects(bash.exec("probe </data; touch /late", {limits:{maxOutputBytes:2}}), {limit:"maxOutputBytes"});
    await assert.rejects(bash.fs.stat("/late"), {code:"ENOENT"});
    const shared = await bash.exec("{ probe >/dev/null; cat; } </data");
    assert.deepEqual([...shared.stdoutBytes], []);
    bash.writeFile("/multibyte", Uint8Array.of(0xc3,0xa9,0xff));
    const split = await bash.exec("exec 3</multibyte; probe 1 <&3 >/dev/null; cat <&3");
    assert.deepEqual([...split.stdoutBytes], [0xa9,0xff]);
    const internal = await bash.exec("true\nexec -a internal probe");
    assert.deepEqual([...internal.stderrBytes], [254,...new TextEncoder().encode("shell: line 2: internal error\n")]);
    const invalidRead = await bash.exec("exec -a bad-count probe");
    assert.equal(invalidRead.exitCode, 1);
    assert.match(invalidRead.stderr, /consumed more than its stdin/);
    const invalid = await bash.exec("exec -a bad-status probe");
    assert.equal(invalid.exitCode, 1);
    assert.match(invalid.stderr, /Exit status must be an integer between 0 and 255/);
  } finally { bash._freeBytes(name); bash.dispose(); }
});

test("Wasm host stdin pulls after earlier writes, preserves chunks and shares fd offsets", () => {
  const bash = new RustWasmBash();
  const x = bash.exports, root = bash.sessionId;
  // (import "" "next" (func (param i32 i32 i32) (result i32))) (export "next" (func 0))
  // Re-exporting the import gives a JS callback the required Wasm function-table type.
  const adapter = new WebAssembly.Module(Uint8Array.of(
    0,97,115,109,1,0,0,0, 1,8,1,96,3,127,127,127,1,127,
    2,9,1,0,4,110,101,120,116,0,0, 7,8,1,4,110,101,120,116,0,0,
  ));
  const table = x.__indirect_function_table;
  try {
    const slot = table.grow(1);
    for (const [source, chunks, expected, pulls, stderr = "", code = 0] of [
      ["echo ok", [], [111,107,10], 0],
      ["echo ready > /flag; { head -c1 <&3; head -c1; } 3<&0", [[255,0,1]], [255,0], 1],
      ["cat; cat", [[], [97]], [97], 3],
      ["cat; cat", [[255], new Error("producer failed"), [98]], [255], 2, "cat: producer failed\n"],
      ["echo before >/started; mapfile lines; echo late >/after", [null], [], 1, "Execution aborted: cancelled", -124],
    ]) {
      const id = x.safe_bash_fork_session(root);
      let count = 0, seenId, observed;
      table.set(slot, new WebAssembly.Instance(adapter, { "": { next(session, data, len) {
        seenId = session;
        if (source.includes("/flag")) observed = bash.execSync("cat /flag").stdout;
        const chunk = chunks[count++];
        if (chunk === undefined) return 0;
        if (chunk === null) return -2;
        const bytes = chunk instanceof Error ? new TextEncoder().encode(chunk.message) : chunk;
        const p = x.safe_bash_alloc(bytes.length);
        new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
        const view = new DataView(x.memory.buffer);
        view.setUint32(data, p, true);
        view.setUint32(len, bytes.length, true);
        return chunk instanceof Error ? -1 : 1;
      } } }).exports.next);
      const script = bash._allocBytes(new TextEncoder().encode(source));
      try {
        assert.equal(x.safe_bash_exec_stream(id, script.ptr, script.len, slot), code);
        const p = x.safe_bash_output_ptr(id);
        const len = new DataView(x.memory.buffer).getUint32(p + 4, true);
        assert.deepEqual([...new Uint8Array(x.memory.buffer, p + 16, len)], expected);
        const errorLen = new DataView(x.memory.buffer).getUint32(p + 8, true);
        assert.equal(new TextDecoder().decode(new Uint8Array(x.memory.buffer, p + 16 + len, errorLen)), stderr);
        assert.equal(count, pulls);
        if (pulls) assert.equal(seenId, id);
        if (code === -124) {
          assert.equal(bash.execSync("cat /started").stdout, "before\n");
          assert.equal(bash.execSync("test -e /after").exitCode, 1);
          assert.equal(bash.execSync("echo still runnable").stdout, "still runnable\n");
        }
        if (source.includes("/flag")) assert.equal(observed, "ready\n");
      } finally { bash._freeBytes(script); x.safe_bash_destroy_session(id); }
    }
  } finally { bash.dispose(); }
});

test("repeated Wasm executions reuse input and script allocations on success and limit errors", () => {
  const bash = new RustWasmBash(), stdin = new Uint8Array(128 * 1024);
  const script = ": #" + "a".repeat(stdin.length);
  try {
    for (const limited of [false, true]) {
      if (limited) bash.setLimits({ maxSourceBytes: 1 });
      let warm;
      for (let i = 0; i < 10; i++) {
        if (limited) assert.throws(() => bash.execSync(script, stdin), /maxSourceBytes/);
        else assert.equal(bash.execSync(script, stdin).exitCode, 0);
        if (i === 2) warm = bash.exports.memory.buffer.byteLength;
      }
      assert.equal(bash.exports.memory.buffer.byteLength, warm);
    }
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

test("jq pulls stdin only for selected operands and stops after the last requested value", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash({files:{"/f":"42\n"}});
  try {
    for (const [args, code, pulls, stdout] of [
      ["--version",0,0,"jq-1.7.1\n"], ["-n 123",0,0,"123\n"], [". /f",0,0,"42\n"],
      ["badfilter",3,0,""], ["-n 'first(inputs)'",0,1,"1\n"], ["-n 'limit(2;inputs)'",0,2,"1\n2\n"],
      ["-Rn 'first(inputs)'",0,1,'"1"\n'],
    ]) {
      let seen = 0;
      const stdin = {async *[Symbol.asyncIterator]() { for (const s of ["1\n","2\n","3\n"]) { seen++; yield Buffer.from(s); } }};
      const r = await sh.exec("jq " + args, {stdin});
      assert.deepEqual([r.exitCode,seen,r.stdout], [code,pulls,stdout], args);
    }
    const stdin = {async *[Symbol.asyncIterator]() { yield Uint8Array.of(0xc3); yield Uint8Array.of(0xa9,10,120); }};
    const r = await sh.exec("jq -Rr . - /f -", {stdin});
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"é\nx42\n",""]);
  } finally { sh.dispose(); }
});

test("jq publishes values and ready diagnostics before the next producer pull", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    for (const [args,chunks,limit,seen,final] of [
      ["-R .", ["abc\n","def\n","ghi\n"], 6, ["",'"abc"\n'], '"abc"\n'],
      ["-n inputs", ["1 ","2 ","3 "], 100, ["","1\n","1\n2\n"], "1\n2\n3\n"],
      ["'if .==2 then error else . end'", ["1\n","2\n","3\n"], 128,
        ["","1\n","1\njq: error (at <stdin>:2): 2\n"], "1\njq: error (at <stdin>:2): 2\n3\n"],
      ["--seq -c .", ["\x1ebad\n","\x1e2\n"], 128,
        ["","jq: ignoring parse error: Invalid numeric literal at line 2, column 0 (need RS to resync)\n"],
        "jq: ignoring parse error: Invalid numeric literal at line 2, column 0 (need RS to resync)\n\x1e2\n"],
    ]) {
      const observed = [];
      const stdin = {async *[Symbol.asyncIterator]() { for (const s of chunks) { observed.push(sh.readText("/out")); yield Buffer.from(s); } }};
      const run = sh.exec("jq " + args + " >/out 2>&1", {stdin,limits:{maxOutputBytes:limit}});
      if (limit === 6) await assert.rejects(run,{limit:"maxOutputBytes"});
      else assert.equal((await run).exitCode,0,args);
      assert.deepEqual([observed,sh.readText("/out")],[seen,final],args);
    }
  } finally { sh.dispose(); }
});

test("jq retains published bytes but reports a failed stdin producer at the shell line", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    for (const filter of [".", "-n 'try inputs catch 99'", "'if .==2 then error else . end'"]) {
      const stdin = {async *[Symbol.asyncIterator]() { yield Buffer.from("1 "); yield Buffer.from("2 "); throw Error("private message"); }};
      const r = await sh.exec("\n\njq " + filter, {stdin});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [1, filter.startsWith("'if") ? "1\n" : "1\n2\n", "shell: line 3: internal error\n"], filter);
    }
    const broken = {async *[Symbol.asyncIterator]() { throw Error("private"); }};
    const redirected = await sh.exec("\njq . 2>/err; cat /err", {stdin: broken});
    assert.deepEqual([redirected.exitCode,redirected.stdout,redirected.stderr],[0,"shell: line 2: internal error\n",""]);
    for (const [args, stderr] of [["-n 1 1>&-", "shell: line 2: Bad file descriptor\n"], ["--version 1>&-", "shell: line 2: Bad file descriptor\n"], ["--bad 2>&-", ""]]) {
      const r = await sh.exec("\njq " + args);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[1,"",stderr], args);
    }
  } finally { sh.dispose(); }
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

test("jq escapes control characters and truncates command errors before writing diagnostics", async () => {
  const sh = new RustWasmBash({ cwd: "/" });
  try {
    const path = "/a\x1bb";
    for (const args of ["-f", ".", "-R .", "-n 'first(inputs)'", "--rawfile v", "--slurpfile v"]) {
      const r = await sh.exec(`jq ${args} '${path}'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, "", "jq: ENOENT: no such file or directory, readStream '/a\\033b'\n"], args);
    }
    const name = "x".repeat(999 - "unsupported option --bad".length) + "🚀" + "y".repeat(30);
    for (const [script, code, message] of [
      ["jq -n 'nope #\x1b'", 3, "error: nope/0 is not defined at <top-level>, line 1:\nnope #\\033\njq: 1 compile error"],
      ["jq --argjson 'a\rb' nope -n .", 2, "invalid JSON for --argjson a\\rb"],
      [`jq --bad${name}`, 2, ("unsupported option --bad" + name).slice(0, 1000).toWellFormed()],
    ]) {
      const r = await sh.exec(script);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, "", "jq: " + message + "\n"]);
    }
  } finally { sh.dispose(); }
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

test("jq reads each module as a program file and only skips missing candidates", async () => {
  const sh = new RustWasmBash({ files: { "/lib/m.jq": "def value: 12;", "/lib/bad.jq": Uint8Array.of(255) } });
  try {
    await sh.fs.mkdir("/lib/dir.jq");
    const script = name => `jq -L/lib -nc 'include "${name}"; value'`;
    for (const [name, expected] of [
      ["m", [0, "12\n", ""]],
      ["bad", [3, "", "jq: program file is not valid UTF-8\n"]],
      ["dir", [2, "", "jq: EISDIR: illegal operation on a directory, readStream '/lib/dir.jq'\n"]],
      ["missing", [3, "", "jq: module not found: missing\n"]],
    ]) {
      await assert.rejects(sh.exec(script(name), { limits: { maxFileSystemOperations: 1 } }), /maxFileSystemOperations/);
      const r = await sh.exec(script(name), { limits: { maxFileSystemOperations: 2 } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], expected, name);
    }
  } finally { sh.dispose(); }
});

test("jq resolves literal and escaped Unicode module names to the same file", async () => {
  const sh = new RustWasmBash({ files: {
    "/lib/a\ue080.jq": "def value: 42;",
    "/lib/a�.jq": "def value: 99;",
  } });
  try {
    for (const name of ["a\ue080", String.raw`a\ue080`, "a�"]) {
      const r = await sh.exec(`jq -L/lib -nc 'include "${name}"; value'`);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, name === "a�" ? "99\n" : "42\n", ""]);
    }
  } finally { sh.dispose(); }
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

test("symbolic links check protected device paths before link text, including dot aliases", async () => {
  const bash = new RustWasmBash({ directories: ["/dir"] });
  try {
    for (const [target, dest, code, syscall, path] of [
      ["", "/dir/..", "EBUSY", undefined, "/dir/.."],
      ["bad\0text", "/dev/null", "EBUSY", undefined, "/dev/null"],
      ["", "/dev/null/..", "ENOTDIR", undefined, "/dev/null/.."],
      ["", "bad\0name", "EINVAL", "resolve", undefined],
      ["text", "/dev/../new", "ENOENT", "symlink", "/dev/../new"],
      ["", "/missing/new", "ENOENT", "symlink", ""],
    ]) {
      await assert.rejects(bash.fs.symlink(target, dest), error => {
        assert.deepEqual([error.code, error.syscall, error.path], [code, syscall, path]);
        return true;
      });
    }
    await assert.rejects(bash.fs.lstat("/new"), { code: "ENOENT" });
  } finally { bash.dispose(); }
});

test("an empty overlay link target reports the original destination before traversal", async () => {
  const bash = new RustWasmBash({ profile: "overlay-cow-fs", directories: ["/dir"] });
  try {
    for (const path of ["/dir/../link", "/dir/", "bad\0name"]) {
      await assert.rejects(bash.fs.symlink("", path), {code: "ENOENT", syscall: "overlay", path});
    }
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
    await fs.symlink("a", "/dir/link");
    await assert.rejects(fs.rename("/dir", "/target", { noReplace: true }), { code: "EEXIST" });
    await fs.rename("/dir", "/target");
    assert.equal(bash.readText("/target/a"), "upper");
    assert.equal(bash.readText("/target/nested/b"), "child");
    assert.equal(await fs.readlink("/target/link"), "a");
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

test("mkdir checks routed creation capabilities before publishing a missing directory", async () => {
  for (const [profile, args, error, absent] of [
    ["overlay-cow-fs", "/alias/../out", "ENOENT: no such file or directory, realpath '/alias/../out'", "/dir/out"],
    ["overlay-cow-fs", "-p /alias/new", "ENOTSUP: recursive creation through symlinks cannot be verified before mutation, overlay '/alias/new'", "/dir/child/new"],
    ["overlay-cow-fs", "-p /cycle/x", "ELOOP: too many symbolic links encountered, overlay '/cycle/x'", "/x"],
    ["strict-budgets-mount-dev", "-p /new//child", "EISDIR: illegal operation on a directory, capabilitiesFor '/new/'", "/new"],
  ]) {
    const bash = new RustWasmBash({profile, deviceView:"provided", directories:["/dir/child"], symlinks:{"/alias":"/dir/child","/cycle":"/cycle"}});
    try {
      const result = await bash.exec("mkdir " + args);
      assert.deepEqual([result.exitCode, result.stderr], [1, "mkdir: " + error + "\n"]);
      await assert.rejects(bash.fs.stat(absent), {code:"ENOENT"});
    } finally { bash.dispose(); }
  }
});

test("link-free mkdir uses backing memory only when the shell has no explicit operation limit", async () => {
  for (const limits of [undefined, {maxFileSystemOperations: 100000}]) {
    const bash = new RustWasmBash({deviceView:"default", cwd:"/", limits});
    try {
      const result = await bash.exec("mkdir -p /new/..");
      assert.equal(result.exitCode, limits ? 1 : 0);
      assert.equal(await bash.fs.stat("/new").then(() => true, () => false), !limits);
    } finally { bash.dispose(); }
  }
});

test("mkdir checks all operands against the operation limit before creating directories", async () => {
  for (const [view, ops] of [["provided", 6], ["default", 10]]) {
    for (const limit of [1, ops - 1, ops]) {
      const bash = new RustWasmBash({deviceView:view, cwd:"/", symlinks:{"/alias":"/other"}, limits:{maxFileSystemOperations:limit}});
      try {
        if (limit === ops) assert.equal((await bash.exec("mkdir -v /x /y")).exitCode, 0);
        else await assert.rejects(bash.exec("mkdir -v /x /y"), /maxFileSystemOperations/);
        assert.equal(await bash.fs.stat("/x").then(() => true, () => false), limit > 1);
        assert.equal(await bash.fs.stat("/y").then(() => true, () => false), limit === ops);
      } finally { bash.dispose(); }
    }
  }
});

test("mkdir reports which device lookup failed before creating a directory", async () => {
  const bash = new RustWasmBash({deviceView:"default", symlinks:{"/alias":"/dev"}});
  try {
    for (const [path, recursive, code, syscall, failed] of [
      ["/missing/..", true, "ENOENT", "lstat", "/missing"],
      ["/alias/null/../x", true, "ENOTDIR", undefined, "/alias/null/../x"],
      ["/alias", false, "EEXIST", undefined, "/alias"],
      ["/dev/null/, lstat 'name", true, "ENOTDIR", undefined, "/dev/null/, lstat 'name"],
    ]) {
      await assert.rejects(bash.fs.mkdir(path, {recursive}), {code, syscall, path:failed});
      await assert.rejects(bash.fs.stat("/missing"), {code:"ENOENT"});
    }
  } finally { bash.dispose(); }
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

test("device metadata follows virtual traversal without granting access to backing directories", async () => {
  const bash = new RustWasmBash({directories:["/locked","/keep"]});
  try {
    await bash.fs.chmod("/locked", 0);
    for (const op of ["stat", "lstat"]) {
      for (const path of ["/dev", "/dev/null"]) {
        const expected = await bash.fs[op](path);
        assert.equal((await bash.fs[op]("/locked/.." + path)).ino, expected.ino);
      }
      await assert.rejects(bash.fs[op]("/locked/../keep"), {code:"EACCES"});
    }
    const result = await bash.exec("rmdir -v /keep /locked/../dev");
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ENOTSUP/);
    assert.equal((await bash.fs.stat("/keep")).type, "directory");
  } finally { bash.dispose(); }
});

test("memory rmdir reports a missing entry without the trailing slash", async () => {
  for (const deviceView of ["default","provided"]) {
    const bash = new RustWasmBash({deviceView, directories:["/dir"]});
    try {
      const r = await bash.exec("rmdir /dir/missing///");
      assert.equal(r.stderr, "rmdir: ENOENT: no such file or directory, rmdir '/dir/missing'\n");
      await assert.rejects(bash.fs.rmdir("/dir/missing///"), {code:"ENOENT", syscall:"rmdir", path:"/dir/missing"});
    } finally { bash.dispose(); }
  }
});

test("a missing prefix cannot select a mounted device's directory removal capability", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", directories:["/empty"]});
  try {
    const result = await bash.exec("rmdir -v --ignore-fail-on-non-empty /empty /missing/../dev");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "rmdir: removing directory, '/empty'\n");
    assert.equal(result.stderr, "rmdir: ENOENT: no such file or directory, rmdir '/missing/../dev'\n");
  } finally { bash.dispose(); }
});

test("rmdir checks whether an unsupported mounted directory is actually nonempty", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", directories:["/empty"]});
  try {
    for (const [operand, op] of [["/dev/absent","readdir"], ["/dev/absent/","capabilitiesFor"], ["/dev/absent/child","capabilitiesFor"]]) {
      const result = await bash.exec("rmdir -p --ignore-fail-on-non-empty " + operand);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "rmdir: ENOENT: no such file or directory, " + op + " '" + operand + "'\n");
    }
    const run = n => bash.exec("rmdir /dev/absent", {limits:{maxFileSystemOperations:n}});
    await assert.rejects(run(7), {limit:"maxFileSystemOperations"});
    assert.equal((await run(8)).exitCode, 1);
  } finally { bash.dispose(); }
});

test("mounted removal requires a searchable directory before crossing a trailing slash", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", directories:["/locked"]});
  try {
    await bash.fs.chmod("/locked", 0);
    for (const method of ["rmdir", "rm", "unlink"]) {
      await assert.rejects(bash.fs[method]("/locked/", {recursive:true, force:true}), {code:"EACCES", syscall:method, path:"/locked/"});
      assert.equal((await bash.fs.lstat("/locked")).type, "directory");
      await assert.rejects(bash.fs[method]("/dev/null/"), {code:"ENOTDIR", syscall:method, path:"/dev/null/"});
    }
    await bash.fs.rm("/missing/", {force:true});
    await bash.fs.rm("/missing/", {force:true, recursive:true});
    await bash.fs.rmdir("/locked");
  } finally { bash.dispose(); }
});

test("removal checks device traversal and mounted roots before rejecting a terminal dot", async () => {
  for (const [profile, path, method, code, syscall, failed] of [
    [undefined, "/missing/../dev", "rmdir", "ENOENT", "lstat", "/missing"],
    [undefined, "/dev/null", "rmdir", "ENOTDIR", undefined, "/dev/null"],
    [undefined, "/dev/null", "unlink", "EBUSY", undefined, "/dev/null"],
    [undefined, "/missing/../dev", "rm", "ENOENT", "lstat", "/missing"],
    ["strict-budgets-mount-dev", "/empty/..", "rmdir", "EBUSY", "rmdir", "/empty/.."],
    ["overlay-cow-fs", "/missing/.", "rmdir", "ENOENT", "rmdir", "/missing/."],
  ]) {
    const bash = new RustWasmBash({profile, directories:["/empty"]});
    try {
      await assert.rejects(bash.fs[method](path, {recursive:true, force:true}), {code, syscall, path:failed});
      assert.equal((await bash.fs.stat("/empty")).type, "directory");
    } finally { bash.dispose(); }
  }
});

test("rmdir charges parent capability retries when device traversal crosses a missing directory", async () => {
  for (const [symlinks, minimum] of [[{}, 9], [{"/link":"/a"}, 10]]) {
    const bash = new RustWasmBash({cwd:"/", directories:["/a"], symlinks});
    try {
      const run = n => bash.exec("rmdir -p /bad/../a", {limits:{maxFileSystemOperations:n}});
      await assert.rejects(run(minimum - 1), {limit:"maxFileSystemOperations"});
      const result = await run(minimum);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ENOENT/);
      assert.equal((await bash.fs.stat("/a")).type, "directory");
    } finally { bash.dispose(); }
  }
});

test("rmdir checks every operand's removal capability before deleting earlier directories", async () => {
  for (const [profile, ignore, code, removed] of [
    [undefined, false, "ENOTSUP", false], [undefined, true, "ENOTSUP", false],
    ["strict-budgets-mount-dev", false, "ENOTEMPTY", false], ["strict-budgets-mount-dev", true, "", true],
  ]) {
    const bash = new RustWasmBash({profile, directories:["/empty"]});
    try {
      const r = await bash.exec("rmdir -v " + (ignore ? "--ignore-fail-on-non-empty " : "") + "/empty /dev");
      assert.equal(r.exitCode, code ? 1 : 0);
      assert.equal(r.stdout, removed ? "rmdir: removing directory, '/empty'\n" : "");
      assert.equal(r.stderr, code ? "rmdir: " + code + (code === "ENOTSUP" ? ": operation not supported" : ": directory not empty") + ", rmdir '/dev'\n" : "");
      assert.equal(await bash.fs.stat("/empty").then(() => false, () => true), removed);
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

test("invalid environment entries reject construction and execution before hooks or writes", async () => {
  const bash = new RustWasmBash({ files: { "/file": "original" } });
  let calls = 0;
  const hooks = { beforeExec() { calls++; } };
  try {
    for (const env of [{ "a=b": "v" }, { "a\0b": "v" }, { a: "v\0x" }, { a: 0 }]) {
      assert.throws(() => new RustWasmBash({ env }), new TypeError("Invalid environment entry"));
      await assert.rejects(bash.exec("echo changed > /file", { env, hooks }), new TypeError("Invalid environment entry"));
    }
    assert.equal(calls, 0);
    assert.equal(bash.readText("/file"), "original");
  } finally { bash.dispose(); }
});

test("fd accepts safe integer depth limits and bundled exec flags in Wasm", async () => {
  const bash = new RustWasmBash({ cwd: "/w", files: { "/w/a.Ä": "", "/w/sub/b.ä": "" } });
  try {
    const result = await bash.exec("fd --max-depth=4294967296 -e ä -Ix echo '{}' ';'");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "./a.Ä\n./sub/b.ä\n", ""]);
  } finally { bash.dispose(); }
});

test("filesystem factory registration preserves the live native filesystem with a companion configured", async () => {
  const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
  const bash = new RustWasmBash({ cwd: "/", companionFactory() {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, cwd: "/" });
    shell.registerFileSystem("existing", () => fs);
    return { fs, shell };
  } });
  try {
    await bash.exec("echo kept > /native");
    assert.throws(() => bash.registerFileSystem("existing", () => bash.fs), /already registered: existing/);
    bash.registerFileSystem("own", () => bash.fs);
    assert.equal(await bash.createFileSystem("own"), bash.fs);
    assert.notEqual(await bash.createFileSystem("existing"), bash.fs);
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/native")), "kept\n");
    assert.equal((await bash.exec("cat /native")).stdout, "kept\n");
  } finally { bash.dispose(); }
});

test("standalone filesystem factories validate schemes and preserve factory inputs and results", async () => {
  const bash = new RustWasmBash();
  try {
    const inputs = [];
    const filesystem = bash.fs;
    const factory = async options => { inputs.push(options); return filesystem; };
    for (const scheme of ["", "UPPER", "1mem", "a/b"]) {
      assert.throws(() => bash.registerFileSystem(scheme, factory), new TypeError("Invalid filesystem scheme"));
    }
    assert.equal(bash.registerFileSystem("mem+v1.0-x", factory), undefined);
    assert.throws(() => bash.registerFileSystem("mem+v1.0-x", factory), /Filesystem already registered: mem\+v1/);
    await assert.rejects(bash.createFileSystem("unknown"), /Unknown filesystem scheme: unknown/);
    const options = { source: filesystem };
    assert.equal(await bash.createFileSystem("mem+v1.0-x", options), filesystem);
    assert.equal(await bash.createFileSystem("mem+v1.0-x"), filesystem);
    assert.equal(inputs[0], options);
    assert.deepEqual(inputs[1], {});
  } finally { bash.dispose(); }
  assert.throws(() => bash.registerFileSystem("mem", () => bash.fs), /Shell is disposed/);
  await assert.rejects(bash.createFileSystem("mem+v1.0-x"), /Shell is disposed/);
});

test("per-call filesystems never redirect writes into the default Wasm filesystem", async () => {
  const main = new RustWasmBash({ files: { "/file": "original" } });
  const other = new RustWasmBash({ files: { "/file": "other" } });
  try {
    if (!WebAssembly.Suspending) {
      await assert.rejects(main.exec("echo changed > /file",{fs:other.fs}),/Promise Integration/i);
    } else {
      const r=await main.exec("echo changed > /file; cat /file",{fs:other.fs});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"changed\n",""]);
    }
    assert.equal(main.readText("/file"), "original");
    assert.equal(other.readText("/file"), WebAssembly.Suspending ? "changed\n" : "other");
  } finally { main.dispose(); other.dispose(); }
});

test("standalone Wasm executes against live caller-supplied files without inspecting unrelated paths",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), sh=new RustWasmBash({cwd:"/",files:{"/source":"default"}});
  const bytes=Uint8Array.of(0,255,65);
  await fs.writeFile("/source",bytes);
  const visited=[];
  const view=new Proxy(fs,{get(target,key){
    const method=target[key];
    if(typeof method!=="function")return method;
    return (...args)=>{visited.push([key,args[0]]);return method.apply(target,args);};
  }});
  try{
    const r=await sh.exec("mkdir /out; cat /source > /out/copy; ln -s /out/copy /alias; cat /alias",{fs:view});
    assert.deepEqual([r.exitCode,r.stderr],[0,""]);
    assert.deepEqual(r.stdoutBytes,bytes);
    assert.deepEqual(await fs.readFile("/out/copy"),bytes);
    assert.equal(await fs.readlink("/alias"),"/out/copy");
    assert.ok(!visited.some(([method,path])=>method==="readdir" && path==="/"));
    assert.equal((await sh.exec("cat /source")).stdout,"default");
  }finally{await sh.dispose();}
});

test("caller-supplied filesystems expose default devices without reading or changing shadowed files",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  for(const deviceView of ["default","provided"]){
    const js=new Shell({cwd:"/",fs:new MemoryFileSystem(),deviceView}).use(agentCommands());
    const rust=new RustWasmBash({cwd:"/",deviceView});
    const run=async sh=>{
      const fs=new MemoryFileSystem(), enc=new TextEncoder(), dec=new TextDecoder();
      const result=[];
      const exec=async script=>{const r=await sh.exec(script,{fs});result.push([r.exitCode,r.stdout,r.stderr]);};
      await exec('test -d /dev; echo "$?"; test -c /dev/null; echo "$?"');
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/null",enc.encode("private"));
      await fs.writeFile("/dev/ordinary",enc.encode("visible"));
      await fs.symlink("/dev","/devices");await fs.symlink("devices/null","/sink");
      await exec("ls -1 /devices; cat /dev/ordinary; cat /sink");
      await exec("printf changed | tee /sink; cat /devices/null");
      await exec("rm /devices/null 2>/errors; echo $?; test -L /sink");
      await exec("rm /sink; test -L /sink");
      try{result.push(dec.decode(await fs.readFile("/dev/null")));}catch(e){result.push(e.code);}
      return result;
    };
    try{
      const reference=await run(js);
      assert.equal(reference.at(-1),deviceView==="default"?"private":"ENOENT");
      assert.deepEqual(await run(rust),reference,deviceView);
    }finally{await js.dispose();await rust.dispose();}
  }
});

test("a supplied mount keeps absolute device links local and rejects links crossing into virtual devices",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,MountFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const root=new MemoryFileSystem(), mounted=new MemoryFileSystem();
  await mounted.mkdir("/dev");
  await mounted.writeFile("/dev/null",new TextEncoder().encode("local"));
  await mounted.symlink("/dev/null","/sink");
  await mounted.symlink("../dev/null","/escape");
  await root.symlink("/mounted/sink","/cross");
  const fs=new MountFileSystem({root,mounts:{"/mounted":mounted}});
  const js=new Shell({cwd:"/",fs}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{
    const script="cat /mounted/sink; cat /cross 2>/err; echo $?; cat /mounted/escape 2>/err; echo $?";
    const ref=await js.exec(script,{fs});
    assert.equal(ref.stdout,"local1\n1\n");
    const got=await rust.exec(script,{fs});
    assert.deepEqual([got.exitCode,got.stdout,got.stderr],[ref.exitCode,ref.stdout,ref.stderr]);
  }finally{await js.dispose();await rust.dispose();}
});

test("host plugins see the same device namespace as native commands on a supplied filesystem",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  for(const deviceView of ["default","provided"]){
    const fs=new MemoryFileSystem(),sh=new RustWasmBash({cwd:"/",deviceView});
    const enc=new TextEncoder(),dec=new TextDecoder();
    await fs.mkdir("/dev");await fs.writeFile("/dev/null",enc.encode("keep"));await fs.symlink("/dev/null","/sink");await fs.writeFile("/dev/other",enc.encode("visible"));
    let seen;
    sh.register({name:"inspect-device",async execute(ctx){
      const [s,b]=await Promise.all([ctx.fs.stat("/sink"),ctx.fs.readFile("/sink")]);
      await ctx.fs.writeFile("/sink",enc.encode("edited"));
      let streamed="";
      for await(const chunk of ctx.fs.readStream("/sink"))streamed+=dec.decode(chunk);
      const handle=await ctx.fs.openReadFile("/sink");
      let retained;
      try{retained=dec.decode(await handle.read(0,100));}finally{await handle.close();}
      seen=[s.type,dec.decode(b),(await ctx.fs.capabilitiesFor("/sink")).open,streamed,retained,
        (await ctx.fs.readdir("/dev")).map(e=>[e.name,e.type]).sort(),
        (await ctx.fs.lstat("/sink")).type];
      if(deviceView==="default"){
        await assert.rejects(ctx.fs.rename("/dev/null","/leak"),{code:"EBUSY"});
        await assert.rejects(ctx.fs.chmod("/sink",0o111),{code:"EBUSY"});
        await assert.rejects(ctx.fs.readdir("/dev",{maxEntries:1}),{code:"EFBIG"});
      }
      return {exitCode:0};
    }});
    try{
      const r=await sh.exec("inspect-device",{fs});
      assert.deepEqual([r.exitCode,r.stderr],[0,""]);
      assert.deepEqual(seen,deviceView==="default"
        ?["character","",true,"","",[["null","character"],["other","file"]],"symlink"]
        :["file","keep",true,"edited","edited",[["null","file"],["other","file"]],"symlink"]);
      assert.equal(dec.decode(await fs.readFile("/dev/null")),deviceView==="default"?"keep":"edited");
    }finally{await sh.dispose();}
  }
});

test("suspended host filesystem calls isolate concurrent forks and share the selected filesystem with plugins",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const first=new MemoryFileSystem(), second=new MemoryFileSystem(), bash=new RustWasmBash({cwd:"/"});
  const entered=Promise.withResolvers(), resume=Promise.withResolvers();
  await first.writeFile("/input",new TextEncoder().encode("first"));
  await second.writeFile("/input",new TextEncoder().encode("second"));
  const read=first.readFile.bind(first);
  first.readFile=async(...args)=>{entered.resolve();await resume.promise;return read(...args);};
  bash.register({name:"record",async execute(ctx){
    await ctx.fs.writeFile("/marked",new TextEncoder().encode(ctx.args[0]));return {exitCode:0};
  }});
  try{
    const run=bash.exec("cat /input; record one",{fs:first});
    try{
      await entered.promise;
      const r=await bash.exec("cat /input; record two",{fs:second});
      assert.deepEqual([r.stdout,r.stderr],["second",""]);
    }finally{resume.resolve();}
    const r=await run;
    assert.deepEqual([r.stdout,r.stderr],["first",""]);
    assert.equal(new TextDecoder().decode(await first.readFile("/marked")),"one");
    assert.equal(new TextDecoder().decode(await second.readFile("/marked")),"two");
    assert.equal((await bash.exec("test -e /marked")).exitCode,1);
  }finally{resume.resolve();await bash.dispose();}
});

test("ln and cp -l use the supplied filesystem's hard links and respect path capabilities",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem,MountFileSystem,Shell,agentCommands}=await import("@poe-platform/safe-bash");
  const exercise=async sh=>{
    const fs=new MemoryFileSystem(), enc=new TextEncoder();
    await fs.mkdir("/directory");await fs.writeFile("/a",enc.encode("one"));await fs.symlink("a","/s");
    const result=[];
    for(const script of ["ln /a /alias; cp -l /a /copy; printf two > /alias; cat /a /copy",
      "ln -P /s /physical; readlink /physical; ln -L /s /logical; cat /logical",
      "ln /dev/null /forbidden","ln /directory /bad"]){
      const r=await sh.exec(script,{fs});result.push([r.exitCode,r.stdout,r.stderr]);
    }
    const query=fs.capabilitiesFor?.bind(fs);
    fs.capabilitiesFor=async(p,o)=>({...(await query?.(p,o) ?? fs.capabilities),...(p==="/occupied" && {hardlinks:false})});
    await fs.writeFile("/occupied",enc.encode("keep"));
    const denied=await sh.exec("ln -f /a /occupied",{fs});
    const other=new MemoryFileSystem(), mount=new MountFileSystem({root:fs,mounts:{"/other":other}});
    const cross=await sh.exec("ln /a /other/alias",{fs:mount});
    await assert.rejects(other.lstat("/alias"),{code:"ENOENT"});
    return [...result,[cross.exitCode,cross.stderr],[denied.exitCode,denied.stderr],new TextDecoder().decode(await fs.readFile("/occupied")),(await fs.stat("/a")).nlink];
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
  try{
    const ref=await exercise(js);assert.equal(ref[0][1],"twotwo");assert.equal(ref.at(-2),"keep");assert.equal(ref.at(-1),4);
    assert.deepEqual(await exercise(rust),ref);
  }finally{await js.dispose();await rust.dispose();}
});

test("host retained reads keep the opened object, bound each range and close after a failed read",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(),sh=new RustWasmBash({cwd:"/"});
  const bytes=new Uint8Array(140000).fill(65);bytes[bytes.length-1]=10;
  await fs.writeFile("/input",bytes);
  const open=fs.openReadFile.bind(fs);let calls=0,closed=0,max=0,bad=false;
  const view=new Proxy(fs,{get(target,key){
    if(key==="capabilitiesFor")return async()=>({...fs.capabilities,open:false});
    if(key==="readFile")return ()=>{throw new Error("whole-file read");};
    if(key==="openReadFile")return async(path,settings)=>{
    const h=await open(path,settings);
    if(!calls++){await fs.rename("/input","/old");await fs.writeFile("/input",Uint8Array.of(66,10));}
    return {...h,async read(pos,n,opts){
      max=Math.max(max,n);
      if(bad)return new Uint8Array(n+1);
      return h.read(pos,Math.min(n,17000),opts);
    },async close(){closed++;await h.close();}};
  };
    const v=target[key];return typeof v==="function"?v.bind(target):v;
  }});
  try{
    const r=await sh.exec("dd if=/input bs=140000 count=1 status=none",{fs:view});
    assert.deepEqual([r.exitCode,r.stderr],[0,""]);assert.deepEqual(r.stdoutBytes,bytes);
    assert.deepEqual([calls,closed],[1,1]);assert.ok(max>0 && max<=65536);
    bad=true;
    const failed=await sh.exec("shuf /input",{fs:view});
    assert.notEqual(failed.exitCode,0);assert.deepEqual([calls,closed],[2,2]);
    const device=await sh.exec("dd if=/dev/null bs=1 count=1 status=none",{fs:view});
    assert.deepEqual([device.exitCode,device.stdout,device.stderr],[0,"",""]);assert.equal(calls,2);
  }finally{await sh.dispose();}
});

test("a supplied filesystem keeps redirected descriptors on the opened file after a rename",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(),bash=new RustWasmBash({cwd:"/"});
  const handles=new Set(),open=fs.open.bind(fs);
  fs.open=async(...args)=>{
    const handle=await open(...args);handles.add(handle);
    return new Proxy(handle,{get(target,key){
      if(key==="close")return async(...options)=>{await handle.close(...options);assert.ok(handles.delete(handle));};
      const v=target[key];return typeof v==="function"?v.bind(target):v;
    }});
  };
  try{
    const r=await bash.exec("printf old > /a; exec 3<>/a; mv /a /b; printf new > /a; printf X >&3; exec 3>&-; cat /a /b",{fs});
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"newXld",""]);
    assert.equal(handles.size,0);
  }finally{await bash.dispose();}
});

test("command output on a supplied filesystem preserves creation and existing modes",{skip:!WebAssembly.Suspending},async()=>{
  const {Shell,MemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async(sh)=>{
    const fs=new MemoryFileSystem();
    await fs.writeFile("/keepaa",Uint8Array.of(65),{mode:0o600});
    const r=await sh.exec("printf 'a\nb\n' | split -l 1 - /keep",{fs});
    assert.deepEqual([r.exitCode,r.stderr],[0,""]);
    return Promise.all(["/keepaa","/keepab"].map(async p=>(await fs.stat(p)).mode & 0o777));
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()), rust=new RustWasmBash({cwd:"/"});
  try{
    const expected=await run(js);assert.deepEqual(expected,[0o600,0o644]);
    assert.deepEqual(await run(rust),expected);
  }finally{await js.dispose();await rust.dispose();}
});

test("supplied filesystems publish rendered files against their original destination and parent",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const enc=new TextEncoder(),fs=new MemoryFileSystem(),shell=new RustWasmBash({cwd:"/"});
  await fs.writeFile("/in",enc.encode("graph TD; A-->B;"));
  let race=false, calls=0;
  const write=fs.writeFileConditional.bind(fs);
  fs.writeFileConditional=async(path,bytes,opts)=>{
    calls++;
    if(race){
      assert.equal(opts.expected,null);
      await fs.writeFile(path,enc.encode("concurrent"));
    }
    return write(path,bytes,opts);
  };
  try{
    const first=await shell.exec("mmdc -i /in -o /out.svg",{fs});
    assert.deepEqual([first.exitCode,first.stderr,calls],[0,"",1]);
    assert.equal((await fs.stat("/out.svg")).mode&0o777,0o666);
    race=true;
    const second=await shell.exec("mmdc -i /in -o /other.svg",{fs});
    assert.notEqual(second.exitCode,0);
    assert.match(second.stderr,/EAGAIN/);
    assert.equal(new TextDecoder().decode(await fs.readFile("/other.svg")),"concurrent");
    race=false;
    const read=fs.readFile.bind(fs);
    fs.readFile=async(path,settings)=>{
      if(path==="/in")await fs.writeFile("/out.svg",enc.encode("changed during rendering"));
      return read(path,settings);
    };
    const third=await shell.exec("mmdc -i /in -o /out.svg",{fs});
    assert.notEqual(third.exitCode,0);
    assert.match(third.stderr,/EAGAIN/);
    assert.equal(new TextDecoder().decode(await read("/out.svg")),"changed during rendering");
  }finally{await shell.dispose();}
});

test("csplit rollback on a supplied filesystem removes only its own output",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(), sh=new RustWasmBash({cwd:"/"});
  const remove=fs.removeFileConditional.bind(fs), removed=[];
  fs.removeFileConditional=async(path,options)=>{
    removed.push(path);
    if(path==="/xx00")await fs.writeFile(path,new TextEncoder().encode("new owner"));
    return remove(path,options);
  };
  try{
    const r=await sh.exec("printf 'one\ntwo\nthree\n' | csplit - 2 3 20",{fs});
    assert.notEqual(r.exitCode,0);
    assert.ok(removed.includes("/xx00"));
    assert.ok(removed.includes("/xx01"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/xx00")),"new owner");
    await assert.rejects(fs.stat("/xx01"),{code:"ENOENT"});
  }finally{await sh.dispose();}
});

test("ZIP stages a fresh host file, preserves retained readers and cleans up a refused publication",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(),sh=new RustWasmBash({cwd:"/"}),enc=new TextEncoder();
  await fs.writeFile("/a",enc.encode("initial"));await fs.writeFile("/b",enc.encode("extra"));
  try{
    const first=await sh.exec("zip -q out.zip a",{fs});
    assert.deepEqual([first.exitCode,first.stderr],[0,""]);
    await fs.chmod("/out.zip",0o600);
    const old=await fs.openReadFile("/out.zip"), before=await fs.readFile("/out.zip");
    try{
      const update=await sh.exec("zip -q out.zip b",{fs});
      assert.deepEqual([update.exitCode,update.stderr],[0,""]);
      assert.deepEqual(await old.read(0,before.length+10000),before);
      assert.notDeepEqual(await fs.readFile("/out.zip"),before);
      assert.equal((await fs.stat("/out.zip")).mode&0o777,0o600);
    }finally{await old.close();}
    const publish=fs.publishStagedFile.bind(fs);
    fs.publishStagedFile=async(stage,path,opts)=>{
      await fs.writeFile(path,enc.encode("replacement"));return publish(stage,path,opts);
    };
    const refused=await sh.exec("zip -q race.zip a",{fs});
    assert.notEqual(refused.exitCode,0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/race.zip")),"replacement");
    assert.deepEqual((await fs.readdir("/")).map(e=>e.name).sort(),["a","b","out.zip","race.zip"]);
  }finally{await sh.dispose();}
});

test("ZIP updates both host hard links and refuses a competing write before publication",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem,Shell,agentCommands}=await import("@poe-platform/safe-bash");
  const run=async (sh,race,staged)=>{
    const fs=new MemoryFileSystem(),enc=new TextEncoder();
    await fs.writeFile("/a",enc.encode("first"));await fs.writeFile("/b",enc.encode("second"));
    assert.equal((await sh.exec("zip -q out.zip a",{fs})).exitCode,0);
    await fs.link("/out.zip","/alias");await fs.chmod("/out.zip",0o640);
    const initial=await fs.stat("/alias"), fd=await fs.open("/alias",{access:"read",creation:"never"});
    try{
      if(!staged)fs.capabilitiesFor=async()=>({...fs.capabilities,atomicStagedFileMutation:false});
      const publish=fs.publishStagedFile.bind(fs);
      const write=fs.writeFileConditional.bind(fs);
      let modified=false;
      fs.publishStagedFile=async(stage,path,opts)=>{
        if(race && staged && path==="/out.zip"){
          await fs.writeFile("/alias",enc.encode("competitor"));modified=true;
        }
        return publish(stage,path,opts);
      };
      if(!staged){
        const compete=async()=>{if(race && !modified){await fs.writeFile("/alias",enc.encode("competitor"));modified=true;}};
        const confine=fs.confineExtraction.bind(fs);
        fs.confineExtraction=async(...args)=>{const view=await confine(...args);await compete();return view;};
        fs.writeFileConditional=async(p,...args)=>{if(p==="/out.zip")await compete();return write(p,...args);};
      }
      const r=await sh.exec("zip -q out.zip b",{fs});
      const after=await fs.stat("/out.zip");
      assert.equal(after.ino,initial.ino);assert.equal(after.nlink,2);assert.equal(after.mode,initial.mode);
      assert.equal((await fd.stat()).size,after.size);
      assert.deepEqual(await fs.readFile("/alias"),await fs.readFile("/out.zip"));
      assert.deepEqual((await fs.readdir("/")).map(e=>e.name).sort(),["a","alias","b","out.zip"]);
      if(race){assert.ok(modified);assert.notEqual(r.exitCode,0);assert.equal(new TextDecoder().decode(await fs.readFile("/alias")),"competitor");}
      else{
        assert.deepEqual([r.exitCode,r.stderr],[0,""]);
        const listed=await sh.exec("unzip -p alias b",{fs});assert.deepEqual([listed.exitCode,listed.stdout,listed.stderr],[0,"second",""]);
      }
    }finally{await fd.close();}
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{for(const sh of [js,rust])for(const staged of [true,false])for(const race of [false,true])await run(sh,race,staged);}
  finally{await js.dispose();await rust.dispose();}
});

test("ZIP reads an existing archive and its members in bounded ranges, and rejects a member changed mid-read",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem,Shell,agentCommands}=await import("@poe-platform/safe-bash");
  const payload=new Uint8Array(280000).fill(73);
  const run=async sh=>{
    const fs=new MemoryFileSystem(), limits=[], writes=[];let mutate=false,failWrite=false,opened=0,closed=0;
    await fs.writeFile("/first",payload);await fs.writeFile("/second",payload);
    const view=new Proxy(fs,{get(target,key){
      if(key==="readFile")return ()=>{throw new Error("unexpected whole-file read");};
      if(key==="openReadFile")return async(path,settings)=>{
        const h=await fs.openReadFile(path,settings);opened++;
        return {...h,async read(pos,n,opts){
          limits.push(n);
          const data=await h.read(pos,n,opts);
          if(mutate && path==="/second"){mutate=false;await fs.writeFile(path,new Uint8Array(payload.length).fill(88));}
          return data;
        },async close(){closed++;await h.close();}};
      };
      if(key==="createStagedFile")return async(path,name,content,opts)=>{
        const stage=await fs.createStagedFile(path,name,content,opts);writes.push(content.data?.length??0);
        return {...stage,writer:{...stage.writer,async write(b,o){writes.push(b.length);
          if(failWrite){failWrite=false;throw new Error("injected staged write failure");}
          return stage.writer.write(b,o);}}};
      };
      const v=target[key];return typeof v==="function"?v.bind(target):v;
    }});
    assert.deepEqual(await sh.exec("zip -0q out.zip first",{fs:view}).then(r=>[r.exitCode,r.stderr]),[0,""]);
    const original=await fs.readFile("/out.zip");
    mutate=true;
    const refused=await sh.exec("zip -0q out.zip second",{fs:view});
    assert.notEqual(refused.exitCode,0);assert.equal(mutate,false);assert.deepEqual(await fs.readFile("/out.zip"),original);
    failWrite=true;
    assert.notEqual((await sh.exec("zip -0q out.zip second",{fs:view})).exitCode,0);
    assert.equal(failWrite,false);assert.deepEqual(await fs.readFile("/out.zip"),original);
    assert.deepEqual((await fs.readdir("/")).map(e=>e.name).sort(),["first","out.zip","second"]);
    const update=await sh.exec("zip -0q out.zip second",{fs:view});
    assert.deepEqual([update.exitCode,update.stderr],[0,""]);
    assert.equal(opened,closed);assert.ok(opened>1);
    assert.ok(limits.length>4 && Math.max(...limits)<=65536,"read range: "+Math.max(...limits));
    assert.ok(writes.length>4 && Math.max(...writes)<=65536,"write range: "+Math.max(...writes));
    limits.length=0;
    const listing=await sh.exec("unzip -Z1 out.zip",{fs:view});
    assert.deepEqual([listing.exitCode,listing.stdout],[0,"first\nsecond\n"]);
    assert.ok(limits.reduce((sum,n)=>sum+n,0)<200000,"listing read unselected payloads");
    limits.length=0;
    const contents=await sh.exec("unzip -p out.zip second",{fs:view});
    assert.deepEqual([contents.exitCode,contents.stderr],[0,""]);
    assert.deepEqual(contents.stdoutBytes,await fs.readFile("/second"));
    assert.ok(limits.reduce((sum,n)=>sum+n,0)<200000+payload.length,"extract read unselected payloads");
    assert.equal(opened,closed);
  };
  const js=new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands()),rust=new RustWasmBash({cwd:"/"});
  try{for(const sh of [js,rust])await run(sh);}finally{await js.dispose();await rust.dispose();}
});

test("host apply_patch confines create, update, move and delete to the preflight directories",{skip:!WebAssembly.Suspending},async()=>{
  const {MemoryFileSystem}=await import("@poe-platform/safe-bash");
  const fs=new MemoryFileSystem(),sh=new RustWasmBash({cwd:"/"}),enc=new TextEncoder(),dec=new TextDecoder();
  const patch=body=>sh.exec("apply_patch",{fs,stdin:"*** Begin Patch\n"+body+"\n*** End Patch\n"});
  try{
    await fs.mkdir("/root");await fs.writeFile("/root/data",enc.encode("old\n"),{mode:0o600});
    await fs.link("/root/data","/alias");
    const update=await patch("*** Update File: root/data\n@@\n-old\n+new\n*** Add File: root/nested/file\n+created");
    assert.deepEqual([update.exitCode,update.stderr],[0,""]);
    assert.equal(dec.decode(await fs.readFile("/alias")),"new\n");
    assert.equal((await fs.stat("/root/data")).mode&0o777,0o600);
    const before=await fs.stat("/root/data");
    const same=await patch("*** Update File: root/data\n@@\n-new\n+new");
    assert.equal(same.exitCode,0,same.stderr);
    assert.equal((await fs.stat("/root/data")).revision,before.revision);
    const move=await patch("*** Update File: root/nested/file\n*** Move to: root/moved\n*** Delete File: root/data");
    assert.deepEqual([move.exitCode,move.stderr],[0,""]);
    assert.equal(dec.decode(await fs.readFile("/root/moved")),"created\n");
    await assert.rejects(fs.stat("/root/nested/file"),{code:"ENOENT"});
    await assert.rejects(fs.stat("/root/data"),{code:"ENOENT"});
    const confine=fs.confineExtraction.bind(fs);
    fs.confineExtraction=async(...args)=>{
      const view=await confine(...args);
      return new Proxy(view,{get(target,key){
        if(key==="publishStagedFile")return async(...publish)=>{
          await fs.rename("/root","/old");await fs.mkdir("/root");await fs.writeFile("/root/moved",enc.encode("new owner"));
          return target.publishStagedFile(...publish);
        };
        return Reflect.get(target,key);
      }});
    };
    const changed=await patch("*** Update File: root/moved\n@@\n-created\n+wrong");
    assert.notEqual(changed.exitCode,0);
    assert.equal(dec.decode(await fs.readFile("/root/moved")),"new owner");
    assert.equal(dec.decode(await fs.readFile("/old/moved")),"created\n");
    assert.deepEqual((await fs.readdir("/old")).map(x=>x.name).sort(),["moved","nested"]);
  }finally{await sh.dispose();}
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

test("memory inode revisions match TypeScript through writes, links and chmod", async () => {
  const { MemoryFileSystem } = await import("@poe-platform/safe-bash");
  const wasm = new RustWasmBash({ forceNative: true });
  async function exercise(fs) {
    await fs.mkdir("/dir");
    const stamps = [];
    async function record(path) { stamps.push((await fs.lstat(path)).revision); }
    await record("/dir");
    await fs.writeFile("/dir/file", new Uint8Array([1]));
    await record("/dir"); await record("/dir/file");
    await fs.readFile("/dir/file"); await record("/dir/file");
    await fs.writeFile("/dir/file", new Uint8Array([2])); await record("/dir/file");
    await fs.chmod("/dir/file", 0o640); await record("/dir/file");
    await fs.symlink("file", "/dir/link"); await record("/dir/link");
    await fs.rename("/dir/link", "/dir/moved"); await record("/dir/moved");
    await fs.chmod("/dir", 0o755); await record("/dir");
    const fd = await fs.open("/dir/file", {access: "readwrite"});
    try {
      await fs.link("/dir/file", "/alias");
      await fd.write(Uint8Array.of(3), 0); await record("/alias");
      await fd.truncate(0); await record("/dir/file");
      await fs.unlink("/alias"); await fs.unlink("/dir/file");
      stamps.push((await fd.stat()).revision);
    } finally { await fd.close(); }
    return stamps;
  }
  try {
    const expected = await exercise(new MemoryFileSystem());
    assert.ok(expected.every(Number.isSafeInteger));
    assert.deepEqual(await exercise(wasm.fs), expected);
  } finally { wasm.dispose(); }
});

test("cancelled and guarded chmod calls cannot silently change Wasm permissions", async () => {
  const bash = new RustWasmBash({ files: { "/private": { content: "data", mode: 0o600 } } });
  try {
    assert.equal(bash.fs.capabilities.conditionalChmod, true);
    const reason = new Error("cancel chmod");
    await assert.rejects(bash.fs.chmod("/private", 0o777, { signal: AbortSignal.abort(reason) }), e => e === reason);
    const file = await bash.fs.stat("/private"), root = await bash.fs.stat("/");
    await assert.rejects(bash.fs.chmod("/private", 0o777, { expected: file }), { code: "EINVAL", syscall: "chmod" });
    const options = { parent: root, expected: file, ancestors: [{path:"/", stat:root}] };
    await assert.rejects(bash.fs.chmod("/private", 0o777, {...options, commitGuard: () => false}), {code:"ENOTSUP"});
    const controller = new AbortController();
    const cancelled = { ...options, signal:controller.signal, commitGuard() {
      controller.abort(reason); cancelled.signal = new AbortController().signal; return true;
    }};
    await assert.rejects(bash.fs.chmod("/private",0o777,cancelled), e => e === reason);
    assert.equal((await bash.fs.stat("/private")).mode & 0o777, 0o600);
    await bash.fs.chmod("/private",0o640,{...options, commitGuard: () => true});
    await assert.rejects(bash.fs.chmod("/private",0o777,options), {code:"EAGAIN",syscall:"fileStaging",path:"/private"});
    assert.equal((await bash.fs.stat("/private")).mode & 0o777,0o640);
    const fresh = {...options, expected: await bash.fs.lstat("/private")};
    await assert.rejects(bash.fs.chmod("/private",0o777,{...fresh, commitGuard() {
      bash.chmod("/private",0o640); return true;
    }}), {code:"EAGAIN"});
  } finally { bash.dispose(); }
});

test("mounted chmod checks directory receipts before invoking a guard and rechecks before mutation", async () => {
  const bash = new RustWasmBash({profile:"strict-budgets-mount-dev", files:{"/d/f":"x"}});
  const fs = bash.fs;
  async function receipt(path, parents) {
    const ancestors = await Promise.all(parents.map(async path => ({path, stat: await fs.lstat(path)})));
    return {expected: await fs.lstat(path), parent: ancestors.at(-1).stat, ancestors};
  }
  try {
    for (const [path,parents,code] of [["/",["/"],"EBUSY"],["/dev",["/"],"EBUSY"],["/dev/null",["/","/dev"],"ENOTSUP"]]) {
      const options = await receipt(path, parents);
      await assert.rejects(fs.chmod(path,0o777,{...options,commitGuard:()=>assert.fail("protected entry invoked guard")}), {code,syscall:"chmod",path});
    }
    const options = await receipt("/d/f",["/","/d"]);
    await fs.chmod("/d/f",0o640,options);
    await assert.rejects(fs.chmod("/d/f",0o777,options),{code:"EAGAIN",syscall:"chmod",path:"/d/f"});
    const fresh = await receipt("/d/f",["/","/d"]);
    await assert.rejects(fs.chmod("/d/f",0o777,{...fresh,commitGuard(){ bash.chmod("/d/f",0o600); return true; }}),{code:"EAGAIN"});
    assert.equal((await fs.lstat("/d/f")).mode & 0o777,0o600);
    await fs.rename("/d","/saved"); await fs.mkdir("/d"); await fs.writeFile("/d/f","new");
    await assert.rejects(fs.chmod("/d/f",0o777,{...fresh,commitGuard:()=>assert.fail("replaced parent invoked guard")}),{code:"EAGAIN"});
  } finally { bash.dispose(); }
});

test("overlay guarded chmod preserves directory receipts and rejects unsafe replacements", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs", files:{"/d/f":"original", "/target":"saved"}});
  const fs = bash.fs;
  async function receipt(path) {
    const parents = path.startsWith("/d/") ? ["/","/d"] : ["/"];
    const ancestors = await Promise.all(parents.map(async path => ({path, stat:await fs.lstat(path)})));
    return {ancestors, parent:ancestors.at(-1).stat, expected:await fs.lstat(path)};
  }
  try {
    const dir = await receipt("/d"), file = await receipt("/d/f");
    await assert.rejects(fs.chmod("/d/f",0o777,{...file, expected:{...file.expected,type:"directory"}}), {code:"EAGAIN",path:"/d/f"});
    await fs.writeFile("/d/sibling","new");
    await fs.chmod("/d/f",0o640,{...file, expected:{...file.expected}});
    await assert.rejects(fs.chmod("/d/f",0o777,file), {code:"EAGAIN"});
    assert.equal(bash.readText("/d/f"), "original");
    await fs.chmod("/d",0o751,dir);
    assert.equal((await fs.lstat("/d")).identityScope, dir.expected.identityScope);
    const fresh = await receipt("/d/f");
    let calls = 0;
    await assert.rejects(fs.chmod("/d/f",0o777,{...fresh, commitGuard() {
      if (++calls === 3) bash.chmod("/d/f",0o600);
      return true;
    }}), {code:"EAGAIN"});
    assert.equal(calls,3);
    assert.equal((await fs.lstat("/d/f")).mode & 0o777,0o600);
    await fs.symlink("/target","/link");
    await fs.chmod("/target",0o600);
    await assert.rejects(fs.chmod("/link",0o777,await receipt("/link")), {code:"ENOTSUP"});
    assert.equal((await fs.lstat("/target")).mode & 0o777,0o600);
    await fs.chmod("/",0o555);
    calls = 0;
    await assert.rejects(fs.chmod("/d/f",0o777,{...await receipt("/d/f"),commitGuard:()=>!!++calls}), {code:"EACCES"});
    assert.equal(calls,2);
  } finally { bash.dispose(); }
});

test("a refused overlay chmod releases its staged copy and preserves a nested chmod", async () => {
  const bash = new RustWasmBash({profile:"overlay-cow-fs",files:{"/outer":"a","/inner":"b"}});
  try {
    const fs = bash.fs, root = await fs.lstat("/"), ancestors = [{path:"/",stat:root}];
    const outer = await fs.lstat("/outer"), inner = await fs.lstat("/inner");
    let calls = 0, nestedCalls = 0;
    await assert.rejects(fs.chmod("/outer",0o600,{expected:outer,parent:root,ancestors,commitGuard() {
      if (++calls < 3) return true;
      bash.chmodConditional("/inner",0o700,root,inner,ancestors,()=>!!++nestedCalls);
      return false;
    }}), {code:"ENOTSUP"});
    assert.deepEqual([calls,nestedCalls],[3,3]);
    assert.equal((await fs.lstat("/inner")).mode & 0o777,0o700);
    assert.equal((await fs.lstat("/outer")).ino,outer.ino);
    await fs.chmod("/outer",0o600,{expected:outer,parent:root,ancestors});
    assert.equal((await fs.lstat("/outer")).mode & 0o777,0o600);
  } finally { bash.dispose(); }
});

test("chmod forwards the original guard to the active companion", async () => {
  const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem();
  const bash = new RustWasmBash({ forceNative: false, companionFactory: () => ({ fs, shell: new Shell({ fs }) }) });
  try {
    await bash.fs.writeFile("/private", "", { mode: 0o600 });
    const expected = await bash.fs.lstat("/private"), parent = await bash.fs.lstat("/");
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

test("truncate uses the preferred block size when the default null device has no I/O block size", async () => {
  const bash = new RustWasmBash({ files: { "/f": "abc" }, symlinks: { "/alias": "/dev/null" } });
  try {
    const file = await bash.fs.stat("/f"), device = await bash.fs.stat("/alias");
    assert.deepEqual([file.ioBlockSize, file.preferredIoBlockSize], [65536, 4096]);
    assert.deepEqual([device.ioBlockSize, device.preferredIoBlockSize], [undefined, 4096]);
    const result = await bash.exec("truncate -os2 /alias");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "truncate: failed to truncate '/alias' at 8192 bytes: Invalid argument\n");
  } finally { bash.dispose(); }
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

test("awk retains filename spelling when opening and closing redirected streams", async () => {
  const sh = new RustWasmBash({cwd:"/",files:{"/f":"x\ny\n"}});
  try {
    const read = await sh.exec(`awk 'BEGIN{getline x < "./f"; getline y < "f"; print x,y; print (getline z < "/missing/../f"),ERRNO}'`);
    assert.equal(read.stdout, "x x\n-1 ENOENT: no such file or directory, readStream '/missing/../f'\n");
    for (const [name, message] of [["/missing/../f","ENOENT: no such file or directory, writeFile '/missing/../f'"],["/f/","ENOTDIR: not a directory, writeFile '/f/'"],["","ENOENT: no such file or directory ''"]]) {
      const r = await sh.exec(`awk 'BEGIN{print "wrong" > "${name}"}'`);
      assert.deepEqual([r.exitCode,r.stderr,Buffer.from(await sh.fs.readFile("/f")).toString()], [1,"awk: "+message+"\n","x\ny\n"]);
    }
    const r = await sh.exec(`awk 'BEGIN{print 1 > "./f";print 2 > "f";print close("/./f"),close("/f")}'`);
    assert.deepEqual([r.stdout,Buffer.from(await sh.fs.readFile("/f")).toString()], ["0 0\n","2\n"]);
  } finally { sh.dispose(); }
});

test("awk named getline keeps a byte cursor across separator changes and exposes read errors", async () => {
  const sh = new RustWasmBash({files:{"/f":Buffer.from([255,13,10,58,98,58,10])}});
  try {
    const r = await sh.exec(`awk 'BEGIN{getline x < "/f";RS=":";getline y < "/f";getline z < "/f";print x,y,z,NR;print (getline a < "/dev/stdin"),a;print (getline b < "/missing"),ERRNO,close("/missing")}'`, {stdin:"hi:there:"});
    assert.deepEqual([r.exitCode,r.stderr,Buffer.from(r.stdoutBytes)], [0,"",Buffer.concat([
      Buffer.from([255,13]),Buffer.from("  b 0\n1 hi\n-1 ENOENT: no such file or directory, readStream '/missing' -1\n"),
    ])]);
    const script = `awk 'BEGIN{getline x < "/f";print length(x)}'`;
    await assert.rejects(sh.exec(script, {limits:{maxFileSystemOperations:1}}), {limit:"maxFileSystemOperations"});
    assert.equal((await sh.exec(script, {limits:{maxInputBytes:0, maxFileSystemOperations:2}})).stdout, "2\n");
  } finally { sh.dispose(); }
});

test("awk file and descriptor redirections preserve bytes and close releases the filename", async () => {
  const sh = new RustWasmBash({files:{"/f":"prefix"}});
  try {
    const r = await sh.exec(`awk '{print >> "/f"; print > "/dev/stderr"; print close("/f") > "/dev/stdout"; print > "/f"}'`, {stdin:Buffer.from([255,10,128,10])});
    assert.deepEqual([r.exitCode,r.stdout,[...r.stderrBytes],[...await sh.fs.readFile("/f")]], [0,"0\n0\n",[255,10,128,10],[128,10]]);
    const missing = await sh.exec(`awk 'BEGIN{print "before";print 1 > "/missing/f"; print "after"}'`);
    assert.deepEqual([missing.exitCode,missing.stdout,missing.stderr], [1,"before\n","awk: ENOENT: no such file or directory, writeFile '/missing/f'\n"]);
  } finally { sh.dispose(); }
});

test("awk string functions address input bytes and change only ASCII case", async () => {
  const sh = new RustWasmBash();
  try {
    const stdin = Buffer.from("61ff80620ac389410a", "hex");
    const result = await sh.exec("awk '{c=substr($0,2,1); print length($0),index($0,c),index($0,\"b\"),c,tolower($0),toupper($0)}'", {stdin});
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes).toString("hex")],
      [0, "", "342032203420ff2061ff80622041ff80420a3320322030208920c3896120c389410a"]);
  } finally { sh.dispose(); }
});

test("awk splits fields on AWK whitespace or individual bytes for an empty separator", async () => {
  const sh = new RustWasmBash();
  try {
    const stdin = Buffer.from("c389090d0a", "hex");
    for (const [program, expected] of [
      ['{print NF,$2,split($0,a," ",s),a[2],s[1]}', "32200d2032200d20090a"],
      ['BEGIN{FS=""}{print NF,$1,$2,split($0,a),a[2]}', "3420c32089203420890a"],
    ]) {
      const r = await sh.exec("awk '" + program + "'", {stdin});
      assert.deepEqual([r.exitCode, r.stderr, Buffer.from(r.stdoutBytes).toString("hex")], [0, "", expected]);
    }
  } finally { sh.dispose(); }
});

test("awk integer formats retain big signed values and wrap unsigned values to 32 bits", async () => {
  const sh = new RustWasmBash();
  try {
    const r = await sh.exec(`awk '{printf "%+d %u %#x %#o %X\\n",$0,$0,$0,$0,$0}'`, {stdin:"-1\n18446744073709551616\n4294967297\n-0.25\n"});
    assert.deepEqual([r.exitCode,r.stderr,r.stdout], [0,"",
      "-1 4294967295 0xffffffff 037777777777 FFFFFFFF\n+18446744073709551616 0 0x0 00 0\n+4294967297 1 0x1 01 1\n0 0 0x0 00 0\n"]);
  } finally { sh.dispose(); }
});

test("awk printf and sprintf measure string width and precision in input bytes", async () => {
  const sh = new RustWasmBash();
  try {
    const script = `awk '{printf "[%4.2s][%-4.1s][%.*s]\\n",$0,$0,-1,$0;print sprintf("[%4s]",$0)}'`;
    const r = await sh.exec(script, {stdin:Buffer.from("c3a9610aff80610a","hex")});
    const expected = "5b2020c3a95d5bc32020205d5bc3a9615d0a5b20c3a9615d0a"
      + "5b2020ff805d5bff2020205d5bff80615d0a5b20ff80615d0a";
    assert.deepEqual([r.exitCode,r.stderr,Buffer.from(r.stdoutBytes).toString("hex")], [0,"",expected]);
  } finally { sh.dispose(); }
});

test("awk reads the entire program before actions, file writes or stdin", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [source, message] of [
      ['BEGIN{print 1 > "/out"} 0{print 1e999}', "non-finite numeric literal"],
      ['BEGIN{print 1} function unused(){return 1.0e+309}', "non-finite numeric literal"],
      ['{ print $1 / 1e999 }', "non-finite numeric literal"],
      ['BEGIN{print 1} /unfinished', "unterminated regular expression literal"],
      ['BEGIN{print 1} { print "oops\n" }', "newline in string literal"],
      ['BEGIN{print 1} { print 2;', "unterminated action block"],
    ]) {
      let reads = 0;
      const r = await sh.exec("awk '" + source + "'", {stdin:{async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("3\n"); }}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr,reads], [2,"","awk: "+message+"\n",0], source);
      await assert.rejects(sh.fs.readFile("/out"));
    }
    const good = await sh.exec(`awk 'BEGIN { n1e999 = 2; # ignored } / " 1e999
      print n1e999, "1e999", "x" ~ /[a/#]1e999/, 1e-999 }'`);
    assert.deepEqual([good.exitCode,good.stdout,good.stderr], [0,"2 1e999 0 0\n",""]);
  } finally { sh.dispose(); }
});

test("awk resolves function names and arity before executing the program", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [source, message] of [
      ["0 { missing(a[1,2], nested(3)) }", "unsupported function 'nested'"],
      ["function f(a) {} END { f(1,2) }", "invalid argument count for 'f'"],
      ["{ print substr($0) }", "invalid argument count for 'substr'"],
      ["function f(a,a) {}", "duplicate function parameter"],
      ["function f(substr) {}", "reserved function parameter"],
      ["function f() {} function f(x) {}", "duplicate or reserved function 'f'"],
      ["function int(x) {}", "duplicate or reserved function 'int'"],
      ["function f();", "expected '{' at byte 39"],
      ["{ print chr(1) }", "unsupported function 'chr'"],
      ["{ print sqrt }", "reserved variable 'sqrt'"],
    ]) {
      let reads = 0;
      const r = await sh.exec(`awk 'BEGIN { print 1 > "/out" } ${source}'`, {
        stdin: {async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("x"); }},
      });
      assert.deepEqual([r.exitCode,r.stdout,r.stderr,reads], [2,"","awk: "+message+"\n",0], source);
      await assert.rejects(sh.fs.readFile("/out"));
    }
    for (const [cmd, output] of [
      [`awk 'BEGIN { x=2; print chr(2), length ("abc"), x (3) } function chr(x,y) {return x+40}'`, "42 3 23\n"],
      [`awk --load=ordchr.so 'BEGIN { print chr (65), ord("A") }'`, "A 65\n"],
      [`printf 'abcd\\n' | awk '{ print length }'`, "4\n"],
    ]) {
      const r = await sh.exec(cmd);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,output,""], cmd);
    }
  } finally { sh.dispose(); }
});

test("awk ordchr reads and writes bytes, including through redirection", async () => {
  const sh = new RustWasmBash({files:{"/bytes":Uint8Array.of(0xfe,0x0a)}});
  try {
    const r = await sh.exec(`awk -lordchr 'BEGIN { printf "%s%s%s%s",chr(-1),chr(321),chr(1e100),chr(-258.75) > "/out"; print ord("🍎"),ord("") } {print ord($0)}' /bytes`);
    assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,"240 0\n254\n",""]);
    assert.deepEqual([...await sh.fs.readFile("/out")], [255,65,0,254]);
    const bad = await sh.exec(`awk -lordchr 'BEGIN {print chr("1e999"); print "unreachable"}'`);
    assert.deepEqual([bad.exitCode,bad.stdout,bad.stderr], [2,"","awk: invalid numeric argument in 'chr'\n"]);
  } finally { sh.dispose(); }
});

test("awk calendar uses the shell zone, UTC override and formatter flags", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [zone, expr, expected] of [
      ["America/New_York", 'mktime("2024 11 03 01 30 00 0"), mktime("2024 11 03 01 30 00 1")', "1730615400 1730611800"],
      ["GMT-5:45:30", 'strftime("%T %::z %Z",0)', "05:45:30 +05:45:30 GMT"],
      ["Bad/Zone", 'strftime("%F",0)', null],
      ["Bad/Zone", 'strftime("%D|%_D|%-D|%g|%y",-62198755200,1)', "01/01/01|01/01/ 1|01/01/1|02|01"],
      ["UTC", 'length(strftime("x%-17000000N",0)),mktime("2000 1 1 0 0 0 999999999999999999999")', "2 946684800"],
    ]) {
      const r = await sh.exec(`TZ=${zone} awk 'BEGIN { print 1; print ${expr} }'`);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], expected === null
        ? [1,"1\n","awk: internal error\n"] : [0,"1\n" + expected + "\n",""], expr);
    }
  } finally { sh.dispose(); }
});

test("awk systime returns whole seconds on either side of the Unix epoch", async t => {
  let ms = 0;
  t.mock.method(Date, "now", () => ms);
  const sh = new RustWasmBash();
  try {
    for (const [instant, seconds] of [[-1,-1],[1999,1],[2208988800999,2208988800]]) {
      ms = instant;
      const r = await sh.exec(`awk 'BEGIN { printf "%.0f",systime() }'`);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,String(seconds),""]);
    }
  } finally { sh.dispose(); }
});

test("awk validates array targets in function calls and resolves grouped names", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [expr,message] of [
      ['split("a",a[1])', "split requires an array variable as its second argument"],
      ['split("a",a,",",length)', "split requires an array variable as its second argument"],
      ['match("a",/a/,(a,b))', "match requires an array variable as its third argument"],
      ['asort((a)+(b))', "asort/asorti requires array variables"],
      ['asorti(a,42)', "asort/asorti requires array variables"],
      ['asorti(a,42,42)', "invalid argument count for 'asorti'"],
    ]) {
      const r = await sh.exec(`awk 'BEGIN{print "ran"} 0{${expr}}'`);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [2,"","awk: "+message+"\n"], expr);
    }
    const r = await sh.exec(`awk 'BEGIN {
      split("z,a",((a)),",",(s)); asort((a),((b))); asorti((a),(c));
      match("abc",/(b)/,(m)); print b[1],s[1],c[2],m[1]
    }'`);
    assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,"a , 2 b\n",""]);
  } finally { sh.dispose(); }
});

test("awk keeps source-file bytes and parses the program before opening debugger commands", async () => {
  const sh = new RustWasmBash({files:{"/quit":"quit\n"}});
  try {
    await sh.fs.writeFile("/program", Buffer.from([66,69,71,73,78,123,112,114,105,110,116,32,34,255,34,125]));
    const raw = await sh.exec("awk -f /program");
    assert.deepEqual([raw.exitCode, Buffer.from(raw.stdoutBytes).toString("hex")], [0, "ff0a"]);
    for (const [source, error] of [
      ["BEGIN{print 1e999}", "non-finite numeric literal"],
      ['BEGIN{print "é"; print é}', "unsupported token 'Ã' at byte 24"],
      ["BEGIN{print &}", "unsupported token '&' at byte 12"],
    ]) {
      await sh.fs.writeFile("/program", Buffer.from(source));
      for (const debug of ["/quit","/missing"]) {
        const r = await sh.exec("awk -D"+debug+" -f /program");
        assert.deepEqual([r.exitCode,r.stdout,r.stderr], [2,"","awk: "+error+"\n"],source);
      }
    }
  } finally { sh.dispose(); }
});

test("awk rejects non-finite arithmetic and math functions before subsequent writes", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [expr, error] of [
      ["2^1024","non-finite arithmetic result"], ["x=1e308; x*=10","non-finite arithmetic result"],
      ["(-1)^0.5","non-finite arithmetic result"], ["sqrt(-1)","invalid mathematical result in 'sqrt'"],
      ["log(0)","invalid mathematical result in 'log'"], ["exp(1000)","invalid mathematical result in 'exp'"],
    ]) {
      const r = await sh.exec("awk 'BEGIN{print 1;"+expr+";print 2}END{print 3}'");
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[2,"1\n","awk: "+error+"\n"],expr);
    }
  } finally { sh.dispose(); }
});

test("awk distinguishes signed exponents and prefix operators from binary arithmetic", async () => {
  const sh = new RustWasmBash();
  try {
    const r = await sh.exec("awk 'BEGIN{v1e=9;i=2; print 1e-2*2,2*1e+2,001,v1e-2; print -2^2,2^-2,2^3^2,3*-2,(3)- -2; print 20/5%3,20%6/2,++i*2,2*i++,i}'");
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"0.02 200 1 7\n-4 0.25 512 -6 5\n1 1 6 6 4\n",""]);
  } finally { sh.dispose(); }
});

test("awk coerces decimal exponents, incomplete exponents and signed hexadecimal input prefixes", async () => {
  const sh = new RustWasmBash();
  try {
    const result = await sh.exec("awk '{print $0+0}'", {stdin:"1.5e2units\n-.25E+2\n+.5e-1end\n2e+\n2.3.4\n-0X20rest\n0x\n"});
    assert.deepEqual([result.exitCode,result.stdout,result.stderr], [0,"150\n-25\n0.05\n2\n2.3\n-32\n0\n",""]);
  } finally { sh.dispose(); }
});

test("awk evaluates numeric rule patterns once and retains zero-pattern input processing", async () => {
  const sh = new RustWasmBash();
  try {
    const r = await sh.exec("awk 'BEGIN{v=0} 0e-2;0e+2;1e-2;v{print NR}{v=1} END{print NR}'", {stdin:"one\ntwo\n"});
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"one\ntwo\n2\n2\n",""]);
  } finally { sh.dispose(); }
});

test("awk charges each streamed memory operand once and flushes before getline opens it", async () => {
  const sh = new RustWasmBash({files:{"/f":"a\nb\n"}});
  try {
    for (const [args, cost, stdout] of [["'BEGIN{getline;print}' /f",1,"a\n"], ["1 /f /f",2,"a\nb\na\nb\n"]]) {
      await assert.rejects(sh.exec("awk "+args,{limits:{maxFileSystemOperations:cost-1}}),{limit:"maxFileSystemOperations"});
      const r = await sh.exec("awk "+args,{limits:{maxFileSystemOperations:cost}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,stdout,""]);
    }
    for (const [ops, limit] of [[0,"maxFileSystemOperations"],[1,"maxInputBytes"]]) {
      await assert.rejects(sh.exec("awk 'BEGIN{getline;print}' /f",{limits:{maxFileSystemOperations:ops,maxInputBytes:3}}),{limit});
    }
    for (const [limits,length] of [[{},0],[{maxInputBytes:100},3]]) {
      const r = await sh.exec("awk 'BEGIN{print 123;getline;print length($0)}' /o >/o",{limits});
      assert.equal(r.exitCode,0); assert.equal(Buffer.from(await sh.fs.readFile("/o")).toString(),"123\n"+length+"\n");
    }
    for (const [limits,output] of [[{}, "x\ny\nx\n"], [{maxInputBytes:100},"x\ny\nx\ny\n"]]) {
      const stdin = {async *[Symbol.asyncIterator]() { yield Buffer.from("x\ny"); }};
      const r = await sh.exec("awk 1 - /o >/o",{limits,stdin});
      assert.equal(r.exitCode,0); assert.equal(Buffer.from(await sh.fs.readFile("/o")).toString(),output);
    }
  } finally { sh.dispose(); }
});

test("awk admits a direct memory operand before charging the read at the start of record processing", async () => {
  const sh = new RustWasmBash({files:{"/f":"abc\ndef\n"}});
  try {
    await sh.fs.symlink("/f","/link");
    for (const path of ["/f","/link"]) {
      const cmd = "awk 'BEGIN{print 1} {print;exit}' " + path;
      await assert.rejects(sh.exec(cmd,{limits:{maxFileSystemOperations:0,maxInputBytes:7}}), {limit:"maxInputBytes"});
      await assert.rejects(sh.exec(cmd,{limits:{maxFileSystemOperations:0,maxInputBytes:8}}), {limit:"maxFileSystemOperations"});
      const r = await sh.exec(cmd,{limits:{maxFileSystemOperations:1,maxInputBytes:8}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"1\nabc\n",""]);
    }
    const r = await sh.exec("awk 1 /dev/stdin",{stdin:"from stdin\n"});
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"from stdin\n",""]);
  } finally { sh.dispose(); }
});

test("awk publishes completed output before pulling stdin and keeps it on failure", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const seen = [];
    const stdin = {async *[Symbol.asyncIterator]() {
      for (const chunk of ["a\nb\n","c\n",null]) {
        seen.push(Buffer.from(await sh.fs.readFile("/o")).toString());
        if (chunk === null) throw Error("private");
        yield Buffer.from(chunk);
      }
    }};
    const r = await sh.exec("awk 'BEGIN{print 1} {print;getline a;print a}' >/o 2>&1", {stdin});
    assert.deepEqual(seen, ["1\n", "1\na\nb\n", "1\na\nb\nc\n"]);
    assert.deepEqual([r.exitCode,r.stdout,r.stderr], [1,"",""]);
    assert.equal(Buffer.from(await sh.fs.readFile("/o")).toString(), seen[2]+"awk: internal error\n");
    const failed = await sh.exec("awk 'BEGIN{print 1;print 1/0;print 9}' 2>&1");
    assert.deepEqual([failed.exitCode,failed.stdout,failed.stderr], [2,"1\nawk: division by zero\n",""]);
    let pulls = 0;
    await assert.rejects(sh.exec("awk 1", {limits:{maxOutputBytes:6},stdin:{async *[Symbol.asyncIterator](){
      for(let i=0;i<5;i++){pulls++;yield Buffer.from("abc\n");}
    }}}), /maxOutputBytes/);
    assert.equal(pulls,2);
  } finally { sh.dispose(); }
});

test("awk reads only selected operands and shares the main reader with getline and END", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash({files: {"/f": "first\n"}});
  try {
    for (const [args, output, reads] of [
      ["'BEGIN{print 1}'", "1\n", 0], ["1 /f", "first\n", 0],
      ["'BEGIN{getline a; print FILENAME,NR,a; exit}' /f", "/f 1 first\n", 0],
      ["'{print;exit} END{getline a;print a}'", "a\nb\n", 1],
      ["'BEGIN{RS=\":\"}{print;RS=\"\\n\";getline a;print a;exit}'", "a\nb\n\nc\n", 2],
      ["'BEGIN{RS=\"\"} {print;exit}'", "a\nb\n:c\n", 3],
      ["1 - -", "a\nb\n:c\n\nd\n", 3],
    ]) {
      let pulls = 0;
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const chunk of ["a\nb\n", ":c\n", "\nd"]) { pulls++; yield Buffer.from(chunk); }
      }};
      const r = await sh.exec("awk " + args, {stdin});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr,pulls],[0,output,"",reads],args);
    }
    let touched = false;
    const help = await sh.exec("awk --help", {stdin:{async *[Symbol.asyncIterator]() { touched = true; throw Error(); }}});
    assert.equal(help.exitCode,0); assert.equal(touched,false);
  } finally { sh.dispose(); }
});

test("a filesystem quota rejects descriptor setup before truncation or the next stdin pull", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    for (const [ops, expected, reads] of [[3, "saved", 0], [4, "", 1], [5, "one\n", 2], [6, "one\ntwo\n", 2]]) {
      await sh.fs.writeFile("/out", Buffer.from("saved"));
      let pulls = 0;
      const run = sh.exec("cat > /out 2>&1", {limits:{maxFileSystemOperations:ops}, stdin:{async *[Symbol.asyncIterator]() {
        for (const chunk of ["one\n", "two\n"]) { pulls++; yield Buffer.from(chunk); }
      }}});
      if (ops < 6) await assert.rejects(run, {limit:"maxFileSystemOperations"});
      else assert.equal((await run).exitCode, 0);
      assert.deepEqual([Buffer.from(await sh.fs.readFile("/out")).toString(), pulls], [expected, reads]);
    }
  } finally { sh.dispose(); }
});

test("redirected output preserves each accepted 64 KiB descriptor write", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    for (const [redirect, limit, expected] of [
      [">/out", "maxFileSystemOperations", 65536], [">>/out", "maxOutputBytes", 65539],
      [">/dev/null", "maxFileSystemOperations", 3],
    ]) {
      await sh.fs.writeFile("/out", Buffer.from("old"));
      let pulls = 0;
      await assert.rejects(sh.exec("cat " + redirect + " 2>&1", {
        limits:{[limit]:limit === "maxOutputBytes" ? 65536 : 5},
        stdin:{async *[Symbol.asyncIterator]() { pulls++; yield Buffer.alloc(65537, 97); pulls++; yield Buffer.of(98); }},
      }), {limit});
      assert.deepEqual([pulls, (await sh.fs.readFile("/out")).length], [1, expected], redirect);
    }
  } finally { sh.dispose(); }
});

test("rg publishes matches and read errors in operand order", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash({files:{"/f":"hit file\n"}});
  try {
    const contents = async () => Buffer.from(await sh.fs.readFile("/out")).toString();
    const seen = [];
    const result = await sh.exec("rg hit /f - /f >/out 2>&1", {stdin:{async *[Symbol.asyncIterator]() {
      seen.push(await contents());
      yield Buffer.from("hit stdin\npartial");
      seen.push(await contents());
      throw Error("input failed");
    }}});
    assert.deepEqual(seen, ["/f:hit file\n", "/f:hit file\n<stdin>:hit stdin\n"]);
    assert.deepEqual([result.exitCode,await contents()], [2,seen[1]+"rg: internal error\n/f:hit file\n"]);
  } finally { sh.dispose(); }
});

test("rg publishes multiline output at diagnostics and whole-match boundaries", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash({files:{"/f":"ab\nb\n"}});
  try {
    const contents = async () => Buffer.from(await sh.fs.readFile("/out")).toString();
    for (const [flags, before, after] of [
      ["", "", "/f:ab\n/f:b\n"], ["-o", "/f:b\n/f:b\n", "/f:b\n/f:b\n"],
    ]) {
      let seen;
      const r = await sh.exec("rg -U "+flags+" 'b\\nb' /f - /f >/out 2>&1", {stdin:{async *[Symbol.asyncIterator]() {
        seen = await contents();
        yield Buffer.from("ab\nb\n");
        throw Error("input failed");
      }}});
      assert.deepEqual([seen,r.exitCode,await contents()], [before,2,after+"rg: internal error\n"+after],flags);
    }
  } finally { sh.dispose(); }
});

test("rg multiline keeps a published heading when the next output write exceeds the limit", async () => {
  const sh = new RustWasmBash({files:{"/f":"λ"+"x".repeat(65533)+"b\nb\n"}});
  try {
    await assert.rejects(sh.exec("rg --heading -H -U 'b\\nb' /f >/out", {limits:{maxOutputBytes:65535}}), {limit:"maxOutputBytes"});
    assert.equal(Buffer.from(await sh.fs.readFile("/out")).toString(), "/f\n");
  } finally { sh.dispose(); }
});

test("rg reports the ancestor that denied a path lookup", async () => {
  const sh = new RustWasmBash({files:{"/locked/sub/f":"hit\n"}});
  try {
    await sh.fs.chmod("/locked", 0o600);
    for (const args of ["--files /locked/sub/f","hit /locked/sub/f/","-c hit /locked/sub/./f"]) {
      const r = await sh.exec("rg "+args);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [2,"","rg: EACCES: permission denied, lstat '/locked/sub'\n"],args);
    }
  } finally { sh.dispose(); }
});

test("overlay redirections share file contents but keep independent offsets", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    const script = "exec 3>/out 4>/out; printf abc >&3; printf XX >&4; printf z >&3";
    await assert.rejects(sh.exec(script,{limits:{maxOutputBytes:5}}),{limit:"maxOutputBytes"});
    assert.equal(sh.readText("/out"),"XXc");
    assert.equal((await sh.exec(script,{limits:{maxOutputBytes:6,maxFileSystemOperations:13}})).exitCode,0);
    assert.equal(sh.readText("/out"),"XXcz");
    const r = await sh.exec("exec 3>/out; printf abc >&3; mv /out /old; printf z >&3");
    assert.deepEqual([r.exitCode,sh.readText("/old"),sh.readText("/out")],[0,"abc","abcz"]);
  } finally { sh.dispose(); }
});

test("overlay output redirection charges access before it creates, appends or truncates", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/f":"keep","/readonly":{content:"keep",mode:0o400}}});
  try {
    for (const [command,path,after] of [[": >/f","/f",""],[": >>/new","/new",""],["set -C; : >/exclusive","/exclusive",""]]) {
      await assert.rejects(sh.exec(command,{limits:{maxFileSystemOperations:3}}),{limit:"maxFileSystemOperations"});
      if (path === "/f") assert.equal(sh.readText(path),"keep");
      else await assert.rejects(sh.fs.stat(path),{code:"ENOENT"});
      assert.equal((await sh.exec(command,{limits:{maxFileSystemOperations:4}})).exitCode,0);
      assert.equal(sh.readText(path),after);
    }
    await assert.rejects(sh.exec(": >/readonly",{limits:{maxFileSystemOperations:2}}),{limit:"maxFileSystemOperations"});
    assert.match((await sh.exec(": >/readonly",{limits:{maxFileSystemOperations:3}})).stderr,/Permission denied/);
  } finally { sh.dispose(); }
});

test("rg selects files by the built-in type globs in argument order", async () => {
  const sh = new RustWasmBash({files:Object.fromEntries([".bashrc",".other","CMakeLists.txt","Dockerfile.prod","x.h","x.mts","x.vue","unknown.xyz"].map(name => ["/d/"+name,"value"]))});
  try {
    for (const [args,names] of [
      ["-tall",[".bashrc","CMakeLists.txt","Dockerfile.prod","x.h","x.mts","x.vue"]],
      ["-Tall",["unknown.xyz"]],["-tc -Th",[]],["-Th -tc",["x.h"]],["--type-not=js --type=js",["x.vue"]],
      ["-tdocker",["Dockerfile.prod"]],["-tsh",[".bashrc"]],["-tts",["x.mts"]],
    ]) {
      const r = await sh.exec("rg --files "+args+" /d");
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[names.length ? 0 : 1,names.map(name=>"/d/"+name+"\n").join(""),""],args);
    }
  } finally { sh.dispose(); }
});

test("rg stops at a denied operand on mounted and overlay filesystems", async () => {
  for (const profile of ["strict-budgets-mount-dev","overlay-cow-fs"]) {
    const sh = new RustWasmBash({profile,files:{"/locked/f":"a\nb\n","/ok":"a\nb\n"}});
    try {
      await sh.fs.chmod("/locked", 0o600);
      const denied = "rg: EACCES: permission denied, "+(profile === "overlay-cow-fs" ? "overlay '/locked'" : "capabilitiesFor '/locked/f'")+"\n";
      for (const [args,prior] of [["--stats a","/ok:a\n"],["-U --stats 'a\\nb'","/ok:a\n/ok:b\n"],["--files --stats","/ok\n"]]) {
        const r = await sh.exec("rg "+args+" /ok /locked/f /ok >/out 2>&1");
        assert.deepEqual([r.exitCode,sh.readText("/out")],[2,prior+denied],profile+" "+args);
      }
    } finally { sh.dispose(); }
  }
});

test("rg charges metadata and read capability lookups on mounted and overlay filesystems", async () => {
  for (const profile of ["strict-budgets-mount-dev","overlay-cow-fs"]) {
    const sh = new RustWasmBash({profile,files:{"/f":"a\nb\n"}});
    try {
      for (const [args,operations] of [["--files",2],["-c a",4],["-U 'a\\nb'",4]]) {
        await assert.rejects(sh.exec("rg "+args+" /f", {limits:{maxFileSystemOperations:operations-1}}), {limit:"maxFileSystemOperations"});
        assert.equal((await sh.exec("rg "+args+" /f", {limits:{maxFileSystemOperations:operations}})).exitCode,0);
      }
    } finally { sh.dispose(); }
  }
});

test("rg admits explicit memory files once and charges the complete input in count mode", async () => {
  const sh = new RustWasmBash({files:{"/f":"a\nb\na\n","/out":"old"}});
  try {
    const read = async () => Buffer.from(await sh.fs.readFile("/out")).toString();
    for (const [args,expected] of [["a","a\na\n"],["-c a","2\n"],["-l a","/f\n"]]) {
      const r = await sh.exec("rg "+args+" /f >/out 2>&1",{limits:{maxFileSystemOperations:6}});
      assert.deepEqual([r.exitCode,await read()],[0,expected],args);
      await assert.rejects(sh.exec("rg "+args+" /f >/out 2>&1",{limits:{maxInputBytes:5}}), {limit:"maxInputBytes"});
      assert.equal(await read(),"");
    }
    await assert.rejects(sh.exec("rg -U 'a\\nb' /f >/out 2>&1",{limits:{maxInputBytes:5}}),{limit:"maxInputBytes"});
    assert.equal(await read(),"");
    await sh.fs.symlink("/f","/link");
    await assert.rejects(sh.exec("rg -c a /link >/out 2>&1",{limits:{maxFileSystemOperations:6}}),{limit:"maxFileSystemOperations"});
    assert.equal(await read(),"");
  } finally { sh.dispose(); }
});

test("rg keeps earlier directory matches when a later file chunk contains a NUL", async () => {
  const sh = new RustWasmBash({files:{"/d/f":"a\n"+"b".repeat(65536)+"\na\0b\n"}});
  try {
    const result = await sh.exec("rg a /d");
    assert.deepEqual([result.exitCode,result.stdout,result.stderr], [0,"/d/f:a\n",""]);
  } finally { sh.dispose(); }
});

test("rg JSON preserves Unicode and uses compact JSON escapes in lines and submatches", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const line = "a\b\f\x01\ue080";
    const r = await sh.exec("rg --json 'a.*' >/out", {stdin: Buffer.from(line + "\n")});
    assert.equal(r.exitCode, 0);
    const [begin, match, end] = Buffer.from(await sh.fs.readFile("/out")).toString().trimEnd().split("\n");
    const data = {path:{text:"<stdin>"}, lines:{text:line + "\n"}, line_number:1, absolute_offset:0,
      submatches:[{match:{text:line}, start:0, end:Buffer.byteLength(line)}]};
    assert.equal(match, JSON.stringify({type:"match", data}));
    assert.equal(JSON.parse(end).data.stats.bytes_printed, Buffer.byteLength(begin + "\n" + match + "\n"));
  } finally { sh.dispose(); }
});

test("rg JSON publishes complete batches, reports binary lines, and keeps failed input out of the summary", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const events = async () => Buffer.from(await sh.fs.readFile("/out")).toString().trimEnd().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const seen = [];
    const r = await sh.exec("rg --json -B1 a >/out", {stdin:{async *[Symbol.asyncIterator]() {
      yield Uint8Array.of(255, 0, 97, 10);
      seen.push((await events()).map(e => e.type));
      throw Error("failed input");
    }}});
    assert.deepEqual(seen, [["begin", "context", "match"]]);
    assert.deepEqual([r.exitCode, r.stderr], [2, "rg: internal error\n"]);
    const records = await events();
    assert.deepEqual(records.map(e => e.type), ["begin", "context", "match", "summary"]);
    assert.deepEqual(records[1].data.lines, {bytes:"/wo="});
    assert.equal(records[2].data.absolute_offset, 2);
    assert.equal(records[3].data.stats.bytes_printed, 0);
    assert.equal(records[3].data.stats.searches, 0);
  } finally { sh.dispose(); }
});

test("rg streams matches with statistics and discards the totals of a failed input", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const seen = [];
    const r = await sh.exec("rg --stats -n a >/out 2>&1", {stdin:{async *[Symbol.asyncIterator]() {
      yield Buffer.from("aa\n");
      seen.push(Buffer.from(await sh.fs.readFile("/out")).toString());
      throw Error("input failed");
    }}});
    assert.deepEqual([r.exitCode, seen], [2, ["1:aa\n"]]);
    assert.match(Buffer.from(await sh.fs.readFile("/out")).toString(),
      /^1:aa\nrg: internal error\n\n0 matches\n0 matched lines\n0 files contained matches\n0 files searched\n0 bytes printed\n0 bytes searched\n/);
    const limited = await sh.exec("rg --stats -m1 a >/out", {limits:{maxFileSystemOperations:5}, stdin:"a\na\n"});
    assert.equal(limited.exitCode, 0);
    assert.match(Buffer.from(await sh.fs.readFile("/out")).toString(), /^a\n\n1 matches\n1 matched lines\n/);
  } finally { sh.dispose(); }
});

test("rg publishes line and context batches and closes stdin when output stops", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const seen = [];
    const result = await sh.exec("rg -nC1 hit >/matches", {stdin:{async *[Symbol.asyncIterator]() {
      for (const chunk of ["before\nh", "it\n", "after\n", "binary\0tail\n", "unreachable"]) {
        seen.push(Buffer.from(await sh.fs.readFile("/matches")).toString());
        yield Buffer.from(chunk);
      }
    }}});
    assert.deepEqual(seen, ["", "", "1-before\n2:hit\n", "1-before\n2:hit\n3-after\n"]);
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await sh.fs.readFile("/matches")).toString(),
      '1-before\n2:hit\n3-after\nbinary file matches (found "\\0" byte around offset 23)\n');
    let pulls = 0, closed = 0;
    await assert.rejects(sh.exec("rg -n a", {limits:{maxOutputBytes:1}, stdin:{async *[Symbol.asyncIterator]() {
      try { for (const chunk of ["a\n","b\n","a\n"]) { pulls++; yield Buffer.from(chunk); } } finally { closed++; }
    }}}), {limit:"maxOutputBytes"});
    assert.deepEqual([pulls,closed], [1,1]);
  } finally { sh.dispose(); }
});

test("grep accounts for named input setup even when max-count is zero", async () => {
  const sh = new RustWasmBash();
  try {
    const cmd = "grep -m0 x /missing /missing";
    await assert.rejects(sh.exec(cmd, {limits:{maxFileSystemOperations:1}}), {limit:"maxFileSystemOperations"});
    // With a finite input quota the named source is only opened on its first pull.
    const limits = {maxFileSystemOperations:1, maxInputBytes:16};
    assert.equal((await sh.exec(cmd, {limits})).exitCode, 1);
    assert.equal((await sh.exec("grep -m0 x ''", {limits})).exitCode, 1);
    await assert.rejects(sh.exec("grep -n x /missing", {limits}), {limit:"maxFileSystemOperations"});
  } finally { sh.dispose(); }
});

test("grep publishes context before the next pull and closes stdin on output failure", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const seen = [];
    const r = await sh.exec("grep -nC1 hit >/matches", {stdin:{async *[Symbol.asyncIterator](){
      for (const chunk of ["no\nh", "it\n", "tail\n", "miss\n"]) {
        seen.push(Buffer.from(await sh.fs.readFile("/matches")).toString());
        yield Buffer.from(chunk);
      }
    }}});
    assert.deepEqual([r.exitCode,r.stderr,seen], [0,"",["","","1-no\n2:hit\n","1-no\n2:hit\n3-tail\n"]]);
    for (const args of ["-n a","-E a","-C1 a","-o a"]) {
      let pulls = 0, closed = 0;
      await assert.rejects(sh.exec("grep "+args, {limits:{maxOutputBytes:1},stdin:{async *[Symbol.asyncIterator](){
        try { for (const chunk of ["a\n","b\n","a\n"]) { pulls++; yield Buffer.from(chunk); } } finally { closed++; }
      }}}), {limit:"maxOutputBytes"});
      assert.deepEqual([pulls,closed],[1,1],args);
    }
  } finally { sh.dispose(); }
});

test("grep publishes literal matches before the next stdin pull and stops on write or validation failure", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash();
  try {
    const seen = [];
    const stdin = {async *[Symbol.asyncIterator]() {
      for (const chunk of ["a\nmiss\n","a","é\r\n","a\ninvalid\0\n","unreachable"]) {
        seen.push(Buffer.from(await bash.fs.readFile("/matches")).toString());
        yield Buffer.from(chunk);
      }
    }};
    const r = await bash.exec("grep '^a' - >/matches", {stdin});
    assert.deepEqual(seen, ["", "a\n", "a\n", "a\naé\r\n"]);
    assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, "", "grep: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n"]);
    assert.equal(Buffer.from(await bash.fs.readFile("/matches")).toString(), "a\naé\r\na\n");
    let pulls = 0;
    await assert.rejects(bash.exec("grep a", {limits: {maxOutputBytes: 6}, stdin: {async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 5; ++i) { pulls++; yield Buffer.from("abc\n"); }
    }}}), /maxOutputBytes/);
    assert.equal(pulls, 2);
  } finally { bash.dispose(); }
});

test("grep charges one direct memory file read before checking its input bytes", async () => {
  const sh = new RustWasmBash({files: {"/f":"abc\na\n"}});
  try {
    await sh.fs.symlink("/f", "/link");
    for (const path of ["/f", "/link"]) {
      await sh.fs.utimes("/f", 1, 1);
      const cmd = "grep a " + path;
      await assert.rejects(sh.exec(cmd, {limits: {maxFileSystemOperations:0, maxInputBytes:5}}), {limit:"maxFileSystemOperations"});
      assert.equal((await sh.fs.stat("/f")).atimeMs, 1);
      await assert.rejects(sh.exec(cmd, {limits: {maxFileSystemOperations:1, maxInputBytes:5}}), {limit:"maxInputBytes"});
      assert.notEqual((await sh.fs.stat("/f")).atimeMs, 1);
      const r = await sh.exec(cmd, {limits: {maxFileSystemOperations:1, maxInputBytes:6}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr], [0,"abc\na\n",""]);
    }
    const missing = await sh.exec("grep a /missing", {limits: {maxFileSystemOperations:1}});
    assert.deepEqual([missing.exitCode,missing.stderr], [2,"grep: ENOENT: no such file or directory, readFile '/missing'\n"]);
  } finally { sh.dispose(); }
});

test("grep with an option after the pattern validates batches at stdin chunk boundaries", {skip: !WebAssembly.Suspending}, async () => {
  const sh = new RustWasmBash();
  try {
    const error = "grep: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n";
    for (const [args, chunks, output, pulls] of [
      ["a -n", ["a\na\0\n","a\n"], "", 1],
      ["a -n", ["a\npart","ial\0\n","a\n"], "1:a\n", 2],
      ["a -n", ["a\n","a\0"], "1:a\n", 2],
      ["a -n", ["a\n",Buffer.from([255,10]),"a\n"], "1:a\n", 2],
    ]) {
      let pulled = 0;
      const r = await sh.exec("grep " + args, {stdin: {async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) { pulled++; yield Buffer.from(chunk); }
      }}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr,pulled], [2,output,error,pulls], args);
    }
  } finally { sh.dispose(); }
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

test("compression commands charge only their selected inputs and stop pulling at the shared limit", {skip: !WebAssembly.Suspending}, async () => {
  const bash = new RustWasmBash({files:{"/a":"abc\n","/b":"def\n"}});
  try {
    for (const cmd of ["gzip","bzip2","xz","lzma","zstd"]) {
      for (const [args, limited, pulls] of [["-c",true,2],["-c /a -",true,1],["-c /a /b",true,0],["-c /a",false,0],["--help",false,0]]) {
        let seen = 0;
        const stdin = {async *[Symbol.asyncIterator]() {
          for (let i = 0; i < 3; i++) { seen++; yield Buffer.from("abc\n"); }
        }};
        const run = bash.exec(cmd + " " + args, {stdin,limits:{maxInputBytes:6}});
        if (limited) await assert.rejects(run, {limit:"maxInputBytes"});
        else assert.equal((await run).exitCode,0);
        assert.equal(seen,pulls,cmd + " " + args);
      }
    }
    const twice = await bash.exec("gzip -c - - | gunzip -c", {stdin:"once"});
    assert.deepEqual([twice.exitCode,twice.stdout,twice.stderr],[0,"once",""]);
  } finally { bash.dispose(); }
});

test("named compression preserves aliased inputs and atomically replaces only the output entry", async () => {
  for (const profile of ["memory-fs", "overlay-cow-fs"]) {
    const bash = new RustWasmBash({ cwd: "/", ...(profile === "memory-fs" ? {} : { profile }) });
    try {
      const run = (s, options) => bash.exec(s, options);
      assert.equal((await run("printf original > /input; printf other > /other; ln -s /other /input.gz")).exitCode, 0);
      const traversal = await run("gzip /missing/../input");
      assert.equal(traversal.stderr, profile === "memory-fs"
        ? "gzip: ENOENT: no such file or directory, lstat '/missing/../input'\n"
        : "gzip: ENOENT: no such file or directory, overlay '/missing'\n");
      const symlink = await run("gzip -f /input");
      assert.equal(symlink.exitCode, 1, profile);
      assert.match(symlink.stderr, /destination is not a distinct regular file/);
      assert.equal((await run("cat /other /input")).stdout, "otheroriginal");
      assert.equal((await run("rm /input.gz")).exitCode, 0);
      if (profile === "memory-fs") {
        assert.equal((await run("ln /input /input.gz")).exitCode, 0);
        assert.equal((await run("gzip -f /input")).exitCode, 1);
        assert.equal((await run("rm /input.gz && ln /input /alias")).exitCode, 0);
        assert.equal((await run("gzip /input")).exitCode, 1);
        assert.equal((await run("ln /other /input.gz")).exitCode, 0);
      } else {
        await bash.fs.writeFile("/input.gz", "previous");
      }
      assert.equal((await run("gzip -f /input", { limits: { maxOutputBytes: 1 } })).exitCode, 0);
      assert.equal((await run("gunzip -c /input.gz; cat /other")).stdout, "originalother");
      if (profile === "memory-fs") assert.equal(bash.readText("/alias"), "original");
      assert.equal((await bash.fs.stat("/input.gz")).mode & 0o777, 0o600);
      assert.equal((await run("test -e /input")).exitCode, 1);
      await run("printf keep > /src; mkdir /src.gz");
      assert.equal((await run("gzip -f /src")).exitCode, 1);
      assert.equal((await run("cat /src")).stdout, "keep");
    } finally { bash.dispose(); }
  }
});

test("compression rejects overlapping plans before reading stdin or changing files", async () => {
  const bash = new RustWasmBash({ cwd: "/", files: { "/a": "original" } });
  try {
    let pulled = false;
    const stdin = { async *[Symbol.asyncIterator]() { pulled = true; yield Buffer.from("stdin"); } };
    const result = await bash.exec("gzip - /a /a", { stdin });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /multiple operands share a source or destination path/);
    assert.equal(pulled, false);
    assert.equal(bash.readText("/a"), "original");
    await assert.rejects(bash.fs.stat("/a.gz"), {code: "ENOENT"});
  } finally { bash.dispose(); }
});

test("failed compression publication retains the source and previous destination", async () => {
  const bash = new RustWasmBash({ cwd: "/", memoryFsOptions: { maxFileBytes: 16 } });
  try {
    await bash.fs.writeFile("/a", "raw");
    await bash.fs.writeFile("/a.gz", "old");
    for (const command of ["gzip -f /a", "gunzip -f /a.gz"]) {
      const result = await bash.exec(command);
      assert.notEqual(result.exitCode, 0, command);
      assert.deepEqual([bash.readText("/a"), bash.readText("/a.gz")], ["raw", "old"]);
    }
  } finally { bash.dispose(); }
});

test("compression retains files changed while an earlier operand is suspended", { skip: !WebAssembly.Suspending }, async () => {
  for (const path of ["/a", "/a.gz"]) {
    const bash = new RustWasmBash({ cwd: "/", files: { "/a": "before" } });
    try {
      const stdin = { async *[Symbol.asyncIterator]() {
        await bash.fs.writeFile(path, "new");
        yield Buffer.from("stdin");
      }};
      const r = await bash.exec("gzip -f - /a", { stdin });
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /EBUSY:/);
      assert.equal(bash.readText("/a"), path === "/a" ? "new" : "before");
      if (path === "/a.gz") assert.equal(bash.readText(path), "new");
      else await assert.rejects(bash.fs.stat("/a.gz"), {code: "ENOENT"});
    } finally { bash.dispose(); }
  }
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

test("pr writes completed rows before pulling more input and stops at output and page limits", { skip: !WebAssembly.Suspending }, async () => {
  const bash = new RustWasmBash({cwd:"/", files:{"/f":"file\n"}});
  try {
    for (const [args, chunks, limit, seen, output] of [
      ["-t", ["abc\n","def\n","ghi\n"], 6, ["","abc\n"], "abc\n"],
      ["-t", ["a","b\n","c"], 100, ["","","ab\n"], "ab\nc\n"],
      ["-t -l1 +1:1", ["a\n","b\n"], 100, [""], "a\n"],
      ["-t /f", ["unused"], 100, [], "file\n"],
      ["-tmJ -S: - -", ["a\n","b\n","c\n","d\n"], 100, ["","","a:b\n","a:b\n"], "a:b\nc:d\n"],
    ]) {
      await bash.fs.writeFile("/out", "");
      const observed = [];
      const stdin = {async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) { observed.push(bash.readText("/out")); yield Buffer.from(chunk); }
      }};
      const run = bash.exec("pr " + args + " >/out", {stdin, limits:{maxOutputBytes:limit}});
      if (limit === 6) await assert.rejects(run, {limit:"maxOutputBytes"});
      else assert.equal((await run).exitCode, 0);
      assert.deepEqual([observed,bash.readText("/out")], [seen,output], args);
    }
    const r = await bash.exec("pr -t /absent /f - / /f 2>&1", {stdin:Buffer.from([255,0,10])});
    assert.equal(r.exitCode, 1);
    assert.deepEqual(Buffer.from(r.stdoutBytes), Buffer.concat([
      Buffer.from("pr: /absent: No such file or directory\nfile\n"), Buffer.from([255,0,10]), Buffer.from("pr: /: Is a directory\n"),
    ]));
  } finally { bash.dispose(); }
});

test("pr commits complete rows at named-file read boundaries", async () => {
  for (const profile of ["memory-fs", "overlay-cow-fs"]) {
    const bash = new RustWasmBash({cwd:"/", ...(profile === "memory-fs" ? {} : {profile})});
    try {
      const line = "123456\n";
      await bash.fs.writeFile("/rows", line.repeat(10000));
      await assert.rejects(bash.exec("pr -t /rows >/out", {limits:{maxOutputBytes:16384}}), {limit:"maxOutputBytes"});
      assert.equal(bash.readText("/out"), line.repeat(Math.floor(16384 / line.length)));
    } finally { bash.dispose(); }
  }
});

test("pr reads its original input when output appends through a hard link", async () => {
  const bash = new RustWasmBash({cwd:"/",files:{"/f":"abc\n"}});
  try {
    const r = await bash.exec("ln /f /alias && pr -t /f >>/alias", {limits:{maxOutputBytes:20}});
    assert.deepEqual([r.exitCode,r.stderr,bash.readText("/f")], [0,"","abc\nabc\n"]);
  } finally { bash.dispose(); }
});

test("pr keeps the completed prefix and reports redirected input errors in order", async () => {
  const bash = new RustWasmBash({cwd:"/", files:{"/f":"abc\n123\n"}});
  try {
    const r = await bash.exec("pr -t < /f 2>&1", {limits:{maxInputBytes:4}});
    assert.deepEqual([r.exitCode, r.stdout], [1, "abc\npr: 'standard input': EFBIG: file too large, read '/f'\n"]);
  } finally { bash.dispose(); }
});

test("pr measures headers in bytes and checks the locale and timezone only for printed headers", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({cwd:"/",fs:new MemoryFileSystem()}).use(agentCommands());
  const rs = new RustWasmBash({cwd:"/"});
  try {
    for (const [env, flags, stdin] of [
      ["LC_ALL=C","-h é","row\n"], ["LC_ALL=C.UTF-8","-h é","row\n"], ["LC_ALL=C.UTF-8","-t -h é","row\n"],
      ["TZ=Europe/Paris","","row\n"], ["TZ=Europe/Paris","",""], ["TZ=UTC","","row\n"],
    ]) {
      const cmd = env + " pr --date-format=date " + flags;
      const a = await js.exec(cmd,{stdin}), b = await rs.exec(cmd,{stdin});
      assert.deepEqual([b.exitCode,b.stdout,b.stderr],[a.exitCode,a.stdout,a.stderr],cmd);
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

test("mdq preserves indented and fenced code without selecting headings inside it", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const fence = String.fromCharCode(96).repeat(3);
  try {
    const text = [
      "# Real", "", "  ~~~~rust title", "    line", "  # hidden", "  ~~~",
      "  " + fence, "  ~~~~", "", "\t# indented", "", "    x", "",
      "## After", "", fence + " js", "body", fence + " trailing", fence + fence,
    ].join("\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "'#'", "-o json '" + fence + "'",
      ...["rust", " rust", "rust line", "/ru(st|by)/ line", "!s/rust/rust lang/ line", " !s/line/replaced/"].map(s => "'" + fence + s + "'")]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq plain output normalizes blank lines and preserves literal block text", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["~~~\n\n\n~~~", "~~~\n\nfirst\n\n\nsecond\n\n~~~",
      "---\nkey_name: *literal*\n\n---\n\n> # heading\n>\n> quoted",
      "<!-- literal_* -->\n", "| a | b |\n| - | - |\n| | |"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["", "--br"]) {
        const cmd = "mdq -o plain " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], text + flags);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq retains ragged tables and normalizes column widths only for selection", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["| é | X |\n| :- | -: |\n| αβ | 猫 | extra |\n| last |",
      "| | | |\n|-|:-:|-:|\n||| |", "| title |\n| - |", "| name |\n|-|\n| body |\n\nafter\n\n| t |\n|-|\n| z |"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const query of ["", "':-: * :-:'", "':-: * :-: missing'"]) {
        for (const format of ["markdown", "json", "plain"]) {
          const cmd = "mdq -o " + format + " " + query + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
          assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("mdq distinguishes thematic breaks from underlined headings and front matter", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["---\nx: y\n...\n", "Title\n---\nfirst\n * * *\n__ _\nlast\n--\n",
      "---\nyaml\n---\n\n  -\t-  -\n___\n\n# Section\n\nend\n",
      "---no\nstill text\n\n    ***\n", "# A\n***\n# B\n***\n"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["", "-o plain", "-o json", "'P:'", "'#'"]) {
        const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq recognizes tables by their delimiter row and respects escaped pipes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["one | two\n:- | -:\na\\|b | c\n# next | heading",
      "| a\\|b | c |\n| - | - |\nleft | right\\|", "| a | b |\n| - | wrong |",
      "| a |\n| - | - |", "first\n| a | b |\n| - | - |", "one\\|two\n-|-"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["", "-o json", "'P:'", "':-: * :-:'"]) {
        const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq decodes escaped punctuation in text and preserves it inside code spans", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  const tick = String.fromCharCode(96);
  try {
    for (const text of ["one\\|two\n-|-", "# alpha\\_beta\n\n\\*x\\* and \\a",
      "value " + tick + "a_*\\|b" + tick, tick.repeat(2) + " a" + tick + "b " + tick.repeat(2),
      "alpha " + tick + " first\nsecond " + tick + " and an unmatched " + tick,
      'before <span title="a\\|b">tag</span> after\\|', "α\\|β"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["", "-o json", "-o plain", "'P: \"one|two\"'"]) {
        const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq item selectors distinguish ordinary items from checked and unchecked tasks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "- open\n- [x] closed\n- [ ] pending\n- [X] done\n- [?] unknown\n- [x]\t  tabbed\n- [x]bare\n";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const sel of ["-", "- [x]", "- [ ]", "- [?]", "- unknown"]) {
      const cmd = "mdq -o json '" + sel + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq groups list items by marker, numbers from the first item, and selects their paragraphs", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["3. first\n9. second\n\n1. third\n- [x] task\n+ plus\n+ another",
      "0) zero\n99) one\n\n1.\n2. two\n", "before\n2. continuation\n1. start\n* bullet\n",
      "- one\n- [x] done\n- [ ] todo\n"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const selector of ["", "'1.'", "'-'", "'P:'", "'1. | P:'", "'- [?]'"]) {
        for (const format of ["markdown", "json", "plain"]) {
          const cmd = "mdq -o " + format + " " + selector + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
          assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
        }
      }
    }
  } finally { rs.dispose(); }
});

test("mdq keeps a matched subtree once and still searches its siblings", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "> outer\n>\n> > inside\n\nbetween\n\n> sibling\n";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const selector of [">", "> inside", "> | P:", "P:"]) {
      const cmd = "mdq -o json '" + selector + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq selects inline links from body content and can filter the selected link again", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const tick = String.fromCharCode(96);
    const text = "# [title](/heading)\n\n> [yes](/q)\n\n~~~\n[code](/code)\n~~~\n\n| header |\n| - |\n| [cell](/c) |\n\n![pic](/img)\n\n"
      + tick + "[literal](/span)" + tick + " and \\[escaped](/fake)";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["-o json '[]()'", "-o json '[]() | [yes]()'", "-l keep '[yes]()'",
      "-l inline '[cell]() | []()'", "-l keep '![]() | ![pic]()'", "-o plain '[]()'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq keeps raw HTML blocks through their CommonMark terminators", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["before\n<div\nclass='x'>\n# not a heading\n\n# real",
      "  <!-- comment\n\n# hidden\n--> after\nnext",
      "<sCrIpT>\n\nclose </STYLE>\n# after\n",
      "<?xml\n\n?>\n<!DOCTYPE\nhtml>\n<![CDATA[\n\n]]>\nafter",
      "<custom a='1' />\nraw\n\nparagraph\n<custom>\nstill paragraph",
      "<custom bad= >\nplain\n\n<span>inline</span>\n"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const flags of ["-o json", "'#'", "'P:'", "-o plain"]) {
        const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq selects HTML nodes in document order and skips literal markup", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const tick = String.fromCharCode(96);
    const text = ["# <i>title</i>", "", "text <span data-x='>'>word</span> " + tick + "<code>" + tick + " \\<x>",
      "", "<div", "class='block'>", "raw <span>", "", "| c |", "| - |", "| <b>yes</b> |",
      "", "[<q>link</q>](/target) ![<x>alt](/image)",
      "", "more <!--a--> <?instruction?> <![CDATA[x]]> <!DOCTYPE html> <bad a=>",
      "", "~~~", "<hidden>", "~~~"].join("\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["'</>'", "-o json '</>'", "-o plain '</> span'", "'</> | </> /span/'",
      "-o json '</> !s/span/mark/'", "'</> hidden'", "-o json '[]() | </>'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq wraps words at the requested width inside paragraphs, quotes and list items", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const text of ["# never wrap this heading\n\nfirst word 😀 second\nnext line\n",
      "> word word word word word\n>\n> last paragraph", "- [ ] word word word word word",
      "before\n\n~~~\n  never   wrap\n\nraw\n~~~\n\nafter",
      "α\u00a0βγ  😀xyz longword", "a [two words](url) and ![three words](img) z", "next\n\n| x | y |\n| - | - |\n| foo | bar |"]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
      for (const width of [0, 1, 10, 20]) {
        const cmd = "mdq -l keep --wrap-width " + width + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + text);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq quote selection rewrites matched children and skips code blocks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "> first apple\n>\n> > second apple\n>\n> ~~~\n> codeonly apple\n> ~~~";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["'> !s/apple/pear/'", "-o json '> !s/apple/pear/'", "'> codeonly'", "'> apple | P:'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq decodes Markdown character references in text and fence info, once", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const tick = String.fromCharCode(96);
    const text = ["# &copy; &#x1F600; &NotEqualTilde;", "",
      "A &amp;amp; \\&copy; &amp &unknown; &#0; &#xD800; &#1114112; &#00000000; &#x0000000; &#128;",
      "", tick + "&amp;" + tick + " <b title='&copy;'>ok</b>",
      "", "~~~a&#32;b&amp;c title\\! &#x1F600;", "&amp; stays in code", "~~~"].join("\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "-o plain", "'# ©'", "'P: &unknown;'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq serializes controls with JavaScript JSON string escaping", async () => {
  const paragraph = "a\b\f\u007fz";
  const rs = new RustWasmBash({ files: { "/input": paragraph } });
  try {
    const result = await rs.exec("mdq -o json </input");
    assert.equal(result.stdout, JSON.stringify({ items: [{ document: [{ paragraph }] }] }));
    assert.equal(result.exitCode, 0, result.stderr);
  } finally { rs.dispose(); }
});

test("mdq parses link destinations and titles before matching or rendering them", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = ["[a](<café path> 'a &amp; b')", "![b](part(one)two \"title\")",
      "[c](a\\)b)", "[d](<x%20y>)", "[e](  \"two words\" )", "[bad](a b)",
      "[f](x (note))", "[empty]()"].join("\n\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["-o json '[]()'", "-o json '![]()'", "-l keep '[a]()'", "-l inline '![]()'",
      "-l inline '[c]()'", "-o json '[a]() | [](/caf%C3%A9/)'", "'[bad]()'",
      "-l keep -o json", "-l inline", "-o plain"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq numbers rendered links in order and emits their definitions at the selected position", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "# A [first](/one)\n\npara [second](/two 'a title') ![pic](/img)\n\n## B [third](/one)\n\nlast\n\n# C\n\n| link |\n| - |\n| [cell](/c) |";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "--link-pos=doc", "--link-pos=section", "'[]()'", "--link-pos=doc '[]()'",
      "--no-br --link-pos=doc '[]()'", "-l inline -o json", "-l keep", "-o json '[]()'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq resolves document references before selection and preserves their source styles", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "# See [title][Name]\n\n[one][9] [in](/i) [two][9] [NAME][] ![Name] [miss]\n\n" +
      "[name]: <my path>\n  'a title'\n[9]:\n /nine\n[name]: /ignored\n[unused]: /unused\nbody\n\n" +
      "ordinary\n[not]: /definition\n\n```\n[code]: /code\n```\n\n" +
      "- [list]: /nested\n\n[list]\n\n[bad]: /bad \"title\" extra\nkeep";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "-o plain", "-l inline", "-l keep", "--link-pos=doc", "-l keep -o json",
      "-o json '[]()'", "-o json '![]()'", "'[](/nine/)'", "'P: ^one'", "-l inline '![]()'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq keeps production definition order for mixed numeric and named reference IDs", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    let seed = 42;
    for (const count of [180, 180, 35, 75, 240]) {
      const ids = Array.from({ length: count }, (_, i) => String(i) + (i % 5 ? "" : "a"));
      for (let i = count - 1; i; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = Math.floor(seed / 2**32 * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const input = ids.map(id => "[link][" + id + "]").join(" ") + "\n\n" + ids.map(id => "[" + id + "]: /x").join("\n");
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const a = await js.exec("mdq -l keep </in"), b = await rs.exec("mdq -l keep </in");
      assert.equal(b.exitCode, 0, b.stderr);
      assert.deepEqual(b.stdout.split("\n"), a.stdout.split("\n"));
    }
  } finally { rs.dispose(); }
});

test("mdq selects and renders bracketed URLs, bare URLs, domains and email addresses", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "<https://example.com/a_b> <me+tag@example.com> www.é.test/p.\n\n" +
      "Go to https://x.test/(path)). or ftp://x.test/r! Reach a.b@team.test.\n\n" +
      "Skip `www.code.test` and [http://verbatim.test] and http://localhost.\n\n" +
      "A <xx:x_&amp;b> and <a@local>. [<aa:inner>](/outer) [parent www.some.test](link).\n\n" +
      "a\u2028https://site.test and a!+new@b.test.\n\n| link |\n| - |\n| www.cell.test |";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-l inline", "-l keep", "-o json", "-o plain", "-o json '[]()'", "'[]()'", "'[](s/test/T/g)'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq resolves emphasis delimiters around inline atoms and retains literal marks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "# *heading* and __strong__\n\n" +
      "file_name unmatched* and * space.\n\n***three*** _outer **inner**_ ~gone~ ~~~no~~~.\n\n" +
      "«_é_» *one [link](/u) `x*y` <b>two</b> three* and \\*escaped\\*\n\n" +
      "***foo** bar* a_b_c __word _in_ word__ ~~strike~~\n\n[**with** *word*](/link)";
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "-o plain", "-l inline", "-o json '[]()'", "'P: ^file_name'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq preserves source whitespace inside multiline code and HTML and consumes Markdown line breaks", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = ["a   \n b\t \n c", "slash\\\n  next and two\\\\\n lines", "``\nfoo\nbar  \nbaz\n``",
      "A <a href=\"foo  \nbar\"> tag.", "*word\\\nnext* and `x  \n y` end", "[one](u)  [two](v)  \n [three](w)"].join("\n\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-o json", "-o plain", "-l inline", "-o json '</>'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq pairs Markdown brackets after recognizing code, HTML and inner links", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = ["[not a `link](/foo`)", "[foo <a data-x=\"][ref]\">", "[foo`][ref]`",
      "[foo<https://example.com/?search=][ref]>", "[link [foo [bar]]][ref]",
      "[outer [inner](/one)](/two) and [x\\]z][ref]", "[ref]: /target"].join("\n\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-l inline", "-o json", "-o plain", "-o json '[]()'", "'</>'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq flattens image descriptions and renders or selects images inside links", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = ["![foo ![bar](/img)](/outer)", "![foo [bar](/url)](/o2)",
      "![[[foo](uri1)](uri2)](uri3)", "[before **![alt _x_](/pic)** after][ref]",
      "![literal \\*stars\\* and `_code_`](/raw)", "[ref]: /target"].join("\n\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["", "-l keep", "-l inline", "-o json", "-o plain", "-o json '[]()'",
      "-o json '![]()'", "'[]()'", "'![]()'", "-o json '[]() | ![]()'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq tracks open list items and quotes when lines continue, nest or leave a container", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = [">>> first", "> second", "third", "", "- # A", "  body", "  - [x] child",
      "    lazy line", "", "        indented", "", "2) ordered", "   > inner", "   >   continued", "",
      ">\t\tcode", "", "- <div>", "- ***", "", "- ```txt", "  contents", "  ```", "after"].join("\n");
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(text));
    for (const flags of ["-o json", "", "-o plain", "-o json '#'", "-o json '- [x]'", "-o json '>'"]) {
      const cmd = "mdq " + flags + " </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq treats caret labels with spaces as ordinary reference links", async () => {
  const rs = new RustWasmBash({ files: { "/input": "A[^x y].\n\n[^x y]: note\n" } });
  try {
    const r = await rs.exec("mdq -o json </input");
    assert.deepEqual(JSON.parse(r.stdout), {items:[{document:[{paragraph:"A[^x y]."}]}], links:{"^x y":{url:"note"}}});
    assert.equal((await rs.exec("mdq -o plain </input")).stdout, "A^x y.\n");
  } finally { rs.dispose(); }
});

test("mdq follows reachable footnotes once, resolves their bodies and places definitions", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const text = "# First\n\nA[^UP] then [^a].\n\n# Next\n\nB[^up] and [^a].\n\n" +
      "[^up]: lower note\n\n[^a]: one[^b] [ref][id]\n\n    second paragraph\n\n" +
      "[^b]: > two[^a]\n\n[^unused]: hidden\n\n[id]: /found";
    const duplicate = "test\n\n> [^a]: first\n\n[^a]: second";
    for (const vfs of [rs.fs, fs]) { await vfs.writeFile("/in", Buffer.from(text)); await vfs.writeFile("/dup", Buffer.from(duplicate)); }
    for (const cmd of ["mdq </in", "mdq -o json </in", "mdq -o plain </in", "mdq --footnote-pos doc --link-pos doc </in",
      "mdq --renumber-footnotes false </in", "mdq -o json 'P: second' </in", "mdq -o json '[]()' </in",
      "mdq -o json 'P: hidden' </in", "mdq --quiet </dup", "mdq -o json </dup"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq maps replacements on visible text back to nested emphasis ranges", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [src, selector] of [
      ["- Item with _emphasis and **nested bold**_ formatting", "- !s/and nested /and formerly /"],
      ["he**ll**o", "P: !s/hello/hi/"], ["**hi**", "P: !s/^/x/"], ["a**b**c", "P: !s/()/x/"],
      ["α**β**γ", "P: !s/./x/"], ["α**β**γ", "P: !s/()/x/"], ["α**β**γ", "P: !s/./😀/"],
      ["hello", "P: !s/o*/x/"], ["ab~~cde~~fg", "P: !s/cd//"],
      ["_alpha **bcd** end_", "P: !s/b/ x /"], ["a__b__c", "P: !s/b/*hi*/"],
      ["_abc_ **abc** ~~abc~~", "P: !s/abc/A/"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(src));
      const cmd = "mdq '" + selector + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode,b.stdout,b.stderr], [a.exitCode,a.stdout,a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq unquoted literals use Unicode simple case folding", async () => {
  const bash = new RustWasmBash();
  try {
    for (const [heading, selector, matches] of [
      ["ς", "Σ", true], ["ſ", "s", true], ["İ", "i", false], ["ı", "I", false],
      ["ß", "SS", false], ["ος", "ΟΣ", true], ["ς", '"Σ"', false],
    ]) {
      const src = "# " + heading + "\n";
      await bash.fs.writeFile("/in", Buffer.from(src));
      const result = await bash.exec("mdq '# " + selector + "' </in");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr],
        matches ? [0, src, ""] : [1, "", ""], selector + " on " + heading);
    }
  } finally { bash.dispose(); }
});
test("mdq retains parsed matcher values and delimiters inside selectors", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [src, query] of [
      ["# Bob's title", '# "\\`"'],
      ["# 😀", '# ^"\\u{1f600}"$'],
      ["a\nb", 'P: "a\\nb"'],
      ["### title", '#{} title'],
      ["[text](url)", '["]("](*)'],
      ["[a\\]\\(b](url)", '["]("](*)'],
      ["| a:-:b | other |\n| --- | --- |\n| yes | no |", ':-: ":-:" :-: yes'],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(src));
      const cmd = "mdq '" + query.replaceAll("'", "'\\''") + "' </in";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], query);
    }
  } finally { rs.dispose(); }
});

test("mdq replacements respect the visible byte ranges of inline code", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [src, selector] of [
      ["`ab`", "P: !s/^/x/"], ["`ab`", "P: !s/()/x/"], ["a`bc`d", "P: !s/ab/x/"],
      ["a`bc`d", "P: !s/cd/x/"], ["`ab` and `cd`", "P: !s/b and c/x/"],
      ["_before **`code`** after_", "P: !s/o/X/"], ["a`bc`d", "P: !s/bc//"],
      ["a ``  a`b  `` z", "P: !s/a/x/"], ["a `x` z", "P: !s/x/`/"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(src));
      const cmd = "mdq '" + selector + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + " on " + src);
    }
  } finally { rs.dispose(); }
});

test("mdq takes the first regex alternative and expands its actual captures", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, selector] of [
      ["ab", "P: !s/a|ab/x/"], ["abab", "P: !s/(a)(b)/$2$1/"],
      ["xyz", "P: !s/(?P<outer>x(?<inner>y))z/${inner}:${outer}/"],
      ["a", "P: !s/(a)/$1word/"], ["héβ", "P: !s/(é)(β)/$2$1/"],
      ["a", "P: !s/(a)/${}/"], ["a", "P: !s/(a)/$α/"],
      ["abc", "P: !s/(a)(b)/${0x2}${ 1 }$𐐀/"], ["aba", "P: !s/a.*?a|a/M/"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq '" + selector + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], selector);
    }
  } finally { rs.dispose(); }
});

test("mdq lookaround assertions preserve their captures without consuming their text", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, selector] of [
      ["foobar", "P: !s/foo(?=bar)/X/"], ["foobaz", "P: /foo(?!bar)/"],
      ["ab", "P: !s/a(?=(b))/$1/"], ["xbar", "P: /(?<!foo)bar/"],
      ["aaab", "P: !s/(?<=(a+))b/$1/"], ["abab", "P: !s/(?=(ab|a))/$1/"],
      ["aba", "P: /(?=a)(?<!b)a/"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq '" + selector + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], selector);
    }
  } finally { rs.dispose(); }
});

test("mdq Unicode regex shorthands agree inside classes and at word boundaries", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["猫", "^\\w+$"], ["١𑁦", "^[\\d]+$"], ["a1F", "^[\\h]+$"], ["xyz", "^\\H+$"],
      ["\u200c\u0301\u203f", "^[\\w]+$"], ["x猫y", "\\B猫\\B"], ["𐐀!", "\\b𐐀\\b"],
      ["β!", "\\<β\\>"], ["α\u00a0β", "α[\\s]β"], ["Ⅷ", "^\\D$"],
      ["१२", "^[^\\D]+$"], ["g9", "^[\\Ha-f]+$"], ["猫", "^[^\\W]$"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: /" + pattern + "/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern + " on " + input);
    }
  } finally { rs.dispose(); }
});

test("mdq reports regex group, class and repetition errors at their query positions", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const query of [
      "P: /(/", "P: /a)/", "P: /(猫/", "P: /[a/", "P: /[]/", "P: /[^]/",
      "P: /[z-a]/", "P: /a**/", "P: /*cat/", "P: !s/a)/x/", "P: !s/[z-a]/x/",
      "P: /a{3,2}/", "P: /a{,2}/", "P: /a{,}/", "P: /^*/", "P: /$+/", "P: /(?:)*/",
      "P: !s/a\\/😀)/x/", "P: /😀[z-a]/",
    ]) {
      const cmd = "printf 'aba\\n' | mdq '" + query + "'", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], query);
    }
  } finally { rs.dispose(); }
});

test("mdq atomic groups and possessive repeats discard only their own alternatives", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["abc", "(?>ab|a)c"], ["abc", "(?>a|ab)c"], ["aaa", "a++a"],
      ["aaa", "a{1,2}+a"], ["abb", "(a(b)?)++b"], ["abb", "(?>(ab|a))b"],
      ["abc", "(?>(?>ab|a)|abc)c"], ["aab", "(?:a*+a|aa)b"],
      ["abc", "(?=(?>ab|a))(?>ab)c"], ["baa", "a?+a"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: !s/" + pattern + "/[$0:$1]/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq scoped regex flags control case, anchors, whitespace and greed", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["ς ſ ß İ ı", "(?i:Σ|S|i)"], ["AaA", "(?i:a)(?-i:a)"], ["ÄäÄ", "(?i)(?-i:Ä)ä"],
      ["a\nb", "(?s)a.b"], ["a\nb", "(?m)^b$"], ["ab", "(?x) a [ b ]"],
      ["ab", "(?x)a # part\nb"], ["a b", "(?x)a\\ b"], ["a\u00a0b", "(?x)a\u00a0b"],
      ["aaaa", "(?U)a+"], ["aaaa", "(?U:a+?)"], ["abc", "(?i-i)a"],
      ["αa", "(?-u)."], ["abc", "(?mR)a"], ["abc", "(?q)a"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: !s/" + pattern + "/X/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq resolves and validates named, numbered and relative regex references", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["abab", "(?<w>ab)\\k<w>"], ["abab", "(?P<w>ab)(?P=w)"], ["abab", "(ab)\\k<-1>"],
      ["aba", "(a)(b)\\k'-2'"], ["ab", "(\\1a)"], ["", "\\0"], ["a", "\\012"],
      ["a", "(a)\\k<+1>"], ["abc", "(?<w>a)\\k<missing>"], ["abc", "(?P=unknown)"],
      ["abab", "(?<w>ab)\\1"], ["a", "(a)\\g<1>"], ["a", "(a)\\g{1}"],
      ["abc", "(?<a>x)(?<a>y)"], ["ab", "(?<0>ab)"], ["ab", "(?<>ab)"],
      ["αΑ", "(?<α>α)(?i:\\k<α>)"], ["ab", "(a)(b)\\10"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: /" + pattern.replaceAll("'", "'\\''") + "/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq distinguishes match start, search continuation and end-of-input anchors", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["abab", "a\\Kb"], ["aab", "(a+)\\K(b)"], ["abcd", "\\G."], ["aa bb", "\\G\\w"],
      ["abc", "\\A.|.\\z"], ["ab\n\n", "b\\Z"], ["abcdef", "\\G(..)"], ["aaaa", "a\\K"],
      ["xx", "\\G"], ["aab", "(?:a\\Kx|a)b"], ["abc", "(?=a\\K)ab"], ["abc", "(?>a\\K)b"],
    ]) {
      const src = "```\n" + input + "\n```\n";
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(src));
      const cmd = "mdq '```* !s/" + pattern + "/[$0:$1:$2]/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq decodes regex character escapes and pinpoints invalid escapes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["abc", "\\x61"], ["猫", "\\u732b"], ["😀", "[\\U0001F600]"], ["β", "[\\u{3b1}-\\x{3b3}]"],
      ["\u0008", "[\\b]"], ["\u001b", "\\e"], ["a", "\\x"], ["a", "[\\u12]"],
      ["a", "\\x{D800}"], ["a", "\\x{110000}"], ["a", "\\Q"], ["a", "[\\R]"],
      ["a", "\\u{000000000000061}"], ["a", "\\x{zz}"],
    ]) {
      await fs.writeFile("/in", Buffer.from(input)); await rs.fs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: /" + pattern + "/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq resolves Unicode binary properties, categories and script aliases", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["αβ", "\\p{greek}+"], ["猫", "\\p{sc=Hani}"], ["α", "\\p{SCRIPT=Grek}"],
      ["a", "\\p{Ll}"], ["a", "\\pL"], ["A", "(?i)\\p{Ll}"], ["1", "[\\PL]"],
      ["𐐀", "\\p{Uppercase_Letter}"], ["ー", "\\p{scx=Hira}"], ["🦕", "\\p{Emoji}"],
      ["\u0378", "\\P{Assigned}"], ["é", "\\P{ascii}"], ["A", "\\p{gc=Lu}"],
      ["a", "\\p{NotAThing}"], ["a", "[\\p{greek}a]"], ["a", "\\p{sc}"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: /" + pattern + "/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq regex conditionals select one branch and retain captures from the condition", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, pattern] of [
      ["ab", "(a)?(?(1)b|c)"], ["c", "(a)?(?(1)b|c)"], ["ac", "(a)(?(1)b|c)"],
      ["ab", "(?<n>a)(?(<n>)b|c)"], ["c", "(?<n>a)?(?(n)b|c)"],
      ["ab", "(?(a)b|c)"], ["a", "(?((?=a))a|b)"], ["a", "(a)(?(1))"],
      ["abc", "(?((a))(b)|(c))"], ["a", "(?(0)a|b)"], ["a", "(?(2)a|b)"],
      ["a", "(?(<missing>)a|b)"], ["a", "(?(?=a)a|b)"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input));
      const cmd = "mdq 'P: !s/" + pattern + "/[$0:$1:$2]/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq evaluates nested regex class unions, intersections and differences", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from("aAbcdef123ΣςſßİΠ猫!\n"));
    for (const pattern of [
      "[a-z&&[^b]]", "[a-f--[b-d]]", "[a-f~~[d-z]]", "[a-z&&[^a-y]x]",
      "[\\pL&&[^\\p{Greek}]--[a-c]]", "(?i)[[a-c]~~[B-D]]", "(?i)[[^s]&&\\w]",
      "[[:^digit:]&&[:ascii:]]", "[[[:alnum:]]--[[:digit:]]]", "[a-\\w]", "[a&&[b]",
    ]) {
      const cmd = "mdq 'P: !s/" + pattern + "/X/' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq ignores inline regex comments and reports unfinished or repeated ones", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const js = new Shell({ fs: new MemoryFileSystem(), cwd: "/" }).use(agentCommands()), rs = new RustWasmBash();
  try {
    for (const pattern of ["a(?# hello)b", "a(?#)b", "(?i)a(?#x|[)b", "a(?#oops", "a(?#x)*b"]) {
      const cmd = "printf 'ab\\n' | mdq 'P: /" + pattern + "/'", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], pattern);
    }
  } finally { rs.dispose(); }
});

test("mdq preserves inline objects across replacements and chained selectors", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [input, query] of [
      ["<https://example.com>", "P: !s/^/x/"],
      ["<https://example.com>", "P: !s/https:/bad url/ | []()"],
      ["pre [*label*](dest) post", "P: !s/lab/É/ | []()"],
      ["pre [label](dest) post", "P: !s/e l/X/"],
      ["[a](url)[b](other)", "P: !s/ab/X/"],
      ["a [label](dest) b", "P: !s/label//"],
      ["x ![*alt*](pic)", "P: !s/alt/*x*/"],
      ["a <b>c", "P: !s/<b>/raw/ | </>"],
      ["x[^note]y\n\n[^note]: body", "P: /^xnotey$/"],
      ["aé [é](u) é", "P: !s/é/X/"],
      ["| head |\n|---|\n| <https://example.com> |", ":-: * :-: !s/^/x/"],
    ]) {
      for (const vfs of [rs.fs, fs]) await vfs.writeFile("/in", Buffer.from(input + "\n"));
      for (const format of ["md", "plain", "json"]) {
        const cmd = "mdq -o " + format + " '" + query + "' </in", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], input + " / " + query + " / " + format);
      }
    }
  } finally { rs.dispose(); }
});

test("mdq rejects invalid UTF-8 at the input being read and preserves valid Unicode bytes", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const vfs of [rs.fs, fs]) {
      await vfs.writeFile("/bad", Uint8Array.of(0xff));
      await vfs.writeFile("/short", Uint8Array.of(0xe2, 0x82));
      await vfs.writeFile("/ok", Buffer.from("é\uE080😀\n"));
    }
    for (const cmd of [
      "mdq </bad", "mdq '??' </bad", "mdq --help </bad", "mdq '' /ok /short",
      "mdq '' /ok </bad", "mdq '' - /ok </short", "mdq '' /bad /missing",
      "mdq </ok", "mdq '' /ok", "mdq 'P: !s/é/Z/' </ok",
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, [...b.stdoutBytes], b.stderr], [a.exitCode, [...a.stdoutBytes], a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("mdq shares the input byte limit across file operands and stdin", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const vfs of [fs, rs.fs]) {
      await vfs.writeFile("/a", Buffer.from("a".repeat(65535) + "😀"));
      await vfs.writeFile("/b", Buffer.from("é"));
    }
    for (const cmd of ["mdq '' /a /b", "mdq '' /a - - </b", "mdq '' - /a - </b"]) {
      for (const shell of [js, rs]) {
        await assert.rejects(shell.exec(cmd, { limits: { maxInputBytes: 65540 } }), /maxInputBytes/);
        const r = await shell.exec(cmd, { limits: { maxInputBytes: 65541 } });
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("😀") && r.stdout.includes("é"));
      }
    }
  } finally { rs.dispose(); }
});

test("mdq reports invalid Markdown before compiling the selector", async () => {
  const bash = new RustWasmBash({files: {"/doc": "[^a]: one\n\n[^a]: two\n"}});
  try {
    for (const query of ["?", "P: /[/"]) {
      const r = await bash.exec("mdq '" + query + "' /doc");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "", "Markdown parse error:\nfound multiple definitions for link/image/footnote: a\n\n"]);
    }
  } finally { bash.dispose(); }
});

test("xq compiles jq functions and rejects unknown names before reading XML", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands()), rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const vfs of [fs, rs.fs]) await vfs.writeFile("/xml", Buffer.from("<doc>value</doc>"));
    for (const cmd of ["xq -n input /missing", "xq 'if false then nope else . end' /missing",
      "xq -r 'def title: .doc; title' /xml", "xq -c 'def pick(k): .[k]; pick(\"doc\")' /xml"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("xq converts XML when jq requests the next source", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const jsFs = new MemoryFileSystem(), js = new Shell({ fs: jsFs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const fs of [jsFs, rs.fs]) {
      await fs.writeFile("/xml", Buffer.from("<r a='x'>🌱\uE080</r>"));
      await fs.writeFile("/bad", Buffer.from("<r>"));
      await fs.writeFile("/bytes", Uint8Array.of(0xff));
    }
    for (const cmd of [
      "xq -c . xml bad", "xq -c . xml missing", "xq -nc 'first(inputs)' xml missing",
      "xq -nc 'if false then inputs else 7 end' bad", "xq -nc 7 bad",
      "xq -nc 'try inputs catch .' xml bad", "xq -nc inputs bytes",
      "xq -Rc . xml xml", "xq -Rsc . xml xml", "xq --stream -c . xml",
      "xq -c . - - <xml", "xq -c . <bytes", "xq 'error(\"msg\")' xml",
    ]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("XML commands share strict parsing and preserve their own JSON mapping", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const xml of [
      '<r a="1" A="2"><?pi > text?>after<t/><t/></r>',
      '\ufeff<r a="one\r\ntwo\tthree&#9;">a\rb<![CDATA[&]]><!--skip--></r>',
      '<r a="1" a="2"/>', '<r a=b/>', '<r a/>', '<r a="1"b="2"/>', '<r a="<"/>',
      ' <not:bound/>', '<r p:k="1"/>', '<r a:x="1" b:x="2" xmlns:a="u" xmlns:b="u"/>',
      '<r xmlns:xml="wrong"/>', '<r xmlns:p="1"><t xmlns:p="2"><p:t/></t><p:t/></r>',
      '<r><e xmlns:p="u"/><p:t/></r>',
      '<?xml version="1.0" encoding="UTF-16"?><r/>', ' <?xml version="1.0"?><r/>',
      '<?xml version="1.0" standalone="no" encoding="utf-8"?><r/>', '<r><?XML?></r>',
      '<r>&nbsp;</r>', '<r>&#xD800;</r>', '<r a="&#00000000000000065;"/>', '<r / >', '<r /x>',
    ]) {
      for (const store of [fs, rs.fs]) await store.writeFile("/xml", Buffer.from(xml));
      for (const cmd of ["xq -c . /xml", "yq -p xml -o json -I 0 . /xml", "xmllint --noout /xml"]) {
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + xml);
      }
    }
  } finally { rs.dispose(); }
});

test("xmllint recovery reports repairs and rejects malformed attributes and DTDs", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const xml of ["<A a='1'><B>open", "<r><x></wrong>", "<r>&a;&b; &text", "<r",
      "<r a='&unknown;'/>", "<r>&#;</r>", "<r>&#bad;</r>", "<r a='1' a='2'/>", "<p:r/>", "<!DOCTYPE r><r/>"]) {
      for (const store of [fs, rs.fs]) await store.writeFile("/xml", Buffer.from(xml));
      for (const cmd of ["xmllint --recover /xml", "xmllint --recover --noout /xml"]) {
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + xml);
      }
    }
  } finally { rs.dispose(); }
});

test("xmllint processes each operand and reads stdin only once", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) {
      await store.writeFile("/a", Buffer.from("<a>first</a>"));
      await store.writeFile("/b", Buffer.from("<b>second</b>"));
      await store.writeFile("/private", Buffer.from("<c>\uE080🌻</c>"));
      await store.writeFile("/bad", Uint8Array.of(60,114,62,255,60,47,114,62));
    }
    for (const cmd of ["xmllint /a /b", "xmllint /a missing /b", "xmllint --noout /bad /a",
      "xmllint --xpath 'string(/*)' /bad /private", "xmllint --xpath '//a' /b /a",
      "xmllint - - /b </a", "xmllint /b - </bad", "xmllint -o saved /a /bad /b"]) {
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], cmd);
    }
    assert.deepEqual(Buffer.from(await rs.fs.readFile("/saved")), Buffer.from(await fs.readFile("/saved")));
    for (const sh of [js, rs]) {
      await assert.rejects(sh.exec("xmllint --noout /a - </b", { limits: { maxInputBytes: 24 } }), /maxInputBytes/);
      assert.equal((await sh.exec("xmllint --noout /a - </b", { limits: { maxInputBytes: 25 } })).exitCode, 0);
    }
  } finally { rs.dispose(); }
});

test("xmllint writes the requested document encoding and keeps XPath and canonical output UTF-8", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) {
      await store.writeFile("/doc", Buffer.from('<r a="é&#9;&#10;&#13;&gt;">界🌱\uE080&#13;</r>'));
    }
    for (const args of ["", "--encode UTF8", "--encode latin1", "--encode UTF16", "--encode UTF-16BE",
      "--encode ASCII", "--encode cp437", "--encode UTF-16LE -o result", "--xpath '//r' --encode UTF16",
      "--xpath '//r/@a' --encode ASCII", "--c14n --encode ASCII"]) {
      const cmd = "xmllint " + args + " doc";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdoutBytes, b.stderr], [a.exitCode, a.stdoutBytes, a.stderr], cmd);
    }
    assert.deepEqual(Buffer.from(await rs.fs.readFile("/result")), Buffer.from(await fs.readFile("/result")));
  } finally { rs.dispose(); }
});

test("xmllint preserves comments, processing instructions, and CDATA through serialization and XPath", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const xml of [
      '<?before x?>\n<!--p-->\n<r/>\n<!--epilog-->\n<?after?>',
      '<r>a<!-- c -->b<?pi    hi  ?>c<![CDATA[<é>]]></r>',
      '<r><a/><!--c--><?pi data?><b/></r>', '<r><![CDATA[ ]]><a/> </r>', '<r><![CDATA[]]></r>',
    ]) {
      for (const store of [fs, rs.fs]) await store.writeFile("/xml", Buffer.from(xml));
      for (const args of ["", "--format", "--c14n", "--nocdata", "--format --noblanks --nocdata",
        "--xpath '//r'", "--xpath '//r/text()'", "--xpath 'string(/*)'", "--xpath 'count(//text())'",
        "--xpath '//.'", "--xpath '//.[local-name()=\"pi\"]'", "--xpath '//.[string(.)=\"\"]'"]) {
        const cmd = "xmllint " + args + " /xml";
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + xml);
      }
    }
  } finally { rs.dispose(); }
});

test("xmllint returns distinct XPath nodes in document order", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from('<r><t a="x">one</t><p><t a="x">one</t></p><t a="x"><![CDATA[one]]></t></r>'));
    for (const q of ["//t | //t", "count(//t | //t)", "//p | //r", "//t/..", "//t/@a | //t/@a",
      "//text() | //t/@a | //t", "string(//p | //r)", "//t[last()] | //t[1] | //t"]) {
      const cmd = "xmllint --xpath '" + q + "' doc", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], q);
    }
  } finally { rs.dispose(); }
});

test("XPath descendant predicates use sibling positions at each parent", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from("<r><t><t>A</t></t><box><t>B</t><t>C</t></box><t>D</t></r>"));
    for (const q of ["//t[1]", "//t[last()]", "/r//t[position() > 1][1]", "//*[1]/..", "/r/box/t[1.5]", "string(.)", "/r/../*"]) {
      const cmd = "xmllint --xpath '" + q + "' doc", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], q);
    }
  } finally { rs.dispose(); }
});

test("xmllint compiles XPath paths and predicates before opening XML operands", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from('<r><a n="2"/><a n="4"/></r>'));
    for (const xp of ["/", "//a/@n/b", "//a |", "//a[1", "//:a", "//a::b", " //comment()",
      "count(//a::b)", "concat(//:q,/)", "string(1,2)", 'concat("🌻",)', "1 mod 2", "(1 + 2) - 3",
      "1-2-3", "1--2", "not(not(true()))", "count(//a[-number(@n) + 2 = 0])",
      "count( /r / a [ position() = last() ] )", "substring('abcdef', (1+1), 3)"]) {
      for (const file of ["doc", "missing"]) {
        const cmd = "xmllint --xpath " + "'" + xp.replaceAll("'", "'\\''") + "' " + file;
        const a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd);
      }
    }
  } finally { rs.dispose(); }
});

test("XPath resolves query prefixes at the root and matches expanded names at each node", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const xml = '<r xmlns:a="one" xmlns:b="one" xml:lang="en"><a:t id="0" b:k="1">a<![CDATA[b]]>c</a:t><b:t/><q xmlns:a="two" xmlns="one"><a:t/><t/><z:t xmlns:z="one"/></q></r>';
    for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from(xml));
    for (const q of ["//a:t", "//b:t", "//t", "count(//@*)", "/r/@*", "//a:t/@a:k",
      "//a:t[namespace-uri()='one']", "namespace-uri(//@xml:lang)", "//a:q/a:t",
      "//x:t", "count(//missing/x:t)", "/r/@xmlns", "//a:t/@*[local-name()='k']",
      "//a:t/@*[last()]/..", "//a:t/text()[2]", "//a:t[count(1)]", "//missing[count(1)]"]) {
      const cmd = "xmllint --xpath '" + q.replaceAll("'", "'\\''") + "' doc";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], q);
    }
  } finally { rs.dispose(); }
});

test("XPath comparisons preserve operand types and compare every node value", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const xml = '<r><a>1</a><a>3</a><b>2</b><b>3</b><v k="attr"/><n>+2</n></r>';
    for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from(xml));
    for (const q of ['boolean(//a = //b)', 'boolean(//v = "attr")', '"01" = "1"', 'true() = //a',
      'false() = //missing', '"q" >= "attr"', 'true() < //b', 'sum(//missing)', 'sum(//n)',
      'number("+1")', 'number("Infinity")', 'number(" 1 ")', 'normalize-space(" 1 ")']) {
      const cmd = "xmllint --xpath '" + q + "' doc";
      const a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], q);
    }
  } finally { rs.dispose(); }
});

test("XPath scalar output rounds to six digits while string() keeps full precision", async () => {
  const rs = new RustWasmBash({ files: { "/doc": "<r/>" } });
  try {
    for (const [q, expected] of [
      ['number("5e-324")', "5e-324"], ['number("2.2250738585072014e-308")', "2.22507e-308"],
      ['number("123456.5")', "123457"], ['number("-123456.5")', "-123457"],
      ['round(-0.5)', "-0"], ['round(0.49999999999999994)', "0"], ['string(-0)', "0"],
      ['string(number("1e-7"))', "1e-7"], ['string(number("1e21"))', "1e+21"],
    ]) {
      const result = await rs.exec("xmllint --xpath '" + q + "' /doc");
      assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0, "", expected + "\n"], q);
    }
  } finally { rs.dispose(); }
});

test("XPath substring rounds character positions before clipping them to the string", async () => {
  const rs = new RustWasmBash({ files: { "/doc": "<r/>" } });
  try {
    for (const [bounds, expected] of [
      ["0.49999999999999994,1.5", "a"], ["3,0.49999999999999994", ""], ["2,1", "🌻"],
      ['-number("1e300"),number("1.1e300")', "a🌻b"], ['number("bad")', ""],
      ['-number("1e999")', "a🌻b"], ['-number("1e999"),number("1e999")', ""],
    ]) {
      const result = await rs.exec("xmllint --xpath 'substring(\"a🌻b\"," + bounds + ")' /doc");
      assert.deepEqual([result.exitCode, result.stderr, result.stdout], [0, "", expected + "\n"], bounds);
    }
  } finally { rs.dispose(); }
});

test("XPath translate uses the first mapping for each code point and drops unmapped replacements", async () => {
  const rs = new RustWasmBash({ files: { "/doc": "<r/>" } });
  try {
    const result = await rs.exec(`xmllint --xpath 'translate("a🌻abcz", "aa🌻bc", "12🌺")' /doc`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "1🌺1z\n", ""]);
  } finally { rs.dispose(); }
});

test("xmllint canonicalizes expanded names and preserves the destination on a relative namespace URI", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const xml of [
      '<r xmlns:z="urn:a" xmlns:b="urn:z" b:a="2" z:a="1" t="z"/>',
      '<t:r xmlns:t="urn:t" xmlns="urn:d" xmlns:u="urn:unused" id="1"><x xmlns=""/></t:r>',
      '<r><x xmlns:unused="relative"/></r>',
    ]) {
      for (const store of [fs, rs.fs]) await store.writeFile("/doc", Buffer.from(xml));
      for (const flags of ["--c14n", "--exc-c14n", "--exc-c14n --c14n", "--exc-c14n --noout", "--c14n -o /out"]) {
        for (const store of [fs, rs.fs]) await store.writeFile("/out", Buffer.from("original"));
        const cmd = "xmllint " + flags + " /doc", a = await js.exec(cmd), b = await rs.exec(cmd);
        assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], cmd + ": " + xml);
        assert.deepEqual(Buffer.from(await rs.fs.readFile("/out")), Buffer.from(await fs.readFile("/out")));
      }
    }
  } finally { rs.dispose(); }
});

test("xmllint checks output permissions and path traversal before replacing file contents", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) {
      await store.writeFile("/doc", Buffer.from("<r/>"));
      await store.writeFile("/out", Buffer.from("original"));
      await store.link("/out", "/hard");
      await store.symlink("/out", "/alias");
      await store.mkdir("/dir");
      await store.chmod("/out", 0o444);
    }
    for (const dest of ["alias", "new/out", "doc/out", "dir", "dir/../out", "dir/new"]) {
      const cmd = "xmllint -o " + dest + " /doc", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], dest);
    }
    assert.equal(Buffer.from(await rs.fs.readFile("/hard")).toString(), "original");
    await assert.rejects(rs.fs.stat("/new"), { code: "ENOENT" });
    for (const store of [fs, rs.fs]) await store.chmod("/out", 0o644);
    for (const shell of [js, rs]) assert.equal((await shell.exec("xmllint -o alias /doc")).exitCode, 0);
    assert.deepEqual(Buffer.from(await rs.fs.readFile("/hard")), Buffer.from(await fs.readFile("/hard")));
  } finally { rs.dispose(); }
});

test("xmllint walks each input path component before following dot-dot", async () => {
  const { Shell, MemoryFileSystem, agentCommands } = await import("@poe-platform/safe-bash");
  const fs = new MemoryFileSystem(), js = new Shell({ fs, cwd: "/" }).use(agentCommands());
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const store of [fs, rs.fs]) {
      await store.writeFile("/doc", Buffer.from("<r/>"));
      await store.mkdir("/locked");
      await store.chmod("/locked", 0o666);
      await store.symlink("/loop", "/loop");
    }
    for (const file of ["missing/../doc", "locked/../doc", "doc/../doc", "doc/", "./doc", "loop", "''"]) {
      const cmd = "xmllint " + file + " /doc", a = await js.exec(cmd), b = await rs.exec(cmd);
      assert.deepEqual([b.exitCode, b.stdout, b.stderr], [a.exitCode, a.stdout, a.stderr], file);
    }
  } finally { rs.dispose(); }
});

test("nested XPath paths preserve their predicate contexts without a native call stack limit", async () => {
  const rs = new RustWasmBash({ files: { "/doc": "<r><a/><a/><a/></r>" } });
  try {
    const predicate = ".[".repeat(512) + "true()" + "]".repeat(512);
    for (const [path, file, code, output] of [
      ["//a[" + predicate + " and position()=2]", "/doc", 0, "1\n"],
      ["//missing[" + predicate + "]", "/doc", 0, "0\n"],
      [".[" + predicate + "]", "/missing", 1, ""],
    ]) {
      const result = await rs.exec("xmllint --xpath 'count(" + path + ")' " + file);
      assert.deepEqual([result.exitCode, result.stdout], [code, output]);
      assert.equal(result.stderr, code ? "xmllint: ENOENT: no such file or directory, readStream '/missing'\n" : "");
    }
  } finally { rs.dispose(); }
});

test("xmllint --noout validates deeply nested input and still reports errors at the deepest element", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [leaf, flag, code, message] of [
      ["<n:item/>", "", 0, ""], ["<n:item/>", "--recover", 0, ""],
      ["&bad;", "", 1, "xmllint: Invalid XML: undeclared entity\n"],
      ["&bad;", "--recover", 0, "xmllint: undeclared entity (recovered)\n"],
      ["<unknown:item/>", "", 1, "xmllint: Invalid XML: unbound element prefix\n"],
    ]) {
      await rs.fs.writeFile("/doc", Buffer.from('<r xmlns:n="urn:n">' + "<t>".repeat(2048) + leaf + "</t>".repeat(2048) + "</r>"));
      const result = await rs.exec("xmllint --noout " + flag + " /doc");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [code, "", message], leaf);
    }
  } finally { rs.dispose(); }
});

test("xmllint reads redirected stdin only for the operand that requests it", async () => {
  const rs = new RustWasmBash({ cwd: "/", files: { "/doc": "<r/>", "/big": "<big/>" } });
  try {
    const options = { limits: { maxInputBytes: 4 } };
    for (const [cmd, code, output, error] of [
      ["{ xmllint --noout doc; head -c 1; } <big", 0, "<", ""],
      ["{ xmllint --noout -; head -c 1; } <doc", 0, "", ""],
      ["xmllint --xpath '///' <big", 10, "", "xmllint: unsupported XPath syntax at offset 2\n"],
      ["xmllint --noout missing - <big", 1, "", "xmllint: ENOENT: no such file or directory, readStream '/missing'\nxmllint: EFBIG: file too large, read '/big'\n"],
    ]) {
      const result = await rs.exec(cmd, options);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [code, output, error], cmd);
    }
    await rs.fs.writeFile("/invalid", Uint8Array.of(255, 65));
    const invalid = await rs.exec("{ xmllint --noout; cat; } </invalid");
    assert.deepEqual([invalid.exitCode, invalid.stdout, invalid.stderr], [0, "", "xmllint: XML input must be UTF-8\n"]);
    await assert.rejects(rs.exec("xmllint --noout doc - <big", options), /maxInputBytes/);
  } finally { rs.dispose(); }
});

test("xmllint stops consuming a redirected operand at a fatal XML error", async () => {
  const rs = new RustWasmBash({ cwd: "/", files: { "/broken": "<broken/>".repeat(20000) } });
  try {
    for (const maxInputBytes of [190, 4096]) {
      const r = await rs.exec("{ xmllint --noout; head -c8; } <broken", { limits: { maxInputBytes } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "",
        "xmllint: Invalid XML: multiple root elements\nhead: EFBIG: file too large, read '/broken'\n"]);
    }
  } finally { rs.dispose(); }
});

test("xmllint preserves XML tokens, namespace scope and text nodes across decoder chunks", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const fragment of ["🦊", "\r\n", "&amp;", "<!-- a -->", "<![CDATA[<]]>", "<?go ok?>",
      '<p:x a=">"/>', "</p:e>"]) {
      const prefix = '<r xmlns:p="urn:x"><p:e>';
      const suffix = fragment === "</p:e>" ? "</r>" : "</p:e></r>";
      for (let split = 1; split < Buffer.byteLength(fragment); split++) {
        const pad = "a".repeat(4096 - Buffer.byteLength(prefix) - split);
        await rs.fs.writeFile("/f", prefix + pad + fragment + suffix);
        const result = await rs.exec("xmllint --c14n f");
        const canonical = new Map([["\r\n", "\n"], ["<![CDATA[<]]>", "&lt;"], ['<p:x a=">"/>', '<p:x a="&gt;"></p:x>']]);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, prefix + pad + (canonical.get(fragment) ?? fragment) + suffix);
      }
    }
  } finally { rs.dispose(); }
});

test("xmllint charges named input in read order and prevalidates recovery input", async () => {
  const rs = new RustWasmBash({ cwd: "/", files: {
    "/f": Buffer.concat([Buffer.from("<r/><r/>" + " ".repeat(9000)), Buffer.from([255])])
  } });
  try {
    const options = { limits: { maxInputBytes: 64 } };
    const invalid = await rs.exec("xmllint --noout f", options);
    assert.equal(invalid.stderr, "xmllint: Invalid XML: multiple root elements\n");
    await assert.rejects(rs.exec("xmllint --recover --noout f", options), /maxInputBytes/);
    const recover = await rs.exec("xmllint --recover --noout f");
    assert.equal(recover.stderr, "xmllint: XML input must be UTF-8\n");
  } finally { rs.dispose(); }
});

test("xmllint reports invalid XML characters in the normalization window it needs", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [spaces, reason] of [[503, "invalid character"], [504, "multiple root elements"]]) {
      await rs.fs.writeFile("/bad", "<r/><r/>" + " ".repeat(spaces) + "\0");
      const r = await rs.exec("xmllint --noout bad");
      assert.equal(r.stderr, "xmllint: Invalid XML: " + reason + "\n");
    }
  } finally { rs.dispose(); }
});

test("xmllint rejects malformed attributes before reading the rest of an open tag", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [prefix, reason] of [
      ["<r><x a=unquoted ", "unquoted attribute"],
      ['<r a="1" a="2" ', "duplicate attribute"],
      ['<r xmlns:x="" ', "invalid namespace binding"],
      ['<r a="&bad;" ', "undeclared entity"],
    ]) {
      await rs.fs.writeFile("/bad", prefix + " ".repeat(8192));
      const r = await rs.exec("xmllint --noout bad", { limits: { maxInputBytes: 64 } });
      assert.deepEqual([r.exitCode, r.stderr], [1, "xmllint: Invalid XML: " + reason + "\n"]);
    }
  } finally { rs.dispose(); }
});

test("heredocs check the expanded byte count before installing later redirects", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const error = "shell: line 1: EFBIG: file too large, read\n";
    for (const [script, limit, code, stdout, stderr] of [
      ["printf yes <<-'EOF'\n\t🦊\nEOF", 4, 1, "", error],
      ["printf yes <<-'EOF'\n\t🦊\nEOF", 5, 0, "yes", ""],
      ["{ echo ok; } 2>&1 <<EOF\n1234\nEOF", 4, 1, error, ""],
      ["x=123; cat <<EOF\n${x}\nEOF", 4, 0, "123\n", ""],
      ["printf old >dest; true <<EOF >dest\n12345\nEOF\ncat dest", 4, 0, "old", error],
    ]) {
      const r = await rs.exec(script, { limits: { maxInputBytes: limit } });
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], script);
    }
  } finally { rs.dispose(); }
});

test("xmllint diagnoses malformed end tags and instruction names before their terminator", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const [prefix, expected] of [
      ["<r></r /", "mismatched closing tag"], ["<r></! ", "invalid qualified name"],
      ["<?q:x:y ", "invalid qualified name"],
    ]) {
      await rs.fs.writeFile("/f", prefix + " ".repeat(9000));
      const r = await rs.exec("xmllint --noout f", { limits: { maxInputBytes: 64 } });
      assert.deepEqual([r.exitCode, r.stderr], [1, "xmllint: Invalid XML: " + expected + "\n"]);
    }
  } finally { rs.dispose(); }
});

test("xq streams XML operands in query order and charges their cumulative input bytes", async () => {
  const rs = new RustWasmBash({ cwd: "/", files: {
    "/f": "<r/>", "/broken": "<r/><r/>" + " ".repeat(70000),
  } });
  try {
    const options = { limits: { maxInputBytes: 64 } };
    for (const [cmd, code, stdout, stderr] of [
      ["{ xq -c . f; head -c1; } <broken", 0, '{"r":null}\n<', ""],
      ["{ xq .; head -c2; } <broken", 1, "", "jq: Invalid XML: multiple root elements\nhead: EFBIG: file too large, read '/broken'\n"],
      ["xq --version <broken", 0, "jq-1.7.1\n", ""],
    ]) {
      const r = await rs.exec(cmd, options);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], cmd);
    }
    await assert.rejects(rs.exec("xq . f f", { limits: { maxInputBytes: 7 } }), /maxInputBytes/);
    await assert.rejects(rs.exec("xq . broken", options), /maxInputBytes/);
  } finally { rs.dispose(); }
});

test("XML byte streams remove the UTF-8 signature before XML normalization", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const count of [1, 2, 3]) {
      await rs.fs.writeFile("/f", "\ufeff".repeat(count) + "<r/>");
      for (const command of ["xq .", "xmllint --noout", "yq -p xml ."]) {
        const r = await rs.exec(command + " f");
        assert.equal(r.exitCode, Number(count > (command.startsWith("yq") ? 1 : 2)), command);
      }
    }
  } finally { rs.dispose(); }
});

test("oversized here-strings fail during descriptor setup even when nobody reads them", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    const limit = { limits: { maxInputBytes: 4 } };
    const error = "shell: line 1: EFBIG: file too large, read\n";
    for (const [cmd, code, stdout, stderr] of [
      ["{ xmllint --noout; cat; } <<<'<r/>'", 1, "", error],
      ["true <<<1234", 1, "", error],
      ["wc -c <<<1234", 1, "", error],
      ["wc -c <<<123", 0, "4\n", ""],
      ["printf x 2>&1 <<<1234", 1, error, ""],
      ["exec 3<<<1234; echo $?", 0, "1\n", error],
      ["printf x 3<<<1234", 0, "x", ""],
    ]) {
      const r = await rs.exec(cmd, limit);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], cmd);
    }
  } finally { rs.dispose(); }
});

test("a failed here-string does not assign, unset, or read a builtin variable", async () => {
  const rs = new RustWasmBash({ cwd: "/" });
  try {
    for (const builtin of ["read -n1 v <<<1234", "read -u3 v 3<<<🦊", "printf -v v x <<<1234",
      "unset v <<<1234", "export v=new <<<1234", "mapfile v <<<1234", "command -p printf x <<<1234"]) {
      const r = await rs.exec('v=old; ' + builtin + '; echo "$?:$v"', {limits: {maxInputBytes: 4}});
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "1:old\n", "shell: line 1: EFBIG: file too large, read\n"], builtin);
    }
  } finally { rs.dispose(); }
});

test("mapfile checks a direct here-string in UTF-16 units before replacing its array", async () => {
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [cmd, status, values, extraLimits] of [
      ['command -- mapfile -t a <<<🦊', 0, "🦊|"],
      ['mapfile -t a <<<🦊', 1, "old|tail", {maxCommands: 999}],
      ['mapfile -t a <<<🦊', 1, "old|tail", {maxExpansionBytes: 1024}],
      ['mapfile -t a <<<1234', 1, "old|tail"],
      ['v=🦊; readarray -t a <<<"$v"', 0, "🦊|"],
      ["mapfile -t a <<<$'🦊\\n'", 0, "🦊|"],
      ['mapfile -t a <<<$(printf 🦊)', 1, "old|tail"],
      ['mapfile "-t" a <<<🦊', 1, "old|tail"],
      ['! mapfile -t a <<<🦊', 0, "old|tail"],
      ['set -a; mapfile -t a <<<🦊', 1, "old|tail"],
    ]) {
      const r = await rs.exec('a=(old tail); ' + cmd + '; echo "$?:${a[0]}|${a[1]}"', {limits: {maxInputBytes: 4, ...extraLimits}});
      assert.deepEqual([r.stdout, r.stderr], [status + ":" + values + "\n", values === "old|tail" ? "shell: line 1: EFBIG: file too large, read\n" : ""], cmd);
    }
    const unset = await rs.exec('set -u; mapfile -t a <<<"$unknown"; echo reached');
    assert.deepEqual([unset.exitCode, unset.stdout, unset.stderr], [1, "", "shell: line 1: unknown: unbound variable\n"]);
  } finally { rs.dispose(); }
});

test("direct printing skips the here-string operand only when it can write the result", async () => {
  const rs = new RustWasmBash({cwd: "/"});
  try {
    const error = "shell: line 1: EFBIG: file too large, read\n";
    for (const [cmd, output] of [
      ['printf x', 'x'], ['command -- printf "%04d" 7', '0007'], ['printf "%c:%s" A 🦊', 'A:🦊'],
      ['echo "a b"', 'a b\n'], ['x=(a b); echo "${x[@]}"', 'a b\n'],
      ['echo "$RANDOM"'], ['echo ~'], ['set -f; echo *', '*\n'], ['printf %q x'], ['printf %b x'], ['printf %d 08'],
      ['printf "%c" 🦊'], ['printf x $(true)'], ['echo a*'], ['shopt -s xpg_echo; echo a'],
    ]) {
      const r = await rs.exec('rm -f /wrote; ' + cmd + ' 1<<<$(touch /wrote; printf 1234)', {limits: {maxInputBytes: 4}});
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], output === undefined ? [1, "", error] : [0, output, ""], cmd);
      assert.equal((await rs.exec("test -f /wrote")).exitCode, Number(output !== undefined), cmd);
    }
    await assert.rejects(rs.exec("rm -f /wrote; echo long <<<$(touch /wrote)", {limits: {maxOutputBytes: 2}}), /maxOutputBytes/);
    assert.equal((await rs.exec("test -f /wrote")).exitCode, 0);
  } finally { rs.dispose(); }
});

test("xmllint recovery consumes one UTF-16 unit of a malformed root terminator", async () => {
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [tail, error] of [["🪴", "text outside the root"], ["🪴<!", "text outside the root"], ["🪴]]>", "CDATA terminator in text"]]) {
      const r = await rs.exec("xmllint --recover --noout <<< '<r/" + tail + "'");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [1, "", "xmllint: Invalid XML: " + error + "\n"], tail);
    }
  } finally { rs.dispose(); }
});

test("xmllint retains recovered low surrogates in their original text node and output encoding", async () => {
  const rs = new RustWasmBash({cwd: "/", files: {"/f": "<p><r/🪴text</p>"}});
  try {
    const warn = "xmllint: unterminated start tag (recovered)\n";
    for (const [args, wanted] of [
      ["", '<?xml version="1.0"?>\n<p><r/>&#xDEB4;text</p>\n'],
      ["--encode US-ASCII", '<?xml version="1.0" encoding="US-ASCII"?>\n<p><r/>&#57012;text</p>\n'],
      ["--c14n", "<p><r></r>�text</p>"], ["--xpath 'count(/p/text())'", "1\n"],
      ["--xpath 'string-length(/p)'", "5\n"], ["--xpath 'string(/p)'", "�text\n"],
    ]) {
      const r = await rs.exec("xmllint --recover " + args + " /f");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, wanted, warn], args);
    }
    const r = await rs.exec("xmllint --recover --encode UTF-16LE /f");
    assert.deepEqual(Buffer.from(r.stdoutBytes), Buffer.from('<?xml version="1.0" encoding="UTF-16LE"?>\n<p><r/>\udeb4text</p>\n', "utf16le"));
  } finally { rs.dispose(); }
});

test("the shell rejects process-id expansion at the second dollar before running the command", async () => {
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [script, offset, stdout] of [
      ["echo $$", 6, ""], ['echo "$$"', 7, ""], ["echo 🦊; echo $$", 15, ""],
      ["echo ok\necho $$", 14, "ok\n"], ['echo "${x:-$$}"', 12, ""],
    ]) {
      const r = await rs.exec(script);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, stdout, "shell: Unsupported shell quoting or special parameter at offset " + offset + "\n"], script);
    }
    for (const [script, status, diagnostic] of [
      ["echo ${$}", 2, "shell: Unsupported parameter expansion at offset 7\n"],
      ['echo $(echo "$$")', 127, 'shell: -c: line 1: syntax error near unexpected token `$"\'\nshell: -c: line 1: `echo $(echo "$$")\'\n'],
      ["cat <<EOF\n$$\nEOF", 1, "shell: line 1: Unsupported shell quoting or special parameter at offset 1\n"],
    ]) {
      const r = await rs.exec(script);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [status, "", diagnostic], script);
    }
    const literal = await rs.exec("echo '$$' \\$\\$; cat <<'EOF'\n$$\nEOF");
    assert.deepEqual([literal.exitCode, literal.stdout, literal.stderr], [0, "$$ $$\n$$\n", ""]);
  } finally { rs.dispose(); }
});

test("arithmetic rejects process-id expansion only when the expression executes", async () => {
  const rs = new RustWasmBash({cwd: "/"});
  try {
    for (const [command, offset] of [['echo $(( $$ ))', 2], ['(( 1+$$ ))', 4], ["let 'n=$$'", 3]]) {
      const r = await rs.exec('echo before; ' + command + '; echo after');
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, "before\n", "shell: Unsupported shell quoting or special parameter at offset " + offset + "\n"], command);
    }
    const continued = await rs.exec('v=ok; echo $\\\n$v "$\\\n$"');
    assert.deepEqual([continued.exitCode, continued.stdout, continued.stderr], [0, "$ok $$\n", ""]);
    const skipped = await rs.exec("if false; then echo $(( $$ )); fi; echo done");
    assert.deepEqual([skipped.exitCode, skipped.stdout, skipped.stderr], [0, "done\n", ""]);
  } finally { rs.dispose(); }
});

test("xmllint rejects invalid output bytes without overwriting a private-use filename", async () => {
  const name = "\ue0ff";
  const sh = new RustWasmBash({cwd: "/", env: {V: name}, files: {["/" + name]: "<known/>", "/valid": name, "/raw": Uint8Array.of(255)}});
  try {
    for (const arg of ["$'\\xff'", '"$(cat /raw)"']) {
      const r = await sh.exec("xmllint --output " + arg + " <<<'<new/>'");
      assert.deepEqual([r.exitCode, r.stderr, new TextDecoder().decode(await sh.fs.readFile("/" + name))],
        [2, "xmllint: XPath and filenames require valid UTF-8\n", "<known/>"], arg);
    }
    for (const arg of ["'" + name + "'", '"$V"', "$'\\ue0ff'", '"$(cat /valid)"']) {
      const r = await sh.exec("xmllint --xpath 'count(/known)' " + arg);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "1\n", ""], arg);
    }
  } finally { sh.dispose(); }
});

test("XML commands validate argument bytes in command-specific order", async () => {
  const sh = new RustWasmBash({cwd: "/"});
  try {
    for (const [cmd, error] of [
      ["xmllint --encode $'\\xff'", "xmllint: XPath and filenames require valid UTF-8"],
      ["xmllint --xpath $'\\xff' --bad", "xmllint: expected XML input FILE or -"],
      ["xmllint --xpath $'\\xff' -", "xmllint: XPath and filenames require valid UTF-8"],
      ["xmllint -- $'\\xff'", "xmllint: XPath and filenames require valid UTF-8"],
      ["xq --version $'\\xff'", "xq: filters and filenames require valid UTF-8"],
    ]) {
      const r = await sh.exec(cmd);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [2, "", error + "\n"], cmd);
    }
  } finally { sh.dispose(); }
});

test("private-use text crosses filesystem, shell source and session boundaries once", async () => {
  const name = "\ue0ee\ue083\ue0bf";
  const dir = "/" + name;
  const sh = new RustWasmBash({cwd: dir, env: {V: name}, files: {[dir + "/" + name]: "ok"}});
  try {
    const r = await sh.exec("printf '%s\\n' \"$PWD\" \"$V\"; cat '" + name + "'; ln -s '" + name + "' link; readlink link; printf '%s' *");
    assert.deepEqual([r.exitCode, r.stdout, r.stderr, r.cwd], [0, dir + "\n" + name + "\nok" + name + "\nlink" + name, "", dir]);
    for (const cmd of ["printf '%s' $'" + name + "'", "eval \"printf %s '$V'\"", "bash -c \"printf %s '$V'\""]) {
      const out = await sh.exec(cmd);
      assert.deepEqual([out.exitCode, out.stdout, out.stderr], [0, name, ""], cmd);
    }
    const {state} = await sh.exec("set -- \"$V\"; a=(\"$V\")", {onState() {}});
    assert.deepEqual([state.cwd, state.variables.V, state.positionalParams[0], state.arrays.a.elements[0]], [dir, name, name, name]);
    const restored = await sh.exec('printf "%s:" "$PWD" "$1" "${a[0]}"', {state});
    assert.equal(restored.stdout, dir + ":" + name + ":" + name + ":");
    const syntax = await sh.exec("echo '" + name + "' $$");
    assert.equal(syntax.stderr, "shell: Unsupported shell quoting or special parameter at offset 12\n");
  } finally { sh.dispose(); }
});

test("parameter lengths and slices count shell bytes only in the byte locale", async () => {
  const sh = new RustWasmBash({env: {X: "a\ue0ffb"}});
  try {
    for (const [env, length, slice] of [
      [{LANG: "C.UTF-8"}, "3:", [0xee, 0x83, 0xbf]],
      [{LANG: "C.UTF-8", LC_CTYPE: "C"}, "5:", [0xee]],
      [{LC_ALL: "POSIX"}, "5:", [0xee]],
    ]) {
      const r = await sh.exec('printf "%s:%s" "${#X}" "${X:1:1}"', {env});
      assert.deepEqual([...r.stdoutBytes], [...Buffer.from(length), ...slice], JSON.stringify(env));
    }
  } finally { sh.dispose(); }
});

test("ls and find escape display names but preserve raw print0 paths", async () => {
  const sh = new RustWasmBash({files: {"/names/\ue0ff": "data"}});
  try {
    const escaped = "\\356\\203\\277";
    for (const [cmd, expected] of [
      ["ls /names", escaped + "\n"], ["find /names", "/names\n/names/" + escaped + "\n"],
      ["find /names -print", "/names\n/names/" + escaped + "\n"],
      ["find /names -print0", "/names\0/names/\ue0ff\0"],
      ["cp -v /names/\ue0ff /dest", "'/names/" + escaped + "' -> '/dest'\n"],
    ]) {
      const r = await sh.exec(cmd);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], cmd);
    }
  } finally { sh.dispose(); }
});

test("XML and Markdown queries render private-use text once in results and diagnostics", async () => {
  const n = "\ue0ff", sh = new RustWasmBash({cwd: "/", env: {V: n}, files: {["/" + n]: "<r/>"}});
  try {
    for (const [script, code, stdout, stderr] of [
      ["xq -r env.V " + n, 0, n + "\n", ""],
      ["xq -c --arg " + n + " val '$ARGS.named' " + n, 0, '{"' + n + '":"val"}\n', ""],
      ["xq --" + n, 2, "", "jq: unsupported option --" + n + "\n"],
      ["xq . missing" + n, 2, "", "jq: ENOENT: no such file or directory, readStream '/missing" + n + "'\n"],
      ["mdq . missing" + n, 1, "", 'entity not found while reading file "missing' + n + '"\n'],
    ]) {
      const r = await sh.exec(script);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [code, stdout, stderr], script);
    }
  } finally { sh.dispose(); }
});

test("xmllint serializes deep documents and discards the tree after a late parse error", async () => {
  const depth = 12000, doc = "<r>".repeat(depth) + "leaf" + "</r>".repeat(depth);
  const sh = new RustWasmBash({files: {"/doc": doc, "/bad": doc + "<extra/>"}});
  try {
    const r = await sh.exec("xmllint /doc");
    assert.deepEqual([r.exitCode, r.stderr], [0, ""]);
    assert.equal(r.stdout, '<?xml version="1.0"?>\n' + doc + "\n");
    const bad = await sh.exec("xmllint /bad");
    assert.deepEqual([bad.exitCode, bad.stdout, bad.stderr], [1, "", "xmllint: Invalid XML: multiple root elements\n"]);
  } finally { sh.dispose(); }
});

test("xmllint transforms deeply nested whitespace and CDATA in document order", async () => {
  const open = "<r>".repeat(2048), close = "</r>".repeat(2048);
  const body = '<a>  <b/> \n</a><a xml:space="preserve"> <b/> </a><c>x<![CDATA[y]]> z</c>';
  const sh = new RustWasmBash({files: {"/doc": open + body + close}});
  try {
    const r = await sh.exec("xmllint --noblanks --nocdata /doc");
    assert.deepEqual([r.exitCode, r.stderr], [0, ""]);
    assert.equal(r.stdout, '<?xml version="1.0"?>\n' + open + '<a><b/></a><a xml:space="preserve"> <b/> </a><c>xy z</c>' + close + "\n");
  } finally { sh.dispose(); }
});

test("xmllint canonicalizes deep namespace changes and restores sibling bindings", async () => {
  const open = "<n>".repeat(5000), close = "</n>".repeat(5000);
  const tree = '<r xmlns:p="urn:old">' + open + '<a xmlns:p="urn:new"><p:x/></a><p:y/>' + close + '</r>';
  const sh = new RustWasmBash({files: {"/doc": tree}});
  try {
    for (const [flag, root, inner] of [
      ["--c14n", '<r xmlns:p="urn:old">', '<a xmlns:p="urn:new"><p:x></p:x></a><p:y></p:y>'],
      ["--exc-c14n", '<r>', '<a><p:x xmlns:p="urn:new"></p:x></a><p:y xmlns:p="urn:old"></p:y>'],
    ]) {
      const r = await sh.exec("xmllint " + flag + " /doc");
      assert.deepEqual([r.exitCode, r.stderr], [0, ""]);
      assert.equal(r.stdout, root + open + inner + close + "</r>");
    }
  } finally { sh.dispose(); }
});

test("XPath traverses deep document text and restores namespace bindings for later siblings", async () => {
  const depth = 8000, xml = '<r xmlns:p="urn:outer">' + '<n>'.repeat(depth) +
    '<p:x>alpha<![CDATA[beta]]></p:x><a xmlns:p="urn:inner"><p:x>wrong</p:x></a><p:x>omega</p:x>' +
    '</n>'.repeat(depth) + '</r>';
  const sh = new RustWasmBash({files: {"/doc": xml}});
  try {
    for (const [query, expected] of [["count(//n)", String(depth)], ["count(//p:x)", "2"], ["string(/r)", "alphabetawrongomega"]]) {
      const r = await sh.exec("xmllint --xpath '" + query + "' /doc");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected + "\n", ""], query);
    }
    await assert.rejects(sh.exec("xmllint --xpath '//n' /doc >/dev/null", {limits: {maxOutputBytes: 1000}}), /maxOutputBytes/);
  } finally { sh.dispose(); }
});

test("xmllint formats deep XML up to the encoded output budget before publishing", async () => {
  const depth = 540, doc = "<r>".repeat(depth) + "é" + "</r>".repeat(depth);
  const sh = new RustWasmBash({cwd: "/", files: {"/doc": doc, "/out": "original"}});
  try {
    const lines = Array.from({length: depth - 1}, (_, i) => "  ".repeat(i) + "<r>");
    const body = [...lines, "  ".repeat(depth - 1) + "<r>é</r>", ...lines.reverse().map(line => line.replace("<r>", "</r>"))].join("\n") + "\n";
    for (const [enc, bytes] of [["UTF-8", "utf8"], ["UTF-16LE", "utf16le"], ["ISO-8859-1", "latin1"]]) {
      const expected = Buffer.from('<?xml version="1.0" encoding="' + enc + '"?>\n' + body, bytes);
      const cmd = "xmllint --format --encode " + enc;
      const r = await sh.exec(cmd + " /doc", {limits: {maxOutputBytes: expected.length}});
      assert.deepEqual([r.exitCode, r.stderr], [0, ""]);
      assert.deepEqual(Buffer.from(r.stdoutBytes), expected);
      await assert.rejects(sh.exec(cmd + " -o /out /doc", {limits: {maxOutputBytes: expected.length - 1}}), /maxOutputBytes/);
      assert.equal(Buffer.from(await sh.fs.readFile("/out")).toString(), "original");
    }
    const r = await sh.exec("xmllint --format -o /missing/out /doc", {limits: {maxOutputBytes: 100}});
    assert.deepEqual([r.exitCode, r.stderr], [6, "xmllint: ENOENT: no such file or directory, prepareStagingResolution '/missing/out'\n"]);
    await assert.rejects(sh.exec("xmllint --format /doc >/dev/null", {limits: {maxOutputBytes: 100}}), /maxOutputBytes/);
  } finally { sh.dispose(); }
});

test("writes to the default null device consume the output quota before the next command", async () => {
  const sh = new RustWasmBash({files: {"/two": Uint8Array.of(0xff, 0x61)}});
  try {
    for (const script of ["cat /two >/dev/null", "exec 3<>/dev/null; cat /two >&3", "{ printf ab >&2; } 2>/dev/null"]) {
      const ok = await sh.exec(script, {limits: {maxOutputBytes: 2}});
      assert.deepEqual([ok.exitCode, ok.stdout, ok.stderr], [0, "", ""], script);
      await assert.rejects(sh.exec(script + "; touch /later", {limits: {maxOutputBytes: 1}}), /maxOutputBytes/, script);
      await assert.rejects(sh.fs.stat("/later"), {code: "ENOENT"});
    }
    await assert.rejects(sh.exec("printf a >/dev/null; printf b >>/dev/null", {limits: {maxOutputBytes: 1}}), /maxOutputBytes/);
  } finally { sh.dispose(); }
});

test("xq converts deep XML to raw JSON with ordered groups and mixed content", async () => {
  const depth = 12000, root = "<r>".repeat(depth), tail = "</r>".repeat(depth);
  const xml = root + '<m a="1"> before <x/> <y>2</y><x>3</x><![CDATA[after]]> </m>' + tail;
  const sh = new RustWasmBash({files: {"/doc": xml}});
  try {
    const r = await sh.exec("xq -Rr . /doc");
    assert.deepEqual([r.exitCode, r.stderr], [0, ""]);
    assert.equal(r.stdout, '{"r":'.repeat(depth) + '{"m":{"@a":"1","x":[null,"3"],"y":"2","#text":"before  after"}}' + '}'.repeat(depth) + "\n");
    await sh.fs.writeFile("/doc", Buffer.from(xml + "<extra/>"));
    for (const [cmd, diagnostic] of [["xq .", "jq: Invalid XML: multiple root elements"], ["yq -p xml .", "Error: bad xml input: Invalid XML: multiple root elements"]]) {
      const bad = await sh.exec(cmd + " /doc");
      assert.deepEqual([bad.exitCode, bad.stdout, bad.stderr], [1, "", diagnostic + "\n"]);
    }
  } finally { sh.dispose(); }
});

test("output limits stop later list commands and apply to background output", async () => {
  const sh = new RustWasmBash({files: {"/f": "ab"}});
  try {
    for (const script of ["cat /f && touch /later", "cat /f >&2 && touch /later", "cat /f & wait"]) {
      await assert.rejects(sh.exec(script, {limits: {maxOutputBytes: 1}}), /maxOutputBytes/, script);
      await assert.rejects(sh.fs.stat("/later"), {code: "ENOENT"});
    }
  } finally { sh.dispose(); }
});

test("shells forward nested command output without spending its quota again", async () => {
  const sh = new RustWasmBash({files: {"/f": Uint8Array.of(0xff, 0x61), "/script": "cat /f"}});
  try {
    for (const [script, limit, channel] of [
      ["{ { cat /f; }; }", 2, "stdoutBytes"],
      ["(cat /f) >&2", 2, "stderrBytes"],
      ["if true; then for i in 1; do cat /f; done; fi", 2, "stdoutBytes"],
      ["f(){ cat /f; }; f | cat", 4, "stdoutBytes"],
      ["{ cat /f | cat; } | { cat; }", 6, "stdoutBytes"],
      ["{ cat /f >&2 | true; }", 2, "stderrBytes"],
      ["sh -c 'cat /f'", 2, "stdoutBytes"],
      ["bash /script", 2, "stdoutBytes"],
      ["f(){ cat /f >/dev/null; cat /f; }; f", 4, "stdoutBytes"],
      ["{ x=$(printf aa); cat /f; }", 4, "stdoutBytes"],
      ["{ x=$(cat /f >&2); }", 2, "stderrBytes"],
    ]) {
      const r = await sh.exec(script, {limits: {maxOutputBytes: limit}});
      assert.equal(r.exitCode, 0, script);
      assert.deepEqual(r[channel], Uint8Array.of(0xff, 0x61), script);
      await assert.rejects(sh.exec(script + "; touch /later", {limits: {maxOutputBytes: limit - 1}}), /maxOutputBytes/, script);
      await assert.rejects(sh.fs.stat("/later"), {code: "ENOENT"});
    }
  } finally { sh.dispose(); }
});

test("redirecting a nested command preserves the quota for each output stream", async () => {
  const sh = new RustWasmBash();
  try {
    for (const [script, limit, stdout, stderr, file] of [
      ["env sh -c 'printf a; printf bc >&2' >/dest", 3, "", "bc", "a"],
      ["env sh -c 'printf a; printf bc >&2' 2>/dest", 3, "a", "", "bc"],
      ["exec 3<>/dest; env sh -c 'printf a; printf bc >&2' >&3 2>&3", 3, "", "", "abc"],
      ["env sh -c 'printf ab' >/dev/null; printf c", 3, "c", "", ""],
      ["{ [[ $(printf a >&2) ]] 2>/dev/null; printf z; }", 2, "z", "", ""],
    ]) {
      await sh.fs.writeFile("/dest", Buffer.alloc(0));
      const r = await sh.exec(script, {limits: {maxOutputBytes: limit}});
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, stdout, stderr], script);
      assert.equal(Buffer.from(await sh.fs.readFile("/dest")).toString(), file, script);
      await assert.rejects(sh.exec(script + "; touch /later", {limits: {maxOutputBytes: limit - 1}}), /maxOutputBytes/, script);
      await assert.rejects(sh.fs.stat("/later"), {code: "ENOENT"});
    }
  } finally { sh.dispose(); }
});

test("path-based writes to mounted devices charge only newly emitted bytes", async () => {
  const sh = new RustWasmBash({deviceView: "provided"});
  sh.mountDevices();
  try {
    for (const script of ["env sh -c 'printf aa' >/dev/null", "exec 3<>/dev/null; env sh -c 'printf aa' >&3"]) {
      const r = await sh.exec(script, {limits: {maxOutputBytes: 2}});
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, "", ""]);
      await assert.rejects(sh.exec(script, {limits: {maxOutputBytes: 1}}), /maxOutputBytes/);
    }
  } finally { sh.dispose(); }
});

test("jq decodes shell bytes once and emits UTF-8 from files, filters and variables", async () => {
  const pua = "\uE080";
  const sh = new RustWasmBash({files: {"/doc": JSON.stringify(pua), "/raw": pua, "/bad": Uint8Array.of(255), ["/" + pua]: JSON.stringify(pua)}});
  try {
    for (const [script, text] of [
      ["jq -r . /doc", pua], ["jq -r . /" + pua, pua], ["jq -nr '\"\\uE080\"'", pua],
      ["jq -r . <<< '\"" + pua + "\"'", pua], ["jq -nr --arg x '" + pua + "' '$x'", pua],
      ["export X='" + pua + "'; jq -nr '$ENV.X'", pua], ["jq -Rr . /raw", pua],
      ["jq -Rr . </bad", "�"], ["jq -nr --arg x $'\\xff' '$x'", "�"],
    ]) {
      const r = await sh.exec(script);
      assert.deepEqual([r.exitCode, r.stderr], [0, ""], script);
      assert.deepEqual(r.stdoutBytes, new TextEncoder().encode(text + "\n"), script);
    }
    const bad = await sh.exec("jq . /missing" + pua);
    assert.equal(bad.stderr, "jq: ENOENT: no such file or directory, readStream '/missing" + pua + "'\n");
  } finally { sh.dispose(); }
});

test("jq replaces malformed UTF-8 at raw file boundaries and JSON string escape boundaries", async () => {
  const sh = new RustWasmBash({files: {
    "/a": Uint8Array.of(97, 0xc3), "/b": Uint8Array.of(0xa9, 10),
    "/q": Uint8Array.of(34, 0xc3), "/z": Uint8Array.of(0xa9, 34, 10),
    "/broken": Uint8Array.of(0xed, 0xa0, 0x80, 10, 0xe2, 0xff),
    "/escaped": Uint8Array.of(34, 0xe2, 97, 92, 110, 0xed, 0xa0, 0x80, 34),
  }});
  try {
    for (const [script, expected] of [
      ["jq -Rr . /a /b", "a��\n"], ["jq -Rs . /a /b", '"a��\\n"\n'],
      ["jq -nRc '[inputs]' /a /b", '["a��"]\n'], ["jq -r . /q /z", "é\n"],
      ["jq -Rr . /broken", "�\n�\n"], ["jq -r . /escaped", "�\n�\n"],
    ]) {
      const r = await sh.exec(script);
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], script);
    }
    const prefix = Buffer.alloc(65534, 97);
    for (const [tail, suffix] of [[[0xf0, 98, 99, 100], "�cd"], [[0xf0, 0x9f, 0x90, 0x88], "🐈"]]) {
      await sh.fs.writeFile("/long", Buffer.concat([prefix, Buffer.from(tail)]));
      const r = await sh.exec("jq -Rr . /long");
      assert.deepEqual([r.exitCode, r.stdout.slice(65534), r.stderr], [0, suffix + "\n", ""]);
    }
  } finally { sh.dispose(); }
});

test("jq charges one read for a direct memory JSON operand and admits its bytes before that charge", async () => {
  for (const profile of ["warm-memory-fastpath", "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const sh = new RustWasmBash({files: {"/f": "12\n"}, profile});
    try {
      const cost = profile === "warm-memory-fastpath" ? 1 : 2;
      for (const path of ["/f", "/absent"]) {
        const cmd = `jq -c . ${path}`;
        await assert.rejects(sh.exec(cmd, {limits: {maxFileSystemOperations: cost - 1}}), /maxFileSystemOperations/);
        const r = await sh.exec(cmd, {limits: {maxFileSystemOperations: cost}});
        assert.deepEqual([r.exitCode, r.stdout, r.stderr], path === "/f" ? [0, "12\n", ""] :
          [2, "", "jq: ENOENT: no such file or directory, readStream '/absent'\n"]);
      }
      if (cost === 1) {
        await sh.fs.utimes("/f", 1, 1);
        await assert.rejects(sh.exec("jq -n 'first(inputs)' /f", {limits: {maxFileSystemOperations: 0, maxInputBytes: 2}}), /maxInputBytes/);
        assert.notEqual((await sh.fs.stat("/f")).atimeMs, 1);
      }
    } finally { sh.dispose(); }
  }
});

test("jq early errors stop at the filesystem chunk actually requested", async () => {
  const files = { "/a": "1\n" + " ".repeat(65531) + "2  \n", "/empty": "" };
  for (const profile of ["warm-memory-fastpath", "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const sh = new RustWasmBash({ files, profile });
    try {
      for (const operands of ["/a", "/a /empty"]) {
        const r = await sh.exec(`jq -nc 'inputs | select(. == 2) | error' ${operands}`);
        const line = operands === "/a" && profile === "warm-memory-fastpath" ? 2 : 1;
        assert.deepEqual([r.exitCode, r.stderr], [5, `jq: error (at /a:${line}): 2\n`], profile);
      }
    } finally { sh.dispose(); }
  }
});

test("jq reports the line reached when a filter stops reading JSON inputs", async () => {
  const sh = new RustWasmBash();
  try {
    for (const padding of [16381, 16382]) {
      await sh.fs.writeFile("/a", new TextEncoder().encode("1\n2 " + " ".repeat(padding) + "\n"));
      const r = await sh.exec("jq -nc 'inputs | select(. == 2) | error' /a");
      assert.deepEqual([r.exitCode, r.stderr], [5, `jq: error (at /a:${padding === 16381 ? 2 : 1}): 2\n`]);
      const drained = await sh.exec("jq 'select(. == 2) | error' /a");
      assert.deepEqual([drained.exitCode, drained.stderr], [5, "jq: error (at /a:2): 2\n"]);
    }
  } finally { sh.dispose(); }
});

test("jq admits a single memory file when its JSON input is first requested", async () => {
  const files = {"/f": "12\n34\n"};
  for (const profile of ["warm-memory-fastpath", "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const sh = new RustWasmBash({files, profile});
    try {
      const limits = {maxInputBytes: 5};
      for (const script of ["jq -c . /f", "jq -n 'first(inputs)' /f", "jq --stream -c length /f"]) {
        if (profile === "warm-memory-fastpath") await assert.rejects(sh.exec(script, {limits}), /maxInputBytes/, script);
        else assert.equal((await sh.exec(script, {limits})).exitCode, 0, script);
      }
      for (const [script, expected] of [
        ["jq -n 1 /f", "1\n"], ["jq -Rr . /f", files["/f"]], ["jq -c . /f /f", files["/f"].repeat(2)],
        ["jq --slurpfile v /f -nc '$v'", "[12,34]\n"],
      ]) {
        const r = await sh.exec(script, {limits});
        assert.deepEqual([r.exitCode, r.stdout, r.stderr], [0, expected, ""], script);
      }
      assert.equal((await sh.exec("jq -c . /f", {limits: {maxInputBytes: 6}})).stdout, files["/f"]);
    } finally { sh.dispose(); }
  }
});

test("overlay noclobber publishes on last close and preserves a competing writer", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    const dup = await sh.exec("set -C; exec 3>/dup 4>&3; exec 3>&-; printf abc >&4; test -e /dup; echo $?; exec 4>&-; cat /dup");
    assert.deepEqual([dup.exitCode,dup.stdout,dup.stderr],[0,"1\nabc",""]);
    const race = await sh.exec("set -C; cat >/race", {stdin:{async *[Symbol.asyncIterator]() {
      yield Buffer.from("abc");
      await sh.fs.writeFile("/race",Buffer.from("RIVAL"));
      yield Buffer.from("z");
    }}});
    assert.deepEqual([race.exitCode,race.stderr,sh.readText("/race")],[1,"shell: line 1: EEXIST: file already exists, overlay '/race'\n","RIVAL"]);
    await assert.rejects(sh.exec("set -C; cat >/abort",{stdin:"abcd",limits:{maxOutputBytes:3}}),{limit:"maxOutputBytes"});
    await assert.rejects(sh.fs.stat("/abort"),{code:"ENOENT"});
    assert.equal((await sh.exec("set -C; false >/empty")).exitCode,1);
    assert.equal(sh.readText("/empty"),"");
    assert.equal((await sh.exec("set -C; echo a >/first >/missing/out")).exitCode,1);
    await assert.rejects(sh.fs.stat("/first"),{code:"ENOENT"});
  } finally { sh.dispose(); }
});

test("an exclusive exec descriptor reports a close conflict to its owning shell", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs"});
  try {
    const open = "set -C; exec 3>/f; set +C; echo rival >/f; ";
    for (const end of ["exit 7","exec 3>&-; echo late >/after"]) {
      await sh.exec("rm -f /f");
      await assert.rejects(sh.exec(open+end),{name:"FsError",code:"EEXIST",syscall:"overlay",path:"/f"});
      assert.equal(sh.readText("/f"),"rival\n");
      await assert.rejects(sh.fs.stat("/after"),{code:"ENOENT"});
    }
    await sh.exec("rm /f");
    const sub = await sh.exec("("+open+"false); echo end");
    assert.deepEqual([sub.exitCode,sub.stdout,sub.stderr],[0,"end\n","shell: line 1: EEXIST: file already exists, overlay '/f'\n"]);
  } finally { sh.dispose(); }
});

test("cat charges named reads in operand order for each filesystem profile", async () => {
  for (const [profile,minimum] of [["wasm-only",2],["overlay-cow-fs",8],["strict-budgets-mount-dev",8]]) {
    const sh = new RustWasmBash({profile,files:{"/f":"a"}});
    try {
      await assert.rejects(sh.exec("cat /f /f",{limits:{maxFileSystemOperations:minimum-1}}),{limit:"maxFileSystemOperations"});
      const r = await sh.exec("cat /f /f",{limits:{maxFileSystemOperations:minimum}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"aa",""],profile);
      if (profile === "overlay-cow-fs") {
        for (const [limit,visible] of [[11,""],[12,"a"]]) {
          await assert.rejects(sh.exec("cat /f /missing /f >/out",{limits:{maxFileSystemOperations:limit}}),{limit:"maxFileSystemOperations"});
          assert.equal(sh.readText("/out"),visible);
        }
      }
    } finally { sh.dispose(); }
  }
});

test("rg inherits ignore rules by directory, source priority and repository boundary", async () => {
  const sh = new RustWasmBash({cwd:"/p",files:{
    "/p/.gitignore":"gitfile\n","/p/.ignore":"*.log\n","/p/d/.gitignore":"!keep.log\n",
    "/p/d/.rgignore":"!.kept\n/sub/file\n","/p/d/.kept":"","/p/d/gitfile":"",
    "/p/d/keep.log":"","/p/d/sub/file":"","/p/d/sub/gitfile":"","/p/rules":"d/sub/file\n"
  }});
  try {
    const list = async (args,expected) => {
      const r = await sh.exec("rg --files "+args);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,expected,""],args);
    };
    await list("d","d/.kept\nd/gitfile\nd/sub/gitfile\n");
    await list("--no-require-git d","d/.kept\n");
    await sh.exec("mkdir -p /p/.git /p/d/sub/.git");
    await list("d","d/.kept\nd/sub/gitfile\n");
    await list("--no-ignore-parent d","d/.kept\nd/gitfile\nd/keep.log\nd/sub/gitfile\n");
    await list("--no-ignore --ignore-file rules d","d/gitfile\nd/keep.log\nd/sub/gitfile\n");
    await sh.fs.writeFile("/p/d/.rgignore",Buffer.from("bad{"));
    const bad = await sh.exec("rg --files d");
    assert.deepEqual([bad.exitCode,bad.stdout,bad.stderr],[2,"d/sub/file\nd/sub/gitfile\n","rg: invalid glob: unclosed glob brace\n"]);
  } finally { sh.dispose(); }
});

test("recursive rg uses directory entry types and charges ignore lookups before reads", async () => {
  for (const [profile,ops] of [["warm-memory-fastpath",3],["strict-budgets-mount-dev",16],["overlay-cow-fs",16]]) {
    const sh = new RustWasmBash({profile,files:{"/d/a":"h\n","/d/n/b":"h\n","/d/.hidden":"h\n","/d/.ignore":"ignored\n","/d/ignored":"h\n","/d/.gitignore":"gitfile\n","/d/gitfile":"h\n"}});
    try {
      await assert.rejects(sh.exec("rg --files /d",{limits:{maxFileSystemOperations:ops-1}}),{limit:"maxFileSystemOperations"});
      const r = await sh.exec("rg --files /d",{limits:{maxFileSystemOperations:ops}});
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"/d/a\n/d/gitfile\n/d/n/b\n",""],profile);
    } finally { sh.dispose(); }
  }
});

test("rg CLI globs use cwd-relative path components and validate before visiting operands", async () => {
  const sh = new RustWasmBash({cwd:"/w",files:{"/w/d/a.rs":"","/w/d/b.ts":"","/w/d/n/a.rs":"","/w/d/i:a":"","/outside/a.rs":""}});
  try {
    for (const [args,expected] of [
      ["-g 'd/*.rs' /w/d","/w/d/a.rs\n"],["-g 'd/**/{a,b}.*' d","d/a.rs\nd/b.ts\nd/n/a.rs\n"],
      ["-g 'i:a' d","d/i:a\n"],["-g '../outside/a.rs' /outside","/outside/a.rs\n"],
      ["--iglob '/D/[A-B].RS' d","d/a.rs\n"]
    ]) {
      const r = await sh.exec("rg --files "+args);
      assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,expected,""],args);
    }
    const bad = await sh.exec("rg --files -g '[a' d/a.rs");
    assert.deepEqual([bad.exitCode,bad.stdout,bad.stderr],[2,"","rg: invalid glob: unclosed glob character class\n"]);
    await sh.fs.writeFile("/w/d/λ",new Uint8Array());
    const folded = await sh.exec("rg --files --iglob '*.ts' d");
    assert.deepEqual([folded.exitCode,folded.stdout,folded.stderr],[2,"d/b.ts\n","rg: bounded regex unsupported: glob case folding supports ASCII paths only\n"]);
  } finally { sh.dispose(); }
});

test("rg opens pattern and ignore files through the operand's actual ancestors", async () => {
  for (const profile of ["warm-memory-fastpath","strict-budgets-mount-dev","overlay-cow-fs"]) {
    const sh = new RustWasmBash({profile,cwd:"/w",files:{"/w/rules":"wrong","/w/sub/rules":"hit","/w/sub/dir/x":"","/w/priv/file":"hit","/w/data":"hit\n"}});
    try {
      assert.equal((await sh.exec("ln -s sub/dir alias")).exitCode,0);
      await sh.fs.chmod("/w/priv",0);
      for (const command of ["rg -f priv/../rules data","rg --files --ignore-file priv/../rules data"]) {
        const r = await sh.exec(command);
        const denied = profile === "warm-memory-fastpath" ? "readFile '/w/priv/../rules'" : profile === "strict-budgets-mount-dev" ? "capabilitiesFor '/w/priv/../rules'" : "overlay '/w/priv'";
        assert.deepEqual([r.exitCode,r.stdout,r.stderr],[2,"","rg: EACCES: permission denied, "+denied+"\n"],profile+" "+command);
      }
      const empty = await sh.exec("rg -f '' data",{limits:{maxFileSystemOperations:0}});
      assert.deepEqual([empty.exitCode,empty.stdout,empty.stderr],[2,"",profile === "warm-memory-fastpath"
        ? "rg: ENOENT: no such file or directory ''\n" : "rg: invalid empty or NUL-containing path\n"]);
      const alias = await sh.exec("rg -f alias/../rules data");
      assert.deepEqual([alias.exitCode,alias.stdout,alias.stderr],profile === "overlay-cow-fs"
        ? [2,"","rg: ENOENT: no such file or directory, realpath '/w/alias/../rules'\n"] : [0,"hit\n",""]);
    } finally { sh.dispose(); }
  }
});

test("rm on direct memory removes one file per admitted operation", async () => {
  const sh = new RustWasmBash({files:{"/w/a":"a","/w/b":"b"}});
  try {
    await assert.rejects(sh.exec("rm /w/a /w/b",{limits:{maxFileSystemOperations:1}}), /maxFileSystemOperations/);
    assert.equal((await sh.exec("test -e /w/a")).exitCode,1);
    assert.equal((await sh.exec("cat /w/b")).stdout,"b");
    const r = await sh.exec("rm -fv /w/b /w/missing",{limits:{maxFileSystemOperations:2}});
    assert.deepEqual([r.exitCode,r.stdout,r.stderr],[0,"removed '/w/b'\nremoved '/w/missing'\n",""]);
  } finally { sh.dispose(); }
});

test("rm checks all operands before deleting, then charges each guarded removal", async () => {
  for (const profile of ["strict-budgets-mount-dev","overlay-cow-fs","warm-memory-fastpath"]) {
    const sh = new RustWasmBash({profile, files:{"/w/a":"a","/w/b":"b"}});
    try {
      if (profile === "warm-memory-fastpath") await sh.exec("ln -s /w/a /link");
      for (const [limit, first, second] of [[9,true,true],[10,false,true],[15,false,true],[16,false,false]]) {
        await sh.exec("echo a >/w/a; echo b >/w/b");
        const run = sh.exec("rm /w/a /w/b",{limits:{maxFileSystemOperations:limit}});
        if (limit < 16) await assert.rejects(run,/maxFileSystemOperations/);
        else assert.equal((await run).exitCode,0);
        for (const [file,present] of [["/w/a",first],["/w/b",second]]) {
          assert.equal((await sh.exec("test -e "+file)).exitCode,present ? 0 : 1, profile+" "+limit+" "+file);
        }
      }
      await sh.exec("echo keep >/w/a");
      const denied = await sh.exec("rm /w/a /dev/null");
      assert.deepEqual([denied.exitCode,denied.stdout,denied.stderr],[1,"","rm: ENOTSUP: operation not supported, rm '/dev/null'\n"]);
      assert.equal((await sh.exec("cat /w/a")).stdout,"keep\n");
    } finally { sh.dispose(); }
  }
});

test("overlay fs.rm removes empty visible directories and preserves nonempty ones", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/lower/file":"keep","/empty/hidden":"lower"}});
  try {
    await sh.fs.rm("/empty/hidden");
    await sh.fs.rm("/empty/.");
    await assert.rejects(sh.fs.lstat("/empty"),{code:"ENOENT"});
    await assert.rejects(sh.fs.rm("/lower/"),{code:"ENOTEMPTY",syscall:"overlay",path:"/lower/"});
    assert.equal(sh.readText("/lower/file"),"keep");
    await assert.rejects(sh.fs.rm("/absent/../lower",{recursive:true}),{code:"ENOENT",syscall:"overlay",path:"/absent"});
    assert.equal(sh.readText("/lower/file"),"keep");
  } finally { sh.dispose(); }
});

test("mv admits all routed operands before either rename", async () => {
  for (const profile of ["strict-budgets-mount-dev", "overlay-cow-fs"]) {
    for (const [limit, moved] of [[3,0],[5,0],[6,1],[7,2]]) {
      const sh = new RustWasmBash({profile,files:{"/w/a":"A","/w/b":"B","/w/d/keep":"K"}});
      try {
        const run = sh.exec("mv a b d",{cwd:"/w",limits:{maxFileSystemOperations:limit}});
        if (limit < 7) await assert.rejects(run,/maxFileSystemOperations/);
        else assert.equal((await run).exitCode,0);
        for (const [i,f] of ["a","b"].entries()) {
          const dest = i < moved;
          assert.equal(sh.readText((dest ? "/w/d/" : "/w/")+f),f.toUpperCase());
          assert.equal((await sh.exec("test -e "+(dest ? "/w/" : "/w/d/")+f)).exitCode,1);
        }
      } finally { sh.dispose(); }
    }
  }
});

test("mv preserves the source when an overlay device destination cannot be renamed", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/w/a":"A"}});
  try {
    for (const [command,target] of [["mv -T a /dev","/dev"],["mv a /dev","/dev/a"]]) {
      const result = await sh.exec(command,{cwd:"/w"});
      assert.equal(result.stderr,`mv: ENOTSUP: operation not supported, mv '${target}'\n`);
      assert.equal(result.exitCode,1);
      assert.equal(sh.readText("/w/a"),"A");
    }
  } finally { sh.dispose(); }
});

test("mv retries destination lstat before reporting a non-directory ancestor", async () => {
  for (const profile of ["warm-memory-fastpath","strict-budgets-mount-dev","overlay-cow-fs"]) {
    const sh = new RustWasmBash({profile,files:{"/w/a":"A","/w/b":"B"}});
    try {
      await sh.fs.symlink("b","/w/link");
      const run = limit => sh.exec("mv a link/child",{cwd:"/w",limits:{maxFileSystemOperations:limit}});
      await assert.rejects(run(2),/maxFileSystemOperations/);
      const result = await run(3);
      const path = profile === "overlay-cow-fs" ? "overlay '/w/b'" : "lstat '/w/link/child'";
      assert.equal(result.stderr,`mv: ENOTDIR: not a directory, ${path}\n`);
      assert.equal(sh.readText("/w/a"),"A");
    } finally { sh.dispose(); }
  }
});

test("mv removes a regular source only after a mounted device consumes it", async () => {
  const sh = new RustWasmBash({profile:"strict-budgets-mount-dev",files:{"/w/a":""}});
  try {
    for (const [size,limit] of [[0,22],[1,23],[65537,24]]) {
      const data = new Uint8Array(size).fill(65);
      await sh.fs.writeFile("/w/a",data);
      const move = n => sh.exec("mv /w/a /dev/null",{limits:{maxFileSystemOperations:n,maxOutputBytes:1}});
      await assert.rejects(move(limit-1),/maxFileSystemOperations/);
      assert.deepEqual(new Uint8Array(await sh.fs.readFile("/w/a")),data);
      assert.equal((await move(limit)).exitCode,0);
      await assert.rejects(sh.fs.lstat("/w/a"),{code:"ENOENT"});
    }
    await sh.fs.writeFile("/w/a",new Uint8Array(4));
    await assert.rejects(sh.exec("mv /w/a /dev/null",{limits:{maxInputBytes:3}}),/maxInputBytes/);
    assert.equal((await sh.fs.lstat("/w/a")).size,4);
    await sh.fs.writeFile("/w/a",new Uint8Array());
    assert.equal((await sh.exec("mv /w/a /dev/urandom")).exitCode,0);
    await assert.rejects(sh.fs.lstat("/w/a"),{code:"ENOENT"});
  } finally { sh.dispose(); }
});

test("mv checks the entry type before rejecting unsupported device operations", async () => {
  const sh = new RustWasmBash({profile:"strict-budgets-mount-dev",files:{"/w/dir/file":"keep"}});
  try {
    await sh.fs.symlink("dir/file","/w/l");
    for (const [command,ops,error] of [
      ["mv l /dev/null",11,"ENOTSUP: operation not supported, mv '/dev/null'"],
      ["mv /dev/null out",9,"ENOTSUP: operation not supported, removeEntryConditional '/dev/null'"],
      ["mv -T /dev/null dir",5,"EISDIR: illegal operation on a directory '/w/dir'"],
    ]) {
      const run = n => sh.exec(command,{cwd:"/w",limits:{maxFileSystemOperations:n}});
      await assert.rejects(run(ops-1),/maxFileSystemOperations/);
      const result = await run(ops);
      assert.equal(result.exitCode,1);
      assert.equal(result.stderr,"mv: "+error+"\n");
    }
    assert.equal(await sh.fs.readlink("/w/l"),"dir/file");
    assert.equal(sh.readText("/w/dir/file"),"keep");
  } finally { sh.dispose(); }
});

test("mv plans directory descendants before refusing publication on a device mount", async () => {
  const sh = new RustWasmBash({profile:"strict-budgets-mount-dev",files:{"/w/src/child":"keep"}});
  try {
    for (const [mode,target,n,error] of [
      [0o755,"/dev/null",13,"ENOTDIR: not a directory '/dev/null'"],
      [0o755,"/dev/absent",21,"ENOTSUP: operation not supported, mv '/dev/absent'"],
      [0,"/dev/absent",15,"EACCES: permission denied, readdir '/w/src'"],
      [0o444,"/dev/absent",16,"EACCES: permission denied, lstat '/w/src/child'"],
    ]) {
      await sh.fs.chmod("/w/src",mode);
      const run = limit => sh.exec("mv src "+target,{cwd:"/w",limits:{maxFileSystemOperations:limit}});
      await assert.rejects(run(n-1),/maxFileSystemOperations/);
      const result = await run(n);
      assert.equal(result.stderr,"mv: "+error+"\n");
      assert.equal(result.exitCode,1);
    }
    await sh.fs.chmod("/w/src",0o755);
    assert.equal(sh.readText("/w/src/child"),"keep");
  } finally { sh.dispose(); }
});

test("overlay rename resolves dot components and requires directories at trailing slashes", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/w/tree/sub/file":"keep"}});
  try {
    await assert.rejects(sh.fs.rename("/w/tree","/w/missing/"),{code:"ENOENT",syscall:"overlay",path:"/w/missing"});
    assert.equal(sh.readText("/w/tree/sub/file"),"keep");
    await sh.fs.rename("/w/tree/sub/..","/w/moved");
    assert.equal(sh.readText("/w/moved/sub/file"),"keep");
    const failure = await sh.exec("mv -T /w/moved/sub/file/ /w/out");
    assert.equal(failure.stderr,"mv: ENOTDIR: not a directory, overlay '/w/moved/sub/file'\n");
    assert.equal(sh.readText("/w/moved/sub/file"),"keep");
  } finally { sh.dispose(); }
});

test("overlay rename verifies a link in its backing layer before moving it", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/w/lower":"keep"},symlinks:{"/w/alias":"lower","/w/chain":"alias"}});
  try {
    await sh.fs.symlink("lower","/w/upper");
    await sh.fs.symlink("loop","/w/loop");
    for (const [name,code,syscall] of [["upper","ENOENT","realpath"],["loop","ELOOP","realpath"],["chain","ENOTSUP","overlay"]]) {
      await assert.rejects(sh.fs.rename("/w/"+name,"/w/moved"),{code,syscall,path:"/w/"+name});
      assert.equal((await sh.fs.lstat("/w/"+name)).type,"symlink");
      await assert.rejects(sh.fs.lstat("/w/moved"),{code:"ENOENT"});
    }
    await sh.fs.rename("/w/alias","/w/moved");
    assert.equal(await sh.fs.readlink("/w/moved"),"lower");
  } finally { sh.dispose(); }
});

test("overlay refuses to redirect a copied lower link when its parent changes", async () => {
  const sh = new RustWasmBash({profile:"overlay-cow-fs",files:{"/w/a":"A","/w/d/a":"other"},symlinks:{"/w/l":"a"}});
  try {
    await sh.fs.rename("/w/l","/w/renamed");
    await sh.fs.writeFile("/w/a",new Uint8Array([65]));
    await assert.rejects(sh.fs.rename("/w/renamed","/w/d/l"),{code:"ENOTSUP",syscall:"overlay",path:"/w/renamed"});
    assert.equal(await sh.fs.readlink("/w/renamed"),"a");
    await assert.rejects(sh.fs.lstat("/w/d/l"),{code:"ENOENT"});
    await sh.fs.rm("/w/renamed");
    await sh.fs.symlink("a","/w/renamed");
    await sh.fs.rename("/w/renamed","/w/d/l");
    assert.equal(await sh.fs.readlink("/w/d/l"),"a");
  } finally { sh.dispose(); }
});

test("rename checks protected device-view operands before the backing rename", async () => {
  const bash = new RustWasmBash({ cwd: "/", files: { "/file": "keep" }, directories: ["/d"], symlinks: { "/alias": "/d", "/root": "/", "/loop": "/loop" } });
  try {
    for (const [from,to,code,syscall,path] of [
      ["/","/dev/new","EBUSY",undefined,"/"], ["/alias/..","/out","EBUSY",undefined,"/alias/.."],
      ["/root/","/out","EBUSY",undefined,"/root/"], ["/missing","/dev/null","EBUSY",undefined,"/dev/null"],
      ["alias/../lost/..","/out","ENOENT","lstat","/lost"],
      ["/lost/..","/","ENOENT","lstat","/lost"], ["/file/..","/","ENOTDIR",undefined,"/file/.."],
      ["/dev/null/child","/out","ENOTDIR",undefined,"/dev/null/child"], ["/loop/x","/file","ELOOP",undefined,"/loop/x"],
      ["","/out","EBUSY",undefined,""], ["bad\0path","/","EINVAL","resolve",undefined],
    ]) {
      await assert.rejects(bash.fs.rename(from,to), e => {
        assert.deepEqual([e.code,e.syscall,e.path,e.dest],[code,syscall,path,undefined]); return true;
      });
    }
    const move = await bash.exec("mv -T / /dev/new");
    assert.deepEqual([move.exitCode,move.stderr],[1,"mv: EBUSY: resource busy or locked '/'\n"]);
    await bash.fs.rename("/root","/out");
    assert.equal(await bash.fs.readlink("/out"),"/");
    assert.equal(new TextDecoder().decode(await bash.fs.readFile("/file")),"keep");
  } finally { bash.dispose(); }
});
