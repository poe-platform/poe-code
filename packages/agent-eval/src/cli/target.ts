import path from "node:path";

export interface EvalCliTargetInput {
  evalId?: string;
  sourceDir?: string;
}

export interface ResolvedEvalCliTarget {
  sourceDir: string;
  evalId?: string;
}

export function resolveEvalCliTarget(input: EvalCliTargetInput): ResolvedEvalCliTarget {
  if (input.evalId !== ".") {
    return {
      sourceDir: path.resolve(input.sourceDir ?? process.cwd()),
      evalId: input.evalId
    };
  }

  const evalDir = path.resolve(input.sourceDir ?? process.cwd());
  return {
    sourceDir: path.dirname(evalDir),
    evalId: path.basename(evalDir)
  };
}
