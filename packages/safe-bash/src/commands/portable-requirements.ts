import type { CommandFileSystemRequirement } from "../contracts/command-requirements.js";

export const inputRequirements: readonly CommandFileSystemRequirement[] = [
  { id: "stdin", description: "Read standard input", capabilities: [] },
  { id: "file", description: "Read file operands", capabilities: [], anyOf: [["streamingRead"], ["read"]] },
];

export const textOutputRequirements: readonly CommandFileSystemRequirement[] = [
  ...inputRequirements,
  { id: "output", description: "Write or truncate an output file", capabilities: [], anyOf: [["streamingWrite"], ["write"]], mutates: true },
];

export const pwdRequirements: readonly CommandFileSystemRequirement[] = [
  { id: "logical", description: "Print the logical working directory", capabilities: [] },
  { id: "physical", description: "Resolve the physical working directory (-P)", capabilities: ["realpath"] },
];

export const predicateRequirements: readonly CommandFileSystemRequirement[] = [
  { id: "expression", description: "Evaluate strings and integers", capabilities: [] },
  { id: "metadata", description: "Inspect file metadata", capabilities: ["stat"] },
  { id: "access", description: "Inspect path access permissions", capabilities: ["access"] },
];
