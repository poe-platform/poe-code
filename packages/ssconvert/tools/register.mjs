import fs from 'node:fs';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const path = 'docs/ssconvert/coverage.json';
const bytes = fs.readFileSync(path), census = JSON.parse(bytes);
const entries = [];
function add(category, id, source, requirements = ['exact']) {
  entries.push({ id: category + ':' + id, category, source, requirements, state: 'unmeasured' });
}
for (const x of census.cliOptionDescriptors) {
  for (const form of ['separate', 'equals', 'empty', 'missing', 'repeat', 'after-operand', 'before-help', 'after-help', 'before-version', 'conflict'])
    add('option', `${x.group}:${x.name}:${form}`, x.source);
  if (x.shortOptionExpression !== '0') {
    for (const form of ['separate', 'cluster', 'attached', 'equals', 'missing', 'cluster-help', 'cluster-value-conflict'])
      add('short-option', `${x.group}:${x.name}:${form}`, x.source);
  }
}
for (const form of ['double-dash', 'consumed-double-dash', 'lone-dash', 'invalid-utf8-option', 'invalid-utf8-operand', 'nul', 'unknown-long', 'unknown-short', 'abbreviation', 'operand-count', 'split-merge-conflict'])
  add('parser', form, 'src/ssconvert.c and captured GLib profile');
const actions = ['help', 'library-version', 'version', 'list-exporters', 'list-importers', 'list-image-formats', 'clipboard', 'merge', 'convert'];
for (const first of actions) for (const second of actions) if (first !== second)
  add('action-precedence', `${first}:${second}`, 'src/ssconvert.c and captured GLib profile');
for (const name of [...census.parserGeneratedOptions.profileContract.acceptedHelp, ...census.parserGeneratedOptions.profileContract.rejectedHelp]) add('help', name, 'GLib profile');
for (const x of census.cliOptionDescriptors.filter(x => x.group !== 'main')) {
  for (let n = 1; n <= x.group.length; n++) add('group-alias', `${x.group.slice(0, n)}-${x.name}`, x.source);
}
for (const x of census.services.filter(x => !x.interactiveOnly && ['file_opener', 'file_saver'].includes(x.type)))
  add(x.type, x.id, x.source, ['exact', 'semantic', 'roundTrip', 'interoperability']);
for (const x of census.services.filter(x => x.type === 'solver'))
  add('solver', x.id, x.source, ['exact', 'property-errors', 'cancellation', 'semantic']);
for (const [kind, items] of [['function-manifest', census.manifestFunctions], ['function-descriptor', census.functionDescriptors]]) {
  for (const x of items) add(kind, `${x.source.path}:${x.source.line}:${x.name}`, x.source, ['exact', 'argument-errors', 'recalculation', 'cache', 'serialization']);
}
for (const x of census.properties) add('property', `${x.source.path}:${x.source.line}:${x.classInit}:${x.name}`, x.source, ['exact', 'semantic', 'roundTrip']);
for (const x of census.analysisTools) add('analysis', x.name, x.source, ['exact', 'property-errors', 'ordering', 'semantic']);
for (const profile of ['ooxml-transitional', 'ooxml-strict', 'odf-extended', 'odf-strict', 'biff7', 'biff8'])
  add('workbook-profile', profile, 'format source census', ['exact', 'semantic', 'roundTrip', 'interoperability', 'formulas', 'caches', 'styles', 'namespaces', 'warnings']);
for (const target of ['pdf', 'ps', 'svg', 'png', 'jpeg', 'emf', 'wmf', 'eps', 'bmp', 'ico', 'tiff', 'ani', 'gif', 'icns', 'pnm', 'qtif', 'tga', 'xbm', 'xpm'])
  add('print-chart', target, 'GOffice and GdkPixbuf profile', ['exact', 'semantic', 'interoperability']);
for (const x of census.upstreamTests) add('upstream-research', x.path, { path: x.path, sha256: x.sha256 }, ['research-execution', 'original-differential']);
const ids = entries.map(x => x.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate census IDs');
const register = { kind: 'ssconvert-canonical-differential-register', version: 1, source: census.source,
  census: { path, sha256: hash(bytes) },
  profile: { path: 'docs/ssconvert/canonical-reference-profile.json', sha256: hash(fs.readFileSync('docs/ssconvert/canonical-reference-profile.json')) },
  status: 'incomplete-no-native-parity-passes', normalizations: [], denominator: entries.length,
  categories: Object.fromEntries([...new Set(entries.map(x => x.category))].map(k => [k, entries.filter(x => x.category === k).length])), entries };
fs.writeFileSync('docs/ssconvert/canonical-differential-register.json', JSON.stringify(register, null, 2) + '\n');
console.log(JSON.stringify({ denominator: register.denominator, categories: register.categories }));
