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
  applyConstraints: (prompt: string) => string;
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
  const constraints = readConstraints(copiedFrontmatter);

  return {
    tasks: copyHarnessValue(copiedFrontmatter.tasks),
    agents: copyHarnessValue(copiedFrontmatter.agents),
    meta: {
      kind: copyHarnessValue(meta.kind),
      version: copyHarnessValue(meta.version),
      filepath: meta.filepath,
      frontmatter: copiedFrontmatter
    },
    applyConstraints: (prompt: string) => applyConstraints(prompt, constraints)
  };
}

function copyHarnessValue(value: unknown): SandboxValue {
  return deepCopyToSandbox(value);
}

function readConstraints(frontmatter: HarnessFrontmatter): string[] {
  const constraints = new Set<string>();

  appendConstraintValues(constraints, frontmatter.principles);
  appendConstraintValues(constraints, frontmatter.constraints);

  return [...constraints];
}

function appendConstraintValues(constraints: Set<string>, value: SandboxValue): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("constraints/principles must be strings");
    }

    constraints.add(item);
  }
}

function applyConstraints(prompt: string, constraints: readonly string[]): string {
  if (constraints.length === 0) {
    return prompt;
  }

  const preamble = `CONSTRAINTS (hard rules, honor all):\n${constraints
    .map((constraint) => `- ${constraint}`)
    .join("\n")}`;

  return prompt.length === 0 ? preamble : `${preamble}\n\n${prompt}`;
}
