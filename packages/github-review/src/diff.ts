export interface ReviewInlineComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export interface ReviewDiffLine {
  side: "LEFT" | "RIGHT";
  line: number;
  text: string;
}

export interface ReviewDiffHunk {
  header: string;
  lines: ReviewDiffLine[];
}

export interface ReviewDiffFile {
  path: string;
  previousPath: string | null;
  status: "modified" | "added" | "deleted" | "renamed";
  hunks: ReviewDiffHunk[];
  reviewableLines: number[];
}

export interface ReviewDiffContext {
  files: ReviewDiffFile[];
  fileOrder: Map<string, number>;
  reviewableLinesByPath: Map<string, Set<number>>;
  leftLinesByPath: Map<string, Set<number>>;
  rightContextLinesByPath: Map<string, Set<number>>;
  rendered: string;
}

function parseHunkHeader(header: string): { oldLine: number; newLine: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) {
    return null;
  }
  return {
    oldLine: Number.parseInt(match[1] ?? "0", 10),
    newLine: Number.parseInt(match[2] ?? "0", 10)
  };
}

function decodeGitQuotedPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  const bytes: number[] = [];
  const contents = value.slice(1, -1);
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index] ?? "";
    if (character !== "\\") {
      bytes.push(...new TextEncoder().encode(character));
      continue;
    }

    const escaped = contents[index + 1];
    if (escaped === undefined) {
      bytes.push(92);
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      const octal = contents.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? "";
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    const escapedBytes: Record<string, number> = {
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92
    };
    bytes.push(escapedBytes[escaped] ?? escaped.charCodeAt(0));
    index += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function normalizeDiffPath(value: string): string | null {
  const unquoted = decodeGitQuotedPath(value);
  if (unquoted === "/dev/null") {
    return null;
  }
  return unquoted.startsWith("a/") || unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
}

function parseDiffGitPaths(line: string): { previousPath: string; path: string } | null {
  const plain = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (plain) {
    return { previousPath: plain[1] ?? "", path: plain[2] ?? "" };
  }
  const quoted = /^diff --git "a\/(.+)" "b\/(.+)"$/.exec(line);
  return quoted
    ? {
        previousPath: decodeGitQuotedPath(`"${quoted[1] ?? ""}"`),
        path: decodeGitQuotedPath(`"${quoted[2] ?? ""}"`)
      }
    : null;
}

function inferStatus(line: string): ReviewDiffFile["status"] | null {
  if (line.startsWith("new file mode ")) {
    return "added";
  }
  if (line.startsWith("deleted file mode ")) {
    return "deleted";
  }
  if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
    return "renamed";
  }
  return null;
}

function renderReviewFile(file: ReviewDiffFile): string {
  const header = [
    `FILE: ${file.path}`,
    `STATUS: ${file.status}${file.previousPath && file.previousPath !== file.path ? ` (from ${file.previousPath})` : ""}`
  ];
  if (file.hunks.length === 0) {
    return `${header.join("\n")}\nPATCH: (no text patch available)`;
  }
  const lines = [...header, "PATCH:"];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const label = `${line.side === "RIGHT" ? "R" : "L"}${line.line}`.padStart(6, " ");
      lines.push(`${label} | ${line.text}`);
    }
  }
  return lines.join("\n");
}

export function parseReviewDiff(diffText: string): ReviewDiffContext {
  type PendingFile = ReviewDiffFile & {
    leftLineSet: Set<number>;
    rightContextLineSet: Set<number>;
    reviewableLineSet: Set<number>;
  };
  const files: PendingFile[] = [];
  let currentFile: PendingFile | null = null;
  let currentHunk: ReviewDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finalizeFile = (): void => {
    if (currentFile) {
      files.push(currentFile);
    }
    currentFile = null;
    currentHunk = null;
  };

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      finalizeFile();
      const paths = parseDiffGitPaths(line);
      const previousPath = paths?.previousPath ?? "";
      const path = paths?.path ?? previousPath;
      currentFile = {
        path,
        previousPath: previousPath && previousPath !== path ? previousPath : null,
        status: "modified",
        hunks: [],
        reviewableLines: [],
        leftLineSet: new Set<number>(),
        rightContextLineSet: new Set<number>(),
        reviewableLineSet: new Set<number>()
      };
      continue;
    }
    if (!currentFile) {
      continue;
    }
    const status = inferStatus(line);
    if (status) {
      currentFile.status = status;
    }
    if (line.startsWith("rename from ")) {
      currentFile.previousPath = decodeGitQuotedPath(line.slice("rename from ".length).trim());
      continue;
    }
    if (line.startsWith("rename to ")) {
      currentFile.path = decodeGitQuotedPath(line.slice("rename to ".length).trim());
      continue;
    }
    if (line.startsWith("--- ")) {
      currentFile.previousPath = normalizeDiffPath(line.slice(4).trim());
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = normalizeDiffPath(line.slice(4).trim());
      if (path) {
        currentFile.path = path;
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      const parsed = parseHunkHeader(line);
      if (!parsed) {
        continue;
      }
      oldLine = parsed.oldLine;
      newLine = parsed.newLine;
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ side: "RIGHT", line: newLine, text: line });
      currentFile.reviewableLineSet.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ side: "LEFT", line: oldLine, text: line });
      currentFile.leftLineSet.add(oldLine);
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      currentHunk.lines.push({ side: "RIGHT", line: newLine, text: line });
      currentFile.rightContextLineSet.add(newLine);
      currentFile.reviewableLineSet.add(newLine);
      oldLine += 1;
      newLine += 1;
    }
  }
  finalizeFile();

  const publicFiles = files.map((file) => ({
    path: file.path,
    previousPath: file.previousPath,
    status: file.status,
    hunks: file.hunks,
    reviewableLines: [...file.reviewableLineSet].sort((left, right) => left - right)
  }));
  return {
    files: publicFiles,
    fileOrder: new Map(publicFiles.map((file, index) => [file.path, index])),
    reviewableLinesByPath: new Map(files.map((file) => [file.path, file.reviewableLineSet])),
    leftLinesByPath: new Map(files.map((file) => [file.path, file.leftLineSet])),
    rightContextLinesByPath: new Map(files.map((file) => [file.path, file.rightContextLineSet])),
    rendered: publicFiles.map(renderReviewFile).join("\n\n")
  };
}

export function validateInlineComments(
  comments: readonly ReviewInlineComment[],
  context: ReviewDiffContext
): ReviewInlineComment[] {
  const accepted: ReviewInlineComment[] = [];
  const seen = new Set<string>();
  for (const comment of comments) {
    const path = comment.path;
    const body = comment.body.trim();
    if (path.length === 0 || !body || !Number.isInteger(comment.line) || comment.line < 1) {
      throw new Error("Inline review comments require path, positive line, and body.");
    }
    if (comment.side === "LEFT") {
      throw new Error(
        `Inline comment target ${path}:${comment.line} is a left-side diff target; only right-side comments are supported.`
      );
    }
    if (!context.reviewableLinesByPath.get(path)?.has(comment.line)) {
      throw new Error(
        `Inline comment target ${path}:${comment.line} is not a valid right-side diff target.`
      );
    }
    if (
      !comment.side &&
      context.leftLinesByPath.get(path)?.has(comment.line) &&
      context.rightContextLinesByPath.get(path)?.has(comment.line)
    ) {
      throw new Error(
        `Inline comment target ${path}:${comment.line} is ambiguous; specify side RIGHT to target the right-side diff line.`
      );
    }
    const key = `${path}\0${comment.line}\0${body}`;
    if (!seen.has(key)) {
      seen.add(key);
      accepted.push({
        path,
        line: comment.line,
        ...(comment.side ? { side: comment.side } : {}),
        body
      });
    }
  }
  accepted.sort((left, right) => {
    const fileDifference =
      (context.fileOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
      (context.fileOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER);
    return fileDifference || left.line - right.line;
  });
  return accepted;
}
