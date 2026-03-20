import { parseDocument, isMap, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import type { PipelineFileSystem, PipelineStatus } from "../types.js";

type WritableFs = Pick<PipelineFileSystem, "readFile" | "writeFile">;

function getTasksNode(document: ReturnType<typeof parseDocument>): YAMLSeq {
  const tasksNode = document.get("tasks", true);
  if (!tasksNode || !isSeq(tasksNode)) {
    throw new Error("Invalid plan YAML: expected \"tasks\" to be a sequence.");
  }
  return tasksNode as YAMLSeq;
}

function getTaskNode(tasksNode: YAMLSeq, taskId: string): YAMLMap {
  for (const item of tasksNode.items) {
    if (!isMap(item)) {
      continue;
    }
    if (item.get("id") === taskId) {
      return item as YAMLMap;
    }
  }
  throw new Error(`Task "${taskId}" not found in plan.`);
}

export async function readPlanFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  planPath: string
): Promise<string> {
  return fs.readFile(planPath, "utf8");
}

export async function writeTaskStatus(options: {
  fs: WritableFs;
  planPath: string;
  taskId: string;
  status: PipelineStatus;
  stepName?: string;
}): Promise<void> {
  const content = await readPlanFile(options.fs, options.planPath);
  const document = parseDocument(content);
  const tasksNode = getTasksNode(document);
  const taskNode = getTaskNode(tasksNode, options.taskId);

  if (options.stepName) {
    const statusNode = taskNode.get("status", true);
    if (!statusNode || !isMap(statusNode)) {
      throw new Error(`Task "${options.taskId}" does not use step statuses.`);
    }
    statusNode.set(options.stepName, options.status);
  } else {
    taskNode.set("status", options.status);
  }

  await options.fs.writeFile(options.planPath, document.toString(), {
    encoding: "utf8"
  });
}
