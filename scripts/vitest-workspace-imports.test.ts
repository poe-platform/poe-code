import {readFileSync} from "node:fs";
import path from "node:path";
import {runInNewContext} from "node:vm";
import {createFsFromVolume,Volume} from "memfs";
import ts from "typescript";
import {expect,it} from "vitest";

// Execute the actual config hook with in-memory packages, without loading unrelated aliases.
const config=readFileSync(new URL("../vitest.config.ts",import.meta.url),"utf8");
const syntax=ts.createSourceFile("vitest.config.ts",config,ts.ScriptTarget.ES2022,true);
const declaration=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="workspaceImportsPlugin");
if(!declaration)throw new Error("Missing workspace private import resolver");
const compiled=ts.transpileModule(declaration.getText(syntax),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(files:Record<string,string>){const volume=Volume.fromJSON(files),fs=createFsFromVolume(volume),hook=runInNewContext(`${compiled}\nworkspaceImportsPlugin()`,{path,fs,__dirname:"/repo"});hook.resolve=(id:string,importer:string,options:{skipSelf:boolean})=>{expect(importer).toBeTruthy();expect(options).toEqual({skipSelf:true});return id;};return hook as {resolveId(specifier:string,importer?:string):string|undefined};}
function manifest(imports:Record<string,unknown>){return JSON.stringify({name:"fixture",imports});}
it("keeps repeated private specifiers scoped to each importing package",()=>{
 const hook=fixture({"/repo/packages/first/package.json":manifest({"#tiny-mcp-spawn":{types:"./src/types.d.ts",workerd:"./dist/spawn.browser.js",default:"./dist/spawn.node.js"}}),"/repo/packages/first/src/spawn.node.ts":"first","/repo/packages/second/package.json":manifest({"#tiny-mcp-spawn":"./src/spawn.node.ts"}),"/repo/packages/second/src/spawn.node.ts":"second"});
 expect(hook.resolveId("#tiny-mcp-spawn","/repo/packages/first/src/nested/index.ts")).toBe("/repo/packages/first/src/spawn.node.ts");
 expect(hook.resolveId("#tiny-mcp-spawn","/repo/packages/second/src/index.ts")).toBe("/repo/packages/second/src/spawn.node.ts");
 expect(hook.resolveId("#tiny-mcp-spawn","/repo/packages/first/src/index.ts?worker_file&type=module")).toBe("/repo/packages/first/src/spawn.node.ts");
});
it("keeps generated runtime targets when only declaration sources exist",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#template":{types:"./src/template-data.d.ts",default:"./dist/template-data.js"}}),"/repo/packages/pkg/src/template-data.d.ts":"export declare const data:string;","/repo/packages/pkg/dist/template-data.js":"export const data='template';"});expect(hook.resolveId("#template","/repo/packages/pkg/src/index.ts")).toBe("/repo/packages/pkg/dist/template-data.js");});
it("resolves nested Node import conditions and skips type and Worker branches",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#runtime":{types:{default:"./src/types.d.ts"},workerd:"./src/worker.ts",browser:"./src/browser.ts",node:{require:"./src/require.cjs",import:"./src/node.ts"},default:"./src/fallback.ts"}})});expect(hook.resolveId("#runtime","/repo/packages/pkg/src/index.ts")).toBe("/repo/packages/pkg/src/node.ts");});
it("preserves condition declaration priority including an early default",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#runtime":{default:"./src/default.ts",node:"./src/node.ts"}})});expect(hook.resolveId("#runtime","/repo/packages/pkg/src/index.ts")).toBe("/repo/packages/pkg/src/default.ts");});
it("stops at the nearest package manifest even when a parent declares the name",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#runtime":"./src/parent.ts"}),"/repo/packages/pkg/src/nested/package.json":manifest({"#other":"./other.ts"})});expect(hook.resolveId("#runtime","/repo/packages/pkg/src/nested/index.ts")).toBeUndefined();expect(hook.resolveId("#other","/repo/packages/pkg/src/nested/index.ts")).toBe("/repo/packages/pkg/src/nested/other.ts");});
it("leaves other specifiers and importers to the normal resolver",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#runtime":"./src/node.ts"}),"/repo/packages-other/pkg/package.json":manifest({"#runtime":"./src/foreign.ts"}),"/repo/package.json":manifest({"#runtime":"./root.ts"})});for(const importer of [undefined,"/repo/src/index.ts","/repo/packages-other/pkg/src/index.ts","/elsewhere/packages/pkg/index.ts"])expect(hook.resolveId("#runtime",importer)).toBeUndefined();for(const name of ["node:fs","./local.js","@poe-code/pipeline"])expect(hook.resolveId(name,"/repo/packages/pkg/src/index.ts")).toBeUndefined();});
it("preserves built mjs targets and maps existing source mjs files",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#native":"./dist/native/loader.mjs","#source":"./dist/source.mjs"}),"/repo/packages/pkg/src/source.mjs":"export default 1;"});expect(hook.resolveId("#native","/repo/packages/pkg/src/index.ts")).toBe("/repo/packages/pkg/dist/native/loader.mjs");expect(hook.resolveId("#source","/repo/packages/pkg/src/index.ts")).toBe("/repo/packages/pkg/src/source.mjs");});
it("defers missing, external, and inactive-condition targets",()=>{const hook=fixture({"/repo/packages/pkg/package.json":manifest({"#external":"some-package","#worker":{workerd:"./dist/worker.js"},"#disabled":null})});for(const name of ["#missing","#external","#worker","#disabled"])expect(hook.resolveId(name,"/repo/packages/pkg/src/index.ts")).toBeUndefined();});
it("loads owner-scoped platform imports through the actual Vite module runner",async()=>{const {FsError}=await import("../packages/safe-fs/src/contracts/errors.js");expect(new FsError("ENOENT").code).toBe("ENOENT");});
