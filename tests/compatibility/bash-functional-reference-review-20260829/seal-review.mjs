import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.dirname(new URL(import.meta.url).pathname);
const capture = fs.openSync(path.join(root, 'CORRECTION.capture.data'), 'wx', 0o600);
const record = value => fs.writeSync(capture, JSON.stringify(value) + '\n');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let complete = false;
try {
  record({ phase:'start', time:new Date().toISOString(), role:'C05-v2 DATA_ONLY_ZERO_CHILDREN' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packet/MANIFEST.json')));
  const read = name => {
    const row = manifest.rows.find(row => row.path.endsWith('/'+name));
    assert(row, 'missing packet row');
    const bytes = fs.readFileSync(path.join(root, 'packet', row.capture));
    assert(bytes.length === row.bytes && hash(bytes) === row.sha256, 'packet drift');
    return JSON.parse(bytes);
  };
  const legacy = JSON.parse(fs.readFileSync(path.join(root,'authority/legacy.json')));
  const originalRow = legacy.rows.find(row => row.path.endsWith('/CASES.original.json'));
  const originalBytes = fs.readFileSync(path.join(root,'authority',originalRow.capture));
  assert(hash(originalBytes) === originalRow.sha256 && originalBytes.length === originalRow.bytes, 'original capture drift');
  assert(crypto.createHash('sha1').update(`blob ${originalBytes.length}\0`).update(originalBytes).digest('hex') === originalRow.blob, 'stored original blob');
  const original = JSON.parse(originalBytes);
  const audit = read('AUDIT.json'); const requests = read('REQUESTS.json'); const protocol = read('PROTOCOL.json');
  const expected = {
    B20:{ name:'mapfile', program:'mapfile -t a; printf \'<%s>\\n\' "${a[@]}"' },
    B21:{ name:'readarray', program:'a=(keep old); readarray -t -O 1 -n 1 a; printf \'<%s>\\n\' "${a[@]}"' },
    B39:{ name:'__surface_missing_command__', program:'__surface_missing_command__; printf \'status:%s\\n\' "$?"' }
  };
  const rows = [];
  for (const [id, item] of Object.entries(expected)) {
    const row = audit.cases.find(row => row.id === id); const request = requests.find(row => row.id === id);
    assert(row.program === item.program && original.cases.find(row => row.id === id).program === item.program, 'complete literal differs');
    assert(!item.name.includes('/') && request.environment.PATH === `${protocol.root}/${id}/empty-path`, 'path/name domain');
    assert(request.argv[3] === item.program && row.programSha256 === hash(Buffer.from(item.program)), 'request literal hash');
    rows.push({ id, name:item.name, program:item.program, onlyCandidatePath:request.environment.PATH+'/'+item.name, runtime:'UNRUN' });
  }
  assert(JSON.stringify(protocol.lookupExceptions) === JSON.stringify(Object.keys(expected)), 'exception membership');
  const fixtureAuthority = [];
  for (const fixture of audit.fixtures) {
    assert(Object.hasOwn(original.fixtures,fixture.path), 'missing original fixture');
    const bytes = Buffer.from(original.fixtures[fixture.path]);
    assert(bytes.toString('base64') === fixture.base64 && bytes.length === fixture.bytes && hash(bytes) === fixture.sha256, 'original fixture differs');
    fixtureAuthority.push({ path:fixture.path, bytes:bytes.length, sha256:hash(bytes), authority:originalRow.blob });
  }
  const result = { id:'C05-v2', status:'PASS_DATA', previous:'C05 FAIL B21 retained; reviewer wrongly required command at program start', rows, fixtureAuthoritySupplement:fixtureAuthority, newChildren:0, nativeExecutions:0, proposalChanged:false };
  fs.writeFileSync(path.join(root,'CORRECTION.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  record({phase:'complete',status:result.status,children:0});
  complete = true;
} catch (error) { record({phase:'STOP',message:error.message});process.exitCode=1; }
finally { fs.closeSync(capture); }
if (complete) {
  const rows = [];
  function walk(directory, prefix='') {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute=path.join(directory,name);const relative=prefix?prefix+'/'+name:name;const stat=fs.lstatSync(absolute);
      if(stat.isDirectory())walk(absolute,relative);
      else {assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<16*1024*1024,'seal entry');const bytes=fs.readFileSync(absolute);rows.push({path:relative,bytes:bytes.length,mode:stat.mode&0o777,sha256:hash(bytes)});}
    }
  }
  walk(root);
  const bytes=rows.reduce((sum,row)=>sum+row.bytes,0);
  assert(bytes<16*1024*1024,'publication size');
  fs.writeFileSync(path.join(root,'SEAL.json'),JSON.stringify({schema:'independent-functional-reference-review-v1',status:'REVIEW_COMPLETE_LAUNCHER_CORRECTIONS_REQUIRED',source:'9afc9c5a321711fb566817916a281fe4776935fd',evidence:'807b6ea5f934e7b9d23092c6d7f518b757b8fbea',preseal:'657d5ef886db90c625d40ba4f461ccea64c1ff9e2d48f3b1c72190bc0d52dea6',controls:{originalDataPass:9,originalReviewerAssertionFail:1,correctedSameC05Pass:1,uniqueControlIdentities:10,syntaxOnly:1,realLifecycleChildren:0,bashExecutions:0,eligibleUnrun:37,withheldUnrun:3},logicalSealedBytes:bytes,rows,selfExcluded:true},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:'SEALED_SOURCE_REVIEW_NO_ACTUAL_GO',files:rows.length,bytes,originalData:'9/10',correction:'C05-v2 PASS',uniqueControls:10,eligibleUnrun:37,withheldUnrun:3}));
}
