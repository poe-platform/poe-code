import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {root, work, save, sha} from './safe-bash-table-review-tools.mjs';
const oracle = `${root}/tests/commands/metadata-stress/.oracle`;
const frozen = JSON.parse(readFileSync(`${root}/tests/commands/table-text-stress/first-discrepancy.json`));
const identities = {};
for (const command of ['paste','comm','join']) {
  const path = `${oracle}/coreutils-9.7/src/${command}`;
  const result = spawnSync(path, ['--version'], {encoding:'utf8', timeout:5000, env:{LC_ALL:'C', PATH:'/usr/bin:/bin'}});
  assert.equal(result.status,0);
  identities[command] = {version:result.stdout.split('\n')[0],sha256:sha(readFileSync(path))};
}
assert.deepEqual(identities,frozen.identities);
const archiveSha256=sha(readFileSync(`${oracle}/coreutils-9.7.tar.xz`));
const manualSha256=sha(readFileSync(`${oracle}/coreutils-9.7/doc/coreutils.texi`));
assert.equal(archiveSha256,frozen.archiveSha256);
assert.equal(manualSha256,frozen.manualSha256);
save(`${work}/oracle-identity${process.argv[2]?`-${process.argv[2]}`:''}.json`,{time:new Date().toISOString(),oracle,identities,archiveSha256,manualSha256,authorIdentities:JSON.parse(readFileSync(`${root}/tests/commands/table-text/gnu-evidence.json`)).identities,profile:'GNU coreutils 9.7 LC_ALL=C; Apple separate and not executed for acceptance'});
console.log(JSON.stringify({identities,archiveSha256,manualSha256},null,2));
