import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {ToolError,JSON_RPC_ERROR_CODES,toContentBlocks} from "tiny-stdio-mcp-server";
import {assertCommandRequirements,resolveCommandSecrets} from "../../toolcraft/dist/index.js";
import {ApprovalDeclinedError} from "../../toolcraft/dist/human-in-loop/types.js";
import {isMCPResult} from "../../toolcraft/dist/mcp-result.js";
import {writeErrorReport} from "../../toolcraft/dist/error-report.js";
import {createFs,createEnv} from "../../toolcraft/dist/runtime/io.js";
import {reference} from "./mcp-validation-reference.mjs";
import {original} from "./mcp-errors-reference.mjs";

const source=ts.createSourceFile("mcp.ts",readFileSync(new URL("../../toolcraft/src/mcp.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
const server=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="createResolvedMCPServer");
const handlers=[];
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="handler")handlers.push(node.initializer);ts.forEachChild(node,visit);}
visit(server);assert.equal(handlers.length,1);
const expression=ts.createPrinter().printNode(ts.EmitHint.Expression,handlers[0],source);
const code=ts.transpileModule(`const handler=${expression};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
export function createReferenceHandler(tool,environment,overrides={}){
  const capabilities={ToolError,JSON_RPC_ERROR_CODES,toContentBlocks,assertCommandRequirements,resolveCommandSecrets,ApprovalDeclinedError,isMCPResult,writeErrorReport,createFs,createEnv,...reference,...original,...overrides};
  return new Function(...Object.keys(capabilities),"tool","environment",'"use strict"; const {options,runtime,services,humanInLoop,root,runtimeFetch,diagnostics,casing}=environment;\n'+code+"\nreturn handler;")(...Object.values(capabilities),tool,environment);
}
