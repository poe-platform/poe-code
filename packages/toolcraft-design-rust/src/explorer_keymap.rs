//! Explorer binding defaults, accelerator validation and help policy.
use crate::feedback::Host;

const BUILTINS: &[(&str, &[&str])] = &[
    ("quit", &["Ctrl+c"]),
    ("filter", &[]),
    ("help", &[]),
    ("palette", &["Ctrl+p"]),
    ("cursorUp", &["up"]),
    ("cursorDown", &["down"]),
    ("top", &["home"]),
    ("bottom", &["end"]),
    ("pageUp", &["pageup"]),
    ("pageDown", &["pagedown"]),
    ("halfPageUp", &["Ctrl+u"]),
    ("halfPageDown", &["Ctrl+d"]),
    ("focusNext", &["tab"]),
    ("escape", &["escape"]),
    ("confirm", &["return", "enter"]),
    ("toggleSelect", &["space"]),
    ("selectAll", &["Ctrl+a"]),
    ("clearSelection", &["Ctrl+/"]),
    ("detailScrollDown", &[]),
    ("detailScrollUp", &[]),
    ("extendSelectionUp", &["Shift+up"]),
    ("extendSelectionDown", &["Shift+down"]),
    ("reorderUp", &["Shift+up"]),
    ("reorderDown", &["Shift+down"]),
];

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let name=$name;let args=vec![$($arg),*];host.call(name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! p { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=c!($name $(,$arg)*);host.is_true(value)?}}; }
    macro_rules! l {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! n {
        ($number:expr) => {
            host.number($number)?
        };
    }
    macro_rules! method { ($value:expr,$key:expr $(,$arg:expr)*) => {{let receiver=$value;c!("invoke",g!(receiver,$key),receiver $(,$arg)*)}}; }
    macro_rules! obj { ($($key:expr => $value:expr),* $(,)?) => {{let object=c!("object");$(c!("set",object,l!($key),$value);)*object}}; }
    macro_rules! opt {
        ($value:expr,$key:expr) => {
            c!("optionalGet", $value, l!($key))
        };
    }
    macro_rules! fallback {
        ($value:expr,$default:expr) => {{
            let value = $value;
            if p!("nullish", value) {
                $default
            } else {
                value
            }
        }};
    }
    macro_rules! call { ($name:expr $(,$arg:expr)*) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    let undefined = c!("undefined");
    match operation {
        "actions" => {
            let config = args[0];
            let actions = c!(
                "concat",
                g!(config, "actions"),
                fallback!(opt!(g!(config, "detail"), "actions"), c!("array"))
            );
            Ok(c!("values", c!("map", c!("actionPairs", actions))))
        }
        "pair" => Ok(c!("pair", g!(args[0], "id"), args[0])),
        "bare" => {
            c!("walk", l!("bareAction"), call!("actions", args[0]));
            let config = args[0];
            if !p!("same", g!(config, "keybindOverrides"), undefined)
                && p!(
                    "gt",
                    g!(c!("keys", g!(config, "keybindOverrides")), "length"),
                    n!(0.)
                )
            {
                c!(
                    "error",
                    l!(
                        "Explorer keybind overrides are not supported because printable keys belong to filtering"
                    )
                );
            }
            Ok(undefined)
        }
        "bareAction" => {
            let action = args[0];
            let legacy = if p!("same", g!(action, "key"), undefined) {
                c!("array")
            } else if p!("arrayIsArray", g!(action, "key")) {
                g!(action, "key")
            } else {
                c!("one", g!(action, "key"))
            };
            if p!("gt", g!(legacy, "length"), n!(0.)) {
                c!("error", c!("bareError", action));
            }
            Ok(undefined)
        }
        "accelerators" => {
            let claimed = c!("map");
            c!(
                "walk",
                l!("accelerator"),
                call!("actions", args[0]),
                claimed
            );
            Ok(undefined)
        }
        "accelerator" => {
            let action = args[0];
            let claimed = args[1];
            if p!("same", g!(action, "accelerator"), undefined) {
                return Ok(undefined);
            }
            let accelerator = c!("lowerAccelerator", action);
            if !p!("same", g!(accelerator, "length"), n!(1.))
                || p!("lt", accelerator, l!("a"))
                || p!("gt", accelerator, l!("z"))
            {
                c!("error", c!("letterError", action));
            }
            for key in ["c", "u", "d", "p"] {
                if p!("same", accelerator, l!(key)) {
                    c!("error", c!("coreError", action, accelerator));
                }
            }
            let owner = method!(claimed, "get", accelerator);
            if !p!("same", owner, undefined) {
                c!("error", c!("sharedError", owner, action, accelerator));
            }
            method!(claimed, "set", accelerator, g!(action, "id"));
            Ok(undefined)
        }
        "resolve" => {
            let config = args[0];
            let defaults = args[1];
            call!("bare", config);
            call!("accelerators", config);
            let bindings = c!("map");
            let keys_by_target = c!("map");
            // Filter all command names before consulting any defaults, as the
            // source's Array.filter does with live configuration getters.
            let mut commands = Vec::new();
            for (command, keys) in BUILTINS {
                if p!("same", g!(config, "multiSelect"), c!("false"))
                    && [
                        "toggleSelect",
                        "selectAll",
                        "clearSelection",
                        "extendSelectionUp",
                        "extendSelectionDown",
                    ]
                    .contains(command)
                {
                    continue;
                }
                if p!("same", g!(config, "reorder"), undefined)
                    && ["reorderUp", "reorderDown"].contains(command)
                {
                    continue;
                }
                if !p!("same", g!(config, "reorder"), undefined)
                    && ["extendSelectionUp", "extendSelectionDown"].contains(command)
                {
                    continue;
                }
                commands.push((*command, *keys));
            }
            for (command, default_keys) in commands {
                let mut keys = if command == "quit" {
                    undefined
                } else {
                    g!(defaults, command)
                };
                if p!("nullish", keys) {
                    keys = c!("array");
                    for key in default_keys {
                        method!(keys, "push", l!(key));
                    }
                }
                call!(
                    "add",
                    keys,
                    obj!("type"=>l!("builtin"),"id"=>l!(command)),
                    bindings,
                    keys_by_target
                );
            }
            c!(
                "walk",
                l!("registerAction"),
                call!("actions", config),
                bindings,
                keys_by_target
            );
            Ok(c!("resolved", bindings, keys_by_target))
        }
        "registerAction" => {
            let action = args[0];
            if !p!("same", g!(action, "accelerator"), undefined) {
                let keys = c!("one", c!("ctrl", g!(action, "accelerator")));
                call!(
                    "add",
                    keys,
                    obj!("type"=>l!("action"),"id"=>g!(action,"id")),
                    args[1],
                    args[2]
                );
            }
            Ok(undefined)
        }
        "add" => {
            let accepted = c!("array");
            c!("walk", l!("addKey"), args[0], args[1], args[2], accepted);
            if p!("gt", g!(accepted, "length"), n!(0.)) {
                method!(args[3], "set", c!("targetKey", args[1]), accepted);
            }
            Ok(undefined)
        }
        "addKey" => {
            let normalized = method!(
                method!(method!(args[0], "trim"), "toLowerCase"),
                "replace",
                l!("control+"),
                l!("ctrl+")
            );
            if !p!("truthy", method!(args[2], "has", normalized)) {
                method!(args[2], "set", normalized, args[1]);
                method!(args[3], "push", args[0]);
            }
            Ok(undefined)
        }
        "event" => {
            let event = args[1];
            let name = fallback!(g!(event, "name"), fallback!(g!(event, "ch"), l!("")));
            let modifiers = c!("array");
            for key in ["ctrl", "meta", "shift"] {
                if p!("truthy", g!(event, key)) {
                    method!(modifiers, "push", l!(key));
                }
            }
            let normalized = if p!("same", name, l!(" ")) {
                l!("space")
            } else {
                method!(name, "toLowerCase")
            };
            method!(modifiers, "push", normalized);
            Ok(method!(args[0], "get", method!(modifiers, "join", l!("+"))))
        }
        "help" => {
            let sections = c!("array");
            let navigation = c!("array");
            for (key, label) in [
                ("↑/↓", "move"),
                ("PgUp/PgDn", "page"),
                ("Home/End", "first/last"),
                ("Tab", "focus"),
            ] {
                method!(navigation, "push", obj!("key"=>l!(key),"label"=>l!(label)));
            }
            method!(
                sections,
                "push",
                obj!("title"=>l!("Navigation"),"entries"=>navigation)
            );
            let actions = c!("array");
            for (key, label) in [("Enter", "actions"), ("Ctrl+P", "palette")] {
                method!(actions, "push", obj!("key"=>l!(key),"label"=>l!(label)));
            }
            let extra = c!("helpActions", call!("actions", args[0]));
            method!(
                sections,
                "push",
                obj!("title"=>l!("Actions"),"entries"=>c!("concat",actions,extra))
            );
            let general = c!("array");
            for (key, label) in [("Esc", "clear/quit"), ("Ctrl+C", "quit")] {
                method!(general, "push", obj!("key"=>l!(key),"label"=>l!(label)));
            }
            method!(
                sections,
                "push",
                obj!("title"=>l!("General"),"entries"=>general)
            );
            Ok(sections)
        }
        "hasAccelerator" => Ok(c!(if p!("same", g!(args[0], "accelerator"), undefined) {
            "false"
        } else {
            "true"
        })),
        "helpAction" => Ok(
            obj!("key"=>c!("helpAccelerator",args[0]),"label"=>if p!("isString",g!(args[0],"label")){g!(args[0],"label")}else{g!(args[0],"id")}),
        ),
        _ => host.call("invalidOperation", vec![]),
    }
}
