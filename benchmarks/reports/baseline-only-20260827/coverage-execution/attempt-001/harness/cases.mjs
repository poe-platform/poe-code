const text = value => Buffer.from(value).toString("base64");

const recipe = (name, script, stdout, extra = {}) => ({
  id: `${name === "." ? "dot" : name}-positive`,
  name,
  cohort: "historical-unmeasured",
  configuration: "default",
  cwd: "/fixture",
  env: {},
  stdinBase64: "",
  files: {},
  directories: [],
  symlinks: {},
  script,
  targetArgv: null,
  expected: {
    exitCode: 0,
    ...(stdout === null ? {} : { stdoutBase64: text(stdout) }),
    stderrBase64: "",
    files: {},
    absent: [],
    preserveInputs: true,
  },
  intent: "",
  proofLimit: "One bounded positive recipe, not complete command or option coverage.",
  ...extra,
});

const file = (name, script, stdout, contents, intent, extra = {}) => recipe(name, script, stdout, {
  files: Object.fromEntries(Object.entries(contents).map(([path, content]) => [path, { base64: text(content), mode: 0o644 }])),
  intent,
  ...extra,
});

export const cases = [
  recipe("alias", "alias greet='printf alias-ok' && shopt -s expand_aliases && eval greet", "alias-ok", { targetArgv: ["alias", "greet=printf alias-ok"], intent: "Define and expand an alias into an actual command, not merely list its definition." }),
  recipe("builtin", "builtin printf '%s\\n' builtin-ok", "builtin-ok\n", { targetArgv: ["builtin", "printf", "%s\\n", "builtin-ok"], intent: "Dispatch the printf builtin through builtin." }),
  recipe("clear", "clear", "\u001b[2J\u001b[H", { targetArgv: ["clear"], intent: "Emit the documented terminal erase/home control sequence; capture raw terminal bytes." }),
  file("column", "column -t -s , -o '|' input.csv", "a |bb\ncc|d\n", { "input.csv": "a,bb\ncc,d\n" }, "Align unequal-width CSV fields into an exact table.", { targetArgv: ["column", "-t", "-s", ",", "-o", "|", "input.csv"] }),
  recipe("compgen", "compgen -W 'alpha alpine beta' al", "alpha\nalpine\n", { targetArgv: ["compgen", "-W", "alpha alpine beta", "al"], intent: "Compute prefix-filtered completion candidates." }),
  recipe("complete", "complete -W 'alpha beta' deploy && complete -p deploy", null, { intent: "Create and retrieve a named completion specification; no interactive completion claim.", expected: { exitCode: 0, stdoutIncludes: ["complete", "alpha beta", "deploy"], stderrBase64: "", files: {}, absent: [], preserveInputs: true }, proofLimit: "Stored specification only; an interactive completion engine is not exercised." }),
  recipe("compopt", "complete -W 'alpha beta' deploy && compopt -o nospace deploy && compopt deploy", null, { intent: "Mutate and retrieve options on an existing completion specification.", expected: { exitCode: 0, stdoutIncludes: ["nospace", "deploy"], stderrBase64: "", files: {}, absent: [], preserveInputs: true }, proofLimit: "Stored completion option only, not interactive behavior; complete is a prerequisite." }),
  recipe("date", "date -u -d @0 '+%Y-%m-%dT%H:%M:%SZ'", "1970-01-01T00:00:00Z\n", { targetArgv: ["date", "-u", "-d", "@0", "+%Y-%m-%dT%H:%M:%SZ"], intent: "Format a fixed epoch in UTC; do not query the wall clock." }),
  recipe("declare", "declare -i count=6 && count=count+7 && printf '%s\\n' \"$count\"", "13\n", { intent: "Declare an integer variable and observe arithmetic assignment semantics." }),
  recipe("dirs", "pushd /fixture/sub > /fixture/push-output && dirs -p", "/fixture/sub\n/fixture\n", { directories: ["sub"], intent: "Observe a nonempty directory stack after navigation; preserve pushd output separately.", expected: { exitCode: 0, stdoutBase64: text("/fixture/sub\n/fixture\n"), stderrBase64: "", files: {}, absent: [], preserveInputs: true } }),
  file("du", "du data.txt", "2\tdata.txt\n", { "data.txt": "x".repeat(2048) }, "Measure a 2048-byte file using the pinned logical-VFS-size profile.", { targetArgv: ["du", "data.txt"], proofLimit: "The baseline reports ceiling(logical bytes/1024), not native allocated blocks. No native disk-allocation parity claim; -b is not a supported pinned baseline option." }),
  file("egrep", "egrep '^(red|blue)$' colors", "red\nblue\n", { colors: "red\ngreen\nblue\n" }, "Use extended alternation through the actual egrep alias handler.", { targetArgv: ["egrep", "^(red|blue)$", "colors"] }),
  recipe("exec", "exec printf '%s\\n' exec-ok; target_status=$?; printf 'unexpected-tail\\n' > /fixture/after-exec; exit \"$target_status\"", "exec-ok\n", { targetArgv: ["exec", "printf", "%s\\n", "exec-ok"], intent: "Dispatch a real command through exec and require subsequent statements not to run. If they do run, preserve the target's own status rather than masking it.", expected: { exitCode: 0, stdoutBase64: text("exec-ok\n"), stderrBase64: "", files: {}, absent: ["after-exec"], preserveInputs: true }, proofLimit: "Virtual control-flow replacement only, never host-process replacement." }),
  file("expand", "expand -t 4 tabs", "a   b\n", { tabs: "a\tb\n" }, "Expand a tab to a fixed four-column stop.", { targetArgv: ["expand", "-t", "4", "tabs"] }),
  recipe("expr", "expr 7 + 5", "12\n", { targetArgv: ["expr", "7", "+", "5"], intent: "Evaluate a nonzero arithmetic expression." }),
  file("fgrep", "fgrep 'a.b' literals", "a.b\n", { literals: "a.b\naxb\n" }, "Match a literal dot without regex interpretation.", { targetArgv: ["fgrep", "a.b", "literals"] }),
  file("file", "file -b note.txt", null, { "note.txt": "plain text\n" }, "Classify deterministic ASCII text content, not a command label.", { targetArgv: ["file", "-b", "note.txt"], expected: { exitCode: 0, stdoutIncludes: ["ASCII text"], stderrBase64: "", files: {}, absent: [], preserveInputs: true } }),
  file("fold", "fold -w 4 lines", "abcd\nefgh\nij\n", { lines: "abcdefghij\n" }, "Wrap a ten-character line at four columns.", { targetArgv: ["fold", "-w", "4", "lines"] }),
  recipe("getopts", "getopts 'n:' option -n value && printf '%s:%s:%s\\n' \"$option\" \"$OPTARG\" \"$OPTIND\"", "n:value:3\n", { targetArgv: ["getopts", "n:", "option", "-n", "value"], intent: "Parse an option argument and observe all three resulting variables." }),
  recipe("hash", "hash -p /bin/echo echo && hash -t echo && echo hash-ok", "/bin/echo\nhash-ok\n", { intent: "Assign and retrieve a command hash mapping, then dispatch the mapped command.", proofLimit: "Mapping and invocation do not establish cache performance or native PATH-search equivalence." }),
  recipe("help", "help printf > /fixture/help.txt", "", { targetArgv: ["help", "printf"], intent: "Attempt the intrinsic documentation operation and retain output as a VFS artifact; explicitly excluded from operational-tool success.", proofLimit: "User prohibits help/usage as operational proof. This name is attempted but can never earn functional credit from this recipe.", operationalCredit: false, expected: { exitCode: 0, stdoutBase64: "", stderrBase64: "", files: { "help.txt": { includes: ["printf"] } }, absent: [], preserveInputs: true } }),
  recipe("history", "history -c && history", "", { env: { BASH_HISTORY: '["printf old-entry"]' }, intent: "Clear a deliberately seeded history list and verify retrieval is empty.", proofLimit: "Seeded public environment storage, not proof that interactive commands are automatically recorded." }),
  recipe("hostname", "hostname", "localhost\n", { targetArgv: ["hostname"], intent: "Read the sandbox's virtual hostname, not the host machine identity.", proofLimit: "Pinned baseline returns a fixed virtual identity; no configurable/network hostname claim." }),
  file("html-to-markdown", "html-to-markdown page.html", null, { "page.html": "<h1>Release</h1><p>Ready <strong>now</strong>.</p>" }, "Convert structured HTML heading and emphasis into Markdown.", { targetArgv: ["html-to-markdown", "page.html"], expected: { exitCode: 0, stdoutIncludes: ["# Release", "**now**"], stdoutExcludes: ["<h1>", "<strong>"], stderrBase64: "", files: {}, absent: [], preserveInputs: true } }),
  recipe("let", "count=6; let 'count+=7' && printf '%s\\n' \"$count\"", "13\n", { targetArgv: ["let", "count+=7"], intent: "Mutate an arithmetic variable and observe its value." }),
  file("mapfile", "mapfile -t rows < rows.txt && printf '%s|%s\\n' \"${rows[0]}\" \"${rows[1]}\"", "alpha|beta\n", { "rows.txt": "alpha\nbeta\n" }, "Read two VFS lines into an indexed array without trailing delimiters."),
  file("nl", "nl -ba -w 1 -s ':' lines", "1:alpha\n2:\n3:beta\n", { lines: "alpha\n\nbeta\n" }, "Number every line, including an empty line.", { targetArgv: ["nl", "-ba", "-w", "1", "-s", ":", "lines"] }),
  recipe("popd", "pushd /fixture/sub > /fixture/push-output && popd > /fixture/pop-output && pwd", "/fixture\n", { directories: ["sub"], intent: "Return from a previously pushed directory; redirected target output remains captured in VFS." }),
  recipe("printenv", "printenv COVERAGE_VALUE", "fixture-value\n", { env: { COVERAGE_VALUE: "fixture-value" }, targetArgv: ["printenv", "COVERAGE_VALUE"], intent: "Retrieve a deliberately supplied environment variable." }),
  recipe("pushd", "pushd /fixture/sub > /fixture/push-output && pwd", "/fixture/sub\n", { directories: ["sub"], intent: "Change the current directory through stack navigation." }),
  file("readarray", "readarray -t rows < rows.txt && printf '%s|%s\\n' \"${rows[0]}\" \"${rows[1]}\"", "alpha|beta\n", { "rows.txt": "alpha\nbeta\n" }, "Invoke the readarray name to populate and read a two-element array."),
  file("rev", "rev lines", "cba\n321\n", { lines: "abc\n123\n" }, "Reverse characters independently on each line.", { targetArgv: ["rev", "lines"] }),
  recipe("seq", "seq 2 3 8", "2\n5\n8\n", { targetArgv: ["seq", "2", "3", "8"], intent: "Generate an inclusive stepped numeric sequence." }),
  file("shopt", "shopt -s dotglob && printf '%s\\n' *", ".hidden\nvisible\n", { ".hidden": "hidden\n", visible: "visible\n" }, "Enable dotglob and verify that glob expansion changes."),
  recipe("sleep", "sleep 0.02", "", { targetArgv: ["sleep", "0.02"], intent: "Await a nonzero short timer without an injected sleep shim.", expected: { exitCode: 0, stdoutBase64: "", stderrBase64: "", elapsedAtLeastMs: 10, files: {}, absent: [], preserveInputs: true }, proofLimit: "A broad lower-bound sanity check only; elapsed time is retained raw and is not a performance comparison." }),
  file("split", "split -l 2 rows part-", "", { rows: "alpha\nbeta\ngamma\n" }, "Split a three-line file into exact two-line/one-line VFS outputs.", { targetArgv: ["split", "-l", "2", "rows", "part-"], expected: { exitCode: 0, stdoutBase64: "", stderrBase64: "", files: { "part-aa": { base64: text("alpha\nbeta\n") }, "part-ab": { base64: text("gamma\n") } }, absent: [], preserveInputs: true } }),
  recipe("sqlite3", "sqlite3 /fixture/data.db 'CREATE TABLE items(name TEXT, value INTEGER); INSERT INTO items VALUES (\"alpha\", 2), (\"beta\", 3); SELECT sum(value) FROM items;'", "5\n", { configuration: "sqlite", targetArgv: ["sqlite3", "/fixture/data.db", 'CREATE TABLE items(name TEXT, value INTEGER); INSERT INTO items VALUES ("alpha", 2), ("beta", 3); SELECT sum(value) FROM items;'], intent: "Create a real virtual SQLite database, insert rows, and aggregate them.", expected: { exitCode: 0, stdoutBase64: text("5\n"), stderrBase64: "", files: { "data.db": { prefixBase64: text("SQLite format 3\u0000"), minBytes: 100 } }, absent: [], preserveInputs: true } }),
  recipe("strings", "strings -n 4 blob", "HELLO\nWORLD\n", { targetArgv: ["strings", "-n", "4", "blob"], files: { blob: { base64: Buffer.from([0, 1, ...Buffer.from("HELLO"), 0, 2, ...Buffer.from("WORLD"), 0]).toString("base64"), mode: 0o644 } }, intent: "Extract printable spans from binary VFS bytes." }),
  file("tac", "tac rows", "gamma\nbeta\nalpha\n", { rows: "alpha\nbeta\ngamma\n" }, "Reverse complete line order.", { targetArgv: ["tac", "rows"] }),
  recipe("time", "command time -f completed printf '%s\\n' timed", "timed\n", { targetArgv: ["time", "-f", "completed", "printf", "%s\\n", "timed"], intent: "Force the time registry wrapper, execute a child, and emit a deterministic format string rather than accidentally measuring the shell keyword.", expected: { exitCode: 0, stdoutBase64: text("timed\n"), stderrBase64: text("completed\n"), files: {}, absent: [], preserveInputs: true }, proofLimit: "Custom-format dispatch control, not timer accuracy or performance evidence." }),
  recipe("timeout", "timeout 5 printf '%s\\n' bounded", "bounded\n", { targetArgv: ["timeout", "5", "printf", "%s\\n", "bounded"], intent: "Run a successful child inside a deadline; this is not timeout-expiry/cancellation proof." }),
  file("tree", "tree tree-input", "tree-input\n├── a.txt\n└── sub\n    └── b.txt\n\n1 directory, 2 files\n", { "tree-input/a.txt": "a\n", "tree-input/sub/b.txt": "b\n" }, "Traverse a deterministic nested VFS tree using the supported default interface.", { targetArgv: ["tree", "tree-input"] }),
  recipe("typeset", "typeset -i count=6 && count=count+7 && printf '%s\\n' \"$count\"", "13\n", { intent: "Exercise integer declaration and arithmetic assignment via the typeset spelling." }),
  recipe("unalias", "alias echo='printf wrong' && unalias echo && eval 'echo restored'", "restored\n", { intent: "Remove an alias and verify normal dispatch is restored." }),
  file("unexpand", "unexpand -a -t 4 spaces", "a\tb\n", { spaces: "a   b\n" }, "Compress spaces to a fixed tab stop.", { targetArgv: ["unexpand", "-a", "-t", "4", "spaces"] }),
  recipe("wait", "printf 'child-done\\n' > /fixture/child.txt & wait", "", { intent: "Launch a virtual background write, wait, then inspect the resulting file outside the script.", expected: { exitCode: 0, stdoutBase64: "", stderrBase64: "", files: { "child.txt": { base64: text("child-done\n") } }, absent: [], preserveInputs: true }, proofLimit: "Pinned source says wait is a no-op and background execution is unsupported. Even matching output cannot establish asynchronous job-join semantics; never functional-credit a no-op.", operationalCredit: false }),
  recipe("which", "which echo", "/usr/bin/echo\n", { targetArgv: ["which", "echo"], intent: "Resolve a callable command's virtual path; separate from builtin type labels." }),
  recipe("whoami", "whoami", "user\n", { targetArgv: ["whoami"], intent: "Read the sandbox's virtual user identity.", proofLimit: "Pinned baseline's fixed virtual user is not host-user or permission enforcement evidence." }),
  file("xan", "xan select name rows.csv", "name\nalpha\nbeta\n", { "rows.csv": "name,value\nalpha,2\nbeta,3\n" }, "Project one named column from a CSV table.", { targetArgv: ["xan", "select", "name", "rows.csv"] }),
  file("yq", "yq -o json '.items[1].name' data.yaml", '"beta"\n', { "data.yaml": "items:\n  - name: alpha\n  - name: beta\n" }, "Parse YAML and extract a nested scalar as JSON.", { targetArgv: ["yq", "-o", "json", ".items[1].name", "data.yaml"] }),
  recipe("js-exec", "js-exec -c 'console.log(6 * 7)'", "42\n", { cohort: "additional-optional", configuration: "javascript", targetArgv: ["js-exec", "-c", "console.log(6 * 7)"], intent: "Execute guest JavaScript arithmetic in the shipped QuickJS worker, not host Node." }),
  recipe("node", "node -e 'console.log(6 * 7)'", "42\n", { cohort: "additional-optional", configuration: "javascript", targetArgv: ["node", "-e", "console.log(6 * 7)"], intent: "Attempt actual JavaScript execution through node and preserve the pinned diagnostic-stub response.", proofLimit: "No native Node fallback or js-exec substitution. A diagnostic response is baseline-stub, not a working runtime." }),
  ...["python", "python3"].map(name => recipe(name, `${name} -c 'from pathlib import Path; Path("/fixture/result.txt").write_text("42\\n"); print(6 * 7)'`, "42\n", { cohort: "additional-optional", configuration: "python", targetArgv: [name, "-c", 'from pathlib import Path; Path("/fixture/result.txt").write_text("42\\n"); print(6 * 7)'], intent: "Run guest Python arithmetic and write exact bytes through the shipped CPython VFS bridge.", expected: { exitCode: 0, stdoutBase64: text("42\n"), stderrBase64: "", files: { "result.txt": { base64: text("42\n") } }, absent: [], preserveInputs: true } })),
  ...[".", "source"].map(name => file(name, `${name} /fixture/loaded.sh && printf '%s\\n' "$LOADED_VALUE"`, "loaded\n", { "loaded.sh": "LOADED_VALUE=loaded\n" }, "Exercise the now-overlapping source handler, preserving its historical inventory row.", { cohort: "historical-measured-control" })),
  recipe("eval", "eval 'VALUE=loaded' && printf '%s\\n' \"$VALUE\"", "loaded\n", { cohort: "historical-measured-control", intent: "Exercise now-overlapping eval state mutation without changing historical results." }),
  recipe("printf", "printf 'ascii:%s\\n' control", "ascii:control\n", { cohort: "shared-control", targetArgv: ["printf", "ascii:%s\\n", "control"], intent: "Check shell invocation, terminal capture and known shared behavior." }),
  recipe("printf", "printf '\\000\\177\\200\\377' > bytes; cat bytes", null, { id: "terminal-byte-control", cohort: "shared-control", intent: "Separate exact internal VFS bytes from the public terminal-byte API.", expected: { exitCode: 0, stdoutBase64: Buffer.from([0, 127, 128, 255]).toString("base64"), stderrBase64: "", files: { bytes: { base64: Buffer.from([0, 127, 128, 255]).toString("base64") } }, absent: [], preserveInputs: true } }),
  recipe("curl", "curl -sS '{{BASE}}/fixture.txt' -o /fixture/download.txt", "", { cohort: "shared-optional-control", configuration: "loopback-network", targetArgv: ["curl", "-sS", "{{BASE}}/fixture.txt", "-o", "/fixture/download.txt"], intent: "Use each documented optional network plugin to download fixed loopback-only response bytes.", expected: { exitCode: 0, stdoutBase64: "", stderrBase64: "", files: { "download.txt": { base64: text("loopback-fixture\n") } }, absent: [], preserveInputs: true } }),
];

export const environment = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/home/user", TMPDIR: "/tmp", LANG: "C", LC_ALL: "C", TZ: "UTC", USER: "user" });
export const budgets = Object.freeze({ ordinaryMs: 30000, optionalMs: 120000, childGraceMs: 10000, maxOutputBytes: 4 * 1024 * 1024, maxCensusBytes: 32 * 1024 * 1024, maxEntries: 4096, maxDepth: 32 });
export const networkFixture = Object.freeze({ host: "127.0.0.1", method: "GET", path: "/fixture.txt", status: 200, contentType: "text/plain", bodyBase64: text("loopback-fixture\n") });

export function validateCases(inventory) {
  const names = cases.filter(specimen => specimen.cohort === "historical-unmeasured").map(specimen => specimen.name).sort();
  const expected = [...inventory.exactDefaultUnmeasuredNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("Historical unmeasured-name coverage differs from setup handoff");
  if (new Set(cases.map(specimen => specimen.id)).size !== cases.length) throw new Error("Duplicate recipe IDs");
  for (const specimen of cases) {
    if (!specimen.intent || !specimen.script || !specimen.expected) throw new Error(`Undeclared intent: ${specimen.id}`);
    for (const path of [...Object.keys(specimen.files), ...specimen.directories, ...Object.keys(specimen.symlinks)]) {
      if (path.startsWith("/") || path.split("/").some(part => ["", ".", ".."].includes(part))) throw new Error(`Unsafe fixture path: ${path}`);
    }
  }
  return { recipes: cases.length, historicalUnmeasured: names.length, optional: cases.filter(specimen => specimen.cohort === "additional-optional").length };
}
