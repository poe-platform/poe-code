import { Argument, type Command, type Option } from "commander";
import { setHelpGuidance } from "./help-guidance.js";

const SHELLS = ["bash", "zsh", "fish"] as const;

type Shell = (typeof SHELLS)[number];

interface CompletionChild {
  name: string;
  aliases: string[];
  description: string;
}

interface CompletionOption {
  flag: string;
  description: string;
}

/** One completable command: the words typed to reach it and everything valid right after them. */
interface CompletionNode {
  /** Command path below the program name, e.g. `["agent", "list"]`; empty for the program itself. */
  path: string[];
  children: CompletionChild[];
  options: CompletionOption[];
  requiredValueFlags: string[];
}

function isVisible(command: Command): boolean {
  return Reflect.get(command, "_hidden") !== true;
}

function collectNodes(command: Command, path: string[] = []): CompletionNode[] {
  const children = command.commands
    .filter(isVisible)
    .map((child) => ({
      name: child.name(),
      aliases: [...child.aliases()],
      description: child.description()
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const options = command.options
    .filter((option) => !option.hidden && option.long !== undefined)
    .map((option) => ({ flag: option.long!, description: option.description }));
  const optionsByFlag = new Map<string, Option>();
  for (let current: Command | null = command; current; current = current.parent) {
    for (const option of current.options) {
      for (const flag of [option.long, option.short]) {
        if (flag !== undefined && !optionsByFlag.has(flag)) {
          optionsByFlag.set(flag, option);
        }
      }
    }
  }
  const requiredValueFlags = [...optionsByFlag]
    .filter(([, option]) => option.required && !option.variadic)
    .map(([flag]) => flag);

  if (children.length === 0 && options.length === 0 && requiredValueFlags.length === 0) {
    return [];
  }

  return [
    { path, children, options, requiredValueFlags },
    ...command.commands
      .filter(isVisible)
      .flatMap((child) =>
        [child.name(), ...child.aliases()].flatMap((name) =>
          collectNodes(child, [...path, name])
        )
      )
  ];
}

function completionWords(node: CompletionNode): string[] {
  return [
    ...node.children.flatMap((child) => [child.name, ...child.aliases]),
    ...node.options.map((option) => option.flag)
  ];
}

function renderValueFlagCases(nodes: CompletionNode[]): string[] {
  return nodes
    .filter((node) => node.requiredValueFlags.length > 0)
    .map((node) =>
      `      ${node.requiredValueFlags.map((flag) => `"${node.path.join(" ")}:${flag}"`).join("|")}) expecting_value=1; continue;;`
    );
}

function renderBash(nodes: CompletionNode[]): string {
  const cases = nodes.map(
    (node) => `    "${node.path.join(" ")}") completions="${completionWords(node).join(" ")}";;`
  );
  return [
    "# poe-code bash completion. Install with: eval \"$(poe-code completion bash)\"",
    "_poe_code_complete() {",
    "  local current key word index expecting_value",
    "  COMPREPLY=()",
    '  current="${COMP_WORDS[COMP_CWORD]}"',
    '  key=""',
    "  expecting_value=0",
    "  for (( index=1; index < COMP_CWORD; index++ )); do",
    '    word="${COMP_WORDS[index]}"',
    "    if (( expecting_value )); then",
    "      expecting_value=0",
    "      continue",
    "    fi",
    '    case "$key:$word" in',
    ...renderValueFlagCases(nodes),
    "    esac",
    '    [[ "$word" == -* ]] && continue',
    '    key="${key:+$key }$word"',
    "  done",
    "  (( expecting_value )) && return",
    "  local completions",
    '  case "$key" in',
    ...cases,
    '    *) completions="";;',
    "  esac",
    '  COMPREPLY=( $(compgen -W "$completions" -- "$current") )',
    "}",
    "complete -F _poe_code_complete poe-code",
    "complete -F _poe_code_complete poe"
  ].join("\n");
}

function renderZsh(nodes: CompletionNode[]): string {
  const cases = nodes.map(
    (node) => `    "${node.path.join(" ")}") completions=(${completionWords(node).join(" ")});;`
  );
  return [
    "#compdef poe-code poe",
    '# poe-code zsh completion. Install with: eval "$(poe-code completion zsh)"',
    "_poe_code() {",
    "  local key word index expecting_value",
    '  key=""',
    "  expecting_value=0",
    "  for (( index=2; index < CURRENT; index++ )); do",
    '    word="${words[index]}"',
    "    if (( expecting_value )); then",
    "      expecting_value=0",
    "      continue",
    "    fi",
    '    case "$key:$word" in',
    ...renderValueFlagCases(nodes),
    "    esac",
    '    [[ "$word" == -* ]] && continue',
    '    key="${key:+$key }$word"',
    "  done",
    "  (( expecting_value )) && return",
    "  local -a completions",
    '  case "$key" in',
    ...cases,
    "    *) completions=();;",
    "  esac",
    "  compadd -- $completions",
    "}",
    "compdef _poe_code poe-code poe"
  ].join("\n");
}

function quoteFish(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function fishCondition(path: string[]): string {
  return path.length === 0
    ? '"__fish_use_subcommand"'
    : `"__fish_seen_subcommand_from ${path.at(-1)}"`;
}

function renderFish(nodes: CompletionNode[]): string {
  const lines = nodes.flatMap((node) => {
    const condition = fishCondition(node.path);
    return [
      ...node.children.flatMap((child) =>
        [child.name, ...child.aliases].map(
          (word) =>
            `complete -c poe-code -n ${condition} -a ${quoteFish(word)} -d ${quoteFish(child.description)}`
        )
      ),
      ...node.options.map(
        (option) =>
          `complete -c poe-code -n ${condition} -l ${option.flag.replace(/^--/, "")} -d ${quoteFish(option.description)}`
      )
    ];
  });
  return [
    "# poe-code fish completion. Install with:",
    "#   poe-code completion fish > ~/.config/fish/completions/poe-code.fish",
    "complete -c poe-code -f",
    ...lines
  ].join("\n");
}

const RENDERERS: Record<Shell, (nodes: CompletionNode[]) => string> = {
  bash: renderBash,
  zsh: renderZsh,
  fish: renderFish
};

export function registerCompletionCommand(program: Command): void {
  const command = program
    .command("completion")
    .description("Print a shell completion script for bash, zsh, or fish.")
    .addArgument(
      new Argument("<shell>", "Shell to generate completions for.").choices([...SHELLS])
    )
    .action((shell: Shell) => {
      process.stdout.write(`${RENDERERS[shell](collectNodes(program))}\n`);
    });

  setHelpGuidance(command, {
    examples: [
      'eval "$(poe-code completion bash)"',
      'eval "$(poe-code completion zsh)"',
      "poe-code completion fish > ~/.config/fish/completions/poe-code.fish"
    ],
    notes: [
      "The script is generated from the installed command tree, so re-run it after upgrading poe-code."
    ]
  });
}
