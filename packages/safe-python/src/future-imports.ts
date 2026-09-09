import type { Module, Statement } from "./statement-ast.js";
import { PythonSyntaxError } from "./source.js";
import { statementChildren } from "./statement-children.js";

const supportedFeatures = new Set(["nested_scopes", "generators", "division", "absolute_import", "with_statement", "print_function", "unicode_literals", "barry_as_FLUFL", "generator_stop", "annotations"]);

export function isFutureImport(statement: Statement): statement is Extract<Statement, { kind: "import-from" }> {
  return statement.kind === "import-from" && statement.level === 0 && statement.module.length === 1 && statement.module[0]!.name === "__future__";
}

/** Validate directive placement/names and report the module's declared features. */
export function validateFutureImports(module: Module, filename = "<string>"): ReadonlySet<string> {
  const features = new Set<string>();
  let beginning = true;
  function rejectNested(statement: Statement): void {
    for (const child of statementChildren(statement)) {
      if (isFutureImport(child)) throw new PythonSyntaxError("from __future__ imports must occur at the beginning of the file", filename, child.start);
      rejectNested(child);
    }
  }
  for (let index = 0; index < module.body.length; index++) {
    const statement = module.body[index]!;
    if (index === 0 && statement.kind === "expression-statement" && statement.expression.kind === "literal" && statement.expression.literalKind === "string") continue;
    if (isFutureImport(statement)) {
      if (!beginning) throw new PythonSyntaxError("from __future__ imports must occur at the beginning of the file", filename, statement.start);
      if (statement.imports === "*") throw new PythonSyntaxError("future feature * is not defined", filename, statement.start);
      for (const item of statement.imports) {
        const feature = item.path[0]!;
        if (!supportedFeatures.has(feature.name)) throw new PythonSyntaxError(feature.name === "braces" ? "not a chance" : `future feature ${feature.name} is not defined`, filename, feature.start);
        features.add(feature.name);
      }
    } else {
      beginning = false;
      rejectNested(statement);
    }
  }
  return features;
}
