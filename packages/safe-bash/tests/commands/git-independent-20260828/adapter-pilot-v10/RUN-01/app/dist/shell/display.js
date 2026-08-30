const spelling = (word) => word.spelling ?? word.plain ?? "''";
function scriptText(script, indent) {
    return script.lists.map(list => list.pipelines.map((pipeline, index) => `${index ? `${list.operators[index - 1]} ` : ""}${pipeline.negate ? "! " : ""}${pipeline.commands.map(command => commandText(command, indent)).join(" | ")}`).join(" ")).join(`;\n${indent}`);
}
function commandText(command, indent) {
    const nested = `${indent}    `;
    let text;
    switch (command.kind) {
        case "simple":
            text = command.words.map(spelling).join(" ");
            break;
        case "arithmetic":
            text = `(( ${command.source} ))`;
            break;
        case "group":
            text = `{ \n${nested}${scriptText(command.body, nested)}\n${indent}}`;
            break;
        case "subshell":
            text = `( ${scriptText(command.body, indent)} )`;
            break;
        case "function":
            text = `${command.name} () \n${indent}${commandText(command.body, indent)}`;
            break;
        case "if":
            text = command.branches.map((branch, index) => `${index ? "elif" : "if"} ${scriptText(branch.condition, indent)}; then\n${nested}${scriptText(branch.body, nested)};`).join(`\n${indent}`);
            if (command.otherwise)
                text += `\n${indent}else\n${nested}${scriptText(command.otherwise, nested)};`;
            text += `\n${indent}fi`;
            break;
        case "while":
        case "until":
            text = `${command.kind} ${scriptText(command.condition, indent)}; do\n${nested}${scriptText(command.body, nested)};\n${indent}done`;
            break;
        case "for":
            text = `for ${command.name}${command.words ? ` in ${command.words.map(spelling).join(" ")}` : ""};\ndo\n${nested}${scriptText(command.body, nested)};\n${indent}done`;
            break;
        case "case":
            text = `case ${spelling(command.subject)} in\n${command.clauses.map(clause => `${nested}${clause.patterns.map(spelling).join(" | ")})\n${nested}    ${scriptText(clause.body, `${nested}    `)}\n${nested}${clause.terminator === "esac" ? "" : clause.terminator}`).join("\n")}\n${indent}esac`;
            break;
    }
    for (const redirect of command.redirects) {
        const defaultDescriptor = redirect.operator.startsWith("<") ? 0 : 1;
        text += ` ${redirect.descriptor === defaultDescriptor ? "" : redirect.descriptor}${redirect.operator} ${spelling(redirect.target)}${redirect.move ? "-" : ""}`;
        if (redirect.document)
            text += `\n${redirect.document.body}${redirect.document.delimiter}\n`;
    }
    return text;
}
export function functionDisplay(name, body) {
    return `${name} () \n${commandText(body, "")}\n`;
}
//# sourceMappingURL=display.js.map