import {createRequire} from "node:module";
import type {RunQueueItem,RunQueueSnapshot} from "./run-queue.js";
export interface NativeResult {error?:string;value?:string;itemsChanged?:boolean;active?:RunQueueItem;update?:Partial<RunQueueSnapshot>&{items?:RunQueueItem[]};}
interface NativeQueue {
 assertAccepting():NativeResult;
 enqueuePlan(path:string,absolute:string,messages:string[]):NativeResult;
 enqueueMessage(text:string,target:string|null):NativeResult;
 begin():NativeResult;
 activate():NativeResult;
 finish(outcome:string):NativeResult;
 advance():NativeResult;
 stop(outcome:string):NativeResult;
 readonly hasWork:boolean;
 readonly items:RunQueueItem[];
}
export const native=createRequire(import.meta.url)("./agent-harness-tools-rust.node") as {
 NativeHarnessQueue:new()=>NativeQueue;
 harnessSafeJobId(id:string):boolean;
 harnessUtf8Prefix(bytes:Buffer):number;
 harnessDecimalExitCode(value:string):number|null;
 harnessLogTee(argv:string[],job:string):string[];
 harnessPlanFileId(filename:string):string|null;
 harnessPlanReadiness(value:string|undefined):string|null;
 harnessReadinessLabel(label:string,ready:boolean):string;
 harnessCompareReadiness(left:boolean,right:boolean):number;
 harnessQueueSummary(completedPlans:number,plans:number,completedMessages:number,messages:number,pending:number):string;
 harnessPlanSlug(base:string,digest:string):string;
 harnessLogFilename(role:string,date:string[]):string;
 harnessPathContained(relative:string,absolute:boolean,separator:number):boolean;
 harnessDefaultGlob(subdirectory:string):string;
 harnessMatchesGlob(name:string,lowerName:string,glob:string,lowerGlob:string):boolean;
 harnessMergeDocs(globalNames:string[],globalPaths:string[],projectNames:string[],projectPaths:string[]):string[];
};
