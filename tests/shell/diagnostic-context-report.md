# NUL diagnostic source contexts

Author evidence; independent acceptance remains required. Original old-nine
captures/tests and independent diagnostic-recheck fixtures are unchanged.

## Frozen controls and first fix

`diagnostic-context-native.json` freezes all25 author cases under each complete
profile before product edits. GNU Bash5.3 is the selected primary, Bash3.2 the
historical comparison, not a per-case oracle. The capture records executable
hash/version, C locale, OS argv0 bash, outer command name shell; nested bash uses
a temporary PATH symlink to that same profile's executable. No native product
processes or host PATH access are added. `/bin/cat` is a separately hashed native
test utility. Each oracle has a2500ms process-group deadline and256KiB output cap.
Temporary directories are removed after each capture; startup environment is
scrubbed by the existing bounded helper. Stdout/stderr are exact base64 bytes;
status and all regular-file effects are compared without normalization.

`diagnostic-context-red.json` preserves initial virtual3/25. The initial scratch
fixture used `/dev/null`, which the VFS does not provide implicitly; before source
edits this was transparently corrected to an ordinary scratch file, with its
bytes included in both observations. The earlier scratch capture remains at
`/tmp/safe-bash-diagnostic-context-native.json`; it is not the frozen acceptance
oracle. No existing fixture was modified.

The first source change renders NUL warnings using the existing script context,
and retains a function definition's source name on its copied body for later
calls, including functions defined by source/dot. Function registry kind and
function display remain unchanged. Author name controls10/10 and previous
source/dot/eval diagnostics48/48 pass. Line-mapping controls remain pending the
separate metadata fix. No other diagnostic policy or byte filtering is changed.

Reproduce from the repository root:

```sh
node --import tsx tests/shell/diagnostic-context-native.ts capture > /tmp/new-native.json
node --import tsx tests/shell/diagnostic-context-native.ts compare > /tmp/new-comparison.json
node --import tsx --test tests/shell/diagnostic-context.test.ts
```

The capture command does not overwrite the committed oracle. The comparison runs
virtual cases against both complete frozen profiles. Historical3.2 has no NUL
warnings and its differences are retained, not selected expectations or waivers.
