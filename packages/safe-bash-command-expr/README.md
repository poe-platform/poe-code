# expr

Run `expr` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { exprCommands } from "@poe-platform/safe-bash/commands/expr";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(exprCommands());
const result = await shell.exec("expr --help");
```

The module also exports `createExprCommand`, its command-list factory, and typed options and limits.

`expr` supports string comparisons, integer arithmetic, `length`, `index`, `substr`, and anchored BRE matching with `:` or `match`. For example, `LANG=en_US.UTF-8 expr foo = foo` prints `1`, `expr 123 : '[0-9]*'` prints `3`, and `LANG=UTF-8 expr length héllo` prints `5`.

Locale precedence is `LC_ALL`, then the relevant category (`LC_CTYPE` for characters, `LC_COLLATE` for ordering), then `LANG`. C/POSIX character operations count bytes; UTF-8 locales count Unicode scalars. UTF-8 encoding names accept `UTF-8` and `utf8` case-insensitively, including qualified names such as `fr_FR.UTF-8`. Equality compares exact strings, or integer values when both operands are integers. Ordering uses byte comparison for C/POSIX, C.UTF-8 and unqualified UTF-8, and the host's `Intl` collation for supported named UTF-8 locales.

UTF-8 locales admit bracket patterns to the bounded BRE matcher. Ranges retain scalar/byte ordering, and character classes retain the matcher's ASCII profile; locale-specific collating elements and equivalence classes are unsupported. The default portable provider accepts ASCII regex subjects and patterns; use the Node regex provider for Unicode regex matching. Character operations such as `length`, `index`, and `substr` support Unicode with either provider.

Byte-valued shell operands retain their original bytes, including undecodable
bytes, through comparisons and C/POSIX string operations. Operands are identified
by argument position, so distinct bytes with the same decoded display stay distinct.
NUL operands remain unsupported.

Pass `limits` to any factory or plugin to bound argument bytes, numeric digits,
parser nodes/depth, evaluation steps, string/output bytes, and BRE resources.
Limits default to `Infinity`; finite limits must be positive safe integers. The
selected regex provider also enforces its own ceilings. Exit statuses are 0 for
a true value, 1 for zero/empty, 2 for invalid expressions, and 3 for resource or
execution failures. Cancellation propagates the caller's reason.
