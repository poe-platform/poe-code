import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { currentProfile, sha256 } from "../tests/plugins/stream-five-public/current-profile.mjs";
import { environment, json, run, step } from "../tests/plugins/stream-five-public/harness.mjs";
import { publicChecks } from "../tests/plugins/stream-five-public/public-checks.mjs";
import { finish, snapshot, unchangedTests } from "../tests/plugins/qualified-current-release/snapshot.mjs";
import { archiveSetup, fixtureAuthority, stageArchiveTar } from "../tests/plugins/qualified-current-release/prerequisites.mjs";
import { archiveTests } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { currentConsumers } from "./verify-current-consumers.mjs";

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  assert.ok(["--source-commit", "--native-assets-from", "--archive-tar-from", "--peer-tarball", "--check-only"].includes(args[index]), "usage: --source-commit COMMIT --native-assets-from COREUTILS_DIRECTORY --archive-tar-from ABSOLUTE_GNU_TAR --peer-tarball ARTIFACT [--check-only true]");
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), "option needs a value");
  assert.equal(options[args[index]], undefined, "duplicate option");
  options[args[index]] = args[index + 1];
}
if (options["--check-only"] !== undefined) assert.equal(options["--check-only"], "true");
const report = snapshot(options["--source-commit"] ?? "HEAD");
const historical = join(report.root, "tests/commands/stream-next-stress");
const unavailable = issues => {
  report.setup = { status: "setup-unavailable", executedTests: 0, issues };
  finish(report, 78);
};

try {
  const canonical = await import(pathToFileURL(join(report.root, "tests/commands/metadata-stress/canonical-env/runner.mjs")).href);
  if (!options["--native-assets-from"]) {
    unavailable([{ kind: "explicit-native-assets-required", message: "Supply --native-assets-from; no automatic host reconstruction, download or installation." }]);
  } else {
    const primary = resolve(options["--native-assets-from"]);
    const setup = canonical.verifySetup({ primary });
    report.canonicalSetup = setup;
    const issues = [...setup.issues];
    report.archiveSetup = archiveSetup(options["--archive-tar-from"], report.root);
    issues.push(...report.archiveSetup.issues);
    const frozenManifest = JSON.parse(readFileSync(join(historical, "frozen/manifest.json")));
    for (const [path, expected] of Object.entries(frozenManifest.files)) assert.equal(sha256(readFileSync(join(historical, path))), expected, `frozen input changed: ${path}`);
    const native = JSON.parse(readFileSync(join(historical, "frozen/native.json")));
    report.streamNativePrerequisites = native.metadata.references.map(reference => {
      const entry = { ...reference };
      try {
        entry.actualSha256 = sha256(readFileSync(reference.path));
        if (entry.actualSha256 !== reference.sha256) issues.push({ kind: "stream-native-identity", ...entry });
      } catch (error) { issues.push({ kind: "stream-native-unavailable", path: reference.path, code: error.code }); }
      return entry;
    });
    if (process.platform !== native.metadata.platform || process.arch !== native.metadata.arch) issues.push({ kind: "stream-native-host", expected: [native.metadata.platform, native.metadata.arch], actual: [process.platform, process.arch] });
    if (!issues.length) {
      const os = run("/usr/bin/sw_vers", [], report.root);
      if (os.status !== 0 || Buffer.from(os.stdout).toString("base64") !== native.metadata.os.stdout) issues.push({ kind: "stream-os-profile", os });
      const locales = run("/usr/bin/locale", ["-a"], report.root);
      if (locales.status !== 0 || !["C", "en_US.UTF-8"].every(locale => locales.stdout.split("\n").includes(locale))) issues.push({ kind: "stream-locales", locales });
    }
    if (!issues.length) {
      report.fixtureAuthority = fixtureAuthority(report, primary);
      issues.push(...report.fixtureAuthority.issues);
    }
    if (issues.length) unavailable(issues);
    else {
      report.setup = { status: "setup-qualified", executedTests: 0, issues: [] };
      const copied = [];
      for (const asset of setup.assets) {
        if (asset.path === canonical.benchmarkStat) continue;
        const suffix = relative(dirname(primary), asset.path);
        assert.ok(!suffix.startsWith(".."), "asset outside explicit primary tree");
        const destination = join(report.root, "tests/commands/metadata-stress/.oracle", suffix);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(asset.path, destination);
        assert.equal(sha256(readFileSync(destination)), asset.sha256);
        assert.equal(statSync(destination).mode & 0o111, statSync(asset.path).mode & 0o111);
        copied.push({ source: asset.path, destination, sha256: asset.sha256 });
      }
      assert.equal(copied.length, 14);
      report.nativeOverlay = copied;
      json(join(report.directory, "native-overlay.json"), copied);
      const archivedSetup = canonical.verifySetup();
      report.archivedSetup = archivedSetup;
      assert.equal(archivedSetup.status, "setup-qualified", JSON.stringify(archivedSetup.issues));
      report.archiveOverlay = stageArchiveTar(report, report.archiveSetup);
      canonical.environment.TMPDIR = report.fixtureAuthority.TMPDIR;
      const nativeEnvironment = { ...environment, TMPDIR: report.fixtureAuthority.TMPDIR };
      if (!options["--check-only"]) {
        try { currentConsumers(report, { peerArtifact: options["--peer-tarball"] }); }
        catch (error) { if (error.exitCode === 78) throw error; report.currentConsumerFailure = error.stack; }
        const archive = step(report, "current-archive-tests", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", ...archiveTests], report.root, { env: nativeEnvironment });
        report.archive = { tests: archiveTests.map(path => ({ path, sha256: sha256(readFileSync(join(report.root, path))) })), counts: Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(archive.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)])) };
        assert.deepEqual(report.archive.counts, { tests: 11, pass: 11, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
        json(join(report.directory, "current-archive-result.json"), report.archive);
        const sourceProfile = { kind: "committed-current-source", sourceCommit: report.sourceCommit, sources: report.sources, sourceTreeSha256: report.sourceTreeSha256 };
        json(join(report.directory, "current-metadata-profile.json"), sourceProfile);
        const metadata = canonical.runRelease({ sourceProfile });
        json(join(report.directory, "mandatory-metadata.json"), metadata);
        report.metadata = { exitCode: metadata.exitCode, counts: metadata.counts, nativeRowsPassed: metadata.nativeRows?.filter(row => row.passed).length, unchanged: metadata.unchanged };
        assert.equal(metadata.exitCode, 0, "mandatory native metadata/table verification failed");
        const profile = currentProfile(readFileSync(join(historical, "independent.review.ts")));
        json(join(report.directory, "current-profile.json"), profile);
        const author = join(report.root, "tests/plugins/stream-five-public");
        writeFileSync(join(author, "current.review.ts"), profile.source);
        const configuration = { extends: "../../../tsconfig.json", compilerOptions: { rootDir: "../../..", outDir: "./emitted", declaration: false, sourceMap: false }, include: ["current.review.ts"], exclude: ["emitted", "node_modules"] };
        json(join(author, "tsconfig.current.json"), configuration);
        step(report, "current-stream-compile", process.execPath, [join(report.root, "node_modules/typescript/bin/tsc"), "-p", join(author, "tsconfig.current.json")]);
        const output = join(historical, ".private/current-public");
        mkdirSync(output, { recursive: true });
        step(report, "current-stream-execution", process.execPath, ["--unhandled-rejections=strict", "--test", "--test-concurrency=1", join(author, "emitted/tests/plugins/stream-five-public/current.review.js")], report.root, { env: { ...nativeEnvironment, STREAM_NEXT_REVIEW_OUTPUT: output, STREAM_NEXT_REVIEW_FROZEN: join(historical, "frozen/native.json") } });
        assert.equal(sha256(readFileSync(join(historical, "strong-diagnostics.mjs"))), "a0a573ac0d7f5ccbfd40b26a0efaf967533a2d02a9e9a65dfccaa4289f12e40c");
        step(report, "current-stream-diagnostics", process.execPath, [join(historical, "strong-diagnostics.mjs"), join(output, "results.json"), join(output, "diagnostics.json"), join(historical, "evidence/final/release.json")]);
        const results = JSON.parse(readFileSync(join(output, "results.json")));
        const diagnostics = JSON.parse(readFileSync(join(output, "diagnostics.json")));
        assert.equal(results.summary.distinctPrimaryInputs, 82);
        assert.equal(results.summary.primary.executions, 164);
        assert.equal(diagnostics.summary.strengthened, 164);
        assert.ok(diagnostics.summary.strict >= 124, "strict outcomes regressed from the preserved profile");
        json(join(report.directory, "current-stream-results.json"), results);
        json(join(report.directory, "current-stream-diagnostics-result.json"), diagnostics);
        report.stream = { summary: results.summary, diagnosticSummary: diagnostics.summary, originalHarnessSha256: profile.originalSha256, currentHarnessSha256: profile.currentSha256, frozenManifest };
        publicChecks(report, { peerArtifact: options["--peer-tarball"] });
        assert.equal(report.currentConsumerFailure, undefined, "mandatory current consumers failed; independent later phases do not waive this failure");
      }
      report.testsUnchanged = unchangedTests(report);
      assert.equal(report.testsUnchanged, true, "candidate test bytes changed");
      finish(report, 0);
    }
  }
} catch (error) {
  finish(report, error.exitCode === 78 ? 78 : 1, error);
}
