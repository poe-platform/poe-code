import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { RustWasmBash, createRustWasmBash } from "./index.js";

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
      await assert.rejects(fs.copyFile("/dir/source", "/same"), {code:"EINVAL"});
      await assert.rejects(fs.copyFile("/dir/source", "/missing/file"), {code:"ENOENT"});
      await assert.rejects(fs.copyFile("/dir/source", "/dest", {signal:AbortSignal.abort()}), {name:"AbortError"});
      assert.equal(bash.readText("/dest"), "keep");
      await fs.copyFile("/same", "/alias");
      assert.equal(bash.readText("/dest"), "bytes");
      assert.equal((await fs.lstat("/dest")).mode & 0o777, 0o640);
      assert.equal(await fs.readlink("/alias"), "dest");
      if (profile === "strict-budgets-mount-dev") {
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

test("writeFile honors exclusive creation, append, permissions and cancellation", async () => {
  for (const profile of [undefined, "overlay-cow-fs", "strict-budgets-mount-dev"]) {
    const bash = new RustWasmBash({profile, files:{"/keep":{content:"old",mode:0o640}}});
    const fs = bash.fs;
    try {
      for (const flag of ["wx", "ax"]) {
        await assert.rejects(fs.writeFile("/keep", "lost", {flag}), {code:"EEXIST"});
      }
      assert.equal(bash.readText("/keep"), "old");
      await fs.writeFile("/keep", "!", {flag:"a",mode:0o400});
      assert.equal(bash.readText("/keep"), "old!");
      assert.equal((await fs.stat("/keep")).mode & 0o777, 0o640);
      await fs.symlink("new", "/link");
      await assert.rejects(fs.writeFile("/link", "no", {flag:"wx"}), {code:"EEXIST"});
      if (profile === "strict-budgets-mount-dev") {
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

test("companion replay retains only completed writes and their original bytes and options", async () => {
  const companion = new RustWasmBash();
  const bash = new RustWasmBash({forceNative:false, companionFactory:() => companion});
  try {
    const controller = new AbortController();
    const options = {flag:"wx", mode:0o600, signal:controller.signal};
    const bytes = Buffer.from("original");
    await bash.fs.writeFile("/created", bytes, options);
    bytes.fill(0);
    options.mode = 0o400;
    controller.abort();
    await assert.rejects(bash.fs.writeFile("/created", "bad", {flag:"ax"}), {code:"EEXIST"});
    await bash.fs.realpath("/created");
    assert.equal(companion.readText("/created"), "original");
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
        await assert.rejects(fs.readFile(path), {name:"FsError",code:"EACCES",syscall:"readFile",path});
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
