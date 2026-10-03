import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

export function loadHostedOAuthReference(names,capabilities={}){
  const source=ts.createSourceFile("http-hosted-oauth.ts",readFileSync(new URL("../../toolcraft/src/http-hosted-oauth.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
  const printer=ts.createPrinter();
  const declarations=source.statements.filter(node=>(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&names.includes(node.name?.text));
  assert.equal(declarations.length,names.length);
  const code=declarations.map(node=>{const modifiers=node.modifiers?.filter(modifier=>modifier.kind!==ts.SyntaxKind.ExportKeyword);const declaration=ts.isClassDeclaration(node)?ts.factory.updateClassDeclaration(node,modifiers,node.name,node.typeParameters,node.heritageClauses,node.members):ts.factory.updateFunctionDeclaration(node,modifiers,node.asteriskToken,node.name,node.typeParameters,node.parameters,node.type,node.body);return printer.printNode(ts.EmitHint.Unspecified,declaration,source);}).join("\n");
  return new Function(...Object.keys(capabilities),'"use strict";\n'+ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`\nreturn {${names.join(",")}};`)(...Object.values(capabilities));
}

export const reference=loadHostedOAuthReference(["isHostedOAuthConfiguration","normalizePublicUrl","configurationErrors","hostedOAuth","loginField"]);
