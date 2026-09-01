import { randomUUID } from "node:crypto";
import { S, UserError, defineCommand } from "toolcraft";
import { hasOwnErrorCode } from "../error-codes.js";
import { setStatusReason, transitionState } from "../document/write.js";
import { withDocumentStatusLock } from "../document/status-lock.js";

const completeParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" }),
  reason: S.Optional(S.String({ description: "Why the loop was force-completed" })),
  dryRun: S.Optional(
    S.Boolean({
      description: "Preview completion without writing changes",
      scope: ["cli", "sdk"],
      global: true
    })
  )
});

export const completeCommand = defineCommand({
  name: "complete",
  description: "Manually mark the superintendent loop as completed.",
  positional: ["path"],
  params: completeParams,
  scope: ["cli", "mcp", "sdk"],
  handler: async ({ params, fs }) => {
    const stat = await lstatDocument(params.path, fs);
    if (stat.isSymbolicLink()) {
      throw new UserError(
        `Refusing to complete superintendent document through symbolic link: ${params.path}`
      );
    }
    const complete = async () => {
      const content = await readDocument(params.path, fs);
      const completedContent = transitionState(params.path, content, "completed");
      const updatedContent = setStatusReason(params.path, completedContent, params.reason);

      if (params.dryRun !== true) {
        await writeDocumentAtomically(params.path, updatedContent, fs);
      }

      return {
        path: params.path,
        state: "completed" as const,
        reason: params.reason,
        ...(params.dryRun === true ? { dryRun: true as const } : {})
      };
    };
    return params.dryRun === true ? complete() : withDocumentStatusLock(params.path, fs, complete);
  },
  render: {
    rich: (result, { logger }) => {
      logger.success(
        result.dryRun === true
          ? `Would mark ${result.path} as completed.`
          : `Marked ${result.path} as completed.`
      );

      if (result.reason !== undefined) {
        logger.message(`Reason: ${result.reason}`);
      }
    },
    markdown: (result) =>
      [
        "## Superintendent completion",
        "",
        `- Path: ${result.path}`,
        `- State: ${result.state}`,
        ...(result.dryRun === true ? ["- Dry run: true"] : []),
        ...(result.reason === undefined ? [] : [`- Reason: ${result.reason}`])
      ].join("\n"),
    json: (result) => result
  }
});

async function lstatDocument(
  filePath: string,
  fs: { lstat(path: string): Promise<{ isSymbolicLink(): boolean }> }
): Promise<{ isSymbolicLink(): boolean }> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      throw new UserError(`Superintendent document not found: ${filePath}`);
    }

    throw error;
  }
}

async function readDocument(
  filePath: string,
  fs: { readFile(path: string, encoding?: BufferEncoding): Promise<string> }
): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      throw new UserError(`Superintendent document not found: ${filePath}`);
    }

    throw error;
  }
}

async function writeDocumentAtomically(
  filePath: string,
  content: string,
  fs: {
    writeFile(
      path: string,
      content: string,
      options?: { encoding?: BufferEncoding; flag?: string }
    ): Promise<void>;
    rename(fromPath: string, toPath: string): Promise<void>;
    unlink(path: string): Promise<void>;
  }
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (temporaryCreated || !hasCode(error, "EEXIST")) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function hasCode(error: unknown, code: string): error is { code: string } {
  return hasOwnErrorCode(error, code);
}
