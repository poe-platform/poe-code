import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { Volume, createFsFromVolume } from "memfs";
import * as native from "./provision-test-native-oracles.mjs";
import {
  selectNativeProfile,
  verifyNativeExecutable,
  stageNativeExecutables,
  buildNativeOracles,
  parseNativeArguments
} from "./provision-test-native-oracles.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const executable = Buffer.from("fixture executable; never executed by a real process\n");
const host = { platform: "linux", arch: "x64", distribution: "ubuntu", version: "24.04" };

function localFixture() {
  const value = fixture();
  const localHost = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
  const profile = { ...value.profile, id: "local-macos26.4.1-arm64-gnu-20260831", host: localHost,
    qualification: "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY",
    executables: [value.pin, { ...value.pin, tool: "patch", version: "GNU patch 2.8" }] };
  value.fileSystem.writeFileSync("/owned/build/patch", executable, { mode: 0o755 });
  return { ...value, profile, localHost, localProfile: profile.id };
}

test("local GNU observation requires the literal opt-in, exact host and only diff/patch", () => {
  const { profile, localHost, localProfile } = localFixture();
  assert.deepEqual(selectNativeProfile([profile], localHost, localProfile), profile);
  assert.throws(() => selectNativeProfile([profile], localHost));
  for (const selector of ["", "other", profile.id + " "]) assert.throws(() => selectNativeProfile([profile], localHost, selector));
  for (const other of [{ ...localHost, release: "25.5.0" }, { ...localHost, version: "26.5.2" }, { ...localHost, arch: "x64" }, host]) {
    assert.throws(() => selectNativeProfile([{ ...profile, host: other }], other, localProfile));
  }
  for (const changed of [
    { ...profile, id: "self-described" },
    { ...profile, qualification: "BUILT_OBSERVATIONS_UNREVIEWED" },
    { ...profile, executables: [profile.executables[0]] },
    { ...profile, executables: [...profile.executables, { ...profile.executables[0], tool: "tar" }] }
  ]) assert.throws(() => selectNativeProfile([changed], localHost, localProfile));
  assert.throws(() => selectNativeProfile([profile, profile], localHost, localProfile));
});

test("local staging retains qualification-only status and refuses tamper before execution", () => {
  const value = localFixture();
  const calls = [];
  const run = (path) => { calls.push(path); return { status: 0, signal: null, stdout: (path.endsWith("/patch") ? "GNU patch 2.8" : value.pin.version) + "\n", stderr: "" }; };
  const options = { parent: "/owned", name: "candidate", profile: value.profile, host: value.localHost, localProfile: value.localProfile,
    inputs: { diff: "/owned/build/diff", patch: "/owned/build/patch" } };
  const receipt = stageNativeExecutables(options, { ...value, run });
  assert.equal(receipt.qualification, "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY");
  assert.equal(receipt.outputs.length, 2);
  assert.equal(calls.length, 4);
  assert.throws(() => stageNativeExecutables(options, { ...value, run }), /already exists/u);
  value.fileSystem.writeFileSync("/owned/build/diff", Buffer.alloc(executable.length));
  const before = calls.length;
  assert.throws(() => stageNativeExecutables({ ...options, name: "tampered" }, { ...value, run }), /SHA-256/u);
  assert.equal(calls.length, before);
  assert.equal(value.fileSystem.existsSync("/owned/tampered/receipt.json"), false);
});

function fixture() {
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/owned/build/diff": executable }));
  fileSystem.chmodSync("/owned", 0o700);
  fileSystem.chmodSync("/owned/build/diff", 0o755);
  const pin = {
    tool: "diff",
    version: "diff (GNU diffutils) 3.12",
    size: executable.length,
    sha256: digest(executable)
  };
  const profile = {
    id: "unit-fixture-not-a-qualified-real-binary",
    host,
    qualification: "QUALIFIED",
    executables: [pin]
  };
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, signal: null, stdout: pin.version + "\nfixture\n", stderr: "" };
  };
  return { fileSystem, pin, profile, calls, run };
}

test("select only an explicitly qualified matching Linux host profile", () => {
  const { profile } = fixture();
  assert.deepEqual(selectNativeProfile([profile], host), profile);
  for (const other of [
    { ...host, platform: "darwin" },
    { ...host, arch: "arm64" },
    { ...host, distribution: "debian" },
    { ...host, version: "22.04" }
  ])
    assert.throws(() => selectNativeProfile([profile], other));
  for (const qualification of [undefined, "PENDING", "INPUTS_VERIFIED_NOT_QUALIFIED"]) {
    assert.throws(() => selectNativeProfile([{ ...profile, qualification }], host));
  }
  assert.throws(() => selectNativeProfile([profile, profile], host));
});

test("exact regular executable bytes precede bounded genuine version execution", () => {
  const { fileSystem, pin, calls, run } = fixture();
  const actual = verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem, run });
  assert.equal(actual.sha256, pin.sha256);
  assert.equal(actual.version, pin.version);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["--version"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 3000);
  assert.equal(calls[0].options.killSignal, "SIGKILL");
});

test("local Darwin recovery qualification is restricted to the exact diff and patch pair", () => {
  const { pin } = fixture();
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
  const profile = { id: "local-recovery-fixture", host, qualification: "QUALIFIED", executables: [pin, { ...pin, tool: "patch", version: "GNU patch 2.8" }] };
  assert.deepEqual(selectNativeProfile([profile], host), profile);
  for (const executables of [[pin], [...profile.executables, { ...pin, tool: "tar" }], [{ ...pin, tool: "stat" }, profile.executables[1]]]) {
    assert.throws(() => selectNativeProfile([{ ...profile, executables }], host));
  }
  assert.throws(() => selectNativeProfile([{ ...profile, qualification: "BUILT_OBSERVATIONS_UNREVIEWED" }], host));
  assert.throws(() => selectNativeProfile([profile, profile], host));
  assert.throws(() => selectNativeProfile([{ ...profile, host: { ...host, version: "26.5.2" } }], { ...host, version: "26.5.2" }));
});

test("wrong digest and truncated bytes refuse execution", () => {
  for (const bytes of [Buffer.alloc(executable.length, 65), executable.subarray(0, -1)]) {
    const { fileSystem, pin, calls, run } = fixture();
    fileSystem.writeFileSync("/owned/build/diff", bytes);
    assert.throws(() => verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem, run }));
    assert.equal(calls.length, 0);
  }
});

test("local recovery additionally admits reviewed Bash without accepting other tools or partial pairs", () => {
  const { pin } = fixture();
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
  const executables = [pin, { ...pin, tool: "patch" }, { ...pin, tool: "bash" }];
  const profile = { id: "local-bash-fixture", host, qualification: "QUALIFIED", executables };
  assert.deepEqual(selectNativeProfile([profile], host), profile);
  for (const invalid of [[executables[2]], [pin, executables[2]], [...executables, { ...pin, tool: "tar" }]]) {
    assert.throws(() => selectNativeProfile([{ ...profile, executables: invalid }], host));
  }
});

test("Darwin evidence accepts authenticated gzip Bash sources and retains closed membership", () => {
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/owned/evidence/sources/bash-5.3.tar.gz": "archive", "/owned/evidence/sources/bash-5.3.tar.gz.sig": "signature" }));
  const members = ["sources/bash-5.3.tar.gz", "sources/bash-5.3.tar.gz.sig"];
  assert.equal(native.sealDarwinEvidence("/owned/evidence", members, { fileSystem }).length, 2);
});

test("missing, relative, non-executable and linked paths refuse execution", () => {
  for (const kind of ["missing", "relative", "mode", "leaf-link", "ancestor-link"]) {
    const { fileSystem, pin, calls, run } = fixture();
    let path = "/owned/build/diff";
    if (kind === "missing") path = "/owned/build/absent";
    if (kind === "relative") path = "owned/build/diff";
    if (kind === "mode") fileSystem.chmodSync(path, 0o644);
    if (kind === "leaf-link") {
      fileSystem.symlinkSync(path, "/owned/alias");
      path = "/owned/alias";
    }
    if (kind === "ancestor-link") {
      fileSystem.symlinkSync("/owned/build", "/owned/alias");
      path = "/owned/alias/diff";
    }
    assert.throws(() => verifyNativeExecutable(pin, path, { fileSystem, run }));
    assert.equal(calls.length, 0);
  }
});

test("wrong version, failed status, signal and execution errors are rejected", () => {
  for (const result of [
    { status: 0, signal: null, stdout: "GNU diff 1.0\n" },
    { status: 1, signal: null, stdout: "" },
    { status: null, signal: "SIGKILL", stdout: "" },
    { status: null, signal: null, stdout: "", error: new Error("execution failed") }
  ]) {
    const { fileSystem, pin } = fixture();
    assert.throws(() =>
      verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem, run: () => result })
    );
  }
});

test("version execution cannot silently replace authenticated input bytes", () => {
  const { fileSystem, pin, run } = fixture();
  assert.throws(() =>
    verifyNativeExecutable(pin, "/owned/build/diff", {
      fileSystem,
      run(...args) {
        const result = run(...args);
        fileSystem.writeFileSync("/owned/build/diff", Buffer.alloc(executable.length, 66));
        return result;
      }
    })
  );
});

test("stage verified bytes only under a new private destination without hardlinks", () => {
  const { fileSystem, profile, run } = fixture();
  const result = stageNativeExecutables(
    { profile, host, parent: "/owned", name: "native", inputs: { diff: "/owned/build/diff" } },
    { fileSystem, run }
  );
  assert.equal(result.root, "/owned/native");
  assert.deepEqual(fileSystem.readFileSync("/owned/native/bin/diff"), executable);
  assert.notEqual(
    fileSystem.statSync("/owned/build/diff").ino,
    fileSystem.statSync("/owned/native/bin/diff").ino
  );
  assert.equal(fileSystem.statSync("/owned/native/bin/diff").mode & 0o777, 0o755);
  assert.equal(result.outputs[0].sha256, profile.executables[0].sha256);
});

test("existing destinations, foreign-mode parents and traversal names are refused before execution", () => {
  for (const kind of ["existing", "mode", "traversal", "absolute", "link"]) {
    const { fileSystem, profile, run, calls } = fixture();
    let name = "native";
    let parent = "/owned";
    if (kind === "existing") fileSystem.mkdirSync("/owned/native");
    if (kind === "mode") fileSystem.chmodSync("/owned", 0o755);
    if (kind === "traversal") name = "../escape";
    if (kind === "absolute") name = "/escape";
    if (kind === "link") {
      fileSystem.symlinkSync("/owned", "/alias");
      parent = "/alias";
    }
    assert.throws(() =>
      stageNativeExecutables(
        { profile, host, parent, name, inputs: { diff: "/owned/build/diff" } },
        { fileSystem, run }
      )
    );
    assert.equal(calls.length, 0);
  }
});

test("missing or unexpected source members cannot produce a partial staged success", () => {
  for (const inputs of [{}, { diff: "/owned/build/diff", patch: "/owned/build/absent" }]) {
    const { fileSystem, profile, run, calls } = fixture();
    assert.throws(() =>
      stageNativeExecutables(
        { profile, host, parent: "/owned", name: "native", inputs },
        { fileSystem, run }
      )
    );
    assert.equal(calls.length, 0);
    assert.equal(fileSystem.existsSync("/owned/native"), false);
  }
});

function buildFixture(tool = "diff") {
  const value = fixture();
  const sourceName = tool === "patch" ? "patch-2.8" : "diffutils-3.12";
  value.pin.tool = tool;
  if (tool === "patch") value.pin.version = "GNU patch 2.8";
  const source = Buffer.from("in-memory authenticated archive fixture");
  value.profile.compilerVersion = "13.3.0";
  value.profile.buildPrefix = "/home/qualifier/native-prefix";
  value.profile.sourceDateEpoch = "1743984000";
  value.profile.sources = [
    {
      name: sourceName,
      url: "https://ftp.gnu.org/gnu/" + (tool === "patch" ? "patch" : "diffutils") + "/" + sourceName + ".tar.xz",
      size: source.length,
      sha256: digest(source),
      outputs: [{ tool, path: "src/" + tool }]
    }
  ];
  const steps = [];
  const execute = async (command, args, options) => {
    steps.push({ command, args, options });
    if (command === "/usr/bin/gcc")
      return { status: 0, signal: null, stdout: "13.3.0\n", stderr: "" };
    if (command === "/usr/bin/tar")
      value.fileSystem.mkdirSync(join("/owned/build-proof/sources", sourceName, "src"), {
        recursive: true
      });
    if (command === "/usr/bin/make")
      value.fileSystem.writeFileSync(
        join("/owned/build-proof/sources", sourceName, "src", tool),
        executable,
        { mode: 0o755 }
      );
    return { status: 0, signal: null, stdout: "fixture step\n", stderr: "" };
  };
  return { ...value, source, steps, execute, fetch: async () => new Response(source) };
}

test("authenticated source build uses private paths, fixed compiler and no install command", async () => {
  const value = buildFixture();
  const receipt = await buildNativeOracles(
    { profile: value.profile, host, parent: "/owned", name: "build-proof" },
    value
  );
  assert.equal(receipt.outputs[0].sha256, value.pin.sha256);
  assert.deepEqual(
    value.steps.map((step) => step.command),
    ["/usr/bin/gcc", "/usr/bin/tar", "./configure", "/usr/bin/make"]
  );
  assert(value.steps.every((step) => !step.args.includes("install")));
  const configure = value.steps[2];
  assert.equal(configure.options.env.HOME, "/owned/build-proof/home");
  assert.equal(configure.options.env.TMPDIR, "/owned/build-proof/tmp");
  assert.equal(configure.options.env.PATH, "/usr/bin:/bin");
  assert(configure.args.includes("--prefix=/home/qualifier/native-prefix"));
  assert.deepEqual(configure.args, [
    "--prefix=/home/qualifier/native-prefix",
    "--disable-nls",
    "CC=/usr/bin/gcc",
    "CFLAGS=-O2 -g0 -ffile-prefix-map=" + configure.options.cwd + "=."
  ]);
  assert.equal(value.fileSystem.existsSync("/home/qualifier/native-prefix"), false);
  assert.equal(receipt.root, "/owned/build-proof/installed");
});

test("Linux patch pins the qualified editor in configure arguments", async () => {
  const value = buildFixture("patch");
  const receipt = await buildNativeOracles(
    { profile: value.profile, host, parent: "/owned", name: "build-proof" },
    value
  );
  const configure = value.steps[2];
  assert.equal(configure.command, "./configure");
  assert.deepEqual(configure.args, [
    "--prefix=/home/qualifier/native-prefix",
    "--disable-nls",
    "CC=/usr/bin/gcc",
    "CFLAGS=-O2 -g0 -ffile-prefix-map=" + configure.options.cwd + "=.",
    "ac_cv_path_ED=ed"
  ]);
  assert.equal(configure.options.env.PATH, "/usr/bin:/bin");
  assert.equal(Object.hasOwn(configure.options.env, "ED"), false);
  assert.equal(receipt.outputs[0].sha256, value.pin.sha256);
  assert.equal(receipt.outputs[0].tool, "patch");
});

test("Linux patch editor pin does not admit changed executable bytes", async () => {
  const value = buildFixture("patch");
  const execute = value.execute;
  value.execute = async (command, args, options) => {
    const result = await execute(command, args, options);
    if (command === "/usr/bin/make")
      value.fileSystem.writeFileSync(join(options.cwd, "src/patch"), Buffer.alloc(executable.length));
    return result;
  };
  await assert.rejects(
    buildNativeOracles(
      { profile: value.profile, host, parent: "/owned", name: "build-proof" },
      value
    ),
    /native executable SHA-256 mismatch/u
  );
  assert.equal(value.calls.length, 0);
  assert.equal(value.fileSystem.existsSync("/owned/build-proof/installed"), false);
  assert.equal(value.fileSystem.existsSync("/owned/build-proof/failure.json"), true);
});

test("wrong authenticated source bytes stop before extraction and preserve build evidence", async () => {
  const value = buildFixture();
  value.fetch = async () => new Response(Buffer.alloc(value.source.length));
  await assert.rejects(
    buildNativeOracles(
      { profile: value.profile, host, parent: "/owned", name: "build-proof" },
      value
    ),
    /SHA-256 mismatch/u
  );
  assert.deepEqual(
    value.steps.map((step) => step.command),
    ["/usr/bin/gcc"]
  );
  assert.equal(value.fileSystem.existsSync("/owned/build-proof/logs"), true);
  assert.equal(value.fileSystem.existsSync("/owned/build-proof/installed"), false);
});

test("wrong compiler refuses source download rather than inventing a new qualified profile", async () => {
  const value = buildFixture();
  let fetched = false;
  value.fetch = async () => {
    fetched = true;
    return new Response(value.source);
  };
  value.execute = async () => ({ status: 0, signal: null, stdout: "14.0.0\n", stderr: "" });
  await assert.rejects(
    buildNativeOracles(
      { profile: value.profile, host, parent: "/owned", name: "build-proof" },
      value
    ),
    /compiler/u
  );
  assert.equal(fetched, false);
});

test("CLI requires both explicit private paths and refuses duplicate or unknown options", () => {
  assert.deepEqual(
    parseNativeArguments([
      "--parent",
      "/job/private",
      "--destination",
      "/repo/packages/safe-bash/tmp/native-gnu"
    ]),
    { parent: "/job/private", destination: "/repo/packages/safe-bash/tmp/native-gnu" }
  );
  for (const args of [
    [],
    ["--parent", "/job/private"],
    ["--destination", "/repo/output"],
    ["--parent", "relative", "--destination", "/repo/output"],
    ["--parent", "/job", "--destination", "relative"],
    ["--parent", "/job", "--parent", "/other", "--destination", "/repo/output"],
    ["--parent", "/job", "--destination", "/repo/output", "--global"]
  ])
    assert.throws(() => parseNativeArguments(args));
});

function darwinFixture() {
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/owned/checkout/file": "fixture" }));
  fileSystem.chmodSync("/owned", 0o700);
  const bytes = Buffer.from("authenticated source fixture");
  const signature = Buffer.from("detached signature fixture");
  const keyring = Buffer.from("public verification key fixture");
  const pin = (value, name) => ({
    url: `https://ftp.gnu.org/gnu/${name}`,
    size: value.length,
    sha256: digest(value)
  });
  const profile = {
    id: "fixture-darwin-observation-only",
    qualification: "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY",
    imageOS: "macos26",
    imageVersion: "20260728.0273.1",
    osVersion: "26.5.2",
    buildVersion: "25F84",
    kernel: "25.5.0",
    xcode: "Xcode 26.6\nBuild version 17F113",
    compilerVersion: "fixture clang 21",
    compiler: "/usr/bin/clang",
    verifier: "/opt/homebrew/bin/gpgv",
    verifierVersion: "gpgv (GnuPG) 2.5.21",
    buildPrefix: "/native-qualification",
    sourceDateEpoch: "1743984000",
    apple: [],
    keyring: pin(keyring, "gnu-keyring.gpg"),
    sources: [
      {
        ...pin(bytes, "coreutils-9.7.tar.xz"),
        name: "coreutils-9.7",
        signer: "A".repeat(40),
        signature: pin(signature, "coreutils-9.7.tar.xz.sig"),
        builds: 2,
        coreutils: true,
        outputs: [{ tool: "stat", path: "src/stat", version: "stat (GNU coreutils) 9.7" }]
      }
    ]
  };
  const context = {
    platform: "darwin",
    arch: "arm64",
    node: "22.22.2",
    sha: "a".repeat(40),
    runId: "123",
    repository: "poe-platform/poe-code",
    ref: "refs/heads/main",
    event: "workflow_dispatch",
    runner: "github-hosted",
    runnerOS: "macOS",
    runnerArch: "ARM64",
    imageOS: profile.imageOS,
    imageVersion: profile.imageVersion
  };
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    let stdout = "";
    if (command === "/usr/bin/git") stdout = context.sha + "\n";
    if (command === "/usr/bin/sw_vers")
      stdout = (args[0] === "-productVersion" ? profile.osVersion : profile.buildVersion) + "\n";
    if (command === "/usr/bin/uname") stdout = profile.kernel + "\n";
    if (command === "/usr/bin/xcodebuild") stdout = profile.xcode + "\n";
    if (command === profile.compiler) stdout = profile.compilerVersion + "\n";
    if (command === profile.verifier)
      stdout =
        args[0] === "--version"
          ? profile.verifierVersion + "\n"
          : `[GNUPG:] VALIDSIG ${profile.sources[0].signer} 2026 fixture\n`;
    if (command === "/usr/bin/bsdtar" && args[0] === "-xf")
      fileSystem.mkdirSync(join(args[args.indexOf("-C") + 1], profile.sources[0].name, "src"), {
        recursive: true
      });
    if (command === "./configure")
      for (const name of ["config.log", "config.status"])
        fileSystem.writeFileSync(join(options.cwd, name), "fixture configuration");
    if (command === "/usr/bin/make" && (args.includes("src/stat") || !profile.sources[0].coreutils))
      fileSystem.writeFileSync(join(options.cwd, "src/stat"), executable, { mode: 0o755 });
    if (command.endsWith("/src/stat")) stdout = "stat (GNU coreutils) 9.7\n";
    return { status: 0, signal: null, stdout, stderr: "" };
  };
  const fetcher = async (url) =>
    new Response(
      String(url).endsWith(".sig") ? signature : String(url).endsWith(".gpg") ? keyring : bytes
    );
  return {
    fileSystem,
    profile,
    context,
    calls,
    execute,
    fetch: fetcher,
    options: {
      profile,
      context,
      parent: "/owned",
      name: "qualification",
      checkout: "/owned/checkout"
    }
  };
}

test("Darwin observation refuses host, image, event and checkout identity drift", () => {
  const { profile, context } = darwinFixture();
  assert.doesNotThrow(() => native.assertDarwinContext(profile, context));
  for (const key of Object.keys(context)) {
    assert.throws(
      () => native.assertDarwinContext(profile, { ...context, [key]: "unexpected" }),
      key
    );
  }
  assert.throws(() =>
    native.assertDarwinContext({ ...profile, qualification: "QUALIFIED" }, context)
  );
  assert.throws(() => selectNativeProfile([profile], host));
});

test("required Darwin release lane accepts only the explicit job and normal release events", () => {
  const { profile, context } = darwinFixture();
  for (const event of ["push", "workflow_dispatch"]) {
    const current = { ...context, event, job: "native-darwin" };
    assert.doesNotThrow(() => native.assertDarwinContext(profile, current, true));
    assert.throws(() => native.assertDarwinContext(profile, { ...current, job: "release-stable" }, true));
  }
  assert.throws(() => native.assertDarwinContext(profile, { ...context, event: "pull_request", job: "native-darwin" }, true));
  assert.throws(() => native.assertDarwinContext(profile, { ...context, event: "push" }));
});

test("reviewed Darwin staging retains real separate first and second stat build inputs", async () => {
  const value = darwinFixture();
  const receipt = await native.qualifyDarwinBuild(value.options, value);
  const profile = { id: "test-only-reviewed-darwin", qualification: "QUALIFIED", host: { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" },
    executables: receipt.outputs.filter(output => output.build === 1).map(({ tool, version, size, sha256 }) => ({ tool, version, size, sha256 })) };
  const paths = [];
  const run = (path) => { paths.push(path); return { status: 0, signal: null, stdout: profile.executables[0].version + "\n", stderr: "" }; };
  const staged = native.stageDarwinOutputs({ receipt, profile, host: profile.host, parent: "/owned", name: "native-gnu" }, { fileSystem: value.fileSystem, run });
  assert.equal(staged.primary.outputs[0].path, "/owned/native-gnu/bin/stat");
  assert.equal(staged.secondary.outputs[0].path, "/owned/native-gnu-second/bin/stat");
  assert(paths.includes(receipt.root + "/evidence/bin/stat-1"));
  assert(paths.includes(receipt.root + "/evidence/bin/stat-2"));
  assert.throws(() => native.stageDarwinOutputs({ receipt: { ...receipt, outputs: receipt.outputs.filter(output => output.build === 1) }, profile, host: profile.host, parent: "/owned", name: "missing" }, { fileSystem: value.fileSystem, run }));
  assert.throws(() => native.stageDarwinOutputs({ receipt: { ...receipt, status: "FAILED_NOT_QUALIFIED" }, profile, host: profile.host, parent: "/owned", name: "failed" }, { fileSystem: value.fileSystem, run }));
  const changed = structuredClone(receipt);
  changed.outputs[1].sha256 = "0".repeat(64);
  assert.throws(() => native.stageDarwinOutputs({ receipt: changed, profile, host: profile.host, parent: "/owned", name: "changed" }, { fileSystem: value.fileSystem, run }));
  const replaced = structuredClone(receipt);
  replaced.outputs[1].member = replaced.outputs[0].member;
  assert.throws(() => native.stageDarwinOutputs({ receipt: replaced, profile, host: profile.host, parent: "/owned", name: "replaced" }, { fileSystem: value.fileSystem, run }));
});

test("required Darwin staging is an explicit CLI mode", () => {
  assert.deepEqual(parseNativeArguments(["--stage-darwin", "--parent", "/owned", "--destination", "/workspace/tmp/native-gnu"]), { stageDarwin: true, parent: "/owned", destination: "/workspace/tmp/native-gnu" });
  assert.throws(() => parseNativeArguments(["--stage-darwin", "--qualify-darwin-build", "--parent", "/owned", "--destination", "/owned/build"]));
});

test("required Darwin staging verifies both Bash builds and preserves the separate stat output", async () => {
  const value = darwinFixture();
  const receipt = await native.qualifyDarwinBuild(value.options, value);
  const stat = receipt.outputs[0];
  const bash = { tool: "bash", version: "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.5.0)", size: executable.length, sha256: digest(executable) };
  for (const build of [1, 2]) {
    const member = `bin/bash-${build}`;
    value.fileSystem.writeFileSync(join(receipt.root, "evidence", member), executable, { mode: 0o755 });
    receipt.outputs.push({ ...bash, build, member });
  }
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" };
  const profile = { id: "fixture-bash-and-stat", qualification: "QUALIFIED", host, executables: [stat, bash] };
  const paths = [];
  const run = path => { paths.push(path); return { status: 0, signal: null, stdout: (path.includes("bash") ? bash.version : stat.version) + "\n", stderr: "" }; };
  const options = { receipt, profile, host, parent: "/owned", name: "staged" };
  const missing = { ...receipt, outputs: receipt.outputs.filter(output => !(output.tool === "bash" && output.build === 2)) };
  assert.throws(() => native.stageDarwinOutputs({ ...options, receipt: missing }, { fileSystem: value.fileSystem, run }));
  assert(!value.fileSystem.existsSync("/owned/staged"));
  const changed = structuredClone(receipt);
  changed.outputs.find(output => output.tool === "bash" && output.build === 2).sha256 = "0".repeat(64);
  assert.throws(() => native.stageDarwinOutputs({ ...options, receipt: changed }, { fileSystem: value.fileSystem, run }));
  const staged = native.stageDarwinOutputs(options, { fileSystem: value.fileSystem, run });
  assert(paths.includes(join(receipt.root, "evidence/bin/bash-2")));
  assert.equal(staged.primary.outputs.find(output => output.tool === "bash").path, "/owned/staged/bin/bash");
  assert.deepEqual(staged.secondary.outputs.map(output => output.tool), ["stat"]);
});

test("Darwin staging admits every required stream and table executable through existing membership checks", () => {
  const fileSystem = createFsFromVolume(new Volume());
  fileSystem.mkdirSync("/owned/evidence/bin", { recursive: true });
  fileSystem.mkdirSync("/destination", { mode: 0o700 });
  const tools = ["nl", "seq", "unexpand", "paste", "comm", "join", "split", "stat"];
  const executables = tools.map(tool => ({ tool, version: `${tool} (GNU coreutils) 9.7`, size: executable.length, sha256: digest(executable) }));
  const outputs = executables.flatMap(pin => (pin.tool === "stat" ? [1, 2] : [1]).map(build => {
    const member = `bin/${pin.tool}-${build}`;
    fileSystem.writeFileSync(`/owned/evidence/${member}`, executable, { mode: 0o755 });
    return { ...pin, member, build };
  }));
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" };
  const profile = { id: "unit-stream-table-only", qualification: "QUALIFIED", host, executables };
  const receipt = { root: "/owned", status: "BUILT_OBSERVATIONS_UNREVIEWED", outputs };
  const run = path => {
    const tool = path.split("/").at(-1).split("-")[0];
    return { status: 0, signal: null, stdout: `${tool} (GNU coreutils) 9.7\n`, stderr: "" };
  };
  const options = { receipt, profile, host, parent: "/destination", name: "native-gnu" };
  const staged = native.stageDarwinOutputs(options, { fileSystem, run });
  assert.deepEqual(staged.primary.outputs.map(output => output.tool), tools);
  assert.equal(staged.secondary.outputs[0].path, "/destination/native-gnu-second/bin/stat");
  fileSystem.unlinkSync("/owned/evidence/bin/comm-1");
  assert.throws(() => native.stageDarwinOutputs({ ...options, name: "missing-comm" }, { fileSystem, run }));
  assert(!fileSystem.existsSync("/destination/missing-comm"));
});

test("Apple split exact usage probe does not weaken ordinary executable version admission", () => {
  const value = fixture();
  const probe = { status: 64, stdout: "", stderr: "split: illegal option -- -\nusage: split fixture\n" };
  const pin = { ...value.pin, tool: "split", version: "Apple split (no --version support)", versionProbe: probe };
  const run = () => ({ ...probe, signal: null });
  assert.equal(verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem: value.fileSystem, run }).sha256, pin.sha256);
  for (const change of [{ status: 0 }, { stderr: "different usage\n" }, { stdout: "unexpected" }, { signal: "SIGKILL" }])
    assert.throws(() => verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem: value.fileSystem, run: () => ({ ...run(), ...change }) }));
  assert.throws(() => verifyNativeExecutable({ ...pin, tool: "diff" }, "/owned/build/diff", { fileSystem: value.fileSystem, run }));
  assert.throws(() => verifyNativeExecutable({ ...pin, version: "split (GNU coreutils) 9.7" }, "/owned/build/diff", { fileSystem: value.fileSystem, run }));
  assert.throws(() => verifyNativeExecutable({ ...pin, versionProbe: { ...probe, status: 0 } }, "/owned/build/diff", { fileSystem: value.fileSystem, run }));
  value.fileSystem.writeFileSync("/owned/build/diff", Buffer.alloc(executable.length));
  assert.throws(() => verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem: value.fileSystem, run }));
});

test("existing Darwin qualification records signed Apple split observations without admission", async () => {
  const value = darwinFixture();
  value.profile.appleObservations = ["/usr/bin/split"];
  value.fileSystem.mkdirSync("/usr/bin", { recursive: true });
  value.fileSystem.writeFileSync("/usr/bin/split", executable, { mode: 0o755 });
  const probe = { status: 64, stdout: "", stderr: "/usr/bin/split: illegal option -- -\nusage: split fixture\n", signal: null };
  const execute = async (command, args, options) => command === "/usr/bin/split" ? probe : value.execute(command, args, options);
  const receipt = await native.qualifyDarwinBuild(value.options, { ...value, execute });
  assert.equal(receipt.status, "BUILT_OBSERVATIONS_UNREVIEWED");
  assert.deepEqual(receipt.appleObservations, [{ tool: "split", path: "/usr/bin/split", version: "Apple split (no --version support)", size: executable.length, sha256: digest(executable), versionProbe: { status: 64, stdout: "", stderr: probe.stderr } }]);
  assert(value.calls.some(call => call.command === "/usr/bin/codesign" && call.args.includes("--verify") && call.args.includes("/usr/bin/split")));
  assert(receipt.members.some(member => member.path === "logs/apple-split-version.json"));
});

test("Apple split observation rejects signature, process and byte-identity failures", async () => {
  for (const defect of ["signature", "status", "signal", "stdout", "stderr", "bytes"]) {
    const value = darwinFixture();
    value.profile.appleObservations = ["/usr/bin/split"];
    value.fileSystem.mkdirSync("/usr/bin", { recursive: true });
    value.fileSystem.writeFileSync("/usr/bin/split", executable, { mode: 0o755 });
    const execute = async (command, args, options) => {
      if (command === "/usr/bin/codesign" && defect === "signature") return { status: 1, signal: null, stdout: "", stderr: "invalid signature" };
      if (command !== "/usr/bin/split") return value.execute(command, args, options);
      if (defect === "bytes") value.fileSystem.writeFileSync(command, Buffer.alloc(executable.length));
      return { status: defect === "status" ? 0 : 64, signal: defect === "signal" ? "SIGKILL" : null, stdout: defect === "stdout" ? "unexpected" : "", stderr: defect === "stderr" ? "not usage" : "usage: split fixture\n" };
    };
    await assert.rejects(native.qualifyDarwinBuild(value.options, { ...value, execute }), defect);
  }
});

test("Darwin builds independent coreutils trees, authenticates signatures and never admits observations", async () => {
  const value = darwinFixture();
  const receipt = await native.qualifyDarwinBuild(value.options, value);
  assert.equal(receipt.status, "BUILT_OBSERVATIONS_UNREVIEWED");
  assert.equal(receipt.outputs.length, 2);
  assert.equal(receipt.outputs[0].sha256, receipt.outputs[1].sha256);
  const configure = value.calls.filter((call) => call.command === "./configure");
  assert.equal(configure.length, 2);
  assert.notEqual(configure[0].options.cwd, configure[1].options.cwd);
  assert(value.calls.every((call) => !call.args.includes("install")));
  assert.equal(
    value.calls.filter(
      (call) => call.command === value.profile.verifier && call.args.includes("--status-fd")
    ).length,
    1
  );
  assert(value.calls.every((call) => !Object.hasOwn(call.options.env, "GITHUB_TOKEN")));
  assert.equal(value.fileSystem.existsSync("/native-qualification"), false);
  assert.equal(value.fileSystem.existsSync("/owned/qualification/installed"), false);
  assert(
    receipt.members.every(
      (member) => !member.path.includes("keyring") && !member.path.includes("home")
    )
  );
  assert(receipt.members.some((member) => member.path.endsWith(".tar.xz.sig")));
});

test("Darwin Bash qualification authenticates gzip sources and records two independent builds", async () => {
  const value = darwinFixture();
  const source = value.profile.sources[0];
  source.name = "bash-5.3";
  source.url = "https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz";
  source.signature.url = source.url + ".sig";
  source.coreutils = false;
  source.outputs = [{ tool: "bash", path: "bash", version: "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.5.0)" }];
  const execute = async (command, args, options) => {
    if (command === "/usr/bin/bsdtar" && args[0] === "-xf") value.fileSystem.mkdirSync(join(args[args.indexOf("-C") + 1], source.name), { recursive: true });
    if (command === "/usr/bin/make") {
      value.calls.push({ command, args, options });
      value.fileSystem.writeFileSync(join(options.cwd, "bash"), executable, { mode: 0o755 });
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
    if (command.endsWith("/bash")) return { status: 0, signal: null, stdout: source.outputs[0].version + "\n", stderr: "" };
    return value.execute(command, args, options);
  };
  const receipt = await native.qualifyDarwinBuild(value.options, { ...value, execute });
  assert.deepEqual(receipt.outputs.map(output => [output.tool, output.build]), [["bash", 1], ["bash", 2]]);
  const extracts = value.calls.filter(call => call.command === "/usr/bin/bsdtar");
  assert.equal(extracts.length, 2);
  assert(extracts.every(call => call.args[0] === "-xf" && call.args[1].endsWith("bash-5.3.tar.gz")));
  assert(receipt.members.some(member => member.path === "sources/bash-5.3.tar.gz.sig"));
  assert.equal(new Set(value.calls.filter(call => call.command === "./configure").map(call => call.options.cwd)).size, 2);
});

test("Darwin tar alone links system iconv without changing other configure arguments", async () => {
  for (const name of ["tar-1.35", "diffutils-3.12", "patch-2.8", "coreutils-9.7"]) {
    const value = darwinFixture();
    const source = value.profile.sources[0];
    source.name = name;
    source.coreutils = name === "coreutils-9.7";
    source.builds = source.coreutils ? 2 : 1;
    const receipt = await native.qualifyDarwinBuild(value.options, value);
    assert.equal(receipt.status, "BUILT_OBSERVATIONS_UNREVIEWED");
    const configureCalls = value.calls.filter((call) => call.command === "./configure");
    assert.equal(configureCalls.length, source.builds);
    for (const call of configureCalls) {
      assert.deepEqual(call.args, [
        "--prefix=/native-qualification",
        "--disable-nls",
        "CC=/usr/bin/clang",
        "CFLAGS=-O2 -g0 -ffile-prefix-map=" + call.options.cwd + "=.",
        ...(source.coreutils ? ["--without-gmp"] : []),
        ...(name === "tar-1.35" ? ["LIBS=-liconv"] : [])
      ]);
    }
  }
});

test("Darwin bad source, signature, compiler and checkout stop before any configure", async () => {
  for (const kind of ["source", "signature", "compiler", "checkout"]) {
    const value = darwinFixture();
    const original = value.execute;
    if (kind === "source") value.fetch = async () => new Response("wrong");
    value.execute = async (command, args, options) => {
      const result = await original(command, args, options);
      if (
        (kind === "signature" && args.includes("--status-fd")) ||
        (kind === "compiler" && command === value.profile.compiler) ||
        (kind === "checkout" && command === "/usr/bin/git")
      )
        result.stdout = "wrong";
      return result;
    };
    await assert.rejects(native.qualifyDarwinBuild(value.options, value));
    assert.equal(
      value.calls.some((call) => call.command === "./configure"),
      false
    );
    const failure = JSON.parse(
      value.fileSystem.readFileSync("/owned/qualification/evidence/receipt.json", "utf8")
    );
    assert.equal(failure.status, "FAILED_NOT_QUALIFIED");
    assert(value.fileSystem.existsSync("/owned/qualification/evidence/manifest.json"));
  }
});

test("Darwin evidence refuses unlisted files, keys, links and oversized payloads", () => {
  assert.equal(typeof native.sealDarwinEvidence, "function");
  for (const kind of ["unlisted", "key", "link", "oversize"]) {
    const value = darwinFixture();
    const root = "/owned/evidence";
    value.fileSystem.mkdirSync(root);
    let member = "receipt.json";
    if (kind === "key") member = "keyring.gpg";
    value.fileSystem.writeFileSync(
      join(root, member),
      kind === "oversize" ? Buffer.alloc(16 * 1024 ** 2 + 1) : "fixture"
    );
    if (kind === "link") {
      value.fileSystem.unlinkSync(join(root, member));
      value.fileSystem.symlinkSync("/owned/checkout/file", join(root, member));
    }
    assert.throws(() =>
      native.sealDarwinEvidence(root, kind === "unlisted" ? [] : [member], value)
    );
  }
});

test("Darwin Apple byte and signature drift fail before downloading or compiling", async () => {
  for (const kind of ["bytes", "codesign", "changed-after-verification"]) {
    const value = darwinFixture();
    const path = "/owned/apple-tool";
    value.fileSystem.writeFileSync(path, executable, { mode: 0o755 });
    value.profile.apple = [{ path, size: executable.length, sha256: digest(executable) }];
    const execute = value.execute;
    let downloads = 0;
    value.fetch = async () => {
      downloads++;
      throw new Error("unexpected download");
    };
    if (kind === "bytes") value.fileSystem.writeFileSync(path, Buffer.alloc(executable.length));
    value.execute = async (...args) => {
      const result = await execute(...args);
      if (args[0] === "/usr/bin/codesign") {
        if (kind === "codesign") result.status = 1;
        if (kind === "changed-after-verification")
          value.fileSystem.writeFileSync(path, Buffer.alloc(executable.length));
      }
      return result;
    };
    await assert.rejects(native.qualifyDarwinBuild(value.options, value));
    assert.equal(downloads, 0);
    assert.equal(
      value.calls.some((call) => call.command === "./configure"),
      false
    );
  }
});

test("different independent GNU output hashes remain explicit observations, never qualification", async () => {
  const value = darwinFixture();
  const execute = value.execute;
  value.execute = async (command, args, options) => {
    const result = await execute(command, args, options);
    if (
      command === "/usr/bin/make" &&
      args.includes("src/stat") &&
      options.cwd.includes("coreutils-9.7-2/")
    ) {
      value.fileSystem.writeFileSync(
        join(options.cwd, "src/stat"),
        Buffer.from("different second binary"),
        { mode: 0o755 }
      );
    }
    return result;
  };
  const result = await native.qualifyDarwinBuild(value.options, value);
  assert.equal(result.status, "BUILT_OBSERVATIONS_UNREVIEWED");
  assert.deepEqual(result.repeatedIdentity, [{ tool: "stat", equal: false }]);
  assert.equal(result.outputs.length, 2);
});

test("Darwin CLI mode stays explicit and does not alter the Linux option result", () => {
  assert.deepEqual(
    parseNativeArguments([
      "--qualify-darwin-build",
      "--parent",
      "/owned",
      "--destination",
      "/owned/build"
    ]),
    { qualification: true, parent: "/owned", destination: "/owned/build" }
  );
  assert.throws(() =>
    parseNativeArguments([
      "--qualify-darwin-build",
      "--qualify-darwin-build",
      "--parent",
      "/owned",
      "--destination",
      "/owned/build"
    ])
  );
});
