# @poe-code/ts-ast

Search code by syntax and rewrite matched spans without reformatting the file. This private workspace engine runs entirely in JavaScript, with no native binaries, filesystem access, or runtime package dependencies.

| API | Use |
| --- | --- |
| `parseCode(source, languageOrFilename)` | Parse TS, TSX, JS, JSX, JSON, YAML, HTML or CSS |
| `findMatches(tree, patternOrRule)` | Find structural matches in source order |
| `matchPattern(node, patternOrRule)` | Match a particular syntax node |
| `rewriteCode(tree, patternOrRule, template)` | Replace outermost matches, preserving surrounding source |
| `applyEdits(source, edits)` | Apply validated, nonoverlapping UTF-8 byte edits |
| `walk(node)` / `tree.walk()` | Visit syntax, punctuation, comments and whitespace |

```ts
import { parseCode, findMatches, rewriteCode } from '@poe-code/ts-ast';

const tree = parseCode('  console.log(a, /* keep */ b); // note\n', 'example.ts');
const matches = findMatches(tree, 'console.log($$$ARGS)');
matches[0].captures.ARGS.text; // 'a, /* keep */ b'
rewriteCode(tree, 'console.log($$$ARGS)', 'logger.info($$$ARGS)');
// '  logger.info(a, /* keep */ b); // note\n'
```

`$NAME` captures one node; `$_` matches without recording it. `$$$NAME` captures zero or more nodes in a sequence, and `$$$` is anonymous. Repeated names must have equal syntax, ignoring comments and optional separators. Variadics support arguments, arrays, properties, statements and JSX children. Captures contain `nodes`, `text`, and `range`, keyed by the name without dollars. Captured text includes original trivia between captured nodes. Empty captures have empty text and a zero-width range at the containing node's start.

Patterns are parsed in the input language. JSON accepts unquoted metavariables (`{"key": $VALUE}`, `{$$$PROPERTIES}`); quoted dollar strings stay literal. JSON properties and CSS declarations may be searched as fragments (`"key": $VALUE`, `color: $VALUE;`). Invalid patterns throw. Source syntax errors are retained as `ERROR` nodes and listed in `tree.errors`.

```ts
findMatches(tree, {
  all: [
    { pattern: 'console.log($VALUE)' },
    { inside: { kind: 'FunctionDeclaration' } },
    { not: { has: { regex: '^secret$' } } }
  ]
});
```

Rules support `pattern`, `kind`, JavaScript Unicode `regex`, `all`, `any`, `not`, `inside`, `has`, `follows`, and `precedes`. Multiple fields are conjunctive. `inside` searches ancestors; `has` searches descendants; `follows` and `precedes` search earlier and later siblings, skipping trivia. Expression statements are transparent to sibling relations. Successful positive rules share captures; failed alternatives and negations do not leak them. Kind names are the case-sensitive Lezer grammar names (for example `CallExpression`, `VariableName`, `Property`, `Element` and `Declaration`), available on every node.

Every node exposes `text`, `kind`, `children`, `parent`, `previousSibling`, `nextSibling`, `trivia`, `language`, `range`, `start`, and `end`. Ranges are half-open **UTF-8 byte offsets**; coordinates use zero-based lines and UTF-8 byte columns. Navigation includes punctuation and trivia. Leaf text concatenates to the original source. Use `tree.errors` before rewriting if your application requires syntactically valid input.

Edits use `{ range: [startByte, endByte], replacement }`. Invalid, overlapping or split-code-point spans throw before producing output. Rewrites run once against the original tree; nested matches inside a replaced span are skipped. Templates substitute named captures verbatim and throw on unknown names. Text outside replacement spans, including indentation and line endings, is unchanged; templates control formatting inside replacements.

The single ESM bundle includes the MIT-licensed Lezer grammars and runtime. It is intended for bundling into consumers, not independent publication.
