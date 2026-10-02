import ts from "typescript";

/** Remove only a complete, literal registration of a workspace-owned evaluator. */
export function adapterStatements(source: ts.SourceFile, workspace: string, evaluator: string, internal = "../internal.js"): readonly ts.Statement[] {
  const expected = ts.createSourceFile("registration.ts", `
    import { syncCommandEvaluators } from ${JSON.stringify(internal)};
    import { ${evaluator} } from ${JSON.stringify(workspace)};
    syncCommandEvaluators.${evaluator} = ${evaluator};
  `, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const render = (statement: ts.Statement, file: ts.SourceFile) => printer.printNode(ts.EmitHint.Unspecified, statement, file);
  const registrations = expected.statements.map(statement => render(statement, expected));
  const statements = source.statements.map(statement => render(statement, source));
  if (!registrations.every(registration => statements.filter(statement => statement === registration).length === 1)) return source.statements;
  return source.statements.filter((_statement, index) => !registrations.includes(statements[index]!));
}
