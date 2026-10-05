import { HtmlBudget } from "./contracts.js";
import { HtmlTokenFramer } from "./token-framer.js";
import { HtmlTokenizer, type HtmlToken } from "./tokenizer.js";

/** Source-only convenience parsing retains each lexical frame as a string. */
export class StreamingHtmlTokenizer extends HtmlTokenFramer<string, HtmlToken> {
  constructor(source: AsyncIterable<string>, budget: HtmlBudget) {
    super(source, budget, () => {
      let value = "";
      return { write(chunk) { value += chunk; }, finish() { return value; } };
    }, (frame, raw, foreign) => new HtmlTokenizer(frame, budget).next(raw, foreign));
  }
}
