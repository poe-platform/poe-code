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
      args: [
        "-c",
        'for directory in /usr/local/bin /usr/bin "$HOME/.local/bin" "$HOME/.claude/local/bin"; do test -f "$directory/$1" && exit 0; done; exit 1',
        "sh",
        binaryName
      ],
      validate: (result) => result.exitCode === 0
    }
  ];
}
