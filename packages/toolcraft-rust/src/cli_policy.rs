//! CLI naming, control admission and global option policies. Observable
//! ECMAScript operations remain caller-realm capabilities, including casing.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("logLevels", []) => {
            let mut levels = Vec::with_capacity(crate::LOG_LEVELS.len());
            for level in crate::LOG_LEVELS {
                levels.push(host.literal(level)?);
            }
            host.call("list", levels)
        }
        ("name" | "mcpName", [value, casing]) => {
            let separator = host.literal(if host.is_kind(*casing, "snake")? {
                "_"
            } else {
                "-"
            })?;
            let words = c!("list");
            let mut current = host.literal("")?;
            let mut index = c!("zero");
            loop {
                let more = c!("moreCharacters", *value, index);
                if !host.is_true(more)? {
                    break;
                }
                let char = c!("character", *value, index);
                let lower = c!("charLower", char);
                let upper = c!("charUpper", char);
                let separator_char = host.is_kind(char, "-")?
                    || host.is_kind(char, "_")?
                    || host.is_kind(char, " ")?
                    || host.is_kind(char, ".")?;
                if separator_char {
                    let nonempty = c!("currentNonempty", current);
                    if host.is_true(nonempty)? {
                        let word = c!("currentLower", current);
                        c!("pushWord", words, word);
                        current = host.literal("")?;
                    }
                } else {
                    let is_upper = !host.same(char, lower)? && host.same(char, upper)?;
                    let previous = c!("previous", *value, index);
                    let next = c!("next", *value, index);
                    let previous_lower = if host.is_undefined(previous)? {
                        false
                    } else {
                        let lower = c!("previousLower", previous);
                        if host.same(previous, lower)? {
                            let upper = c!("previousUpper", previous);
                            !host.same(previous, upper)?
                        } else {
                            false
                        }
                    };
                    let next_lower = if host.is_undefined(next)? {
                        false
                    } else {
                        let lower = c!("nextLower", next);
                        if host.same(next, lower)? {
                            let upper = c!("nextUpper", next);
                            !host.same(next, upper)?
                        } else {
                            false
                        }
                    };
                    let split = if is_upper {
                        let nonempty = c!("currentNonempty", current);
                        host.is_true(nonempty)? && (previous_lower || next_lower)
                    } else {
                        false
                    };
                    if split {
                        let word = c!("currentLower", current);
                        c!("pushWord", words, word);
                        current = char;
                    } else {
                        current = c!("append", current, char);
                    }
                }
                index = c!("increment", index);
            }
            let nonempty = c!("currentNonempty", current);
            if host.is_true(nonempty)? {
                let word = c!("currentLower", current);
                c!("pushWord", words, word);
            }
            if operation == "mcpName" && !host.is_kind(*casing, "snake")? {
                host.call("camelWords", vec![words])
            } else {
                host.call("joinWords", vec![words, separator])
            }
        }
        ("controls", [controls]) => {
            let output = c!("optionalOutput", *controls);
            let object = c!("isObject", output);
            let formats = if host.is_true(object)? {
                c!("controlFormats", *controls)
            } else {
                c!("object")
            };
            c!("validateFormats", formats);
            let debug = c!("optionalDebug", *controls);
            let debug = c!("boolean", debug);
            let help = c!("optionalHelp", *controls);
            let help = host.literal(if host.is_kind(help, "concise")? {
                "concise"
            } else {
                "extended"
            })?;
            let log_level = c!("optionalLogLevel", *controls);
            let log_level = c!("boolean", log_level);
            let output = c!("optionalOutput", *controls);
            let output = if host.is_true(output)? {
                c!("true")
            } else {
                let output = c!("optionalOutput", *controls);
                c!("isObject", output)
            };
            let verbose = c!("optionalVerbose", *controls);
            let verbose = c!("boolean", verbose);
            let yes = c!("optionalYes", *controls);
            let yes = c!("boolean", yes);
            host.call(
                "controls",
                vec![debug, help, log_level, output, formats, verbose, yes],
            )
        }
        ("validateFormat", [name, renderer]) => {
            let whitespace = c!("hasWhitespace", *name);
            let empty = c!("emptyName", *name);
            let invalid = if host.is_true(empty)? {
                true
            } else {
                let trimmed = c!("trimName", *name);
                if !host.same(trimmed, *name)? {
                    true
                } else {
                    let truthy = c!("truthy", whitespace);
                    host.is_true(truthy)?
                }
            };
            if invalid {
                return host.call("invalidFormatName", vec![*name]);
            }
            let builtin = c!("builtInIncludes", *name);
            let builtin = c!("truthy", builtin);
            if host.is_true(builtin)? {
                return host.call("builtInFormat", vec![*name]);
            }
            let function = c!("isFunction", *renderer);
            if !host.is_true(function)? {
                return host.call("invalidRenderer", vec![*name]);
            }
            host.call("undefined", vec![])
        }
        ("whitespace", [character]) => host.call("characterWhitespace", vec![*character]),
        ("flags", [presets, version, controls]) => {
            let flags = c!("list");
            let enabled = c!("truthy", *presets);
            if host.is_true(enabled)? {
                let flag = host.literal("--preset")?;
                c!("pushFlag", flags, flag);
            }
            for (key, flag) in [
                ("yes", "--yes"),
                ("output", "--output"),
                ("debug", "--debug"),
                ("logLevel", "--log-level"),
                ("verbose", "--verbose"),
            ] {
                let value = host.get(*controls, key)?;
                let enabled = c!("truthy", value);
                if host.is_true(enabled)? {
                    let flag = host.literal(flag)?;
                    c!("pushFlag", flags, flag);
                }
            }
            let enabled = c!("truthy", *version);
            if host.is_true(enabled)? {
                let flag = host.literal("--version")?;
                c!("pushFlag", flags, flag);
            }
            host.call("set", vec![flags])
        }
        ("snapshotOptions", [presets, version, controls]) => {
            let help = snapshot_option(
                host,
                "help",
                "boolean",
                "Display help for command.",
                false,
                None,
            )?;
            let options = c!("list", help);
            let enabled = c!("truthy", *presets);
            if host.is_true(enabled)? {
                let option = snapshot_option(
                    host,
                    "preset",
                    "string",
                    "Load parameter defaults from a JSON file.",
                    true,
                    None,
                )?;
                c!("pushOption", options, option);
            }
            for (key, kind, description) in [
                ("yes", "boolean", "Accept defaults and skip prompts."),
                ("output", "enum", "Output format."),
                ("debug", "enum", "Print stack traces for unexpected errors."),
                ("logLevel", "enum", "Set runtime diagnostic log level."),
                ("verbose", "boolean", "Print detailed runtime diagnostics."),
            ] {
                let enabled = host.get(*controls, key)?;
                let enabled = c!("truthy", enabled);
                if host.is_true(enabled)? {
                    let choices = match key {
                        "output" => Some(c!("outputFormatNames", *controls)),
                        "debug" => {
                            let trim = host.literal("trim")?;
                            let raw = host.literal("raw")?;
                            Some(c!("list", trim, raw))
                        }
                        "logLevel" => Some(c!("logLevels")),
                        _ => None,
                    };
                    let option = snapshot_option(host, key, kind, description, true, choices)?;
                    c!("pushOption", options, option);
                }
            }
            let enabled = c!("truthy", *version);
            if host.is_true(enabled)? {
                let option = snapshot_option(
                    host,
                    "version",
                    "boolean",
                    "Output the version number.",
                    false,
                    None,
                )?;
                c!("pushOption", options, option);
            }
            Ok(options)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn snapshot_option<H: TextHost>(
    host: &mut H,
    name: &'static str,
    kind: &'static str,
    description: &'static str,
    hidden: bool,
    choices: Option<H::Value>,
) -> Result<H::Value, H::Error> {
    let mut flags = Vec::new();
    for flag in match name {
        "help" => &["-h", "--help"][..],
        "preset" => &["--preset"],
        "yes" => &["--yes"],
        "output" => &["--output"],
        "debug" => &["--debug"],
        "logLevel" => &["--log-level"],
        "verbose" => &["-v", "--verbose"],
        "version" => &["--version"],
        _ => unreachable!(),
    } {
        flags.push(host.literal(flag)?);
    }
    let flags = host.call("list", flags)?;
    let name = host.literal(name)?;
    let kind = host.literal(kind)?;
    let description = host.literal(description)?;
    let hidden = host.call(if hidden { "true" } else { "false" }, vec![])?;
    let mut args = vec![name, flags, kind, hidden, description];
    if let Some(choices) = choices {
        args.push(choices);
    }
    host.call(
        if choices.is_some() {
            "optionChoices"
        } else {
            "option"
        },
        args,
    )
}
