import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
export function classifyDocument(value, admit) {
  const host = pin => { assert(pin && typeof pin.path === 'string' && path.isAbsolute(pin.path), 'HOST_ABSOLUTE_ORIGIN'); return admit(pin); };
  const list = rows => { assert(Array.isArray(rows), 'HOST_LIST'); for (const row of rows) host(row); };
  if (value.schema === 'B1-final-admin-r5') {
    const expected = 'schema repo maxKnownOS peak issuedUTC latestStartUTC expiresUTC action actualAuthority sourceTree sourceInputs package members actualStageAEmissions reviewBindings adminRoot runtimeRoot publicationRoot captureRoot metadataHome adminOwner ownerKernel dispatch preimportEntry adminFiles preimportFiles publisherFiles runtimePreseal publisherBinding publisherPreseal runtimeInputFiles tools absentSlots slots runtimeCommand preimportCommand publicationCommand runtimeRoles limits dynamic qualifications revision prospectiveAuthorization retiredUnusedWindow'.split(' ');
    assert.deepEqual(Object.keys(value).sort(), expected.sort(), 'FINAL_SCHEMA_KEYS');
    assert.equal(value.repo, '/Users/kjopek/Workspace/safe-bash');
    assert.equal(value.package.path, 'tests/integration/agent-bash-coherent-author-20260829/stage-a-r2/evidence/package/virtual-bash-0.0.0.tgz');
    assert.equal(value.package.sha256, '2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca');
    host({ ...value.package, path: path.join(value.repo, value.package.path) });
    for (const key of ['adminOwner','ownerKernel','dispatch','preimportEntry','runtimePreseal','publisherPreseal']) host(value[key]);
    for (const key of ['adminFiles','preimportFiles','publisherFiles','runtimeInputFiles','tools']) list(value[key]);
    const binding = host(value.publisherBinding);
    assert.equal(binding.schema, 'b1-publication-v2-review-only');
    list(binding.files);
    assert.equal(value.prospectiveAuthorization, 'ROOT_B1_R6_LIVE_ADMIN_20260829_ONE_ACTUAL_AFTER_FINAL_ACCEPTANCE');
    const command = host({ path: path.join(value.repo,'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6/COMMAND.json'), bytes:747, sha256:'9ecf5ccae3492024fd67f35f64ee925b4062a590d5f5d6fb943c8542539b02b0' });
    assert.equal(command.executable,'/bin/zsh'); assert.equal(command.login,false); assert.equal(command.actualGo,false);
    assert.deepEqual(command.env,{B1_ADMIN_ROOT_GO:'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION'});
    assert.deepEqual(command.argv,[path.join(value.repo,'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6/launch.sh'),path.join(value.repo,'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6/FINAL.json'),'8bd385557c356994062d62fb10d9aef485e3c440dd509e68220425ae770e03a9','24620',value.prospectiveAuthorization]);
    for (const file of [...value.absentSlots,...binding.outputs.startupCaptures]) assert(!fs.existsSync(file),`UNUSED:${file}`);
    return;
  }
  if (value.schema === 'r6-fixture-v2-preseal') {
    assert.deepEqual(Object.keys(value).sort(),'schema unchangedFinal unchangedPublisherSourceCommit oldControls source dependencies tools exactDelta groups actualPublisher runtime renewal'.split(' ').sort(),'FIXTURE_SCHEMA_KEYS');
    host(value.unchangedFinal); host(value.oldControls);
    for(const key of ['source','dependencies','tools']) list(value[key]);
    return;
  }
  throw new Error('UNKNOWN_IDENTITY_DOCUMENT_SCHEMA');
}
