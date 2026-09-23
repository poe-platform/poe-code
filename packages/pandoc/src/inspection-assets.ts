import { PandocError } from "./errors.js";
import { abbreviations, html5, languages, highlightStyles } from "./inspection-data.js";
import { createFormatRegistry } from "./formats.js";
import type { ConversionContext } from "./types.js";

/** Bundled inspection only: no filesystem, conversion or subprocess authority. */
export function inspectAssets(args: readonly string[], context: ConversionContext, help: () => string): string | undefined {
  const first = args[0] ?? "";
  const modes = new Map([
    ["--list-highlight-languages", "languages"],
    ["--list-highlight-styles", "styles"],
    ["-D", "template"],
    ["--print-default-template", "template"],
    ["--print-default-data-file", "data"],
    ["--print-highlight-style", "style"],
    ["--completion", "completion"],
    ["--bash-completion", "bash"]
  ]);
  const equals = first.indexOf("=");
  const flag = equals < 0 ? first : first.slice(0, equals);
  const short = first.startsWith("-D") && first.length > 2;
  const mode = modes.get(short ? "-D" : flag);
  if (!mode) return undefined;
  const error = (message: string): never => { throw new PandocError("E_OPTION", "convert", message); };
  if (mode === "languages" || mode === "styles" || mode === "bash") {
    if (args.length !== 1 || equals >= 0) return error("Use inspection flags alone");
    if (mode === "languages") return languages;
    if (mode === "styles") return [...highlightStyles.keys()].join("\n") + "\n";
  }
  const attached = short ? first.slice(2) : equals < 0 ? undefined : first.slice(equals + 1);
  const value = mode === "bash" ? "bash" : attached ?? args[1];
  if (!value || args.length !== (mode === "bash" || attached !== undefined ? 1 : 2))
    return error("Use an inspection flag with exactly one value");
  if (mode === "template") {
    if (value === "html" || value === "html5") return html5;
    throw new PandocError("E_CAPABILITY", "convert", `No bundled default template for ${value}`);
  }
  if (mode === "data") {
    if (value === "abbreviations") return abbreviations;
    if (value === "templates/default.html5") return html5;
    throw new PandocError("E_RESOURCE", "convert", `No bundled data file: ${value}`);
  }
  if (mode === "style") {
    const style = highlightStyles.get(value);
    if (style !== undefined) return style;
    throw new PandocError("E_CAPABILITY", "convert", `No bundled highlight style: ${value}`);
  }
  if (value !== "bash") return error("Only bash completion is available");
  const registry = createFormatRegistry(undefined, context);
  const flags = [...new Set(help().split("\nUse -- before")[0]!.split("\n").join(" ").split(" ")
    .flatMap(word => word.split("/"))
    .filter(word => word.startsWith("--") || (word.startsWith("-") &&
      ((word.charCodeAt(1) >= 65 && word.charCodeAt(1) <= 90) ||
       (word.charCodeAt(1) >= 97 && word.charCodeAt(1) <= 122))))
    .map(word => word.split("=")[0]!.split("[")[0]!))];
  const quote = (words: readonly string[]) => words.join(" ").replaceAll("'", "'\\''");
  return `_pandoc_typescript() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"
  COMPREPLY=()
  case "$prev" in
    -f|-r|--from|--read) COMPREPLY=( $(compgen -W '${quote(registry.list("read"))}' -- "$cur") ) ;;
    -t|-w|--to|--write) COMPREPLY=( $(compgen -W '${quote(registry.list("write"))}' -- "$cur") ) ;;
    -D|--print-default-template) COMPREPLY=( $(compgen -W 'html html5' -- "$cur") ) ;;
    --print-default-data-file) COMPREPLY=( $(compgen -W 'abbreviations templates/default.html5' -- "$cur") ) ;;
    --print-highlight-style) COMPREPLY=( $(compgen -W '${quote([...highlightStyles.keys()])}' -- "$cur") ) ;;
    --completion) COMPREPLY=( $(compgen -W 'bash' -- "$cur") ) ;;
    *) case "$cur" in
      -*) COMPREPLY=( $(compgen -W '${quote(flags)}' -- "$cur") ) ;;
      *) COMPREPLY=( $(compgen -f -- "$cur") ) ;;
    esac ;;
  esac
}
complete -o filenames -o bashdefault -F _pandoc_typescript pandoc
`;
}
