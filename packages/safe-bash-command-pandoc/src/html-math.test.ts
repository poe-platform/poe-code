import { expect, it } from "vitest";
import { readDocument } from "./engine.js";
import { createStandalonePandocCommand } from "./safe-bash.js";

const equation = '<p>Equation: <math><mi>x</mi><mo>+</mo><mn>1</mn></math> done.</p>';

it.each(["markdown", "json"])("preserves HTML MathML in command %s output", async to => {
  const stdout: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "html", "-t", to],
    stdin: [new TextEncoder().encode(equation)],
    signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout.push(bytes); } },
    stderr: { write: async () => {} }
  });
  expect(result.exitCode).toBe(0);
  const output = new TextDecoder().decode(Buffer.concat(stdout));
  if (to === "markdown") expect(output).toBe("Equation\\: $x + 1$ done.\n");
  else expect(JSON.parse(output).blocks[0].c).toContainEqual({t: "Math", c: [{t: "InlineMath"}, "x + 1"]});
});

it.each([
  ['<math display="block"><mfrac><msup><mi>x</mi><mn>2</mn></msup><msqrt><mi>y</mi></msqrt></mfrac></math>', "DisplayMath", "\\frac{x^{2}}{\\sqrt{y}}"],
  ['<math><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup><mo>=</mo><mroot><mi>y</mi><mn>3</mn></mroot></math>', "InlineMath", "x_{i}^{2} = \\sqrt[3]{y}"],
  ['<math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">duplicate</annotation></semantics></math>', "InlineMath", "x + 1"],
  ['<math><mtext>cost &amp; tax</mtext></math>', "InlineMath", "\\text{cost \\& tax}"],
  ['<math><msup><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mn>2</mn></msup></math>', "InlineMath", "{x + 1}^{2}"],
  ['<math><mrow><mi>α</mi><mo>≤</mo><mi>β</mi></mrow></math>', "InlineMath", "α ≤ β"]
])("reads MathML structure through the SDK: %s", async (html, mode, tex) => {
  const document = await readDocument({bytes: new TextEncoder().encode(html)}, {from: "html"}, {});
  expect(document.blocks).toEqual([{t: "Plain", c: [{t: "Math", c: [mode, tex]}]}]);
});

it("bounds MathML parsing", async () => {
  await expect(readDocument({bytes: new TextEncoder().encode(`<math>${"<mrow>".repeat(30)}<mi>x</mi>${"</mrow>".repeat(30)}</math>`)}, {from: "html"}, {limits: {depth: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
});
