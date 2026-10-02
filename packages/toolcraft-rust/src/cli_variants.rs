//! Variant selection, active-branch defaults and async required-field policy.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    match (operation, args) {
        ("initialize", _) => host.call("initialize", args.to_vec()),
        ("variant", [state, variant]) => {
            c!("variant", *state, *variant);
            let parent = host.get(*variant, "parent")?;
            if !host.is_undefined(parent)? && !yes!(c!("parentActive", *state)) {
                return host.call("step:skip", vec![]);
            }
            let selected = c!("selected", *state);
            if host.is_undefined(selected)? {
                let should_prompt = host.get(*state, "shouldPrompt")?;
                if yes!(should_prompt) {
                    let control = c!("control", *state);
                    if !host.is_undefined(control)? {
                        c!("keepControl", *state, control);
                        let value = c!("prompt", *state, control);
                        return host.call("step:control", vec![value]);
                    }
                }
            }
            run(host, "selected", &[*state, selected])
        }
        ("controlResult", [state, selected]) => {
            let field = host.get(*state, "controlField")?;
            c!("resolved", *state, field, *selected);
            c!("provided", *state, field);
            let synthetic = host.get(field, "synthetic")?;
            if !yes!(synthetic) {
                c!("nested", *state, field, *selected);
            }
            run(host, "selected", &[*state, *selected])
        }
        ("selected", [state, selected]) => {
            let variant = host.get(*state, "variant")?;
            if host.is_undefined(*selected)? {
                let optional = host.get(variant, "optional")?;
                if !yes!(optional) {
                    c!("missingSelector", *state);
                }
                return host.call("step:skip", vec![]);
            }
            let branch = c!("findBranch", variant, *selected);
            if host.is_undefined(branch)? {
                c!("invalidSelector", *state, *selected);
                return host.call("step:skip", vec![]);
            }
            c!("keepBranch", *state, branch);
            if yes!(c!("invalidBranches", *state)) {
                return host.call("step:skip", vec![]);
            }
            c!("active", *state);
            c!("defaults", *state);
            host.call("step:active", vec![])
        }
        ("invalidBranch", [state, branch]) => {
            let id = host.get(*branch, "branchId")?;
            let selected = host.get(*state, "selectedBranch")?;
            let selected_id = host.get(selected, "branchId")?;
            if host.same(id, selected_id)? {
                return host.call("false", vec![]);
            }
            let mut invalid = false;
            let id = c!("invalidField", *state, *branch);
            if !host.is_undefined(id)? {
                let field = c!("field", *state, id);
                if !host.is_undefined(field)? {
                    c!("unknown", *state, field);
                    invalid = true;
                }
            }
            let id = c!("invalidDynamic", *state, *branch);
            if !host.is_undefined(id)? {
                let field = c!("dynamic", *state, id);
                if !host.is_undefined(field)? {
                    c!("unknown", *state, field);
                    invalid = true;
                }
            }
            host.call(if invalid { "true" } else { "false" }, vec![])
        }
        ("available", [state, branch]) => host.call("available", vec![*state, *branch]),
        ("default", [state, field, dynamic]) => {
            let variant = host.get(*state, "variant")?;
            if !yes!(c!("matches", *field, variant)) {
                return host.call("undefined", vec![]);
            }
            let has_default = host.get(*field, "hasDefault")?;
            if !yes!(has_default) {
                return host.call("undefined", vec![]);
            }
            let existing = c!("existing", *state, *field);
            if !host.is_undefined(existing)? {
                return host.call("undefined", vec![]);
            }
            if host.is_true(*dynamic)? {
                c!("dynamicDefault", *state, *field);
            } else {
                let value = c!("clone", *field);
                c!("resolved", *state, *field, value);
                c!("nested", *state, *field, value);
            }
            host.call("undefined", vec![])
        }
        ("required", [state, id]) => {
            let field = c!("field", *state, *id);
            let variant = host.get(*state, "variant")?;
            if !yes!(c!("matches", field, variant)) {
                return host.call("step:skip", vec![]);
            }
            let synthetic = host.get(field, "synthetic")?;
            if yes!(synthetic) {
                return host.call("step:skip", vec![]);
            }
            let existing = c!("existing", *state, field);
            if !host.is_undefined(existing)? {
                return host.call("step:skip", vec![]);
            }
            let should_prompt = host.get(*state, "shouldPrompt")?;
            if yes!(should_prompt) {
                c!("keepRequired", *state, field);
                let value = c!("prompt", *state, field);
                host.call("step:prompt", vec![value])
            } else {
                c!("requiredError", *state, field);
                host.call("step:skip", vec![])
            }
        }
        ("requiredResult", [state, value]) => {
            let field = host.get(*state, "requiredField")?;
            c!("resolved", *state, field, *value);
            c!("nested", *state, field, *value);
            c!("provided", *state, field);
            host.call("undefined", vec![])
        }
        ("requiredDynamic", [state]) => host.call("requiredDynamic", vec![*state]),
        ("requiredDynamicField", [state, field]) => {
            let variant = host.get(*state, "variant")?;
            if yes!(c!("matches", *field, variant)) {
                let existing = c!("existing", *state, *field);
                if host.is_undefined(existing)? {
                    c!("requiredError", *state, *field);
                }
            }
            host.call("undefined", vec![])
        }
        ("getNested", [target, path]) => host.call("reduce", vec![*target, *path]),
        ("nestedPart", [current, segment]) => {
            if !yes!(c!("isNull", *current))
                && yes!(c!("isObject", *current))
                && yes!(c!("own", *current, *segment))
            {
                host.call("property", vec![*current, *segment])
            } else {
                host.call("undefined", vec![])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
