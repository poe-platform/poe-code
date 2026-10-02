import { joinPath } from "@poe-code/safe-fs/runtime-core";
import { fileURLToPath } from "#harness-platform";

export type BuiltinTemplate = {
  kind: string;
  ajsPath: string;
  mdPath: string;
};

export function listBuiltinTemplates(directory?: string): readonly BuiltinTemplate[] {
  return [
    template("ralph-demo", directory),
    template("coverage-demo", directory),
    template("experiment-demo", directory),
    template("pipeline-demo", directory),
    template("superintendent-demo", directory)
  ];
}

function template(kind: string, directory?: string): BuiltinTemplate {
  return {
    kind,
    ajsPath: directory ? joinPath(directory, kind, `${kind}.ajs`) : fileURLToPath(new URL(`${kind}/${kind}.ajs`, import.meta.url)),
    mdPath: directory ? joinPath(directory, kind, `${kind}.md`) : fileURLToPath(new URL(`${kind}/${kind}.md`, import.meta.url))
  };
}
