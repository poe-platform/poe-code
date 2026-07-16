import path from "node:path";
import { evalInit, validateInitName } from "../init/init.js";
import type { PlanKind } from "../types.js";

export interface InitCliInput {
  name: string;
  sourceDir?: string;
  kind?: PlanKind;
  targetRepo?: string;
  targetRef?: string;
}

export async function runInitCli(input: InitCliInput): Promise<number> {
  try {
    validateInitName(input.name);
    const sourceDir = path.resolve(input.sourceDir ?? process.cwd());
    const result = await evalInit({
      sourceDir,
      name: input.name,
      kind: input.kind ?? "plan",
      targetRepo: input.targetRepo,
      targetRef: input.targetRef
    });

    process.stdout.write(`created ${result.evalDir}\n`);
    process.stdout.write(`next: poe-code eval check ${input.name}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
