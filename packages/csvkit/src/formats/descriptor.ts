import type { Runtime } from "../runtime.js";
export interface FormatDescriptor {
  readonly name: string;
  readonly extensions?: readonly string[];
  readonly inferredBy?: string;
  readonly extensionless?: boolean;
  readonly sheetNames?: boolean;
  readonly convert?: (runtime: Runtime) => Promise<number>;
}
