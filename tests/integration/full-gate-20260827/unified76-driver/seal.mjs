import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {candidate,directory,save,sha} from './common.mjs';
import {runtimeFiles} from './admission.mjs';
import {readProfile} from './profile.mjs';
assert.equal(process.argv.length,2);
const profile=readProfile();
save(join(directory,'DRIVER.json'),{schema:1,candidate:candidate.candidate,profileSha256:sha(JSON.stringify(profile)),files:Object.fromEntries(runtimeFiles.map(path=>[path,sha(readFileSync(join(directory,path)))])),status:'AUTHOR_CANDIDATE_PENDING_DIFFERENT_REVIEW_AND_ROOT_RELEASE',fullGateLaunched:false});
