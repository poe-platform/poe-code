import { deepCopyToSandbox, type SandboxValue } from "../interp/values.js";

export type HarnessFrontmatter = Record<string, SandboxValue>;

export type HarnessModuleMeta = {
  kind: SandboxValue;
  version: SandboxValue;
  filepath: string;
  frontmatter: HarnessFrontmatter;
};

export type HarnessModule = {
  tasks: SandboxValue;
  agents: SandboxValue;
  meta: HarnessModuleMeta;
};

export function makeHarnessModule(
  frontmatter: Record<string, unknown>,
  meta: {
    kind: unknown;
    version: unknown;
    filepath: string;
  }
): HarnessModule {
  const copiedFrontmatter = copyHarnessValue(frontmatter) as HarnessFrontmatter;

  return {
    tasks: copyHarnessValue(copiedFrontmatter.tasks),
    agents: copyHarnessValue(copiedFrontmatter.agents),
    meta: {
      kind: copyHarnessValue(meta.kind),
      version: copyHarnessValue(meta.version),
      filepath: meta.filepath,
      frontmatter: copiedFrontmatter
    }
  };
}

function copyHarnessValue(value: unknown): SandboxValue {
  return deepCopyToSandbox(value);
}
