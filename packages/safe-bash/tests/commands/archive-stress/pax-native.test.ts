import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { access, link, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, longName, pattern, paxSample } from "./fixtures.js";
import { fixture, source, success, tar } from "./helpers.js";

const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
const profiles = {
  GNU: { executable: fileURLToPath(new URL("../archive/.oracle/gnu-tar/1.35/bin/gtar", import.meta.url)), sha256: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", version: /^tar \(GNU tar\) 1\.35\n/u },
  BSD: { executable: "/usr/bin/bsdtar", sha256: "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", version: /^bsdtar 3\.5\.3 - libarchive 3\.7\.4 /u },
};

async function withOracle(context: TestContext, family: keyof typeof profiles, label: string, body: (temporary: string, run: (args: string[]) => Promise<Buffer>, retain: (name: string, bytes: Uint8Array) => Promise<void>) => Promise<void>): Promise<void> {
  const profile = profiles[family];
  try { await access(profile.executable, constants.X_OK); }
  catch { context.skip(`${family} pinned local executable unavailable; deterministic PAX cases still run`); return; }
  assert.equal(digest(await readFile(profile.executable)), profile.sha256);
  const temporary = await mkdtemp(join(tmpdir(), "safe-bash-pax-native-"));
  const observations: unknown[] = [];
  const run = async (args: string[]) => {
    const child = spawn(profile.executable, args, { cwd: temporary, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let exceeded = false;
    let cleanup = "no child";
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); cleanup = "owned group signalled"; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; cleanup = "owned group absent"; }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, 8000);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { exceeded = true; kill(); }
      else target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("exit", kill);
    let result: { status: number | null; signal: NodeJS.Signals | null };
    try {
      result = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (status, signal) => resolve({ status, signal }));
      });
    } finally { clearTimeout(timer); kill(); }
    const output = Buffer.concat(stdout);
    const diagnostics = Buffer.concat(stderr).toString();
    observations.push({ args, ...result, stdoutSha256: digest(output), stdout: output.toString(), stderr: diagnostics, cleanup, timedOut, exceeded });
    assert.equal(timedOut, false);
    assert.equal(exceeded, false);
    assert.equal(result.status, 0, diagnostics);
    return output;
  };
  const retain = async (name: string, bytes: Uint8Array) => {
    if (process.env.ARCHIVE_PAX_EVIDENCE) await writeFile(join(process.env.ARCHIVE_PAX_EVIDENCE, `${family}-${label}-${name}`), bytes);
  };
  try {
    const version = (await run(["--version"])).toString();
    assert.match(version, profile.version);
    observations.push({ family, executable: profile.executable, sha256: profile.sha256, version, environment });
    await body(temporary, run, retain);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await retain("observations.json", Buffer.from(`${JSON.stringify({ family, label, temporary, removed: true, observations }, null, 2)}\n`));
  }
}

for (const [index, family] of (["GNU", "BSD"] as const).entries()) {
  test(`P${10 + index} ${family} default and PAX plain/gzip raw-member crossread both directions without metadata filters`, { timeout: 60000 }, async context => {
    if (family === "BSD") {
      try { await access(profiles.GNU.executable, constants.X_OK); }
      catch { context.skip("GNU raw-member oracle unavailable for the BSD AppleDouble presentation control"); return; }
    }
    await withOracle(context, family, "crossread", async (temporary, run, retain) => {
      const filename = `long-${"abcd".repeat(28)}`;
      const payload = pattern(4099, 182);
      const names = [filename, "empty", "symbol", "hard"];
      await mkdir(join(temporary, "input"));
      await writeFile(join(temporary, "input", filename), payload);
      await writeFile(join(temporary, "input/empty"), Buffer.alloc(0));
      await utimes(join(temporary, "input", filename), 1700000000, 1700000010);
      await symlink(filename, join(temporary, "input/symbol"));
      await link(join(temporary, "input", filename), join(temporary, "input/hard"));
      for (const format of ["default", "pax"]) for (const gzip of [false, true]) {
        const tag = `${format}-${gzip ? "gzip" : "plain"}`;
        const options = format === "pax" ? ["--format=pax"] : [];
        await run([...options, gzip ? "-czf" : "-cf", "native.tar", "-C", "input", ...names]);
        const bytes = await readFile(join(temporary, "native.tar"));
        await retain(`${tag}.tar${gzip ? ".gz" : ""}`, bytes);
        const nativeListing = await run([gzip ? "-tzf" : "-tf", "native.tar"]);
        assert.equal(nativeListing.toString(), `${names.join("\n")}\n`);
        let rawListing = nativeListing;
        const sidecars = new Map<string, Buffer>();
        if (family === "BSD") await withOracle(context, "GNU", `BSD-raw-${tag}`, async (rawDirectory, rawRun, rawRetain) => {
          await writeFile(join(rawDirectory, "bsd.tar"), bytes);
          rawListing = await rawRun([gzip ? "-tzf" : "-tf", "bsd.tar"]);
          await mkdir(join(rawDirectory, "output"));
          await rawRun([gzip ? "-xzf" : "-xf", "bsd.tar", "-C", "output"]);
          for (const name of rawListing.toString().trimEnd().split("\n")) {
            if (names.includes(name)) continue;
            assert.ok(names.some(original => name === `._${original}`), `unexpected native raw member ${name}`);
            assert.equal((await lstat(join(rawDirectory, "output", name))).isFile(), true);
            sidecars.set(name, await readFile(join(rawDirectory, "output", name)));
          }
          await rawRetain("presentation-control.json", Buffer.from(JSON.stringify({ defaultBsdListing: nativeListing.toString(), defaultGnuRawListing: rawListing.toString(), presentationMatches: nativeListing.equals(rawListing), sidecars: [...sidecars].map(([name, data]) => ({ name, bytes: data.length, sha256: digest(data) })), classification: "AppleDouble ordinary archive members are preserved, not restored as macOS metadata" }, null, 2)));
        });
        await mkdir(join(temporary, `self-${tag}`));
        await run([gzip ? "-xzf" : "-xf", "native.tar", "-C", `self-${tag}`]);
        assert.deepEqual(await readFile(join(temporary, `self-${tag}`, filename)), payload);
        const fs = await fixture();
        const listing = await tar(fs, [gzip ? "-tzf" : "-tf", "-"], { stdin: source(bytes) });
        success(listing);
        assert.deepEqual(listing.stdout, rawListing);
        success(await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(bytes) }));
        assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), [...names, ...sidecars.keys()].sort());
        for (const [name, expected] of sidecars) assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), expected);
        assert.deepEqual(Buffer.from(await fs.readFile(`/output/${filename}`)), payload);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/empty")), Buffer.alloc(0));
        assert.equal(await fs.readlink!("/output/symbol"), filename);
        const original = await fs.stat(`/output/${filename}`);
        const hard = await fs.stat("/output/hard");
        assert.ok(original.identityScope);
        assert.equal(hard.identityScope, original.identityScope);
        assert.equal(hard.dev, original.dev);
        assert.equal(hard.ino, original.ino);
        assert.equal(hard.nlink, 2);
        assert.equal(original.mtimeMs, 1700000010000);
        const changed = pattern(53, 71);
        await fs.writeFile("/output/hard", changed);
        assert.deepEqual(Buffer.from(await fs.readFile(`/output/${filename}`)), changed);
        await fs.writeFile(`/output/${filename}`, payload);
        assert.deepEqual(Buffer.from(await fs.readFile("/output/hard")), payload);
        const created = await tar(fs, [gzip ? "-czf" : "-cf", "-", "-C", "/output", ...names]);
        success(created);
        await retain(`virtual-${tag}.tar${gzip ? ".gz" : ""}`, created.stdout);
        await writeFile(join(temporary, "virtual.tar"), created.stdout);
        assert.equal((await run([gzip ? "-tzf" : "-tf", "virtual.tar"])).toString(), `${names.join("\n")}\n`);
        await mkdir(join(temporary, `virtual-${tag}`));
        await run([gzip ? "-xzf" : "-xf", "virtual.tar", "-C", `virtual-${tag}`]);
        assert.deepEqual(await readFile(join(temporary, `virtual-${tag}`, filename)), payload);
        assert.deepEqual(await readFile(join(temporary, `virtual-${tag}/empty`)), Buffer.alloc(0));
        assert.equal(await readlink(join(temporary, `virtual-${tag}/symbol`)), filename);
        const nativeFile = await lstat(join(temporary, `virtual-${tag}`, filename));
        const nativeHard = await lstat(join(temporary, `virtual-${tag}/hard`));
        assert.equal(nativeHard.dev, nativeFile.dev);
        assert.equal(nativeHard.ino, nativeFile.ino);
        assert.equal(nativeHard.nlink, 2);
        assert.deepEqual(await readFile(join(temporary, "input", filename)), payload);
      }
    });
  });
}

test("P12 native-only global/local mtime profiles are explicit, not virtual acceptance expectations", { timeout: 30000 }, async context => {
  for (const family of ["GNU", "BSD"] as const) {
    await withOracle(context, family, "mtime-profile", async (temporary, run, retain) => {
      const bytes = paxSample();
      await writeFile(join(temporary, "control.tar"), bytes);
      await retain("control.tar", bytes);
      await mkdir(join(temporary, "output"));
      await run(["-xf", "control.tar", "-C", "output"]);
      const actualLocal = (await lstat(join(temporary, "output", longName))).mtimeMs;
      const actualFollowing = (await lstat(join(temporary, "output/following"))).mtimeMs;
      const expectedFollowing = family === "GNU" ? 1700123400000 : 1700123456000;
      await retain("times.json", Buffer.from(JSON.stringify({ family, actualLocal, actualFollowing, expectedLocal: 1700123401125, expectedFollowing, posixFollowing: 1700123400000, profileConflict: family === "BSD" }, null, 2)));
      assert.equal(actualLocal, 1700123401125);
      assert.equal(actualFollowing, expectedFollowing);
    });
  }
});
