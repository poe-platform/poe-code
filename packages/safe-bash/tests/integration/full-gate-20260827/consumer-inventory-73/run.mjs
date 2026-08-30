import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { consumerGroups, currentConsumerPaths, negativeGroups } from '../../../plugins/qualified-current-release/consumers.mjs';
import { verifyInventory } from '../../../plugins/qualified-current-release/inventory-check.mjs';
import { createBuiltPackageBinding, assertBuiltConsumerResolution } from '../../../../scripts/typecheck-consumers.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const productRevision = 'c355751f36ca3fdbab8f888eaab30203c1bcd343';
const executable = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(executable)), '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0');
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'consumer-inventory73-execution-')));
const output = realpathSync(mkdtempSync(join(tmpdir(), 'consumer-inventory73-evidence-')));
const inventory = JSON.parse(readFileSync(join(repository, 'tests/plugins/qualified-current-release/inventory.json')));
const paths = git(['ls-files','-z']).toString().split('\0').filter(Boolean);
const added = 'tests/plugins/qualified-current-release/current-column.mts'; if (!paths.includes(added)) paths.push(added);
const read = path => readFileSync(join(repository,path));
const groups = consumerGroups.filter(group => ['grep-aliases-public','column-public','network-zero-caps-public'].includes(group.name));
const report = { productRevision, externalHarnessWorktreeAt: git(['rev-parse','HEAD']).toString().trim(), inventorySha256: hash(readFileSync(join(repository,'tests/plugins/qualified-current-release/inventory.json'))), groups: [], controls: [], phases: [] };
function command(label, args, cwd, expected=0) {
  const result = spawnSync(executable,args,{cwd,env:{...process.env,PATH:dirname(executable)+':/usr/bin:/bin',TSX_DISABLE_CACHE:'1',npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  writeFileSync(join(output,label+'.stdout'),result.stdout??''); writeFileSync(join(output,label+'.stderr'),result.stderr??'');
  report.phases.push({label,args,status:result.status,signal:result.signal,error:result.error?.message});
  assert.equal(result.status,expected,label+': '+result.stderr); return result;
}
try {
  assert.equal(groups.length,3);
  git(['merge-base','--is-ancestor','bb7f5972',productRevision]);
  report.counts=verifyInventory(inventory,paths,currentConsumerPaths(),negativeGroups.map(group=>group.path),read);
  const old=JSON.parse(git(['show','d5f068cd:tests/plugins/qualified-current-release/inventory.json']));
  for(const entry of old.entries) assert.deepEqual(inventory.entries.find(current=>current.path===entry.path),entry,'old classification changed');
  const reject=(name,change)=>{assert.throws(change,name);report.controls.push(name);};
  reject('unknown current mts',()=>verifyInventory(inventory,[...paths,'tests/unknown-consumer.mts'],currentConsumerPaths(),negativeGroups.map(group=>group.path),read));
  reject('omitted current route',()=>verifyInventory(inventory,paths,currentConsumerPaths().filter(path=>path!==added),negativeGroups.map(group=>group.path),read));
  reject('missing historical input',()=>verifyInventory(inventory,paths.filter(path=>path!=='tests/commands/column-stress/handoff-20260827/packed-types.mts'),currentConsumerPaths(),negativeGroups.map(group=>group.path),read));
  reject('modified historical capture',()=>verifyInventory(inventory,paths,currentConsumerPaths(),negativeGroups.map(group=>group.path),path=>path==='tests/commands/column-stress/handoff-20260827/packed-types.mts'?Buffer.from('changed'):read(path)));
  reject('modified historical proof',()=>verifyInventory(inventory,paths,currentConsumerPaths(),negativeGroups.map(group=>group.path),path=>path==='tests/commands/column-stress/handoff-20260827/REPORT.md'?Buffer.from('changed'):read(path)));
  reject('missing exact negative route',()=>verifyInventory(inventory,paths,currentConsumerPaths(),[],read));
  const source=join(temporary,'source'),consumer=join(temporary,'consumer');mkdirSync(source);mkdirSync(consumer);
  const archive=join(temporary,'source.tar');git(['archive','--format=tar','--output='+archive,productRevision,'src','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','README.md']);
  execFileSync('/usr/bin/tar',['-xf',archive,'-C',source]);cpSync(join(repository,'node_modules'),join(source,'node_modules'),{recursive:true,dereference:true});
  const productPaths=git(['ls-tree','-r','--name-only',productRevision,'src']).toString().trim().split('\n');
  const product=()=>Object.fromEntries(productPaths.map(path=>[path,hash(readFileSync(join(source,path)))]));report.productBefore=product();
  const compiler=join(source,'node_modules/typescript/bin/tsc');command('build',[compiler,'-p','tsconfig.build.json'],source);
  const npm='/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
  const pack=JSON.parse(command('pack',[npm,'pack','--offline','--ignore-scripts','--json','--pack-destination',temporary],source).stdout)[0];
  report.packageSha256=hash(readFileSync(join(temporary,pack.filename)));
  report.packageManifestSha256=hash(readFileSync(join(source,'package.json')));
  assert.equal(report.packageManifestSha256,'691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535');
  const installed=join(consumer,'node_modules/virtual-bash');mkdirSync(installed,{recursive:true});execFileSync('/usr/bin/tar',['-xf',join(temporary,pack.filename),'-C',installed,'--strip-components=1']);
  writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  const binding=createBuiltPackageBinding(installed);
  for(const group of groups){
    const directory=join(consumer,group.name);mkdirSync(directory);const original=read(group.files[0]);writeFileSync(join(directory,'consumer.mts'),original);
    const config={compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,verbatimModuleSyntax:true,skipLibCheck:false,typeRoots:[join(source,'node_modules/@types')],outDir:join(directory,'emitted')},files:[join(directory,'consumer.mts')]};
    writeFileSync(join(directory,'tsconfig.json'),JSON.stringify(config));
    const compilation=command(group.name+'-types',[compiler,'-p',join(directory,'tsconfig.json'),'--traceResolution'],consumer);
    assertBuiltConsumerResolution(compilation.stdout,consumer,installed,binding);
    command(group.name+'-runtime',['--permission','--allow-fs-read='+consumer,'--allow-worker','--unhandled-rejections=strict',join(directory,'emitted/consumer.mjs')],consumer);
    report.groups.push({name:group.name,input:group.files[0],sha256:hash(original),types:'pass',runtime:'pass'});
  }
  const publicTemplate=readFileSync(new URL('../candidate-profile-73/public.mjs',import.meta.url));
  const typeTemplate=readFileSync(new URL('../candidate-profile-73/consumer.mts.fixture',import.meta.url));
  writeFileSync(join(consumer,'public.mjs'),publicTemplate);writeFileSync(join(consumer,'public-types.mts'),typeTemplate);
  const smoke=command('profile-public',['--permission','--allow-fs-read='+consumer,'--allow-worker','--unhandled-rejections=strict',join(consumer,'public.mjs')],consumer);
  report.publicSmoke={...JSON.parse(smoke.stdout),templateSha256:hash(publicTemplate)};
  assert.equal(report.publicSmoke.count,73);assert.equal(report.publicSmoke.workflows.length,6);
  const publicTypes=command('profile-public-types',[compiler,'--noEmit','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--strict','--noUncheckedIndexedAccess','--exactOptionalPropertyTypes','--typeRoots',join(source,'node_modules/@types'),'--traceResolution',join(consumer,'public-types.mts')],consumer);
  assertBuiltConsumerResolution(publicTypes.stdout,consumer,installed,binding);
  report.publicSmoke.types='pass';report.publicSmoke.typeTemplateSha256=hash(typeTemplate);
  for(const [name,code] of [['alias-option',`import {grepAliasCommands} from 'virtual-bash/commands/grep-aliases';grepAliasCommands({regex:{maxWorkers:'no'}});`],['column-option',`import {columnCommands} from 'virtual-bash/commands/column';columnCommands({limits:{maxCells:'no'}});`],['network-option',`import {networkCommands} from 'virtual-bash/commands/network';networkCommands({limits:{maxRetries:'no'}});`]]){
    const file=join(consumer,name+'.mts');writeFileSync(file,code);
    const result=command(name,[compiler,'--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--strict','--typeRoots',join(source,'node_modules/@types'),file],consumer,2);
    assert.match(result.stdout,/error TS2322:/);assert.equal((result.stdout.match(/error TS\d+:/g)??[]).length,1);report.controls.push(name);
  }
  const missing=join(installed,'dist/commands/column/index.js'),saved=readFileSync(missing);rmSync(missing);
  command('missing-public-runtime',['--input-type=module','-e',`import 'virtual-bash/commands/column'`],consumer,1);writeFileSync(missing,saved);report.controls.push('missing public module no source fallback');
  const denial=command('source-denial',['--permission','--allow-fs-read='+consumer,'--input-type=module','-e',`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(source,'src/index.ts'))})`],consumer,1);
  assert.match(denial.stderr,/ERR_ACCESS_DENIED/);report.controls.push('source read fence');
  assert.deepEqual(product(),report.productBefore);assert.deepEqual(createBuiltPackageBinding(installed).declarations,binding.declarations);report.status='pass';
}catch(error){report.status='fail';report.error=String(error.stack);process.exitCode=1;}
finally{rmSync(temporary,{recursive:true,force:true});report.temporaryRemoved=true;writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,groups:report.groups,controls:report.controls,error:report.error}));}
