import type {RunQueueSnapshot} from "./run-queue.js";
import {native} from "./native.js";
export function formatRunQueueSummary(snapshot:RunQueueSnapshot):string {
 const plans=snapshot.items.filter(item=>item.kind==="plan"),messages=snapshot.items.filter(item=>item.kind==="message"),pending=snapshot.items.filter(item=>item.status==="pending").length;
 return native.harnessQueueSummary(plans.filter(item=>item.status==="completed").length,plans.length,messages.filter(item=>item.status==="completed").length,messages.length,pending);
}
