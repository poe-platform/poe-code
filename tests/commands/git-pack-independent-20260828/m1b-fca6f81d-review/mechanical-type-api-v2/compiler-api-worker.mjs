import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import { admitRequest, publish } from "./admission.mjs";
import { compilerOptions, createHost, createSnapshotView, loadCompiler, optionData, programIdentities, serializeDiagnostics } from "./compiler-host.mjs";
import { diagnosticsMatch, fixtureFor, sha256, validateResult } from "./protocol.mjs";
import { PINS } from "./pins.mjs";

export async function main(argv) {
  const admitted = admitRequest(argv);
  const { request } = admitted;
  const view = createSnapshotView(admitted);
  const started = process.hrtime.bigint();
  let rawPublished = false;
  let rawAttempted = false;
  let diagnostics = [];
  let diagnosticCount = 0;
  let sourceFiles = [];
  try {
    const compiler = loadCompiler(admitted, view);
    const options = compilerOptions(compiler, request.toolsRoot);
    const host = createHost(compiler, admitted, view);
    const program = compiler.createProgram({ rootNames: [admitted.fixturePath], options, host });
    const compilerDiagnostics = compiler.getPreEmitDiagnostics(program);
    diagnosticCount = compilerDiagnostics.length;
    diagnostics = serializeDiagnostics(compiler, compilerDiagnostics);
    sourceFiles = programIdentities(program, admitted);
    admitted.guardAfter();
    if (view.denied.length) throw new Error("Compiler attempted undeclared host operation");
    const fixture = {
      path: admitted.fixturePath, templateSha256: fixtureFor(request.fixtureId).sha256,
      bytes: admitted.fixtureBytes.length, sha256: sha256(admitted.fixtureBytes), subjectRoot: request.subjectRoot,
    };
    const compilerIdentity = { version: "5.9.3", sha256: PINS.compilerSha256, host: "ADMITTED_MEMORY_COMPILER_HOST", options: optionData(request.toolsRoot) };
    const rawData = {
      schema: "m1b-type-api-raw-v2", protocol: "TYPESCRIPT_COMPILER_API", fixtureId: request.fixtureId, layout: request.layout,
      compiler: compilerIdentity, fixture, diagnosticCount, diagnostics, sourceFiles,
      lookups: [...view.probes.values()], deniedOperations: view.denied,
      timing: { startedNs: String(started), completedNs: String(process.hrtime.bigint()) },
      guards: { before: true, after: true }, predicateEvaluated: false,
    };
    const rawBytes = Buffer.from(JSON.stringify(rawData) + "\n");
    if (rawBytes.length > 524288) {
      rawAttempted = true;
      publish(request.caseRoot, "type-api-raw.json", { schema: "m1b-type-api-overflow-v2", fullBytes: rawBytes.length, fullSha256: sha256(rawBytes), prefixBase64: rawBytes.subarray(0, 262144).toString("base64"), predicateEvaluated: false });
      rawPublished = true;
      throw new Error("Compiler diagnostic capture overflow");
    }
    rawAttempted = true;
    const raw = publish(request.caseRoot, "type-api-raw.json", rawData);
    rawPublished = true;
    const matched = diagnosticsMatch(request.fixtureId, admitted.fixturePath, request.subjectRoot, diagnostics);
    const result = validateResult({
      schema: "m1b-type-api-result-v2", protocol: "TYPESCRIPT_COMPILER_API", fixtureId: request.fixtureId, layout: request.layout,
      compiler: compilerIdentity, fixture, diagnostics, sourceFiles, raw,
      guards: { before: true, after: true }, completed: true, matched,
    });
    publish(request.caseRoot, "type-api-result.json", result);
    if (!matched) throw new Error("Exact type diagnostic predicate mismatch");
    return result;
  } catch (error) {
    if (!rawPublished && !rawAttempted) {
      const descriptor = error !== null && (typeof error === "object" || typeof error === "function") ? Object.getOwnPropertyDescriptor(error, "message") : undefined;
      try {
        publish(request.caseRoot, "type-api-raw.json", {
          schema: "m1b-type-api-exception-v2", fixtureId: request.fixtureId, layout: request.layout,
          thrownType: error === null ? "null" : typeof error,
          ownMessage: descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" ? descriptor.value.slice(0, 8192) : null,
          diagnosticCount, diagnostics, sourceFiles, deniedOperations: view.denied, predicateEvaluated: false,
        });
      } catch (captureError) {
        const fact = { schema: "m1b-type-api-capture-failure-v2", primaryType: error === null ? "null" : typeof error, captureErrorType: captureError === null ? "null" : typeof captureError };
        try { process.stderr.write(JSON.stringify(fact) + "\n"); } catch {}
      }
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main(process.argv.slice(2));
