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

test("wrong digest and truncated bytes refuse execution", () => {
  for (const bytes of [Buffer.alloc(executable.length, 65), executable.subarray(0, -1)]) {
    const { fileSystem, pin, calls, run } = fixture();
    fileSystem.writeFileSync("/owned/build/diff", bytes);
    assert.throws(() => verifyNativeExecutable(pin, "/owned/build/diff", { fileSystem, run }));
    assert.equal(calls.length, 0);
  }
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

function buildFixture() {
  const value = fixture();
  const source = Buffer.from("in-memory authenticated archive fixture");
  value.profile.compilerVersion = "13.3.0";
  value.profile.buildPrefix = "/home/qualifier/native-prefix";
  value.profile.sourceDateEpoch = "1743984000";
  value.profile.sources = [
    {
      name: "diffutils-3.12",
      url: "https://ftp.gnu.org/gnu/diffutils/diffutils-3.12.tar.xz",
      size: source.length,
      sha256: digest(source),
      outputs: [{ tool: "diff", path: "src/diff" }]
    }
  ];
  const steps = [];
  const execute = async (command, args, options) => {
    steps.push({ command, args, options });
    if (command === "/usr/bin/gcc")
      return { status: 0, signal: null, stdout: "13.3.0\n", stderr: "" };
    if (command === "/usr/bin/tar")
      value.fileSystem.mkdirSync("/owned/build-proof/sources/diffutils-3.12/src", {
        recursive: true
      });
    if (command === "/usr/bin/make")
      value.fileSystem.writeFileSync(
        "/owned/build-proof/sources/diffutils-3.12/src/diff",
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
    if (command === "/usr/bin/bsdtar" && args[0] === "-xJf")
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
