import { Budget, ToolError } from "./shared.js";
async function normalizeTransport(text, budget) {
    const lines = [];
    let position = 0;
    while (position < text.length) {
        const end = text.indexOf("\n", position);
        budget.step(1 + end - position);
        await budget.checkpoint();
        if (end <= position || text[end - 1] !== "\r")
            return text;
        lines.push(text.slice(position, end - 1), "\n");
        if (lines.length / 2 > budget.limits.maxLines)
            throw new ToolError("transport line limit exceeded");
        position = end + 1;
    }
    return lines.join("");
}
export async function unwrapPatch(text, budget) {
    if (text && !text.endsWith("\n"))
        throw new ToolError("patch is truncated: missing final LF");
    text = await normalizeTransport(text, budget);
    let position = 0;
    let lines = 0;
    const mail = /^(?:From [0-9a-f]{40,64} |(?:From|Date|Subject|To|Cc|MIME-Version|Content-Type):)/u.test(text);
    if (mail) {
        while (position < text.length) {
            budget.step();
            await budget.checkpoint();
            const end = text.indexOf("\n", position);
            const line = text.slice(position, end);
            if (/^(?:--- |\*\*\* |diff |\d+(?:,\d+)?[acd]\d)/u.test(line))
                break;
            if (/^(?:old mode |new mode |new file mode |deleted file mode |rename |copy |similarity index |dissimilarity index |GIT binary patch|Binary files |index |@@|[+\\])/u.test(line))
                throw new ToolError("unsupported or malformed mail patch metadata");
            position = end + 1;
            if (++lines > 1024 || position > 65_536)
                throw new ToolError("mail preamble limit exceeded");
        }
        if (position === text.length)
            throw new ToolError("mail preamble without patch");
    }
    const body = text.slice(position);
    const signature = body.indexOf("\n-- \n");
    if (signature < 0)
        return body;
    const trailer = body.slice(signature + 5);
    if (trailer.length > 8192 || trailer.split("\n").length > 128)
        throw new ToolError("mail signature limit exceeded");
    for (const line of trailer.split("\n")) {
        budget.step();
        if (/^(?:diff |---|\+\+\+|\*\*\*|@@|index |old mode |new mode |new file mode |deleted file mode |rename |copy |similarity index |dissimilarity index |GIT binary patch|Binary files |[+\\]|\d+(?:,\d+)?[acd]\d)/u.test(line))
            throw new ToolError("patch data after mail signature");
    }
    return body.slice(0, signature + 1);
}
//# sourceMappingURL=patch-envelope.js.map