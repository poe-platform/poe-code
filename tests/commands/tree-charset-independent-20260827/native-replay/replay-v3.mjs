import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CHILD_BYTES = 256 * 1024;
const CHILD_DEADLINE_MS = 5000;

function parseArguments() {
  const values = Object.create(null);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument at ${index}`);
    values[key.slice(2)] = resolve(value);
  }
  for (const key of ["freeze", "source-root", "installed-root", "output"]) {
    if (!values[key]) throw new Error(`missing --${key}`);
  }
  return { ...values, sourceRoot: values["source-root"], installedRoot: values["installed-root"] };
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function spawnBounded(command, args, cwd) {
  return await new Promise(resolveClose => {
    const child = spawn(command, args, {
      cwd,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let capExceeded = null;
    let deadlineExceeded = false;
    let spawnError = null;
    const collect = streamName => chunk => {
      sizes[streamName] += chunk.length;
      if (sizes[streamName] > MAX_CHILD_BYTES) {
        capExceeded ??= streamName;
        child.kill("SIGKILL");
        return;
      }
      output[streamName].push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", error => { spawnError = String(error?.stack ?? error); });
    const timer = setTimeout(() => {
      deadlineExceeded = true;
      child.kill("SIGKILL");
    }, CHILD_DEADLINE_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveClose({
        closeEventObserved: true,
        close: { code, signal },
        deadlineExceeded,
        capExceeded,
        spawnError,
        stdout: Buffer.concat(output.stdout),
        stderr: Buffer.concat(output.stderr),
      });
    });
  });
}

function classify(caseRecord, virtual) {
  const nativeStdout = Buffer.from(caseRecord.nativeStdoutBase64, "base64");
  const actualStdout = Buffer.from(virtual.invocation.stdoutBase64, "base64");
  const literalMatch = virtual.invocation.exitCode === 0
    && virtual.invocation.stderrBytes === 0
    && actualStdout.equals(nativeStdout);
  if (caseRecord.classification === "native-parity-literal") {
    return { assertion: "literal-native-parity", literalMatch, pass: literalMatch };
  }
  const expectedDivergence = [
    "native_lowercase_dot_utf8_locale",
    "empty_cli_charset_over_tree_and_locale_utf8",
    "unknown_cli_charset_over_tree_and_locale_utf8",
  ].includes(caseRecord.id);
  return {
    assertion: "native-only-observation-no-retroactive-parity",
    literalMatch,
    expectedContractRelation: expectedDivergence ? "diverge-from-native" : "same-as-native",
    contractOutcomeObserved: expectedDivergence ? !literalMatch : literalMatch,
    pass: true,
  };
}

async function main() {
  const options = parseArguments();
  const freeze = JSON.parse(await readFile(options.freeze, "utf8"));
  await mkdir(options.output, { recursive: false });
  const rawDirectory = join(options.output, "raw-children");
  await mkdir(rawDirectory);

  const scriptDirectory = dirname(new URL(import.meta.url).pathname);
  const installedConsumer = join(options.installedRoot, "replay-consumer-v2.mjs");
  const installedCore = join(options.installedRoot, "worker-core-v2.mjs");
  await copyFile(join(scriptDirectory, "installed-consumer-v2.mjs"), installedConsumer);
  await copyFile(join(scriptDirectory, "worker-core-v2.mjs"), installedCore);

  const sourceEntry = pathToFileURL(join(options.sourceRoot, "dist/index.js")).href;
  const sourceTree = pathToFileURL(join(options.sourceRoot, "dist/commands/tree/index.js")).href;
  const sourceConsumer = join(scriptDirectory, "source-consumer-v2.mjs");
  const boundaries = [
    { name: "source-build", cwd: options.sourceRoot, script: sourceConsumer, extra: [sourceEntry, sourceTree] },
    { name: "installed-package", cwd: options.installedRoot, script: installedConsumer, extra: [] },
  ];
  const records = [];
  for (const boundary of boundaries) {
    for (const frozenCase of freeze.cases) {
      const caseRecord = {
        ...frozenCase,
        nativeStdoutBase64: freeze.rawArtifacts[frozenCase.stdout].base64,
      };
      const encoded = Buffer.from(JSON.stringify(caseRecord)).toString("base64");
      const child = await spawnBounded(process.execPath, [boundary.script, encoded, ...boundary.extra], boundary.cwd);
      const stem = `${boundary.name}--${frozenCase.id}`;
      await writeFile(join(rawDirectory, `${stem}.stdout`), child.stdout);
      await writeFile(join(rawDirectory, `${stem}.stderr`), child.stderr);
      let virtual = null;
      let parseError = null;
      try { virtual = JSON.parse(child.stdout.toString("utf8")); }
      catch (error) { parseError = String(error?.stack ?? error); }
      records.push({
        boundary: boundary.name,
        caseId: frozenCase.id,
        frozenClassification: frozenCase.classification,
        frozenNative: {
          exitCode: freeze.commonObservedResult.close.code,
          stdoutLabel: frozenCase.stdout,
          stdoutBase64: freeze.rawArtifacts[frozenCase.stdout].base64,
          stderrBase64: freeze.rawArtifacts.stderr.base64,
        },
        child: {
          closeEventObserved: child.closeEventObserved,
          close: child.close,
          deadlineExceeded: child.deadlineExceeded,
          capExceeded: child.capExceeded,
          spawnError: child.spawnError,
          stdoutBytes: child.stdout.length,
          stdoutSha256: sha256(child.stdout),
          stderrBytes: child.stderr.length,
          stderrSha256: sha256(child.stderr),
        },
        parseError,
        virtual,
        outcome: virtual ? classify(caseRecord, virtual) : { pass: false, assertion: "child-result-unavailable" },
      });
    }
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: {
      version: "v3",
      childDeadlineMilliseconds: CHILD_DEADLINE_MS,
      childStdoutAndStderrByteCap: MAX_CHILD_BYTES,
      childEnvironment: { PATH: "/usr/bin:/bin" },
      stdin: "ignored",
      node: { path: process.execPath, version: process.version },
    },
    freeze: {
      commit: "55bd112804564605e397d3ee9948226d89efd457",
      capturedAt: freeze.capturedAt,
      chronology: freeze.chronology,
      candidate: freeze.candidateMetadataOnly.commit,
      oracleSha256: freeze.oracle.sha256,
      caseCount: freeze.cases.length,
      literalCaseCount: freeze.cases.filter(item => item.classification === "native-parity-literal").length,
      observationalCaseCount: freeze.cases.filter(item => item.classification !== "native-parity-literal").length,
    },
    runtimeInputs: {
      sourceRoot: options.sourceRoot,
      installedRoot: options.installedRoot,
      freezePath: options.freeze,
      copiedInstalledConsumer: installedConsumer,
    },
    totals: {
      children: records.length,
      closeEventsObserved: records.filter(item => item.child.closeEventObserved).length,
      cleanChildExits: records.filter(item => item.child.close.code === 0 && item.child.close.signal === null).length,
      deadlineExceeded: records.filter(item => item.child.deadlineExceeded).length,
      capExceeded: records.filter(item => item.child.capExceeded !== null).length,
      literalAssertions: records.filter(item => item.outcome.assertion === "literal-native-parity").length,
      literalPasses: records.filter(item => item.outcome.assertion === "literal-native-parity" && item.outcome.pass).length,
      observationalRuns: records.filter(item => item.outcome.assertion === "native-only-observation-no-retroactive-parity").length,
      observationalNativeMatches: records.filter(item => item.outcome.assertion === "native-only-observation-no-retroactive-parity" && item.outcome.literalMatch).length,
      observationalNativeDivergences: records.filter(item => item.outcome.assertion === "native-only-observation-no-retroactive-parity" && !item.outcome.literalMatch).length,
      contractOutcomesObserved: records.filter(item => item.outcome.contractOutcomeObserved === true).length,
    },
    records,
  };
  await writeFile(join(options.output, "replay-results.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary.totals)}\n`);
  if (summary.totals.literalPasses !== summary.totals.literalAssertions
      || summary.totals.closeEventsObserved !== summary.totals.children
      || summary.totals.cleanChildExits !== summary.totals.children
      || summary.totals.deadlineExceeded !== 0
      || summary.totals.capExceeded !== 0) process.exitCode = 1;
}

await main();
