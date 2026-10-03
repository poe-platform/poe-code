//! Hosted OAuth login markup, escaping and form field policies.
//! Assembly preserves UTF-16; observable host coercions occur at each interpolation.
use crate::host::TextHost;
use crate::sdk_validation::yes;

pub trait LoginHost: TextHost {
    fn template_units(&mut self, value: Self::Value) -> Result<Vec<u16>, Self::Error>;
    fn string_from_units(&mut self, value: Vec<u16>) -> Result<Self::Value, Self::Error>;
}

fn append<H: LoginHost>(
    host: &mut H,
    output: &mut Vec<u16>,
    value: H::Value,
) -> Result<(), H::Error> {
    output.extend(host.template_units(value)?);
    Ok(())
}

pub fn run<H: LoginHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{ let args=vec![$($arg),*]; host.call($name,args)? }}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! eq {
        ($value:expr,$text:expr) => {{
            let value = $value;
            let text = host.literal($text)?;
            host.same(value, text)?
        }};
    }
    macro_rules! escape {
        ($value:expr) => {{
            let value = $value;
            run(host, "escape", &[value])?
        }};
    }
    macro_rules! add {
        ($output:expr,$value:expr) => {{
            let value = $value;
            append(host, $output, value)?;
        }};
    }
    match (operation, args) {
        ("escape", [value]) => {
            let mut value = *value;
            for (search, replacement) in [
                ("&", "&amp;"),
                ("<", "&lt;"),
                (">", "&gt;"),
                ("\"", "&quot;"),
                ("'", "&#39;"),
            ] {
                let search = host.literal(search)?;
                let replacement = host.literal(replacement)?;
                value = c!("replace", value, search, replacement);
            }
            Ok(value)
        }
        ("control", [field, values]) => {
            let name = escape!(g!(*field, "name"));
            let kind = g!(*field, "type");
            let kind = if host.is_nullish(kind)? {
                host.literal("text")?
            } else {
                kind
            };
            let autocomplete = if eq!(kind, "email") {
                "username"
            } else if eq!(g!(*field, "name"), "password") {
                "current-password"
            } else {
                "off"
            };
            let value = if eq!(kind, "email") {
                let name = g!(*field, "name");
                let value = c!("value", *values, name);
                if host.is_nullish(value)? {
                    host.literal("")?
                } else {
                    value
                }
            } else {
                host.literal("")?
            };
            let mut output = CONTROL_PARTS[0].encode_utf16().collect::<Vec<_>>();
            let label = g!(*field, "label");
            let label = if host.is_nullish(label)? {
                g!(*field, "name")
            } else {
                label
            };
            add!(&mut output, escape!(label));
            output.extend(CONTROL_PARTS[1].encode_utf16());
            add!(&mut output, name);
            output.extend(CONTROL_PARTS[2].encode_utf16());
            add!(&mut output, kind);
            output.extend(CONTROL_PARTS[3].encode_utf16());
            output.extend(autocomplete.encode_utf16());
            output.extend(CONTROL_PARTS[4].encode_utf16());
            if !yes(host, "empty", vec![value])? {
                output.extend(" value=\"".encode_utf16());
                add!(&mut output, escape!(value));
                output.push(b'"' as u16);
            }
            output.extend(CONTROL_PARTS[5].encode_utf16());
            host.string_from_units(output)
        }
        ("render", [provider, fields, transaction, csrf, error, values]) => {
            let nonce = c!("nonce");
            let controls = c!("controls", *fields, *values);
            let mut idle = "Connect ".encode_utf16().collect::<Vec<_>>();
            add!(&mut idle, *provider);
            let idle = host.string_from_units(idle)?;
            let mut html = LOGIN_PARTS[0].encode_utf16().collect::<Vec<_>>();
            add!(&mut html, escape!(*provider));
            html.extend(LOGIN_PARTS[1].encode_utf16());
            add!(&mut html, escape!(*provider));
            html.extend(LOGIN_PARTS[2].encode_utf16());
            if !host.is_undefined(*error)? {
                html.extend("<p class=\"error\" role=\"alert\">".encode_utf16());
                add!(&mut html, escape!(*error));
                html.extend("</p>".encode_utf16());
            }
            html.extend(LOGIN_PARTS[3].encode_utf16());
            add!(&mut html, escape!(g!(*transaction, "id")));
            html.extend(LOGIN_PARTS[4].encode_utf16());
            add!(&mut html, escape!(*csrf));
            html.extend(LOGIN_PARTS[5].encode_utf16());
            add!(&mut html, controls);
            html.extend(LOGIN_PARTS[6].encode_utf16());
            add!(&mut html, escape!(idle));
            html.extend(LOGIN_PARTS[7].encode_utf16());
            add!(&mut html, escape!(idle));
            html.extend(LOGIN_PARTS[8].encode_utf16());
            add!(&mut html, nonce);
            html.extend(LOGIN_PARTS[9].encode_utf16());
            let html = host.string_from_units(html)?;
            let csp = run(host, "csp", &[*transaction, nonce])?;
            host.call("result", vec![csp, html])
        }
        ("csp", [transaction, nonce]) => {
            let origin = c!("origin", *transaction);
            let mut output = "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"
                .encode_utf16()
                .collect::<Vec<_>>();
            add!(&mut output, *nonce);
            output.extend("'; form-action 'self' ".encode_utf16());
            add!(&mut output, origin);
            output.extend("; base-uri 'none'; frame-ancestors 'none'".encode_utf16());
            host.string_from_units(output)
        }
        ("cookie", [id]) => {
            let suffix = c!("cookieSuffix", *id);
            let mut output = "__Host-mcp_oauth_csrf_".encode_utf16().collect::<Vec<_>>();
            add!(&mut output, suffix);
            host.string_from_units(output)
        }
        ("expired", []) => host.literal(EXPIRED),
        _ => host.call("invalidOperation", vec![]),
    }
}

const LOGIN_PARTS: [&str; 10] = [
    r###"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect "###,
    r###"</title><style>body{font:16px system-ui;max-width:28rem;margin:10vh auto;padding:1rem;color:#171717}form{display:grid;gap:1rem}label{display:grid;gap:.35rem}input,button{font:inherit;padding:.7rem}button{cursor:pointer}button:disabled{cursor:wait;opacity:.7}.status{margin:0;color:#525252}.error{color:#b42318}</style></head><body><h1>Connect "###,
    r###"</h1>"###,
    r###"<form id="oauth-connect-form" method="post" action="/oauth/connect"><input type="hidden" name="transaction" value=""###,
    r###""><input type="hidden" name="csrf" value=""###,
    r###"">"###,
    r###"<button id="oauth-connect-button" type="submit" data-idle-label=""###,
    r###"">"###,
    r###"</button><p id="oauth-connect-status" class="status" role="status" aria-live="polite" hidden>Signing in… This may take a moment.</p></form><script nonce=""###,
    r###"">(()=>{const form=document.getElementById("oauth-connect-form");const button=document.getElementById("oauth-connect-button");const status=document.getElementById("oauth-connect-status");if(!(form instanceof HTMLFormElement)||!(button instanceof HTMLButtonElement)||!(status instanceof HTMLElement))return;const reset=()=>{form.removeAttribute("aria-busy");button.disabled=false;button.textContent=button.dataset.idleLabel||"Connect";status.hidden=true};form.addEventListener("submit",()=>{form.setAttribute("aria-busy","true");button.disabled=true;button.textContent="Connecting…";status.hidden=false});addEventListener("pageshow",reset)})();</script></body></html>"###,
];

const CONTROL_PARTS: [&str; 6] = [
    r###"<label>"###,
    r###"<input name=""###,
    r###"" type=""###,
    r###"" required autocomplete=""###,
    r###"""###,
    r###"></label>"###,
];

const EXPIRED: &str = r###"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection expired</title><style>body{font:16px system-ui;max-width:28rem;margin:10vh auto;padding:1rem;color:#171717}p{line-height:1.5}</style></head><body><h1>Connection expired</h1><p>This sign-in link has expired or was already used.</p><p>Close this tab, return to the app that started the connection, and click Connect again.</p></body></html>"###;
