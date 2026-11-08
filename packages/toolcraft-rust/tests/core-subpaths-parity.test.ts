import assert from "node:assert/strict";
import {it} from "vitest";
import * as root from "../dist/index.js";

it("Native runtime subpath matches the reference namespace and preserves root identities",async()=>{
  const [native,reference]=await Promise.all([import("toolcraft-rust/runtime"),import("toolcraft/runtime")]);
  assert.deepEqual(Object.keys(native).sort(),Object.keys(reference).sort());
  for(const name of Object.keys(reference))assert.equal(native[name],root[name],name);
  const command=native.defineCommand({name:"hello",scope:["sdk"],params:native.S.Object({name:native.S.String()}),handler:({params})=>params.name});
  const group=native.defineGroup({name:"app",children:[command],default:command});
  const cloned=native.cloneCommandNode(group);
  assert.notEqual(cloned,group);assert.equal(cloned.default,cloned.children[0]);
  assert.equal(cloned.children[0].handler,command.handler);
});

it("Native error subpath shares root classes and the reference cross-bundle policy",async()=>{
  const [native,reference]=await Promise.all([import("toolcraft-rust/user-error"),import("toolcraft/user-error")]);
  assert.deepEqual(Object.keys(native).sort(),Object.keys(reference).sort());
  assert.equal(native.UserError,root.UserError);assert.equal(native.ToolcraftBugError,root.ToolcraftBugError);assert.equal(native.isUserError,root.isUserError);
  for(const api of [native,reference]){const cause=Symbol("cause"),error=new api.UserError("failure",{cause});assert.equal(error.cause,cause);error.name="changed";assert.equal(api.isUserError(error),true);assert.equal(api.isUserError(Object.assign(new Error("external"),{name:"UserError"})),true);assert.equal(api.isUserError({name:"UserError"}),false);}
});

it("Native MCP proxy subpath exposes the existing native discovery and cache policies",async()=>{
  const [native,reference,internal]=await Promise.all([import("toolcraft-rust/mcp-proxy"),import("toolcraft/mcp-proxy"),import("../dist/mcp-proxy.js")]);
  assert.deepEqual(Object.keys(native).sort(),Object.keys(reference).sort());
  for(const name of Object.keys(reference))assert.equal(native[name],internal[name],name);
  for(const value of [undefined,"","1","true","all","calendar,mail","0"]){assert.deepEqual(native.parseRefreshEnv(value),reference.parseRefreshEnv(value));}
  const cachePath=(api,name)=>{try{return {value:api.resolveCachePath(name,"/project")};}catch(error){return {error:[error.name,error.message]};}};
  for(const name of ["calendar","nested/name","with spaces"]){assert.deepEqual(cachePath(native,name),cachePath(reference,name));}
  const group=root.defineGroup({name:"app",children:[]});assert.equal(native.hasMcpProxyGroups(group),false);await native.resolveMcpProxies(group);await native.disposeMcpProxies(group);assert.deepEqual(group.children,[]);
});
