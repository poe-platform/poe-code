import type {CommandContext} from 'safe-bash-contracts';
import type {LlmService} from './service.js';

/** Optional command capability; importing this contract does not load storage. */
export interface LlmCollectionCommands {
 execute(invocation:{
  readonly context:CommandContext;readonly service:LlmService;
  readonly command:string;readonly tokens:readonly string[];
  readonly write:(bytes:Uint8Array)=>Promise<void>;
  readonly diagnostic:(text:string)=>Promise<void>;
  readonly step:()=>Promise<void>;
  readonly admit:(bytes:number,materialized?:boolean)=>void;
  readonly maxConfigurationBytes:number;readonly maxInputBytes:number;
 }):Promise<number>;
}
