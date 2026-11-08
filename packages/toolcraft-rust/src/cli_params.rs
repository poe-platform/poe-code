//! Full CLI parameter precedence and validation with explicit await continuations.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    macro_rules! undefined {
        ($value:expr) => {{
            let value = $value;
            host.is_undefined(value)?
        }};
    }
    macro_rules! kind {
        ($value:expr,$kind:expr) => {{
            let value = $value;
            host.is_kind(value, $kind)?
        }};
    }
    match (operation, args) {
        ("initialize", _) => {
            let state = host.call("initialize", args.to_vec())?;
            c!("explicitLoops", state);
            c!("defaults", state);
            let fields = c!("positionalFields", state);
            if !yes!(c!("variadic", fields)) && yes!(c!("tooMany", state, fields)) {
                return host.call("extraArguments", vec![state, fields]);
            }
            Ok(state)
        }
        ("fieldRoot", [field]) => {
            if yes!(g!(*field, "synthetic")) && yes!(c!("singlePath", *field)) {
                host.call("syntheticRoot", vec![*field])
            } else {
                host.call("root", vec![*field])
            }
        }
        ("explicitField", [state, field]) => {
            if !undefined!(c!("explicitOption", *state, *field))
                || (!undefined!(g!(*field, "positionalIndex"))
                    && !undefined!(c!("explicitPosition", *state, *field)))
            {
                c!("addRoot", *state, *field);
            }
            host.call("undefined", vec![])
        }
        ("explicitDynamic", [state, field]) => {
            if yes!(c!("hasDynamic", *state, *field)) {
                c!("addDynamicRoot", *state, *field);
            }
            host.call("undefined", vec![])
        }
        ("presets", [state, path]) => {
            if yes!(c!("isString", *path)) && yes!(c!("nonempty", *path)) {
                let pending = c!("presets", *state, *path);
                host.call("step:await", vec![pending])
            } else {
                let values = c!("emptyPresets");
                host.call("step:done", vec![values])
            }
        }
        ("tracking", [state]) => host.call("tracking", vec![*state]),
        ("field", [state, field]) => {
            if yes!(c!("defaultRoot", *state, *field)) {
                return host.call("step:done", vec![]);
            }
            c!("reset", *state);
            if !undefined!(g!(*field, "positionalIndex")) {
                let variadic = g!(*field, "variadicPosition");
                let value = host.call(
                    if host.is_true(variadic)? {
                        "positions"
                    } else {
                        "position"
                    },
                    vec![*state, *field],
                )?;
                if kind!(g!(g!(*field, "schema"), "kind"), "array") {
                    if yes!(c!("isArray", value)) && yes!(c!("nonempty", value)) {
                        let item = c!("unwrap", g!(g!(*field, "schema"), "item"));
                        if kind!(g!(item, "kind"), "array") || kind!(g!(item, "kind"), "object") {
                            return host.call("nonscalar", vec![*field]);
                        }
                        let parsed = c!("positionalItems", value, item, *field);
                        c!("value", *state, parsed);
                        c!("source", *state, host.literal("positional")?);
                    }
                } else if yes!(c!("isString", value)) {
                    let parsed = c!("positionalValue", value, *field);
                    c!("value", *state, parsed);
                    c!("source", *state, host.literal("positional")?);
                }
            }
            if undefined!(g!(*state, "value")) {
                let key = host.literal("commanderOptionAttribute")?;
                run(host, "option", &[*state, *field, key])?;
            }
            if undefined!(g!(*state, "value")) {
                let commander = g!(*field, "commanderOptionAttribute");
                let attribute = g!(*field, "optionAttribute");
                if host.same(commander, attribute)? {
                    let key = host.literal("optionAttribute")?;
                    run(host, "option", &[*state, *field, key])?;
                }
            }
            if undefined!(g!(*state, "value")) && kind!(g!(*field, "optionFlag"), "--verbose") {
                let key = host.literal("optionAttribute")?;
                run(host, "option", &[*state, *field, key])?;
            }
            if undefined!(g!(*state, "value")) && yes!(c!("ownPreset", *state, *field)) {
                let value = c!("preset", *state, *field);
                c!("value", *state, value);
                c!("source", *state, host.literal("preset")?);
            }
            if kind!(g!(*state, "source"), "option") {
                let parsed = c!("parseOption", *state, *field);
                if !yes!(g!(parsed, "ok")) {
                    return host.call("step:done", vec![]);
                }
                c!("value", *state, g!(parsed, "value"));
            }
            if undefined!(g!(*state, "value"))
                && yes!(g!(*field, "optional"))
                && !undefined!(g!(*state, "missingParameterContext"))
            {
                let cli = g!(g!(*field, "schema"), "cli");
                if !host.is_nullish(cli)? && !undefined!(g!(cli, "resolveMissing")) {
                    let pending = c!("resolveMissing", *state, *field);
                    return host.call("step:missingResult", vec![pending]);
                }
            }
            run(host, "afterMissing", args)
        }
        ("option", [state, field, key]) => {
            if yes!(c!("ownOption", *state, *field, *key))
                && !undefined!(c!("option", *state, *field, *key))
            {
                let value = c!("normalize", c!("option", *state, *field, *key));
                c!("value", *state, value);
                c!("source", *state, host.literal("option")?);
            }
            host.call("undefined", vec![])
        }
        ("missingResult", [state, field, resolution]) => {
            let choices = c!("choices", *resolution);
            if yes!(c!("single", choices)) {
                c!("value", *state, c!("choice", choices));
                c!("source", *state, host.literal("prompt")?);
                run(host, "validateMissing", &[*state, *field])
            } else if yes!(c!("many", choices)) {
                let pending = c!("select", *state, *field, *resolution, choices);
                host.call("step:selectedResult", vec![pending])
            } else {
                run(host, "afterMissing", &[*state, *field])
            }
        }
        ("choiceLabel", [resolution, field]) => {
            let message = c!("resolutionMessage", *resolution);
            if !host.is_nullish(message)? {
                return Ok(message);
            }
            let description = g!(*field, "description");
            if host.is_nullish(description)? {
                host.call("label", vec![*field])
            } else {
                Ok(description)
            }
        }
        ("selectedResult", [state, field, value]) => {
            if yes!(c!("isCancel", *value)) {
                return host.call("cancel", vec![]);
            }
            c!("value", *state, *value);
            c!("source", *state, host.literal("prompt")?);
            run(host, "validateMissing", &[*state, *field])
        }
        ("validateMissing", [state, field]) => {
            let validation = c!("validate", *state, *field);
            if !yes!(g!(validation, "ok")) {
                c!("missingIssues", *state, *field, validation);
                return host.call("step:done", vec![]);
            }
            c!("value", *state, g!(validation, "value"));
            run(host, "afterMissing", args)
        }
        ("afterMissing", [state, field]) => {
            if undefined!(g!(*state, "value"))
                && yes!(g!(*state, "shouldPrompt"))
                && !yes!(g!(*field, "optional"))
            {
                let pending = c!("prompt", *state, *field);
                return host.call("step:promptedResult", vec![pending]);
            }
            run(host, "finalizeField", args)
        }
        ("promptedResult", [state, field, value]) => {
            c!("value", *state, *value);
            c!("source", *state, host.literal("prompt")?);
            run(host, "finalizeField", &[*state, *field])
        }
        ("finalizeField", [state, field]) => {
            if undefined!(g!(*state, "value"))
                && yes!(g!(*field, "hasDefault"))
                && undefined!(g!(*field, "variantId"))
            {
                c!("value", *state, c!("clone", *field));
                c!("source", *state, host.literal("default")?);
            }
            if undefined!(g!(*state, "value")) {
                if !yes!(g!(*field, "optional")) {
                    c!("missing", *state, *field);
                }
                return host.call("step:done", vec![]);
            }
            if kind!(g!(g!(*field, "schema"), "kind"), "json") {
                let validation = c!("validate", *state, *field);
                if !yes!(g!(validation, "ok")) {
                    c!("jsonIssues", *state, *field, validation);
                    return host.call("step:done", vec![]);
                }
                c!("value", *state, g!(validation, "value"));
            }
            c!("resolved", *state, *field);
            let source = g!(*state, "source");
            if !host.is_undefined(source)? && !host.is_kind(source, "default")? {
                c!("provided", *state, *field);
            }
            if !yes!(g!(*field, "synthetic")) {
                c!("nested", *state, *field, g!(*state, "value"));
            }
            host.call("step:done", vec![])
        }
        ("dynamic", [state, field]) => {
            if yes!(c!("dynamicDefaultRoot", *state, *field)) {
                return host.call("undefined", vec![]);
            }
            let mut value = c!("dynamicValue", *state, *field);
            if yes!(c!("hasPresetDynamic", *state, *field)) {
                if host.is_undefined(value)? {
                    value = c!("presetDynamic", *state, *field);
                }
                c!("providedDynamic", *state, *field);
            }
            if host.is_undefined(value)?
                && yes!(g!(*field, "hasDefault"))
                && undefined!(g!(*field, "variantId"))
            {
                value = c!("clone", *field);
            }
            if host.is_undefined(value)? {
                if !yes!(g!(*field, "optional")) && undefined!(g!(*field, "variantId")) {
                    c!("missingDynamic", *state, *field);
                }
                return host.call("undefined", vec![]);
            }
            host.call("nested", vec![*state, *field, value])
        }
        ("variants", [state, variants]) => host.call("variants", vec![*state, *variants]),
        ("validationErrors", _) => crate::sdk::run(host, "validationErrors", args),
        ("finish", [state]) => {
            let errors = g!(*state, "errors");
            crate::sdk::run(host, "validationErrors", &[errors])?;
            host.get(*state, "params")
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
