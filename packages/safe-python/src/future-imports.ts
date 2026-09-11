import type { Module, Statement } from "./statement-ast.js";
import { PythonSyntaxError, type SourceMeter } from "./source.js";
import { statementChildren } from "./statement-children.js";

const supportedFeatures = new Set(["nested_scopes", "generators", "division", "absolute_import", "with_statement", "print_function", "unicode_literals", "barry_as_FLUFL", "generator_stop", "annotations"]);

export function isFutureImport(statement: Statement): statement is Extract<Statement, { kind: "import-from" }> {
  return statement.kind === "import-from" && statement.level === 0 && statement.module.length === 1 && statement.module[0]!.name === "__future__";
}

/** Validate directive placement/names and report the module's declared features. */
export function validateFutureImports(module: Module, filename = "<string>",meter?:SourceMeter): ReadonlySet<string> {
  meter?.checkpoint(1,64);
  try {
  const features = new Set<string>();
  let beginning = true;
  function rejectNested(statement: Statement): void {
    // Keep only the active path, preserving depth-first error precedence without
    // recursing through the host stack or copying every sibling into a worklist.
    meter?.checkpoint(1,208);
    const pending=[{children:statementChildren(statement,meter),local:statement.kind==="function"||statement.kind==="class"}];
    while(pending.length){
      meter?.checkpoint();
      const frame=pending[pending.length-1],next=frame.children.next();
      if(next.done){pending.pop();continue;}
      const child=next.value;
      if (isFutureImport(child)) {
        meter?.checkpoint(0,384);
        throw new PythonSyntaxError(frame.local&&child.imports==="*"?"import * only allowed at module level":"from __future__ imports must occur at the beginning of the file", filename, child.start);
      }
      meter?.checkpoint(0,176);pending.push({children:statementChildren(child,meter),local:frame.local||child.kind==="function"||child.kind==="class"});
    }
  }
  for (let index = 0; index < module.body.length; index++) {
    meter?.checkpoint();
    const statement = module.body[index]!;
    if (index === 0 && statement.kind === "expression-statement" && statement.expression.kind === "literal" && statement.expression.literalKind === "string") continue;
    if (isFutureImport(statement)) {
      if (!beginning) {meter?.checkpoint(0,384);throw new PythonSyntaxError("from __future__ imports must occur at the beginning of the file", filename, statement.start);}
      if (statement.imports === "*") {meter?.checkpoint(0,320);throw new PythonSyntaxError("future feature * is not defined", filename, statement.start);}
      for (const item of statement.imports) {
        const feature = item.path[0]!;
        meter?.checkpoint(1+feature.name.length);
        if (!supportedFeatures.has(feature.name)) {meter?.checkpoint(0,320+2*feature.name.length);throw new PythonSyntaxError(feature.name === "braces" ? "not a chance" : `future feature ${feature.name} is not defined`, filename, feature.start);}
        if(!features.has(feature.name))meter?.checkpoint(0,32);
        features.add(feature.name);
      }
    } else {
      beginning = false;
      rejectNested(statement);
    }
  }
  return features;
  } finally {meter?.checkpoint();}
}
