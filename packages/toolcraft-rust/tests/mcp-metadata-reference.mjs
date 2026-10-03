import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

export function loadMCPMetadataReference(){
  const names=["normalizeRoots","splitWords","formatSegment","unwrapOptional","isOptional","collectParamSummaries","buildToolDescription","formatMcpExampleParams","formatMcpExampleValue","matchesAllowlist","formatToolName"];
  const source=ts.createSourceFile("mcp.ts",readFileSync(new URL("../../toolcraft/src/mcp.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
  const printer=ts.createPrinter();
  const declarations=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
  assert.equal(declarations.length,names.length);
  const code=declarations.map(node=>printer.printNode(ts.EmitHint.Unspecified,node,source)).join("\n");
  return new Function('"use strict";\n'+ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`\nreturn {${names.join(",")}};`)();
}
