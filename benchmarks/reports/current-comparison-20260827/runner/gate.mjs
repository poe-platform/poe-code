import { createHash } from "node:crypto";

export const schema = "safe-bash.comparison-preflight.v2";
export const historicalRoles = Object.freeze(["cohortPlan", "runnerSourceManifest"]);
export const requiredRoles = Object.freeze([
  "candidateFreeze", "canonicalInventory", "inventoryReview", "packManifest",
  "packedReview", "baselineAuthentication", "dependencyClosure", "nativeProfile",
  "cohortPlan", "executionProfile", "budgetProfile", "runnerSourceManifest",
]);
export const readCaps = Object.freeze({
  manifestBytes: 1024 * 1024,
  receiptBytes: 16384,
  artifactBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
  files: 8192,
});
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const demand = (condition, reason) => { if (!condition) throw new Error(reason); };

export function report(status, reasons = [], extra = {}) {
  return {
    schema, mode: "PREPARATION_ONLY", status, reasons,
    executorPresent: false, executionEnabled: false, timingEnabled: false,
    engineCalls: 0, nativeWorkloadCalls: 0, childProcessesCreated: 0,
    loopbackServersCreated: 0, performanceSamples: 0, score: null,
    qualification: "Static preparation only; no candidate qualification or runtime proof.",
    ...extra,
  };
}

export function preparation() {
  return report("WAITING_ROOT", ["No hash-bound ROOT preparation coordination receipt supplied."], {
    candidateRoles: requiredRoles, historicalRoles, requiredArguments: [
      "manifest", "root-receipt", "root-receipt-sha256",
    ],
    currentAuthorization: "PREPARE/PREFLIGHT and pure mock checks only",
    artifactReadCaps: readCaps,
  });
}

function parseJson(bytes, cap, label) {
  demand(bytes instanceof Uint8Array && bytes.byteLength <= cap, `${label}: byte cap or input type`);
  const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  demand(isObject(result), `${label}: expected an object`);
  return result;
}

function validateManifest(manifest) {
  demand(manifest.schema === schema && manifest.mode === "PREPARATION_ONLY", "manifest schema/mode");
  demand(manifest.executionEnabled === false && manifest.timingEnabled === false, "execution/timing flags must remain false");
  demand(["historical-preparation", "candidate-preparation"].includes(manifest.scope), "explicit preparation scope required");
  const candidateBound = manifest.scope === "candidate-preparation";
  if (candidateBound) {
    demand(isObject(manifest.candidate), "missing candidate freeze binding");
    demand(commitPattern.test(manifest.candidate.commit), "candidate commit must be exact");
    demand(digestPattern.test(manifest.candidate.sourceTreeSha256), "candidate tree hash must be exact");
    demand(manifest.candidate.state === "FUTURE_ROOT_FROZEN", "candidate is not a future ROOT freeze");
  } else {
    demand(manifest.candidate === undefined || manifest.candidate === null, "historical preparation cannot qualify a candidate");
    demand(manifest.reviews === undefined || (isObject(manifest.reviews) && Object.keys(manifest.reviews).length === 0), "candidate reviews require candidate-preparation scope");
  }
  demand(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0 && manifest.artifacts.length <= readCaps.files, "artifact count");
  const artifacts = new Map();
  const paths = new Set();
  let total = 0;
  for (const artifact of manifest.artifacts) {
    demand(isObject(artifact) && identifierPattern.test(artifact.id), "invalid artifact identifier");
    demand(!artifacts.has(artifact.id), `duplicate artifact: ${artifact.id}`);
    demand(typeof artifact.path === "string" && artifact.path.length > 0 && artifact.path.length <= 4096 && !artifact.path.includes("\0"), "artifact path");
    demand(!paths.has(artifact.path), "duplicate artifact path");
    demand(digestPattern.test(artifact.sha256), `artifact digest: ${artifact.id}`);
    demand(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0 && artifact.bytes <= readCaps.artifactBytes, "artifact byte cap");
    total += artifact.bytes;
    demand(total <= readCaps.totalBytes, "aggregate artifact byte cap");
    artifacts.set(artifact.id, artifact);
    paths.add(artifact.path);
  }
  const resolveArtifact = identifier => {
    demand(typeof identifier === "string" && artifacts.has(identifier), `unbound artifact: ${identifier}`);
    return artifacts.get(identifier);
  };
  const referenceIdentity = reference => {
    if (typeof reference === "string") {
      resolveArtifact(reference);
      return JSON.stringify([reference, "", null]);
    }
    demand(isObject(reference), "invalid data reference");
    resolveArtifact(reference.artifact);
    demand(typeof reference.pointer === "string" && reference.pointer.length <= 2048 && (reference.pointer === "" || reference.pointer.startsWith("/")) && !/~(?:[^01]|$)/u.test(reference.pointer), "invalid JSON pointer");
    demand(reference.rowField === undefined || identifierPattern.test(reference.rowField), "invalid row selector");
    return JSON.stringify([reference.artifact, reference.pointer, reference.rowField ?? null]);
  };
  demand(isObject(manifest.roles), "missing role bindings");
  for (const role of candidateBound ? requiredRoles : historicalRoles) referenceIdentity(manifest.roles[role]);
  const roleDocuments = new Map();
  const roleReferences = new Set();
  for (const [role, reference] of Object.entries(manifest.roles)) {
    demand(requiredRoles.includes(role), `unknown evidence role: ${role}`);
    const identity = referenceIdentity(reference);
    demand(!roleReferences.has(identity), "shared evidence roles require distinct explicit selectors");
    roleReferences.add(identity);
    const identifier = typeof reference === "string" ? reference : reference.artifact;
    const references = roleDocuments.get(identifier) ?? [];
    references.push(reference);
    roleDocuments.set(identifier, references);
  }
  for (const references of roleDocuments.values()) {
    if (references.length > 1) demand(references.every(reference => isObject(reference) && (reference.pointer !== "" || reference.rowField !== undefined)), "shared role document needs explicit selectors");
  }
  if (candidateBound) {
    demand(isObject(manifest.reviews), "missing independent review bindings");
    const reviewers = new Set();
    const packReference = manifest.roles.packManifest;
    const packArtifact = resolveArtifact(typeof packReference === "string" ? packReference : packReference.artifact);
    for (const role of ["inventoryReview", "packedReview"]) {
      const review = manifest.reviews[role];
      demand(isObject(review) && referenceIdentity(review.artifact) === referenceIdentity(manifest.roles[role]) && review.decision === "ACCEPT", `${role}: missing acceptance`);
      demand(typeof review.reviewer === "string" && review.reviewer.trim().length > 0, `${role}: missing reviewer`);
      demand(review.sourceTreeSha256 === manifest.candidate.sourceTreeSha256, `${role}: stale candidate`);
      demand(review.packManifestSha256 === packArtifact.sha256, `${role}: stale pack manifest`);
      reviewers.add(review.reviewer.trim());
    }
    demand(reviewers.size === 2, "inventory and packed reviews must name different reviewers");
  }
  const engines = manifest.engines ?? [];
  demand(Array.isArray(engines) && (engines.length === 2 || (!candidateBound && engines.length === 0)), "candidate preparation requires exactly two engine declarations");
  if (engines.length) demand(JSON.stringify(engines.map(engine => engine.id).sort()) === JSON.stringify(["just-bash", "virtual-bash"]), "engine identities");
  for (const engine of engines) {
    for (const field of ["entry", "packageManifest", "setup", "dispatchInventory", "resolutionReceipt"]) resolveArtifact(engine[field]);
    demand(Array.isArray(engine.locks) && engine.locks.length > 0, "missing engine lock hashes");
    for (const identifier of engine.locks) resolveArtifact(identifier);
    demand(engine.id !== "just-bash" || engine.version === "3.4.2", "baseline version differs from authenticated historical pin");
  }
  demand(Array.isArray(manifest.cohorts) && manifest.cohorts.length > 0 && manifest.cohorts.length <= 4, "select one to four preparation cohorts");
  const cohorts = new Map(manifest.cohorts.map(cohort => [cohort.id, cohort]));
  demand(cohorts.size === manifest.cohorts.length, "duplicate cohort identifiers");
  for (const identifier of cohorts.keys()) demand(["expanded-original-224", "expanded-aligned-224", "baseline-only", "new-tool-holdouts"].includes(identifier), `unknown cohort: ${identifier}`);
  for (const cohort of cohorts.values()) {
    demand(Number.isSafeInteger(cohort.recipeCount) && cohort.recipeCount > 0, "undeclared recipe denominator");
    demand(Number.isSafeInteger(cohort.diagnosticCount) && cohort.diagnosticCount >= 0, "undeclared diagnostic denominator");
    for (const field of ["recipes", "profile", "predicate", "overlapMap"]) referenceIdentity(cohort[field]);
    if (cohort.id !== "new-tool-holdouts" || cohort.expectations !== null) referenceIdentity(cohort.expectations);
  }
  const original = cohorts.get("expanded-original-224");
  const aligned = cohorts.get("expanded-aligned-224");
  for (const cohort of [original, aligned].filter(Boolean)) demand(cohort.recipeCount === 224 && cohort.diagnosticCount === 0, "unchanged 224 denominator required");
  if (original && aligned) {
    demand(referenceIdentity(original.recipes) === referenceIdentity(aligned.recipes), "224 profiles must reference identical ordered recipe bytes");
    demand(referenceIdentity(original.predicate) === referenceIdentity(aligned.predicate), "224 comparison predicates must remain identical");
    demand(referenceIdentity(original.profile) !== referenceIdentity(aligned.profile) && referenceIdentity(original.expectations) !== referenceIdentity(aligned.expectations), "TMPDIR profiles and native captures must stay separate");
  }
  const breadth = cohorts.get("baseline-only");
  if (breadth) demand(breadth.recipeCount === 61 && breadth.diagnosticCount === 7, "preserve historical breadth recipes/diagnostics separately");
  demand(manifest.unionScore === null, "no score union across overlapping cohorts");
  return artifacts;
}

export async function preflight(inputs) {
  const required = ["manifestBytes", "rootReceiptBytes", "rootReceiptSha256"];
  const missing = required.filter(field => inputs[field] === undefined || inputs[field] === null);
  if (missing.length) return report("WAITING_ROOT", missing.map(field => `Missing ROOT input: ${field}`));
  const receipts = [];
  try {
    const manifest = parseJson(inputs.manifestBytes, readCaps.manifestBytes, "manifest");
    if (manifest.scope === "candidate-preparation" && (manifest.candidate === undefined || manifest.candidate === null)) return report("WAITING_ROOT", ["Missing ROOT candidate freeze binding for candidate preparation."]);
    const artifacts = validateManifest(manifest);
    demand(inputs.rootReceiptBytes instanceof Uint8Array && inputs.rootReceiptBytes.byteLength <= readCaps.receiptBytes, "ROOT receipt byte cap or input type");
    demand(digestPattern.test(inputs.rootReceiptSha256) && sha256(inputs.rootReceiptBytes) === inputs.rootReceiptSha256, "ROOT preparation receipt hash mismatch");
    const coordination = parseJson(inputs.rootReceiptBytes, readCaps.receiptBytes, "ROOT receipt");
    demand(coordination.schema === "safe-bash.root-preparation-receipt.v1" && coordination.authority === "ROOT", "ROOT coordination receipt identity");
    demand(coordination.purpose === "PREPARATION_ONLY" && coordination.executionAuthorized === false && coordination.timingAuthorized === false, "receipt must be preparation-only, not execution approval");
    demand(coordination.manifestSha256 === sha256(inputs.manifestBytes), "receipt binds a different manifest");
    demand(typeof inputs.inspectArtifact === "function", "missing bounded artifact reader");
    const canonicalPaths = new Set();
    for (const artifact of artifacts.values()) {
      const receipt = await inputs.inspectArtifact(artifact);
      demand(receipt.bytes === artifact.bytes && receipt.sha256 === artifact.sha256, `artifact changed: ${artifact.id}`);
      demand(typeof receipt.resolvedPath === "string" && !canonicalPaths.has(receipt.resolvedPath), "aliased artifact path");
      canonicalPaths.add(receipt.resolvedPath);
      receipts.push({ id: artifact.id, ...receipt });
    }
    return report("PREPARED_EXECUTION_DISABLED", [], {
      manifestSha256: sha256(inputs.manifestBytes), rootReceiptSha256: inputs.rootReceiptSha256, artifactReceipts: receipts,
      selectedCohorts: manifest.cohorts.map(cohort => cohort.id),
      uncapturedExpectations: manifest.cohorts.filter(cohort => cohort.expectations === null).map(cohort => cohort.id),
      semanticGate: "Hash-bound ROOT coordination receipt under trusted-host authority; selectors, document content and candidate inventory NOT independently qualified by this reader.",
      nextGate: "A separately reviewed, ROOT-authorized executor is not implemented here.",
    });
  } catch (error) {
    return report(error.code === "ENOENT" ? "WAITING_ROOT" : "FAIL_PREFLIGHT", [String(error.message ?? error)], { artifactReceipts: receipts });
  }
}
