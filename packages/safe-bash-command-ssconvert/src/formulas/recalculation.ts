import { recalculateWorkbookSteps } from "./evaluator.js";
import type { Workbook } from "../workbook.js";

/** Recalculate cooperatively so timer-driven cancellation can run between work quanta. */
export async function recalculateWorkbook(...args: Parameters<typeof recalculateWorkbookSteps>): Promise<Workbook> {
  const steps = recalculateWorkbookSteps(...args);
  try {
    args[1].signal.throwIfAborted();
    let result = steps.next();
    while (!result.done) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      args[1].signal.throwIfAborted();
      result = steps.next();
    }
    return result.value;
  } finally { steps.return(undefined as never); }
}
