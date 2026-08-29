import assert from "node:assert/strict";
import crypto from "node:crypto";

export async function generate(context) {
  const { owned, read, patchFiles } = context;
  const original = read(`${owned}/completion-r3/runtime/publish.mjs`, { bytes: 21803, sha256: "4b7a11ec7515a1f83f0bc9d73b8d9dcbe9c507a339cdf0cb0d2fe25772284dde" }).toString();
  const finish = original.indexOf('  patch(generated, "derive-owner-recipe");');
  assert.ok(finish > 0);
  let code = original.slice(0, finish);
  const changes = [];
  function replace(before, after, name) {
    assert.equal(code.split(before).length, 2, name);
    code = code.replace(before, after);
    changes.push({ name, before, after });
  }
  replace('export async function publish(context)', 'export async function generate(context)', 'separate generation from controls and publication');
  const utilitiesStart = code.indexOf('  const git = (role, args, input) =>');
  const utilitiesEnd = code.indexOf('  const bindingSpecs = [', utilitiesStart);
  assert.ok(utilitiesStart > 0 && utilitiesEnd > utilitiesStart);
  code = code.slice(0, utilitiesStart) + '  const git = async (role, args, input) => Buffer.from((await context.git(role, args, { input })).stdout);\n' + code.slice(utilitiesEnd);
  changes.push({ name: 'use bounded asynchronous controller Git and apply_patch', removedStart: utilitiesStart, removedEnd: utilitiesEnd });
  replace('const raw = git("tool-authority-blobs",', 'const raw = await git("tool-authority-blobs",', 'await admitted metadata capture');
  code = code.replaceAll('completion-r3', 'completion-r4').replaceAll('_R3', '_R4').replaceAll('b0-r3-b2-negative-outcome-r3.1', 'b0-r3-b2-negative-outcome-r4.1');
  code += '  await context.patchFiles([...generated].map(([name, text]) => ({ name, text })));\n  return { generated: [...generated.keys()], roles: roles.length, retained: slots.length, types: roles.filter(row => row.kind === "type").length, diagnostics: diagnostics.length * 3, mutations: mutations.length, restores: mutations.length, bindings: 2, runtime: "UNRUN" };\n}\n';
  const identity = { schema: 'B2_GENERATOR_DERIVATION_R4', source: { originalPath: 'completion-r3/runtime/publish.mjs', bytes: 21803, sha256: '4b7a11ec7515a1f83f0bc9d73b8d9dcbe9c507a339cdf0cb0d2fe25772284dde', qualification: 'snapshotted uncommitted r3 authored DATA, not a frozen product origin' }, changes, output: { bytes: Buffer.byteLength(code), sha256: crypto.createHash('sha256').update(code).digest('hex') }, generationDoesNotRunControlsOrProduct: true };
  await patchFiles([{ name: 'GENERATOR-ORIGIN.json', text: JSON.stringify(identity, null, 2) + '\n' }, { name: 'recipe-generator.mjs', text: code }]);
  return identity;
}
