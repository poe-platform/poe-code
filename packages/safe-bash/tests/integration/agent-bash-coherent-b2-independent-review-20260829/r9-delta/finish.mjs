import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
export async function finish({ read, cache, root, output, hash, start }) {
  const base = 'tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r9';
  const stage = base + '/staged';
  const packetRecord = read(stage + '/PACKET.json');
  assert.equal(packetRecord.bytes, 7320);
  assert.equal(packetRecord.sha256, '5b4a12e14081d6c95f7805358737d32008b0b7f5844413b485e77a81fb1b807d');
  const packet = JSON.parse(packetRecord.body);
  assert.equal(packet.files.length, 32);
  for (const item of packet.files) {
    const record = read(stage + '/' + item.path);
    assert.equal(record.bytes, item.bytes); assert.equal(record.sha256, item.sha256);
  }
  const allowed = new Set(packet.files.map(row => path.resolve(root, stage, row.path)));
  for (const row of packet.files.filter(row => row.path.endsWith('.mjs'))) {
    const record = read(stage + '/' + row.path);
    for (const match of record.body.toString().matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
      assert(allowed.has(path.resolve(path.dirname(record.path), match[1])), 'unbound static import');
    }
  }
  const controlsSeal = read(base + '/CONTROLS-PRESEAL.json');
  const controlsSource = read(base + '/controls.mjs');
  assert.equal(controlsSource.sha256, '7f46c99dcaa4d01a3fc3ccb984a4f9d29e9f574b0321b16631f16acafff6337e');
  const frozen = JSON.parse(read(stage + '/metadata/FROZEN-BINDINGS.json').body);
  const members = frozen.packageMembers;
  const sorted = rows => [...rows].sort((left,right) => left.path < right.path ? -1 : 1);
  const installed = sorted(members.map(row => ({ ...row, mode: 0o600 })));
  const source = read(stage + '/new/coordinator.mjs').body.toString();
  const support = read(stage + '/new/support.mjs').body.toString();
  const launcher = read(stage + '/new/launch.sh').body.toString();
  assert(source.indexOf('assert.deepEqual(inventory(toolsRoot') < source.indexOf('manager.run(role.role'));
  assert(source.includes('"all-0644 archive eligibility"'));
  assert(launcher.includes('umask 077'));
  const recipe = JSON.parse(read(stage + '/metadata/RECIPE.json').body);
  assert.equal(recipe.roles.length, 41);
  const preseal = { packet: packetRecord.sha256, controlsSource: controlsSource.sha256, controlsSeal: controlsSeal.sha256, groups: ['author-eligible','author-mode','author-hash','author-umask','author-archive','author-source','novel-extra-member','novel-renamed-member','novel-archive-executable'], imports: 'whole authenticated shipping coordinator; no main dispatch', prospectiveWindow: { notBefore: '2026-08-29T17:22:00.000Z', latest: '2026-08-29T17:27:00.000Z', activeEnd: '2026-08-29T17:49:00.000Z', expiry: '2026-08-29T17:52:00.000Z' } };
  fs.writeFileSync(path.join(output, 'PRESEAL.json'), JSON.stringify(preseal,null,2)+'\n', {flag:'wx'});
  const { verifyPackageInventory: verify } = await import(pathToFileURL(path.resolve(root, stage, 'new/coordinator.mjs')).href);
  const outcomes = [];
  function run(id, body) { body(); outcomes.push({id,status:'PASS',role:'PURE_NO_PRODUCT'}); }
  run(preseal.groups[0], () => verify(installed,members,true,0o077));
  run(preseal.groups[1], () => assert.throws(() => verify(installed.map((row,index)=>index?row:{...row,mode:0o644}),members,true,0o077)));
  run(preseal.groups[2], () => assert.throws(() => verify(installed.map((row,index)=>index?row:{...row,sha256:'0'.repeat(64)}),members,true,0o077)));
  run(preseal.groups[3], () => assert.throws(() => verify(installed,members,true,0o022)));
  run(preseal.groups[4], () => assert.throws(() => verify(installed,members.map((row,index)=>index?row:{...row,mode:0o600}),true,0o077)));
  run(preseal.groups[5], () => { verify(sorted(members),members,false,0o077); assert.throws(()=>verify(installed,members,false,0o077)); });
  run(preseal.groups[6], () => assert.throws(() => verify([...installed,{...installed[0],path:'EXTRA'}],members,true,0o077)));
  run(preseal.groups[7], () => assert.throws(() => verify(installed.map((row,index)=>index?row:{...row,path:'RENAMED'}),members,true,0o077)));
  run(preseal.groups[8], () => assert.throws(() => verify(installed,members.map((row,index)=>index?row:{...row,mode:0o755}),true,0o077)));
  const candidates = [];
  for (const directory of [base, base+'/evidence']) {
    if (!fs.existsSync(path.join(root,directory))) continue;
    for (const name of fs.readdirSync(path.join(root,directory))) if (/grant|binding/i.test(name) && name.endsWith('.json')) candidates.push(directory+'/'+name);
  }
  const templates = candidates.map(filename => { const record=read(filename); return { path:filename,bytes:record.bytes,sha256:record.sha256,data:JSON.parse(record.body) }; });
  const pending = templates.find(row=>row.bytes===1067 && row.sha256==='11744860187d396db880e1571d07391bd7ed5db44c61985e9bf1b5180f590cf6');
  const window = preseal.prospectiveWindow;
  assert.equal(Date.parse(window.expiry)-Date.parse(window.notBefore),1800000);
  assert.equal(Date.parse(window.expiry)-Date.parse(window.activeEnd),180000);
  const slotPaths=['/private/tmp/B2-R9-ROOT-GO.json'];
  if(pending) for(const [key,value] of Object.entries(pending.data)) if(/workRoot|captureRoot/.test(key)&&typeof value==='string')slotPaths.push(value);
  const slots=slotPaths.map(filename=>({path:filename,absent:!fs.existsSync(filename)}));
  for(const record of cache.values()) { const stat=fs.lstatSync(record.path); assert(stat.isFile()&&!stat.isSymbolicLink()); assert.equal(stat.size,record.bytes); assert.equal(stat.mode&0o777,record.mode); assert.equal(hash(fs.readFileSync(record.path)),record.sha256); }
  assert(Date.now()-start<240000);
  const result={schema:'INDEPENDENT_B2_R9_SOURCE_PURE_TEMPLATE_REVIEW',verdict:'SCOPED_SOURCE_PURE_PASS_ACTUAL_BINDING_PENDING',outcomes,pins:packet.files.length,postguards:true,pendingTemplateLocated:!!pending,templates,slots,prospectiveWindow:window,sourceReview:{preinstallEligibility:true,authenticatedToolInventoryBeforeInstaller:true,launcherUmask077:true,sourceModesUnchanged:true,guard:source.slice(source.indexOf('export function verifyPackageInventory'),source.indexOf('export async function main')),grantValidatorSource:support},qualifications:['No installer/product/Worker/compiler execution','Installed mode behavior is prospective exact policy, not a fresh npm observation','Pending review fields and old window must be replaced and newly hash-bound; no valid actual grant','Latest start externally enforced; delayed start shrinks remaining time; 180s publication','Original r8 224PASS/448UNRUN unchanged'],startedUTC:new Date(start).toISOString(),endedUTC:new Date().toISOString(),helperPID:process.pid,childSpawns:0};
  const body=Buffer.from(JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(output,'RECEIPT.json'),body,{flag:'wx'});
  fs.writeFileSync(path.join(output,'HANDOFF.md'),`# B2-r9 independent narrow review\n\n9/9 PURE groups: six author obligations plus three independent mode/membership negatives, linked to the actual authenticated coordinator module; 32 runtime pins/postguards. No main dispatch or product execution.\n\nMode delta is qualified for exact authenticated all-0644 archive and pinned installer under launcher umask077; only installed/moved inventories derive0600. Source bytes/modes remain exact. No arbitrary mode waiver/chmod repair.\n\nSOURCE/PURE accepted scoped; actual binding remains PENDING. Original published template window is obsolete. Author must freshly bind ROOT's17:22/17:27/17:49/17:52 UTC window, real review fields and slots, then obtain ROOT actual GO. Template located=${!!pending}. No current grant installed.\n\nReceipt SHA256 ${hash(body)}; ${body.length} bytes. Existing r8 224PASS/448UNRUN preserved. Cache remains sampled best-effort128MiB within512MiB, not live peak/kernel quota. 64knownOS/peak3/41children/34loaders remain prospective inherited profile, not exercised here.\n`,{flag:'wx'});
  return {verdict:result.verdict,groups:outcomes.length,pins:32,pendingTemplateLocated:!!pending,receiptSha256:hash(body),receiptBytes:body.length,endedUTC:result.endedUTC};
}
