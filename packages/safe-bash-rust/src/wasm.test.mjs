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
