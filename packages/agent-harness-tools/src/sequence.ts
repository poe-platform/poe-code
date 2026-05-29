import {
  runDocumentWorkflow,
  type DocumentWorkflowOptions,
  type IterationResult
} from "./runner.js";

export interface DocumentWorkflowSequenceOptions
  extends Omit<DocumentWorkflowOptions, "docPath"> {
  docPaths: string[];
  stopOnFailure?: boolean;
  onSequenceProgress?: (index: number, total: number, docPath: string) => void;
}

export async function runDocumentWorkflowSequence(
  options: DocumentWorkflowSequenceOptions
): Promise<void> {
  const stopOnFailure = options.stopOnFailure ?? true;
  const total = options.docPaths.length;

  for (const [index, docPath] of options.docPaths.entries()) {
    options.onSequenceProgress?.(index, total, docPath);

    let didFail = false;
    const onIterationEnd = async (iteration: number, result: IterationResult): Promise<void> => {
      if (result === "failed") {
        didFail = true;
      }

      await options.onIterationEnd?.(iteration, result);
    };

    try {
      await runDocumentWorkflow({
        cwd: options.cwd,
        homeDir: options.homeDir,
        docPath,
        fs: options.fs,
        runAgent: options.runAgent,
        readConfig: options.readConfig,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onIterationStart
          ? { onIterationStart: options.onIterationStart }
          : {}),
        onIterationEnd
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }

      didFail = true;
    }

    if (didFail && stopOnFailure) {
      break;
    }
  }
}
