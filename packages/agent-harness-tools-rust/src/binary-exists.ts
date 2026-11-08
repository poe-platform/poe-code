import { native } from "./native.js";
export interface BinaryExistsDetectorResult {
  exitCode: number;
  stdout: string;
}
export interface BinaryExistsDetector {
  command: string;
  args: string[];
  validate(result: BinaryExistsDetectorResult): boolean;
}
// Immutable policy is admitted once; Node retains the result callbacks and JS trim.
const templates = native.harnessBinaryDetectors("");
export function createBinaryExistsDetectors(binaryName: string): BinaryExistsDetector[] {
  return templates.map((probe) => {
    const args = probe.args.slice();
    args[probe.nameIndex] = binaryName;
    return {
      command: probe.command,
      args,
      validate: (result) =>
        result.exitCode === 0 && (!probe.requiresOutput || result.stdout.trim().length > 0)
    };
  });
}
