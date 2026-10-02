import type {Option} from "commander";
import type {FieldDefinition} from "./cli-fields.js";
export declare function createOption(field:FieldDefinition,globalLongOptionFlags:ReadonlySet<string>):Option[];
export declare function createCommanderOption(flags:string,description:string|undefined,field:FieldDefinition):Option;
