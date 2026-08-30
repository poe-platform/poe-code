import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, epochSeconds, longName, pattern, paxSample } from "./fixtures.js";
import { absent, fixture, source, success, tar } from "./helpers.js";

const directory = fileURLToPath(new URL("./", import.meta.url));
const crossName = `cross-${"name".repeat(29)}.bin`;
const names = ["deep/leaf", "space name", crossName, "symbol"];
const files = [[names[0]!, pattern(1237, 713)], [names[1]!, pattern(0)], [crossName, pattern(65563, 81)]] as const;
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", COPYFILE_DISABLE: "1", COPY_EXTENDED_ATTRIBUTES_DISABLE: "1" };

interface Observation {
  args: readonly string[];
  status: number | null;
  signal: string | null;
  stdoutSha256: string;
  stdoutBytes: number;
  stdoutText?: string;
  stderr: string;
}

async function oracle(family: "GNU" | "BSD") {
  const candidates = family === "GNU"
    ? [fileURLToPath(new URL("../archive/.oracle/gnu-tar/1.35/bin/gtar", import.meta.url)), "/opt/homebrew/bin/gtar", "/usr/local/bin/gtar", "/usr/bin/tar"]
    : ["/usr/bin/tar", "/usr/bin/bsdtar", "/opt/homebrew/bin/bsdtar"];
  for (const executable of candidates) {
    try { await access(executable, constants.X_OK); } catch { continue; }
    const result = spawnSync(executable, ["--version"], { env: environment, timeout: 4000, maxBuffer: 8192, killSignal: "SIGKILL" });
    const version = result.stdout?.toString("utf8") ?? "";
    if (!result.error && result.status === 0 && (family === "GNU" ? /GNU tar/u : /bsdtar/u).test(version)) {
      return { executable, version: version.trim(), executableSha256: digest(await readFile(executable)) };
    }
  }
  return undefined;
}

async function nativeCase(context: TestContext, family: "GNU" | "BSD", direction: string, body: (temporary: string, run: (args: readonly string[], text?: boolean) => Buffer, artifacts: Record<string, string>) => Promise<void>) {
  const selected = await oracle(family);
  if (!selected) {
    const reason = `${family} tar executable unavailable; deterministic A01-A15 still run`;
    if (process.env.ARCHIVE_ACCEPTANCE_EVIDENCE) await writeFile(join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, `native-${family}-${direction}.json`), `${JSON.stringify({ family, direction, skipped: reason }, null, 2)}\n`);
    context.skip(reason);
    return;
  }
  const temporary = await mkdtemp(join(directory, ".native-"));
  const observations: Observation[] = [];
  const artifacts: Record<string, string> = {};
  let outcome = "failed";
  const run = (args: readonly string[], text = false): Buffer => {
    const result = spawnSync(selected.executable, [...args], { cwd: temporary, env: environment, timeout: 8000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" });
    observations.push({ args, status: result.status, signal: result.signal, stdoutSha256: digest(result.stdout ?? Buffer.alloc(0)), stdoutBytes: result.stdout?.length ?? 0, ...(text ? { stdoutText: result.stdout.toString("utf8") } : {}), stderr: result.stderr?.toString("utf8") ?? "" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${selected.executable} ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout;
  };
  try {
    context.diagnostic(`${family}: ${selected.version.split("\n")[0]}; executable sha256 ${selected.executableSha256}`);
    await body(temporary, run, artifacts);
    outcome = "passed";
  } finally {
    const record = { family, direction, ...selected, outcome, fixtureSeed: "xorshift32; explicit seeds in fixtures/native tests", artifacts, observations };
    try {
      if (process.env.ARCHIVE_ACCEPTANCE_EVIDENCE) await writeFile(join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, `native-${family}-${direction}.json`), `${JSON.stringify(record, null, 2)}\n`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

async function retainArtifact(family: string, name: string, bytes: Uint8Array): Promise<void> {
  if (process.env.ARCHIVE_ACCEPTANCE_EVIDENCE) await writeFile(join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, `${family}-${name}`), bytes);
}

async function bothFormats(body: (gzip: boolean) => Promise<void>): Promise<void> {
  const failures: string[] = [];
  for (const gzip of [false, true]) {
    try { await body(gzip); }
    catch (error) { failures.push(`${gzip ? "gzip" : "plain"}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
}

for (const family of ["GNU", "BSD"] as const) {
  test(`N-${family}-in native PAX plain/gzip archives and independent extension fixture extract virtually`, { timeout: 30000 }, async context => {
    await nativeCase(context, family, "in", async (temporary, run, artifacts) => {
      await mkdir(join(temporary, "input/deep"), { recursive: true });
      await mkdir(join(temporary, "fixture-output"));
      for (const [name, bytes] of files) {
        await writeFile(join(temporary, "input", name), bytes);
        await utimes(join(temporary, "input", name), epochSeconds, epochSeconds);
      }
      await symlink(crossName, join(temporary, "input/symbol"));
      const independent = paxSample();
      artifacts.independentPaxSha256 = digest(independent);
      await retainArtifact(family, "independent.tar", independent);
      await writeFile(join(temporary, "independent.tar"), independent);
      run(["-tf", "independent.tar"], true);
      run(["-xf", "independent.tar", "-C", "fixture-output"]);
      assert.deepEqual(await readFile(join(temporary, "fixture-output", longName)), pattern(1031));
      assert.deepEqual(await readFile(join(temporary, "fixture-output/following")), pattern(17, 7));
      const independentFs = await fixture();
      success(await tar(independentFs, ["-xf", "-", "-C", "/output"], { stdin: source(independent) }));
      assert.deepEqual(Buffer.from(await independentFs.readFile(`/output/${longName}`)), pattern(1031));
      assert.deepEqual(Buffer.from(await independentFs.readFile("/output/following")), pattern(17, 7));
      const failures: string[] = [];
      for (const [name, expected] of [[longName, 1700123401125], ["following", 1700123400000]] as const) {
        const actual = (await lstat(join(temporary, "fixture-output", name))).mtimeMs;
        artifacts[`independentMtime:${name}`] = JSON.stringify({ actual, expected, nativeMatchesPosix: actual === expected, nativeProfileControl: "pax-native.test.ts P12" });
        try { assert.equal((await independentFs.stat(`/output/${name}`)).mtimeMs, expected, `virtual independent PAX fixture mtime ${name}`); }
        catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
      }
      try { await bothFormats(async gzip => {
        const flags = gzip ? "-czf" : "-cf";
        run(["--format=pax", flags, "native.tar", "-C", "input", ...names]);
        const bytes = await readFile(join(temporary, "native.tar"));
        artifacts[gzip ? "nativeGzipSha256" : "nativePlainSha256"] = digest(bytes);
        await retainArtifact(family, gzip ? "native.tar.gz" : "native.tar", bytes);
        const nativeOutput = gzip ? "self-gzip" : "self-plain";
        await mkdir(join(temporary, nativeOutput));
        run([gzip ? "-xzf" : "-xf", "native.tar", "-C", nativeOutput]);
        for (const [name, expected] of files) assert.deepEqual(await readFile(join(temporary, nativeOutput, name)), expected);
        assert.equal(await readlink(join(temporary, nativeOutput, "symbol")), crossName);
        const fs = await fixture();
        const listed = await tar(fs, [gzip ? "-tzf" : "-tf", "-"], { stdin: source(bytes, 113) });
        artifacts[gzip ? "virtualGzipListing" : "virtualPlainListing"] = JSON.stringify({ exitCode: listed.exitCode, stderr: listed.stderr, stdoutSha256: digest(listed.stdout) });
        const extracted = await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(bytes, 251) });
        artifacts[gzip ? "virtualGzipExtraction" : "virtualPlainExtraction"] = JSON.stringify({ exitCode: extracted.exitCode, stderr: extracted.stderr, outputEntries: await fs.readdir("/output") });
        success(listed);
        assert.equal(listed.stdout.toString(), `${names.join("\n")}\n`);
        success(extracted);
        for (const [name, expected] of files) assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), expected);
        assert.equal((await fs.lstat("/output/symbol")).type, "symlink");
        assert.equal(await fs.readlink!("/output/symbol"), crossName);
        await absent(fs, "/output/PaxHeaders");
      }); } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
      assert.deepEqual(failures, [], failures.join("\n"));
    });
  });

  test(`N-${family}-out native reads and extracts virtual plain/gzip PAX without modifying sources`, { timeout: 30000 }, async context => {
    await nativeCase(context, family, "out", async (temporary, run, artifacts) => {
      const fs = await fixture();
      await fs.mkdir("/input/deep");
      for (const [name, bytes] of files) await fs.writeFile(`/input/${name}`, bytes);
      await fs.symlink!(crossName, "/input/symbol");
      await bothFormats(async gzip => {
        const output = gzip ? "gzip-output" : "plain-output";
        await mkdir(join(temporary, output));
        const created = await tar(fs, [gzip ? "-czf" : "-cf", "-", ...names]);
        success(created);
        artifacts[gzip ? "virtualGzipSha256" : "virtualPlainSha256"] = digest(created.stdout);
        await retainArtifact(family, gzip ? "virtual.tar.gz" : "virtual.tar", created.stdout);
        await writeFile(join(temporary, "virtual.tar"), created.stdout);
        const listing = run([gzip ? "-tzf" : "-tf", "virtual.tar"], true);
        assert.equal(listing.toString(), `${names.join("\n")}\n`);
        run([gzip ? "-tzvf" : "-tvf", "virtual.tar"], true);
        run([gzip ? "-xzf" : "-xf", "virtual.tar", "-C", output]);
        for (const [name, expected] of files) {
          assert.deepEqual(await readFile(join(temporary, output, name)), expected);
          assert.deepEqual(Buffer.from(await fs.readFile(`/input/${name}`)), expected);
        }
        const symbolStat = await lstat(join(temporary, output, "symbol"));
        artifacts[gzip ? "gzipExtractedSymbol" : "plainExtractedSymbol"] = JSON.stringify({ isSymbolicLink: symbolStat.isSymbolicLink(), isFile: symbolStat.isFile(), size: symbolStat.size });
        assert.ok(symbolStat.isSymbolicLink(), "native extraction must preserve the long-target symlink, not publish an empty regular file");
        assert.equal(await readlink(join(temporary, output, "symbol")), crossName);
        assert.deepEqual(await readFile(join(temporary, output, "symbol")), files[2][1]);
      });
    });
  });
}
