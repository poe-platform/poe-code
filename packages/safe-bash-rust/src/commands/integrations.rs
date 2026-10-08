use crate::commands::structured::{JVal, cmd_jq_with_env, parse_json_stream};
use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, bytes_to_stream_string, path::resolve_posix_path, stream_string_to_bytes};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

type Value = JVal;

#[derive(Clone, Debug, Default)]
struct Map(Vec<(String, JVal)>);

impl Map {
    fn new() -> Self {
        Self(Vec::new())
    }
    fn insert(&mut self, k: String, v: JVal) {
        if let Some(existing) = self.0.iter_mut().find(|(ek, _)| ek == &k) {
            existing.1 = v;
        } else {
            self.0.push((k, v));
        }
    }
}

trait JValExt {
    fn get(&self, key: &str) -> Option<&JVal>;
    fn as_str(&self) -> Option<&str>;
    fn as_array(&self) -> Option<&Vec<JVal>>;
}

impl JValExt for JVal {
    fn get(&self, key: &str) -> Option<&JVal> {
        match self {
            JVal::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn as_str(&self) -> Option<&str> {
        match self {
            JVal::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }
    fn as_array(&self) -> Option<&Vec<JVal>> {
        match self {
            JVal::Array(a) => Some(a),
            _ => None,
        }
    }
}

fn to_pretty_json(val: &JVal) -> String {
    val.to_json_string(false, false, 0)
}

fn from_json_str(s: &str) -> Result<JVal, String> {
    let mut vals = parse_json_stream(s)?;
    if vals.is_empty() {
        Err("empty json".into())
    } else {
        Ok(vals.remove(0))
    }
}

macro_rules! jval {
    (null) => { JVal::Null };
    (true) => { JVal::Bool(true) };
    (false) => { JVal::Bool(false) };
    ([]) => { JVal::Array(Vec::new()) };
    ([ $($tt:tt)+ ]) => {{
        let mut arr: Vec<JVal> = Vec::new();
        jval_array!(arr, $($tt)+);
        JVal::Array(arr)
    }};
    ({}) => { JVal::Object(Vec::new()) };
    ({ $($tt:tt)+ }) => {{
        let mut entries: Vec<(String, JVal)> = Vec::new();
        jval_object!(entries, $($tt)+);
        JVal::Object(entries)
    }};
    ($other:expr) => {
        ToJVal::to_jval(&($other))
    };
}

macro_rules! jval_array {
    ($arr:ident $(,)?) => {};
    ($arr:ident, { $($inner:tt)* } $(, $($rest:tt)*)?) => {
        $arr.push(jval!({ $($inner)* }));
        $( jval_array!($arr, $($rest)*); )?
    };
    ($arr:ident, [ $($inner:tt)* ] $(, $($rest:tt)*)?) => {
        $arr.push(jval!([ $($inner)* ]));
        $( jval_array!($arr, $($rest)*); )?
    };
    ($arr:ident, $elem:expr $(, $($rest:tt)*)?) => {
        $arr.push(jval!($elem));
        $( jval_array!($arr, $($rest)*); )?
    };
}

macro_rules! jval_object {
    ($entries:ident $(,)?) => {};
    ($entries:ident, $key:tt : { $($inner:tt)* } $(, $($rest:tt)*)?) => {
        $entries.push(($key.to_string(), jval!({ $($inner)* })));
        $( jval_object!($entries, $($rest)*); )?
    };
    ($entries:ident, $key:tt : [ $($inner:tt)* ] $(, $($rest:tt)*)?) => {
        $entries.push(($key.to_string(), jval!([ $($inner)* ])));
        $( jval_object!($entries, $($rest)*); )?
    };
    ($entries:ident, $key:tt : $val:expr $(, $($rest:tt)*)?) => {
        $entries.push(($key.to_string(), jval!($val)));
        $( jval_object!($entries, $($rest)*); )?
    };
}

trait ToJVal {
    fn to_jval(&self) -> JVal;
}
impl<T: ToJVal + ?Sized> ToJVal for &T {
    fn to_jval(&self) -> JVal { (**self).to_jval() }
}
impl ToJVal for JVal {
    fn to_jval(&self) -> JVal { self.clone() }
}
impl ToJVal for String {
    fn to_jval(&self) -> JVal { JVal::Str(self.clone()) }
}
impl ToJVal for str {
    fn to_jval(&self) -> JVal { JVal::Str(self.to_string()) }
}
impl ToJVal for bool {
    fn to_jval(&self) -> JVal { JVal::Bool(*self) }
}
impl ToJVal for u64 {
    fn to_jval(&self) -> JVal { JVal::Number(*self as f64) }
}
impl ToJVal for usize {
    fn to_jval(&self) -> JVal { JVal::Number(*self as f64) }
}
impl ToJVal for i32 {
    fn to_jval(&self) -> JVal { JVal::Number(*self as f64) }
}
impl ToJVal for Vec<JVal> {
    fn to_jval(&self) -> JVal { JVal::Array(self.clone()) }
}
impl ToJVal for Map {
    fn to_jval(&self) -> JVal { JVal::Object(self.0.clone()) }
}
impl ToJVal for BTreeMap<String, String> {
    fn to_jval(&self) -> JVal {
        JVal::Object(self.iter().map(|(k, v)| (k.clone(), JVal::Str(v.clone()))).collect())
    }
}
impl From<BTreeMap<String, String>> for JVal {
    fn from(m: BTreeMap<String, String>) -> Self {
        JVal::Object(m.into_iter().map(|(k, v)| (k, JVal::Str(v))).collect())
    }
}

#[derive(Clone, Debug)]
struct OpVault {
    id: String,
    name: String,
    description: Option<String>,
    icon: Option<String>,
}

#[derive(Clone, Debug)]
struct OpField {
    id: String,
    label: String,
    field_type: String,
    purpose: Option<String>,
    section_id: Option<String>,
    section_label: Option<String>,
    value: String,
}

#[derive(Clone, Debug)]
struct OpFileAttachment {
    id: String,
    name: String,
    size: usize,
    section_id: Option<String>,
    section_label: Option<String>,
    content: Vec<u8>,
}

#[derive(Clone, Debug)]
struct OpItem {
    id: String,
    title: String,
    category: String,
    vault_id: String,
    tags: Vec<String>,
    favorite: bool,
    state: String,
    urls: Vec<String>,
    fields: Vec<OpField>,
    sections: Vec<(String, String)>,
    files: Vec<OpFileAttachment>,
}

#[derive(Clone, Debug)]
struct OpDocument {
    id: String,
    title: String,
    file_name: String,
    vault_id: String,
    tags: Vec<String>,
    content: Vec<u8>,
}

#[derive(Clone, Debug)]
struct GhIssueRecord {
    number: u64,
    title: String,
    body: String,
    state: String,
    labels: Vec<String>,
    comments: Vec<String>,
}

#[derive(Clone, Debug)]
struct GhPrRecord {
    number: u64,
    title: String,
    body: String,
    state: String,
    head: String,
    base: String,
    is_draft: bool,
    labels: Vec<String>,
    comments: Vec<String>,
}

#[derive(Clone, Debug)]
struct GhReleaseRecord {
    tag_name: String,
    name: String,
    body: String,
    is_draft: bool,
    is_prerelease: bool,
}

#[derive(Clone, Debug)]
struct GhRepoRecord {
    owner: String,
    name: String,
    description: String,
    is_private: bool,
    default_branch: String,
    next_number: u64,
    issues: Vec<GhIssueRecord>,
    prs: Vec<GhPrRecord>,
    releases: Vec<GhReleaseRecord>,
    labels: Vec<(String, String, String)>,
    variables: BTreeMap<String, String>,
    secrets: Vec<String>,
}

#[derive(Clone, Debug)]
struct IntegrationState {
    op_seq: u64,
    op_default_vault: Option<String>,
    op_vaults: Vec<OpVault>,
    op_items: Vec<OpItem>,
    op_docs: Vec<OpDocument>,
    op_envs: BTreeMap<String, BTreeMap<String, String>>,
    op_snapshots: BTreeMap<String, Value>,
    gh_user: String,
    gh_token: String,
    gh_logged_in: bool,
    gh_config: BTreeMap<String, String>,
    gh_aliases: BTreeMap<String, String>,
    gh_default_repo: Option<String>,
    gh_repos: BTreeMap<String, GhRepoRecord>,
}

impl Default for IntegrationState {
    fn default() -> Self {
        let mut gh_config = BTreeMap::new();
        gh_config.insert("git_protocol".into(), "https".into());
        gh_config.insert("editor".into(), "vim".into());
        gh_config.insert("prompt".into(), "enabled".into());
        gh_config.insert("pager".into(), String::new());
        gh_config.insert("http_unix_socket".into(), String::new());
        gh_config.insert("browser".into(), String::new());
        let mut gh_aliases = BTreeMap::new();
        gh_aliases.insert("co".into(), "pr checkout".into());
        let mut gh_repos = BTreeMap::new();
        gh_repos.insert(
            "octocat/Hello-World".into(),
            GhRepoRecord {
                owner: "octocat".into(),
                name: "Hello-World".into(),
                description: "My first repository on GitHub!".into(),
                is_private: false,
                default_branch: "main".into(),
                next_number: 1,
                issues: Vec::new(),
                prs: Vec::new(),
                releases: Vec::new(),
                labels: vec![
                    ("bug".into(), "d73a4a".into(), "Something isn't working".into()),
                    ("documentation".into(), "0075ca".into(), "Improvements or additions to documentation".into()),
                    ("enhancement".into(), "a2eeef".into(), "New feature or request".into()),
                    ("good first issue".into(), "7057ff".into(), "Good for newcomers".into()),
                    ("help wanted".into(), "008672".into(), "Extra attention is needed".into()),
                ],
                variables: BTreeMap::new(),
                secrets: Vec::new(),
            },
        );
        Self {
            op_seq: 0,
            op_default_vault: None,
            op_vaults: Vec::new(),
            op_items: Vec::new(),
            op_docs: Vec::new(),
            op_envs: BTreeMap::new(),
            op_snapshots: BTreeMap::new(),
            gh_user: "octocat".into(),
            gh_token: "gho_default_safe_bash_token_1234567890".into(),
            gh_logged_in: true,
            gh_config,
            gh_aliases,
            gh_default_repo: None,
            gh_repos,
        }
    }
}

static INTEGRATION_STATES: OnceLock<Mutex<BTreeMap<u64, IntegrationState>>> = OnceLock::new();

fn states() -> &'static Mutex<BTreeMap<u64, IntegrationState>> {
    INTEGRATION_STATES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn next_op_id(st: &mut IntegrationState) -> String {
    st.op_seq += 1;
    let mut n = st.op_seq;
    let mut digits = Vec::new();
    while n > 0 {
        let rem = (n % 36) as u8;
        digits.push(if rem < 10 { (b'0' + rem) as char } else { (b'a' + rem - 10) as char });
        n /= 36;
    }
    digits.reverse();
    let s: String = digits.into_iter().collect();
    format!("{:a>26}", s)
}

fn find_or_ensure_vault(st: &mut IntegrationState, selector: Option<&str>) -> Option<OpVault> {
    if let Some(sel) = selector {
        if let Some(v) = st.op_vaults.iter().find(|v| v.id == sel || v.name.eq_ignore_ascii_case(sel)) {
            return Some(v.clone());
        }
        let id = next_op_id(st);
        let v = OpVault { id: id.clone(), name: sel.to_string(), description: None, icon: None };
        if st.op_default_vault.is_none() {
            st.op_default_vault = Some(id);
        }
        st.op_vaults.push(v.clone());
        return Some(v);
    }
    if let Some(def_id) = st.op_default_vault.clone()
        && let Some(v) = st.op_vaults.iter().find(|v| v.id == def_id)
    {
        return Some(v.clone());
    }
    st.op_vaults.first().cloned()
}

fn find_vault<'a>(st: &'a IntegrationState, selector: Option<&str>) -> Option<&'a OpVault> {
    if let Some(sel) = selector {
        return st.op_vaults.iter().find(|v| v.id == sel || v.name.eq_ignore_ascii_case(sel));
    }
    if let Some(def_id) = st.op_default_vault.as_deref()
        && let Some(v) = st.op_vaults.iter().find(|v| v.id == def_id)
    {
        return Some(v);
    }
    st.op_vaults.first()
}


fn is_valid_vault_icon(icon: &str) -> bool {
    matches!(
        icon,
        "airplane" | "application" | "art-supplies" | "bankers-box" | "brown-briefcase"
        | "brown-gate" | "buildings" | "cabin" | "castle" | "circle-of-dots" | "coffee"
        | "color-wheel" | "curtained-window" | "document" | "doughnut" | "fence" | "galaxy"
        | "gears" | "globe" | "green-backpack" | "green-gem" | "handshake" | "heart-with-monitor"
        | "house" | "id-card" | "jet" | "large-ship" | "luggage" | "plant" | "porthole" | "puzzle"
        | "rainbow" | "record" | "round-door" | "sandals" | "scales" | "screwdriver" | "shop"
        | "tall-window" | "treasure-chest" | "vault-door" | "vehicle" | "wallet" | "wrench"
    )
}

fn vault_json(v: &OpVault) -> Value {
    let mut m = Map::new();
    m.insert("name".into(), JVal::Str(v.name.clone()));
    if let Some(d) = &v.description {
        m.insert("description".into(), JVal::Str(d.clone()));
    }
    if let Some(ic) = &v.icon {
        m.insert("icon".into(), JVal::Str(ic.clone()));
    }
    m.insert("id".into(), JVal::Str(v.id.clone()));
    JVal::Object(m.0)
}

fn item_json(item: &OpItem, vault_name: &str) -> Value {
    let fields: Vec<Value> = item
        .fields
        .iter()
        .map(|f| {
            let mut m = Map::new();
            m.insert("id".into(), JVal::Str(f.id.clone()));
            m.insert("label".into(), JVal::Str(f.label.clone()));
            m.insert("type".into(), JVal::Str(f.field_type.clone()));
            if let Some(p) = &f.purpose {
                m.insert("purpose".into(), JVal::Str(p.clone()));
            }
            if let (Some(sid), Some(slabel)) = (&f.section_id, &f.section_label) {
                m.insert("section".into(), jval!({ "id": sid, "label": slabel }));
            }
            m.insert("value".into(), JVal::Str(f.value.clone()));
            let ref_path = if let Some(slabel) = &f.section_label {
                format!("op://{}/{}/{}/{}", vault_name, item.title, slabel, f.label)
            } else {
                format!("op://{}/{}/{}", vault_name, item.title, f.label)
            };
            m.insert("reference".into(), JVal::Str(ref_path));
            JVal::Object(m.0)
        })
        .collect();

    let sections: Vec<Value> = item
        .sections
        .iter()
        .map(|(id, label)| jval!({ "id": id, "label": label }))
        .collect();

    let urls: Vec<Value> = item
        .urls
        .iter()
        .enumerate()
        .map(|(idx, href)| jval!({ "href": href, "primary": idx == 0 }))
        .collect();

    let files: Vec<Value> = item
        .files
        .iter()
        .map(|f| {
            let mut m = Map::new();
            m.insert("id".into(), JVal::Str(f.id.clone()));
            m.insert("name".into(), JVal::Str(f.name.clone()));
            m.insert("size".into(), jval!(f.size));
            if let (Some(sid), Some(slabel)) = (&f.section_id, &f.section_label) {
                m.insert("section".into(), jval!({ "id": sid, "label": slabel }));
            }
            JVal::Object(m.0)
        })
        .collect();

    let mut m = Map::new();
    m.insert("id".into(), JVal::Str(item.id.clone()));
    m.insert("title".into(), JVal::Str(item.title.clone()));
    m.insert("version".into(), jval!(1));
    m.insert(
        "vault".into(),
        jval!({ "id": item.vault_id, "name": vault_name }),
    );
    m.insert("category".into(), JVal::Str(item.category.clone()));
    m.insert("state".into(), JVal::Str(item.state.clone()));
    if item.favorite {
        m.insert("favorite".into(), Value::Bool(true));
    }
    if !item.tags.is_empty() {
        m.insert(
            "tags".into(),
            Value::Array(item.tags.iter().cloned().map(JVal::Str).collect()),
        );
    }
    if !urls.is_empty() {
        m.insert("urls".into(), Value::Array(urls));
    }
    if !sections.is_empty() {
        m.insert("sections".into(), Value::Array(sections));
    }
    m.insert("fields".into(), Value::Array(fields));
    if !files.is_empty() {
        m.insert("files".into(), Value::Array(files));
    }
    JVal::Object(m.0)
}

fn generate_recipe_password(spec: Option<&str>, seq: u64) -> String {
    let mut len = 20usize;
    if let Some(s) = spec {
        for part in s.split(',') {
            if let Ok(n) = part.trim().parse::<usize>()
                && (1..=256).contains(&n)
            {
                len = n;
            }
        }
    }
    let alphabet = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut state = seq.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut out = String::with_capacity(len);
    for i in 0..len {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add((i as u64) + 1);
        let idx = ((state >> 32) as usize) % alphabet.len();
        out.push(alphabet[idx] as char);
    }
    out
}

fn resolve_op_reference(st: &IntegrationState, uri: &str) -> Result<String, String> {
    if uri.len() < 5 || !uri[..5].eq_ignore_ascii_case("op://") {
        return Err("Invalid secret reference scheme".to_string());
    }
    let query_start = uri.find('?');
    let path_part = match query_start {
        Some(q) => &uri[5..q],
        None => &uri[5..],
    };
    let parts: Vec<&str> = path_part.split('/').collect();
    let is_allowed_ref_char = |c: char| -> bool {
        let lc = c.to_ascii_lowercase();
        lc.is_ascii_lowercase()
            || lc.is_ascii_digit()
            || matches!(lc, '-' | '_' | '.' | ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c')
    };
    if (parts.len() != 3 && parts.len() != 4)
        || parts
            .iter()
            .any(|p| p.is_empty() || p.chars().any(|c| !is_allowed_ref_char(c)))
    {
        return Err("Invalid secret reference path; use IDs for unsupported names".to_string());
    }
    let mut query_attr: Option<String> = None;
    if let Some(q_idx) = query_start {
        let mut seen_keys = std::collections::BTreeSet::new();
        let mut has_attribute = false;
        let mut has_attr = false;
        for entry in uri[q_idx + 1..].split('&') {
            let Some(eq) = entry.find('=') else {
                return Err("Invalid secret reference query".to_string());
            };
            let key = &entry[..eq];
            let val = &entry[eq + 1..];
            if eq < 1
                || val.is_empty()
                || !matches!(key, "attribute" | "attr" | "ssh-format")
                || !seen_keys.insert(key.to_string())
            {
                return Err("Invalid secret reference query".to_string());
            }
            if key == "attribute" {
                has_attribute = true;
                query_attr = Some(val.to_string());
            } else if key == "attr" {
                has_attr = true;
                query_attr = Some(val.to_string());
            }
        }
        if has_attribute && has_attr {
            return Err("Conflicting attribute parameters".to_string());
        }
    }
    let eval_field_attr = |f: &OpField| -> Result<String, String> {
        match query_attr.as_deref().unwrap_or("value") {
            "value" => Ok(f.value.clone()),
            "type" => Ok(f.field_type.clone()),
            "id" => Ok(f.id.clone()),
            "purpose" => f
                .purpose
                .clone()
                .ok_or_else(|| "Secret attribute is unavailable".to_string()),
            _ => Err("Secret attribute is unavailable".to_string()),
        }
    };
    let eval_file_attr = |fa: &OpFileAttachment| -> Result<String, String> {
        match query_attr.as_deref().unwrap_or("content") {
            "content" => Ok(String::from_utf8_lossy(&fa.content).to_string()),
            "type" => Ok("FILE".to_string()),
            "size" => Ok(fa.size.to_string()),
            "id" => Ok(fa.id.clone()),
            "name" => Ok(fa.name.clone()),
            _ => Err("Secret attribute is unavailable".to_string()),
        }
    };
    let vault_sel = parts[0];
    let item_sel = parts[1];
    let vault = st
        .op_vaults
        .iter()
        .find(|v| v.id == vault_sel || v.name.eq_ignore_ascii_case(vault_sel))
        .ok_or_else(|| "Object not found".to_string())?;
    let item = st
        .op_items
        .iter()
        .find(|it| {
            it.vault_id == vault.id
                && it.state != "ARCHIVED"
                && (it.id == item_sel || it.title.eq_ignore_ascii_case(item_sel))
        })
        .ok_or_else(|| "Object not found".to_string())?;

    if parts.len() == 3 {
        let field_sel = parts[2];
        if let Some(f) = item.fields.iter().find(|f| {
            f.section_label.is_none()
                && (f.id.eq_ignore_ascii_case(field_sel) || f.label.eq_ignore_ascii_case(field_sel))
        }) {
            return eval_field_attr(f);
        }
        if let Some(f) = item
            .fields
            .iter()
            .find(|f| f.id.eq_ignore_ascii_case(field_sel) || f.label.eq_ignore_ascii_case(field_sel))
        {
            return eval_field_attr(f);
        }
        if let Some(fa) = item
            .files
            .iter()
            .find(|fa| fa.id.eq_ignore_ascii_case(field_sel) || fa.name.eq_ignore_ascii_case(field_sel))
        {
            return eval_file_attr(fa);
        }
        return Err("Object not found".to_string());
    }

    let section_sel = parts[2];
    let field_sel = parts[3];
    if let Some(f) = item.fields.iter().find(|f| {
        let sec_ok = f
            .section_label
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case(section_sel))
            .unwrap_or(false)
            || f.section_id
                .as_deref()
                .map(|s| s.eq_ignore_ascii_case(section_sel))
                .unwrap_or(false);
        sec_ok && (f.id.eq_ignore_ascii_case(field_sel) || f.label.eq_ignore_ascii_case(field_sel))
    }) {
        return eval_field_attr(f);
    }
    if let Some(fa) = item.files.iter().find(|fa| {
        let sec_ok = fa
            .section_label
            .as_deref()
            .map(|s| s.eq_ignore_ascii_case(section_sel))
            .unwrap_or(false)
            || fa
                .section_id
                .as_deref()
                .map(|s| s.eq_ignore_ascii_case(section_sel))
                .unwrap_or(false);
        sec_ok && (fa.id.eq_ignore_ascii_case(field_sel) || fa.name.eq_ignore_ascii_case(field_sel))
    }) {
        return eval_file_attr(fa);
    }
    Err("Object not found".to_string())
}

fn expand_env_vars_in_ref(raw: &str, env: &BTreeMap<String, String>) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '$' {
            if i + 1 < chars.len() && chars[i + 1] == '{' {
                if let Some(end) = chars[i + 2..].iter().position(|&c| c == '}') {
                    let name: String = chars[i + 2..i + 2 + end].iter().collect();
                    if let Some(v) = env.get(&name) {
                        out.push_str(v);
                    }
                    i += 3 + end;
                    continue;
                }
            }
            let mut j = i + 1;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            if j > i + 1 {
                let name: String = chars[i + 1..j].iter().collect();
                if let Some(v) = env.get(&name) {
                    out.push_str(v);
                }
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn find_template_closing_braces(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    let mut in_quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == b'\\' && i + 1 < bytes.len() {
                i += 2;
                continue;
            }
            if b == q {
                in_quote = None;
            }
            i += 1;
            continue;
        }
        if b == b'"' || b == b'\'' {
            in_quote = Some(b);
            i += 1;
            continue;
        }
        if b == b'}' && i + 1 < bytes.len() && bytes[i + 1] == b'}' {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn render_op_inject_template(
    tpl: &str,
    st: &IntegrationState,
    env: &BTreeMap<String, String>,
    secret_values: &mut Vec<String>,
) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = tpl;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = find_template_closing_braces(after_open) else {
            return Err("unclosed template expression".into());
        };
        let expr = after_open[..end].trim();
        if (expr.starts_with('"') && expr.ends_with('"') && expr.len() >= 2)
            || (expr.starts_with('\'') && expr.ends_with('\'') && expr.len() >= 2)
        {
            out.push_str(&expr[1..expr.len() - 1]);
        } else {
            let expanded = expand_env_vars_in_ref(expr, env);
            let val = resolve_op_reference(st, expanded.trim())?;
            if !val.is_empty() && !secret_values.contains(&val) {
                secret_values.push(val.clone());
            }
            out.push_str(&val);
        }
        rest = &after_open[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

const OP_ROOT_HELP: &str = "\
This portable implementation exposes an op-compatible command interface with a configurable backend and host approval policies.

Stable command metadata targets 1Password CLI 2.39.0. Beta commands and local extensions are identified separately.

Usage:  op [command] [flags]

Management Commands:
  account          Manage your locally configured 1Password accounts
  connect          Manage Connect server instances and tokens in your 1Password account
  document         Perform CRUD operations on Document items in your vaults
  events-api       Manage Events API integrations in your 1Password account
  group            Manage the groups in your 1Password account
  item             Perform CRUD operations on the 1Password items in your vaults
  plugin           Manage the shell plugins you use to authenticate third-party CLIs
  service-account  Manage service accounts
  user             Manage users within this 1Password account
  vault            Manage permissions and perform CRUD operations on your 1Password vaults
  environment      Manage Environments and local snapshots [extension]

Commands:
  completion  Generate shell completion information
  inject      Inject secrets into a config file
  read        Read a secret reference
  run         Pass secrets as environment variables to a process
  signin      Sign in to a 1Password account
  signout     Sign out of a 1Password account
  update      Check for and download updates.
  whoami      Get information about a signed-in account

Global Flags:
      --account account    Select the account to execute the command by account shorthand, sign-in address, account ID, or user ID.
      --cache              Store and use cached information. (default true)
      --config directory   Use this configuration directory.
      --debug              Enable debug mode.
      --encoding type      Use this character encoding type. Default: UTF-8. Supported: SHIFT_JIS, gbk.
      --format string      Use this output format. Can be 'human-readable' or 'json'. (default \"human-readable\")
  -h, --help               Get help for op.
      --iso-timestamps     Format timestamps according to ISO 8601 / RFC 3339.
      --no-color           Print output without color.
      --session token      Authenticate with this session token.
  -v, --version            version for op

Run 'op [command] --help' for more information on the command.
";

const GH_ROOT_HELP: &str = "\
Work seamlessly with GitHub from the command line.

USAGE
  gh <command> <subcommand> [flags]

CORE COMMANDS
  auth:        Authenticate gh and git with GitHub
  browse:      Open the repository in the browser
  codespace:   Connect to and manage codespaces
  gist:        Manage gists
  issue:       Manage issues
  org:         Manage organizations
  pr:          Manage pull requests
  project:     Work with GitHub Projects
  release:     Manage releases
  repo:        Manage repositories

GITHUB ACTIONS COMMANDS
  cache:       Manage GitHub Actions caches
  run:         View details about workflow runs
  workflow:    View details about GitHub Actions workflows

ADDITIONAL COMMANDS
  alias:       Create command shortcuts
  api:         Make an authenticated GitHub API request
  attestation: Work with artifact attestations
  completion:  Generate shell completion scripts
  config:      Manage configuration for gh
  extension:   Manage gh extensions
  gpg-key:     Manage GPG keys
  label:       Manage labels
  ruleset:     View info about repo rulesets
  search:      Search for repositories, issues, and pull requests
  secret:      Manage GitHub secrets
  ssh-key:     Manage SSH keys
  status:      Print information about relevant issues, pull requests, and notifications
  variable:    Manage GitHub Actions variables
  version:     Show gh version
";

pub fn try_run_integration_command<F>(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    mut exec_sub: F,
) -> Option<BuiltinOutcome>
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    match cmd {
        "op" => Some(cmd_op(args, stdin, cwd, env, fs, &mut exec_sub)),
        "gh" => Some(cmd_gh(args, stdin, cwd, env, fs)),
        _ => None,
    }
}

fn op_err(msg: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("op: {msg}\n"),
        exit_code: 1,
    }
}

fn apply_field_assignment(item: &mut OpItem, spec: &str, fs: &dyn SafeBashFs, cwd: &str, seq: &mut u64) -> Result<(), String> {
    if let Some(before_del) = spec.strip_suffix("[delete]") {
        let (sec, label) = if let Some((s, f)) = before_del.split_once('.') {
            (Some(s.trim()), f.trim())
        } else {
            (None, before_del.trim())
        };
        item.fields.retain(|f| {
            let sec_match = match (sec, f.section_label.as_deref()) {
                (Some(s), Some(fl)) => s.eq_ignore_ascii_case(fl),
                (None, None) => true,
                _ => false,
            };
            !(sec_match && (f.label.eq_ignore_ascii_case(label) || f.id.eq_ignore_ascii_case(label)))
        });
        return Ok(());
    }
    let chars: Vec<char> = spec.chars().collect();
    let mut name_parts: Vec<String> = Vec::new();
    let mut cur_part = String::new();
    let mut offset = 0usize;
    while offset < chars.len() {
        let ch = chars[offset];
        if ch == '\\' {
            offset += 1;
            let Some(&next_ch) = chars.get(offset) else {
                return Err("Invalid field name escape".into());
            };
            if !matches!(next_ch, '.' | '\\' | '=') {
                return Err("Invalid field name escape".into());
            }
            cur_part.push(next_ch);
            offset += 1;
        } else if ch == '.' {
            name_parts.push(std::mem::take(&mut cur_part));
            offset += 1;
        } else if ch == '=' || ch == '[' {
            break;
        } else {
            cur_part.push(ch);
            offset += 1;
        }
    }
    name_parts.push(cur_part);
    if name_parts.len() > 2 || name_parts.iter().any(|p| p.is_empty()) {
        return Err("Invalid field assignment".into());
    }
    let mut explicit_type_owned: Option<String> = None;
    if offset < chars.len() && chars[offset] == '[' {
        let Some(rel_close) = chars[offset + 1..].iter().position(|&c| c == ']') else {
            return Err("Invalid field type".into());
        };
        let t: String = chars[offset + 1..offset + 1 + rel_close].iter().collect();
        explicit_type_owned = Some(t);
        offset += rel_close + 2;
    }
    let explicit_type = explicit_type_owned.as_deref();
    if offset < chars.len() && chars[offset] != '=' {
        return Err("Invalid field assignment".into());
    }
    if offset == chars.len() && explicit_type.is_none() {
        return Err("Assignment requires a value or type".into());
    }
    let val_owned: String = if offset < chars.len() && chars[offset] == '=' {
        chars[offset + 1..].iter().collect()
    } else {
        String::new()
    };
    let val = val_owned.as_str();
    let (section_label, field_label) = if name_parts.len() == 2 {
        (
            Some(name_parts[0].trim().to_string()),
            name_parts[1].trim().to_string(),
        )
    } else {
        (None, name_parts[0].trim().to_string())
    };
    let section_id = section_label.as_ref().map(|s| s.to_ascii_lowercase().replace(' ', "_"));
    if let (Some(sid), Some(slabel)) = (&section_id, &section_label)
        && !item.sections.iter().any(|(id, l)| id == sid || l.eq_ignore_ascii_case(slabel))
    {
        item.sections.push((sid.clone(), slabel.clone()));
    }
    if explicit_type.map(|t| t.eq_ignore_ascii_case("file")).unwrap_or(false) {
        let resolved = resolve_posix_path(cwd, val);
        let bytes = fs
            .read_file(&resolved)
            .map_err(|_| format!("cannot read file \"{val}\""))?;
        *seq += 1;
        item.files.push(OpFileAttachment {
            id: format!("file_{seq}"),
            name: field_label,
            size: bytes.len(),
            section_id,
            section_label,
            content: bytes,
        });
        return Ok(());
    }
    let ftype = match explicit_type.map(|t| t.to_ascii_lowercase()).as_deref() {
        Some("password") | Some("concealed") => "CONCEALED",
        Some("url") => "URL",
        Some("email") => "EMAIL",
        Some("otp") | Some("totp") => "OTP",
        _ => {
            if field_label.eq_ignore_ascii_case("password") {
                "CONCEALED"
            } else {
                "STRING"
            }
        }
    };
    if let Some(existing) = item.fields.iter_mut().find(|f| {
        let sec_ok = match (&section_label, &f.section_label) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            (None, None) => true,
            _ => false,
        };
        sec_ok && (f.label.eq_ignore_ascii_case(&field_label) || f.id.eq_ignore_ascii_case(&field_label))
    }) {
        existing.value = val.to_string();
        if explicit_type.is_some() {
            existing.field_type = ftype.to_string();
        }
        return Ok(());
    }
    let purpose = if section_label.is_none() && field_label.eq_ignore_ascii_case("username") {
        Some("USERNAME".to_string())
    } else if section_label.is_none() && field_label.eq_ignore_ascii_case("password") {
        Some("PASSWORD".to_string())
    } else {
        None
    };
    item.fields.push(OpField {
        id: field_label.clone(),
        label: field_label,
        field_type: ftype.to_string(),
        purpose,
        section_id,
        section_label,
        value: val.to_string(),
    });
    Ok(())
}

fn cmd_op<F>(
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    if args.is_empty() {
        return BuiltinOutcome {
            stdout: OP_ROOT_HELP.to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if args.len() == 1 && (args[0] == "--version" || args[0] == "-v") {
        return BuiltinOutcome {
            stdout: "0.0.1\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let first = args[0].as_str();
    if first == "--help" || first == "-h" || first == "help" {
        let topic: Vec<&str> = args[1..]
            .iter()
            .map(|s| s.as_str())
            .filter(|s| !s.starts_with('-'))
            .collect();
        if topic.is_empty() {
            return BuiltinOutcome {
                stdout: OP_ROOT_HELP.to_string(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        if topic == ["vault", "user"] {
            return BuiltinOutcome {
                stdout: "Manage user vault access\n\nUsage:  op vault user [command] [flags]\n\nCommands:\n  grant   Grant a user access to a vault\n  revoke  Revoke a portion or the entire access of a user to a vault\n  list    List all users with access to the vault and their permissions\n\nFlags:\n  -h, --help   help for user\n\nTo list the global flags available on every command, run  'op --help'.\n\nRun 'op vault user [command] --help' for more information on the command.\n".to_string(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        let joined = topic.join(" ");
        return BuiltinOutcome {
            stdout: format!(
                "1Password CLI - op {joined}\n\nUsage:  op {joined} [command] [flags]\n\nCommands:\n  create  Create {joined}\n  get     Get {joined}\n  list    List {joined}\n  edit    Edit {joined}\n  delete  Delete {joined}\n  grant   Grant access\n  revoke  Revoke access\n\nFlags:\n  -h, --help   help for {joined}\n"
            ),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if args.iter().any(|a| a == "--help" || a == "-h") && first != "run" {
        let topic: Vec<&str> = args
            .iter()
            .map(|s| s.as_str())
            .filter(|s| !s.starts_with('-'))
            .collect();
        let joined = topic.join(" ");
        return BuiltinOutcome {
            stdout: format!(
                "1Password CLI - op {joined}\n\nUsage:  op {joined} [flags]\n\nFlags:\n  -h, --help   help for {joined}\n"
            ),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let fs_id = fs.fs_id();
    let format_json = args.iter().any(|a| a == "--format=json")
        || args
            .windows(2)
            .any(|w| w[0] == "--format" && w[1] == "json")
        || env.get("OP_FORMAT").map(|v| v == "json").unwrap_or(false);

    match first {
        "whoami" => op_err("No authenticated session"),
        "account" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            if sub == "list" || sub == "ls" {
                let stdout = if format_json { "[]\n".to_string() } else { String::new() };
                BuiltinOutcome {
                    stdout,
                    stderr: String::new(),
                    exit_code: 0,
                }
            } else {
                op_err("Account selection is required")
            }
        }
        "vault" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" | "ls" => {
                    let arr: Vec<Value> = st.op_vaults.iter().map(vault_json).collect();
                    let stdout = if format_json {
                        format!("{}\n", to_pretty_json(&JVal::Array(arr)))
                    } else if st.op_vaults.is_empty() {
                        String::new()
                    } else {
                        let mut s = String::from("ID\tNAME\n");
                        for v in &st.op_vaults {
                            s.push_str(&format!("{}\t{}\n", v.id, v.name));
                        }
                        s
                    };
                    BuiltinOutcome { stdout, stderr: String::new(), exit_code: 0 }
                }
                "create" => {
                    let mut name = None;
                    let mut description = None;
                    let mut icon = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--description" => {
                                description = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--icon" => {
                                icon = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if name.is_none() {
                                    name = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(name) = name else {
                        return op_err("vault name is required");
                    };
                    if let Some(ref ic) = icon
                        && !is_valid_vault_icon(ic)
                    {
                        return op_err("Invalid vault icon");
                    }
                    let id = next_op_id(st);
                    let v = OpVault { id: id.clone(), name, description, icon };
                    if st.op_default_vault.is_none() {
                        st.op_default_vault = Some(id);
                    }
                    let out = to_pretty_json(&vault_json(&v));
                    st.op_vaults.push(v);
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let sel = args.iter().skip(2).find(|a| !a.starts_with('-')).map(|s| s.as_str());
                    let Some(v) = find_vault(st, sel) else {
                        return op_err("vault not found");
                    };
                    let out = to_pretty_json(&vault_json(v));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let mut sel = None;
                    let mut new_name = None;
                    let mut new_desc = None;
                    let mut new_icon = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--name" => {
                                new_name = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--description" => {
                                new_desc = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--icon" => {
                                new_icon = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("vault selector is required");
                    };
                    let Some(v) = st.op_vaults.iter_mut().find(|v| v.id == sel || v.name.eq_ignore_ascii_case(&sel)) else {
                        return op_err("vault not found");
                    };
                    if let Some(n) = new_name {
                        v.name = n;
                    }
                    if let Some(d) = new_desc {
                        v.description = if d.is_empty() { None } else { Some(d) };
                    }
                    if let Some(ic) = new_icon {
                        if !ic.is_empty() && !is_valid_vault_icon(&ic) {
                            return op_err("Invalid vault icon");
                        }
                        v.icon = if ic.is_empty() { None } else { Some(ic) };
                    }
                    let out = to_pretty_json(&vault_json(v));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "delete" | "rm" => {
                    let sel = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let Some(sel) = sel else {
                        return op_err("vault selector is required");
                    };
                    let before = st.op_vaults.len();
                    st.op_vaults.retain(|v| !(v.id == sel || v.name.eq_ignore_ascii_case(&sel)));
                    if st.op_vaults.len() == before {
                        return op_err("vault not found");
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => op_err(&format!("unknown vault subcommand \"{sub}\"")),
            }
        }
        "item" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "template" => {
                    let tsub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    if tsub == "list" || tsub == "ls" {
                        let out = to_pretty_json(&jval!(["Login"]));
                        return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let cat = args.get(3).map(|s| s.as_str()).unwrap_or("Login");
                    if !cat.eq_ignore_ascii_case("login") {
                        return op_err("Item template schema is unavailable");
                    }
                    let tpl = jval!({
                        "title": "",
                        "category": cat.to_ascii_uppercase(),
                        "fields": [
                            { "id": "username", "type": "STRING", "purpose": "USERNAME", "label": "username", "value": "" },
                            { "id": "password", "type": "CONCEALED", "purpose": "PASSWORD", "label": "password", "password_details": { "strength": "TERRIBLE" }, "value": "" },
                            { "id": "notesPlain", "type": "STRING", "purpose": "NOTES", "label": "notesPlain", "value": "" }
                        ]
                    });
                    let out = to_pretty_json(&tpl);
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "create" => {
                    let mut category = "LOGIN".to_string();
                    let mut title = "Untitled".to_string();
                    let mut vault_sel: Option<String> = None;
                    let mut url: Option<String> = None;
                    let mut tags: Vec<String> = Vec::new();
                    let mut favorite = false;
                    let mut gen_pw: Option<Option<String>> = None;
                    let mut template_path: Option<String> = None;
                    let mut assignments: Vec<String> = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        let a = args[i].as_str();
                        match a {
                            "--category" => {
                                if let Some(v) = args.get(i + 1) {
                                    category = v.to_ascii_uppercase().replace(' ', "_");
                                }
                                i += 2;
                            }
                            "--title" => {
                                if let Some(v) = args.get(i + 1) {
                                    title = v.clone();
                                }
                                i += 2;
                            }
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--url" => {
                                url = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--tags" => {
                                if let Some(v) = args.get(i + 1) {
                                    tags = v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                                }
                                i += 2;
                            }
                            "--favorite" => {
                                favorite = true;
                                i += 1;
                            }
                            "--generate-password" => {
                                gen_pw = Some(None);
                                i += 1;
                            }
                            "--template" => {
                                template_path = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--format" => i += 2,
                            "-" => {
                                template_path = Some("-".to_string());
                                i += 1;
                            }
                            _ if a.starts_with("--generate-password=") => {
                                gen_pw = Some(Some(a["--generate-password=".len()..].to_string()));
                                i += 1;
                            }
                            _ if a.starts_with("--") => i += 1,
                            _ => {
                                assignments.push(a.to_string());
                                i += 1;
                            }
                        }
                    }

                    let vault = if let Some(ref vs) = vault_sel {
                        let Some(v) = find_vault(st, Some(vs)).cloned() else {
                            return op_err("Object not found");
                        };
                        v
                    } else {
                        find_or_ensure_vault(st, None).unwrap_or(OpVault {
                            id: "v-default".into(),
                            name: "Private".into(),
                            description: None,
                            icon: None,
                        })
                    };
                    if !st.op_vaults.iter().any(|v| v.id == vault.id) {
                        st.op_vaults.push(vault.clone());
                    }

                    let id = next_op_id(st);
                    let mut item = OpItem {
                        id,
                        title,
                        category: category.clone(),
                        vault_id: vault.id.clone(),
                        tags,
                        favorite,
                        state: "ACTIVE".into(),
                        urls: url.into_iter().collect(),
                        fields: Vec::new(),
                        sections: Vec::new(),
                        files: Vec::new(),
                    };

                    if let Some(tp) = template_path {
                        let raw_tpl = if tp == "-" {
                            stdin.to_string()
                        } else {
                            let resolved = resolve_posix_path(cwd, &tp);
                            let Ok(bytes) = fs.read_file(&resolved) else {
                                return op_err(&format!("cannot read template \"{tp}\""));
                            };
                            String::from_utf8_lossy(&bytes).to_string()
                        };
                        if let Ok(val) = from_json_str(&raw_tpl) {
                            if let Some(t) = val.get("title").and_then(|v| v.as_str()) {
                                item.title = t.to_string();
                            }
                            if let Some(c) = val.get("category").and_then(|v| v.as_str()) {
                                item.category = c.to_ascii_uppercase();
                            }
                            if let Some(farr) = val.get("fields").and_then(|v| v.as_array()) {
                                for f in farr {
                                    let fid = f.get("id").and_then(|v| v.as_str()).unwrap_or("field").to_string();
                                    let flabel = f.get("label").and_then(|v| v.as_str()).unwrap_or(&fid).to_string();
                                    let ftype = f.get("type").and_then(|v| v.as_str()).unwrap_or("STRING").to_string();
                                    let fpurpose = f.get("purpose").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    let fval = f.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    item.fields.push(OpField {
                                        id: fid,
                                        label: flabel,
                                        field_type: ftype,
                                        purpose: fpurpose,
                                        section_id: None,
                                        section_label: None,
                                        value: fval,
                                    });
                                }
                            }
                        }
                    } else if item.category == "LOGIN" {
                        item.fields.push(OpField {
                            id: "username".into(),
                            label: "username".into(),
                            field_type: "STRING".into(),
                            purpose: Some("USERNAME".into()),
                            section_id: None,
                            section_label: None,
                            value: String::new(),
                        });
                        item.fields.push(OpField {
                            id: "password".into(),
                            label: "password".into(),
                            field_type: "CONCEALED".into(),
                            purpose: Some("PASSWORD".into()),
                            section_id: None,
                            section_label: None,
                            value: String::new(),
                        });
                        item.fields.push(OpField {
                            id: "notesPlain".into(),
                            label: "notesPlain".into(),
                            field_type: "STRING".into(),
                            purpose: Some("NOTES".into()),
                            section_id: None,
                            section_label: None,
                            value: String::new(),
                        });
                    } else {
                        return op_err("Item template schema is unavailable");
                    }

                    if let Some(recipe) = gen_pw {
                        st.op_seq += 1;
                        let pw = generate_recipe_password(recipe.as_deref(), st.op_seq);
                        if let Some(f) = item.fields.iter_mut().find(|f| f.label.eq_ignore_ascii_case("password")) {
                            f.value = pw;
                        } else {
                            item.fields.push(OpField {
                                id: "password".into(),
                                label: "password".into(),
                                field_type: "CONCEALED".into(),
                                purpose: Some("PASSWORD".into()),
                                section_id: None,
                                section_label: None,
                                value: pw,
                            });
                        }
                    }

                    for spec in &assignments {
                        if let Err(e) = apply_field_assignment(&mut item, spec, fs, cwd, &mut st.op_seq) {
                            return op_err(&e);
                        }
                    }

                    let out_json = item_json(&item, &vault.name);
                    st.op_items.push(item);
                    let out = to_pretty_json(&out_json);
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "list" | "ls" => {
                    let mut vault_sel: Option<String> = None;
                    let mut categories: Vec<String> = Vec::new();
                    let mut tags_filter: Vec<String> = Vec::new();
                    let mut fav_only = false;
                    let mut include_archive = false;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--categories" => {
                                if let Some(v) = args.get(i + 1) {
                                    categories = v.split(',').map(|s| s.trim().to_ascii_uppercase().replace(' ', "_")).collect();
                                }
                                i += 2;
                            }
                            "--tags" => {
                                if let Some(v) = args.get(i + 1) {
                                    tags_filter = v.split(',').map(|s| s.trim().to_string()).collect();
                                }
                                i += 2;
                            }
                            "--favorite" => {
                                fav_only = true;
                                i += 1;
                            }
                            "--include-archive" => {
                                include_archive = true;
                                i += 1;
                            }
                            "--format" => i += 2,
                            _ => i += 1,
                        }
                    }
                    let vault_id = vault_sel.as_deref().and_then(|sel| {
                        st.op_vaults.iter().find(|v| v.id == sel || v.name.eq_ignore_ascii_case(sel)).map(|v| v.id.clone())
                    });
                    if vault_sel.is_some() && vault_id.is_none() {
                        return BuiltinOutcome { stdout: if format_json { "[]\n".into() } else { String::new() }, stderr: String::new(), exit_code: 0 };
                    }
                    let mut arr = Vec::new();
                    for it in &st.op_items {
                        if !include_archive && it.state == "ARCHIVED" {
                            continue;
                        }
                        if let Some(vid) = &vault_id
                            && &it.vault_id != vid
                        {
                            continue;
                        }
                        if !categories.is_empty() && !categories.iter().any(|c| c == &it.category) {
                            continue;
                        }
                        if fav_only && !it.favorite {
                            continue;
                        }
                        if !tags_filter.is_empty()
                            && !tags_filter.iter().any(|tf| {
                                it.tags.iter().any(|t| t == tf || t.starts_with(&format!("{tf}/")))
                            })
                        {
                            continue;
                        }
                        let vname = st.op_vaults.iter().find(|v| v.id == it.vault_id).map(|v| v.name.as_str()).unwrap_or("Private");
                        arr.push(item_json(it, vname));
                    }
                    let stdout = if format_json {
                        format!("{}\n", to_pretty_json(&JVal::Array(arr)))
                    } else if arr.is_empty() {
                        String::new()
                    } else {
                        let mut s = String::from("ID\tTITLE\tVAULT\n");
                        for v in &arr {
                            s.push_str(&format!(
                                "{}\t{}\t{}\n",
                                v.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                                v.get("title").and_then(|x| x.as_str()).unwrap_or(""),
                                v.get("vault").and_then(|x| x.get("name")).and_then(|x| x.as_str()).unwrap_or("")
                            ));
                        }
                        s
                    };
                    BuiltinOutcome { stdout, stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let mut sel: Option<String> = None;
                    let mut vault_sel: Option<String> = None;
                    let mut otp_mode = false;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--otp" => {
                                otp_mode = true;
                                i += 1;
                            }
                            "--fields" | "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("item selector is required");
                    };
                    if sel == "-" {
                        let Ok(parsed) = from_json_str(stdin) else {
                            return op_err("invalid JSON on stdin");
                        };
                        let mut results = Vec::new();
                        let inputs = if let Some(arr) = parsed.as_array() {
                            arr.clone()
                        } else {
                            vec![parsed]
                        };
                        for entry in inputs {
                            let id_or_title = entry.get("id").and_then(|v| v.as_str()).or_else(|| entry.get("title").and_then(|v| v.as_str())).unwrap_or("");
                            if let Some(it) = st.op_items.iter().find(|it| it.id == id_or_title || it.title.eq_ignore_ascii_case(id_or_title)) {
                                let vname = st.op_vaults.iter().find(|v| v.id == it.vault_id).map(|v| v.name.as_str()).unwrap_or("Private");
                                results.push(item_json(it, vname));
                            }
                        }
                        let out = to_pretty_json(&JVal::Array(results));
                        return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let vault_id = vault_sel.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    let Some(it) = st.op_items.iter().find(|it| {
                        let v_ok = vault_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                        v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel))
                    }) else {
                        return op_err("item not found");
                    };
                    if otp_mode {
                        return BuiltinOutcome { stdout: "287082\n".to_string(), stderr: String::new(), exit_code: 0 };
                    }
                    let vname = st.op_vaults.iter().find(|v| v.id == it.vault_id).map(|v| v.name.as_str()).unwrap_or("Private");
                    let out = to_pretty_json(&item_json(it, vname));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let mut sel: Option<String> = None;
                    let mut vault_sel: Option<String> = None;
                    let mut new_title: Option<String> = None;
                    let mut gen_pw: Option<Option<String>> = None;
                    let mut assignments: Vec<String> = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        let a = args[i].as_str();
                        match a {
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--title" => {
                                new_title = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--generate-password" => {
                                gen_pw = Some(None);
                                i += 1;
                            }
                            "--format" => i += 2,
                            _ if a.starts_with("--generate-password=") => {
                                gen_pw = Some(Some(a["--generate-password=".len()..].to_string()));
                                i += 1;
                            }
                            _ if a.starts_with("--") => i += 1,
                            _ => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                } else {
                                    assignments.push(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("item selector is required");
                    };
                    let vault_id = vault_sel.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    let mut seq = st.op_seq;
                    let Some(idx) = st.op_items.iter().position(|it| {
                        let v_ok = vault_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                        v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel))
                    }) else {
                        return op_err("item not found");
                    };
                    if let Some(t) = new_title {
                        st.op_items[idx].title = t;
                    }
                    if let Some(recipe) = gen_pw {
                        seq += 1;
                        let pw = generate_recipe_password(recipe.as_deref(), seq);
                        if let Some(f) = st.op_items[idx].fields.iter_mut().find(|f| f.label.eq_ignore_ascii_case("password")) {
                            f.value = pw;
                        } else {
                            st.op_items[idx].fields.push(OpField {
                                id: "password".into(),
                                label: "password".into(),
                                field_type: "CONCEALED".into(),
                                purpose: Some("PASSWORD".into()),
                                section_id: None,
                                section_label: None,
                                value: pw,
                            });
                        }
                    }
                    for spec in &assignments {
                        if let Err(e) = apply_field_assignment(&mut st.op_items[idx], spec, fs, cwd, &mut seq) {
                            st.op_seq = seq;
                            return op_err(&e);
                        }
                    }
                    st.op_seq = seq;
                    let vname = st.op_vaults.iter().find(|v| v.id == st.op_items[idx].vault_id).map(|v| v.name.clone()).unwrap_or_else(|| "Private".into());
                    let out = to_pretty_json(&item_json(&st.op_items[idx], &vname));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "move" => {
                    let mut sel: Option<String> = None;
                    let mut cur_vault: Option<String> = None;
                    let mut dst_vault: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--current-vault" => {
                                cur_vault = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--destination-vault" => {
                                dst_vault = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let (Some(sel), Some(dst_sel)) = (sel, dst_vault) else {
                        return op_err("item selector and --destination-vault are required");
                    };
                    let Some(dst) = find_or_ensure_vault(st, Some(&dst_sel)) else {
                        return op_err("destination vault not found");
                    };
                    let cur_id = cur_vault.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    let Some(it) = st.op_items.iter_mut().find(|it| {
                        let v_ok = cur_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                        v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel))
                    }) else {
                        return op_err("item not found");
                    };
                    it.vault_id = dst.id.clone();
                    let out = to_pretty_json(&item_json(it, &dst.name));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "delete" | "rm" => {
                    let mut sel: Option<String> = None;
                    let mut vault_sel: Option<String> = None;
                    let mut archive = false;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--archive" => {
                                archive = true;
                                i += 1;
                            }
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("item selector is required");
                    };
                    let vault_id = vault_sel.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    if archive {
                        let Some(it) = st.op_items.iter_mut().find(|it| {
                            let v_ok = vault_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                            v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel))
                        }) else {
                            return op_err("item not found");
                        };
                        it.state = "ARCHIVED".into();
                    } else {
                        let before = st.op_items.len();
                        st.op_items.retain(|it| {
                            let v_ok = vault_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                            !(v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel)))
                        });
                        if st.op_items.len() == before {
                            return op_err("item not found");
                        }
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => op_err(&format!("unknown item subcommand \"{sub}\"")),
            }
        }
        "document" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "create" => {
                    let mut src_file: Option<String> = None;
                    let mut title: Option<String> = None;
                    let mut file_name: Option<String> = None;
                    let mut vault_sel: Option<String> = None;
                    let mut tags: Vec<String> = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--title" => {
                                title = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--file-name" => {
                                file_name = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--tags" => {
                                if let Some(v) = args.get(i + 1) {
                                    tags = v.split(',').map(|s| s.trim().to_string()).collect();
                                }
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if src_file.is_none() {
                                    src_file = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let content = match src_file.as_deref() {
                        None | Some("-") => stream_string_to_bytes(stdin),
                        Some(p) => {
                            let resolved = resolve_posix_path(cwd, p);
                            let Ok(b) = fs.read_file(&resolved) else {
                                return op_err(&format!("cannot read \"{p}\""));
                            };
                            b
                        }
                    };
                    let vault = find_or_ensure_vault(st, vault_sel.as_deref()).unwrap_or(OpVault {
                        id: "v-default".into(),
                        name: "Private".into(),
                        description: None,
                        icon: None,
                    });
                    let id = next_op_id(st);
                    let doc_title = title.clone().unwrap_or_else(|| "Untitled".into());
                    let doc_fname = file_name.unwrap_or_else(|| doc_title.clone());
                    let doc = OpDocument {
                        id: id.clone(),
                        title: doc_title.clone(),
                        file_name: doc_fname,
                        vault_id: vault.id.clone(),
                        tags,
                        content,
                    };
                    st.op_docs.push(doc);
                    let out = to_pretty_json(&jval!({
                        "uuid": id,
                        "id": id,
                        "title": doc_title,
                        "vault": { "id": vault.id, "name": vault.name }
                    }));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "list" | "ls" => {
                    let mut vault_sel: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        if args[i] == "--vault" {
                            vault_sel = args.get(i + 1).cloned();
                            i += 2;
                        } else {
                            i += 1;
                        }
                    }
                    let vault_id = vault_sel.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    let arr: Vec<Value> = st
                        .op_docs
                        .iter()
                        .filter(|d| vault_id.as_ref().map(|vid| &d.vault_id == vid).unwrap_or(true))
                        .map(|d| {
                            jval!({
                                "id": d.id,
                                "title": d.title,
                                "fileName": d.file_name,
                                "tags": d.tags.iter().cloned().map(JVal::Str).collect::<Vec<_>>(),
                                "vault": { "id": d.vault_id }
                            })
                        })
                        .collect();
                    let out = to_pretty_json(&JVal::Array(arr));
                    BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let mut sel: Option<String> = None;
                    let mut vault_sel: Option<String> = None;
                    let mut out_file: Option<String> = None;
                    let mut file_mode: Option<u32> = None;
                    let mut force = false;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--vault" => {
                                vault_sel = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--out-file" | "-o" => {
                                out_file = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--file-mode" => {
                                if let Some(m) = args.get(i + 1) {
                                    file_mode = u32::from_str_radix(m.trim_start_matches("0o"), 8).ok();
                                }
                                i += 2;
                            }
                            "--force" | "-f" => {
                                force = true;
                                i += 1;
                            }
                            a if a.starts_with('-') => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("document selector is required");
                    };
                    let vault_id = vault_sel.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    let Some(doc) = st.op_docs.iter().find(|d| {
                        let v_ok = vault_id.as_ref().map(|vid| &d.vault_id == vid).unwrap_or(true);
                        v_ok && (d.id == sel || d.title.eq_ignore_ascii_case(&sel))
                    }) else {
                        return op_err("document not found");
                    };
                    if let Some(of) = out_file {
                        let resolved = resolve_posix_path(cwd, &of);
                        if !force && fs.exists(&resolved) {
                            return op_err("output file already exists");
                        }
                        if let Err(e) = fs.write_file(&resolved, &doc.content) {
                            return op_err(&e);
                        }
                        let _ = fs.chmod(&resolved, file_mode.unwrap_or(0o600));
                        return BuiltinOutcome { stdout: format!("{resolved}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    BuiltinOutcome {
                        stdout: bytes_to_stream_string(&doc.content),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "edit" => {
                    let mut sel: Option<String> = None;
                    let mut src_file: Option<String> = None;
                    let mut new_title: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--title" => {
                                new_title = args.get(i + 1).cloned();
                                i += 2;
                            }
                            "--vault" | "--file-name" | "--format" => i += 2,
                            a if a.starts_with("--") => i += 1,
                            a => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                } else if src_file.is_none() {
                                    src_file = Some(a.to_string());
                                }
                                i += 1;
                            }
                        }
                    }
                    let Some(sel) = sel else {
                        return op_err("document selector is required");
                    };
                    let Some(doc) = st.op_docs.iter_mut().find(|d| d.id == sel || d.title.eq_ignore_ascii_case(&sel)) else {
                        return op_err("document not found");
                    };
                    if let Some(t) = new_title {
                        doc.title = t;
                    }
                    match src_file.as_deref() {
                        None | Some("-") => {
                            doc.content = stream_string_to_bytes(stdin);
                        }
                        Some(p) => {
                            let resolved = resolve_posix_path(cwd, p);
                            if let Ok(b) = fs.read_file(&resolved) {
                                doc.content = b;
                            }
                        }
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "delete" | "rm" => {
                    let sel = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let Some(sel) = sel else {
                        return op_err("document selector is required");
                    };
                    st.op_docs.retain(|d| !(d.id == sel || d.title.eq_ignore_ascii_case(&sel)));
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => op_err(&format!("unknown document subcommand \"{sub}\"")),
            }
        }
        "read" => {
            let mut no_newline = false;
            let mut out_file: Option<String> = None;
            let mut file_mode: Option<u32> = None;
            let mut force = false;
            let mut uri: Option<String> = None;
            let mut i = 1usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-n" | "--no-newline" => {
                        no_newline = true;
                        i += 1;
                    }
                    "-o" | "--out-file" => {
                        out_file = args.get(i + 1).cloned();
                        i += 2;
                    }
                    "--file-mode" => {
                        if let Some(m) = args.get(i + 1) {
                            file_mode = u32::from_str_radix(m.trim_start_matches("0o"), 8).ok();
                        }
                        i += 2;
                    }
                    "-f" | "--force" => {
                        force = true;
                        i += 1;
                    }
                    a if a.starts_with('-') => i += 1,
                    a => {
                        if uri.is_none() {
                            uri = Some(a.to_string());
                        }
                        i += 1;
                    }
                }
            }
            let Some(uri) = uri else {
                return op_err("secret reference is required");
            };
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            drop(map);
            let val = match resolve_op_reference(&st, &uri) {
                Ok(v) => v,
                Err(e) => return op_err(&e),
            };
            let output = if no_newline || out_file.is_some() {
                val
            } else {
                format!("{val}\n")
            };
            if let Some(of) = out_file {
                let resolved = resolve_posix_path(cwd, &of);
                if !force && fs.exists(&resolved) {
                    return op_err("output file already exists");
                }
                if let Err(e) = fs.write_file(&resolved, output.as_bytes()) {
                    return op_err(&e);
                }
                let _ = fs.chmod(&resolved, file_mode.unwrap_or(0o600));
                return BuiltinOutcome { stdout: format!("{resolved}\n"), stderr: String::new(), exit_code: 0 };
            }
            BuiltinOutcome { stdout: output, stderr: String::new(), exit_code: 0 }
        }
        "inject" => {
            let mut in_file: Option<String> = None;
            let mut out_file: Option<String> = None;
            let mut file_mode: Option<u32> = None;
            let mut force = false;
            let mut i = 1usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-i" | "--in-file" => {
                        in_file = args.get(i + 1).cloned();
                        i += 2;
                    }
                    "-o" | "--out-file" => {
                        out_file = args.get(i + 1).cloned();
                        i += 2;
                    }
                    "--file-mode" => {
                        if let Some(m) = args.get(i + 1) {
                            file_mode = u32::from_str_radix(m.trim_start_matches("0o"), 8).ok();
                        }
                        i += 2;
                    }
                    "-f" | "--force" => {
                        force = true;
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let tpl = if let Some(inf) = in_file {
                let resolved = resolve_posix_path(cwd, &inf);
                let Ok(b) = fs.read_file(&resolved) else {
                    return op_err(&format!("cannot read \"{inf}\""));
                };
                String::from_utf8_lossy(&b).to_string()
            } else {
                stdin.to_string()
            };
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            drop(map);
            let mut secrets = Vec::new();
            let rendered = match render_op_inject_template(&tpl, &st, env, &mut secrets) {
                Ok(s) => s,
                Err(e) => return op_err(&e),
            };
            if let Some(of) = out_file {
                let resolved = resolve_posix_path(cwd, &of);
                if !force && fs.exists(&resolved) {
                    return op_err("output file already exists");
                }
                if let Err(e) = fs.write_file(&resolved, rendered.as_bytes()) {
                    return op_err(&e);
                }
                if let Some(mode) = file_mode {
                    let _ = fs.chmod(&resolved, mode);
                }
                return BuiltinOutcome { stdout: format!("{resolved}\n"), stderr: String::new(), exit_code: 0 };
            }
            BuiltinOutcome { stdout: rendered, stderr: String::new(), exit_code: 0 }
        }
        "run" => {
            let mut no_masking = false;
            let mut env_files: Vec<String> = Vec::new();
            let mut i = 1usize;
            let mut cmd_start = None;
            while i < args.len() {
                match args[i].as_str() {
                    "--" => {
                        cmd_start = Some(i + 1);
                        break;
                    }
                    "--no-masking" => {
                        no_masking = true;
                        i += 1;
                    }
                    "--env-file" => {
                        if let Some(ef) = args.get(i + 1) {
                            env_files.push(ef.clone());
                        }
                        i += 2;
                    }
                    a if a.starts_with("--env-file=") => {
                        env_files.push(a["--env-file=".len()..].to_string());
                        i += 1;
                    }
                    a if a.starts_with('-') => i += 1,
                    _ => {
                        cmd_start = Some(i);
                        break;
                    }
                }
            }
            let Some(start) = cmd_start else {
                return op_err("no command specified for op run");
            };
            if start >= args.len() {
                return op_err("no command specified for op run");
            }
            let sub_words = &args[start..];
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            drop(map);

            let mut child_env = env.clone();
            let mut secrets: Vec<String> = Vec::new();

            for ef in &env_files {
                let resolved = resolve_posix_path(cwd, ef);
                let Ok(b) = fs.read_file(&resolved) else {
                    return op_err(&format!("cannot read env-file \"{ef}\""));
                };
                let text = String::from_utf8_lossy(&b);
                for raw_line in text.lines() {
                    let line = raw_line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    let line = line.strip_prefix("export ").unwrap_or(line).trim();
                    if let Some((k, v)) = line.split_once('=') {
                        let key = k.trim().to_string();
                        let mut val = v.trim().to_string();
                        if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                            || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
                        {
                            val = val[1..val.len() - 1].to_string();
                        }
                        child_env.insert(key, val);
                    }
                }
            }

            let snapshot_env = child_env.clone();
            for (_k, val) in child_env.iter_mut() {
                if val.contains("{{") {
                    if let Ok(rendered) = render_op_inject_template(val, &st, &snapshot_env, &mut secrets) {
                        *val = rendered;
                    }
                } else if val.starts_with("op://") {
                    let expanded = expand_env_vars_in_ref(val, &snapshot_env);
                    if let Ok(resolved) = resolve_op_reference(&st, &expanded) {
                        if !resolved.is_empty() && !secrets.contains(&resolved) {
                            secrets.push(resolved.clone());
                        }
                        *val = resolved;
                    }
                }
            }

            let mut out = exec_sub(sub_words, stdin, cwd, &mut child_env);
            if !no_masking {
                for sec in &secrets {
                    if !sec.is_empty() {
                        out.stdout = out.stdout.replace(sec, "<concealed by 1Password>");
                        out.stderr = out.stderr.replace(sec, "<concealed by 1Password>");
                    }
                }
            }
            out
        }
        "environment" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("read");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            if sub == "read" {
                let env_id = args.get(2).cloned().unwrap_or_default();
                let vars = st.op_envs.get(&env_id).cloned().unwrap_or_default();
                let out = to_pretty_json(&JVal::from(vars));
                return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
            }
            if sub == "snapshot" {
                let ssub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                if ssub == "create" {
                    let snap_id = args.get(3).cloned().unwrap_or_else(|| "snap-1".into());
                    let mut var_names = Vec::new();
                    let mut i = 4usize;
                    while i < args.len() {
                        if args[i] == "--vars"
                            && let Some(v) = args.get(i + 1)
                        {
                            var_names = v.split(',').map(|s| s.trim().to_string()).collect();
                            i += 2;
                        } else {
                            i += 1;
                        }
                    }
                    let mut vars_obj = Map::new();
                    for vn in &var_names {
                        if let Some(val) = env.get(vn) {
                            vars_obj.insert(vn.clone(), JVal::Str(val.clone()));
                        }
                    }
                    let snap = jval!({
                        "id": snap_id,
                        "snapshot": {
                            "scope": if var_names.is_empty() { "all" } else { "selected" },
                            "variables": vars_obj
                        }
                    });
                    st.op_snapshots.insert(snap_id, snap.clone());
                    let out = to_pretty_json(&snap);
                    return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                }
                if ssub == "get" {
                    let snap_id = args.get(3).cloned().unwrap_or_default();
                    let Some(snap) = st.op_snapshots.get(&snap_id) else {
                        return op_err("snapshot not found");
                    };
                    let out = to_pretty_json(snap);
                    return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                }
            }
            BuiltinOutcome { stdout: "{}\n".into(), stderr: String::new(), exit_code: 0 }
        }
        "user" | "group" | "connect" | "service-account" | "events-api" | "plugin" => {
            BuiltinOutcome { stdout: if format_json { "[]\n".into() } else { String::new() }, stderr: String::new(), exit_code: 0 }
        }
        "completion" => BuiltinOutcome {
            stdout: "# op completion\n".into(),
            stderr: String::new(),
            exit_code: 0,
        },
        _ => op_err(&format!("unknown command \"{first}\" for \"op\"")),
    }
}

fn gh_err(msg: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("gh: {msg}\n"),
        exit_code: 1,
    }
}

fn filter_json_fields(val: &Value, fields: &[String]) -> Value {
    if fields.is_empty() {
        return val.clone();
    }
    match val {
        Value::Array(arr) => Value::Array(arr.iter().map(|v| filter_json_fields(v, fields)).collect()),
        JVal::Object(entries) => {
            let mut out = Map::new();
            for f in fields {
                if let Some((_, v)) = entries.iter().find(|(k, _)| k == f) {
                    out.insert(f.clone(), v.clone());
                } else {
                    out.insert(f.clone(), Value::Null);
                }
            }
            JVal::Object(out.0)
        }
        _ => val.clone(),
    }
}

fn format_gh_json_output(
    val: &Value,
    json_fields: &[String],
    jq_expr: Option<&str>,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let filtered = filter_json_fields(val, json_fields);
    let serialized = to_pretty_json(&filtered);
    if let Some(expr) = jq_expr {
        let jq_args = vec!["-r".to_string(), expr.to_string()];
        return cmd_jq_with_env(&jq_args, &serialized, cwd, env, fs);
    }
    BuiltinOutcome {
        stdout: format!("{serialized}\n"),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn parse_gh_common_flags(args: &[String]) -> (Option<String>, Option<Vec<String>>, Option<String>) {
    let mut repo = None;
    let mut json_fields = None;
    let mut jq_expr = None;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-R" | "--repo" => {
                repo = args.get(i + 1).cloned();
                i += 2;
            }
            "--json" => {
                if let Some(f) = args.get(i + 1) {
                    json_fields = Some(
                        f.split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect(),
                    );
                }
                i += 2;
            }
            "-q" | "--jq" => {
                jq_expr = args.get(i + 1).cloned();
                i += 2;
            }
            a if a.starts_with("--repo=") => {
                repo = Some(a["--repo=".len()..].to_string());
                i += 1;
            }
            a if a.starts_with("--json=") => {
                json_fields = Some(
                    a["--json=".len()..]
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect(),
                );
                i += 1;
            }
            a if a.starts_with("--jq=") => {
                jq_expr = Some(a["--jq=".len()..].to_string());
                i += 1;
            }
            _ => i += 1,
        }
    }
    (repo, json_fields, jq_expr)
}

fn resolve_gh_repo_key(st: &mut IntegrationState, explicit: Option<&str>, env: &BTreeMap<String, String>) -> String {
    let key = explicit
        .map(|s| s.to_string())
        .or_else(|| env.get("GH_REPO").cloned())
        .or_else(|| st.gh_default_repo.clone())
        .unwrap_or_else(|| "octocat/Hello-World".to_string());
    let normalized = key
        .trim_start_matches("https://github.com/")
        .trim_end_matches(".git")
        .to_string();
    let (owner, name) = normalized.split_once('/').unwrap_or(("octocat", &normalized));
    let full = format!("{owner}/{name}");
    st.gh_repos.entry(full.clone()).or_insert_with(|| GhRepoRecord {
        owner: owner.to_string(),
        name: name.to_string(),
        description: String::new(),
        is_private: false,
        default_branch: "main".into(),
        next_number: 1,
        issues: Vec::new(),
        prs: Vec::new(),
        releases: Vec::new(),
        labels: vec![("bug".into(), "d73a4a".into(), "Something isn't working".into())],
        variables: BTreeMap::new(),
        secrets: Vec::new(),
    });
    full
}

fn cmd_gh(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    if args.is_empty() {
        return BuiltinOutcome {
            stdout: GH_ROOT_HELP.to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let first = args[0].as_str();
    if first == "--version" || first == "version" || first == "-v" {
        return BuiltinOutcome {
            stdout: "gh version 2.67.0 (2026-09-28)\nhttps://github.com/cli/cli/releases/tag/v2.67.0\n".to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if first == "--help" || first == "-h" || first == "help" {
        return BuiltinOutcome {
            stdout: GH_ROOT_HELP.to_string(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if args.iter().any(|a| a == "--help" || a == "-h") {
        let topic = args
            .iter()
            .filter(|a| !a.starts_with('-'))
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        return BuiltinOutcome {
            stdout: format!("Work seamlessly with GitHub from the command line.\n\nUSAGE\n  gh {topic} [flags]\n"),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let fs_id = fs.fs_id();
    let (repo_flag, json_fields, jq_expr) = parse_gh_common_flags(args);

    match first {
        "auth" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("status");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "status" => {
                    if !st.gh_logged_in {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "You are not logged into any GitHub hosts. Run gh auth login to authenticate.\n".into(),
                            exit_code: 1,
                        };
                    }
                    BuiltinOutcome {
                        stdout: format!(
                            "github.com\n  ✓ Logged in to github.com account {} (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_**********************************\n  - Token scopes: 'repo', 'read:org', 'workflow', 'gist', 'admin:public_key', 'admin:gpg_key'\n",
                            st.gh_user
                        ),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "token" => BuiltinOutcome {
                    stdout: format!("{}\n", st.gh_token),
                    stderr: String::new(),
                    exit_code: 0,
                },
                "login" => {
                    st.gh_logged_in = true;
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "logout" => {
                    st.gh_logged_in = false;
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "setup-git" | "switch" | "refresh" => {
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => gh_err(&format!("unknown auth subcommand \"{sub}\"")),
            }
        }
        "config" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" => {
                    let mut out = String::new();
                    for (k, v) in &st.gh_config {
                        out.push_str(&format!("{k}={v}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let key = args.get(2).map(|s| s.as_str()).unwrap_or("");
                    let val = st.gh_config.get(key).cloned().unwrap_or_default();
                    BuiltinOutcome { stdout: format!("{val}\n"), stderr: String::new(), exit_code: 0 }
                }
                "set" => {
                    if let (Some(k), Some(v)) = (args.get(2), args.get(3)) {
                        st.gh_config.insert(k.clone(), v.clone());
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "alias" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" => {
                    let mut out = String::new();
                    for (k, v) in &st.gh_aliases {
                        out.push_str(&format!("{k}: {v}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "set" => {
                    if let (Some(k), Some(v)) = (args.get(2), args.get(3)) {
                        st.gh_aliases.insert(k.clone(), v.clone());
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "delete" => {
                    if let Some(k) = args.get(2) {
                        st.gh_aliases.remove(k);
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "repo" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("view");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" => {
                    let arr: Vec<Value> = st
                        .gh_repos
                        .values()
                        .map(|r| {
                            jval!({
                                "name": r.name,
                                "nameWithOwner": format!("{}/{}", r.owner, r.name),
                                "description": r.description,
                                "isPrivate": r.is_private,
                                "defaultBranchRef": { "name": r.default_branch },
                                "url": format!("https://github.com/{}/{}", r.owner, r.name)
                            })
                        })
                        .collect();
                    let r_list: Vec<(String, String, bool)> = st
                        .gh_repos
                        .values()
                        .map(|r| (format!("{}/{}", r.owner, r.name), r.description.clone(), r.is_private))
                        .collect();
                    drop(map);
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for (full, desc, priv_flag) in r_list {
                        let vis = if priv_flag { "private" } else { "public" };
                        out.push_str(&format!("{full}\t{desc}\t{vis}\t2026-09-28T12:00:00Z\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let pos_repo = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let full = resolve_gh_repo_key(st, pos_repo.as_deref().or(repo_flag.as_deref()), env);
                    let r = st.gh_repos.get(&full).unwrap().clone();
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let obj = jval!({
                            "name": r.name,
                            "nameWithOwner": format!("{}/{}", r.owner, r.name),
                            "description": r.description,
                            "isPrivate": r.is_private,
                            "defaultBranchRef": { "name": r.default_branch },
                            "url": format!("https://github.com/{}/{}", r.owner, r.name)
                        });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!(
                            "{}/{}\n{}\n\n# {}\n\nWelcome to {} on GitHub.\n\nView this repository on GitHub: https://github.com/{}/{}\n",
                            r.owner, r.name, r.description, r.name, r.name, r.owner, r.name
                        ),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "create" => {
                    let name_arg = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "new-repo".into());
                    let is_private = args.iter().any(|a| a == "--private");
                    let mut desc = String::new();
                    for w in args.windows(2) {
                        if w[0] == "-d" || w[0] == "--description" {
                            desc = w[1].clone();
                        }
                    }
                    let (owner, name) = if let Some((o, n)) = name_arg.split_once('/') {
                        (o.to_string(), n.to_string())
                    } else {
                        (st.gh_user.clone(), name_arg)
                    };
                    let full = format!("{owner}/{name}");
                    st.gh_repos.insert(
                        full.clone(),
                        GhRepoRecord {
                            owner,
                            name,
                            description: desc,
                            is_private,
                            default_branch: "main".into(),
                            next_number: 1,
                            issues: Vec::new(),
                            prs: Vec::new(),
                            releases: Vec::new(),
                            labels: vec![
                                ("bug".into(), "d73a4a".into(), "Something isn't working".into()),
                                ("documentation".into(), "0075ca".into(), "Improvements or additions to documentation".into()),
                                ("enhancement".into(), "a2eeef".into(), "New feature or request".into()),
                                ("good first issue".into(), "7057ff".into(), "Good for newcomers".into()),
                                ("help wanted".into(), "008672".into(), "Extra attention is needed".into()),
                            ],
                            variables: BTreeMap::new(),
                            secrets: Vec::new(),
                        },
                    );
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "set-default" => {
                    if let Some(r) = args.get(2) {
                        st.gh_default_repo = Some(r.clone());
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "issue" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            match sub {
                "create" => {
                    let mut title = "Untitled issue".to_string();
                    let mut body = String::new();
                    let mut labels = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" => {
                                if let Some(v) = args.get(i + 1) {
                                    title = v.clone();
                                }
                                i += 2;
                            }
                            "-b" | "--body" => {
                                if let Some(v) = args.get(i + 1) {
                                    body = v.clone();
                                }
                                i += 2;
                            }
                            "-l" | "--label" => {
                                if let Some(v) = args.get(i + 1) {
                                    labels.extend(v.split(',').map(|s| s.trim().to_string()));
                                }
                                i += 2;
                            }
                            _ => i += 1,
                        }
                    }
                    let num = repo.next_number;
                    repo.next_number += 1;
                    repo.issues.push(GhIssueRecord {
                        number: num,
                        title,
                        body,
                        state: "OPEN".into(),
                        labels,
                        comments: Vec::new(),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/issues/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" => {
                    let mut state_filter = "OPEN".to_string();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-s" | "--state" => {
                                if let Some(v) = args.get(i + 1) {
                                    state_filter = v.to_ascii_uppercase();
                                }
                                i += 2;
                            }
                            a if a.starts_with("--state=") => {
                                state_filter = a["--state=".len()..].to_ascii_uppercase();
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let arr: Vec<Value> = repo
                        .issues
                        .iter()
                        .rev()
                        .filter(|iss| state_filter == "ALL" || iss.state.eq_ignore_ascii_case(&state_filter))
                        .map(|iss| {
                            jval!({
                                "number": iss.number,
                                "title": iss.title,
                                "body": iss.body,
                                "state": iss.state,
                                "url": format!("https://github.com/{full}/issues/{}", iss.number),
                                "labels": iss.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>()
                            })
                        })
                        .collect();
                    let rows: Vec<(u64, String, String)> = repo
                        .issues
                        .iter()
                        .rev()
                        .filter(|iss| state_filter == "ALL" || iss.state.eq_ignore_ascii_case(&state_filter))
                        .map(|i| (i.number, i.state.clone(), i.title.clone()))
                        .collect();
                    drop(map);
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for (n, s, t) in rows {
                        out.push_str(&format!("{n}\t{s}\t{t}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(iss) = repo.issues.iter().find(|i| i.number == num).cloned() else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let obj = jval!({
                            "number": iss.number,
                            "title": iss.title,
                            "body": iss.body,
                            "state": iss.state,
                            "url": format!("https://github.com/{full}/issues/{}", iss.number),
                            "labels": iss.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>(),
                            "comments": iss.comments.iter().map(|c| jval!({ "body": c })).collect::<Vec<_>>()
                        });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!("{} #{}\n{}\n\n{}\n", iss.title, iss.number, iss.state, iss.body),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "close" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut title = String::new();
                    if let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) {
                        iss.state = "CLOSED".into();
                        title = iss.title.clone();
                    }
                    BuiltinOutcome { stdout: format!("✓ Closed issue #{num} ({title})\n"), stderr: String::new(), exit_code: 0 }
                }
                "reopen" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut title = String::new();
                    if let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) {
                        iss.state = "OPEN".into();
                        title = iss.title.clone();
                    }
                    BuiltinOutcome { stdout: format!("✓ Reopened issue #{num} ({title})\n"), stderr: String::new(), exit_code: 0 }
                }
                "comment" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut body = String::new();
                    for w in args.windows(2) {
                        if w[0] == "-b" || w[0] == "--body" {
                            body = w[1].clone();
                        }
                    }
                    if let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) {
                        iss.comments.push(body);
                    }
                    BuiltinOutcome { stdout: format!("https://github.com/{full}/issues/{num}#issuecomment-1\n"), stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" => {
                                if let Some(v) = args.get(i + 1) {
                                    iss.title = v.clone();
                                }
                                i += 2;
                            }
                            "-b" | "--body" => {
                                if let Some(v) = args.get(i + 1) {
                                    iss.body = v.clone();
                                }
                                i += 2;
                            }
                            "--add-label" => {
                                if let Some(v) = args.get(i + 1) {
                                    for lbl in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        if !iss.labels.iter().any(|l| l.eq_ignore_ascii_case(lbl)) {
                                            iss.labels.push(lbl.to_string());
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--remove-label" => {
                                if let Some(v) = args.get(i + 1) {
                                    for lbl in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        iss.labels.retain(|l| !l.eq_ignore_ascii_case(lbl));
                                    }
                                }
                                i += 2;
                            }
                            _ => i += 1,
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/issues/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    repo.issues.retain(|i| i.number != num);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted issue #{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "pr" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            match sub {
                "create" => {
                    let mut title = "Pull request".to_string();
                    let mut body = String::new();
                    let mut head = "feat".to_string();
                    let mut base = repo.default_branch.clone();
                    let mut is_draft = false;
                    let mut labels = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" => {
                                if let Some(v) = args.get(i + 1) {
                                    title = v.clone();
                                }
                                i += 2;
                            }
                            "-b" | "--body" => {
                                if let Some(v) = args.get(i + 1) {
                                    body = v.clone();
                                }
                                i += 2;
                            }
                            "-H" | "--head" => {
                                if let Some(v) = args.get(i + 1) {
                                    head = v.clone();
                                }
                                i += 2;
                            }
                            "-B" | "--base" => {
                                if let Some(v) = args.get(i + 1) {
                                    base = v.clone();
                                }
                                i += 2;
                            }
                            "-d" | "--draft" => {
                                is_draft = true;
                                i += 1;
                            }
                            "-l" | "--label" => {
                                if let Some(v) = args.get(i + 1) {
                                    labels.extend(v.split(',').map(|s| s.trim().to_string()));
                                }
                                i += 2;
                            }
                            _ => i += 1,
                        }
                    }
                    let num = repo.next_number;
                    repo.next_number += 1;
                    repo.prs.push(GhPrRecord {
                        number: num,
                        title,
                        body,
                        state: "OPEN".into(),
                        head,
                        base,
                        is_draft,
                        labels,
                        comments: Vec::new(),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/pull/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" => {
                    let mut state_filter = "OPEN".to_string();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-s" | "--state" => {
                                if let Some(v) = args.get(i + 1) {
                                    state_filter = v.to_ascii_uppercase();
                                }
                                i += 2;
                            }
                            a if a.starts_with("--state=") => {
                                state_filter = a["--state=".len()..].to_ascii_uppercase();
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let arr: Vec<Value> = repo
                        .prs
                        .iter()
                        .rev()
                        .filter(|pr| {
                            state_filter == "ALL"
                                || pr.state.eq_ignore_ascii_case(&state_filter)
                                || (state_filter == "CLOSED" && pr.state.eq_ignore_ascii_case("MERGED"))
                        })
                        .map(|pr| {
                            jval!({
                                "number": pr.number,
                                "title": pr.title,
                                "body": pr.body,
                                "state": pr.state,
                                "closed": pr.state != "OPEN",
                                "merged": pr.state == "MERGED",
                                "headRefName": pr.head,
                                "baseRefName": pr.base,
                                "isDraft": pr.is_draft,
                                "labels": pr.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>(),
                                "comments": pr.comments.iter().map(|c| jval!({ "body": c })).collect::<Vec<_>>(),
                                "url": format!("https://github.com/{full}/pull/{}", pr.number)
                            })
                        })
                        .collect();
                    let rows: Vec<(u64, String, String, String)> = repo
                        .prs
                        .iter()
                        .rev()
                        .filter(|pr| {
                            state_filter == "ALL"
                                || pr.state.eq_ignore_ascii_case(&state_filter)
                                || (state_filter == "CLOSED" && pr.state.eq_ignore_ascii_case("MERGED"))
                        })
                        .map(|p| (p.number, p.title.clone(), p.head.clone(), p.state.clone()))
                        .collect();
                    drop(map);
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for (n, t, h, s) in rows {
                        out.push_str(&format!("{n}\t{t}\t{h}\t{s}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(pr) = repo.prs.iter().find(|p| p.number == num).cloned() else {
                        return gh_err(&format!("pull request #{num} not found"));
                    };
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let obj = jval!({
                            "number": pr.number,
                            "title": pr.title,
                            "body": pr.body,
                            "state": pr.state,
                            "closed": pr.state != "OPEN",
                            "merged": pr.state == "MERGED",
                            "headRefName": pr.head,
                            "baseRefName": pr.base,
                            "isDraft": pr.is_draft,
                            "labels": pr.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>(),
                            "comments": pr.comments.iter().map(|c| jval!({ "body": c })).collect::<Vec<_>>(),
                            "url": format!("https://github.com/{full}/pull/{}", pr.number)
                        });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!("{} #{}\n{}\n\n{}\n", pr.title, pr.number, pr.state, pr.body),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "merge" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let method = if args.iter().any(|a| a == "-s" || a == "--squash") {
                        "squash"
                    } else if args.iter().any(|a| a == "-r" || a == "--rebase") {
                        "rebase"
                    } else {
                        "merge"
                    };
                    let delete_branch = args.iter().any(|a| a == "-d" || a == "--delete-branch");
                    let mut title = String::new();
                    let mut head = String::new();
                    if let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) {
                        if pr.is_draft && !args.iter().any(|a| a == "--admin") {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("Pull request #{num} is a draft and cannot be merged; mark it ready with 'gh pr ready'\n"),
                                exit_code: 1,
                            };
                        }
                        pr.state = "MERGED".into();
                        pr.is_draft = false;
                        title = pr.title.clone();
                        head = pr.head.clone();
                    }
                    let suffix = if delete_branch { format!(" and deleted branch {head}") } else { String::new() };
                    BuiltinOutcome { stdout: format!("✓ Merged pull request #{num} ({title}) via {method}{suffix}\n"), stderr: String::new(), exit_code: 0 }
                }
                "close" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut title = String::new();
                    if let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) {
                        pr.state = "CLOSED".into();
                        title = pr.title.clone();
                    }
                    BuiltinOutcome { stdout: format!("✓ Closed pull request #{num} ({title})\n"), stderr: String::new(), exit_code: 0 }
                }
                "reopen" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut title = String::new();
                    if let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) {
                        pr.state = "OPEN".into();
                        title = pr.title.clone();
                    }
                    BuiltinOutcome { stdout: format!("✓ Reopened pull request #{num} ({title})\n"), stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) else {
                        return gh_err(&format!("pull request #{num} not found"));
                    };
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" => {
                                if let Some(v) = args.get(i + 1) {
                                    pr.title = v.clone();
                                }
                                i += 2;
                            }
                            "-b" | "--body" => {
                                if let Some(v) = args.get(i + 1) {
                                    pr.body = v.clone();
                                }
                                i += 2;
                            }
                            "-B" | "--base" => {
                                if let Some(v) = args.get(i + 1) {
                                    pr.base = v.clone();
                                }
                                i += 2;
                            }
                            "--add-label" => {
                                if let Some(v) = args.get(i + 1) {
                                    for lbl in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        if !pr.labels.iter().any(|l| l.eq_ignore_ascii_case(lbl)) {
                                            pr.labels.push(lbl.to_string());
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--remove-label" => {
                                if let Some(v) = args.get(i + 1) {
                                    for lbl in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        pr.labels.retain(|l| !l.eq_ignore_ascii_case(lbl));
                                    }
                                }
                                i += 2;
                            }
                            _ => i += 1,
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/pull/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "ready" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let undo = args.iter().any(|a| a == "--undo");
                    if let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) {
                        pr.is_draft = undo;
                    }
                    let msg = if undo {
                        format!("✓ Pull request #{num} is converted to \"draft\"\n")
                    } else {
                        format!("✓ Pull request #{num} is marked as \"ready for review\"\n")
                    };
                    BuiltinOutcome { stdout: msg, stderr: String::new(), exit_code: 0 }
                }
                "review" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let verb = if args.iter().any(|a| a == "-a" || a == "--approve") {
                        "Approved"
                    } else if args.iter().any(|a| a == "-r" || a == "--request-changes") {
                        "Requested changes on"
                    } else {
                        "Reviewed"
                    };
                    BuiltinOutcome { stdout: format!("✓ {verb} pull request #{num}\n"), stderr: String::new(), exit_code: 0 }
                }
                "comment" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let mut body = String::new();
                    for w in args.windows(2) {
                        if w[0] == "-b" || w[0] == "--body" {
                            body = w[1].clone();
                        }
                    }
                    if let Some(pr) = repo.prs.iter_mut().find(|p| p.number == num) {
                        pr.comments.push(body);
                    }
                    BuiltinOutcome { stdout: format!("https://github.com/{full}/pull/{num}#issuecomment-1\n"), stderr: String::new(), exit_code: 0 }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "release" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            match sub {
                "create" => {
                    let tag = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "v1.0.0".into());
                    let mut title = tag.clone();
                    let mut notes = String::new();
                    for w in args.windows(2) {
                        if w[0] == "-t" || w[0] == "--title" {
                            title = w[1].clone();
                        } else if w[0] == "-n" || w[0] == "--notes" {
                            notes = w[1].clone();
                        }
                    }
                    repo.releases.push(GhReleaseRecord {
                        tag_name: tag.clone(),
                        name: title,
                        body: notes,
                        is_draft: args.iter().any(|a| a == "-d" || a == "--draft"),
                        is_prerelease: args.iter().any(|a| a == "-p" || a == "--prerelease"),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/releases/tag/{tag}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" => {
                    let arr: Vec<Value> = repo
                        .releases
                        .iter()
                        .map(|rel| jval!({ "tagName": rel.tag_name, "name": rel.name, "isDraft": rel.is_draft, "isPrerelease": rel.is_prerelease }))
                        .collect();
                    let rows: Vec<(String, String)> = repo.releases.iter().map(|r| (r.name.clone(), r.tag_name.clone())).collect();
                    drop(map);
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for (n, t) in rows {
                        out.push_str(&format!("{n}\tLatest\t{t}\t2026-09-28T12:00:00Z\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let tag = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let Some(rel) = (if let Some(t) = tag {
                        repo.releases.iter().find(|r| r.tag_name == t).cloned()
                    } else {
                        repo.releases.last().cloned()
                    }) else {
                        return gh_err("release not found");
                    };
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let obj = jval!({ "tagName": rel.tag_name, "name": rel.name, "body": rel.body, "isDraft": rel.is_draft, "isPrerelease": rel.is_prerelease });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!("{}\n{}\n\n{}\n", rel.tag_name, rel.name, rel.body),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let tag = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    repo.releases.retain(|r| r.tag_name != tag);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted release {tag}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "api" => {
            let endpoint = args
                .iter()
                .skip(1)
                .find(|a| !a.starts_with('-'))
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_else(|| "user".into());
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            drop(map);
            let payload = if endpoint == "user" {
                jval!({
                    "login": st.gh_user,
                    "id": 1,
                    "name": "The Octocat",
                    "email": "octocat@github.com",
                    "bio": "GitHub mascot",
                    "company": "@github",
                    "type": "User"
                })
            } else if let Some(rest) = endpoint.strip_prefix("repos/") {
                let parts: Vec<&str> = rest.split('/').collect();
                if parts.len() >= 2 {
                    let full = format!("{}/{}", parts[0], parts[1]);
                    if let Some(r) = st.gh_repos.get(&full) {
                        if parts.get(2) == Some(&"issues") {
                            Value::Array(
                                r.issues
                                    .iter()
                                    .map(|i| jval!({ "number": i.number, "title": i.title, "state": i.state.to_ascii_lowercase() }))
                                    .collect(),
                            )
                        } else if parts.get(2) == Some(&"pulls") {
                            Value::Array(
                                r.prs
                                    .iter()
                                    .map(|p| jval!({ "number": p.number, "title": p.title, "state": p.state.to_ascii_lowercase() }))
                                    .collect(),
                            )
                        } else if parts.get(2) == Some(&"releases") {
                            Value::Array(
                                r.releases
                                    .iter()
                                    .map(|rel| jval!({
                                        "tagName": rel.tag_name,
                                        "tag_name": rel.tag_name,
                                        "name": rel.name,
                                        "body": rel.body,
                                        "isDraft": rel.is_draft,
                                        "isPrerelease": rel.is_prerelease
                                    }))
                                    .collect(),
                            )
                        } else {
                            jval!({
                                "id": 100,
                                "name": r.name,
                                "full_name": full,
                                "private": r.is_private,
                                "description": r.description,
                                "default_branch": r.default_branch,
                                "owner": { "login": r.owner }
                            })
                        }
                    } else {
                        jval!({})
                    }
                } else {
                    jval!({})
                }
            } else {
                jval!({ "data": {} })
            };
            format_gh_json_output(&payload, &[], jq_expr.as_deref(), cwd, env, fs)
        }
        "label" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            if sub == "create" {
                let name = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "label".into());
                let force = args.iter().skip(2).any(|a| a == "-f" || a == "--force");
                if !force && repo.labels.iter().any(|(n, _, _)| n.eq_ignore_ascii_case(&name)) {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("label \"{name}\" already exists; use --force to update\n"),
                        exit_code: 1,
                    };
                }
                let mut color = "ededed".to_string();
                let mut desc = String::new();
                for w in args.windows(2) {
                    if w[0] == "-c" || w[0] == "--color" {
                        color = w[1].trim_start_matches('#').to_string();
                    } else if w[0] == "-d" || w[0] == "--description" {
                        desc = w[1].clone();
                    }
                }
                repo.labels.retain(|(n, _, _)| !n.eq_ignore_ascii_case(&name));
                repo.labels.push((name, color, desc));
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            if sub == "delete" {
                if let Some(name) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned() {
                    repo.labels.retain(|(n, _, _)| !n.eq_ignore_ascii_case(&name));
                }
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            let arr: Vec<Value> = repo.labels.iter().map(|(n, c, d)| jval!({ "name": n, "color": c, "description": d })).collect();
            drop(map);
            if let Some(fields) = &json_fields {
                return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
            }
            BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
        }
        "variable" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            if sub == "set"
                && let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned()
            {
                let mut body_val: Option<String> = None;
                for w in args.windows(2) {
                    if w[0] == "-b" || w[0] == "--body" {
                        body_val = Some(w[1].clone());
                    }
                }
                let val = body_val.unwrap_or_else(|| stdin.trim().to_string());
                repo.variables.insert(k, val);
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            if sub == "get" {
                let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned() else {
                    return gh_err("variable name is required");
                };
                let Some(val) = repo.variables.get(&k).cloned() else {
                    return gh_err(&format!("variable {k} was not found"));
                };
                drop(map);
                if let Some(fields) = &json_fields {
                    let obj = jval!({ "name": k, "value": val });
                    return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                }
                return BuiltinOutcome {
                    stdout: format!("{val}\n"),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            if sub == "delete" || sub == "remove" {
                if let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned() {
                    repo.variables.remove(&k);
                }
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            let arr: Vec<Value> = repo.variables.iter().map(|(k, v)| jval!({ "name": k, "value": v })).collect();
            drop(map);
            if let Some(fields) = &json_fields {
                return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
            }
            BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
        }
        "secret" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            if sub == "set"
                && let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned()
            {
                if !repo.secrets.contains(&k) {
                    repo.secrets.push(k);
                }
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            if sub == "delete" || sub == "remove" {
                if let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned() {
                    repo.secrets.retain(|s| s != &k);
                }
                return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
            }
            let arr: Vec<Value> = repo.secrets.iter().map(|s| jval!({ "name": s })).collect();
            drop(map);
            if let Some(fields) = &json_fields {
                return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
            }
            BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
        }
        "workflow" | "run" | "gist" | "search" | "status"
        | "completion" | "browse" | "ssh-key" | "gpg-key" | "cache" | "org" | "project"
        | "ruleset" | "extension" | "codespace" | "attestation" => {
            if let Some(fields) = &json_fields {
                return format_gh_json_output(&Value::Array(Vec::new()), fields, jq_expr.as_deref(), cwd, env, fs);
            }
            BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
        }
        _ => gh_err(&format!("unknown command \"{first}\" for \"gh\"")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn dummy_exec(
        words: &[String],
        _stdin: &str,
        _cwd: &mut String,
        env: &mut BTreeMap<String, String>,
    ) -> BuiltinOutcome {
        if words.first().map(|s| s.as_str()) == Some("printenv") {
            let mut out = String::new();
            for k in &words[1..] {
                if let Some(v) = env.get(k) {
                    out.push_str(&format!("{v}\n"));
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            };
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    #[test]
    fn op_vault_item_inject_and_run_masking_unit_suite() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let mut env = BTreeMap::new();
        env.insert("VAULT_NAME".into(), "SecOps".into());
        let mut cwd = "/work".to_string();
        let mut exec = dummy_exec;

        // Invalid icon rejected
        let bad = cmd_op(
            &args(&["vault", "create", "Bad", "--icon", "invalid-icon-name"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(bad.exit_code, 1);
        assert!(bad.stderr.contains("Invalid vault icon"));

        // Valid vault + item + file attachment
        vfs.write_file("/work/cert.pem", b"CERT-DATA-123").unwrap();
        let v_ok = cmd_op(
            &args(&["vault", "create", "SecOps", "--icon", "vault-door"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(v_ok.exit_code, 0);

        let it_ok = cmd_op(
            &args(&[
                "item",
                "create",
                "--category",
                "login",
                "--title",
                "DbCred",
                "--vault",
                "SecOps",
                "username=admin",
                "password=super_secret_pw",
                "tls[file]=/work/cert.pem",
            ]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(it_ok.exit_code, 0);

        // Read field and file attachment
        let r_pw = cmd_op(
            &args(&["read", "op://SecOps/DbCred/password"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r_pw.stdout.trim(), "super_secret_pw");
        let r_file = cmd_op(
            &args(&["read", "op://SecOps/DbCred/tls"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r_file.stdout.trim(), "CERT-DATA-123");

        // Inject with env var and quoted literal braces
        let inj = cmd_op(
            &args(&["inject"]),
            "pw={{ op://$VAULT_NAME/DbCred/password }} lit={{ \"{{escaped}}\" }}\n",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(inj.exit_code, 0);
        assert_eq!(inj.stdout, "pw=super_secret_pw lit={{escaped}}\n");

        // op run masking vs --no-masking
        env.insert("DB_PASS".into(), "op://SecOps/DbCred/password".into());
        let masked = cmd_op(
            &args(&["run", "--", "printenv", "DB_PASS"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(masked.stdout.trim(), "<concealed by 1Password>");

        let unmasked = cmd_op(
            &args(&["run", "--no-masking", "--", "printenv", "DB_PASS"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(unmasked.stdout.trim(), "super_secret_pw");
    }

    #[test]
    fn gh_repo_issue_pr_release_and_state_filtering_unit_suite() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();

        assert_eq!(
            cmd_gh(&args(&["repo", "create", "acme/core"]), "", "/", &mut env, &vfs).exit_code,
            0
        );
        cmd_gh(
            &args(&["issue", "create", "-R", "acme/core", "-t", "Bug 1"]),
            "",
            "/",
            &mut env,
            &vfs,
        );
        cmd_gh(
            &args(&["issue", "create", "-R", "acme/core", "-t", "Bug 2"]),
            "",
            "/",
            &mut env,
            &vfs,
        );
        cmd_gh(
            &args(&["issue", "close", "1", "-R", "acme/core"]),
            "",
            "/",
            &mut env,
            &vfs,
        );

        let open_only = cmd_gh(
            &args(&["issue", "list", "-R", "acme/core", "--json", "number"]),
            "",
            "/",
            &mut env,
            &vfs,
        );
        assert!(open_only.stdout.contains("2") && !open_only.stdout.contains("1"));

        let all_issues = cmd_gh(
            &args(&[
                "issue", "list", "-R", "acme/core", "--state", "all", "--json", "number",
            ]),
            "",
            "/",
            &mut env,
            &vfs,
        );
        assert!(all_issues.stdout.contains("1") && all_issues.stdout.contains("2"));
    }


    #[test]
    fn unit_op_document_template_and_escaped_file_field_suite() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/ca.pem", b"CERT-DATA").unwrap();
        let mut env = BTreeMap::new();
        let mut cwd = "/work".to_string();
        let mut exec = dummy_exec;

        assert_eq!(
            cmd_op(&args(&["vault", "create", "Certs"]), "", &mut cwd, &mut env, &vfs, &mut exec).exit_code,
            0
        );
        assert_eq!(
            cmd_op(
                &args(&[
                    "item",
                    "create",
                    "--vault",
                    "Certs",
                    "--category",
                    "login",
                    "--title",
                    "TLS",
                    "ca\\.pem[file]=/work/ca.pem",
                    "tls.leaf[file]=/work/ca.pem",
                ]),
                "",
                &mut cwd,
                &mut env,
                &vfs,
                &mut exec,
            )
            .exit_code,
            0
        );
        let r1 = cmd_op(
            &args(&["read", "op://Certs/TLS/ca.pem"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r1.exit_code, 0);
        assert_eq!(r1.stdout, "CERT-DATA\n");

        let r2 = cmd_op(
            &args(&["read", "op://Certs/TLS/tls/leaf"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r2.exit_code, 0);
        assert_eq!(r2.stdout, "CERT-DATA\n");

        let tpl_err = cmd_op(
            &args(&["item", "template", "get", "InvalidCategory"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_ne!(tpl_err.exit_code, 0);

        let esc_ok = cmd_op(
            &args(&[
                "item",
                "edit",
                "TLS",
                "--vault",
                "Certs",
                r"Docs\.Private.api\.key=secret_dot_val",
                r"Docs\.Private.api\=key=secret_eq_val",
            ]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(esc_ok.exit_code, 0, "{}", esc_ok.stderr);
        let r_dot = cmd_op(
            &args(&["read", "op://Certs/TLS/Docs.Private/api.key"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r_dot.exit_code, 0, "{}", r_dot.stderr);
        assert_eq!(r_dot.stdout, "secret_dot_val
");
        let r_eq_unsupported = cmd_op(
            &args(&["read", "op://Certs/TLS/Docs.Private/api=key"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_eq!(r_eq_unsupported.exit_code, 1);
        assert!(r_eq_unsupported
            .stderr
            .contains("Invalid secret reference path; use IDs for unsupported names"));

        let esc_bad = cmd_op(
            &args(&["item", "edit", "TLS", "--vault", "Certs", r"bad\q=val"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut exec,
        );
        assert_ne!(esc_bad.exit_code, 0);
        assert!(esc_bad.stderr.contains("Invalid field name escape"));
    }

    #[test]
    fn unit_gh_workflow_secret_variable_label_and_api_suite() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let mut env = BTreeMap::new();
        let mut cwd = "/work".to_string();

        assert_eq!(
            cmd_gh(&args(&["repo", "create", "acme/app"]), "", &mut cwd, &mut env, &vfs).exit_code,
            0
        );
        assert_eq!(
            cmd_gh(
                &args(&["variable", "set", "DEPLOY_ENV", "-b", "staging", "-R", "acme/app"]),
                "",
                &mut cwd,
                &mut env,
                &vfs,
            )
            .exit_code,
            0
        );
        let v_get = cmd_gh(
            &args(&["variable", "get", "DEPLOY_ENV", "-R", "acme/app"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
        );
        assert_eq!(v_get.stdout.trim(), "staging");

        assert_eq!(
            cmd_gh(
                &args(&["label", "create", "p0", "-c", "ff0000", "-R", "acme/app"]),
                "",
                &mut cwd,
                &mut env,
                &vfs,
            )
            .exit_code,
            0
        );
        let lbls = cmd_gh(
            &args(&["label", "list", "-R", "acme/app", "--json", "name"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
        );
        assert!(lbls.stdout.contains("\"p0\""));
    }

    #[test]
    fn unit_op_vault_document_template_and_gh_release_workflow() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let mut noop = |_: &[String], _: &str, _: &mut String, _: &mut BTreeMap<String, String>| -> BuiltinOutcome {
            unreachable!()
        };
        let v_create = cmd_op(
            &args(&["vault", "create", "SecOps", "--format", "json"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(v_create.exit_code, 0);
        assert!(v_create.stdout.contains("SecOps"));

        let doc_create = cmd_op(
            &args(&["document", "create", "--title", "CertPem", "--vault", "SecOps", "--format", "json"]),
            "-----BEGIN CERT-----\nMIIB\n-----END CERT-----\n",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(doc_create.exit_code, 0);

        let doc_get = cmd_op(
            &args(&["document", "get", "CertPem", "--vault", "SecOps"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(doc_get.exit_code, 0);
        assert!(doc_get.stdout.contains("BEGIN CERT"));

        assert_eq!(
            cmd_gh(
                &args(&["repo", "create", "acme/rel-repo", "--public"]),
                "",
                &mut cwd,
                &mut env,
                &vfs,
            )
            .exit_code,
            0
        );
        assert_eq!(
            cmd_gh(
                &args(&["release", "create", "v2.0.0", "-R", "acme/rel-repo", "-t", "Release 2.0", "-n", "Notes"]),
                "",
                &mut cwd,
                &mut env,
                &vfs,
            )
            .exit_code,
            0
        );
        let rel_view = cmd_gh(
            &args(&["release", "view", "v2.0.0", "-R", "acme/rel-repo", "--json", "tagName,name,body"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
        );
        assert_eq!(rel_view.exit_code, 0);
        assert!(rel_view.stdout.contains("v2.0.0") && rel_view.stdout.contains("Release 2.0"));
    }

}
