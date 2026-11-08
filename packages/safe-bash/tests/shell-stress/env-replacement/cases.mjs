export const nativeCases = [
  { id: 'original-env-unset', script: 'env -i A=1 B=2 env -u A' },
  { id: 'unset-pipeline-cat', script: 'env -i A=1 B=2 env -u A | cat' },
  { id: 'inherited-unset', script: 'export PUBLIC=gone; env -u PUBLIC {{BASH}} -c \'printf "%s\\n" "${PUBLIC-unset}"\'' },
  { id: 'prefix-cleared', script: 'PREFIX=gone env -i KEEP=value env' },
  { id: 'empty-env-reporter', script: 'env -i env' },
  { id: 'pwd-is-data', script: 'env -i PWD=datum env' },
  { id: 'env-C-independent-cwd', script: 'env -i -C work KEEP=value PWD=datum {{BASH}} -c \'printf "%s" "$KEEP" > effect\'; printf parent > parent-effect' },
  { id: 'bash-export-boundary', script: 'SECRET=secret; export PUBLIC=public; env -i KEEP=value {{BASH}} -c \'printf "%s:%s:%s\\n" "${SECRET-unset}" "${PUBLIC-unset}" "$KEEP"\'' },
  { id: 'sh-export-boundary', script: 'SECRET=secret; export PUBLIC=public; env -i KEEP=value {{SH}} -c \'printf "%s:%s:%s\\n" "${SECRET-unset}" "${PUBLIC-unset}" "$KEEP"\'' },
  { id: 'parent-success-attributes', script: 'SECRET=secret; export PUBLIC=public; env -i {{BASH}} -c \'export SECRET=child PUBLIC=child\'; printf "%s:%s\\n" "$SECRET" "$PUBLIC"; {{BASH}} -c \'printf "%s:%s\\n" "${SECRET-unset}" "$PUBLIC"\'' },
  { id: 'parent-failure-function-local', script: 'SECRET=outer; export PUBLIC=public; call() { local SECRET=inner; env -i {{BASH}} -c "exit 7"; printf "%s:%s:%s\\n" "$?" "$SECRET" "$PUBLIC"; }; call; printf "%s:%s\\n" "$SECRET" "$PUBLIC"' },
  { id: 'binary-pipeline', script: "printf '\\000\\377A' | env -i cat" },
  { id: 'empty-input', script: 'printf "" | env -i cat; printf done' },
  { id: 'literal-child-arguments', script: 'env -i {{BASH}} -c \'printf "<%s>\\n" "$@"\' child "" \'a b\' \'; printf forbidden\' \'$PUBLIC\'' },
  { id: 'entry-order-raw-control', script: 'env -i A=1 B=2' },
];

export const hostCases = [
  { id: 'compat-merge-omitted-false', kind: 'merge' },
  { id: 'exact-map-pwd-cwd', kind: 'exact' },
  { id: 'empty-and-omitted-map', kind: 'empty' },
  { id: 'real-core-env-reporter', kind: 'core' },
  { id: 'stdin-binary-origin-cursor', kind: 'stdin' },
  { id: 'literal-middleware-dispatch', kind: 'literal' },
  { id: 'parent-success-failure-locals', kind: 'parent' },
  { id: 'bad-key-nul-before-effects', kind: 'validation' },
  { id: 'typed-cancellation-parent-context', kind: 'cancel' },
  { id: 'shared-budget-dispatch-witnesses', kind: 'budgets' },
];

export const hostRequirements = {
  merge: 'Omitted and false replaceEnv retain PUBLIC and PWD, add ONLY, exclude unexported SECRET; parent context unchanged.',
  exact: 'replaceEnv:true passes precisely {ONLY:value,PWD:datum}; cwd=/fixture/work independently; no PUBLIC or SECRET.',
  empty: 'replaceEnv:true with env:{} and with env omitted both pass exactly {} to registry reporter.',
  core: 'PREFIX=gone env -i KEEP=value reporter gives exactly KEEP=value; env -i reporter gives {}. Real Shell+agentCommands required.',
  stdin: 'Default=true, explicit-empty=false, supplied binary=false; one chunk consumed by replacement child, next by parent, no cursor reset or EOF-origin change.',
  literal: 'Exactly one reporter registry execution and middleware invocation with unchanged literal argv and replacement map.',
  parent: 'Parent PUBLIC export, SECRET nonexported variable, function-local shadow, cwd and context map unchanged after success and status7.',
  validation: 'BAD=KEY, NUL key and NUL value reject before reporter effects; no expectation about an unapproved empty-name policy.',
  cancel: 'Injected pending child receives cancellation, execution rejects exact FsError ENOENT reason; no later marker, caller context unchanged in finally. Internal locals after aborted exec are not externally inspectable.',
  budgets: 'Commands/output/depth/source/loops share budgets across replacement invokes; exact ShellLimitError.limit and intended registry dispatch witnesses, not a missing-command diagnostic overflow.',
};
