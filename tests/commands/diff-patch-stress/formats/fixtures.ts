export interface EditFlow {
  readonly name: string;
  readonly old: string;
  readonly next: string;
  readonly ambiguous?: boolean;
}

const operations = ["insert", "delete", "replace", "expand", "contract", "separated", "prepend", "append"] as const;
const generated: EditFlow[] = [];
for (let variant = 0; variant < 12; variant++) {
  for (const operation of operations) {
    const length = 7 + variant;
    const old = Array.from({ length }, (_, index) => `v${variant}-original-${index}\n`);
    const next = [...old];
    const position = 1 + variant % (length - 3);
    const added = `v${variant}-added-${operation}\n`;
    if (operation === "insert") next.splice(position, 0, added);
    if (operation === "delete") next.splice(position, 2);
    if (operation === "replace") next.splice(position, 2, added, `v${variant}-second\n`);
    if (operation === "expand") next.splice(position, 1, added, `v${variant}-second\n`, `v${variant}-third\n`);
    if (operation === "contract") next.splice(position, 3, added);
    if (operation === "separated") { next[1] = added; next[length - 2] = `v${variant}-distant\n`; }
    if (operation === "prepend") next.unshift(added, `v${variant}-prefix\n`);
    if (operation === "append") next.push(added, `v${variant}-suffix\n`);
    generated.push({ name: `${operation}-${variant}`, old: old.join(""), next: next.join("") });
  }
}

const special: EditFlow[] = [
  { name: "empty-both", old: "", next: "" },
  { name: "insert-into-empty", old: "", next: "new\nsecond\n" },
  { name: "delete-to-empty", old: "old\nsecond\n", next: "" },
  { name: "empty-to-incomplete", old: "", next: "unclosed" },
  { name: "incomplete-to-empty", old: "unclosed", next: "" },
  { name: "empty-to-blank", old: "", next: "\n" },
  { name: "blank-to-empty", old: "\n", next: "" },
  { name: "eof-add-newline", old: "finish", next: "finish\n" },
  { name: "eof-delete-newline", old: "finish\n", next: "finish" },
  { name: "eof-change-incomplete", old: "anchor\nold", next: "anchor\nnew" },
  { name: "eof-context-incomplete", old: "old\nlast", next: "new\nlast" },
  { name: "crlf-replace", old: "first\r\nold\r\nlast\r\n", next: "first\r\nnew\r\nlast\r\n" },
  { name: "mixed-line-endings", old: "first\r\nold\nlast\r", next: "first\r\nnew\nlast\r" },
  { name: "unicode", old: "zażółć\n旧🙂\nτέλος\n", next: "zażółć\n新🦀\nτέλος\n" },
  { name: "bom-context", old: "\ufeffanchor\nold\n", next: "\ufeffanchor\nnew\n" },
  { name: "bom-change", old: "\ufeffold\nend\n", next: "\ufeffnew\nend\n" },
  { name: "long-line", old: `start\n${"α".repeat(4096)}OLD\nend\n`, next: `start\n${"α".repeat(4096)}NEW\nend\n` },
  { name: "syntax-looking-lines", old: "*** target\n--- old\n***************\n1c1\n", next: "*** target\n--- new\n***************\n1c1\n" },
  ...Array.from({ length: 14 }, (_, variant) => ({
    name: `repeated-alignment-${variant}`,
    old: `head-${variant}\n${"same\n".repeat(2 + variant % 4)}pivot\n${"same\n".repeat(1 + variant % 3)}tail-${variant}\n`,
    next: `head-${variant}\n${"same\n".repeat(1 + variant % 3)}pivot\nnew-${variant}\n${"same\n".repeat(2 + variant % 4)}tail-${variant}\n`,
    ambiguous: true,
  })),
];

export const editflows: readonly EditFlow[] = [...generated, ...special];
export const contextCounts = [0, 1, 3, 32] as const;
