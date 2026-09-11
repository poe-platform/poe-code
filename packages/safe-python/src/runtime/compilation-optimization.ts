import type {ExecutionMeter} from "./execution-budget.js";

/** Host compiler options are resolved levels; guest -1 inheritance is a backend
 * policy and must be resolved before entering the compiler. */
export function compilationOptimization(level:number|undefined,meter:ExecutionMeter):0|1|2 {
  meter.checkpoint();
  if(level===undefined)return 0;
  if(level===0||level===1||level===2)return level;
  meter.checkpoint(0,160);throw new RangeError("compilation optimization must be 0, 1 or 2");
}
