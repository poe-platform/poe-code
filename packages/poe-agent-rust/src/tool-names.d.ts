export declare class InvalidToolNameError extends Error {
  constructor(name: string, contributor?: string);
}
export declare function assertValidToolName(name: string, contributor?: string): void;
