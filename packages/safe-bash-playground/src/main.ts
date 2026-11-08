import type { PlaygroundSession } from "./session.js";
import {
  CommandHistory,
  CommandCompletion,
  ToastTimer,
  buildFileTree,
  fileLanguage,
  formatBytes,
  labelPath,
  resolveFilePath,
  uploadError,
  uploadToastLabel,
  type FileEntry,
  type FileNode
} from "./view.js";

function element<ElementType extends HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing playground element: ${id}`);
  return found as ElementType;
}

const terminalForm = element<HTMLFormElement>("terminal-form");
const terminalInput = element<HTMLInputElement>("terminal-input");
const terminalOutput = element("terminal-output");
const terminalScroll = element("terminal-scroll");
const fileTree = element("file-tree");
const fileSearch = element<HTMLInputElement>("file-search");
const uploadInput = element<HTMLInputElement>("upload-input");
const uploadButton = element<HTMLButtonElement>("upload-button");
const uploadDropzone = element<HTMLButtonElement>("upload-dropzone");
const fileTemplate = element<HTMLTemplateElement>("file-entry-template");
const folderTemplate = element<HTMLTemplateElement>("folder-entry-template");
const newFileButton = element<HTMLButtonElement>("new-file-button");
const preview = element("preview");
const previewName = element("preview-name");
const editor = element<HTMLTextAreaElement>("editor");
const saveButton = element<HTMLButtonElement>("save-file-button");
const downloadButton = element<HTMLButtonElement>("download-file-button");
const deleteButton = element<HTMLButtonElement>("delete-file-button");
const closeButton = element<HTMLButtonElement>("close-preview-button");
const resetButton = element<HTMLButtonElement>("reset-button");
const clearButton = element<HTMLButtonElement>("clear-button");
const explorerToggle = element<HTMLButtonElement>("explorer-toggle");
const previewToggle = document.getElementById("preview-toggle");
const explorer = element(explorerToggle.getAttribute("aria-controls") ?? "explorer");
const statusMessage = element("status-message");
const editorHelp = document.getElementById("editor-help");
const welcome = document.getElementById("terminal-welcome");
const commandHints = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-command]"));
const runButton = terminalForm.querySelector<HTMLButtonElement>('button[type="submit"]');
const collapsed = new Set<string>();
let model: typeof import("./session.js");
let session: PlaygroundSession;
let entries: FileEntry[] = [];
let history = new CommandHistory();
let busy = true;
let dialogOpen = false;
let selectedPath: string | null = null;
let originalText = "";
let binary = false;
const completion = new CommandCompletion();
const toastRegion = document.createElement("div");
toastRegion.className = "toast-region";
toastRegion.setAttribute("role", "status");
toastRegion.setAttribute("aria-live", "polite");
toastRegion.setAttribute("aria-atomic", "true");
toastRegion.setAttribute("aria-label", "Upload notifications");
document.body.append(toastRegion);
let dismissUploadToast: (() => void) | null = null;

function status(message: string, error = false): void {
  statusMessage.textContent = message;
  statusMessage.dataset.state = error ? "error" : "ready";
}

function report(error: unknown): void {
  status(error instanceof Error ? error.message : String(error), true);
}

function showUploadToast(paths: string[]): void {
  const label = uploadToastLabel(paths);
  if (!label) return;
  dismissUploadToast?.();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.tone = "success";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "toast-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "20");
  icon.setAttribute("height", "20");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const check = document.createElementNS("http://www.w3.org/2000/svg", "path");
  check.setAttribute("d", "m5 12 4 4L19 6");
  icon.append(check);
  const filename = document.createElement("span");
  filename.className = "toast-filename";
  filename.textContent = label.text;
  filename.title = label.title;
  const dismissButton = document.createElement("button");
  dismissButton.className = "toast-dismiss";
  dismissButton.type = "button";
  dismissButton.textContent = "×";
  dismissButton.setAttribute("aria-label", "Dismiss upload notification");
  dismissButton.title = "Dismiss notification";
  toast.append(icon, filename, dismissButton);
  toastRegion.replaceChildren(toast);
  let hovered = toast.matches(":hover");
  const timer = new ToastTimer(dismiss);
  if (hovered) timer.pause();
  function dismiss(): void {
    const ownsFocus = toast.contains(document.activeElement);
    timer.cancel();
    toast.hidden = true;
    if (ownsFocus)
      (uploadButton.disabled ? terminalInput : uploadButton).focus({ preventScroll: true });
  }
  dismissUploadToast = dismiss;
  dismissButton.addEventListener("click", dismiss);
  toast.addEventListener("pointerenter", () => {
    hovered = true;
    timer.pause();
  });
  toast.addEventListener("pointerleave", () => {
    hovered = false;
    if (!toast.contains(document.activeElement)) timer.resume();
  });
  toast.addEventListener("focusin", () => timer.pause());
  toast.addEventListener("focusout", (event) => {
    if (!hovered && !(event.relatedTarget instanceof Node && toast.contains(event.relatedTarget)))
      timer.resume();
  });
}

function dirty(): boolean {
  return selectedPath !== null && !binary && editor.value !== originalText;
}

function syncControls(): void {
  if (busy) completion.reset();
  terminalInput.readOnly = busy;
  terminalInput.setAttribute("aria-busy", String(busy));
  terminalInput.placeholder = busy ? "Working…" : "Type a command…";
  terminalForm.setAttribute("aria-busy", String(busy));
  fileTree.setAttribute("aria-busy", String(busy));
  if (runButton) runButton.disabled = busy;
  for (const button of [uploadButton, uploadDropzone, newFileButton, resetButton, ...commandHints])
    button.disabled = busy;
  for (const button of fileTree.querySelectorAll<HTMLButtonElement>("button"))
    button.disabled = busy;
  editor.readOnly = busy || binary || !selectedPath;
  saveButton.disabled = busy || !dirty();
  downloadButton.disabled = busy || !selectedPath;
  deleteButton.disabled = busy || !selectedPath;
  closeButton.disabled = busy;
  previewName.textContent = selectedPath
    ? `${labelPath(selectedPath)}${dirty() ? " • Unsaved" : ""}`
    : "File editor";
  previewName.title = selectedPath ?? "File editor";
  preview.dataset.dirty = String(dirty());
  previewToggle?.setAttribute("aria-expanded", String(!preview.hidden));
}

function output(text: string, kind = "output"): HTMLElement {
  const line = document.createElement("pre");
  line.className = kind;
  line.textContent = text;
  terminalOutput.append(line);
  terminalScroll.scrollTop = terminalScroll.scrollHeight;
  return line;
}

function clearTerminal(): void {
  terminalOutput.replaceChildren();
  if (welcome) welcome.hidden = true;
  terminalInput.focus();
}

type DialogChoice = { action: string; value: string };

function ask(
  title: string,
  message: string,
  actions: { value: string; label: string }[],
  initialValue?: string
): Promise<DialogChoice | null> {
  if (dialogOpen) return Promise.resolve(null);
  dialogOpen = true;
  const dialog = document.createElement("dialog");
  dialog.className = "playground-dialog";
  dialog.setAttribute("aria-labelledby", "playground-dialog-title");
  dialog.setAttribute("aria-describedby", "playground-dialog-description");
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.id = "playground-dialog-title";
  heading.textContent = title;
  const description = document.createElement("p");
  description.id = "playground-dialog-description";
  description.textContent = message;
  form.append(heading, description);
  const input = document.createElement("input");
  if (initialValue !== undefined) {
    const label = document.createElement("label");
    label.textContent = "File path";
    input.id = "new-file-path";
    input.name = "path";
    input.value = initialValue;
    input.required = true;
    input.autocomplete = "off";
    input.spellcheck = false;
    label.htmlFor = input.id;
    form.append(label, input);
  }
  const buttons = document.createElement("div");
  buttons.className = "dialog-actions";
  for (const action of [{ value: "cancel", label: "Cancel" }, ...actions]) {
    const button = document.createElement("button");
    button.type = action.value === "cancel" ? "button" : "submit";
    button.value = action.value;
    button.textContent = action.label;
    button.className = action.value === "cancel" ? "text-button" : "save-button";
    button.formNoValidate = action.value === "cancel";
    if (action.value === "cancel") button.addEventListener("click", () => dialog.close());
    buttons.append(button);
  }
  form.append(buttons);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    let choice: DialogChoice | null = null;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const action = (event.submitter as HTMLButtonElement | null)?.value;
      if (action && action !== "cancel") choice = { action, value: input.value };
      dialog.close();
    });
    dialog.addEventListener(
      "close",
      () => {
        dialogOpen = false;
        dialog.remove();
        resolve(choice);
      },
      { once: true }
    );
    dialog.showModal();
    if (initialValue !== undefined) {
      input.focus();
      input.select();
    } else buttons.querySelector("button")?.focus();
  });
}

function renderTree(): void {
  const render = (nodes: FileNode[], parent: HTMLElement): void => {
    for (const node of nodes) {
      const template = node.kind === "directory" ? folderTemplate : fileTemplate;
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const item = fragment.querySelector("li")!;
      item.querySelector("[data-file-name]")!.textContent = node.name;
      if (node.kind === "directory") {
        const details = item.querySelector("details")!;
        const summary = item.querySelector("summary")!;
        details.dataset.path = node.path;
        summary.title = node.path;
        item.querySelector("[data-child-count]")!.textContent = String(node.children.length);
        details.open = Boolean(fileSearch.value.trim()) || !collapsed.has(node.path);
        details.addEventListener("toggle", () => {
          if (!details.isConnected || fileSearch.value.trim()) return;
          if (details.open) collapsed.delete(node.path);
          else collapsed.add(node.path);
        });
        const children = item.querySelector("ul")!;
        render(node.children, children);
      } else {
        const button = item.querySelector("button")!;
        button.dataset.path = node.path;
        button.disabled = busy;
        button.title = `${node.path} · ${formatBytes(node.size)}`;
        button.setAttribute("aria-current", String(node.path === selectedPath));
        const extension = node.name.includes(".")
          ? node.name.slice(node.name.lastIndexOf(".") + 1).toLowerCase()
          : "";
        const type = item.querySelector<HTMLElement>("[data-file-type]")!;
        type.textContent = extension.length <= 6 ? extension : "";
        type.dataset.fileType = extension;
        button.addEventListener("click", () => {
          void openFile(node.path);
        });
      }
      parent.append(item);
    }
  };
  const fragment = document.createElement("ul");
  render(buildFileTree(entries, fileSearch.value), fragment);
  if (!fragment.childElementCount) {
    const empty = document.createElement("li");
    empty.className = "tree-empty";
    empty.textContent = fileSearch.value.trim()
      ? "No matching files."
      : "No files yet. Upload or create one.";
    fragment.append(empty);
  }
  fileTree.replaceChildren(...fragment.childNodes);
}

async function refresh(): Promise<void> {
  entries = await session.entries();
  element("cwd").textContent = labelPath(session.cwd);
  element("workspace-root").textContent = "/home";
  element("file-count").textContent = String(
    entries.filter((entry) => entry.kind === "file").length
  );
  element("folder-count").textContent = String(
    entries.filter((entry) => entry.kind === "directory" && entry.path !== "/home").length
  );
  element("memory-usage").textContent = formatBytes(
    entries.reduce((total, entry) => total + entry.size, 0)
  );
  renderTree();
  syncControls();
}

async function loadPreview(path: string): Promise<void> {
  const isBinary = await session.isBinary(path);
  const content = isBinary ? "" : await session.readFile(path);
  selectedPath = path;
  binary = isBinary;
  originalText = content;
  editor.value = content;
  editor.hidden = binary;
  preview.hidden = false;
  const entry = entries.find((candidate) => candidate.path === path);
  if (editorHelp)
    editorHelp.textContent = binary
      ? `Binary file · ${formatBytes(entry?.size ?? 0)}. Preview and editing are unavailable. Download preserves the original bytes.`
      : `${fileLanguage(path)} · ${formatBytes(entry?.size ?? 0)}. Edits stay in memory. Save to update the sandbox; download to keep a copy.`;
  syncControls();
  renderTree();
}

function closePreview(): void {
  selectedPath = null;
  originalText = "";
  editor.value = "";
  binary = false;
  editor.hidden = false;
  preview.hidden = true;
  syncControls();
  renderTree();
}

async function saveFile(): Promise<boolean> {
  if (!selectedPath || binary || busy) return false;
  busy = true;
  syncControls();
  try {
    await session.writeFile(selectedPath, editor.value);
    originalText = editor.value;
    await refresh();
    status(`Saved ${labelPath(selectedPath)}.`);
    return true;
  } catch (error) {
    report(error);
    return false;
  } finally {
    busy = false;
    syncControls();
  }
}

async function protectEdits(): Promise<boolean> {
  if (!dirty()) return true;
  const choice = await ask(
    "Unsaved changes",
    `Keep your edits to ${labelPath(selectedPath!)} before continuing?`,
    [
      { value: "discard", label: "Discard changes" },
      { value: "save", label: "Save and continue" }
    ]
  );
  if (choice?.action === "save") return saveFile();
  if (choice?.action !== "discard") return false;
  editor.value = originalText;
  syncControls();
  return true;
}

async function openFile(path: string): Promise<void> {
  if (busy || dialogOpen || (path !== selectedPath && !(await protectEdits()))) return;
  if (path === selectedPath) {
    preview.hidden = false;
    syncControls();
    (binary ? downloadButton : editor).focus();
    return;
  }
  busy = true;
  syncControls();
  try {
    await loadPreview(path);
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
  }
  if (selectedPath === path) (binary ? downloadButton : editor).focus();
}

async function runCommand(): Promise<void> {
  const command = terminalInput.value;
  if (busy || dialogOpen || !command.trim()) return;
  if (command.trim() === "clear") {
    history.record(command);
    terminalInput.value = "";
    completion.reset();
    clearTerminal();
    status("Terminal cleared. Files and unsaved edits are unchanged.");
    return;
  }
  if (!(await protectEdits())) return;
  busy = true;
  completion.reset();
  history.record(command);
  terminalInput.value = "";
  syncControls();
  output(`${labelPath(session.cwd)} ❯ ${command}`, "command");
  const pending = output("Running…", "muted pending");
  status("Running command…");
  try {
    const result = await session.run(command);
    if (result.stdout) output(result.stdout);
    if (result.stderr) output(result.stderr, "error");
    if (result.exitCode !== 0) output(`Exit code: ${result.exitCode}`, "muted");
    status(
      result.exitCode === 0
        ? "Command finished."
        : `Command exited with status ${result.exitCode}.`,
      result.exitCode !== 0
    );
  } catch (error) {
    output(error instanceof Error ? error.message : String(error), "error");
    report(error);
  } finally {
    pending.remove();
    try {
      await refresh();
      if (selectedPath) {
        if (entries.some((entry) => entry.path === selectedPath && entry.kind === "file"))
          await loadPreview(selectedPath);
        else closePreview();
      }
    } catch (error) {
      report(error);
    }
    busy = false;
    syncControls();
    terminalInput.focus();
    terminalScroll.scrollTop = terminalScroll.scrollHeight;
  }
}

async function createFile(): Promise<void> {
  if (busy || dialogOpen || !(await protectEdits())) return;
  const choice = await ask(
    "New file",
    "Create a text file in the in-memory workspace. Relative paths start in the current directory.",
    [{ value: "create", label: "Create file" }],
    "untitled.txt"
  );
  if (!choice) return;
  try {
    const path = resolveFilePath(choice.value, session.cwd);
    const existing = entries.find((entry) => entry.path === path);
    if (existing?.kind === "directory") throw new Error("A directory already uses that path.");
    if (
      existing &&
      !(await ask(
        "Replace file?",
        `${labelPath(path)} already exists. Replace its contents with an empty file?`,
        [{ value: "replace", label: "Replace file" }]
      ))
    )
      return;
    busy = true;
    syncControls();
    await session.writeFile(path, "");
    await refresh();
    await loadPreview(path);
    status(`Created ${labelPath(path)}.`);
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
  }
  editor.focus();
}

async function uploadFiles(files: File[]): Promise<void> {
  if (busy || dialogOpen || !files.length) return;
  dismissUploadToast?.();
  const error = uploadError(
    files,
    entries.reduce((total, entry) => total + entry.size, 0),
    {
      maxFileBytes: model.MAX_FILE_BYTES,
      maxTotalBytes: model.MAX_WORKSPACE_BYTES
    }
  );
  if (error) {
    status(error, true);
    return;
  }
  busy = true;
  syncControls();
  status(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
  try {
    const data = [];
    for (const file of files)
      data.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    const paths = await session.upload(data);
    await refresh();
    for (const path of paths) {
      let parent = path.slice(0, path.lastIndexOf("/"));
      while (parent.startsWith("/home/")) {
        collapsed.delete(parent);
        parent = parent.slice(0, parent.lastIndexOf("/"));
      }
    }
    renderTree();
    status("");
    showUploadToast(paths);
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
    uploadInput.value = "";
  }
}

async function downloadFile(): Promise<void> {
  if (busy || dialogOpen || !selectedPath || !(await protectEdits())) return;
  busy = true;
  syncControls();
  try {
    const bytes = await session.readBytes(selectedPath);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedPath.slice(selectedPath.lastIndexOf("/") + 1);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Downloaded ${labelPath(selectedPath)}.`);
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
  }
}

async function deleteFile(): Promise<void> {
  if (busy || dialogOpen || !selectedPath) return;
  const choice = await ask(
    "Delete file?",
    `Delete ${labelPath(selectedPath)}? ${dirty() ? "Unsaved edits will also be discarded. " : ""}This cannot be undone.`,
    [{ value: "delete", label: "Delete file" }]
  );
  if (!choice) return;
  busy = true;
  syncControls();
  try {
    await session.remove(selectedPath);
    closePreview();
    await refresh();
    status("File deleted.");
    terminalInput.focus();
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
  }
}

async function reset(): Promise<void> {
  if (busy || dialogOpen) return;
  if (
    !(await ask(
      "Reset sandbox?",
      `All uploaded and changed files will be replaced with the starting files.${dirty() ? " Your unsaved editor changes will also be lost." : ""} Download anything you want to keep first.`,
      [{ value: "reset", label: "Reset sandbox" }]
    ))
  )
    return;
  busy = true;
  syncControls();
  status("Resetting sandbox…");
  try {
    const replacement = await model.createSession();
    session = replacement;
    dismissUploadToast?.();
    history = new CommandHistory();
    completion.reset();
    collapsed.clear();
    fileSearch.value = "";
    terminalInput.value = "";
    closePreview();
    clearTerminal();
    if (welcome) welcome.hidden = false;
    await refresh();
    status("Fresh sandbox ready. Files stay only in this tab's memory.");
  } catch (error) {
    report(error);
  } finally {
    busy = false;
    syncControls();
    terminalInput.focus();
  }
}

terminalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runCommand();
});
for (const event of ["input", "blur", "pointerdown", "compositionstart"])
  terminalInput.addEventListener(event, completion.reset.bind(completion));
document.addEventListener("selectionchange", () => {
  if (
    document.activeElement === terminalInput &&
    (terminalInput.selectionStart !== terminalInput.value.length ||
      terminalInput.selectionEnd !== terminalInput.value.length)
  )
    completion.reset();
});
terminalInput.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey) completion.reset();
  if (event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    clearTerminal();
    return;
  }
  if (
    event.ctrlKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "c" &&
    terminalInput.selectionStart === terminalInput.selectionEnd
  ) {
    event.preventDefault();
    if (busy) status("Cancellation is unavailable here. The operation is still running.");
    else {
      if (terminalInput.value)
        output(`${labelPath(session.cwd)} ❯ ${terminalInput.value} ^C`, "muted");
      terminalInput.value = "";
      history.resetNavigation();
      status("Current input cleared.");
    }
    return;
  }
  if (busy || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    terminalInput.value =
      event.key === "ArrowUp"
        ? history.previous(terminalInput.value)
        : history.next(terminalInput.value);
    terminalInput.setSelectionRange(terminalInput.value.length, terminalInput.value.length);
  } else if (
    event.key === "Tab" &&
    terminalInput.value &&
    terminalInput.selectionStart === terminalInput.value.length
  ) {
    event.preventDefault();
    const input = terminalInput.value;
    void (async () => {
      try {
        const result = await completion.next(input, session.complete.bind(session));
        if (
          !result ||
          busy ||
          terminalInput.value !== input ||
          terminalInput.selectionStart !== input.length ||
          terminalInput.selectionEnd !== input.length ||
          document.activeElement !== terminalInput
        )
          return;
        if (!result.count) {
          status("No completions. Shift+Tab moves focus out of the command input.");
          return;
        }
        terminalInput.value = result.value;
        terminalInput.setSelectionRange(terminalInput.value.length, terminalInput.value.length);
        status(
          `${result.count} completion${result.count === 1 ? "" : "s"}. Tab cycles; Shift+Tab moves focus away.`
        );
      } catch (error) {
        report(error);
      }
    })();
  } else if (event.key === "Escape") {
    runButton?.focus();
  }
});

fileSearch.addEventListener("input", renderTree);
editor.addEventListener("input", syncControls);
editor.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (dirty()) void saveFile();
  }
});
saveButton.addEventListener("click", () => {
  void saveFile();
});
downloadButton.addEventListener("click", () => {
  void downloadFile();
});
deleteButton.addEventListener("click", () => {
  void deleteFile();
});
closeButton.addEventListener("click", () => {
  void (async () => {
    if (busy || dialogOpen || !(await protectEdits())) return;
    closePreview();
    terminalInput.focus();
  })();
});
newFileButton.addEventListener("click", () => {
  void createFile();
});
clearButton.addEventListener("click", clearTerminal);
resetButton.addEventListener("click", () => {
  void reset();
});
uploadButton.addEventListener("click", () => {
  if (!busy) uploadInput.click();
});
uploadDropzone.addEventListener("click", () => {
  if (!busy) uploadInput.click();
});
uploadInput.addEventListener("change", () => {
  const files = Array.from(uploadInput.files ?? []);
  uploadInput.value = "";
  void uploadFiles(files);
});
explorerToggle.addEventListener("click", () => {
  explorer.hidden = !explorer.hidden;
  explorerToggle.setAttribute("aria-expanded", String(!explorer.hidden));
});
previewToggle?.addEventListener("click", () => {
  if (busy) return;
  if (!preview.hidden) closeButton.click();
  else {
    preview.hidden = false;
    syncControls();
    if (selectedPath) (binary ? downloadButton : editor).focus();
    else status("Choose a file in the explorer to preview or edit it.");
  }
});
for (const button of commandHints)
  button.addEventListener("click", () => {
    if (busy) return;
    terminalInput.value = button.dataset.command ?? "";
    completion.reset();
    history.resetNavigation();
    terminalInput.focus();
  });

document.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy || dialogOpen ? "none" : "copy";
  uploadDropzone.dataset.dragActive = String(!busy && !dialogOpen);
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) uploadDropzone.dataset.dragActive = "false";
});
document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  uploadDropzone.dataset.dragActive = "false";
  void uploadFiles(Array.from(event.dataTransfer.files));
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

syncControls();
void (async () => {
  try {
    model = await import("./session.js");
    session = await model.createSession();
    await refresh();
    busy = false;
    syncControls();
    status("Ready. Your files stay in this tab's memory.");
    const help = document.getElementById("terminal-help");
    if (help)
      help.textContent =
        "Enter to run · ↑↓ history · Tab completes · Shift+Tab leaves input · Ctrl/Cmd+L clears · Ctrl+C clears input";
  } catch (error) {
    status(
      `Unable to start sandbox: ${error instanceof Error ? error.message : String(error)}. Reload the page to retry.`,
      true
    );
    const failure = document.createElement("li");
    failure.className = "tree-empty";
    failure.textContent = "Sandbox unavailable. Reload the page to retry.";
    fileTree.replaceChildren(failure);
    fileTree.setAttribute("aria-busy", "false");
    terminalForm.setAttribute("aria-busy", "false");
    terminalInput.setAttribute("aria-busy", "false");
    terminalInput.placeholder = "Sandbox unavailable";
  }
})();
