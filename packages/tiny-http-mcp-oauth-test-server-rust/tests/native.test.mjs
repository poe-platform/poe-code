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
 const {readdirSync,readFileSync}=await import('node:fs'),{default:ts}=await import('typescript');
 function walk(root){for(const entry of readdirSync(root,{withFileTypes:true})){const path=new URL(entry.name,root);if(entry.isDirectory()){walk(new URL(entry.name+'/',root));continue;}if(!entry.name.endsWith('.js')&&!entry.name.endsWith('.d.ts')||entry.name==='native.d.ts')continue;
  const source=ts.createSourceFile(entry.name,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node){let edge;if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))edge=node.moduleSpecifier;else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(source)==='require'))edge=node.arguments[0];
   if(edge&&ts.isStringLiteral(edge))assert.ok(edge.text.startsWith('node:')||edge.text.startsWith('.'),`${path.pathname}: ${edge.text}`);
   ts.forEachChild(node,visit);
  }visit(source);
 }}walk(new URL('../dist/',import.meta.url));
});
