import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracleRoot, run, sha256 } from "./helpers.js";

const metadataStat = join(oracleRoot, "src/stat");
const benchmarkStat = "/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat";
const nativeTouch = join(oracleRoot, "src/touch");
const identities = [
  { label: "metadata-stat", path: metadataStat, hash: "9bfc67687cc527eb69aa7a877c1551c22db6ea46ff910ad055015958924e1fea", version: "stat (GNU coreutils) 9.7" },
  { label: "benchmark-stat", path: benchmarkStat, hash: "bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860", version: "stat (GNU coreutils) 9.7" },
  { label: "metadata-touch", path: nativeTouch, hash: "47fc9af399d94e27bc94c19eba754502b38dfb80fbad3d09c5f6b237698dbf68", version: "touch (GNU coreutils) 9.7" },
];

function execute(path: string, args: readonly string[], cwd: string) {
  const result = spawnSync(path, args, { cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, timeout: 3000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { argv: [path, ...args], cwd, exitCode: result.status, stdout: result.stdout.toString(), stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() };
}

function nativeHuman(nanoseconds: bigint): string {
  const remainder = ((nanoseconds % 1_000_000_000n) + 1_000_000_000n) % 1_000_000_000n;
  const seconds = (nanoseconds - remainder) / 1_000_000_000n;
  return `${new Date(Number(seconds * 1000n)).toISOString().slice(0, -5).replace("T", " ")}.${remainder.toString().padStart(9, "0")} +0000`;
}

function exactMilliseconds(nanoseconds: bigint): string {
  const magnitude = nanoseconds < 0 ? -nanoseconds : nanoseconds;
  const fractional = (magnitude % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${nanoseconds < 0 ? "-" : ""}${magnitude / 1_000_000n}${fractional ? `.${fractional}` : ""}`;
}

test("GNU 9.7 human timestamps: distinct pinned builds, measured native nanoseconds and numeric-capacity gaps", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  const work = join(root, "work");
  const file = join(work, "file");
  const sentinel = Buffer.from([0, 255, 83, 84, 65, 84]);
  await host.writeFile(file, sentinel);
  await host.writeFile(join(root, "sentinel"), sentinel);
  const binaryRecords = [];
  for (const identity of identities) {
    const hash = await sha256(identity.path);
    assert.equal(hash, identity.hash, identity.label);
    const version = execute(identity.path, ["--version"], root);
    assert.equal(version.exitCode, 0, version.stderr);
    assert.equal(version.stdout.split("\n")[0], identity.version);
    assert.equal(version.stderr, "");
    binaryRecords.push({ ...identity, measuredHash: hash, version });
  }
  const real = await createRealFileSystem({ root });
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/file", sentinel);
  const requestedValues = ["0", "1", "-1", "0.001", "-0.001", "0.000125", "-0.000125", "0.123456789", "-0.123456789", "0.000000001", "-0.000000001", "0.999999999", "-0.999999999", "1.000000001", "1700000000", "1700000000.123", "1700000000.123456", "1700000000.123456789", "-1700000000.123456789"];
  const rows = [];
  let exact = 0;
  let rounded = 0;
  let unavailable = 0;
  for (const requestedSeconds of requestedValues) {
    const setter = execute(nativeTouch, ["-a", "-m", "-d", `@${requestedSeconds}`, "file"], work);
    assert.equal(setter.exitCode, 0, setter.stderr);
    const raw = await host.stat(file, { bigint: true });
    const measured = await real.stat("/work/file");
    const requestedNs = BigInt(requestedSeconds.replace("-", "").split(".")[0]!) * 1_000_000_000n
      + BigInt((requestedSeconds.split(".")[1] ?? "").padEnd(9, "0"));
    const signedNs = requestedSeconds.startsWith("-") ? -requestedNs : requestedNs;
    assert.equal(raw.mtimeNs, signedNs, `native setter granularity: ${requestedSeconds}`);
    assert.equal(raw.atimeNs, signedNs);
    await memory.utimes("/work/file", measured.atimeMs, measured.mtimeMs);
    assert.equal((await memory.stat("/work/file")).mtimeMs, measured.mtimeMs);
    const native = execute(metadataStat, ["--printf=%x|%y", "file"], work);
    const benchmark = execute(benchmarkStat, ["--printf=%x|%y", "file"], work);
    const actual = await run("stat", ["--printf=%x|%y", "file"], real);
    const virtual = await run("stat", ["--printf=%x|%y", "file"], memory);
    assert.equal(native.exitCode, 0, native.stderr);
    assert.equal(native.stdout, `${nativeHuman(raw.atimeNs)}|${nativeHuman(raw.mtimeNs)}`);
    assert.equal(benchmark.exitCode, native.exitCode);
    assert.equal(benchmark.stdoutHex, native.stdoutHex);
    assert.equal(benchmark.stderr, native.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(virtual.exitCode, 0, virtual.stderr);
    assert.deepEqual(actual.stdout, virtual.stdout);
    const representable = exactMilliseconds(raw.mtimeNs) === measured.mtimeMs.toString();
    if (representable) {
      exact++;
      assert.equal(actual.stdout.toString(), native.stdout, requestedSeconds);
    } else if (actual.stdout.toString() === native.stdout) {
      rounded++;
    } else {
      unavailable++;
    }
    if (requestedSeconds.endsWith("1700000000.123456789")) assert.notEqual(actual.stdout.toString(), native.stdout, "native precision beyond numeric capacity stays nonexact");
    if (requestedSeconds === "1700000000") {
      const routed = execute(metadataStat, ["-c", "%Y:%y", "file"], work);
      const actualRouted = await run("stat", ["-c", "%Y:%y", "file"], real);
      assert.equal(routed.exitCode, 0, routed.stderr);
      assert.equal(actualRouted.exitCode, 0, actualRouted.stderr);
      assert.equal(routed.stdout, "1700000000:2023-11-14 22:13:20.000000000 +0000\n");
      assert.equal(actualRouted.stdout.toString(), routed.stdout);
    }
    rows.push({ requestedSeconds, requestedNs: signedNs.toString(), measuredNs: raw.mtimeNs.toString(), exactNativeMilliseconds: exactMilliseconds(raw.mtimeNs), measuredMs: measured.mtimeMs, measuredAtimeMs: measured.atimeMs, subMillisecondRemainderNs: (raw.mtimeNs % 1_000_000n).toString(), setter, native, benchmark, actual: { ...actual, stdout: actual.stdout.toString(), stdoutHex: actual.stdout.toString("hex") }, memory: { ...virtual, stdout: virtual.stdout.toString(), stdoutHex: virtual.stdout.toString("hex") }, classification: representable ? "exact native and VFS numeric value" : actual.stdout.toString() === native.stdout ? "numeric milliseconds differ; nearest-nanosecond rendering matches native" : "native nanoseconds unavailable in VFS numeric milliseconds; retained nonexact" });
  }
  assert.ok(exact > 0);
  assert.ok(unavailable > 0);
  const format = "[%38x][%-38y][%.23x][%z][%w]";
  const raw = await host.stat(file, { bigint: true });
  const fieldsStat = await real.stat("/work/file");
  const nativeFields = execute(metadataStat, [`--printf=${format}`, "file"], work);
  const measuredFields = await run("stat", [`--printf=${format}`, "file"], real);
  const rawFields = { atimeNs: raw.atimeNs.toString(), mtimeNs: raw.mtimeNs.toString(), ctimeNs: raw.ctimeNs.toString(), birthtimeNs: raw.birthtimeNs.toString() };
  assert.equal(nativeFields.exitCode, 0, nativeFields.stderr);
  assert.equal(measuredFields.exitCode, 0, measuredFields.stderr);
  assert.equal(raw.birthtimeNs, 0n);
  assert.ok(nativeFields.stdout.endsWith(`[${nativeHuman(raw.ctimeNs)}][-]`));
  await host.writeFile(join(work, "fresh"), sentinel);
  const freshRaw = await host.stat(join(work, "fresh"), { bigint: true });
  const freshStat = await real.stat("/work/fresh");
  assert.ok(freshRaw.birthtimeNs > 0n);
  const freshNative = execute(metadataStat, ["--printf=%z|%w", "fresh"], work);
  const freshActual = await run("stat", ["--printf=%z|%w", "fresh"], real);
  assert.equal(freshNative.exitCode, 0, freshNative.stderr);
  assert.equal(freshNative.stdout, `${nativeHuman(freshRaw.ctimeNs)}|${nativeHuman(freshRaw.birthtimeNs)}`);
  assert.equal(freshActual.exitCode, 0, freshActual.stderr);
  assert.deepEqual(await host.readFile(file), sentinel);
  assert.deepEqual(await host.readFile(join(root, "sentinel")), sentinel);
  context.diagnostic(JSON.stringify({ binaryRecords, requestedFixtures: rows.length, exact, rounded, unavailable, rows, sharedHumanFields: { format, rawFields, measured: fieldsStat, native: nativeFields, actual: { ...measuredFields, stdout: measuredFields.stdout.toString() }, note: "native birth is unavailable after these negative-time setters; Node reports zero and virtual renders epoch zero, an existing metadata-availability distinction, not closed here" }, freshHumanFields: { rawCtimeNs: freshRaw.ctimeNs.toString(), rawBirthtimeNs: freshRaw.birthtimeNs.toString(), measured: freshStat, native: freshNative, actual: { ...freshActual, stdout: freshActual.stdout.toString() }, note: "raw ctime/birthtime and numeric loss retained, not asserted as exact native parity" }, observedSetterGranularity: "all requested nanoseconds retained, including +/-1ns; no universal filesystem resolution claim", cleanup: "only namespace()'s uniquely-created directory is removed by its after hook" }));
});
