import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = '/Users/kjopek/Workspace/safe-bash';
const privateRoot = '/tmp/safe-bash-stream-verifier-20260827-A';
const oracle = join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const fixtures = join(privateRoot, 'native-fixtures');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (existsSync(join(privateRoot, 'FROZEN.json'))) throw Error('Already frozen; do not overwrite original holdouts');
mkdirSync(fixtures, { recursive: true, mode: 0o700 });
const cases = [];
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
function add(command, id, args, input, files = {}, extra = {}) {
  cases.push({ id: `${command}-${id}`, command, args, stdinHex: bytes(input).toString('hex'), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, bytes(value).toString('hex')])), locale: 'C', ...extra });
}
add('tac', 'unterminated-crlf', [], 'old\r\nnew\r\nlast');
add('tac', 'empty-records', [], '\n\nA\n\nB\n');
add('tac', 'nul-separator', ['-s', ''], Buffer.from([65,0,66,0,67]));
add('tac', 'nul-before', ['-b','-s',''], Buffer.from([0,65,0,66,0]));
add('tac', 'literal-metacharacters', ['--separator=.^'], 'a.^b.^tail');
add('tac', 'before-leading-trailing', ['--before','--separator=::'], '::a::b::');
add('tac', 'overlap-rightmost', ['-s','aba'], 'ababaXabaYababa');
add('tac', 'overlap-before', ['-b','-s','aa'], 'aaaaaXaaa');
add('tac', 'multibyte-separator', ['-s','é'], 'AéBé終é');
add('tac', 'invalid-binary', [], Buffer.from([255,0,10,128,13,10,195,40]));
add('tac', 'operand-boundaries', ['one','two','three'], '', {one:'A\nB',two:'C\nD\n',three:''});
add('tac', 'shared-dash', ['-','one','-','two'], 'I\nJ\n', {one:'K\nL',two:'M\n'});
add('tac', 'dash-name', ['--','-s'], '', {'-s':'a\nb\n'});
add('tac', 'long-cross-buffer', ['-s','::'], 'Q'.repeat(65535)+'::'+ 'Z'.repeat(17000)+'::tail');
add('tac', 'no-separator', [], 'one record');
add('expand', 'initial-blanks', ['-i','-t','4'], ' \tA\tB\n\t \tC\t\n');
add('expand', 'cr-not-newline', ['-t','4'], 'ab\r\tX\n');
add('expand', 'backspace-revisit-stop', ['-t','2,5,9'], '\tX\b\b\b\tZ\b\t');
add('expand', 'finite-stops', ['-t','2,5'], '\t\t\t\tX');
add('expand', 'blank-list', ['--tabs=2 5 9'], '\tX\tX\tX\t');
add('expand', 'absolute-repeat', ['--tabs=2,5,/4'], '\t\t\t\tX\t');
add('expand', 'relative-repeat', ['--tabs=2,5,+4'], '\t\t\t\tX\t');
add('expand', 'repeat-only', ['-t','/3'], '\tX\tY\t');
add('expand', 'legacy-stops', ['-2,5'], '\tX\tY\t');
add('expand', 'repeat-option-stops', ['-t','2','-t','5'], '\t\t\t');
add('expand', 'cross-operand-column', ['-t','4','one','two'], '', {one:'abc',two:'\tZ\n'});
add('expand', 'cross-operand-initial', ['-i','one','two'], '', {one:'X',two:'\tY\n\tZ'});
add('expand', 'shared-dash', ['-t','4','-','one','-'], 'ab', {one:'\tX'});
add('expand', 'nul-invalid-utf8', ['-t','4'], Buffer.from([0,255,9,195,40,9,10]));
add('expand', 'utf8-byte-columns', ['-t','4'], 'é\t界\tZ\n');
add('expand', 'initial-backspace', ['-i'], ' \b\tX\n');
add('expand', 'long-chunk-edge', ['-t','4'], 'X'.repeat(65535)+'\tY\n');
add('fold', 'unterminated-long', ['-w','5'], 'abcdefghijk');
add('fold', 'word-boundaries', ['-s','-w','7'], 'ab cd   efghij kl\n');
add('fold', 'tab-larger-than-width', ['-w','3'], '\tAB\tC\n');
add('fold', 'tab-spaces', ['-s','-w','9'], 'ab\tcd efghij\tZ');
add('fold', 'backspace', ['-w','4'], 'abcd\b\bEFGH\n\b\bABC');
add('fold', 'cr-column-reset', ['-w','4'], 'abcd\rEFGHI\r\n');
add('fold', 'byte-controls', ['-b','-w','3'], 'A\tB\bC\rD\n');
add('fold', 'byte-space-combination', ['-bs','-w','5'], 'ab cd ef\tghij');
add('fold', 'all-blank', ['-s','-w','3'], '       \n');
add('fold', 'operand-reset', ['-w','4','one','two'], '', {one:'abc',two:'defgh'});
add('fold', 'shared-dash', ['-w','3','-','one','-'], 'abcde', {one:'fghij'});
add('fold', 'invalid-nul', ['-w','3'], Buffer.from([255,0,128,65,66,13,67,10]));
add('fold', 'utf8-column', ['-w','3'], 'é界ABé\n');
add('fold', 'utf8-byte', ['-bw','3'], 'é界ABé\n');
add('fold', 'long-record-chunk-edge', ['-w','4096'], 'X'.repeat(65537));
add('fold', 'vertical-whitespace-not-blank', ['-s','-w','4'], 'ab\vcd\fef gh');
add('fold', 'legacy-width', ['-3'], 'abcdefg');
for (const [command, args] of [['tac',['--unknown']],['tac',['-s']],['expand',['-t','0']],['expand',['-t','5,2']],['expand',['-t','2,,4']],['expand',['-t','2,+0']],['expand',['--bad']],['fold',['-w','0']],['fold',['-w','-1']],['fold',['-w','2x']],['fold',['--bad']]]) {
  add(command, `invalid-${cases.length}`, args, 'abc\tdef\n', {}, { negative: true });
}
for (const command of ['tac','expand','fold']) add(command, 'missing-then-valid', ['missing','one'], '', {one:'a\nb\n'}, { diagnosticPath: 'missing' });
for (const command of ['expand','fold']) {
  const original = cases.find(item => item.id === `${command}-utf8-${command === 'fold' ? 'column' : 'byte-columns'}`);
  cases.push({...original,id:`${command}-utf8-locale-control`,locale:'en_US.UTF-8'});
}
const controls = [];
for (const item of cases) {
  const cwd = join(fixtures, item.id);
  mkdirSync(cwd);
  for (const [name, hex] of Object.entries(item.files)) writeFileSync(join(cwd,name), Buffer.from(hex,'hex'));
  const executable = join(oracle, 'src', item.command);
  const result = spawnSync(executable,item.args,{cwd,input:Buffer.from(item.stdinHex,'hex'),env:{...environment,LC_ALL:item.locale},timeout:3000,maxBuffer:4*1024*1024});
  if (result.error || result.signal || result.status === null) throw Error(`Oracle failure ${item.id}: ${result.error ?? result.signal}`);
  item.expected = {stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex'),exitCode:result.status};
  item.oracle = 'GNU coreutils9.7 Darwin';
  if (['expand','fold'].includes(item.command) && !item.negative && !item.diagnosticPath) {
    const bsd = spawnSync(`/usr/bin/${item.command}`,item.args,{cwd,input:Buffer.from(item.stdinHex,'hex'),env:{...environment,LC_ALL:item.locale},timeout:3000,maxBuffer:4*1024*1024});
    controls.push({id:item.id,profile:'Apple Darwin',args:item.args,locale:item.locale,status:bsd.status,signal:bsd.signal,error:bsd.error?.message,stdoutHex:bsd.stdout.toString('hex'),stderrHex:bsd.stderr.toString('hex')});
  }
}
function rawStrings(input, minimum=4, radix, label) {
  const output=[];
  let start=0;
  for(let offset=0;offset<=input.length;offset++) {
    const value=input[offset];
    if(value===9 || (value>=32 && value<=126)) continue;
    if(offset-start>=minimum) output.push((label ? `${label}: ` : '')+(radix ? start.toString(radix).padStart(7,' ')+' ' : '')+input.subarray(start,offset).toString('ascii')+'\n');
    start=offset+1;
  }
  return Buffer.from(output.join(''));
}
const stringsInputs = [
  ['ascii-boundaries',[],Buffer.from('abc\0ABCD\0tail'),4],
  ['tab-is-printable',['-a'],Buffer.from('A\tBC\0D\tEF\rGH\n'),4],
  ['minimum-one',['-n','1'],Buffer.from([0,9,10,32,126,127,128,255,65]),1],
  ['utf8-separates-ascii',[],Buffer.from('ABCDéEFGH界IJKL'),4],
  ['invalid-utf8',[],Buffer.from([65,66,67,68,255,195,40,69,70,71,72,0]),4],
  ['offset-decimal',['-t','d'],Buffer.from('\0ABCD\0'.repeat(4)+'tail'),4,10],
  ['offset-hex',['-t','x'],Buffer.from('\0ABCD\0'.repeat(4)+'tail'),4,16],
  ['offset-octal',['-t','o'],Buffer.from('\0ABCD\0'.repeat(4)+'tail'),4,8],
  ['minimum-legacy',['-5'],Buffer.from('four\0fives\0ending'),5],
  ['minimum-long',['--bytes=5'],Buffer.from('four\0fives\0ending'),5],
  ['all-byte-classifications',['-n','1'],Buffer.from(Array.from({length:256},(_,value)=>value)),1],
  ['long-run-reused-buffer',[],Buffer.from('R'.repeat(65537)+'\0tail'),4],
];
for(const [id,args,input,minimum,radix] of stringsInputs) {
  add('strings',id,args,input,{}, {oracle:'Independent GNU C raw profile specification; GNU strings runtime unavailable',expected:{stdoutHex:rawStrings(input,minimum,radix).toString('hex'),stderrHex:'',exitCode:0}});
  const result=spawnSync('/usr/bin/strings',args,{input,env:environment,timeout:3000,maxBuffer:4*1024*1024});
  controls.push({id:`strings-${id}`,profile:'Apple Xcode strings stdin; NOT GNU oracle',args,locale:'C',status:result.status,signal:result.signal,error:result.error?.message,stdoutHex:result.stdout.toString('hex'),stderrHex:result.stderr.toString('hex')});
}
add('strings','file-label-offsets',['-af','-t','x','one','two'],'',{one:'\0HELLO\0',two:'WORLD\0'}, {oracle:'GNU C raw profile specification',expected:{stdoutHex:Buffer.concat([rawStrings(Buffer.from('\0HELLO\0'),4,16,'one'),rawStrings(Buffer.from('WORLD\0'),4,16,'two')]).toString('hex'),stderrHex:'',exitCode:0}});
add('strings','operand-runs-do-not-join',['one','two'],'',{one:'ABC',two:'DEF'}, {oracle:'GNU C raw profile specification',expected:{stdoutHex:'',stderrHex:'',exitCode:0}});
add('strings','dash-stdin-extension',['-','one','-'],'STDIN\0',{one:'FILE\0'}, {oracle:'Explicit user batch stdin-dash contract, distinct from GNU position-dependent raw option',expected:{stdoutHex:Buffer.from('STDIN\nFILE\n').toString('hex'),stderrHex:'',exitCode:0}});
for(const args of [['-n','0'],['-n','2x'],['-n'],['-t','q'],['--bogus']]) add('strings',`invalid-${cases.length}`,args,'ABCD',{}, {negative:true,oracle:'Explicit rejection requirement',expected:{stdoutHex:'',stderrHex:null,exitCode:1}});
const intent={
  frozenBeforeAuthorSource:true,
  sourceExposure:'No author implementation or author tests read; no module execution',
  stressIntents:['real Shell opt-in plugin and literal context.invoke dispatch','each native fixture replay with byte-precise stdout,status and relevant missing-path diagnostics','selected one-byte and reused-buffer replays','VFS directory,missing,EACCES,errno-shaped abort fidelity','invocation-local input/output/file/argument/record/chunk/work caps across operands','shell shared output and command limits remain composed','pre-abort,blocked stdin,blocked VFS read,blocked sink abort; observe late rejections','actual sink backpressure no concurrent writes or mutation','complex printf|expand|fold|tac pipeline with tee/sort/head/wc and VFS redirects','no process/host FS/dependency source fallback audit','strings raw synthetic object marker contrasts with data/encoding rejection; no full object parity claim'],
  diagnosticPolicy:'Exact output bytes and exitCode for native positives; nonzero invalid flags with nonempty command-named diagnostics; missing operand native status and surviving bytes plus meaningful path/no-such-file text. Native stderr retained unmodified, not universally exact GNU prose parity.',
  nonNativeStrings:'Independent raw byte scanner from primary GNU documented C/default7-bit+tab semantics; Apple captures separately classified. Numeric offsets width7 require primary source confirmation before treating formatting mismatch as product bug.',
  primarySources:['retained coreutils-9.7/doc/coreutils.texi','retained src/tac.c,expand.c,expand-common.c,fold.c','https://sourceware.org/binutils/docs/binutils/strings.html','https://raw.githubusercontent.com/apple-oss-distributions/cctools/main/misc/strings.c'],
};
const artifacts = {'cases.json':cases,'native-controls.json':controls,'intent.json':intent};
const hashes={};
for(const [name,data] of Object.entries(artifacts)){const content=JSON.stringify(data,null,2)+'\n';writeFileSync(join(privateRoot,name),content);hashes[name]=sha(content);}
hashes['freeze.mjs']=sha(readFileSync(join(privateRoot,'freeze.mjs')));
const nativeArtifacts={};
for(const path of ['src/tac','src/expand','src/fold','src/tac.c','src/expand.c','src/expand-common.c','src/fold.c','doc/coreutils.texi']) nativeArtifacts[path]=sha(readFileSync(join(oracle,path)));
for(const path of ['/usr/bin/expand','/usr/bin/fold','/usr/bin/strings','/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/strings']) nativeArtifacts[path]=sha(readFileSync(path));
const manifest={frozenAt:new Date().toISOString(),hashes,nativeArtifacts,caseCounts:Object.fromEntries(['tac','expand','fold','strings'].map(command=>[command,cases.filter(item=>item.command===command).length])),nativeExpected:cases.filter(item=>item.oracle==='GNU coreutils9.7 Darwin').length,specExpected:cases.filter(item=>item.oracle!=='GNU coreutils9.7 Darwin').length,separateNativeControls:controls.length,environment,node:process.version,platform:process.platform,arch:process.arch,head:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),argv:process.argv,notes:'Native fixtures are private generated input artifacts, not executable binaries; controls are not additional product passes.'};
writeFileSync(join(privateRoot,'FROZEN.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
