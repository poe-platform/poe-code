import type {Option} from "commander";
import type {ArraySchema} from "toolcraft-schema-rust";
import type {CLIOutputFormats} from "./cli-policy.js";
import type {OutputMode} from "./renderer.js";
import type {LogLevel} from "./index.js";
export interface ResolvedFlags {
  json?: boolean;
  preset?: string;
  yes?: boolean;
  output?: OutputMode;
  debug?: "trim"|"raw"|boolean;
  logLevel?: LogLevel;
  verbose?: boolean;
}
export declare function splitArrayInput(value:string):string[];
export declare function isNegativeNumericToken(token:string):boolean;
export declare function isNextArrayOptionToken(token:string,schema:ArraySchema<any>):boolean;
export declare function normalizeNumericArrayOptions(argv:string[],options:readonly Option[],numericArrayOptions:ReadonlySet<Option>):string[];
export declare function resolveHelpOutput(argv:string[]):OutputMode;
export declare function resolveOutput(resolvedFlags:ResolvedFlags):OutputMode;
export declare function resolveOutputFromArgv(argv:readonly string[],formats?:CLIOutputFormats):OutputMode;
export declare function toDesignSystemOutput(output:OutputMode):"terminal"|"markdown"|"json";
export declare function resolveDebugStackMode(value:unknown):"trim"|"raw"|undefined;
export declare function getDebugStackModeFromArgv(argv:readonly string[]):"trim"|"raw"|undefined;
