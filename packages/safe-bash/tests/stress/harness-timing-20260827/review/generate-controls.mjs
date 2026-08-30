import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ready, digest, save } from './tools.mjs';

ready();
const original = readFileSync(new URL('../native-delivery.ts', import.meta.url), 'utf8');
let mutated = original;
const replacements = [
  ['import { spawn } from "node:child_process";', 'import { spawnReviewChild, guardSettings, holdClose } from "./control-observer.mjs";'],
  ['const child = spawn("rg", argv, { env, stdio: ["pipe", "pipe", "pipe"] });', 'const child = spawnReviewChild(env);'],
  ['      target.on(event, handler); ownListeners.push({ target, event, handler });', '      if (target === child && event === "close" && guardSettings.holdClose) {\n        const realHandler = handler;\n        handler = (...args: any[]) => holdClose(child, realHandler, args);\n      }\n      target.on(event, handler); ownListeners.push({ target, event, handler });'],
  ['          if (options.mutation === "suppress-readiness") return;', '          if (guardSettings.suppressReadiness) { mark("review-readiness-suppressed"); return; }\n          if (options.mutation === "suppress-readiness") return;'],
  ['      mark("write", { hex: bytes.toString("hex"), end });', '      if (guardSettings.withholdSuffix && end) { mark("review-suffix-withheld"); return; }\n      mark("write", { hex: bytes.toString("hex"), end });'],
];
for (const [before, after] of replacements) {
  assert.equal(mutated.split(before).length, 2, `one exact controlled mutation required: ${before}`);
  mutated = mutated.replace(before, after);
}
const compiled = ts.transpileModule(mutated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: true }, reportDiagnostics: true });
assert.equal(compiled.diagnostics?.length ?? 0, 0);
save('controlled-native.mjs', compiled.outputText);
save('controlled-native.ts.txt', mutated);
save('evidence/controlled-mutations.json', {
  authorSourceSha256: digest(original), controlledTypeScriptSha256: digest(mutated), emittedJavaScriptSha256: digest(compiled.outputText),
  compiler: { name: 'typescript', version: ts.version, target: 'ES2022', module: 'ES2022' }, replacements,
  scope: 'test-only native supervisor with tiny independent child; no product imports, no native oracle equivalence claim',
});
console.log(JSON.stringify({ replacements: replacements.length, source: digest(original), output: digest(compiled.outputText) }));
