import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Shell,MemoryFileSystem,agentCommands,createAgentCommands,createHtmlToMarkdownCommands,createDuCommands,createExprCommands} from 'virtual-bash';

const expected=['true','false','echo','pwd','basename','dirname','printf','mkdir','touch','cp','mv','rm','rmdir','ln','readlink','realpath','ls','cat','head','tail','wc','tee','tr','sort','uniq','cut','grep','test','[','env','xargs','find','sed','awk','jq','rg','base64','base32','xxd','od','sha256sum','sha1sum','md5sum','cksum','gzip','gunzip','zcat','diff','patch','chmod','stat','mktemp','tar','paste','comm','join','tac','expand','fold','strings','seq','nl','rev','unexpand','split','date','sleep','printenv','tree','file','egrep','fgrep','column','html-to-markdown','du','expr'];
assert.deepEqual(createAgentCommands().map(command=>command.name),expected);
const root=realpathSync(join(process.cwd(),'node_modules/virtual-bash'));
const metadata=JSON.parse(readFileSync(join(root,'package.json')));assert.deepEqual(metadata.dependencies??{},{});
const imports=[];
for(const key of Object.keys(metadata.exports).filter(key=>!key.includes('*'))){const specifier=key==='.'?'virtual-bash':'virtual-bash/'+key.slice(2);const resolved=realpathSync(fileURLToPath(import.meta.resolve(specifier)));assert.ok(resolved.startsWith(root+'/dist/'));await import(specifier);imports.push({specifier,resolved});}
assert.equal(createHtmlToMarkdownCommands,(await import('virtual-bash/commands/html-to-markdown')).createHtmlToMarkdownCommands);
assert.equal(createDuCommands,(await import('virtual-bash/commands/du')).createDuCommands);
assert.equal(createExprCommands,(await import('virtual-bash/commands/expr')).createExprCommands);
const fs=new MemoryFileSystem();const shell=new Shell({fs});await shell.use(agentCommands());
const workflows=[];
try{
  assert.deepEqual(shell.commands.list().map(command=>command.name).sort(),expected.slice().sort());
  assert.equal(shell.commands.has('curl'),false);assert.equal(shell.commands.has('safejs'),false);
  for(const[input,stdout]of [["printf '<p>Hello <em>world</em></p>' | html-to-markdown",'Hello *world*\n'],["expr 7 + 9",'16\n'],["printf 'hello' > /sample; du -b /sample",'5\t/sample\n'],["printf 'alpha\\nbeta\\n' | egrep '^a'",'alpha\n'],["printf 'alpha\\nbeta\\n' | fgrep 'beta'",'beta\n']]){const result=await shell.exec(input);assert.equal(result.exitCode,0,input);assert.equal(result.stderr,'',input);assert.equal(result.stdout,stdout,input);workflows.push({input,exitCode:result.exitCode,stdout:result.stdout});}
}finally{await shell.dispose();}
console.log(JSON.stringify({count:expected.length,imports,workflows,optionalNetwork:false,optionalSafejs:false,qualification:'bounded package smoke, not full command semantics'}));
