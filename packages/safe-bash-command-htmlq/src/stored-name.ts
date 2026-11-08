import type { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import type { HtmlBudget } from "./contracts.js";

/** Preserve String#toLowerCase used by legacy end-tag recovery. Sigma is the
 * only default Unicode lowercase mapping that needs surrounding text. Its
 * arbitrarily long case-ignorable suffix is scanned in storage, never retained. */
export async function lowerStoredName(text: TextStore, root: number, budget: HtmlBudget): Promise<number> {
  const builder = text.builder();
  let precedingCased = false, offset = 0;
  for await (const chunk of text.chunks(root)) {
    let result = "";
    for (const c of chunk) {
      offset += c.length; budget.charge("work", c.length);
      let lowered = c.toLowerCase();
      if (c === "Σ" && precedingCased) {
        let followingCased = false;
        for await (const next of text.characters(await text.slice(root, offset))) {
          budget.charge("work", next.length);
          if (/\p{Case_Ignorable}/u.test(next)) continue;
          followingCased = /\p{Cased}/u.test(next); break;
        }
        if (!followingCased) lowered = "ς";
      }
      result += lowered;
      if (!/\p{Case_Ignorable}/u.test(c)) precedingCased = /\p{Cased}/u.test(c);
    }
    await builder.write(result);
  }
  return builder.finish();
}
