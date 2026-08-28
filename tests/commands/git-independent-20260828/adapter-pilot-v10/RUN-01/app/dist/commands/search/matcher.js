import { RegexExecutionError } from "../regex-execution/client.js";
import { SearchError } from "./options.js";
export class Matcher {
    session;
    descriptor;
    constructor(patterns, args, session) {
        this.session = session;
        this.descriptor = { kind: "rg", patterns: [...patterns], fixed: args.fixed, case: args.case, whole: args.whole, word: args.word, nullData: args.nullData };
    }
    async batch(rows) {
        try {
            return await this.session.run(this.descriptor, rows);
        }
        catch (error) {
            if (error instanceof RegexExecutionError && error.code === "MATCH")
                throw new SearchError(error.message);
            throw error;
        }
    }
    async matches(bytes, all = true, terminated = true) {
        return (await this.batch([{ bytes, all, terminated }]))[0];
    }
}
//# sourceMappingURL=matcher.js.map