import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha } from './prepare.mjs';
const rawBytes = await fs.readFile(path.join(own, 'results-v2/RAW.json.gz.base64'));
assert.equal(sha(rawBytes), 'c3aa985119d594531217bd29d2f323ff7a3450c2904ee648a56ef85a18aaefda');
const raw = JSON.parse(gunzipSync(Buffer.from(rawBytes.toString().trim(), 'base64'), { maxOutputLength: 134217728 }));
const result = raw.result;
assert.equal(result.status, 'AUTHOR_SCOPED_PASS');
const formatBytes = await fs.readFile(path.join(repo, 'tests/commands/git-pack-independent-20260828/format/CASE-COVERAGE.json'));
const resourceBytes = await fs.readFile(path.join(repo, 'tests/commands/git-pack-independent-20260828/resources/CASE-MATRIX.json'));
const format = JSON.parse(formatBytes), resources = JSON.parse(resourceBytes);
const workflow = prefix => Array.from({ length: 6 }, (_, index) => `${prefix}-workflow-${index + 1}`);
const observed = names => names.map(id => {
  const rows = result.cohorts.filter(row => row.label.endsWith('-packs')).map(cohort => { const row = cohort.cases.find(row => row.id === id); assert.ok(row && row.status === 'PASS', id); return { layout: cohort.label, case: row.id, status: row.status }; });
  assert.equal(rows.length, 3); return { id, observations: rows };
});
const formatNames = [
  workflow('P01'), workflow('P02'), ['P10', 'empty-direct'], ['N10'], ['N11'], [], ['P06', 'P07'], ['minimum-0', 'minimum-1', 'minimum-2', 'minimum-3'], ['zero-result-four'], ['D02', 'D03'], ['P03'], ['N12', 'N13'], ['P04', 'P05', 'P06'], ['N14', 'ref-external-loose-base'], ['ref-cycle', 'P05'], ['P06'], ['P07'], ['P08'], ['P09', 'D01'], ['D02', 'D03'], ['N01', 'N02', 'N03'], ['N04'], ['N05', 'N06'], ['N07', 'N08'], ['P11'], ['idx-n1-l1'], ['idx-n0-slot'], ['N09', 'stat-33554433'], ['truncated', 'declared-short'], ['N15', 'second-member'], ['object-hash'], ['P12', 'P13'], ['D01'], ['object-hash'], ['N04'], ['duplicates-pinned', 'ref-external-loose-base'], ['nine-packs', 'sidecar-no-body-read', 'refuse-promisor'], ['borrowed-subarray', 'abort-null', 'reader-cleanup-identity'],
];
assert.equal(format.rows.length, 38); assert.equal(formatNames.length, 38);
const maps = {
  negative_fraction_NaN_Infinity_stat: ['stat--1', 'stat-NaN', 'stat-Infinity'],
  prepublication_reread: ['pack-content-change'], program_plus_reconstructed_result: ['P06'], discarded_duplicate_output: ['duplicates-pinned'], inflated_ceiling_work_mask: ['cumulative-work-four-bodies'],
  base_program_result_coexist: ['P07'], pack_idx_tables_cache_coexist: ['P01'], duplicate_before_dedup: ['duplicates-pinned'],
  duplicate_OID_in_two_packs: ['duplicates-pinned'], same_OID_loose_plus_pack: ['P01'], repeated_directory_observation: ['sidecar-observable-change'],
  ninth_pair: ['nine-packs'], pack_size_C_plus_one: ['stat-33554433'], body_header_message_views: workflow('P01'), query_finishes_before_release: workflow('P02'), catalogue_repository_shared_owner: ['P01'],
  verified_duplicate_equal_body: ['duplicates-pinned'], depth0: ['P01'], depth32: ['P12'], depth33: ['P13'], cached_deep_base: ['P13'],
  same_pack_forward_REF: ['P05'], shared_DAG: ['P06'], two_location_cycle: ['ref-cycle'], base_only_loose: ['ref-external-loose-base'], blob_inheritance: ['P06'],
  reused_chunk_view: ['borrowed-subarray'], header_split: ['borrowed-subarray'], readFile_only_provider: ['readfile-fallback'], empty_chunk_count: ['empty-chunk-budget'], shared_chunk_count: ['empty-chunk-budget'],
  one_complete_member: ['P01'], trailing_byte_same_feed: ['N15'], second_member_same_feed: ['second-member'], truncated_footer: ['truncated'], malformed_member: ['N15'],
  declared_direct_size: ['declared-short'], declared_program_size: ['P06'], reconstructed_size: ['P07'], actual_output_overrun: ['declared-short'],
  abort_before_acquisition: ['preabort-no-read'], abort_during_read: ['abort-null', 'abort-false', 'abort-0', 'abort-abort'],
  stdout_consumer_close: ['preclosed-local-output'], sibling_scope_and_stderr_alive: ['preclosed-local-output'],
  pack_bytes_changed: ['pack-content-change'], type_or_size_changed: ['sidecar-observable-change'], metadata_only_valid: ['P01'], bad_unselected_payload: ['object-hash', 'D01'],
  exact_allowlisted_names: ['sidecar-rev', 'sidecar-bitmap', 'sidecar-keep', 'sidecar-mtimes', 'sidecar-objects/pack/multi-pack-index', 'sidecar-objects/info/packs', 'sidecar-objects/info/commit-graph'],
  symlink_or_nonregular: ['refuse-link'], promisor_or_unknown_name: ['refuse-promisor', 'refuse-unknown'], size_C_plus_one: ['sidecar-stat-cap'], observed_metadata_change: ['sidecar-observable-change'], same_observed_stat_body_change: ['sidecar-unobservable-body'], pinned_no_eviction: ['pinned-three-large-bodies'],
  six_original_workflows: [...workflow('P01'), ...workflow('P02')], separate_invocations_repeat_admission: workflow('P01'),
};
const resourceRows = resources.cases.map(row => ({ id: row.id, families: row.families, obligation: row.obligation, rowClosure: 'NOT_CLAIMED_COMPLETE', variants: row.variants.map(name => ({ name, status: maps[name] ? 'RELATED_ACTUAL_OBSERVATIONS_NOT_FULL_VARIANT_CLOSURE' : name === 'original_eviction_obligation_retained' ? 'OUT_OF_PROFILE_NO_EVICTION_NOT_PASSED' : 'NO_TARGETED_DYNAMIC_PROOF', relatedCases: observed(maps[name] ?? []) })) }));
const loads = [];
for (const cohort of result.cohorts) {
  const row = raw.files.find(row => row.name === cohort.label + '-loads.jsonl'); assert.ok(row?.base64);
  const values = Buffer.from(row.base64, 'base64').toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const bindings = raw.files.find(row => row.name === cohort.label + '-binding.json'); assert.ok(bindings?.base64);
  const binding = JSON.parse(Buffer.from(bindings.base64, 'base64'));
  for (const value of values) { const relative = path.relative(binding.root, value.file); const member = result.package.members.find(row => row.path === relative); assert.ok(member, relative); assert.equal(member.sha256, value.sha256); }
  loads.push({ cohort: cohort.label, observedLoadEvents: values.length, uniqueProductModules: new Set(values.map(row => row.file)).size, allMatchedFullPackage: true });
}
const report = { role: 'DATA_CROSSWALK_NO_NEW_PRODUCT_EXECUTION', candidate: result.source.computedTree, module: result.source.moduleCommit, rawSha256: sha(rawBytes), packageSha256: result.package.sha256, formatInputSha256: sha(formatBytes), resourceInputSha256: sha(resourceBytes), formatRows: format.rows.map((row, index) => ({ id: row.id, family: row.family, expected: row.expected, rowClosure: 'NOT_CLAIMED_COMPLETE', relatedCases: observed(formatNames[index]) })), resourceRows, resourceVariantCount: resourceRows.reduce((sum, row) => sum + row.variants.length, 0), loads, qualifications: ['Related examples are not full row/variant closure, event-count resource census, exact allocation telemetry or native proof.', 'Inflated/resident/read maxima masked by work/count remain source obligations; no cap override/counter injection.', 'Three pinned large-body success is not an owner-release or RSS proof; preclosed output is not an in-flight sibling/stderr proof.', 'Thirty-eight format and32 resource rows are different ledgers, not70 passes;108 resource variants are not108 executions.', 'H09 event289/288 is unqualified and not patched or inferred as a product leak.'] };
assert.equal(report.resourceRows.length, 32); assert.equal(report.resourceVariantCount, 108);
await fs.writeFile(path.join(own, 'COVERAGE-v2.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ formatRows: 38, resourceRows: 32, variants: report.resourceVariantCount, loads }));
