import { canonicalData, dataHash, ownRecord, projectData, requireFact, safePath, sha256 } from './own-data.mjs';

export async function ingestSourceArguments(input) {
  const supplied = ownRecord(input, ['candidate', 'manifest', 'origins', 'plan', 'bundle', 'allocation', 'readSource'], 'SOURCE_INPUT');
  requireFact(typeof supplied.readSource === 'function', 'SOURCE_READER');
  const { candidate, manifest, origins, plan, bundle, allocation } = projectData({ candidate: supplied.candidate, manifest: supplied.manifest, origins: supplied.origins, plan: supplied.plan, bundle: supplied.bundle, allocation: supplied.allocation });
  ownRecord(bundle, ['schema', 'candidate', 'sourceManifestSha256', 'originMapSha256', 'arguments'], 'SOURCE_BUNDLE');
  requireFact(typeof candidate === 'string' && /^[a-f0-9]{40}$/u.test(candidate) && bundle.schema === 1 && bundle.candidate === candidate && allocation.candidate === candidate, 'SOURCE_CANDIDATE');
  requireFact(bundle.sourceManifestSha256 === dataHash(manifest) && bundle.originMapSha256 === dataHash(origins), 'SOURCE_MAP_BINDING');
  requireFact(Array.isArray(origins) && origins.length === Object.keys(manifest.files).length && new Set(origins.map(row => row.path)).size === origins.length, 'SOURCE_ORIGIN_MEMBERSHIP');
  for (const origin of origins) {
    safePath(origin.path);
    const expected = manifest.files[origin.path];
    requireFact(expected && typeof origin.revision === 'string' && /^[a-f0-9]{40}$/u.test(origin.revision) && expected.sha256 === origin.sha256 && expected.bytes === origin.bytes && expected.mode === origin.mode, 'SOURCE_ORIGIN_IDENTITY');
  }
  requireFact(Array.isArray(plan.designated) && plan.designated.length <= 194 && new Set(plan.designated.map(row => row.id)).size === plan.designated.length, 'SOURCE_PLAN');
  requireFact(Array.isArray(bundle.arguments) && bundle.arguments.length <= 194, 'SOURCE_ARGUMENT_BOUND');
  const seenIds = new Set();
  const seenBindings = new Set();
  const records = new Map();
  for (const argument of bundle.arguments) {
    ownRecord(argument, ['id', 'recordId', 'bindingIds', 'fragmentIds', 'role', 'authority', 'dependencies', 'claims', 'qualification', 'observationRequirements'], 'SOURCE_ARGUMENT');
    requireFact(typeof argument.id === 'string' && !seenIds.has(argument.id) && !records.has(argument.recordId), 'SOURCE_DUPLICATE_ARGUMENT');
    requireFact(plan.designated.some(row => row.id === argument.recordId) && argument.role === 'source-static-counterproof', 'SOURCE_ARGUMENT_ROLE');
    requireFact(Array.isArray(argument.bindingIds) && argument.bindingIds.length > 0 && new Set(argument.bindingIds).size === argument.bindingIds.length, 'SOURCE_BINDING_IDS');
    for (const id of argument.bindingIds) {
      const row = allocation.gaps.find(entry => entry.id === id);
      requireFact(row && row.recordId === argument.recordId && row.primaryOwner === 'core' && !seenBindings.has(id), 'SOURCE_BINDING_ALLOCATION');
      seenBindings.add(id);
    }
    requireFact(Array.isArray(argument.fragmentIds) && new Set(argument.fragmentIds).size === argument.fragmentIds.length && argument.fragmentIds.every(id => allocation.fragments.some(row => row.id === id && row.recordId === argument.recordId)), 'SOURCE_FRAGMENT_LINK');
    const authority = ownRecord(argument.authority, ['commit', 'path', 'sha256', 'pointer', 'role'], 'SOURCE_AUTHORITY');
    requireFact(authority.role === 'independent-source-inspection' && typeof authority.pointer === 'string' && authority.pointer.startsWith('/') && allocation.routing.some(row => row.commit === authority.commit && row.path === authority.path && row.sha256 === authority.sha256), 'SOURCE_AUTHORITY_ENROLLMENT');
    requireFact(Array.isArray(argument.claims) && argument.claims.length > 0 && argument.qualification !== null && typeof argument.qualification === 'object' && Array.isArray(argument.observationRequirements), 'SOURCE_ARGUMENT_CONTENT');
    requireFact(Array.isArray(argument.dependencies) && argument.dependencies.length > 0 && argument.dependencies.length <= 64 && new Set(argument.dependencies.map(row => row.path)).size === argument.dependencies.length, 'SOURCE_DEPENDENCIES');
    const identities = [];
    for (const dependency of argument.dependencies) {
      ownRecord(dependency, ['path', 'revision', 'sha256', 'bytes', 'mode', 'spans'], 'SOURCE_DEPENDENCY');
      safePath(dependency.path);
      const expected = manifest.files[dependency.path];
      const origin = origins.find(row => row.path === dependency.path);
      requireFact(expected && origin && dependency.revision === origin.revision && dependency.sha256 === expected.sha256 && dependency.bytes === expected.bytes && dependency.mode === expected.mode, 'SOURCE_DEPENDENCY_BINDING');
      const bytes = await supplied.readSource(dependency.path);
      requireFact(ArrayBuffer.isView(bytes) && bytes.byteLength === bytes.length && bytes.length === expected.bytes && sha256(bytes) === expected.sha256, 'SOURCE_DEPENDENCY_BYTES');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      requireFact(text.endsWith('\n') && Array.isArray(dependency.spans) && dependency.spans.length > 0 && dependency.spans.length <= 128, 'SOURCE_SPANS');
      const lines = text.split('\n');
      const spanKeys = new Set();
      for (const span of dependency.spans) {
        ownRecord(span, ['startLine', 'endLine', 'sha256'], 'SOURCE_SPAN');
        requireFact(Number.isSafeInteger(span.startLine) && Number.isSafeInteger(span.endLine) && span.startLine >= 1 && span.endLine >= span.startLine && span.endLine < lines.length, 'SOURCE_SPAN_RANGE');
        const key = `${span.startLine}:${span.endLine}`;
        requireFact(!spanKeys.has(key), 'SOURCE_SPAN_DUPLICATE');
        spanKeys.add(key);
        const excerpt = lines.slice(span.startLine - 1, span.endLine).join('\n') + '\n';
        requireFact(sha256(excerpt) === span.sha256, 'SOURCE_SPAN_BYTES');
      }
      identities.push({ path: dependency.path, revision: dependency.revision, sha256: dependency.sha256, bytes: dependency.bytes, mode: dependency.mode, spans: dependency.spans });
    }
    seenIds.add(argument.id);
    records.set(argument.recordId, { id: argument.recordId, status: 'SOURCE_ARGUMENT_BOUND', argumentId: argument.id, argumentSha256: dataHash(argument), bindingIds: argument.bindingIds, fragmentIds: argument.fragmentIds, authority, identities, claims: argument.claims, qualification: argument.qualification, observationRequirements: argument.observationRequirements, runtimePrivateCounterProof: false, fullRecordPass: false });
  }
  const rows = plan.designated.map(record => records.get(record.id) ?? { id: record.id, status: 'UNRUN_SOURCE_ARGUMENT', bindingIds: [], required: record.required ?? null, runtimePrivateCounterProof: false, fullRecordPass: false });
  return projectData({ schema: 1, candidate, rows, boundArguments: records.size, boundSourceBindings: seenBindings.size, missingArguments: rows.length - records.size, status: records.size === rows.length ? 'SOURCE_ARGUMENTS_BOUND_ONLY' : 'INCOMPLETE', semanticPasses: 0, runtimeProofs: 0, independentAcceptance: false, argumentTruthClaim: false, canonicalBundleSha256: sha256(canonicalData(bundle)) });
}
