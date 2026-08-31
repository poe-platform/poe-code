import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preparePublicSnapshot, type CommittedInputs } from "../shell-stress/invocation-cleanup-runtime/migration/binding.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
let binding: Awaited<ReturnType<typeof preparePublicSnapshot>> | undefined;
let snapshot: string | undefined;
let manifestPath: string;
let probe: string;

before(async () => {
  const expectedPath = process.env.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED;
  const committedSource = process.env.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT;
  assert.equal(Boolean(expectedPath), Boolean(committedSource), "Committed qualification requires both explicit commit and independently captured expectation");
  const expected = expectedPath ? JSON.parse(await readFile(expectedPath, "utf8")) as CommittedInputs : undefined;
  if (expectedPath) {
    assert.ok(expected && typeof expected === "object" && !Array.isArray(expected), "Committed qualification requires an object manifest");
    assert.equal(expected.revision, committedSource);
  }
  binding = await preparePublicSnapshot(repository, expected);
  ({ snapshot, manifestPath, probe } = binding);
  console.log(`PUBLIC_SOURCE_MANIFEST ${JSON.stringify(binding.manifest)}`);
}, { timeout: 60000 });

after(async () => {
  if (binding) {
    try { await binding.verify(); }
    finally {
      await binding.dispose();
      console.log(`PUBLIC_SNAPSHOT_CLEANUP ${JSON.stringify({ snapshot, removed: true })}`);
    }
  }
});

for (const command of ["grep", "rg"]) {
  for (const mode of ["normal", "early-pipe", "caller-abort", "same-shell-sibling", "other-shell-sibling"]) {
    test(`real registered ${command}: ${mode} waits owned native retirement`, { timeout: 15000 }, async context => {
      assert.ok(snapshot);
      assert.ok(binding);
      await binding.verify();
      const scenario = `${command}:${mode}`;
      const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", probe, manifestPath, scenario], {
        cwd: snapshot, encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
      });
      const proof = { scenario, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
      context.diagnostic(JSON.stringify(proof));
      await binding.verify();
      assert.equal(result.error, undefined, `${scenario}: ${result.error?.message}`);
      assert.equal(result.signal, null, `${scenario}: ${result.stderr}`);
      assert.equal(result.status, 0, `${scenario}: ${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(result.stdout.trim()) as { passed: boolean; sourcePinned: boolean; liveWorkers: number; unhandled: unknown[] };
      assert.equal(report.passed, true);
      assert.equal(report.sourcePinned, true);
      assert.equal(report.liveWorkers, 0);
      assert.deepEqual(report.unhandled, []);
      const peer = binding.manifest.requiredPeer;
      assert.equal(peer.name, "poe-code");
      const packageManifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
      if (peer.profile === "checkout-root") {
        assert.equal(packageManifest.poeCode?.integration?.peerProfile, "checkout-root");
        assert.equal(packageManifest.devDependencies["poe-code"], "file:../..");
        const rootManifest = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8"));
        assert.equal(peer.version, rootManifest.version);
        assert.equal(peer.integrity, null);
        assert.equal(binding.manifest.rootInputs["package.json"], peer.metadataSha256);
      } else {
        assert.equal(peer.profile, "registry-release");
        assert.equal(peer.version, packageManifest.devDependencies["poe-code"]);
      }
      assert.deepEqual(Object.keys(peer.entries), ["poe-code/safe-fs"]);
      const detailed = JSON.parse(result.stdout.trim()) as { imports: Record<string, string>; requiredPeer: { version: string; metadataSha256: string } };
      assert.equal(detailed.requiredPeer.version, peer.version);
      assert.equal(detailed.requiredPeer.metadataSha256, peer.metadataSha256);
      assert.equal(detailed.imports[peer.entries["poe-code/safe-fs"]!], peer.files[peer.entries["poe-code/safe-fs"]!]);
    });
  }
}

for (const attack of ["metadata-bytes", "runtime-bytes", "missing-runtime", "private-package-route", "redirected-public-entry", "redirected-peer-edge"] as const) {
  test(`public cleanup refuses ${attack} before native worker creation`, { timeout: 15000 }, async context => {
    assert.ok(binding);
    assert.ok(snapshot);
    await binding.verify();
    const peer = binding.manifest.requiredPeer;
    const entry = peer.entries["poe-code/safe-fs"]!;
    const edges = Object.entries(peer.edges[entry]!);
    assert.ok(edges.length > 0);
    const fileUrl = (local: string) => pathToFileURL(`${snapshot}/${local}`).href;
    const configuration = attack === "metadata-bytes" ? { read: `${snapshot}/${peer.metadataPath}`, expected: "Required peer metadata changed" }
      : attack === "runtime-bytes" ? { read: `${snapshot}/${entry}`, expected: "Emitted identity" }
      : attack === "missing-runtime" ? { read: `${snapshot}/${entry}`, missing: true, expected: "injected missing runtime" }
      : attack === "private-package-route" ? { specifier: "poe-code/safe-fs", redirect: fileUrl("node_modules/poe-code/packages/safe-js/dist/index.js"), expected: "Unexpected product import" }
      : attack === "redirected-public-entry" ? { specifier: "poe-code/safe-fs", redirect: fileUrl(edges[0]![1]), expected: "Unadmitted peer public route" }
      : { specifier: edges[0]![0], parent: fileUrl(entry), redirect: fileUrl(entry), expected: "Uncaptured peer runtime edge" };
    const preload = `
      import fs from "node:fs";
      import threads from "node:worker_threads";
      import { registerHooks, syncBuiltinESMExports } from "node:module";
      import { fileURLToPath } from "node:url";
      const attack = ${JSON.stringify(configuration)};
      const originalRead = fs.readFileSync;
      const originalWorker = threads.Worker;
      let workers = 0;
      threads.Worker = class extends originalWorker {
        constructor(...args) { super(...args); workers++; }
      };
      fs.readFileSync = function(file, ...args) {
        const path = file instanceof URL ? fileURLToPath(file) : String(file);
        if (path === attack.read) {
          if (attack.missing) throw Object.assign(new Error("injected missing runtime"), { code: "ENOENT" });
          const bytes = originalRead.call(this, file, ...args);
          return typeof bytes === "string" ? bytes + " altered" : Buffer.concat([bytes, Buffer.from(" altered")]);
        }
        return originalRead.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      const injection = attack.redirect ? registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === attack.specifier && (!attack.parent || context.parentURL === attack.parent)) return { url: attack.redirect, shortCircuit: true };
        return nextResolve(specifier, context);
      } }) : undefined;
      process.on("exit", () => {
        injection?.deregister();
        fs.readFileSync = originalRead;
        threads.Worker = originalWorker;
        syncBuiltinESMExports();
        process.stderr.write("TAMPER_NATIVE_WORKERS " + workers + "\\n");
      });
    `;
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", `data:text/javascript,${encodeURIComponent(preload)}`, probe, manifestPath, "grep:normal"], {
      cwd: snapshot, encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
    });
    context.diagnostic(JSON.stringify({ attack, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
    await binding.verify();
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.ok((result.stdout + result.stderr).includes(configuration.expected));
    assert.ok(result.stderr.includes("TAMPER_NATIVE_WORKERS 0\n"));
  });
}
