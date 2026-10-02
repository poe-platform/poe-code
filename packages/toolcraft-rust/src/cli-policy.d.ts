import type {Command,RenderPrimitives} from "./index.js";
export type Casing = "kebab" | "snake";
export type CLIHelpDepth = "concise" | "extended";
export interface CLIControls {
  debug?: boolean;
  help?: CLIHelpDepth;
  logLevel?: boolean;
  output?: boolean | CLIOutputControl;
  verbose?: boolean;
  yes?: boolean;
}
export interface CLIOutputFormatContext {
  command: Command<any,any,any,any>;
  commandPath: string;
  primitives: RenderPrimitives;
  result: unknown;
}
export type CLIOutputFormatRenderer = (context: CLIOutputFormatContext) => string | undefined;
export type CLIOutputFormats = Readonly<Record<string,CLIOutputFormatRenderer>>;
export interface CLIOutputControl { formats?: CLIOutputFormats; }
export interface ResolvedCLIControls {
  debug: boolean;
  help: CLIHelpDepth;
  logLevel: boolean;
  output: boolean;
  outputFormats: CLIOutputFormats;
  verbose: boolean;
  yes: boolean;
}
export interface CLICommandTreeSnapshotOption {
  name: string;
  flags: string[];
  type: string;
  required: boolean;
  hidden: boolean;
  description?: string;
  default?: unknown;
  positional?: boolean;
  global?: boolean;
  dynamic?: boolean;
  choices?: string[];
}
export declare function formatCLIName(segment:string,casing:Casing):string;
export declare function resolveCLIControls(controls:CLIControls|undefined):ResolvedCLIControls;
export declare function getGlobalLongOptionFlags(presetsEnabled:boolean,versionEnabled:boolean,controls:ResolvedCLIControls):ReadonlySet<string>;
export declare function createGlobalSnapshotOptions(presetsEnabled:boolean,versionEnabled:boolean,controls:ResolvedCLIControls):CLICommandTreeSnapshotOption[];
