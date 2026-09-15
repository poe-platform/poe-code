import type { OpCommandContext } from "./cli.js";
import type { OpBackendRequest } from "./types.js";
import { resolveOpCompletion } from "./completion-resolver.js";

export function createCompletionCallbackHandler(channel: "stable" | "beta" = "stable") {
  return async (request: OpBackendRequest, context: OpCommandContext): Promise<{ exitCode: number }> => {
    if (request.resource !== "__complete" && request.resource !== "__completeNoDesc") throw new Error("Invalid completion callback");
    context.signal.throwIfAborted();
    const result = resolveOpCompletion(request.args, channel);
    const lines = result.candidates.map(candidate => request.resource === "__complete" ? `${candidate.value}\t${candidate.description}` : candidate.value);
    lines.push(`:${result.directive}`);
    await context.stdout.write(new TextEncoder().encode(`${lines.join("\n")}\n`));
    return { exitCode: 0 };
  };
}

export function createCompletionHandler(channel: "stable" | "beta" = "stable") {
  if (channel !== "stable" && channel !== "beta") throw new Error("Invalid completion channel");
  return async (request: OpBackendRequest, context: OpCommandContext): Promise<{ exitCode: number }> => {
    const shell = request.args[0];
    if (request.args.length !== 1 || !["bash", "zsh", "fish", "powershell"].includes(shell)) {
      throw new Error("completion requires one shell: bash, zsh, fish, or powershell");
    }
    context.signal.throwIfAborted();
    let lines: string[];
    if (shell === "bash") {
      lines = [
        "_op() {",
        "  local response directive choice current op_cword",
        "  local -a op_words",
        '  if declare -F _get_comp_words_by_ref >/dev/null; then',
        '    _get_comp_words_by_ref -n =: -w op_words -i op_cword -c current || return',
        '  else',
        '    op_words=("${COMP_WORDS[@]}")',
        '    op_cword=$COMP_CWORD',
        '    current="${op_words[op_cword]}"',
        '  fi',
        '  op_words[op_cword]="$current"',
        '  COMPREPLY=()',
        '  response=$(OP_COMPATIBILITY_CHANNEL=' + channel + ' "${op_words[0]}" __completeNoDesc "${op_words[@]:1:op_cword}" 2>/dev/null) || return',
        '  directive="${response##*$\'\\n\'}"',
        '  case "$directive" in',
        '    :0) while IFS= read -r choice; do COMPREPLY+=("$choice"); done < <(compgen -f -- "$current") ;;',
        '    :4) while IFS= read -r choice; do [[ "$choice" == :4 ]] || COMPREPLY+=("$choice"); done <<< "$response" ;;',
        '  esac',
        '}',
        'complete -o filenames -F _op op',
      ];
    } else if (shell === "zsh") {
      lines = [
        '#compdef op',
        '_op() {',
        '  local line directive',
        '  local -a response candidates descriptions',
        '  response=("${(@f)$(OP_COMPATIBILITY_CHANNEL=' + channel + ' "${words[1]}" __complete "${(@)words[2,CURRENT]}" 2>/dev/null)}")',
        '  directive="${response[-1]}"',
        '  case "$directive" in',
        '    :0) _files ;;',
        '    :4)',
        '      for line in "${response[@]}"; do',
        '        [[ "$line" == :4 ]] && continue',
        '        candidates+=("${line%%$\'\\t\'*}")',
        '        descriptions+=("${line#*$\'\\t\'}")',
        '      done',
        '      (( ${#candidates} )) && compadd -d descriptions -- "${candidates[@]}"',
        '      ;;',
        '  esac',
        '  return 0',
        '}',
        'compdef _op op',
      ];
    } else if (shell === "fish") {
      lines = [
        'function __op_candidates',
        '  set -lx OP_COMPATIBILITY_CHANNEL ' + channel,
        '  set -l tokens (commandline -opc)',
        '  set -l current (commandline -ct)',
        '  set -l response ($tokens[1] __complete $tokens[2..-1] "$current" 2>/dev/null)',
        '  set -l directive $response[-1]',
        '  switch "$directive"',
        '    case :0',
        '      __fish_complete_path "$current"',
        '    case :4',
        '      set -e response[-1]',
        '      for candidate in $response',
        '        printf "%s\\n" "$candidate"',
        '      end',
        '  end',
        'end',
        "complete -c op -f -a '(__op_candidates)'",
      ];
    } else {
      lines = [
        'Register-ArgumentCompleter -Native -CommandName op -ScriptBlock {',
        '  param($wordToComplete, $commandAst, $cursorPosition)',
        '  $program = $commandAst.CommandElements[0].Value',
        '  $arguments = @()',
        '  foreach ($element in ($commandAst.CommandElements | Select-Object -Skip 1)) {',
        '    if ($element.Extent.EndOffset -ge $cursorPosition) { break }',
        '    if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $arguments += $element.Value }',
        '    else { $arguments += $element.Extent.Text }',
        '  }',
        '  $current = $wordToComplete',
        '  if ($current -eq "" -and ($PSVersionTable.PSVersion -lt [version]"7.3" -or $PSNativeCommandArgumentPassing -eq "Legacy")) { $current = \'""\' }',
        '  $previousChannel = $env:OP_COMPATIBILITY_CHANNEL',
        '  try {',
        "    $env:OP_COMPATIBILITY_CHANNEL = '" + channel + "'",
        '    $response = @(& $program __complete @arguments $current 2>$null)',
        '  } finally { $env:OP_COMPATIBILITY_CHANNEL = $previousChannel }',
        '  if ($response.Count -eq 0) { return }',
        '  $directive = $response[-1]',
        '  if ($directive -eq ":0") { return }',
        '  if ($directive -ne ":4") { ""; return }',
        '  if ($response.Count -eq 1) { ""; return }',
        '  foreach ($line in $response[0..($response.Count - 2)]) {',
        '    $parts = $line.Split([char]9, 2)',
        '    $description = if ($parts.Count -gt 1) { $parts[1] } else { " " }',
        "    [System.Management.Automation.CompletionResult]::new($parts[0], $parts[0], 'ParameterValue', $description)",
        '  }',
        '}',
      ];
    }
    await context.stdout.write(new TextEncoder().encode(`${lines.join("\n")}\n`));
    return { exitCode: 0 };
  };
}
