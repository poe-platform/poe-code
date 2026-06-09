import { parse, type MdNode } from "toolcraft-design";

export type TaskItem = {
  text: string;
  done: boolean;
};

export type TaskBoard = {
  tasks: TaskItem[];
  allDone: boolean;
  openCount: number;
  doneCount: number;
};

export function parseTaskBoard(body: string): TaskBoard {
  const sectionNodes = readTaskBoardSection(body);
  const tasks: TaskItem[] = [];

  for (const node of sectionNodes) {
    collectTasks(node, tasks);
  }

  const doneCount = tasks.filter((task) => task.done).length;
  const openCount = tasks.length - doneCount;

  return {
    tasks,
    allDone: openCount === 0,
    openCount,
    doneCount
  };
}

export function hasTaskBoard(body: string): boolean {
  return findTaskBoardHeadingIndex(parseRoot(body).children) !== -1;
}

function readTaskBoardSection(body: string): MdNode[] {
  const root = parseRoot(body);
  const headingIndex = findTaskBoardHeadingIndex(root.children);

  if (headingIndex === -1) {
    throw new Error('Missing "## Task Board" section');
  }

  const sectionNodes: MdNode[] = [];

  for (let index = headingIndex + 1; index < root.children.length; index += 1) {
    const node = root.children[index];

    if (node.type === "heading" && node.depth <= 2) {
      break;
    }

    sectionNodes.push(node);
  }

  return sectionNodes;
}

function parseRoot(body: string): Extract<MdNode, { type: "root" }> {
  const ast = parse(body).ast;

  if (ast.type !== "root") {
    throw new Error("Expected markdown root node");
  }

  return ast;
}

function findTaskBoardHeadingIndex(children: readonly MdNode[]): number {
  return children.findIndex(
    (node) => node.type === "heading" && node.depth === 2 && extractText(node).trim() === "Task Board"
  );
}

function collectTasks(node: MdNode, tasks: TaskItem[]): void {
  if (node.type === "listItem" && typeof node.checked === "boolean") {
    tasks.push({
      text: readTaskText(node),
      done: node.checked
    });
  }

  if (!("children" in node)) {
    return;
  }

  for (const child of node.children) {
    collectTasks(child, tasks);
  }
}

function readTaskText(node: Extract<MdNode, { type: "listItem" }>): string {
  let text = "";

  for (const child of node.children) {
    if (child.type === "list") {
      continue;
    }

    const childText = extractText(child).trim();

    if (childText.length === 0) {
      continue;
    }

    text = text.length === 0 ? childText : `${text}\n${childText}`;
  }

  return text;
}

function extractText(node: MdNode): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      return node.value;
    case "image":
      return node.alt;
    case "break":
      return "\n";
    case "footnoteReference":
      return node.label;
    case "thematicBreak":
    case "frontmatter":
      return "";
    default:
      if (!("children" in node)) {
        return "";
      }

      return node.children.map(extractText).join("");
  }
}
