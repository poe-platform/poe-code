import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchVerified } from "./provision-test-inputs.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat) =>
  [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.size,
    stat.mtimeNs ?? stat.mtimeMs,
    stat.ctimeNs ?? stat.ctimeMs
  ].join(":");

export const LOCAL_GNU_PROFILE = "local-macos26.4.1-arm64-gnu-20260831";

export function selectNativeProfile(profiles, host, localProfile) {
  if (localProfile !== undefined) {
    assert.equal(localProfile, LOCAL_GNU_PROFILE, "unknown local GNU profile selector");
    assert.deepEqual(host, { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" }, "local GNU profile requires the exact local host");
  }
  const matching = profiles.filter((profile) =>
    ["platform", "arch", "distribution", "version", "release"].every((key) => profile.host[key] === host[key])
  );
  assert.equal(matching.length, 1, "exactly one qualified native host profile is required");
  if (localProfile !== undefined) {
    assert.equal(matching[0].id, LOCAL_GNU_PROFILE, "local GNU profile identity mismatch");
    assert.equal(matching[0].qualification, "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY", "local GNU approval is qualification-only");
    assert.deepEqual(matching[0].executables.map(pin => pin.tool).sort(), ["diff", "patch"], "local GNU profile is restricted to diff/patch");
  } else {
    assert.equal(
      matching[0].qualification,
      "QUALIFIED",
      "source authentication alone is not executable qualification"
    );
  }
  const profile = structuredClone(matching[0]);
  assert(
    (profile.host.platform === "linux" && profile.host.arch === "x64" && profile.host.distribution === "ubuntu" && profile.host.version === "24.04") ||
    (profile.host.platform === "darwin" && profile.host.arch === "arm64" && profile.host.distribution === "macos" && profile.host.version === "26.5.2" && profile.host.release === "25.5.0") || localProfile === LOCAL_GNU_PROFILE,
    "unsupported native host"
  );
  assert(Array.isArray(profile.executables) && profile.executables.length > 0);
  const tools = new Set();
  for (const pin of profile.executables) {
    assert(typeof pin.tool === "string" && pin.tool.length > 0);
    assert(
      [...pin.tool].every((character) =>
        "abcdefghijklmnopqrstuvwxyz0123456789-".includes(character)
      )
    );
    assert(!tools.has(pin.tool), "duplicate native executable");
    tools.add(pin.tool);
    assert(
      typeof pin.version === "string" && pin.version.length > 0 && !pin.version.includes("\n")
    );
    assert(Number.isSafeInteger(pin.size) && pin.size > 0 && pin.size <= 16 * 1024 * 1024);
    assert(
      typeof pin.sha256 === "string" &&
        pin.sha256.length === 64 &&
        [...pin.sha256].every((character) => "0123456789abcdef".includes(character))
    );
  }
  return profile;
}

function canonicalPath(fileSystem, path) {
  assert(
    isAbsolute(path) && resolve(path) === path,
    "native paths must be absolute and normalized"
  );
  assert.equal(fileSystem.realpathSync(path), path, "linked native path refused");
  let cursor = path;
  for (;;) {
    assert(!fileSystem.lstatSync(cursor).isSymbolicLink(), "linked native ancestor refused");
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function verifyNativeExecutable(pin, path, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const run = dependencies.run ?? spawnSync;
  canonicalPath(fileSystem, path);
  const before = fileSystem.lstatSync(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink(), "native executable must be a regular file");
  assert.equal(before.size, BigInt(pin.size), "native executable size mismatch");
  assert((before.mode & 0o111n) !== 0n, "native executable is not executable");
  const bytes = fileSystem.readFileSync(path);
  assert.equal(digest(bytes), pin.sha256, "native executable SHA-256 mismatch");
  assert.equal(identity(fileSystem.lstatSync(path, { bigint: true })), identity(before));
  const result = run(path, ["--version"], {
    shell: false,
    encoding: "utf8",
    timeout: 3000,
    killSignal: "SIGKILL",
    maxBuffer: 65536,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "native version process terminated by signal");
  if (pin.versionProbe) {
    assert.equal(pin.tool, "split", "diagnostic version probe is only valid for Apple split");
    assert.equal(pin.version, "Apple split (no --version support)");
    assert.equal(pin.versionProbe.status, 64);
    assert.equal(pin.versionProbe.stdout, "");
    assert(typeof pin.versionProbe.stderr === "string" && pin.versionProbe.stderr.includes("usage: split") && Buffer.byteLength(pin.versionProbe.stderr) <= 4096);
    assert.equal(result.status, pin.versionProbe.status, "Apple split diagnostic status mismatch");
    assert.equal(result.stdout, pin.versionProbe.stdout, "Apple split diagnostic stdout mismatch");
    assert.equal(result.stderr, pin.versionProbe.stderr, "Apple split diagnostic stderr mismatch");
  } else {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split("\n")[0], pin.version, "native version mismatch");
  }
  canonicalPath(fileSystem, path);
  assert.equal(identity(fileSystem.lstatSync(path, { bigint: true })), identity(before));
  assert.equal(
    digest(fileSystem.readFileSync(path)),
    pin.sha256,
    "native executable changed during version check"
  );
  return { path, version: pin.version, sha256: pin.sha256, size: pin.size, bytes };
}

export function stageNativeExecutables(options, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const profile = selectNativeProfile([options.profile], options.host, options.localProfile);
  const { parent, name, inputs } = options;
  canonicalPath(fileSystem, parent);
  const parentStat = fileSystem.lstatSync(parent, { bigint: true });
  assert(
    parentStat.isDirectory() && (parentStat.mode & 0o777n) === 0o700n,
    "native parent must be a private directory"
  );
  assert(typeof name === "string" && name.length > 0 && name !== "." && name !== "..");
  assert(
    !name.includes("/") && !name.includes("\\") && !name.includes("\0"),
    "native destination name must be one component"
  );
  const root = join(parent, name);
  assert(!fileSystem.existsSync(root), "native destination already exists");
  assert.deepEqual(
    Object.keys(inputs).sort(),
    profile.executables.map((pin) => pin.tool).sort(),
    "native source membership mismatch"
  );
  const verified = profile.executables.map((pin) => ({
    pin,
    result: verifyNativeExecutable(pin, inputs[pin.tool], dependencies)
  }));
  canonicalPath(fileSystem, parent);
  const after = fileSystem.lstatSync(parent, { bigint: true });
  assert.equal(after.dev, parentStat.dev);
  assert.equal(after.ino, parentStat.ino);
  assert.equal(after.mode, parentStat.mode);
  fileSystem.mkdirSync(root, { mode: 0o700 });
  const bin = join(root, "bin");
  fileSystem.mkdirSync(bin, { mode: 0o700 });
  const outputs = [];
  for (const { pin, result } of verified) {
    const path = join(bin, pin.tool);
    fileSystem.writeFileSync(path, result.bytes, { flag: "wx", mode: 0o755 });
    const installed = verifyNativeExecutable(pin, path, dependencies);
    outputs.push({
      tool: pin.tool,
      path,
      version: installed.version,
      sha256: installed.sha256,
      size: installed.size
    });
  }
  const receipt = { profile: profile.id, host: structuredClone(options.host), root, outputs,
    ...(options.localProfile === undefined ? {} : { qualification: profile.qualification }) };
  fileSystem.writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600
  });
  return receipt;
}

export function stageDarwinOutputs(options, dependencies = {}) {
  const { receipt, host, parent, name } = options;
  const profile = selectNativeProfile([options.profile], host);
  assert.equal(host.platform, "darwin");
  assert.equal(receipt.status, "BUILT_OBSERVATIONS_UNREVIEWED", "successful authenticated build required");
  const inputs = {};
  let independent;
  for (const pin of profile.executables) {
    for (const build of pin.tool === "stat" ? [1, 2] : [1]) {
      const matches = receipt.outputs.filter(output => output.tool === pin.tool && output.build === build);
      assert.equal(matches.length, 1, "exactly one output per independent build required");
      const output = matches[0];
      assert.equal(output.member, `bin/${pin.tool}-${build}`, "independent build member mismatch");
      for (const field of ["version", "size", "sha256"]) assert.equal(output[field], pin[field], `reviewed ${pin.tool} ${field} mismatch`);
      const path = join(receipt.root, "evidence", output.member);
      verifyNativeExecutable(pin, path, dependencies);
      if (build === 1) inputs[pin.tool] = path;
      else independent = { pin, path };
    }
  }
  assert(independent, "independent stat build required");
  const primary = stageNativeExecutables({ profile, host, parent, name, inputs }, dependencies);
  const secondary = stageNativeExecutables({ profile: { ...profile, executables: [independent.pin] }, host, parent, name: name + "-second", inputs: { stat: independent.path } }, dependencies);
  return { primary, secondary };
}

export function executeBuildStep(command, args, options) {
  return new Promise((resolveResult, reject) => {
    const available = fs.statfsSync(options.cwd);
    assert(
      available.bavail * available.bsize >= 1024 ** 3,
      "native build requires at least 1GiB free"
    );
    const child = spawn(command, args, {
      ...options,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let failure;
    const stop = (reason) => {
      failure ??= new Error(reason);
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") failure = error;
        }
      }
    };
    const interrupt = () => stop("native build interrupted");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => stop("native build step exceeded 600000ms"), 600000);
    const spaceGuard = setInterval(() => {
      try {
        const current = fs.statfsSync(options.cwd);
        if (current.bavail * current.bsize < 1024 ** 3)
          stop("native build free space fell below 1GiB");
      } catch (error) {
        stop("native build space check failed: " + String(error));
      }
    }, 2000);
    for (const [stream, chunks] of [
      [child.stdout, stdout],
      [child.stderr, stderr]
    ]) {
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) stop("native build output exceeded 16MiB");
        else chunks.push(chunk);
      });
    }
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      clearInterval(spaceGuard);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      const result = {
        pid: child.pid,
        status,
        signal,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString()
      };
      if (failure) result.error = failure;
      resolveResult(result);
    });
    if (!child.stdout || !child.stderr) reject(new Error("native build pipes unavailable"));
  });
}

export async function buildNativeOracles(options, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const execute = dependencies.execute ?? executeBuildStep;
  const profile = selectNativeProfile([options.profile], options.host);
  canonicalPath(fileSystem, options.parent);
  const parentStat = fileSystem.lstatSync(options.parent, { bigint: true });
  assert(
    parentStat.isDirectory() && (parentStat.mode & 0o777n) === 0o700n,
    "native build parent must be private"
  );
  assert(
    typeof options.name === "string" &&
      options.name.length > 0 &&
      options.name !== "." &&
      options.name !== ".."
  );
  assert(
    !options.name.includes("/") && !options.name.includes("\\") && !options.name.includes("\0")
  );
  assert(typeof profile.compilerVersion === "string" && profile.compilerVersion.length > 0);
  assert(isAbsolute(profile.buildPrefix), "fixed configure prefix must be absolute");
  assert(
    typeof profile.sourceDateEpoch === "string" &&
      [...profile.sourceDateEpoch].every((character) => "0123456789".includes(character))
  );
  assert(Array.isArray(profile.sources) && profile.sources.length > 0);
  const root = join(options.parent, options.name);
  fileSystem.mkdirSync(root, { mode: 0o700 });
  for (const name of ["home", "tmp", "sources", "archives", "logs"])
    fileSystem.mkdirSync(join(root, name), { mode: 0o700 });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    SOURCE_DATE_EPOCH: profile.sourceDateEpoch
  };
  let sequence = 0;
  const step = async (command, args, cwd = root) => {
    const result = await execute(command, args, { cwd, env });
    const prefix = join(root, "logs", String(++sequence).padStart(2, "0"));
    fileSystem.writeFileSync(prefix + ".stdout.log", result.stdout ?? "", {
      flag: "wx",
      mode: 0o600
    });
    fileSystem.writeFileSync(prefix + ".stderr.log", result.stderr ?? "", {
      flag: "wx",
      mode: 0o600
    });
    fileSystem.writeFileSync(
      prefix + ".json",
      JSON.stringify(
        {
          command,
          args,
          cwd,
          env,
          status: result.status,
          signal: result.signal,
          error: result.error?.message
        },
        null,
        2
      ) + "\n",
      { flag: "wx", mode: 0o600 }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, "native build terminated by signal");
    assert.equal(result.status, 0, "native build failed; retained logs: " + prefix);
    return result;
  };
  try {
    const compiler = await step("/usr/bin/gcc", ["-dumpfullversion"]);
    assert.equal(
      compiler.stdout.trim(),
      profile.compilerVersion,
      "qualified compiler version mismatch"
    );
    const inputs = {};
    for (const source of profile.sources) {
      assert(
        typeof source.name === "string" &&
          source.name.length > 0 &&
          source.name !== "." &&
          source.name !== ".."
      );
      assert(
        [...source.name].every((character) =>
          "abcdefghijklmnopqrstuvwxyz0123456789.-".includes(character)
        )
      );
      assert(Array.isArray(source.outputs) && source.outputs.length > 0);
      const bytes = await fetchVerified(source, dependencies);
      const archive = join(root, "archives", source.name + ".tar.xz");
      fileSystem.writeFileSync(archive, bytes, { flag: "wx", mode: 0o600 });
      await step("/usr/bin/tar", ["-xJf", archive, "-C", join(root, "sources")]);
      const work = join(root, "sources", source.name);
      canonicalPath(fileSystem, work);
      await step(
        "./configure",
        [
          "--prefix=" + profile.buildPrefix,
          "--disable-nls",
          "CC=/usr/bin/gcc",
          "CFLAGS=-O2 -g0 -ffile-prefix-map=" + work + "=."
        ],
        work
      );
      await step("/usr/bin/make", ["-j2"], work);
      for (const output of source.outputs) {
        assert(profile.executables.some((pin) => pin.tool === output.tool));
        assert(!Object.hasOwn(inputs, output.tool), "duplicate build output");
        assert(
          typeof output.path === "string" && !isAbsolute(output.path) && !output.path.includes("\\")
        );
        assert(
          output.path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
        );
        inputs[output.tool] = join(work, output.path);
      }
    }
    return stageNativeExecutables(
      { profile, host: options.host, parent: root, name: "installed", inputs },
      dependencies
    );
  } catch (error) {
    fileSystem.writeFileSync(
      join(root, "failure.json"),
      JSON.stringify({ status: "FAILED_NOT_QUALIFIED", error: String(error) }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 }
    );
    throw error;
  }
}

export function assertDarwinContext(profile, context, releaseLane = false) {
  assert.equal(profile.qualification, "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY");
  const expected = {
    platform: "darwin",
    arch: "arm64",
    repository: "poe-platform/poe-code",
    ref: "refs/heads/main",
    runner: "github-hosted",
    runnerOS: "macOS",
    runnerArch: "ARM64",
    imageOS: profile.imageOS,
    imageVersion: profile.imageVersion
  };
  if (releaseLane) {
    assert.equal(context.job, "native-darwin", "required native release job expected");
    assert(["push", "workflow_dispatch"].includes(context.event), "unsupported native release event");
  } else assert.equal(context.event, "workflow_dispatch", "Unexpected Darwin event");
  for (const [key, value] of Object.entries(expected))
    assert.equal(context[key], value, `Unexpected Darwin ${key}`);
  assert.equal(context.node.split(".")[0], "22", "Darwin qualification requires Node22");
  assert(
    context.sha.length === 40 &&
      [...context.sha].every((character) => "0123456789abcdef".includes(character)),
    "resolved checkout SHA required"
  );
  assert(
    context.runId.length > 0 &&
      [...context.runId].every((character) => "0123456789".includes(character)),
    "run identity required"
  );
}

export function sealDarwinEvidence(root, members, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  canonicalPath(fileSystem, root);
  assert(members.length > 0 && members.length <= 512 && new Set(members).size === members.length);
  const allowed = new Set(members);
  const actual = [];
  const walk = (directory, prefix = "") => {
    for (const name of fileSystem.readdirSync(directory)) {
      const path = join(directory, name);
      const relative = prefix + name;
      const stat = fileSystem.lstatSync(path);
      assert(!stat.isSymbolicLink(), "linked artifact member refused");
      if (stat.isDirectory()) walk(path, relative + "/");
      else {
        assert(stat.isFile(), "non-file artifact member refused");
        actual.push(relative);
      }
    }
  };
  walk(root);
  assert.deepEqual(actual.sort(), [...allowed].sort(), "unlisted artifact payload refused");
  let size = 0;
  const records = actual.map((member) => {
    const parts = member.split("/");
    assert(
      parts.every(
        (part) =>
          part.length > 0 &&
          [...part].every((character) =>
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-".includes(character)
          ) &&
          !part.startsWith(".")
      ),
      "unsafe artifact member"
    );
    assert(
      member === "receipt.json" ||
        (parts.length === 2 &&
          ((parts[0] === "logs" && (member.endsWith(".log") || member.endsWith(".json"))) ||
            (parts[0] === "sources" &&
              (member.endsWith(".tar.xz") || member.endsWith(".tar.xz.sig"))) ||
            parts[0] === "bin")),
      "unapproved artifact category"
    );
    const path = join(root, member);
    canonicalPath(fileSystem, path);
    const before = fileSystem.lstatSync(path, { bigint: true });
    assert(before.size <= 16n * 1024n ** 2n, "artifact member exceeds 16MiB");
    size += Number(before.size);
    assert(size <= 128 * 1024 ** 2, "artifact exceeds 128MiB");
    const bytes = fileSystem.readFileSync(path);
    assert.equal(identity(fileSystem.lstatSync(path, { bigint: true })), identity(before));
    return {
      path: member,
      size: bytes.length,
      mode: Number(before.mode) & 0o777,
      sha256: digest(bytes)
    };
  });
  fileSystem.writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({ status: "SEALED_NOT_ADMITTED", size, members: records }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 }
  );
  return records;
}

export async function qualifyDarwinBuild(options, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const execute = dependencies.execute ?? executeBuildStep;
  const { profile, context } = options;
  assertDarwinContext(profile, context, options.releaseLane);
  canonicalPath(fileSystem, options.parent);
  canonicalPath(fileSystem, options.checkout);
  assert.equal(
    fileSystem.lstatSync(options.parent).mode & 0o777,
    0o700,
    "private build parent required"
  );
  assert(
    typeof options.name === "string" &&
      options.name.length > 0 &&
      [...options.name].every((character) =>
        "abcdefghijklmnopqrstuvwxyz0123456789-".includes(character)
      )
  );
  const root = join(options.parent, options.name);
  fileSystem.mkdirSync(root, { mode: 0o700 });
  for (const name of ["home", "tmp", "work", "evidence"])
    fileSystem.mkdirSync(join(root, name), { mode: 0o700 });
  const evidence = join(root, "evidence");
  for (const name of ["logs", "sources", "bin"])
    fileSystem.mkdirSync(join(evidence, name), { mode: 0o700 });
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    SOURCE_DATE_EPOCH: profile.sourceDateEpoch
  };
  const members = [];
  const write = (member, bytes, mode = 0o600) => {
    fileSystem.writeFileSync(join(evidence, member), bytes, { flag: "wx", mode });
    members.push(member);
  };
  let sequence = 0;
  const step = async (command, args, cwd = root) => {
    const result = await execute(command, args, { cwd, env });
    const prefix = "logs/" + String(++sequence).padStart(3, "0");
    write(prefix + ".stdout.log", result.stdout ?? "");
    write(prefix + ".stderr.log", result.stderr ?? "");
    write(
      prefix + ".json",
      JSON.stringify(
        {
          command,
          args,
          cwd,
          env,
          status: result.status,
          signal: result.signal,
          error: result.error?.message
        },
        null,
        2
      ) + "\n"
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, "Darwin build terminated");
    assert.equal(result.status, 0, "Darwin build failed: " + prefix);
    return result.stdout.trim();
  };
  const receipt = {
    status: "FAILED_NOT_QUALIFIED",
    profile: profile.id,
    context,
    provenance: profile.provenance,
    inputs: profile.sources,
    apple: profile.apple,
    outputs: []
  };
  let failure;
  try {
    assert.equal(
      await step("/usr/bin/git", ["rev-parse", "HEAD"], options.checkout),
      context.sha,
      "checkout SHA mismatch"
    );
    for (const [command, args, expected] of [
      ["/usr/bin/sw_vers", ["-productVersion"], profile.osVersion],
      ["/usr/bin/sw_vers", ["-buildVersion"], profile.buildVersion],
      ["/usr/bin/uname", ["-r"], profile.kernel],
      ["/usr/bin/xcodebuild", ["-version"], profile.xcode],
      [profile.compiler, ["--version"], profile.compilerVersion],
      [profile.verifier, ["--version"], profile.verifierVersion]
    ]) {
      const actual = await step(command, args);
      assert.equal(
        command === profile.verifier ? actual.split("\n")[0] : actual,
        expected,
        "Darwin toolchain drift: " + command
      );
    }
    for (const pin of profile.apple) {
      canonicalPath(fileSystem, pin.path);
      const before = fileSystem.lstatSync(pin.path, { bigint: true });
      assert(before.isFile() && (before.mode & 0o111n) !== 0n);
      assert.equal(Number(before.size), pin.size);
      assert.equal(digest(fileSystem.readFileSync(pin.path)), pin.sha256, "Apple identity drift");
      await step("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", pin.path]);
      await step("/usr/bin/codesign", ["--display", "--verbose=4", pin.path]);
      assert.equal(identity(fileSystem.lstatSync(pin.path, { bigint: true })), identity(before));
      assert.equal(
        digest(fileSystem.readFileSync(pin.path)),
        pin.sha256,
        "Apple bytes changed during verification"
      );
    }
    if (profile.appleObservations !== undefined) {
      assert.deepEqual(profile.appleObservations, ["/usr/bin/split"], "only the pending split observation is admitted");
      const path = profile.appleObservations[0];
      canonicalPath(fileSystem, path);
      const before = fileSystem.lstatSync(path, { bigint: true });
      assert(before.isFile() && before.size > 0n && before.size <= 16n * 1024n ** 2n && (before.mode & 0o111n) !== 0n);
      const sha256 = digest(fileSystem.readFileSync(path));
      await step("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", path]);
      await step("/usr/bin/codesign", ["--display", "--verbose=4", path]);
      const result = await execute(path, ["--version"], { cwd: root, env });
      write("logs/apple-split-version.json", JSON.stringify({ path, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2) + "\n");
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 64, "Apple split must retain its observed unsupported-version status");
      assert.equal(result.stdout, "");
      assert(typeof result.stderr === "string" && result.stderr.includes("usage: split") && Buffer.byteLength(result.stderr) <= 4096);
      canonicalPath(fileSystem, path);
      assert.equal(identity(fileSystem.lstatSync(path, { bigint: true })), identity(before));
      assert.equal(digest(fileSystem.readFileSync(path)), sha256, "Apple split changed during observation");
      receipt.appleObservations = [{ tool: "split", path, version: "Apple split (no --version support)", size: Number(before.size), sha256, versionProbe: { status: result.status, stdout: result.stdout, stderr: result.stderr } }];
    }
    const keyring = join(root, "gnu-keyring.gpg");
    fileSystem.writeFileSync(keyring, await fetchVerified(profile.keyring, dependencies), {
      flag: "wx",
      mode: 0o600
    });
    for (const source of profile.sources) {
      assert(
        source.name.length > 0 &&
          [...source.name].every((character) =>
            "abcdefghijklmnopqrstuvwxyz0123456789.-".includes(character)
          ) &&
          !source.name.startsWith(".")
      );
      assert.equal(source.builds, source.coreutils ? 2 : 1, "independent build count mismatch");
      const archiveMember = "sources/" + source.name + ".tar.xz";
      write(archiveMember, await fetchVerified(source, dependencies));
      write(archiveMember + ".sig", await fetchVerified(source.signature, dependencies));
      const archive = join(evidence, archiveMember);
      const signature = await step(profile.verifier, [
        "--homedir",
        env.HOME,
        "--status-fd",
        "1",
        "--keyring",
        keyring,
        archive + ".sig",
        archive
      ]);
      const signers = signature
        .split("\n")
        .filter((line) => line.startsWith("[GNUPG:] VALIDSIG "))
        .map((line) => line.split(" ")[2]);
      assert.deepEqual(signers, [source.signer], "GNU signature signer mismatch");
      for (let build = 1; build <= source.builds; build++) {
        const extraction = join(root, "work", source.name + "-" + build);
        fileSystem.mkdirSync(extraction, { mode: 0o700 });
        await step("/usr/bin/bsdtar", ["-xJf", archive, "-C", extraction]);
        const work = join(extraction, source.name);
        canonicalPath(fileSystem, work);
        const configure = [
          "--prefix=" + profile.buildPrefix,
          "--disable-nls",
          "CC=" + profile.compiler,
          "CFLAGS=-O2 -g0 -ffile-prefix-map=" + work + "=."
        ];
        if (source.coreutils) configure.push("--without-gmp");
        if (source.name === "tar-1.35") configure.push("LIBS=-liconv");
        await step("./configure", configure, work);
        if (source.coreutils) {
          fileSystem.writeFileSync(
            join(work, "native-prerequisites.mk"),
            ".PHONY: native-prerequisites\nnative-prerequisites: $(BUILT_SOURCES)\n",
            { flag: "wx", mode: 0o600 }
          );
          await step(
            "/usr/bin/make",
            ["-j2", "-f", "Makefile", "-f", "native-prerequisites.mk", "native-prerequisites"],
            work
          );
        }
        await step(
          "/usr/bin/make",
          ["-j2", ...(source.coreutils ? source.outputs.map((output) => output.path) : [])],
          work
        );
        for (const output of source.outputs) {
          assert(
            output.tool.length > 0 &&
              [...output.tool].every((character) =>
                "abcdefghijklmnopqrstuvwxyz0123456789-".includes(character)
              )
          );
          assert(
            output.path
              .split("/")
              .every((part) => part.length > 0 && part !== "." && part !== "..") &&
              !output.path.includes("\\")
          );
          const path = join(work, output.path);
          canonicalPath(fileSystem, path);
          const before = fileSystem.lstatSync(path, { bigint: true });
          assert(
            before.isFile() &&
              before.size > 0n &&
              before.size <= 16n * 1024n ** 2n &&
              (before.mode & 0o111n) !== 0n
          );
          const bytes = fileSystem.readFileSync(path);
          const version = (await step(path, ["--version"])).split("\n")[0];
          assert.equal(version, output.version, "GNU output version mismatch");
          assert.equal(identity(fileSystem.lstatSync(path, { bigint: true })), identity(before));
          assert.equal(
            digest(fileSystem.readFileSync(path)),
            digest(bytes),
            "GNU bytes changed during version check"
          );
          const member = "bin/" + output.tool + "-" + build;
          write(member, bytes, 0o755);
          receipt.outputs.push({
            tool: output.tool,
            build,
            member,
            version,
            size: bytes.length,
            sha256: digest(bytes)
          });
        }
        for (const name of ["config.log", "config.status"]) {
          const path = join(work, name);
          canonicalPath(fileSystem, path);
          write(
            "logs/" + source.name + "-" + build + "-" + name + ".log",
            fileSystem.readFileSync(path)
          );
        }
      }
    }
    receipt.repeatedIdentity = receipt.outputs
      .filter((output) => output.build === 2)
      .map((output) => ({
        tool: output.tool,
        equal:
          receipt.outputs.find((first) => first.tool === output.tool && first.build === 1)
            ?.sha256 === output.sha256
      }));
    receipt.status = "BUILT_OBSERVATIONS_UNREVIEWED";
  } catch (error) {
    failure = error;
    receipt.error = String(error);
  }
  write("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  const sealed = sealDarwinEvidence(evidence, members, dependencies);
  if (failure) throw failure;
  return { ...receipt, root, members: sealed };
}

export function parseNativeArguments(args) {
  const result = {};
  if (args[0] === "--qualify-darwin-build" || args[0] === "--stage-darwin") {
    result[args[0] === "--stage-darwin" ? "stageDarwin" : "qualification"] = true;
    args = args.slice(1);
  }
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    assert(
      option === "--parent" || option === "--destination",
      "unknown native provisioner option"
    );
    const key = option.slice(2);
    assert(!Object.hasOwn(result, key), "duplicate native provisioner option");
    const value = args[index + 1];
    assert(
      typeof value === "string" && isAbsolute(value) && resolve(value) === value,
      "explicit normalized absolute native path required"
    );
    result[key] = value;
  }
  assert(result.parent && result.destination, "both --parent and --destination are required");
  return result;
}

export async function main(args) {
  const options = parseNativeArguments(args);
  if (options.qualification || options.stageDarwin) {
    const context = {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      sha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      event: process.env.GITHUB_EVENT_NAME,
      job: process.env.GITHUB_JOB,
      runner: process.env.RUNNER_ENVIRONMENT,
      runnerOS: process.env.RUNNER_OS,
      runnerArch: process.env.RUNNER_ARCH,
      imageOS: process.env.ImageOS,
      imageVersion: process.env.ImageVersion
    };
    const manifest = JSON.parse(
      fs.readFileSync(new URL("../tests/native-gnu-profiles.json", import.meta.url), "utf8")
    );
    const profile = manifest.darwinBuildQualification;
    assertDarwinContext(profile, context, options.stageDarwin);
    const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP);
    assert.equal(
      dirname(options.parent),
      runnerTemp,
      "build parent must be directly inside RUNNER_TEMP"
    );
    if (options.stageDarwin) {
      const packageRoot = fileURLToPath(new URL("../", import.meta.url));
      assert.equal(options.destination, join(packageRoot, "tmp", "native-gnu"));
      canonicalPath(fs, packageRoot.slice(0, -1));
      const destinationParent = dirname(options.destination);
      if (!fs.existsSync(destinationParent)) fs.mkdirSync(destinationParent, { mode: 0o700 });
      canonicalPath(fs, destinationParent);
      assert.equal(fs.lstatSync(destinationParent).mode & 0o777, 0o700);
      assert(!fs.existsSync(options.destination) && !fs.existsSync(options.destination + "-second"), "native destination already exists");
      const host = { platform: context.platform, arch: context.arch, distribution: "macos", version: profile.osVersion, release: profile.kernel };
      const reviewed = selectNativeProfile(manifest.profiles, host);
      const receipt = await qualifyDarwinBuild({ parent: options.parent, name: "build", checkout: process.cwd(), profile, context, releaseLane: true });
      const staged = stageDarwinOutputs({ receipt, profile: reviewed, host, parent: destinationParent, name: "native-gnu" });
      console.log(JSON.stringify(staged, null, 2));
      return staged;
    }
    assert.equal(options.destination, join(options.parent, "build"));
    let failure;
    try {
      const receipt = await qualifyDarwinBuild({
        parent: options.parent,
        name: "build",
        checkout: process.cwd(),
        profile,
        context
      });
      console.log(JSON.stringify(receipt, null, 2));
    } catch (error) {
      failure = error;
    }
    const evidence = join(options.destination, "evidence");
    if (fs.existsSync(join(evidence, "manifest.json"))) {
      const archive = join(options.destination, "native-darwin-evidence.tar");
      const result = await executeBuildStep(
        "/usr/bin/bsdtar",
        ["-cf", archive, "-C", evidence, "."],
        {
          cwd: options.destination,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: join(options.destination, "home"),
            LC_ALL: "C",
            LANG: "C"
          }
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, "artifact packaging failed");
      assert.equal(result.signal, null);
      assert(fs.statSync(archive).size <= 129 * 1024 ** 2, "artifact archive exceeds bound");
      fs.writeFileSync(
        archive + ".sha256",
        digest(fs.readFileSync(archive)) + "  native-darwin-evidence.tar\n",
        { flag: "wx", mode: 0o600 }
      );
      assert(isAbsolute(process.env.GITHUB_OUTPUT), "workflow output path required");
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "sealed=true\n");
    }
    if (failure) throw failure;
    return;
  }
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const destination = join(packageRoot, "tmp", "native-gnu");
  assert.equal(
    options.destination,
    destination,
    "native destination must be this workspace's private tmp/native-gnu directory"
  );
  assert.equal(process.platform, "linux", "native build CLI requires the qualified Linux host");
  const release = fs.readFileSync("/etc/os-release", "utf8").split("\n");
  assert(
    release.includes("ID=ubuntu") && release.includes('VERSION_ID="24.04"'),
    "native build CLI requires Ubuntu24.04"
  );
  const host = {
    platform: process.platform,
    arch: process.arch,
    distribution: "ubuntu",
    version: "24.04"
  };
  const manifest = JSON.parse(
    fs.readFileSync(new URL("../tests/native-gnu-profiles.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.schema, 1);
  const profile = selectNativeProfile(manifest.profiles, host);
  const destinationParent = dirname(destination);
  canonicalPath(fs, packageRoot.endsWith("/") ? packageRoot.slice(0, -1) : packageRoot);
  if (!fs.existsSync(destinationParent)) fs.mkdirSync(destinationParent, { mode: 0o700 });
  canonicalPath(fs, destinationParent);
  assert.equal(fs.lstatSync(destinationParent).mode & 0o777, 0o700);
  assert(!fs.existsSync(destination), "native destination already exists");
  const built = await buildNativeOracles({
    profile,
    host,
    parent: options.parent,
    name: "native-build"
  });
  const inputs = Object.fromEntries(built.outputs.map((output) => [output.tool, output.path]));
  const receipt = stageNativeExecutables({
    profile,
    host,
    parent: destinationParent,
    name: "native-gnu",
    inputs
  });
  console.log(
    JSON.stringify({ ...receipt, buildReceipt: join(built.root, "receipt.json") }, null, 2)
  );
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
