import type {Command as CommanderCommand} from "commander";
import type {Command,Group,LogLevel} from "./index.js";
import type {Casing,ResolvedCLIControls} from "./cli-policy.js";
import type {DynamicFieldDefinition,FieldDefinition,VariantDefinition} from "./cli-fields.js";
export interface ExecutionState<TServices extends object> {
  command:Command<TServices,any,any,any>;
  commandPath:string;
  declarationPath:readonly string[];
  casing:Casing;
  dynamicFields:DynamicFieldDefinition[];
  fields:FieldDefinition[];
  positionalValues:string[];
  presetsEnabled:boolean;
  rawArgv:string[];
  actionCommand:CommanderCommand;
  variants:VariantDefinition[];
}
export declare function createNodeCommand<TServices extends object>(node:Command<TServices,any,any,any>|Group<TServices>,casing:Casing,globalLongOptionFlags:ReadonlySet<string>,execute:(state:ExecutionState<TServices>)=>Promise<void>,presetsEnabled:boolean,controls:ResolvedCLIControls,fieldLoaders:Map<CommanderCommand,()=>DynamicFieldDefinition[]>,pathSegments?:string[]):CommanderCommand|null;
export declare function addCommanderChild(parent:CommanderCommand,child:CommanderCommand,isDefault:boolean,siblingNames:ReadonlySet<string>):void;
export declare function isToolcraftHiddenCommander(command:CommanderCommand):boolean;
export declare function getToolcraftHiddenDefaultNames(command:CommanderCommand):string[];
export declare function getToolcraftReservedChildNames(command:CommanderCommand):string[];
export declare function getNodeCommandNames<TServices extends object>(node:Command<TServices,any,any,any>|Group<TServices>):string[];
export declare function addGlobalOptions(command:CommanderCommand,presetsEnabled:boolean,controls:ResolvedCLIControls):void;
export declare function parseDebugStackMode(value:string|boolean):"trim"|"raw";
export declare function parseLogLevel(value:string):LogLevel;
export declare function formatInvalidEnumMessage(label:string,value:string,values:ReadonlyArray<string|number|boolean|null>,opts?:{candidates?:readonly string[];threshold?:number}):string;
