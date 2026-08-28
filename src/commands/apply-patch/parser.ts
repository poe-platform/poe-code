import { resolvePath } from "../../contracts/index.js";
import { PatchError, Work } from "./shared.js";

export interface ChangeLine { readonly kind: " " | "+" | "-"; readonly text: string; }
export interface Hunk { readonly anchors: string[]; readonly lines: ChangeLine[]; eof: boolean; }
export interface PatchFile {
  readonly kind: "add" | "delete" | "update";
  readonly path: string;
  readonly label: string;
  readonly destination?: string;
  readonly destinationLabel?: string;
  readonly added: string[];
  readonly hunks: Hunk[];
}

async function patchLines(text: string, work: Work): Promise<string[]> {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (work.due) await work.checkpoint();
    work.step();
    if (text.charCodeAt(index) === 0) throw new PatchError("NUL bytes are unsupported", 2);
    if (text[index] === "\n") {
      work.count("maxLines", 1);
      lines.push(await work.slice(text, start, text[index - 1] === "\r" ? index - 1 : index));
      start = index + 1;
    }
  }
  await work.checkpoint();
  if (start < text.length) { work.count("maxLines", 1); lines.push(await work.slice(text, start)); }
  await work.checkpoint();
  return lines;
}

export async function targetPath(value: string, work: Work): Promise<string> {
  await work.utf8(value, work.limits.maxPathBytes, 2);
  let components = 0;
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (work.due) await work.checkpoint();
    work.step();
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw new PatchError("control character in path", 2);
    if (index === value.length || value[index] === "/") {
      if (index > start) {
        if (++components > work.limits.maxPathComponents) throw new PatchError("maxPathComponents limit exceeded");
        if (value.slice(start, index) === "..") throw new PatchError("parent traversal is unsupported", 2);
      }
      start = index + 1;
    }
  }
  if (!value || value.endsWith("/") || value.split("/").at(-1) === ".") throw new PatchError("path names a directory", 2);
  const absolute = resolvePath(work.cwd, value);
  await work.utf8(absolute, work.limits.maxPathBytes, 2);
  if (absolute === "/") throw new PatchError("root target is unsupported", 2);
  if (absolute.split("/").length - 1 > work.limits.maxPathComponents) throw new PatchError("maxPathComponents limit exceeded");
  return absolute;
}

export async function parse(text: string, work: Work): Promise<PatchFile[]> {
  await work.utf8(work.cwd, work.limits.maxPathBytes, 2);
  if (!work.cwd.startsWith("/") || work.cwd.includes("\0")) throw new PatchError("cwd must be an absolute virtual path", 2);
  const lines = await patchLines(text, work);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") throw new PatchError("expected Begin Patch and End Patch envelope", 2);
  const files: PatchFile[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    work.count("maxFiles", 1);
    const header = lines[index++]!;
    let kind: PatchFile["kind"];
    let label: string;
    if (header.startsWith("*** Add File: ")) { kind = "add"; label = header.slice(14); }
    else if (header.startsWith("*** Delete File: ")) { kind = "delete"; label = header.slice(17); }
    else if (header.startsWith("*** Update File: ")) { kind = "update"; label = header.slice(17); }
    else throw new PatchError(`invalid file header at patch line ${index}`, 2);
    const path = await targetPath(label, work);
    let destination: string | undefined;
    let destinationLabel: string | undefined;
    if (kind === "update" && lines[index]?.startsWith("*** Move to: ")) {
      destinationLabel = lines[index++]!.slice(13);
      destination = await targetPath(destinationLabel, work);
    }
    const added: string[] = [];
    const hunks: Hunk[] = [];
    let current: Hunk | undefined;
    let finished = false;
    while (index < lines.length - 1) {
      const line = lines[index]!;
      await work.charge(line.length + 1);
      if (line.startsWith("*** Add File: ") || line.startsWith("*** Delete File: ") || line.startsWith("*** Update File: ")) break;
      if (kind === "add") {
        if (!line.startsWith("+")) throw new PatchError(`invalid Add body at patch line ${index + 1}`, 2);
        added.push(line.slice(1));
      } else if (kind === "delete") throw new PatchError("Delete cannot have a body", 2);
      else if (finished) throw new PatchError("EOF must terminate the file's last hunk", 2);
      else if (line === "@@" || line.startsWith("@@ ")) {
        const named = line.startsWith("@@ ");
        if (current && current.lines.length === 0) {
          if (!named || current.anchors.length === 0) throw new PatchError("empty update hunk", 2);
        } else {
          work.count("maxHunks", 1);
          current = { anchors: [], lines: [], eof: false };
          hunks.push(current);
        }
        if (named) { work.count("maxHunks", 1); current.anchors.push(line.slice(3)); }
      } else if (line === "*** End of File") {
        if (!current?.lines.length) throw new PatchError("EOF requires a nonempty hunk", 2);
        current.eof = true;
        finished = true;
      } else {
        const prefix = line[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") throw new PatchError(`invalid hunk line ${index + 1}`, 2);
        if (!current) {
          work.count("maxHunks", 1);
          current = { anchors: [], lines: [], eof: false };
          hunks.push(current);
        }
        current.lines.push({ kind: prefix, text: line.slice(1) });
      }
      index++;
    }
    if (kind === "update" && (!current?.lines.length || hunks.length === 0)) throw new PatchError("Update requires a nonempty hunk", 2);
    files.push({ kind, path, label, added, hunks, ...(destination === undefined ? {} : { destination, destinationLabel: destinationLabel! }) });
  }
  if (!files.length) throw new PatchError("patch contains no file operations", 2);
  const paths: string[] = [];
  for (const file of files) for (const path of [file.path, ...(file.destination ? [file.destination] : [])]) {
    for (const previous of paths) {
      await work.charge(path.length + previous.length + 1);
      if (path === previous || path.startsWith(previous + "/") || previous.startsWith(path + "/")) throw new PatchError("duplicate or conflicting patch paths", 2);
      await work.checkpoint();
    }
    paths.push(path);
  }
  return files;
}
