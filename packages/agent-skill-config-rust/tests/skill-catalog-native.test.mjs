import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderSkillCatalog as reference} from '@poe-code/agent-skill-config/node';
import * as native from '../dist/index.js';

const file = (name, content = '', path = `/skills/${name}/SKILL.md`) => ({name, content, file: path});
const metadata = (name, value) => file(name, `---\n${value}\n---\nPRIVATE INSTRUCTIONS`);
function compare(files) {
  assert.equal(native.renderSkillCatalog(files), reference(files));
}

test('skill catalog is exported by the native package', () => {
  assert.equal(typeof native.renderSkillCatalog, 'function');
  assert.notEqual(native.renderSkillCatalog, reference);
});

test('catalog preserves exact metadata, XML escaping, UTF-16 and instruction boundaries', () => {
  for (const files of [[], [file('legacy', '# Private body')], [
    file('legacy', '# Private body'),
    file('a&b', '\uFEFF---\r\nname: \'quoted <name>\'\r\ndescription: >-\r\n  A "quoted"\r\n  description & more.\r\n---\r\nPRIVATE INSTRUCTIONS'),
    metadata('literal', 'description: |\n  One\n  Two'),
    file('  \uFEFFname\u00a0 ', '', '/skills/<>&"\'/\ud800'),
    metadata('surrogate', 'name: "\ud800"\ndescription: "\udfff"'),
    metadata('empty', ''), metadata('null', 'null'),
    metadata('own', '__proto__: {name: ignored}\ndescription: yes'),
    metadata('anchor', 'name: &name shared\ndescription: *name')
  ]]) compare(files);
});

test('catalog validates fields and retains valid skills after diagnostics', () => {
  for (const value of [
    'name: null', 'name: 1', 'name: " "', 'description: null', 'description: [one, two]',
    'disable-model-invocation: null', 'disable-model-invocation: "false"',
    '[one, two]', 'true', '!!set {one, two}', '!!omap [one: two]',
    'name: first\nname: second'
  ]) compare([metadata('invalid', value), metadata('valid', 'description: Valid')]);
  compare([file('missing', '---\nname: lost'), file('good')]);
  compare([metadata('private', 'disable-model-invocation: true')]);
  compare([metadata('private', 'name: shared\ndisable-model-invocation: true'), metadata('duplicate', 'name: " shared "')]);
  compare([metadata('a', 'name: "<&>"'), metadata('b', 'name: "<&>"')]);
});
