export interface BinaryExistsDetectorResult {
  exitCode: number;
  stdout: string;
}

export interface BinaryExistsDetector {
  command: string;
  args: string[];
  validate(result: BinaryExistsDetectorResult): boolean;
}

export function createBinaryExistsDetectors(binaryName: string): BinaryExistsDetector[] {
  const commonPaths = [
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
    `$HOME/.local/bin/${binaryName}`,
    `$HOME/.claude/local/bin/${binaryName}`
  ];

  return [
    {
      command: "which",
      args: [binaryName],
      validate: (result) => result.exitCode === 0
    },
    {
      command: "where",
      args: [binaryName],
      validate: (result) => result.exitCode === 0 && result.stdout.trim().length > 0
    },
    {
      command: "sh",
      args: ["-c", commonPaths.map((p) => `test -f "${p}"`).join(" || ")],
      validate: (result) => result.exitCode === 0
    }
  ];
}
