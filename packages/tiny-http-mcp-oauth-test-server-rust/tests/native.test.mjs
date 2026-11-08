import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('../dist/tiny-http-mcp-oauth-test-server-rust.node');
const unwrap=value=>JSON.parse(value);
test('native configuration preserves diagnostics and TypeError',()=>{
 assert.deepEqual(unwrap(native.mcpOAuthFixtureOptions('{}')).value,{mcpPath:'/mcp',scopes:['mcp.read'],ttlSeconds:60,autoApprove:false});
 assert.deepEqual(unwrap(native.mcpOAuthFixtureOptions('{"ttlSeconds":{"nativeNonFinite":"Infinity"}}')).fault,{name:'TypeError',message:'ttlSeconds must be a positive integer, received Infinity'});
});
test('native listeners retain generation and cleanup priority without host callbacks',()=>{
 const core=new native.NativeMcpOAuthFixture();
 const call=(name,value={})=>unwrap(core.call(name,JSON.stringify(value)));
 assert.equal(call('start').value,0);
 assert.equal(call('start').fault.message,'MCP OAuth test server is already listening');
 const first=call('bound').value;call('closed',first);call('start');const second=call('bound').value;
 assert.equal(call('close_needed',first).value,false);assert.equal(call('close_needed',second).value,true);
 assert.equal(call('first_rejection',[{status:'rejected'},{status:'rejected'}]).value,0);
});
test('standalone adapters contain no SDK or external package import edges',async()=>{
 const {readdirSync,readFileSync,lstatSync,realpathSync}=await import('node:fs'),{fileURLToPath}=await import('node:url'),{sep}=await import('node:path'),{default:ts}=await import('typescript');
 const packageRoot=new URL('../',import.meta.url),imports=JSON.parse(readFileSync(new URL('package.json',packageRoot),'utf8')).imports??{};
 const distPath=realpathSync(new URL('dist/',packageRoot))+sep;
 function localTargets(target){
  if(typeof target==='string'){
   assert.ok(target.startsWith('./dist/'),`Package import target is not emitted: ${target}`);
   const file=new URL(target,packageRoot),filename=fileURLToPath(file);
   assert.ok(filename.startsWith(distPath),`Package import escapes its emitted tree: ${target}`);
   assert.ok(lstatSync(file).isFile(),`Package import target is not a regular file: ${target}`);
   assert.equal(realpathSync(file),filename,`Package import target redirects outside its declared path: ${target}`);
   return;
  }
  assert.ok(target&&typeof target==='object'&&!Array.isArray(target)&&Object.keys(target).length,'Package import needs local conditional targets');
  for(const branch of Object.values(target))localTargets(branch);
 }
 for(const target of Object.values(imports))localTargets(target);
 function walk(root){for(const entry of readdirSync(root,{withFileTypes:true})){const path=new URL(entry.name,root);if(entry.isDirectory()){walk(new URL(entry.name+'/',root));continue;}if(!entry.name.endsWith('.js')&&!entry.name.endsWith('.d.ts')||entry.name==='native.d.ts')continue;
  const source=ts.createSourceFile(entry.name,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node){let edge;if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))edge=node.moduleSpecifier;else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(source)==='require'))edge=node.arguments[0];
   if(edge&&ts.isStringLiteral(edge)){
    if(edge.text.startsWith('#')){
     assert.ok(Object.hasOwn(imports,edge.text),`${path.pathname}: undefined package import ${edge.text}`);
     localTargets(imports[edge.text]);
    }else assert.ok(edge.text.startsWith('node:')||edge.text.startsWith('.'),`${path.pathname}: ${edge.text}`);
   }
   ts.forEachChild(node,visit);
  }visit(source);
 }}walk(new URL('../dist/',import.meta.url));
});

test('embedded stdio adapter shares its standalone protocol error constructor',async()=>{
 const {ToolError}=await import('../dist/protocol-errors.js');
 const adapter=await import('../dist/http/stdio-server.js');
 assert.equal(adapter.ToolError,ToolError);
 const data={retryable:true},error=new adapter.ToolError(-32000,'tool failed',data);
 assert.ok(error instanceof Error);
 assert.equal(error.name,'ToolError');
 assert.equal(error.code,-32000);
 assert.equal(error.message,'tool failed');
 assert.equal(error.data,data);
 assert.throws(()=>new adapter.ToolError(Infinity,'invalid'),{message:'ToolError code must be a finite number'});
});

for(const condition of [undefined,'workerd','browser','worker'])test(`embedded client resolves its local spawn adapter (${condition??'default'})`,async()=>{
 const {spawnSync}=await import('node:child_process');
 const source=`
  import assert from 'node:assert/strict';
  const adapter=await import('#tiny-mcp-spawn');
  const transport=await import('./dist/http/client/transports.js');
  assert.equal(typeof transport.defaultStdioSpawn,'function');
  if(process.argv[1]==='default')assert.equal(adapter.spawn,(await import('node:child_process')).spawn);
  else assert.throws(()=>transport.defaultStdioSpawn('unused',[],{}),{
   name:'TypeError',message:'This host requires an explicit MCP process adapter; use HTTP or supply spawn.'
  });
 `;
 const result=spawnSync(process.execPath,[...(condition?[`--conditions=${condition}`]:[]),'--input-type=module','--eval',source,condition??'default'],{
  cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000
 });
 assert.ifError(result.error);
 assert.equal(result.status,0,result.stderr);
});
