import type {Command as CommanderCommand} from "commander";
import type {Casing,ResolvedCLIControls} from "./cli-policy.js";
import type {DynamicFieldDefinition} from "./cli-fields.js";
export declare function prepareCliArguments(program:CommanderCommand,argv:string[],fieldLoaders:ReadonlyMap<CommanderCommand,()=>DynamicFieldDefinition[]>,casing:Casing,controls:ResolvedCLIControls):{argv:string[];helpArgv?:string[]};
export declare function getDefaultCommanderCommandName(command:CommanderCommand):string|undefined;
