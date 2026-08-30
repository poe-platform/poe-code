import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from '../execution-prep-v1/artifacts.mjs';
import { digestFile } from '../execution-prep-v1/admission.mjs';
export const behaviorMutants = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'];
export function installBehaviorMutant(packageRoot, id, beforeSha256) {
  assert.ok(behaviorMutants.includes(id));
  const runtimeModule = join(packageRoot, 'dist/shell/runtime.js');
  let text = digestFile(runtimeModule, beforeSha256).toString(), requiredFailed = ['R01'], cohort = 'procedures';
  const hit = `function __dgHit() { process.stdout.write(JSON.stringify({activation:{id:${JSON.stringify(id)},hits:1}})+"\\n"); }\n`;
  const replace = (from, to) => { assert.equal(text.split(from).length, 2, id + ' unique exact mutation site'); text = text.replace(from, to); };
  if (id === 'M0') {
    text += '\nimplementedBuiltins.delete("shopt");\nconst __dgDiscovery = Runtime.prototype.internalDiscovery;\nRuntime.prototype.internalDiscovery = function(name, ...rest) { if(name === "shopt") __dgHit(); return __dgDiscovery.call(this,name,...rest); };\n';
    requiredFailed = ['R08'];
  }
  if (id === 'M1') text += '\nconst __dgGlob=Runtime.prototype.glob; Runtime.prototype.glob=function(value,pattern,state){ __dgHit(); return __dgGlob.call(this,value,pattern,{...state,dotglob:false}); };\n';
  if (id === 'M2') {
    text += '\nconst __dgGlob=Runtime.prototype.glob; Runtime.prototype.glob=async function(...args){ __dgHit(); return (await __dgGlob.apply(this,args)).filter(value=>!value.split("/").at(-1).startsWith(".")); };\n';
    requiredFailed = ['R26'];
  }
  if (id === 'M3') {
    replace('entry.name !== "." && entry.name !== ".." && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith("."))', '(__dgHit(), (!state.dotglob || (entry.name !== "." && entry.name !== ".."))) && (state.dotglob || !entry.name.startsWith(".") || segment.startsWith("."))');
    requiredFailed = ['R26'];
  }
  if (id === 'M4') {
    replace('function cloneState(state) {\n    return {\n        ...state,', 'function cloneState(state) {\n    __dgHit();\n    return {\n        ...state,\n        dotglob: false,');
    requiredFailed = ['R04'];
  }
  if (id === 'M5') {
    replace('else if (flag === "s")\n                    set = true;', 'else if (flag === "s") { __dgHit(); set = true; state.dotglob = true; }');
    requiredFailed = ['R11'];
  }
  if (id === 'M6') {
    replace('        let status = 0;\n        for (; index < context.args.length; index++) {', '        let status = 0;\n        if (context.args.slice(index).some(name => name !== "dotglob")) { __dgHit(); await this.diagnostic(context, `shopt: ${context.args.slice(index).find(name => name !== "dotglob")}: unsupported shell option name (only dotglob is supported)`); return 1; }\n        for (; index < context.args.length; index++) {');
    requiredFailed = ['R10'];
  }
  if (id === 'M7') {
    replace('await this.diagnostic(context, `shopt: ${name}: unsupported shell option name (only dotglob is supported)`);', 'if (!quiet) await this.diagnostic(context, `shopt: ${name}: unsupported shell option name (only dotglob is supported)`); else __dgHit();');
    cohort = 'unsupported'; requiredFailed = ['N-off-3-0'];
  }
  if (id === 'M8') {
    text += '\nconst __dgGlob=Runtime.prototype.glob; Runtime.prototype.glob=function(...args){ __dgHit(); this.budget.limits.maxExpansionBytes=8192; return __dgGlob.apply(this,args); };\n';
    requiredFailed = ['R16'];
  }
  text += '\n' + hit;
  writeFileSync(runtimeModule, text);
  assert.notEqual(hash(readFileSync(runtimeModule)), beforeSha256);
  return { id, cohort, requiredFailed, runtimeModule, beforeSha256, runtimeSha256: hash(Buffer.from(text)), mutationSource: text.slice(-2048), role: 'actual compiled module mutation; exact site/counter/unchanged predicate required' };
}
