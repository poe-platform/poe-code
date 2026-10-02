import type {Group} from "./index.js";
import type {HumanInLoopRuntime} from "./human-in-loop.js";
import type {Casing,CLIControls,CLICommandTreeSnapshotOption} from "./cli-policy.js";
export type {CLICommandTreeSnapshotOption} from "./cli-policy.js";
export interface CLICommandTreeSnapshotCommand {
  kind: "command";
  name: string;
  path: string[];
  aliases: string[];
  hidden: boolean;
  default: boolean;
  description?: string;
  options: CLICommandTreeSnapshotOption[];
}
export interface CLICommandTreeSnapshotGroup {
  kind: "group";
  name: string;
  path: string[];
  aliases: string[];
  hidden: false;
  default: boolean;
  description?: string;
  children: CLICommandTreeSnapshotNode[];
}
export type CLICommandTreeSnapshotNode = CLICommandTreeSnapshotCommand | CLICommandTreeSnapshotGroup;
export interface CLICommandTreeSnapshot {
  schemaVersion: 1;
  globalOptions: CLICommandTreeSnapshotOption[];
  root: CLICommandTreeSnapshotGroup;
}
export interface CLICommandTreeSnapshotOptions {
  approvals?: boolean;
  argv?: readonly string[];
  casing?: Casing;
  controls?: CLIControls;
  humanInLoop?: HumanInLoopRuntime;
  presets?: boolean;
  version?: string;
}
export declare function createCLICommandTreeSnapshot<TServices extends object>(roots:Group<TServices>|Group<TServices>[],options?:CLICommandTreeSnapshotOptions):Promise<CLICommandTreeSnapshot>;
