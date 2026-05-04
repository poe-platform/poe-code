import { fileURLToPath } from "node:url";

export type BuiltinTemplate = {
  kind: string;
  ajsPath: string;
  mdPath: string;
};

export function listBuiltinTemplates(): readonly BuiltinTemplate[] {
  return [
    template("ralph-demo"),
    template("experiment-demo"),
    template("pipeline-demo"),
    template("superintendent-demo")
  ];
}

function template(kind: string): BuiltinTemplate {
  return {
    kind,
    ajsPath: fileURLToPath(new URL(`${kind}/${kind}.ajs`, import.meta.url)),
    mdPath: fileURLToPath(new URL(`${kind}/${kind}.md`, import.meta.url))
  };
}
