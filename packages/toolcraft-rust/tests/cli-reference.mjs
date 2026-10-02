import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {Option,InvalidArgumentError} from "commander";
import {ToolcraftBugError,UserError,isUserError} from "../../toolcraft/dist/index.js";
import {LOG_LEVELS} from "../../toolcraft/dist/runtime-logging.js";
import {suggest} from "../../toolcraft/dist/suggest.js";
import {unicodeLength} from "../../toolcraft-schema/dist/index.js";
import {getExpectedNumberDescription,isValidNumberSchemaValue} from "../../toolcraft/dist/number-schema.js";
import {renderSourceSnippet} from "../../toolcraft/dist/source-snippet.js";

// Select actual reference declarations in memory, without copying algorithms,
// writing generated fixtures, or adding exports to the JavaScript implementation.
export function loadCLIReference(names,constants=[]){
  const source=ts.createSourceFile("cli.ts",readFileSync(new URL("../../toolcraft/src/cli.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
  const printer=ts.createPrinter();
  const declarations=source.statements.flatMap(node=>{
    if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))return [printer.printNode(ts.EmitHint.Unspecified,ts.factory.updateFunctionDeclaration(node,node.modifiers?.filter(modifier=>modifier.kind!==ts.SyntaxKind.ExportKeyword),node.asteriskToken,node.name,node.typeParameters,node.parameters,node.type,node.body),source)];
    if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&constants.includes(declaration.name.text)))return [printer.printNode(ts.EmitHint.Unspecified,node,source)];
    return [];
  });
  assert.equal(declarations.length,names.length+constants.length);
  return new Function("ToolcraftBugError","UserError","LOG_LEVELS","suggest","unicodeLength","getExpectedNumberDescription","isValidNumberSchemaValue","renderSourceSnippet","Option","InvalidArgumentError","isUserError",'"use strict";\n'+ts.transpileModule(declarations.join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`\nreturn {${names.join(",")}};`)(ToolcraftBugError,UserError,LOG_LEVELS,suggest,unicodeLength,getExpectedNumberDescription,isValidNumberSchemaValue,renderSourceSnippet,Option,InvalidArgumentError,isUserError);
}
