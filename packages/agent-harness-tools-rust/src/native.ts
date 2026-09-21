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
export const native=createRequire(import.meta.url)("./agent-harness-tools-rust.node") as {NativeHarnessQueue:new()=>NativeQueue};
