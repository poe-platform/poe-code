import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

const tools = () => import("./native-tool.js");
const bootstrap = () => import(new URL("../../../scripts/provision-test-rg.mjs", import.meta.url).href);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const executable = Buffer.from("synthetic rg bytes, never executed");
const profile = () => ({
  id: "synthetic-rg", version: "15.2.0", platform: "linux", arch: "x64",
  archive: { url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/synthetic.tar.gz", prefix: "synthetic", size: 0, sha256: "" },
  executable: { member: "synthetic/rg", size: executable.length, sha256: digest(executable), mode: "0755" },
  qualification: { status: "PENDING_LINUX_EXECUTION", expectedVersionPrefix: "ripgrep 15.2.0" },
});
const host = { platform: "linux", arch: "x64", release: "synthetic-kernel" };

function memory() {
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/job/bin/rg": executable }));
  fileSystem.chmodSync("/job", 0o700);
  fileSystem.chmodSync("/job/bin", 0o755);
  fileSystem.chmodSync("/job/bin/rg", 0o755);
  return fileSystem;
}

async function admission() {
  const fileSystem = memory();
  const selected = profile();
  const calls: { path: string; options: unknown }[] = [];
  const module = await tools();
  const dependencies = {
    fileSystem: fileSystem as unknown as typeof import("node:fs"),
    host: () => host,
    profiles: () => [selected],
    version: (path: string, options: unknown) => {
      calls.push({ path, options });
      return { status: 0, signal: null, stdout: "ripgrep 15.2.0 (synthetic)\n" };
    },
  };
  return { fileSystem, selected, calls, dependencies, admit: module.createRgAdmitter(dependencies) };
}

function tarMember(name: string, bytes: Buffer, type = "0", mode = 0o755) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
  header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

function archive(members = [tarMember("synthetic/rg", executable)]) {
  const bytes = gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
  const selected = profile();
  selected.archive.size = bytes.length;
  selected.archive.sha256 = digest(bytes);
  return { bytes, selected };
}

test("rg admission import is lazy and has no version side effects", async () => {
  const setup = await admission();
  assert.equal(setup.calls.length, 0);
  assert.equal(typeof (await tools()).requireNativeRg, "function");
});

test("rg matching binding admits owned immutable identity, not behavioral qualification", async () => {
  const setup = await admission();
  const identity = setup.admit("/job/bin/rg");
  assert.equal(identity.sha256, digest(executable));
  assert.equal(identity.qualificationStatus, "PENDING_LINUX_EXECUTION");
  assert.equal(identity.status, "BINDING_ADMITTED_NOT_BEHAVIORALLY_QUALIFIED");
  assert(Object.isFrozen(identity));
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.admit("/job/bin/rg"), identity);
  assert.equal(setup.calls.length, 1);
});

test("rg vendor profiles select exact bytes while retaining the original binding", async () => {
  for (const vendorFirst of [false, true]) {
    const setup = await admission();
    const vendorBytes = Buffer.alloc(executable.length, 118);
    const vendor = { ...setup.selected, id: "synthetic-vendor", executable: { ...setup.selected.executable, sha256: digest(vendorBytes) } };
    const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => vendorFirst ? [vendor, setup.selected] : [setup.selected, vendor] });
    assert.equal(admit("/job/bin/rg").profileId, "synthetic-rg");
    setup.fileSystem.writeFileSync("/job/bin/rg", vendorBytes);
    assert.equal(admit("/job/bin/rg").profileId, "synthetic-vendor");
    assert.equal(setup.calls.length, 2);
  }
});

test("rg vendor profiles reject an unknown same-sized hash before execution", async () => {
  const setup = await admission();
  const vendor = { ...setup.selected, id: "synthetic-vendor", executable: { ...setup.selected.executable, sha256: digest(Buffer.alloc(executable.length, 118)) } };
  setup.fileSystem.writeFileSync("/job/bin/rg", Buffer.alloc(executable.length, 119));
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => [setup.selected, vendor] });
  assert.throws(() => admit("/job/bin/rg"), /SHA-256 mismatch/u);
  assert.equal(setup.calls.length, 0);
});

test("rg vendor profiles refuse duplicate exact identities before execution", async () => {
  const setup = await admission();
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => [setup.selected, { ...setup.selected, id: "duplicate" }] });
  assert.throws(() => admit("/job/bin/rg"), /ambiguous/u);
  assert.equal(setup.calls.length, 0);
});

test("rg vendor profile wrong version fails after exact hash admission", async () => {
  const setup = await admission();
  let executions = 0;
  const other = { ...setup.selected, id: "other-vendor", executable: { ...setup.selected.executable, sha256: digest(Buffer.alloc(executable.length, 118)) } };
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => [other, setup.selected], version: () => {
    executions++;
    return { status: 0, signal: null, stdout: "ripgrep 15.2.1\n" };
  } });
  assert.throws(() => admit("/job/bin/rg"), /version mismatch/u);
  assert.equal(executions, 1);
});

test("rg vendor profile cached admission still refuses subsequent byte tampering", async () => {
  const setup = await admission();
  const other = { ...setup.selected, id: "other-vendor", executable: { ...setup.selected.executable, sha256: digest(Buffer.alloc(executable.length, 118)) } };
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => [setup.selected, other] });
  admit("/job/bin/rg");
  setup.fileSystem.writeFileSync("/job/bin/rg", Buffer.alloc(executable.length, 119));
  assert.throws(() => admit("/job/bin/rg"), /SHA-256 mismatch/u);
  assert.equal(setup.calls.length, 1);
});

test("rg vendor metadata adds the exact official artifact without replacing historical profiles", async () => {
  const profiles = (await tools()).loadRgProfiles();
  assert.equal(profiles.length, 3);
  const vendor = profiles.find(entry => entry.id === "ripgrep-15.2.0-darwin-arm64-codex-0.151.0")!;
  assert.equal(vendor.executable.sha256, "345c4e819ed4a17806cec23fc0b54592731ccc265052d2bac6c400e2d24ba728");
  assert.equal(vendor.executable.size, 4030432);
  assert.equal(vendor.qualification.status, "PENDING_VENDOR_ARTIFACT_QUALIFICATION");
  assert(profiles.some(entry => entry.executable.sha256 === "5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7"));
  assert(profiles.some(entry => entry.executable.sha256 === "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849"));
  const metadata = JSON.parse(readFileSync(new URL("./native-tool-profile.darwin-arm64-codex-0.151.0.json", import.meta.url), "utf8")) as { provenance: Record<string, unknown> };
  assert.equal(metadata.provenance.packageVersion, "0.151.0-darwin-arm64");
  assert.equal(metadata.provenance.archiveIntegrity, "sha512-g7YzpaCZGCw19R/gly3vRPjnLqaW7JcBAu2WQQ6e8PIlvBPmS/gMplIUURMgNO6gi8LsPzdlQtLqkwoeOOlIdg==");
  assert.equal(metadata.provenance.member, "package/vendor/aarch64-apple-darwin/codex-path/rg");
  assert.equal(metadata.provenance.reportedSourceCommit, "78c290807ce710180111df227df3b7a4fe845452");
});

test("rg required unset empty relative and missing bindings fail without fallback", async () => {
  const setup = await admission();
  for (const path of [undefined, "", "rg", "/missing/rg"]) assert.throws(() => setup.admit(path));
  assert.equal(setup.calls.length, 0);
});

test("rg wrong executable size or hash fails before version execution", async () => {
  for (const bytes of [Buffer.from("short"), Buffer.alloc(executable.length, 120)]) {
    const setup = await admission();
    setup.fileSystem.writeFileSync("/job/bin/rg", bytes);
    assert.throws(() => setup.admit("/job/bin/rg"));
    assert.equal(setup.calls.length, 0);
  }
});

test("rg symlink directory mode and noncanonical bindings are rejected", async () => {
  const setup = await admission();
  setup.fileSystem.symlinkSync("/job/bin/rg", "/job/link");
  for (const path of ["/job/link", "/job/bin", "/job/bin/../bin/rg"]) assert.throws(() => setup.admit(path));
  setup.fileSystem.chmodSync("/job/bin/rg", 0o777);
  assert.throws(() => setup.admit("/job/bin/rg"));
  assert.equal(setup.calls.length, 0);
});

test("rg version status signal error and falsey errors cannot admit", async () => {
  for (const result of [
    { status: 0, signal: null, stdout: "ripgrep 15.2.01\n" },
    { status: 1, signal: null, stdout: "ripgrep 15.2.0\n" },
    { status: 0, signal: "SIGKILL", stdout: "ripgrep 15.2.0\n" },
    { status: 0, signal: null, stdout: "ripgrep 15.2.0\n", error: false },
    { status: null, signal: null, stdout: "ripgrep 15.2.0\n", error: new Error("deadline") },
    { status: 0, signal: null, stdout: "ripgrep 15.2.0 " + "x".repeat(65536) },
  ]) {
    const setup = await admission();
    const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, version: () => result });
    assert.throws(() => admit("/job/bin/rg"));
  }
});

test("rg version invocation has bounded clean subprocess options", async () => {
  const setup = await admission();
  setup.admit("/job/bin/rg");
  const options = setup.calls[0]!.options as { timeout: number; maxBuffer: number; shell: boolean; env: Record<string, string> };
  assert.equal(options.timeout, 3000);
  assert.equal(options.maxBuffer, 65536);
  assert.equal(options.shell, false);
  for (const key of ["NODE_OPTIONS", "BASH_ENV", "ENV", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]) assert.equal(options.env[key], undefined);
});

test("rg generic unsupported host fails without touching incompatible executable", async () => {
  const setup = await admission();
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, host: () => ({ ...host, arch: "arm64" }) });
  assert.throws(() => admit("/job/bin/rg"), /required.*profile/i);
  assert.equal(setup.calls.length, 0);
});

test("rg cache detects replacement and verifies identity after version callback", async () => {
  const setup = await admission();
  setup.admit("/job/bin/rg");
  setup.fileSystem.unlinkSync("/job/bin/rg");
  setup.fileSystem.writeFileSync("/job/bin/rg", Buffer.alloc(executable.length), { mode: 0o755 });
  assert.throws(() => setup.admit("/job/bin/rg"));
  const second = await admission();
  const admit = (await tools()).createRgAdmitter({ ...second.dependencies, version: () => {
    second.fileSystem.chmodSync("/job/bin/rg", 0o777);
    return { status: 0, signal: null, stdout: "ripgrep 15.2.0\n" };
  } });
  assert.throws(() => admit("/job/bin/rg"));
});

test("rg profile mutation during admission cannot change returned validated fields", async () => {
  const setup = await admission();
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, version: () => {
    setup.selected.id = "";
    setup.selected.executable.sha256 = "wrong";
    return { status: 0, signal: null, stdout: "ripgrep 15.2.0\n" };
  } });
  const identity = admit("/job/bin/rg");
  assert.equal(identity.profileId, "synthetic-rg");
  assert.equal(identity.sha256, digest(executable));
});

test("rg authenticated archive extracts only the exact executable", async () => {
  const input = archive([tarMember("synthetic/README", Buffer.from("data"), "0", 0o644), tarMember("synthetic/rg", executable)]);
  assert.deepEqual((await bootstrap()).extractRgArchive(input.bytes, input.selected), executable);
});

test("rg wrong archive size and hash fail before parsing", async () => {
  const input = archive();
  const module = await bootstrap();
  assert.throws(() => module.extractRgArchive(Buffer.from("not gzip"), input.selected));
  assert.throws(() => module.extractRgArchive(input.bytes, { ...input.selected, archive: { ...input.selected.archive, sha256: "0".repeat(64) } }));
});

test("rg invalid gzip and bounded expansion fail", async () => {
  const module = await bootstrap();
  const bad = Buffer.from("not gzip");
  const selected = profile();
  selected.archive.size = bad.length; selected.archive.sha256 = digest(bad);
  assert.throws(() => module.extractRgArchive(bad, selected));
  const huge = gzipSync(Buffer.alloc(17 * 1024 * 1024));
  selected.archive.size = huge.length; selected.archive.sha256 = digest(huge);
  assert.throws(() => module.extractRgArchive(huge, selected));
});

test("rg tar traversal absolute and prefix escape names fail", async () => {
  const module = await bootstrap();
  for (const name of ["/rg", "synthetic/../rg", "elsewhere/rg", "synthetic//rg", "synthetic/./rg", "synthetic/\\rg"]) {
    const input = archive([tarMember(name, executable)]);
    assert.throws(() => module.extractRgArchive(input.bytes, input.selected));
  }
});

test("rg tar links special files duplicate entries and corrupt headers fail", async () => {
  const module = await bootstrap();
  for (const type of ["1", "2", "3", "4", "6", "x", "L"]) {
    const input = archive([tarMember("synthetic/rg", executable, type)]);
    assert.throws(() => module.extractRgArchive(input.bytes, input.selected));
  }
  const duplicate = archive([tarMember("synthetic/rg", executable), tarMember("synthetic/rg", executable)]);
  assert.throws(() => module.extractRgArchive(duplicate.bytes, duplicate.selected));
  const corrupted = tarMember("synthetic/rg", executable); corrupted[0] = 0;
  const input = archive([corrupted]);
  assert.throws(() => module.extractRgArchive(input.bytes, input.selected));
});

test("rg missing wrong-sized wrong-hash or wrong-mode member fails", async () => {
  const module = await bootstrap();
  for (const member of [tarMember("synthetic/other", executable), tarMember("synthetic/rg", Buffer.from("bad")), tarMember("synthetic/rg", Buffer.alloc(executable.length)), tarMember("synthetic/rg", executable, "0", 0o777)]) {
    const input = archive([member]);
    assert.throws(() => module.extractRgArchive(input.bytes, input.selected));
  }
});

test("rg fetch accepts authenticated bytes and rejects oversized body or length", async () => {
  const input = archive(); const module = await bootstrap();
  assert.deepEqual(await module.fetchRgArchive(input.selected, async () => new Response(input.bytes)), input.bytes);
  await assert.rejects(module.fetchRgArchive(input.selected, async () => new Response(Buffer.alloc(input.bytes.length + 1))));
  await assert.rejects(module.fetchRgArchive(input.selected, async () => new Response(input.bytes, { headers: { "content-length": "1" } })));
});

test("rg redirects and fetch deadlines are bounded without real networking", async () => {
  const input = archive(); const module = await bootstrap();
  for (const location of ["http://github.com/bad", "https://evil.example/rg", "https://user@release-assets.githubusercontent.com/rg"]) {
    await assert.rejects(module.fetchRgArchive(input.selected, async () => new Response(null, { status: 302, headers: { location } })));
  }
  await assert.rejects(module.fetchRgArchive(input.selected, async () => new Response(null, { status: 302, headers: { location: input.selected.archive.url } })));
  await assert.rejects(module.fetchRgArchive(input.selected, () => new Promise(() => {}), 5), /deadline/i);
});

test("rg provisioner installs privately without subprocess and preserves pending status", async () => {
  const input = archive(); const fileSystem = memory(); const module = await bootstrap();
  const receipt = await module.provisionRg({ destination: "/job/tool", profile: input.selected, fileSystem, fetcher: async () => new Response(input.bytes), host });
  assert.deepEqual(fileSystem.readFileSync("/job/tool/bin/rg"), executable);
  assert.equal(Number(fileSystem.statSync("/job/tool/bin/rg").mode) & 0o777, 0o755);
  assert.equal(receipt.qualificationStatus, "PENDING_LINUX_EXECUTION");
  assert.equal(receipt.observedVersion, null);
  assert.deepEqual(fileSystem.readdirSync("/job/tool/bin"), ["rg"]);
});

test("rg provisioner rejects overwrite symlink parents and unsupported host before fetch", async () => {
  const input = archive(); const module = await bootstrap(); const fileSystem = memory();
  let calls = 0; const fetcher = async () => { calls++; return new Response(input.bytes); };
  fileSystem.symlinkSync("/job", "/alias");
  for (const destination of ["/job/bin", "/alias/new", "relative"]) await assert.rejects(module.provisionRg({ destination, profile: input.selected, fileSystem, fetcher, host }));
  await assert.rejects(module.provisionRg({ destination: "/job/new", profile: input.selected, fileSystem, fetcher, host: { ...host, platform: "darwin" } }));
  assert.equal(calls, 0);
});

test("rg failed provisioning cleans only its new owned output", async () => {
  const input = archive(); const module = await bootstrap(); const fileSystem = memory();
  await assert.rejects(module.provisionRg({ destination: "/job/new", profile: input.selected, fileSystem, fetcher: async () => new Response("bad"), host }));
  assert.equal(fileSystem.existsSync("/job/new"), false);
  assert.deepEqual(fileSystem.readFileSync("/job/bin/rg"), executable);
});

test("rg provisioner refuses substituted destination without removing foreign data", async () => {
  const input = archive(); const module = await bootstrap(); const fileSystem = memory();
  await assert.rejects(module.provisionRg({ destination: "/job/new", profile: input.selected, fileSystem, host, fetcher: async () => {
    fileSystem.renameSync("/job/new", "/job/moved");
    fileSystem.mkdirSync("/job/new"); fileSystem.writeFileSync("/job/new/foreign", "keep");
    return new Response(input.bytes);
  } }));
  assert.equal(fileSystem.readFileSync("/job/new/foreign", "utf8"), "keep");
});

test("rg original caller declarations remain and availability skips disappear", () => {
  const rg = readFileSync(new URL("./rg.test.ts", import.meta.url), "utf8");
  const safety = readFileSync(new URL("./safety.test.ts", import.meta.url), "utf8");
  assert(!rg.includes("skip: !nativeRg")); assert(!safety.includes("skip: !nativeRg"));
  assert(rg.includes("Object.entries(cases)"));
  assert(rg.includes("deterministic virtual results do not depend on native rg availability"));
  assert(safety.includes("native invalid syntax also returns two without output"));
  const source = ts.createSourceFile("rg.test.ts", rg, ts.ScriptTarget.Latest, true);
  const cases = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => declaration.name.getText() === "cases");
  assert(cases?.initializer && ts.isObjectLiteralExpression(cases.initializer));
  assert.equal(cases.initializer.properties.length, 86);
  const count = (text: string) => {
    const syntax = ts.createSourceFile("selected.test.ts", text, ts.ScriptTarget.Latest, true);
    let declarations = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText() === "test") declarations++;
      ts.forEachChild(node, visit);
    };
    visit(syntax);
    return declarations;
  };
  assert.equal(count(rg), 3);
  assert.equal(count(safety), 13);
});

test("rg portable execution and differential candidate phase precede native admission", async () => {
  const helpers = await import("./helpers.js");
  const fixture = { args: ["needle", "-"], stdin: "needle\n" };
  assert.equal((await helpers.virtual(fixture)).stdout.toString(), "needle\n");
  const source = readFileSync(new URL("./helpers.ts", import.meta.url), "utf8");
  const differential = source.slice(source.indexOf("export async function differential"));
  assert(differential.indexOf("await virtual(fixture)") < differential.indexOf("await native(fixture)"));
});

test("rg direct and pipeline launches share explicit binding and clean environment", async () => {
  const module = await tools();
  const env = module.nativeRgEnvironment("/job/scratch", "/job/tool with spaces/rg");
  assert.equal(env.SAFE_BASH_TEST_RG, "/job/tool with spaces/rg");
  assert.equal(env.PATH, "/job/tool with spaces:/usr/bin:/bin");
  assert.equal(env.BASH_ENV, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  const harness = readFileSync(new URL("../search-stress/harness.ts", import.meta.url), "utf8");
  assert(harness.includes('command "$SAFE_BASH_TEST_RG"'));
  assert(!harness.includes('bounded("rg",'));
  const virtual = harness.slice(harness.indexOf("export function virtual"), harness.indexOf("export function native"));
  assert(!virtual.includes("requireNativeRg"));
});

test("rg Mac and Linux metadata remain distinct with no invented kernel constraint", async () => {
  const module = await tools();
  const linux = module.loadRgProfiles().find(entry => entry.platform === "linux")!;
  const mac = module.loadRgProfiles().find(entry => entry.platform === "darwin")!;
  assert.equal(linux.qualification.status, "PENDING_LINUX_EXECUTION");
  assert.equal(linux.executable.sha256, "e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849");
  assert.equal(mac.executable.sha256, "5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7");
  assert.equal(mac.arch, "arm64");
  assert.equal(Object.hasOwn(mac, "release"), false);
});

test("rg PATH directory admits only rg and rejects delimiter or renamed bindings", async () => {
  const setup = await admission();
  setup.fileSystem.writeFileSync("/job/bin/other", executable, { mode: 0o755 });
  assert.throws(() => setup.admit("/job/bin/other"));
  assert.throws(() => setup.admit("/job/bin/rg"));
  assert.equal(setup.calls.length, 0);
  const module = await tools();
  assert.throws(() => module.nativeRgEnvironment("/job", "/job/a:b/rg"));
});

test("rg provision receipt owns its validated host snapshot across fetch", async () => {
  const input = archive(); const module = await bootstrap(); const fileSystem = memory();
  const mutableHost = { ...host };
  const receipt = await module.provisionRg({ destination: "/job/new", profile: input.selected, fileSystem, host: mutableHost, fetcher: async () => {
    mutableHost.platform = "wrong"; mutableHost.release = "wrong";
    return new Response(input.bytes);
  } });
  assert.deepEqual(receipt.host, host);
});

test("rg Darwin admission uses its explicit tuple without a kernel equality constraint", async () => {
  const setup = await admission();
  const mac = { ...setup.selected, platform: "darwin", arch: "arm64", qualification: { ...setup.selected.qualification, status: "PENDING_CALLER_ROLLOUT" } };
  const admit = (await tools()).createRgAdmitter({ ...setup.dependencies, profiles: () => [mac], host: () => ({ platform: "darwin", arch: "arm64", release: "different-recorded-kernel" }) });
  assert.equal(admit("/job/bin/rg").qualificationStatus, "PENDING_CALLER_ROLLOUT");
});

test("rg empty-chunk responses have an independent finite read budget", async () => {
  const input = archive(); const module = await bootstrap();
  let reads = 0;
  await assert.rejects(module.fetchRgArchive(input.selected, async () => ({
    status: 200, headers: new Headers(), body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: new Uint8Array() }; },
      cancel: async () => {},
    }) },
  })), /chunk-read limit/u);
  assert.equal(reads, 16384);
});
