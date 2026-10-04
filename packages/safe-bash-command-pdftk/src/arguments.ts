export const PDFTK_OPERATIONS = new Set([
  "cat",
  "shuffle",
  "burst",
  "dump_data",
  "dump_data_utf8",
  "dump_data_annots",
  "dump_data_annots_utf8",
  "dump_data_fields",
  "dump_data_fields_utf8",
  "update_info",
  "update_info_utf8",
  "generate_fdf",
  "attach_files",
  "unpack_files",
  "fill_form",
  "flatten",
  "rotate",
  "background",
  "multibackground",
  "stamp",
  "multistamp",
  "output",
  "input_pw",
]);

export function* parsePdftkArgumentsSteps(argv: readonly string[]) {
    let cooperativeWork = 63;
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
        return { result: {
            exitCode: 0,
            stdout: "Usage: pdftk <input PDF files | [handle]=filename ...> [<operation> <operation arguments>] [output <output filename>] [flatten]\n",
            stderr: "",
        } };
    }
    if (argv.includes("--version") || argv.includes("-v")) {
        return { result: { exitCode: 0, stdout: "pdftk port to Java 3.3.3 (safe-bash @poe-code/pdf-ast)\n", stderr: "" } };
    }
    const inputPasswords = new Map<string, string>();
    let defaultInputPassword = "";
    for (let p = 0; p < argv.length; p++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        if (argv[p]?.toLowerCase() === "input_pw") {
            for (let q = p + 1; q < argv.length; q++) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const tok = argv[q]!;
                if (PDFTK_OPERATIONS.has(tok.toLowerCase()))
                    break;
                const eq = tok.indexOf("=");
                if (eq > 0)
                    inputPasswords.set(tok.slice(0, eq), tok.slice(eq + 1));
                else
                    defaultInputPassword = tok;
            }
        }
    }
    const inputs: { handle: string; file: string; password: string }[] = [];
    let idx = 0;
    let autoHandleCharCode = 65;
    while (idx < argv.length) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const token = argv[idx]!;
        if (PDFTK_OPERATIONS.has(token.toLowerCase()) || token.toLowerCase() === "input_pw")
            break;
        idx++;
        let handleName = "";
        let filePath = token;
        const eqIdx = token.indexOf("=");
        if (eqIdx > 0) {
            handleName = token.slice(0, eqIdx);
            filePath = token.slice(eqIdx + 1);
        }
        else {
            handleName = String.fromCharCode(autoHandleCharCode++);
        }
        inputs.push({ handle: handleName, file: filePath, password: inputPasswords.get(handleName) ?? defaultInputPassword });
    }
    if (inputs.length === 0) {
        return { result: { exitCode: 1, stdout: "", stderr: "Error: No input PDF files specified.\n" } };
    }
    while (idx < argv.length && argv[idx]?.toLowerCase() === "input_pw") {
        if (++cooperativeWork % 64 === 0)
            yield;
        idx++;
        while (idx < argv.length && !PDFTK_OPERATIONS.has(argv[idx]!.toLowerCase())) {
            if (++cooperativeWork % 64 === 0)
                yield;
            idx++;
        }
    }
    const operation = (argv[idx] ?? "cat").toLowerCase();
    idx++;
    const opArgs: string[] = [];
    let outputTarget: string | undefined;
    if (operation === "output") {
        outputTarget = argv[idx++];
    }
    let shouldFlatten = false;
    let needAppearances = false;
    let dropXfa = false;
    let dropXmp = false;
    let replacementFont: string | undefined;
    let keepFirstId = false;
    let keepFinalId = false;
    let uncompressStreams = false;
    let compressStreams = false;
    let userPassword: string | undefined;
    let ownerPassword: string | undefined;
    const allowPermissions = new Set<string>();
    const ALLOW_KEYWORDS = new Set([
        "printing",
        "degradedprinting",
        "modifycontents",
        "assembly",
        "copycontents",
        "screenreaders",
        "modifyannotations",
        "fillin",
        "allfeatures"
    ]);
    while (idx < argv.length) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const tok = argv[idx++]!;
        const lower = tok.toLowerCase();
        if (lower === "output") {
            outputTarget = argv[idx++];
        }
        else if (lower === "flatten") {
            shouldFlatten = true;
        }
        else if (lower === "need_appearances") {
            needAppearances = true;
        }
        else if (lower === "user_pw") {
            userPassword = argv[idx++];
        }
        else if (lower === "owner_pw") {
            ownerPassword = argv[idx++];
        }
        else if (lower === "allow") {
            while (idx < argv.length && ALLOW_KEYWORDS.has(argv[idx]!.toLowerCase())) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                allowPermissions.add(argv[idx++]!.toLowerCase());
            }
        }
        else if (lower === "keep_first_id") {
            keepFirstId = true;
        }
        else if (lower === "keep_final_id") {
            keepFinalId = true;
        }
        else if (lower === "uncompress") {
            uncompressStreams = true;
        }
        else if (lower === "compress") {
            compressStreams = true;
        }
        else if (lower === "dont_ask" ||
            lower === "do_ask" ||
            lower === "encrypt_128bit" ||
            lower === "encrypt_40bit" ||
            lower === "verbose") {
            // Standard PDFtk flags
        }
        else if (lower === "drop_xfa") {
            dropXfa = true;
        }
        else if (lower === "drop_xmp") {
            dropXmp = true;
        }
        else if (lower === "replacement_font") {
            replacementFont = argv[idx++];
        }
        else {
            opArgs.push(tok);
        }
    }
    return { options: { inputs, operation, opArgs, outputTarget, shouldFlatten, needAppearances, dropXfa, dropXmp, replacementFont, keepFirstId, keepFinalId, uncompressStreams, compressStreams, userPassword, ownerPassword, allowPermissions } };
}

export type PdftkArguments = (ReturnType<typeof parsePdftkArgumentsSteps> extends Generator<unknown, infer Result, unknown> ? Result : never) extends infer Result ? Result extends { options: infer Options } ? Options : never : never;
