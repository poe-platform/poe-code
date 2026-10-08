use crate::commands::structured::{JVal, cmd_jq_with_env, parse_json_stream};
use crate::commands::archive::{base64_decode, base64_encode, sha1_bytes, sha256_bytes};
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
    assignees: Vec<String>,
    is_pinned: bool,
    comments: Vec<String>,
    linked_branches: Vec<String>,
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
    assignees: Vec<String>,
    reviewers: Vec<String>,
    comments: Vec<String>,
}

#[derive(Clone, Debug)]
struct GhReleaseRecord {
    tag_name: String,
    name: String,
    body: String,
    is_draft: bool,
    is_prerelease: bool,
    assets: Vec<(String, usize, String, Vec<u8>)>,
}

#[derive(Clone, Debug)]
struct GhDeployKeyRecord {
    id: u64,
    title: String,
    key: String,
    read_only: bool,
    created_at: String,
}

#[derive(Clone, Debug)]
struct GhAutolinkRecord {
    id: u64,
    key_prefix: String,
    url_template: String,
    is_alphanumeric: bool,
}

#[derive(Clone, Debug)]
struct OpGroupRecord {
    id: String,
    name: String,
    description: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
struct OpVaultGroupGrant {
    id: String,
    vault_id: String,
    group_id: String,
    permissions: Vec<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
struct GhProjectRecord {
    number: u64,
    id: String,
    title: String,
    short_description: String,
    readme: String,
    is_public: bool,
    closed: bool,
    is_template: bool,
    owner: String,
    url: String,
    fields: Vec<(String, String, String)>,
    items: Vec<(String, String, String, String, Option<String>)>,
    linked_repos: Vec<String>,
}

#[derive(Clone, Debug)]
struct GhCodespaceRecord {
    name: String,
    display_name: String,
    repository: String,
    branch: String,
    state: String,
    machine_name: String,
    created_at: String,
}

fn expand_vault_permissions(perms: &[String]) -> Result<Vec<String>, String> {
    let mut expanded = Vec::new();
    let mut add = |p: &str| {
        if !expanded.iter().any(|x| x == p) {
            expanded.push(p.to_string());
        }
    };
    for p in perms {
        match p.as_str() {
            "allow_viewing" => {
                add("view_items");
                add("view_and_copy_passwords");
                add("view_item_history");
            }
            "allow_editing" => {
                for g in [
                    "create_items",
                    "edit_items",
                    "archive_items",
                    "delete_items",
                    "import_items",
                    "export_items",
                    "copy_and_share_items",
                    "print_items",
                ] {
                    add(g);
                }
            }
            "allow_managing" => add("manage_vault"),
            "view_items"
            | "create_items"
            | "view_and_copy_passwords"
            | "edit_items"
            | "archive_items"
            | "delete_items"
            | "view_item_history"
            | "import_items"
            | "export_items"
            | "copy_and_share_items"
            | "print_items"
            | "manage_vault"
            | "move_items" => add(p),
            _ => return Err("Invalid vault permission".into()),
        }
    }
    let move_reqs = [
        "view_items",
        "edit_items",
        "archive_items",
        "view_and_copy_passwords",
        "view_item_history",
        "copy_and_share_items",
    ];
    if move_reqs.iter().all(|r| expanded.iter().any(|x| x == r)) {
        if !expanded.iter().any(|x| x == "move_items") {
            expanded.push("move_items".to_string());
        }
    }
    Ok(expanded)
}

fn change_vault_permissions(
    current: &[String],
    requested: &[String],
    is_grant: bool,
) -> Result<Vec<String>, String> {
    if is_grant && requested.is_empty() {
        return Err("Vault permissions are required".into());
    }
    if !is_grant && requested.is_empty() {
        return Ok(Vec::new());
    }
    if requested.iter().any(|p| p == "move_items") {
        return Err("move_items is derived from its underlying vault permissions".into());
    }
    let existing: Vec<String> = expand_vault_permissions(current)?
        .into_iter()
        .filter(|p| p != "move_items")
        .collect();
    let selected: Vec<String> = expand_vault_permissions(requested)?
        .into_iter()
        .filter(|p| p != "move_items")
        .collect();
    let mut remaining = Vec::new();
    if is_grant {
        for p in existing.into_iter().chain(selected.into_iter()) {
            if !remaining.contains(&p) {
                remaining.push(p);
            }
        }
    } else {
        for p in existing {
            if !selected.contains(&p) {
                remaining.push(p);
            }
        }
    }
    let prereqs: &[(&str, &[&str])] = &[
        ("view_items", &[]),
        ("create_items", &["view_items"]),
        ("view_and_copy_passwords", &["view_items"]),
        ("edit_items", &["view_and_copy_passwords", "view_items"]),
        ("archive_items", &["edit_items", "view_and_copy_passwords", "view_items"]),
        ("delete_items", &["edit_items", "view_and_copy_passwords", "view_items"]),
        ("view_item_history", &["view_and_copy_passwords", "view_items"]),
        ("import_items", &["create_items", "view_items"]),
        ("export_items", &["view_item_history", "view_and_copy_passwords", "view_items"]),
        ("copy_and_share_items", &["view_item_history", "view_and_copy_passwords", "view_items"]),
        ("print_items", &["view_item_history", "view_and_copy_passwords", "view_items"]),
        ("manage_vault", &[]),
    ];
    let mut missing = Vec::new();
    let mut dependent = Vec::new();
    for p in &remaining {
        if let Some((_, reqs)) = prereqs.iter().find(|(k, _)| k == p) {
            for req in *reqs {
                if !remaining.iter().any(|x| x == req) {
                    if !missing.contains(&req.to_string()) {
                        missing.push(req.to_string());
                    }
                    if !dependent.contains(p) {
                        dependent.push(p.clone());
                    }
                }
            }
        }
    }
    if !missing.is_empty() {
        missing.sort();
        dependent.sort();
        return if is_grant {
            Err(format!(
                "Required vault permissions must be granted explicitly: {}",
                missing.join(", ")
            ))
        } else {
            Err(format!(
                "Dependent vault permissions must also be revoked: {}",
                dependent.join(", ")
            ))
        };
    }
    expand_vault_permissions(&remaining)
}

#[derive(Clone, Debug)]
struct GhGistFileRecord {
    filename: String,
    content: String,
    size: usize,
}

#[derive(Clone, Debug)]
struct GhGistRecord {
    id: String,
    description: String,
    is_public: bool,
    owner_login: String,
    files: Vec<GhGistFileRecord>,
    html_url: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug)]
struct GhCacheRecord {
    id: u64,
    key: String,
    version: String,
    ref_name: String,
    size_in_bytes: u64,
    created_at: String,
    last_accessed_at: String,
}

#[derive(Clone, Debug)]
struct GhSshKeyRecord {
    id: u64,
    title: String,
    key: String,
    key_type: String,
    created_at: String,
}

#[derive(Clone, Debug)]
struct GhGpgKeyRecord {
    id: u64,
    key_id: String,
    name: String,
    raw_key: String,
    email: String,
    created_at: String,
}

#[derive(Clone, Debug)]
struct GhWorkflowRecord {
    id: u64,
    name: String,
    path: String,
    state: String,
    content: String,
}

#[derive(Clone, Debug)]
struct GhWorkflowRunRecord {
    database_id: u64,
    name: String,
    display_title: String,
    workflow_name: String,
    workflow_database_id: u64,
    head_branch: String,
    event: String,
    status: String,
    conclusion: String,
    attempt: u64,
    url: String,
    actor_login: String,
    job_id: u64,
    job_log: String,
}

fn default_gh_workflows() -> Vec<GhWorkflowRecord> {
    vec![GhWorkflowRecord {
        id: 1,
        name: "CI".into(),
        path: ".github/workflows/ci.yml".into(),
        state: "active".into(),
        content: "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n".into(),
    }]
}

#[derive(Clone, Debug)]
struct GhRepoRecord {
    owner: String,
    name: String,
    description: String,
    homepage_url: String,
    visibility: String,
    is_private: bool,
    is_archived: bool,
    is_template: bool,
    has_issues_enabled: bool,
    has_wiki_enabled: bool,
    has_projects_enabled: bool,
    has_discussions_enabled: bool,
    merge_commit_allowed: bool,
    squash_merge_allowed: bool,
    rebase_merge_allowed: bool,
    auto_merge_allowed: bool,
    delete_branch_on_merge: bool,
    topics: Vec<String>,
    default_branch: String,
    next_number: u64,
    issues: Vec<GhIssueRecord>,
    prs: Vec<GhPrRecord>,
    releases: Vec<GhReleaseRecord>,
    labels: Vec<(String, String, String)>,
    variables: BTreeMap<String, String>,
    secrets: Vec<String>,
    workflows: Vec<GhWorkflowRecord>,
    workflow_runs: Vec<GhWorkflowRunRecord>,
    caches: Vec<GhCacheRecord>,
    deploy_keys: Vec<GhDeployKeyRecord>,
    autolinks: Vec<GhAutolinkRecord>,
}

#[derive(Clone, Debug)]
struct GhHostAuthEntry {
    user: String,
    oauth_token: String,
    git_protocol: String,
    scopes: Vec<String>,
    active: bool,
}

#[derive(Clone, Debug)]
struct IntegrationState {
    op_seq: u64,
    op_default_vault: Option<String>,
    op_vaults: Vec<OpVault>,
    op_groups: Vec<OpGroupRecord>,
    op_vault_groups: Vec<OpVaultGroupGrant>,
    op_items: Vec<OpItem>,
    op_docs: Vec<OpDocument>,
    op_envs: BTreeMap<String, BTreeMap<String, String>>,
    op_snapshots: Vec<Value>,
    gh_user: String,
    gh_token: String,
    gh_host: String,
    gh_git_protocol: String,
    gh_scopes: Vec<String>,
    gh_logged_in: bool,
    gh_hosts: Vec<(String, Vec<GhHostAuthEntry>)>,
    gh_next_id: u64,
    gh_config: BTreeMap<String, String>,
    gh_aliases: Vec<(String, String)>,
    gh_default_repo: Option<String>,
    gh_repos: BTreeMap<String, GhRepoRecord>,
    gh_gists: Vec<GhGistRecord>,
    gh_ssh_keys: Vec<GhSshKeyRecord>,
    gh_gpg_keys: Vec<GhGpgKeyRecord>,
    gh_extensions: Vec<(String, String, String)>,
    gh_projects: Vec<GhProjectRecord>,
    gh_codespaces: Vec<GhCodespaceRecord>,
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
        let gh_aliases = vec![("co".to_string(), "pr checkout".to_string())];
        let mut gh_repos = BTreeMap::new();
        gh_repos.insert(
            "octocat/Hello-World".into(),
            GhRepoRecord {
                owner: "octocat".into(),
                name: "Hello-World".into(),
                description: "My first repository on GitHub!".into(),
                homepage_url: "https://github.com".into(),
                visibility: "PUBLIC".into(),
                is_private: false,
                is_archived: false,
                is_template: false,
                has_issues_enabled: true,
                has_wiki_enabled: true,
                has_projects_enabled: true,
                has_discussions_enabled: false,
                merge_commit_allowed: true,
                squash_merge_allowed: true,
                rebase_merge_allowed: true,
                auto_merge_allowed: true,
                delete_branch_on_merge: false,
                topics: vec!["octocat".into(), "github".into()],
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
                workflows: default_gh_workflows(),
                workflow_runs: Vec::new(),
                caches: Vec::new(),
                deploy_keys: Vec::new(),
                autolinks: Vec::new(),
            },
        );
        Self {
            op_seq: 0,
            op_default_vault: None,
            op_vaults: Vec::new(),
            op_groups: Vec::new(),
            op_vault_groups: Vec::new(),
            op_items: Vec::new(),
            op_docs: Vec::new(),
            op_envs: BTreeMap::new(),
            op_snapshots: Vec::new(),
            gh_user: "octocat".into(),
            gh_token: "gho_default_safe_bash_token_1234567890".into(),
            gh_host: "github.com".into(),
            gh_git_protocol: "https".into(),
            gh_scopes: vec![
                "repo".into(),
                "read:org".into(),
                "workflow".into(),
                "gist".into(),
                "admin:public_key".into(),
                "admin:gpg_key".into(),
            ],
            gh_logged_in: true,
            gh_hosts: vec![(
                "github.com".into(),
                vec![GhHostAuthEntry {
                    user: "octocat".into(),
                    oauth_token: "gho_default_safe_bash_token_1234567890".into(),
                    git_protocol: "https".into(),
                    scopes: vec![
                        "repo".into(),
                        "read:org".into(),
                        "workflow".into(),
                        "gist".into(),
                        "admin:public_key".into(),
                        "admin:gpg_key".into(),
                    ],
                    active: true,
                }],
            )],
            gh_next_id: 1007,
            gh_config,
            gh_aliases,
            gh_default_repo: None,
            gh_repos,
            gh_gists: Vec::new(),
            gh_ssh_keys: Vec::new(),
            gh_gpg_keys: Vec::new(),
            gh_extensions: Vec::new(),
            gh_projects: Vec::new(),
            gh_codespaces: Vec::new(),
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
                "group" => {
                    let gsub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    let mut vault_sel: Option<String> = None;
                    let mut group_sel: Option<String> = None;
                    let mut perms_raw: Option<String> = None;
                    let mut i = 3usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "--vault" if i + 1 < args.len() => {
                                vault_sel = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--group" if i + 1 < args.len() => {
                                group_sel = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--permissions" if i + 1 < args.len() => {
                                perms_raw = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if !a.starts_with('-') => {
                                if vault_sel.is_none() {
                                    vault_sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    match gsub {
                        "grant" | "revoke" => {
                            let vs = vault_sel.unwrap_or_default();
                            let gs = group_sel.unwrap_or_default();
                            let Some(v) = st.op_vaults.iter().find(|v| v.id.eq_ignore_ascii_case(&vs) || v.name.eq_ignore_ascii_case(&vs)) else {
                                return op_err("Object not found");
                            };
                            let vid = v.id.clone();
                            let Some(g) = st.op_groups.iter().find(|g| g.id.eq_ignore_ascii_case(&gs) || g.name.eq_ignore_ascii_case(&gs)) else {
                                return op_err("Object not found");
                            };
                            let gid = g.id.clone();
                            let req_perms: Vec<String> = perms_raw
                                .map(|s| s.split(',').filter(|p| !p.is_empty()).map(|p| p.to_string()).collect())
                                .unwrap_or_default();
                            let cur_perms: Vec<String> = st
                                .op_vault_groups
                                .iter()
                                .find(|vg| vg.vault_id == vid && vg.group_id == gid)
                                .map(|vg| vg.permissions.clone())
                                .unwrap_or_default();
                            let new_perms = match change_vault_permissions(&cur_perms, &req_perms, gsub == "grant") {
                                Ok(p) => p,
                                Err(e) => return op_err(&e),
                            };
                            if let Some(existing) = st.op_vault_groups.iter_mut().find(|vg| vg.vault_id == vid && vg.group_id == gid) {
                                if new_perms.is_empty() && gsub == "revoke" {
                                    st.op_vault_groups.retain(|vg| !(vg.vault_id == vid && vg.group_id == gid));
                                    return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
                                }
                                existing.permissions = new_perms;
                            } else if gsub == "grant" {
                                let id = next_op_id(st);
                                st.op_vault_groups.push(OpVaultGroupGrant {
                                    id,
                                    vault_id: vid,
                                    group_id: gid,
                                    permissions: new_perms,
                                });
                            }
                            BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                        }
                        "list" => {
                            let vs = vault_sel.unwrap_or_default();
                            let Some(v) = st.op_vaults.iter().find(|v| v.id.eq_ignore_ascii_case(&vs) || v.name.eq_ignore_ascii_case(&vs)) else {
                                return op_err("Object not found");
                            };
                            let vid = v.id.clone();
                            let mut arr = Vec::new();
                            let mut out = String::new();
                            for vg in st.op_vault_groups.iter().filter(|vg| vg.vault_id == vid) {
                                if let Some(g) = st.op_groups.iter().find(|g| g.id == vg.group_id) {
                                    let p_arr: Vec<Value> = vg.permissions.iter().map(|p| JVal::Str(p.clone())).collect();
                                    arr.push(jval!({
                                        "id": g.id,
                                        "name": g.name,
                                        "permissions": p_arr
                                    }));
                                    if out.is_empty() {
                                        out.push_str("id\tname\tpermissions\n");
                                    }
                                    let p_compact = format!(
                                        "[{}]",
                                        vg.permissions
                                            .iter()
                                            .map(|p| format!("\"{p}\""))
                                            .collect::<Vec<_>>()
                                            .join(",")
                                    );
                                    out.push_str(&format!("{}\t{}\t{p_compact}\n", g.id, g.name));
                                }
                            }
                            if format_json {
                                let s = to_pretty_json(&Value::Array(arr));
                                return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                            }
                            BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                        }
                        _ => op_err("Unsupported admin action"),
                    }
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
                        let out = if format_json {
                            to_pretty_json(&jval!(["Login"]))
                        } else {
                            "[\"Login\"]".to_string()
                        };
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
                    let mut fields_spec: Vec<String> = Vec::new();
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
                            "--fields" => {
                                if let Some(v) = args.get(i + 1) {
                                    for part in v.split(',') {
                                        let p = part.trim();
                                        if !p.is_empty() {
                                            fields_spec.push(p.to_string());
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--format" => i += 2,
                            a if a.starts_with("--fields=") => {
                                for part in a["--fields=".len()..].split(',') {
                                    let p = part.trim();
                                    if !p.is_empty() {
                                        fields_spec.push(p.to_string());
                                    }
                                }
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
                    if !fields_spec.is_empty() {
                        let full_item = item_json(it, vname);
                        let empty_fields = Vec::new();
                        let item_fields = full_item.get("fields").and_then(|v| v.as_array()).unwrap_or(&empty_fields);
                        let mut selected: Vec<Value> = Vec::new();
                        for selector in &fields_spec {
                            let (key, match_val) = match selector.split_once('=') {
                                Some((k, v)) => (k, v.to_ascii_lowercase()),
                                None => ("label", selector.to_ascii_lowercase()),
                            };
                            if key != "label" && key != "type" {
                                return op_err("Unsupported field selector");
                            }
                            let mut matches: Vec<Value> = Vec::new();
                            for f in item_fields {
                                let f_val = f.get(key).and_then(|v| v.as_str()).unwrap_or("");
                                let id_val = f.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                if f_val.to_ascii_lowercase() == match_val
                                    || (key == "label" && id_val.to_ascii_lowercase() == match_val)
                                {
                                    matches.push(f.clone());
                                }
                            }
                            if matches.is_empty() {
                                return op_err("Field not found");
                            }
                            for m in matches {
                                if !selected.contains(&m) {
                                    selected.push(m);
                                }
                            }
                        }
                        if format_json {
                            let out_val = if selected.len() == 1 {
                                selected[0].clone()
                            } else {
                                Value::Array(selected)
                            };
                            let out = to_pretty_json(&out_val);
                            return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                        }
                        let vals: Vec<String> = selected
                            .iter()
                            .map(|f| {
                                let txt = f.get("value").and_then(|v| v.as_str()).unwrap_or("");
                                if txt.chars().any(|c| matches!(c, ',' | '"' | '\r' | '\n')) {
                                    format!("\"{}\"", txt.replace('"', "\"\""))
                                } else {
                                    txt.to_string()
                                }
                            })
                            .collect();
                        return BuiltinOutcome {
                            stdout: format!("{}\n", vals.join(",")),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
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
                    let Some(dst) = find_vault(st, Some(&dst_sel)).cloned() else {
                        return op_err("Object not found");
                    };
                    let cur_id = cur_vault.as_deref().and_then(|vs| {
                        st.op_vaults.iter().find(|v| v.id == vs || v.name.eq_ignore_ascii_case(vs)).map(|v| v.id.clone())
                    });
                    if cur_vault.is_some() && cur_id.is_none() {
                        return op_err("Object not found");
                    }
                    let new_id = next_op_id(st);
                    let Some(it) = st.op_items.iter_mut().find(|it| {
                        let v_ok = cur_id.as_ref().map(|vid| &it.vault_id == vid).unwrap_or(true);
                        it.state != "DELETED" && v_ok && (it.id == sel || it.title.eq_ignore_ascii_case(&sel))
                    }) else {
                        return op_err("Object not found");
                    };
                    it.id = new_id;
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
                match ssub {
                    "create" => {
                        let mut snap_name: Option<String> = None;
                        let mut has_vars_flag = false;
                        let mut var_names: Vec<String> = Vec::new();
                        let mut i = 3usize;
                        while i < args.len() {
                            match args[i].as_str() {
                                "--vars" if i + 1 < args.len() => {
                                    has_vars_flag = true;
                                    for part in args[i + 1].split(',') {
                                        let p = part.trim();
                                        if !p.is_empty() && !var_names.iter().any(|x| x == p) {
                                            var_names.push(p.to_string());
                                        }
                                    }
                                    i += 2;
                                }
                                "--format" if i + 1 < args.len() => i += 2,
                                a if a.starts_with("--vars=") => {
                                    has_vars_flag = true;
                                    for part in a["--vars=".len()..].split(',') {
                                        let p = part.trim();
                                        if !p.is_empty() && !var_names.iter().any(|x| x == p) {
                                            var_names.push(p.to_string());
                                        }
                                    }
                                    i += 1;
                                }
                                a if a.starts_with('-') => i += 1,
                                a => {
                                    if snap_name.is_none() {
                                        snap_name = Some(a.to_string());
                                    } else {
                                        return op_err("Invalid environment snapshot arguments");
                                    }
                                    i += 1;
                                }
                            }
                        }
                        let Some(name) = snap_name else {
                            return op_err("Invalid environment snapshot arguments");
                        };
                        let snap_id = next_op_id(st);
                        let scope = if has_vars_flag { "selected" } else { "complete" };
                        let mut vars_obj = Map::new();
                        if has_vars_flag {
                            for vn in &var_names {
                                match env.get(vn) {
                                    Some(val) => vars_obj.insert(vn.clone(), JVal::Str(val.clone())),
                                    None => vars_obj.insert(vn.clone(), JVal::Null),
                                }
                            }
                        } else {
                            for (k, v) in env.iter() {
                                vars_obj.insert(k.clone(), JVal::Str(v.clone()));
                            }
                        }
                        let var_count = vars_obj.0.len();
                        let stored = jval!({
                            "id": snap_id,
                            "name": name,
                            "snapshot": {
                                "version": 1,
                                "scope": scope,
                                "variables": vars_obj
                            }
                        });
                        st.op_snapshots.push(stored);
                        let meta = jval!({
                            "id": snap_id,
                            "name": name,
                            "variables": var_count,
                            "scope": scope
                        });
                        let out = to_pretty_json(&meta);
                        return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    "list" | "ls" => {
                        let arr: Vec<Value> = st
                            .op_snapshots
                            .iter()
                            .map(|s| {
                                let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                let name = s.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                                let snap_obj = s.get("snapshot");
                                let scope = snap_obj
                                    .and_then(|v| v.get("scope"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("complete");
                                let vlen = match snap_obj.and_then(|v| v.get("variables")) {
                                    Some(JVal::Object(entries)) => entries.len(),
                                    _ => 0,
                                };
                                jval!({
                                    "id": id,
                                    "name": name,
                                    "variables": vlen,
                                    "scope": scope
                                })
                            })
                            .collect();
                        let out = to_pretty_json(&Value::Array(arr));
                        return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    "get" => {
                        let sel = args
                            .iter()
                            .skip(3)
                            .find(|a| !a.starts_with('-'))
                            .cloned()
                            .unwrap_or_default();
                        if sel.is_empty() {
                            return op_err("Invalid environment snapshot arguments");
                        }
                        let Some(snap) = st.op_snapshots.iter().find(|s| {
                            let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            id.eq_ignore_ascii_case(&sel) || name.eq_ignore_ascii_case(&sel)
                        }) else {
                            return op_err("Object not found");
                        };
                        let out = to_pretty_json(snap);
                        return BuiltinOutcome { stdout: format!("{out}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    "delete" | "rm" => {
                        let sel = args
                            .iter()
                            .skip(3)
                            .find(|a| !a.starts_with('-'))
                            .cloned()
                            .unwrap_or_default();
                        if sel.is_empty() {
                            return op_err("Invalid environment snapshot arguments");
                        }
                        let before = st.op_snapshots.len();
                        st.op_snapshots.retain(|s| {
                            let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            !id.eq_ignore_ascii_case(&sel) && !name.eq_ignore_ascii_case(&sel)
                        });
                        if st.op_snapshots.len() == before {
                            return op_err("Object not found");
                        }
                        return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
                    }
                    "restore" => {
                        let mut shell_opt: Option<String> = None;
                        let mut no_masking = false;
                        let mut pos_args: Vec<String> = Vec::new();
                        let mut literal = false;
                        let mut i = 3usize;
                        while i < args.len() {
                            let a = args[i].as_str();
                            if literal {
                                pos_args.push(a.to_string());
                                i += 1;
                                continue;
                            }
                            if a == "--" {
                                literal = true;
                                i += 1;
                                continue;
                            }
                            match a {
                                "--shell" if i + 1 < args.len() => {
                                    shell_opt = Some(args[i + 1].clone());
                                    i += 2;
                                }
                                "--no-masking" => {
                                    no_masking = true;
                                    i += 1;
                                }
                                "--format" if i + 1 < args.len() => i += 2,
                                _ if a.starts_with("--shell=") => {
                                    shell_opt = Some(a["--shell=".len()..].to_string());
                                    i += 1;
                                }
                                _ if a.starts_with('-') => i += 1,
                                _ => {
                                    pos_args.push(a.to_string());
                                    i += 1;
                                }
                            }
                        }
                        let Some(sel) = pos_args.first().cloned() else {
                            return op_err("Invalid environment snapshot arguments");
                        };
                        let Some(snap) = st.op_snapshots.iter().find(|s| {
                            let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            id.eq_ignore_ascii_case(&sel) || name.eq_ignore_ascii_case(&sel)
                        }).cloned() else {
                            return op_err("Object not found");
                        };
                        drop(map);
                        let snap_obj = snap.get("snapshot");
                        let scope = snap_obj
                            .and_then(|v| v.get("scope"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("complete");
                        let empty_entries = Vec::new();
                        let snap_entries = match snap_obj.and_then(|v| v.get("variables")) {
                            Some(JVal::Object(entries)) => entries,
                            _ => &empty_entries,
                        };
                        if let Some(sh) = shell_opt {
                            if pos_args.len() != 1 {
                                return op_err("Shell output cannot be combined with a child command");
                            }
                            if !matches!(sh.as_str(), "bash" | "zsh" | "sh" | "fish" | "powershell") {
                                return op_err("Unsupported restoration shell");
                            }
                            let mut names: Vec<String> = Vec::new();
                            if scope == "complete" {
                                for k in env.keys() {
                                    if !names.contains(k) {
                                        names.push(k.clone());
                                    }
                                }
                            }
                            for (k, _) in snap_entries {
                                if !names.contains(k) {
                                    names.push(k.clone());
                                }
                            }
                            for name in &names {
                                let valid = !name.is_empty()
                                    && name.chars().enumerate().all(|(idx, ch)| {
                                        ch == '_'
                                            || ch.is_ascii_alphabetic()
                                            || (idx > 0 && ch.is_ascii_digit())
                                    });
                                if !valid {
                                    return op_err("Environment contains a name that cannot be restored by a shell script");
                                }
                            }
                            let mut lines: Vec<String> = Vec::new();
                            for name in &names {
                                let val_opt = snap_entries
                                    .iter()
                                    .find(|(k, _)| k == name)
                                    .and_then(|(_, v)| v.as_str());
                                match val_opt {
                                    Some(val) => {
                                        if sh == "powershell" {
                                            lines.push(format!("$env:{name} = '{}'", val.replace('\'', "''")));
                                        } else if sh == "fish" {
                                            lines.push(format!(
                                                "set -gx {name} '{}'",
                                                val.replace('\\', "\\\\").replace('\'', "\\'")
                                            ));
                                        } else {
                                            lines.push(format!(
                                                "export {name}='{}'",
                                                val.replace('\'', "'\\''")
                                            ));
                                        }
                                    }
                                    None => {
                                        if sh == "powershell" {
                                            lines.push(format!(
                                                "Remove-Item Env:{name} -ErrorAction SilentlyContinue"
                                            ));
                                        } else if sh == "fish" {
                                            lines.push(format!("set -e {name}"));
                                        } else {
                                            lines.push(format!("unset {name}"));
                                        }
                                    }
                                }
                            }
                            return BuiltinOutcome {
                                stdout: format!("{}\n", lines.join("\n")),
                                stderr: String::new(),
                                exit_code: 0,
                            };
                        }
                        if pos_args.len() > 1 {
                            let mut child_env: BTreeMap<String, String> = if scope == "selected" {
                                env.clone()
                            } else {
                                BTreeMap::new()
                            };
                            let mut secrets: Vec<String> = Vec::new();
                            for (k, v) in snap_entries {
                                match v {
                                    JVal::Str(s) => {
                                        child_env.insert(k.clone(), s.clone());
                                        if !s.is_empty() && !secrets.contains(s) {
                                            secrets.push(s.clone());
                                        }
                                    }
                                    _ => {
                                        child_env.remove(k);
                                    }
                                }
                            }
                            let mut out = exec_sub(&pos_args[1..], stdin, cwd, &mut child_env);
                            if !no_masking {
                                for sec in &secrets {
                                    out.stdout = out.stdout.replace(sec, "<concealed by 1Password>");
                                    out.stderr = out.stderr.replace(sec, "<concealed by 1Password>");
                                }
                            }
                            return out;
                        }
                        return op_err("Host environment restoration is unavailable; use --shell or supply a child command after --");
                    }
                    _ => return op_err("Unsupported admin action"),
                }
            }
            BuiltinOutcome { stdout: "{}\n".into(), stderr: String::new(), exit_code: 0 }
        }
        "group" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let mut desc_opt: Option<String> = None;
            let mut name_opt: Option<String> = None;
            let mut i = 1usize;
            while i < args.len() {
                match args[i].as_str() {
                    "--description" if i + 1 < args.len() => {
                        desc_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--name" if i + 1 < args.len() => {
                        name_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--format" if i + 1 < args.len() => {
                        i += 2;
                    }
                    a if a.starts_with("--description=") => {
                        desc_opt = Some(a.trim_start_matches("--description=").to_string());
                        i += 1;
                    }
                    a if a.starts_with("--name=") => {
                        name_opt = Some(a.trim_start_matches("--name=").to_string());
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            match sub {
                "create" => {
                    let gname = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .or(name_opt)
                        .unwrap_or_default();
                    if gname.is_empty() {
                        return op_err("Invalid or duplicate object");
                    }
                    let gid = next_op_id(st);
                    let grp = OpGroupRecord {
                        id: gid.clone(),
                        name: gname.clone(),
                        description: desc_opt.clone(),
                    };
                    st.op_groups.push(grp);
                    if format_json {
                        let val = if let Some(d) = desc_opt {
                            jval!({ "id": gid, "name": gname, "description": d })
                        } else {
                            jval!({ "id": gid, "name": gname })
                        };
                        let s = to_pretty_json(&val);
                        return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let mut out = format!("id: {gid}\nname: {gname}\n");
                    if let Some(d) = desc_opt {
                        out.push_str(&format!("description: {d}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "list" => {
                    if format_json {
                        let arr: Vec<Value> = st
                            .op_groups
                            .iter()
                            .map(|g| {
                                if let Some(d) = &g.description {
                                    jval!({ "id": g.id, "name": g.name, "description": d })
                                } else {
                                    jval!({ "id": g.id, "name": g.name })
                                }
                            })
                            .collect();
                        let s = to_pretty_json(&Value::Array(arr));
                        return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    if st.op_groups.is_empty() {
                        return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 };
                    }
                    let has_desc = st.op_groups.iter().any(|g| g.description.is_some());
                    let mut out = if has_desc {
                        "id\tname\tdescription\n".to_string()
                    } else {
                        "id\tname\n".to_string()
                    };
                    for g in &st.op_groups {
                        if has_desc {
                            out.push_str(&format!("{}\t{}\t{}\n", g.id, g.name, g.description.as_deref().unwrap_or("")));
                        } else {
                            out.push_str(&format!("{}\t{}\n", g.id, g.name));
                        }
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let sel = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    let Some(g) = st.op_groups.iter().find(|g| g.id.eq_ignore_ascii_case(&sel) || g.name.eq_ignore_ascii_case(&sel)) else {
                        return op_err("Object not found");
                    };
                    if format_json {
                        let val = if let Some(d) = &g.description {
                            jval!({ "id": g.id, "name": g.name, "description": d })
                        } else {
                            jval!({ "id": g.id, "name": g.name })
                        };
                        let s = to_pretty_json(&val);
                        return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let mut out = format!("id: {}\nname: {}\n", g.id, g.name);
                    if let Some(d) = &g.description {
                        out.push_str(&format!("description: {d}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let sel = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    let Some(g) = st.op_groups.iter_mut().find(|g| g.id.eq_ignore_ascii_case(&sel) || g.name.eq_ignore_ascii_case(&sel)) else {
                        return op_err("Object not found");
                    };
                    if let Some(n) = name_opt {
                        g.name = n;
                    }
                    if let Some(d) = desc_opt {
                        g.description = Some(d);
                    }
                    let g_clone = g.clone();
                    if format_json {
                        let val = if let Some(d) = &g_clone.description {
                            jval!({ "id": g_clone.id, "name": g_clone.name, "description": d })
                        } else {
                            jval!({ "id": g_clone.id, "name": g_clone.name })
                        };
                        let s = to_pretty_json(&val);
                        return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let mut out = format!("id: {}\nname: {}\n", g_clone.id, g_clone.name);
                    if let Some(d) = &g_clone.description {
                        out.push_str(&format!("description: {d}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "delete" => {
                    let sel = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    let before = st.op_groups.len();
                    st.op_groups.retain(|g| !g.id.eq_ignore_ascii_case(&sel) && !g.name.eq_ignore_ascii_case(&sel));
                    if st.op_groups.len() == before {
                        return op_err("Object not found");
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                _ => op_err("Unsupported admin action"),
            }
        }
        "plugin" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            const PLUGINS: &[(&str, &str, &str, &str)] = &[
                ("akamai", "Akamai CLI", "Akamai", "Client Secret, Host, Access Token, Client Token"),
                ("claude", "Claude Code", "Anthropic", "API Key"),
                ("argocd", "Argo CD CLI", "Argo CD", "Auth Token"),
                ("aws", "AWS CLI", "AWS", "Access Key ID, Secret Access Key"),
                ("cdk", "AWS CDK Toolkit", "AWS", "Access Key ID, Secret Access Key"),
                ("sam", "AWS SAM CLI", "AWS", "Access Key ID, Secret Access Key"),
                ("eksctl", "eksctl CLI", "AWS", "Access Key ID, Secret Access Key"),
                ("awslogs", "awslogs", "AWS", "Access Key ID, Secret Access Key"),
                ("axiom", "Axiom CLI", "Axiom", "Token, Organization"),
                ("binance-cli", "Binance CLI", "Binance", "API Key, API Secret"),
                ("cachix", "Cachix CLI", "Cachix", "Token"),
                ("cargo", "Cargo CLI", "Cargo", "Token"),
                ("circleci", "CircleCI CLI", "CircleCI", "Token"),
                ("civo", "Civo CLI", "Civo", "API Key"),
                ("cline", "Cline CLI", "Cline", "API Key"),
                ("wrangler", "Cloudflare Workers CLI", "Cloudflare Workers", "Token"),
                ("crash", "CrateDB Shell", "CrateDB", "Host, Username, Password"),
                ("crowdin", "Crowdin CLI", "Crowdin", "Token"),
                ("agent", "Cursor CLI", "Cursor", "API Key"),
                ("databricks", "Databricks CLI", "Databricks", "Host, Token"),
                ("dog", "Dogshell", "Datadog", "API Key, App Key"),
                ("descope", "Descope CLI", "Descope", "Project ID, Management Key"),
                ("doctl", "DigitalOcean CLI", "DigitalOcean", "Token"),
                ("exercism", "Exercism CLI", "Exercism", "URL, API Key, Directory"),
                ("expo", "Expo CLI", "Expo", "Token"),
                ("eas", "EAS CLI", "Expo", "Token"),
                ("fastly", "Fastly CLI", "Fastly", "Token"),
                ("flyctl", "Flyctl", "Fly.io", "Token"),
                ("fly", "Fly", "Fly.io", "Token"),
                ("fossa", "FOSSA CLI", "FOSSA", "API Key"),
                ("tea", "Gitea CLI", "Gitea", "Token, Host Address, User"),
                ("gh", "GitHub CLI", "GitHub", "Token"),
                ("copilot", "GitHub Copilot CLI", "GitHub Copilot", "Token"),
                ("glab", "GitLab CLI", "GitLab", "Token"),
                ("gemini", "Google Gemini CLI", "Google Gemini CLI", "API Key"),
                ("vault", "Vault CLI", "HashiCorp Vault", "Token"),
                ("heroku", "Heroku CLI", "Heroku", "API Key"),
                ("hcloud", "Hetzner Cloud CLI", "Hetzner Cloud", "Token"),
                ("brew", "Homebrew CLI", "Homebrew", "Token"),
                ("huggingface-cli", "HuggingFace CLI", "Hugging Face", "User Access Token"),
                ("influx", "InfluxDB CLI", "InfluxDB", "Host, Organization, Access Token"),
                ("junie", "JetBrains Junie CLI", "JetBrains Junie", "API Key"),
                ("kaggle", "Kaggle CLI", "Kaggle", "Token, Username"),
                ("kiro-cli", "Kiro CLI", "Kiro", "API Key"),
                ("lacework", "Lacework CLI", "Lacework", "Account, API Key ID, API Secret"),
                ("forge", "Laravel Forge CLI", "Laravel Forge", "Token"),
                ("vapor", "Laravel Vapor CLI", "Laravel Vapor", "Token"),
                ("linode-cli", "Linode CLI", "Linode", "Token"),
                ("localstack", "LocalStack CLI", "LocalStack", "API Key"),
                ("atlas", "MongoDB Atlas CLI", "MongoDB Atlas", "Public Key, Private Key"),
                ("mysql", "mysql", "MySQL", "Password"),
                ("ngrok", "ngrok CLI", "ngrok", "Authtoken"),
                ("ohdear", "Oh Dear CLI", "Oh Dear", "Token"),
                ("okta", "Okta CLI", "Okta", "Token, Org URL"),
                ("openai", "OpenAI CLI", "OpenAI", "API Key"),
                ("oaieval", "OpenAI Evals CLI", "OpenAI", "API Key"),
                ("oaievalset", "OpenAI Eval Set CLI", "OpenAI", "API Key"),
                ("codex", "OpenAI Codex", "OpenAI", "API Key"),
                ("opencode", "OpenCode CLI", "OpenCode", "API Key"),
                ("tofu", "OpenTofu", "OpenTofu", "Depends on configured credentials"),
                ("pd", "Pipedream CLI", "Pipedream", "API Key"),
                ("psql", "psql", "PostgreSQL", "Host, User, Password"),
                ("pg_dump", "pg_dump", "PostgreSQL", "Host, User, Password"),
                ("pg_restore", "pg_restore", "PostgreSQL", "Host, User, Password"),
                ("pgcli", "pgcli", "PostgreSQL", "Host, User, Password"),
                ("pulumi", "Pulumi CLI", "Pulumi", "Token"),
                ("twine", "Twine", "PyPI", "Token"),
                ("flit", "Flit", "PyPI", "Token"),
                ("hatch", "Hatch", "PyPI", "Token"),
                ("rdme", "ReadMe CLI", "ReadMe", "API Key"),
                ("redis-cli", "Redis CLI", "Redis", "Password"),
                ("-", "", "rediscloud", "Account Key, User Key"),
                ("scw", "Scaleway CLI", "Scaleway", "Access Key ID, Secret Access Key"),
                ("sentry-cli", "Sentry CLI", "Sentry", "Token"),
                ("snowsql", "Snowflake CLI", "Snowflake", "Account, Username, Password"),
                ("snyk", "Snyk CLI", "Snyk", "Token"),
                ("src", "Sourcegraph CLI", "Sourcegraph", "Token"),
                ("stripe", "Stripe CLI", "Stripe", "Key"),
                ("todoist", "Todoist CLI", "Todoist", "Token"),
                ("td", "Treasure Data Toolbelt", "Treasure Data", "API Key"),
                ("tugboat", "Tugboat CLI", "Tugboat", "Token"),
                ("twilio", "Twilio CLI", "Twilio", "Account SID, API Key, API Secret"),
                ("upctl", "UpCloud CLI", "UpCloud", "Username, Password"),
                ("upstash", "Upstash CLI", "Upstash", "API Key, Email"),
                ("vercel", "Vercel CLI", "Vercel", "Token"),
                ("vsql", "Vertica CLI", "Vertica", "Username, Password, Database"),
                ("vultr-cli", "Vultr CLI", "Vultr", "API Key"),
                ("ysqlsh", "YugabyteDB SQL Shell", "YugabyteDB", "Host, Username, Password"),
                ("zapier", "Zapier CLI", "Zapier", "Key"),
                ("zcli", "Zendesk CLI", "Zendesk", "Subdomain, Email, Token"),
            ];
            match sub {
                "list" | "ls" => {
                    if format_json {
                        let arr: Vec<Value> = PLUGINS
                            .iter()
                            .map(|(exec, name, pname, _)| {
                                if *pname == "rediscloud" {
                                    jval!({
                                        "source": "1password-registry",
                                        "plugin_name": pname
                                    })
                                } else {
                                    jval!({
                                        "source": "1password-registry",
                                        "name": name,
                                        "executable": exec,
                                        "plugin_name": pname
                                    })
                                }
                            })
                            .collect();
                        let s = to_pretty_json(&Value::Array(arr));
                        return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
                    }
                    let mut out = String::from("EXECUTABLE         NAME                  REQUIRED FIELDS\n");
                    for (exec, _, pname, reqs) in PLUGINS {
                        out.push_str(&format!("{exec:<19}{pname:<22}{reqs}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "inspect" => {
                    let target = args.get(2).map(|s| s.as_str()).unwrap_or("");
                    if target.is_empty() {
                        return op_err("Plugin selection capability is unavailable");
                    }
                    if PLUGINS.iter().any(|(exec, _, _, _)| exec.eq_ignore_ascii_case(target)) {
                        return op_err("Plugin configuration is unavailable");
                    }
                    op_err("Object not found")
                }
                _ => op_err("Unsupported admin action"),
            }
        }
        "user" | "connect" | "service-account" | "events-api" => {
            BuiltinOutcome { stdout: if format_json { "[]\n".into() } else { String::new() }, stderr: String::new(), exit_code: 0 }
        }
        "completion" => {
            let pos: Vec<&str> = args
                .iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .map(|s| s.as_str())
                .collect();
            if pos.len() != 1 {
                return op_err("completion requires one shell: bash, zsh, fish, or powershell");
            }
            let script = match pos[0] {
                "bash" => "_op() {\n  local response directive choice current op_cword\n  local -a op_words\n  if declare -F _get_comp_words_by_ref >/dev/null; then\n    _get_comp_words_by_ref -n =: -w op_words -i op_cword -c current || return\n  else\n    op_words=(\"${COMP_WORDS[@]}\")\n    op_cword=$COMP_CWORD\n    current=\"${op_words[op_cword]}\"\n  fi\n  op_words[op_cword]=\"$current\"\n  COMPREPLY=()\n  response=$(OP_COMPATIBILITY_CHANNEL=stable \"${op_words[0]}\" __completeNoDesc \"${op_words[@]:1:op_cword}\" 2>/dev/null) || return\n  directive=\"${response##*$'\\n'}\"\n  case \"$directive\" in\n    :0) while IFS= read -r choice; do COMPREPLY+=(\"$choice\"); done < <(compgen -f -- \"$current\") ;;\n    :4) while IFS= read -r choice; do [[ \"$choice\" == :4 ]] || COMPREPLY+=(\"$choice\"); done <<< \"$response\" ;;\n  esac\n}\ncomplete -o filenames -F _op op\n",
                "zsh" => "#compdef op\n_op() {\n  local line directive\n  local -a response candidates descriptions\n  response=(\"${(@f)$(OP_COMPATIBILITY_CHANNEL=stable \"${words[1]}\" __complete \"${(@)words[2,CURRENT]}\" 2>/dev/null)}\")\n  directive=\"${response[-1]}\"\n  case \"$directive\" in\n    :0) _files ;;\n    :4)\n      for line in \"${response[@]}\"; do\n        [[ \"$line\" == :4 ]] && continue\n        candidates+=(\"${line%%$'\\t'*}\")\n        descriptions+=(\"${line#*$'\\t'}\")\n      done\n      (( ${#candidates} )) && compadd -d descriptions -- \"${candidates[@]}\"\n      ;;\n  esac\n  return 0\n}\ncompdef _op op\n",
                "fish" => "function __op_candidates\n  set -lx OP_COMPATIBILITY_CHANNEL stable\n  set -l tokens (commandline -opc)\n  set -l current (commandline -ct)\n  set -l response ($tokens[1] __complete $tokens[2..-1] \"$current\" 2>/dev/null)\n  set -l directive $response[-1]\n  switch \"$directive\"\n    case :0\n      __fish_complete_path \"$current\"\n    case :4\n      set -e response[-1]\n      for candidate in $response\n        printf \"%s\\n\" \"$candidate\"\n      end\n  end\nend\ncomplete -c op -f -a '(__op_candidates)'\n",
                "powershell" => "Register-ArgumentCompleter -Native -CommandName op -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  $program = $commandAst.CommandElements[0].Value\n  $arguments = @()\n  foreach ($element in ($commandAst.CommandElements | Select-Object -Skip 1)) {\n    if ($element.Extent.EndOffset -ge $cursorPosition) { break }\n    if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $arguments += $element.Value }\n    else { $arguments += $element.Extent.Text }\n  }\n  $current = $wordToComplete\n  if ($current -eq \"\" -and ($PSVersionTable.PSVersion -lt [version]\"7.3\" -or $PSNativeCommandArgumentPassing -eq \"Legacy\")) { $current = '\"\"' }\n  $previousChannel = $env:OP_COMPATIBILITY_CHANNEL\n  try {\n    $env:OP_COMPATIBILITY_CHANNEL = 'stable'\n    $response = @(& $program __complete @arguments $current 2>$null)\n  } finally { $env:OP_COMPATIBILITY_CHANNEL = $previousChannel }\n  if ($response.Count -eq 0) { return }\n  $directive = $response[-1]\n  if ($directive -eq \":0\") { return }\n  if ($directive -ne \":4\") { \"\"; return }\n  if ($response.Count -eq 1) { \"\"; return }\n  foreach ($line in $response[0..($response.Count - 2)]) {\n    $parts = $line.Split([char]9, 2)\n    $description = if ($parts.Count -gt 1) { $parts[1] } else { \" \" }\n    [System.Management.Automation.CompletionResult]::new($parts[0], $parts[0], 'ParameterValue', $description)\n  }\n}\n",
                _ => return op_err("completion requires one shell: bash, zsh, fish, or powershell"),
            };
            BuiltinOutcome {
                stdout: script.to_string(),
                stderr: String::new(),
                exit_code: 0,
            }
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

fn parse_gh_common_flags(args: &[String]) -> (Option<String>, Option<Vec<String>>, Option<String>, Vec<String>) {
    let mut repo = None;
    let mut json_fields = None;
    let mut jq_expr = None;
    let mut filtered = Vec::with_capacity(args.len());
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
            _ => {
                filtered.push(args[i].clone());
                i += 1;
            }
        }
    }
    (repo, json_fields, jq_expr, filtered)
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
    if !st.gh_repos.contains_key(&full) {
        st.gh_next_id += 7;
        st.gh_repos.insert(
            full.clone(),
            GhRepoRecord {
                owner: owner.to_string(),
                name: name.to_string(),
                description: String::new(),
                homepage_url: String::new(),
                visibility: "PUBLIC".into(),
                is_private: false,
                is_archived: false,
                is_template: false,
                has_issues_enabled: true,
                has_wiki_enabled: true,
                has_projects_enabled: true,
                has_discussions_enabled: false,
                merge_commit_allowed: true,
                squash_merge_allowed: true,
                rebase_merge_allowed: true,
                auto_merge_allowed: true,
                delete_branch_on_merge: false,
                topics: Vec::new(),
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
                workflows: default_gh_workflows(),
                workflow_runs: Vec::new(),
                caches: Vec::new(),
                deploy_keys: Vec::new(),
                autolinks: Vec::new(),
            },
        );
    }
    full
}

fn find_git_root_in_vfs(cwd: &str, fs: &dyn SafeBashFs) -> Option<String> {
    let mut current = if cwd.is_empty() { "/".to_string() } else { cwd.to_string() };
    loop {
        let git_dir = if current == "/" {
            "/.git".to_string()
        } else {
            format!("{current}/.git")
        };
        if fs.is_dir(&git_dir) || fs.exists(&git_dir) {
            return Some(current);
        }
        if current == "/" {
            return None;
        }
        current = match current.rsplit_once('/') {
            Some(("", _)) | None => "/".to_string(),
            Some((parent, _)) => parent.to_string(),
        };
    }
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

    let sub_first = args.get(1).map(|s| s.as_str()).unwrap_or("");
    let h_takes_value = first == "auth"
        || first == "config"
        || (first == "repo" && matches!(sub_first, "create" | "new" | "edit"));
    let mut is_help = false;
    let mut hi = 0usize;
    while hi < args.len() {
        let a = args[hi].as_str();
        if a == "--help" {
            is_help = true;
            break;
        }
        if a == "-h" {
            if h_takes_value && hi + 1 < args.len() && !args[hi + 1].starts_with('-') {
                hi += 2;
                continue;
            }
            is_help = true;
            break;
        }
        hi += 1;
    }
    if is_help {
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
    let (repo_flag, json_fields, jq_expr, filtered_args) = parse_gh_common_flags(args);
    let args = &filtered_args;

    match first {
        "auth" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("status");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let mut host_opt: Option<String> = None;
            let mut user_opt: Option<String> = None;
            let mut proto_opt: Option<String> = None;
            let mut scopes_opt: Option<String> = None;
            let mut with_token = false;
            let mut show_token = false;
            let mut active_only = false;
            let mut i = 2usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-h" | "--hostname" if i + 1 < args.len() => {
                        host_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-u" | "--user" if i + 1 < args.len() => {
                        user_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-p" | "--git-protocol" if i + 1 < args.len() => {
                        proto_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-s" | "--scopes" if i + 1 < args.len() => {
                        scopes_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--with-token" => {
                        with_token = true;
                        i += 1;
                    }
                    "-t" | "--show-token" => {
                        show_token = true;
                        i += 1;
                    }
                    "-a" | "--active" => {
                        active_only = true;
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let env_token = env.get("GH_TOKEN").or_else(|| env.get("GITHUB_TOKEN")).cloned();
            match sub {
                "status" => {
                    if st.gh_hosts.is_empty() && env_token.is_none() {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n".into(),
                            exit_code: 1,
                        };
                    }
                    let mask_token = |tok: &str, show: bool| -> String {
                        if show {
                            tok.to_string()
                        } else {
                            let prefix: String = tok.chars().take(4).collect();
                            let stars = "*".repeat(tok.chars().count().saturating_sub(4).max(4));
                            format!("{prefix}{stars}")
                        }
                    };
                    let mut hosts_to_show = st.gh_hosts.clone();
                    if hosts_to_show.is_empty()
                        && let Some(ref et) = env_token
                    {
                        hosts_to_show.push((
                            host_opt.clone().unwrap_or_else(|| "github.com".into()),
                            vec![GhHostAuthEntry {
                                user: st.gh_user.clone(),
                                oauth_token: et.clone(),
                                git_protocol: st.gh_git_protocol.clone(),
                                scopes: st.gh_scopes.clone(),
                                active: true,
                            }],
                        ));
                    }
                    if let Some(ref h_filter) = host_opt {
                        hosts_to_show.retain(|(h, _)| h == h_filter);
                    }
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let mut hosts_obj = Vec::new();
                        for (h, entries) in &hosts_to_show {
                            let mut arr = Vec::new();
                            for e in entries {
                                if active_only && !e.active {
                                    continue;
                                }
                                let tok_ref = env_token.as_deref().unwrap_or(&e.oauth_token);
                                arr.push(jval!({
                                    "host": h,
                                    "login": e.user,
                                    "active": e.active,
                                    "state": "success",
                                    "token": mask_token(tok_ref, show_token),
                                    "scopes": e.scopes.join(", "),
                                    "gitProtocol": e.git_protocol
                                }));
                            }
                            hosts_obj.push((h.clone(), Value::Array(arr)));
                        }
                        let obj = jval!({ "hosts": JVal::Object(hosts_obj) });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut lines = Vec::new();
                    for (h, entries) in &hosts_to_show {
                        lines.push(h.clone());
                        for e in entries {
                            if active_only && !e.active {
                                continue;
                            }
                            let tok_ref = env_token.as_deref().unwrap_or(&e.oauth_token);
                            let tok_disp = mask_token(tok_ref, show_token);
                            let scopes_disp = e.scopes.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", ");
                            lines.push(format!("  ✓ Logged in to {h} account {} (keyring)", e.user));
                            lines.push(format!("  - Active account: {}", e.active));
                            lines.push(format!("  - Git operations protocol: {}", e.git_protocol));
                            lines.push(format!("  - Token: {tok_disp}"));
                            lines.push(format!("  - Token scopes: {scopes_disp}"));
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("{}\n", lines.join("\n")),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "token" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    let tok = env_token.unwrap_or_else(|| {
                        st.gh_hosts
                            .iter()
                            .find(|(h, _)| h == &host)
                            .and_then(|(_, entries)| {
                                if let Some(ref u) = user_opt {
                                    entries.iter().find(|e| &e.user == u)
                                } else {
                                    entries.iter().find(|e| e.active).or_else(|| entries.first())
                                }
                            })
                            .map(|e| e.oauth_token.clone())
                            .unwrap_or_default()
                    });
                    if tok.is_empty() {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("no oauth token found for {host}\n"),
                            exit_code: 1,
                        };
                    }
                    BuiltinOutcome {
                        stdout: format!("{tok}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "login" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    let token = if with_token || !stdin.trim().is_empty() {
                        let t = stdin.trim().to_string();
                        if t.is_empty() {
                            return gh_err("expected token on standard input");
                        }
                        t
                    } else {
                        env_token.unwrap_or_else(|| "gho_authenticated_safe_bash_token".into())
                    };
                    st.gh_host = host.clone();
                    st.gh_token = token.clone();
                    let user = user_opt.unwrap_or_else(|| st.gh_user.clone());
                    st.gh_user = user.clone();
                    if let Some(p) = proto_opt {
                        st.gh_git_protocol = p.clone();
                        st.gh_config.insert("git_protocol".into(), p);
                    }
                    if let Some(sc) = scopes_opt {
                        st.gh_scopes = sc.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                    }
                    st.gh_logged_in = true;
                    let entry = GhHostAuthEntry {
                        user: user.clone(),
                        oauth_token: token.clone(),
                        git_protocol: st.gh_git_protocol.clone(),
                        scopes: st.gh_scopes.clone(),
                        active: true,
                    };
                    if let Some((_, entries)) = st.gh_hosts.iter_mut().find(|(h, _)| h == &host) {
                        for e in entries.iter_mut() {
                            e.active = false;
                        }
                        if let Some(existing) = entries.iter_mut().find(|e| e.user == user) {
                            *existing = entry;
                        } else {
                            entries.push(entry);
                        }
                    } else {
                        st.gh_hosts.push((host.clone(), vec![entry]));
                    }
                    let cfg_dir = env
                        .get("GH_CONFIG_DIR")
                        .cloned()
                        .unwrap_or_else(|| format!("{}/.config/gh", env.get("HOME").cloned().unwrap_or_else(|| "/home/user".into())));
                    let _ = fs.mkdir_all(&cfg_dir);
                    let mut hosts_yml = String::new();
                    for (h, entries) in &st.gh_hosts {
                        if let Some(act) = entries.iter().find(|e| e.active).or_else(|| entries.first()) {
                            hosts_yml.push_str(&format!(
                                "{h}:\n    user: {}\n    oauth_token: {}\n    git_protocol: {}\n",
                                act.user, act.oauth_token, act.git_protocol
                            ));
                        }
                    }
                    let _ = fs.write_file(&format!("{cfg_dir}/hosts.yml"), hosts_yml.as_bytes());
                    BuiltinOutcome {
                        stdout: format!("✓ Logged in as {user} on {host}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "logout" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    let Some(h_idx) = st.gh_hosts.iter().position(|(h, _)| h == &host) else {
                        return gh_err(&format!("not logged in to {host}"));
                    };
                    if let Some(u) = user_opt {
                        let entries = &mut st.gh_hosts[h_idx].1;
                        entries.retain(|e| e.user != u);
                        if entries.is_empty() {
                            st.gh_hosts.remove(h_idx);
                        } else if !entries.iter().any(|e| e.active) {
                            entries[0].active = true;
                            st.gh_user = entries[0].user.clone();
                            st.gh_token = entries[0].oauth_token.clone();
                        }
                        st.gh_logged_in = !st.gh_hosts.is_empty();
                        BuiltinOutcome {
                            stdout: format!("✓ Logged out of {host} account {u}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        }
                    } else {
                        st.gh_hosts.remove(h_idx);
                        st.gh_logged_in = !st.gh_hosts.is_empty();
                        if !st.gh_logged_in {
                            st.gh_token.clear();
                        }
                        BuiltinOutcome {
                            stdout: format!("✓ Logged out of {host}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        }
                    }
                }
                "setup-git" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    if let Some(git_root) = find_git_root_in_vfs(cwd, fs) {
                        let git_cfg = if git_root == "/" {
                            "/.git/config".to_string()
                        } else {
                            format!("{git_root}/.git/config")
                        };
                        let mut existing = fs
                            .read_file(&git_cfg)
                            .map(|b| String::from_utf8_lossy(&b).into_owned())
                            .unwrap_or_default();
                        let helper = format!("\n[credential \"https://{host}\"]\n\thelper = !gh auth git-credential\n");
                        if !existing.contains(&format!("credential \"https://{host}\"")) {
                            existing.push_str(&helper);
                            let _ = fs.write_file(&git_cfg, existing.as_bytes());
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Configured git credential helper for {host}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "switch" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    let Some((_, entries)) = st.gh_hosts.iter_mut().find(|(h, _)| h == &host) else {
                        return gh_err(&format!("not logged in to {host}"));
                    };
                    let target_user = if let Some(u) = user_opt {
                        let Some(found) = entries.iter().find(|e| e.user == u) else {
                            return gh_err(&format!("no account \"{u}\" found on {host}"));
                        };
                        found.user.clone()
                    } else if let Some(inactive) = entries.iter().find(|e| !e.active) {
                        inactive.user.clone()
                    } else if let Some(first_e) = entries.first() {
                        first_e.user.clone()
                    } else {
                        return gh_err(&format!("not logged in to {host}"));
                    };
                    for e in entries.iter_mut() {
                        e.active = e.user == target_user;
                        if e.active {
                            st.gh_user = e.user.clone();
                            st.gh_token = e.oauth_token.clone();
                            st.gh_git_protocol = e.git_protocol.clone();
                            st.gh_scopes = e.scopes.clone();
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Switched active account for {host} to {target_user}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "refresh" => {
                    let host = host_opt.unwrap_or_else(|| "github.com".into());
                    let Some((_, entries)) = st.gh_hosts.iter_mut().find(|(h, _)| h == &host) else {
                        return gh_err(&format!("not logged in to {host}"));
                    };
                    if let Some(sc) = scopes_opt {
                        for s in sc.split(',').map(|x| x.trim()).filter(|x| !x.is_empty()) {
                            if !st.gh_scopes.iter().any(|e| e == s) {
                                st.gh_scopes.push(s.to_string());
                            }
                        }
                    }
                    if let Some(act) = entries.iter_mut().find(|e| e.active) {
                        act.scopes = st.gh_scopes.clone();
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Authentication credentials refreshed for {host}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown auth subcommand \"{sub}\"")),
            }
        }
        "config" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let pos: Vec<&str> = args
                .iter()
                .skip(2)
                .enumerate()
                .filter(|(idx, a)| {
                    if a.starts_with('-') {
                        return false;
                    }
                    if *idx > 0 {
                        let prev = args[*idx + 1].as_str();
                        if prev == "-h" || prev == "--host" {
                            return false;
                        }
                    }
                    true
                })
                .map(|(_, a)| a.as_str())
                .collect();
            match sub {
                "list" => {
                    let mut out = String::new();
                    let default_keys = ["git_protocol", "editor", "prompt", "pager", "http_unix_socket", "browser"];
                    for k in default_keys {
                        if let Some(v) = st.gh_config.get(k) {
                            out.push_str(&format!("{k}={v}\n"));
                        }
                    }
                    for (k, v) in &st.gh_config {
                        if !default_keys.contains(&k.as_str()) {
                            out.push_str(&format!("{k}={v}\n"));
                        }
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "get" => {
                    let key = pos.first().copied().unwrap_or("");
                    let val = st.gh_config.get(key).cloned().unwrap_or_default();
                    BuiltinOutcome { stdout: format!("{val}\n"), stderr: String::new(), exit_code: 0 }
                }
                "set" => {
                    if let (Some(k), Some(v)) = (pos.first().copied(), pos.get(1).copied()) {
                        st.gh_config.insert(k.to_string(), v.to_string());
                        if k == "git_protocol" {
                            st.gh_git_protocol = v.to_string();
                        }
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "clear-cache" => BuiltinOutcome {
                    stdout: "✓ Cleared the cache\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                },
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
                    let is_shell = args.iter().skip(2).any(|a| a == "-s" || a == "--shell");
                    let pos: Vec<&str> = args.iter().skip(2).filter(|a| !a.starts_with('-')).map(|s| s.as_str()).collect();
                    if let (Some(k), Some(v)) = (pos.first().copied(), pos.get(1).copied()) {
                        let exp = if is_shell { format!("!{v}") } else { v.to_string() };
                        if let Some(existing) = st.gh_aliases.iter_mut().find(|(ak, _)| ak == k) {
                            existing.1 = exp.clone();
                        } else {
                            st.gh_aliases.push((k.to_string(), exp.clone()));
                        }
                        return BuiltinOutcome {
                            stdout: format!("✓ Added alias for {k}: {exp}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "delete" => {
                    if args.iter().skip(2).any(|a| a == "--all") {
                        st.gh_aliases.clear();
                        return BuiltinOutcome {
                            stdout: "✓ Deleted all aliases\n".into(),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let k = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_default();
                    let Some(idx) = st.gh_aliases.iter().position(|(ak, _)| ak == &k) else {
                        return gh_err(&format!("no such alias {k}"));
                    };
                    st.gh_aliases.remove(idx);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted alias {k}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "repo" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("view");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" | "ls" => {
                    let arr: Vec<Value> = st
                        .gh_repos
                        .values()
                        .map(|r| {
                            jval!({
                                "name": r.name,
                                "nameWithOwner": format!("{}/{}", r.owner, r.name),
                                "description": r.description,
                                "homepageUrl": r.homepage_url,
                                "visibility": r.visibility,
                                "isPrivate": r.is_private,
                                "isArchived": r.is_archived,
                                "isTemplate": r.is_template,
                                "defaultBranchRef": { "name": r.default_branch },
                                "repositoryTopics": r.topics.iter().map(|t| jval!({ "name": t })).collect::<Vec<_>>(),
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
                            "homepageUrl": r.homepage_url,
                            "visibility": r.visibility,
                            "isPrivate": r.is_private,
                            "isArchived": r.is_archived,
                            "isTemplate": r.is_template,
                            "hasIssuesEnabled": r.has_issues_enabled,
                            "hasWikiEnabled": r.has_wiki_enabled,
                            "hasProjectsEnabled": r.has_projects_enabled,
                            "hasDiscussionsEnabled": r.has_discussions_enabled,
                            "mergeCommitAllowed": r.merge_commit_allowed,
                            "squashMergeAllowed": r.squash_merge_allowed,
                            "rebaseMergeAllowed": r.rebase_merge_allowed,
                            "autoMergeAllowed": r.auto_merge_allowed,
                            "deleteBranchOnMerge": r.delete_branch_on_merge,
                            "defaultBranchRef": { "name": r.default_branch },
                            "repositoryTopics": r.topics.iter().map(|t| jval!({ "name": t })).collect::<Vec<_>>(),
                            "owner": { "login": r.owner },
                            "sshUrl": format!("git@github.com:{}/{}.git", r.owner, r.name),
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
                "create" | "new" => {
                    let mut name_arg: Option<String> = None;
                    let mut is_private = false;
                    let mut visibility = "PUBLIC".to_string();
                    let mut desc = String::new();
                    let mut homepage = String::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-d" | "--description" if i + 1 < args.len() => {
                                desc = args[i + 1].clone();
                                i += 2;
                            }
                            "-h" | "--homepage" if i + 1 < args.len() => {
                                homepage = args[i + 1].clone();
                                i += 2;
                            }
                            "--private" => {
                                is_private = true;
                                visibility = "PRIVATE".into();
                                i += 1;
                            }
                            "--internal" => {
                                is_private = true;
                                visibility = "INTERNAL".into();
                                i += 1;
                            }
                            "--public" => {
                                is_private = false;
                                visibility = "PUBLIC".into();
                                i += 1;
                            }
                            "-g" | "--gitignore" | "-l" | "--license" | "-r" | "--remote" | "-s" | "--source" | "-p" | "--template" | "-t" | "--team" => {
                                i += 2;
                            }
                            a if !a.starts_with('-') => {
                                if name_arg.is_none() {
                                    name_arg = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let name_arg = name_arg.unwrap_or_else(|| "new-repo".into());
                    let (owner, name) = if let Some((o, n)) = name_arg.split_once('/') {
                        (o.to_string(), n.to_string())
                    } else {
                        (st.gh_user.clone(), name_arg)
                    };
                    let full = format!("{owner}/{name}");
                    st.gh_next_id += 7;
                    st.gh_repos.insert(
                        full.clone(),
                        GhRepoRecord {
                            owner,
                            name,
                            description: desc,
                            homepage_url: homepage,
                            visibility,
                            is_private,
                            is_archived: false,
                            is_template: false,
                            has_issues_enabled: true,
                            has_wiki_enabled: true,
                            has_projects_enabled: true,
                            has_discussions_enabled: false,
                            merge_commit_allowed: true,
                            squash_merge_allowed: true,
                            rebase_merge_allowed: true,
                            auto_merge_allowed: true,
                            delete_branch_on_merge: false,
                            topics: Vec::new(),
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
                            workflows: default_gh_workflows(),
                            workflow_runs: Vec::new(),
                            caches: Vec::new(),
                            deploy_keys: Vec::new(),
                            autolinks: Vec::new(),
                        },
                    );
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "edit" => {
                    let mut pos_repo: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-d" | "--description" | "-h" | "--homepage" | "--default-branch" | "--visibility"
                            | "--add-topic" | "--remove-topic" | "-R" | "--repo" => {
                                if i + 1 < args.len() {
                                    i += 2;
                                } else {
                                    i += 1;
                                }
                            }
                            "--enable-issues" | "--enable-wiki" | "--enable-projects" | "--enable-discussions"
                            | "--enable-auto-merge" | "--enable-merge-commit" | "--enable-squash-merge"
                            | "--enable-rebase-merge" | "--delete-branch-on-merge" | "--template" => {
                                if i + 1 < args.len() && (args[i + 1] == "true" || args[i + 1] == "false") {
                                    i += 2;
                                } else {
                                    i += 1;
                                }
                            }
                            a if !a.starts_with('-') => {
                                if pos_repo.is_none() {
                                    pos_repo = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let full = resolve_gh_repo_key(st, pos_repo.as_deref().or(repo_flag.as_deref()), env);
                    let repo = st.gh_repos.get_mut(&full).unwrap();
                    let parse_b = |val: Option<&String>| -> bool {
                        match val.map(|s| s.as_str()) {
                            Some("false") | Some("0") => false,
                            _ => true,
                        }
                    };
                    let mut i = 2usize;
                    while i < args.len() {
                        let a = args[i].as_str();
                        let (flag, eq_val) = if let Some((k, v)) = a.split_once('=') {
                            (k, Some(v.to_string()))
                        } else {
                            (a, None)
                        };
                        let is_bool_flag = matches!(
                            flag,
                            "--enable-issues"
                                | "--enable-wiki"
                                | "--enable-projects"
                                | "--enable-discussions"
                                | "--enable-auto-merge"
                                | "--enable-merge-commit"
                                | "--enable-squash-merge"
                                | "--enable-rebase-merge"
                                | "--delete-branch-on-merge"
                                | "--template"
                        );
                        let next_val = eq_val.clone().or_else(|| {
                            let cand = args.get(i + 1)?;
                            if is_bool_flag {
                                if cand == "true" || cand == "false" {
                                    Some(cand.clone())
                                } else {
                                    None
                                }
                            } else {
                                Some(cand.clone())
                            }
                        });
                        let step = if eq_val.is_some() {
                            1
                        } else if next_val.is_some() {
                            2
                        } else {
                            1
                        };
                        match flag {
                            "-d" | "--description" => {
                                if let Some(v) = next_val {
                                    repo.description = v;
                                }
                                i += step;
                            }
                            "-h" | "--homepage" => {
                                if let Some(v) = next_val {
                                    repo.homepage_url = v;
                                }
                                i += step;
                            }
                            "--default-branch" => {
                                if let Some(v) = next_val {
                                    repo.default_branch = v;
                                }
                                i += step;
                            }
                            "--visibility" => {
                                if let Some(v) = next_val {
                                    let up = v.to_ascii_uppercase();
                                    repo.is_private = up != "PUBLIC";
                                    repo.visibility = up;
                                }
                                i += step;
                            }
                            "--enable-issues" => {
                                repo.has_issues_enabled = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-wiki" => {
                                repo.has_wiki_enabled = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-projects" => {
                                repo.has_projects_enabled = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-discussions" => {
                                repo.has_discussions_enabled = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-auto-merge" => {
                                repo.auto_merge_allowed = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-merge-commit" => {
                                repo.merge_commit_allowed = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-squash-merge" => {
                                repo.squash_merge_allowed = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--enable-rebase-merge" => {
                                repo.rebase_merge_allowed = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--delete-branch-on-merge" => {
                                repo.delete_branch_on_merge = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--template" => {
                                repo.is_template = parse_b(next_val.as_ref());
                                i += step;
                            }
                            "--add-topic" => {
                                if let Some(v) = next_val {
                                    for t in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        if !repo.topics.iter().any(|x| x == t) {
                                            repo.topics.push(t.to_string());
                                        }
                                    }
                                }
                                i += step;
                            }
                            "--remove-topic" => {
                                if let Some(v) = next_val {
                                    for t in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        repo.topics.retain(|x| x != t);
                                    }
                                }
                                i += step;
                            }
                            _ => i += 1,
                        }
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Edited repository {full}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let pos_repo = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let full = resolve_gh_repo_key(st, pos_repo.as_deref().or(repo_flag.as_deref()), env);
                    st.gh_repos.remove(&full);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted repository {full}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "archive" | "unarchive" => {
                    let pos_repo = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned();
                    let full = resolve_gh_repo_key(st, pos_repo.as_deref().or(repo_flag.as_deref()), env);
                    if let Some(r) = st.gh_repos.get_mut(&full) {
                        r.is_archived = sub == "archive";
                    }
                    let verb = if sub == "archive" { "Archived" } else { "Unarchived" };
                    BuiltinOutcome {
                        stdout: format!("✓ {verb} repository {full}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "rename" => {
                    let new_name = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "renamed-repo".into());
                    let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
                    if let Some(mut r) = st.gh_repos.remove(&full) {
                        let new_full = format!("{}/{new_name}", r.owner);
                        r.name = new_name;
                        st.gh_repos.insert(new_full.clone(), r);
                        return BuiltinOutcome {
                            stdout: format!("✓ Renamed repository to {new_full}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "set-default" => {
                    let Some(git_root) = find_git_root_in_vfs(cwd, fs) else {
                        return gh_err("gh repo set-default: not a git repository");
                    };
                    let git_cfg = if git_root == "/" {
                        "/.git/config".to_string()
                    } else {
                        format!("{git_root}/.git/config")
                    };
                    if args.iter().skip(2).any(|a| a == "-u" || a == "--unset") {
                        st.gh_default_repo = None;
                        if let Ok(bytes) = fs.read_file(&git_cfg) {
                            let content = String::from_utf8_lossy(&bytes);
                            let filtered: Vec<&str> = content
                                .lines()
                                .filter(|l| !l.trim().starts_with("gh-resolved ="))
                                .collect();
                            let _ = fs.write_file(&git_cfg, format!("{}\n", filtered.join("\n")).as_bytes());
                        }
                        return BuiltinOutcome {
                            stdout: "✓ Unset default repository\n".into(),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    if args.iter().skip(2).any(|a| a == "-v" || a == "--view") {
                        let Some(d) = st.gh_default_repo.clone() else {
                            return BuiltinOutcome {
                                stdout: "no default repository has been set; use `gh repo set-default` to select one\n".into(),
                                stderr: String::new(),
                                exit_code: 0,
                            };
                        };
                        return BuiltinOutcome {
                            stdout: format!("{d}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let target = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "octocat/Hello-World".into());
                    st.gh_default_repo = Some(target.clone());
                    let mut existing = fs
                        .read_file(&git_cfg)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                        .unwrap_or_default();
                    existing.push_str(&format!("\n[remote \"origin\"]\n\tgh-resolved = {target}\n"));
                    let _ = fs.write_file(&git_cfg, existing.as_bytes());
                    BuiltinOutcome {
                        stdout: format!("✓ Set {target} as the default repository for the current directory\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "deploy-key" => {
                    let dsub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
                    match dsub {
                        "list" | "ls" => {
                            let repo = st.gh_repos.get(&full).unwrap();
                            if let Some(fields) = &json_fields {
                                let arr: Vec<Value> = repo
                                    .deploy_keys
                                    .iter()
                                    .map(|k| {
                                        jval!({
                                            "id": k.id,
                                            "title": k.title,
                                            "key": k.key,
                                            "readOnly": k.read_only,
                                            "createdAt": k.created_at
                                        })
                                    })
                                    .collect();
                                drop(map);
                                return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                            }
                            let mut out = String::new();
                            for k in &repo.deploy_keys {
                                let ro = if k.read_only { "read-only" } else { "read-write" };
                                out.push_str(&format!("{}\t{}\t{ro}\t{}\t{}\n", k.id, k.title, k.key, k.created_at));
                            }
                            BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                        }
                        "add" => {
                            let mut title = String::new();
                            let mut allow_write = false;
                            let mut key_file: Option<String> = None;
                            let mut i = 3usize;
                            while i < args.len() {
                                match args[i].as_str() {
                                    "-t" | "--title" if i + 1 < args.len() => {
                                        title = args[i + 1].clone();
                                        i += 2;
                                    }
                                    "-w" | "--allow-write" => {
                                        allow_write = true;
                                        i += 1;
                                    }
                                    "-R" | "--repo" => i += 2,
                                    a if !a.starts_with('-') => {
                                        if key_file.is_none() {
                                            key_file = Some(a.to_string());
                                        }
                                        i += 1;
                                    }
                                    _ => i += 1,
                                }
                            }
                            let key_content = match key_file.as_deref() {
                                None | Some("-") => stdin.trim().to_string(),
                                Some(p) => {
                                    let resolved = resolve_posix_path(cwd, p);
                                    match fs.read_file(&resolved) {
                                        Ok(b) => String::from_utf8_lossy(&b).trim().to_string(),
                                        Err(_) => return gh_err(&format!("{p}: No such file or directory")),
                                    }
                                }
                            };
                            if title.is_empty() {
                                title = key_file.unwrap_or_else(|| "deploy-key".into());
                            }
                            st.gh_next_id += 1;
                            let id = st.gh_next_id;
                            let repo = st.gh_repos.get_mut(&full).unwrap();
                            repo.deploy_keys.push(GhDeployKeyRecord {
                                id,
                                title,
                                key: key_content,
                                read_only: !allow_write,
                                created_at: "2026-09-28T12:00:00Z".into(),
                            });
                            BuiltinOutcome {
                                stdout: format!("✓ Deploy key added to {full}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "delete" => {
                            let id_str = args.iter().skip(3).find(|a| !a.starts_with('-')).cloned().unwrap_or_default();
                            let repo = st.gh_repos.get_mut(&full).unwrap();
                            repo.deploy_keys.retain(|k| k.id.to_string() != id_str);
                            BuiltinOutcome {
                                stdout: format!("✓ Deploy key {id_str} deleted from {full}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
                    }
                }
                "autolink" => {
                    let asub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
                    match asub {
                        "list" | "ls" => {
                            let repo = st.gh_repos.get(&full).unwrap();
                            if let Some(fields) = &json_fields {
                                let arr: Vec<Value> = repo
                                    .autolinks
                                    .iter()
                                    .map(|a| {
                                        jval!({
                                            "id": a.id,
                                            "keyPrefix": a.key_prefix,
                                            "urlTemplate": a.url_template,
                                            "isAlphanumeric": a.is_alphanumeric
                                        })
                                    })
                                    .collect();
                                drop(map);
                                return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                            }
                            let mut out = String::new();
                            for a in &repo.autolinks {
                                out.push_str(&format!("{}\t{}\t{}\t{}\n", a.id, a.key_prefix, a.url_template, a.is_alphanumeric));
                            }
                            BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                        }
                        "create" => {
                            let numeric = args.iter().skip(3).any(|a| a == "-n" || a == "--numeric");
                            let pos: Vec<&str> = args
                                .iter()
                                .skip(3)
                                .filter(|a| !a.starts_with('-'))
                                .map(|s| s.as_str())
                                .collect();
                            let prefix = pos.first().copied().unwrap_or("TICKET-").to_string();
                            let tpl = pos.get(1).copied().unwrap_or("https://example.com/TICKET?query=<num>").to_string();
                            st.gh_next_id += 1;
                            let id = st.gh_next_id;
                            let repo = st.gh_repos.get_mut(&full).unwrap();
                            repo.autolinks.push(GhAutolinkRecord {
                                id,
                                key_prefix: prefix.clone(),
                                url_template: tpl,
                                is_alphanumeric: !numeric,
                            });
                            BuiltinOutcome {
                                stdout: format!("✓ Created autolink {id} for {full}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "view" => {
                            let id_str = args.iter().skip(3).find(|a| !a.starts_with('-')).cloned().unwrap_or_default();
                            let repo = st.gh_repos.get(&full).unwrap();
                            let Some(al) = repo.autolinks.iter().find(|a| a.id.to_string() == id_str).cloned() else {
                                return gh_err(&format!("autolink {id_str} not found"));
                            };
                            drop(map);
                            if let Some(fields) = &json_fields {
                                let obj = jval!({
                                    "id": al.id,
                                    "keyPrefix": al.key_prefix,
                                    "urlTemplate": al.url_template,
                                    "isAlphanumeric": al.is_alphanumeric
                                });
                                return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                            }
                            BuiltinOutcome {
                                stdout: format!(
                                    "ID: {}\nKey Prefix: {}\nURL Template: {}\nAlphanumeric: {}\n",
                                    al.id, al.key_prefix, al.url_template, al.is_alphanumeric
                                ),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "delete" => {
                            let id_str = args.iter().skip(3).find(|a| !a.starts_with('-')).cloned().unwrap_or_default();
                            let repo = st.gh_repos.get_mut(&full).unwrap();
                            repo.autolinks.retain(|a| a.id.to_string() != id_str);
                            BuiltinOutcome {
                                stdout: format!("✓ Deleted autolink {id_str} from {full}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
                    }
                }
                "gitignore" => {
                    let gsub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    if gsub == "list" {
                        return BuiltinOutcome {
                            stdout: "Node\nPython\nRust\nGo\nTypeScript\n".into(),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let tpl = args.get(3).map(|s| s.as_str()).unwrap_or("Node");
                    BuiltinOutcome {
                        stdout: format!("# {tpl}\nnode_modules/\ndist/\n.env\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "license" => {
                    let lsub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
                    if lsub == "list" {
                        return BuiltinOutcome {
                            stdout: "mit\tMIT License\napache-2.0\tApache License 2.0\ngpl-3.0\tGNU General Public License v3.0\n".into(),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let key = args.get(3).map(|s| s.as_str()).unwrap_or("mit");
                    BuiltinOutcome {
                        stdout: format!("{} License\n\nPermission is hereby granted, free of charge...\n", key.to_ascii_uppercase()),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "credits" => {
                    BuiltinOutcome {
                        stdout: "Contributors: octocat\n".into(),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "issue" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let gh_user = st.gh_user.clone();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            match sub {
                "create" => {
                    let mut title = "Untitled issue".to_string();
                    let mut body = String::new();
                    let mut labels = Vec::new();
                    let mut assignees = Vec::new();
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
                            "-a" | "--assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    assignees.extend(
                                        v.split(',')
                                            .map(|s| s.trim())
                                            .filter(|s| !s.is_empty())
                                            .map(|s| if s == "@me" { gh_user.clone() } else { s.to_string() }),
                                    );
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
                        assignees,
                        is_pinned: false,
                        comments: Vec::new(),
                        linked_branches: Vec::new(),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/issues/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" | "ls" => {
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
                                "isPinned": iss.is_pinned,
                                "url": format!("https://github.com/{full}/issues/{}", iss.number),
                                "labels": iss.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>(),
                                "assignees": iss.assignees.iter().map(|a| jval!({ "login": a })).collect::<Vec<_>>()
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
                            "isPinned": iss.is_pinned,
                            "url": format!("https://github.com/{full}/issues/{}", iss.number),
                            "labels": iss.labels.iter().map(|l| jval!({ "name": l })).collect::<Vec<_>>(),
                            "assignees": iss.assignees.iter().map(|a| jval!({ "login": a })).collect::<Vec<_>>(),
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
                            "--add-assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    for a in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        let login = if a == "@me" { gh_user.clone() } else { a.to_string() };
                                        if !iss.assignees.iter().any(|x| x == &login) {
                                            iss.assignees.push(login);
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--remove-assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    for a in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        let login = if a == "@me" { gh_user.clone() } else { a.to_string() };
                                        iss.assignees.retain(|x| x != &login);
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
                "pin" | "unpin" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    iss.is_pinned = sub == "pin";
                    let verb = if sub == "pin" { "Pinned" } else { "Unpinned" };
                    BuiltinOutcome {
                        stdout: format!("✓ {verb} issue #{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "lock" | "unlock" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(_iss) = repo.issues.iter().find(|i| i.number == num) else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    let verb = if sub == "lock" { "Locked" } else { "Unlocked" };
                    BuiltinOutcome {
                        stdout: format!("✓ {verb} issue #{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "transfer" => {
                    let pos: Vec<&str> = args
                        .iter()
                        .skip(2)
                        .enumerate()
                        .filter(|(idx, a)| {
                            if a.starts_with('-') {
                                return false;
                            }
                            if *idx > 0 {
                                let prev = args[*idx + 1].as_str();
                                if prev == "-R" || prev == "--repo" {
                                    return false;
                                }
                            }
                            true
                        })
                        .map(|(_, s)| s.as_str())
                        .collect();
                    let num: u64 = pos.first().and_then(|s| s.parse().ok()).unwrap_or(1);
                    let dest = pos.get(1).copied().unwrap_or("octocat/Hello-World").to_string();
                    let Some(idx) = repo.issues.iter().position(|i| i.number == num) else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    let mut moved = repo.issues.remove(idx);
                    let dest_full = resolve_gh_repo_key(st, Some(&dest), env);
                    let dest_repo = st.gh_repos.get_mut(&dest_full).unwrap();
                    let new_num = dest_repo.next_number;
                    dest_repo.next_number += 1;
                    moved.number = new_num;
                    dest_repo.issues.push(moved);
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{dest_full}/issues/{new_num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "develop" => {
                    let mut branch_name: Option<String> = None;
                    let mut list_flag = false;
                    let mut num: u64 = 1;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-n" | "--name" if i + 1 < args.len() => {
                                branch_name = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-b" | "--base" | "-R" | "--repo" => i += 2,
                            "-l" | "--list" => {
                                list_flag = true;
                                i += 1;
                            }
                            a if !a.starts_with('-') => {
                                if let Ok(n) = a.parse::<u64>() {
                                    num = n;
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let Some(iss) = repo.issues.iter_mut().find(|i| i.number == num) else {
                        return gh_err(&format!("issue #{num} not found"));
                    };
                    if list_flag {
                        let mut out = String::new();
                        for b in &iss.linked_branches {
                            out.push_str(&format!("{b}\thttps://github.com/{full}/tree/{b}\n"));
                        }
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let mut slug = String::new();
                    let mut prev_dash = false;
                    for c in iss.title.chars() {
                        if c.is_ascii_alphanumeric() {
                            slug.push(c.to_ascii_lowercase());
                            prev_dash = false;
                        } else if !prev_dash && !slug.is_empty() {
                            slug.push('-');
                            prev_dash = true;
                        }
                    }
                    let slug = slug.trim_matches('-');
                    let bname = branch_name.unwrap_or_else(|| format!("{num}-{slug}"));
                    if !iss.linked_branches.iter().any(|b| b == &bname) {
                        iss.linked_branches.push(bname.clone());
                    }
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/tree/{bname}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "status" => {
                    let open: Vec<&GhIssueRecord> = repo.issues.iter().filter(|i| i.state == "OPEN").collect();
                    let assigned_open: Vec<&&GhIssueRecord> = open
                        .iter()
                        .filter(|i| i.assignees.iter().any(|a| a == &gh_user))
                        .collect();
                    if let Some(fields) = &json_fields {
                        let assigned_arr: Vec<Value> = assigned_open
                            .iter()
                            .map(|iss| {
                                jval!({
                                    "number": iss.number,
                                    "title": iss.title,
                                    "state": iss.state,
                                    "url": format!("https://github.com/{full}/issues/{}", iss.number)
                                })
                            })
                            .collect();
                        let created_arr: Vec<Value> = open
                            .iter()
                            .map(|iss| {
                                jval!({
                                    "number": iss.number,
                                    "title": iss.title,
                                    "state": iss.state,
                                    "url": format!("https://github.com/{full}/issues/{}", iss.number)
                                })
                            })
                            .collect();
                        let obj = jval!({
                            "assigned": assigned_arr,
                            "mentioned": [],
                            "createdBy": created_arr
                        });
                        drop(map);
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let assigned_body = if assigned_open.is_empty() {
                        "  There are no issues assigned to you".to_string()
                    } else {
                        assigned_open.iter().map(|i| format!("  #{}  {}", i.number, i.title)).collect::<Vec<_>>().join("\n")
                    };
                    let created_body = if open.is_empty() {
                        "  There are no issues created by you".to_string()
                    } else {
                        open.iter().map(|i| format!("  #{}  {}", i.number, i.title)).collect::<Vec<_>>().join("\n")
                    };
                    BuiltinOutcome {
                        stdout: format!("Relevant issues in {full}\n\nAssigned to you\n{assigned_body}\n\nCreated by you\n{created_body}\n"),
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
            let gh_user = st.gh_user.clone();
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
                    let mut assignees = Vec::new();
                    let mut reviewers = Vec::new();
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
                            "-a" | "--assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    assignees.extend(
                                        v.split(',')
                                            .map(|s| s.trim())
                                            .filter(|s| !s.is_empty())
                                            .map(|s| if s == "@me" { gh_user.clone() } else { s.to_string() }),
                                    );
                                }
                                i += 2;
                            }
                            "-r" | "--reviewer" => {
                                if let Some(v) = args.get(i + 1) {
                                    reviewers.extend(
                                        v.split(',')
                                            .map(|s| s.trim())
                                            .filter(|s| !s.is_empty())
                                            .map(|s| s.to_string()),
                                    );
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
                        assignees,
                        reviewers,
                        comments: Vec::new(),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/pull/{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" | "ls" => {
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
                                "assignees": pr.assignees.iter().map(|a| jval!({ "login": a })).collect::<Vec<_>>(),
                                "reviewRequests": pr.reviewers.iter().map(|r| jval!({ "login": r })).collect::<Vec<_>>(),
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
                            "assignees": pr.assignees.iter().map(|a| jval!({ "login": a })).collect::<Vec<_>>(),
                            "reviewRequests": pr.reviewers.iter().map(|r| jval!({ "login": r })).collect::<Vec<_>>(),
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
                            "--add-assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    for a in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        let login = if a == "@me" { gh_user.clone() } else { a.to_string() };
                                        if !pr.assignees.iter().any(|x| x == &login) {
                                            pr.assignees.push(login);
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--remove-assignee" => {
                                if let Some(v) = args.get(i + 1) {
                                    for a in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        let login = if a == "@me" { gh_user.clone() } else { a.to_string() };
                                        pr.assignees.retain(|x| x != &login);
                                    }
                                }
                                i += 2;
                            }
                            "--add-reviewer" => {
                                if let Some(v) = args.get(i + 1) {
                                    for r in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        if !pr.reviewers.iter().any(|x| x == r) {
                                            pr.reviewers.push(r.to_string());
                                        }
                                    }
                                }
                                i += 2;
                            }
                            "--remove-reviewer" => {
                                if let Some(v) = args.get(i + 1) {
                                    for r in v.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                                        pr.reviewers.retain(|x| x != r);
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
                "lock" | "unlock" => {
                    let num: u64 = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let Some(_pr) = repo.prs.iter().find(|p| p.number == num) else {
                        return gh_err(&format!("pull request #{num} not found"));
                    };
                    let verb = if sub == "lock" { "Locked" } else { "Unlocked" };
                    BuiltinOutcome {
                        stdout: format!("✓ {verb} pull request #{num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "status" => {
                    let open: Vec<&GhPrRecord> = repo.prs.iter().filter(|p| p.state == "OPEN").collect();
                    let cur_branch = find_git_root_in_vfs(cwd, fs)
                        .and_then(|root| {
                            let head_path = if root == "/" { "/.git/HEAD".to_string() } else { format!("{root}/.git/HEAD") };
                            fs.read_file(&head_path).ok()
                        })
                        .map(|b| {
                            let s = String::from_utf8_lossy(&b).trim().to_string();
                            s.strip_prefix("ref: refs/heads/").unwrap_or(&s).to_string()
                        })
                        .unwrap_or_else(|| "main".to_string());
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = open
                            .iter()
                            .map(|pr| {
                                jval!({
                                    "number": pr.number,
                                    "title": pr.title,
                                    "state": pr.state,
                                    "headRefName": pr.head,
                                    "baseRefName": pr.base,
                                    "isDraft": pr.is_draft,
                                    "url": format!("https://github.com/{full}/pull/{}", pr.number)
                                })
                            })
                            .collect();
                        let cur_pr = open
                            .iter()
                            .copied()
                            .find(|pr| pr.head == cur_branch)
                            .or_else(|| repo.prs.iter().find(|pr| pr.head == cur_branch));
                        let current_branch = cur_pr
                            .map(|pr| {
                                jval!({
                                    "number": pr.number,
                                    "title": pr.title,
                                    "state": pr.state,
                                    "headRefName": pr.head,
                                    "baseRefName": pr.base,
                                    "isDraft": pr.is_draft,
                                    "url": format!("https://github.com/{full}/pull/{}", pr.number)
                                })
                            })
                            .unwrap_or(JVal::Null);
                        let obj = jval!({
                            "currentBranch": current_branch,
                            "createdBy": arr,
                            "needsReview": []
                        });
                        drop(map);
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let body = if open.is_empty() {
                        "  There are no pull requests created by you".to_string()
                    } else {
                        open.iter().map(|p| format!("  #{}  {} [{}]", p.number, p.title, p.head)).collect::<Vec<_>>().join("\n")
                    };
                    BuiltinOutcome {
                        stdout: format!("Relevant pull requests in {full}\n\nCreated by you\n{body}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "update-branch" => {
                    let num_opt = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse::<u64>().ok());
                    let pr_opt = match num_opt {
                        Some(n) => repo.prs.iter().find(|p| p.number == n),
                        None => repo.prs.first(),
                    };
                    let Some(pr) = pr_opt else {
                        return gh_err(&format!("pull request #{} not found", num_opt.unwrap_or(1)));
                    };
                    BuiltinOutcome {
                        stdout: format!("✓ Pull request #{} branch updated\n", pr.number),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "revert" => {
                    let mut title_opt: Option<String> = None;
                    let mut body_opt: Option<String> = None;
                    let mut draft = false;
                    let mut num_opt: Option<u64> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" if i + 1 < args.len() => {
                                title_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-b" | "--body" if i + 1 < args.len() => {
                                body_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-d" | "--draft" => {
                                draft = true;
                                i += 1;
                            }
                            "-R" | "--repo" => i += 2,
                            a if !a.starts_with('-') => {
                                if num_opt.is_none() {
                                    num_opt = a.parse::<u64>().ok();
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let orig_opt = match num_opt {
                        Some(n) => repo.prs.iter().find(|p| p.number == n).cloned(),
                        None => repo.prs.first().cloned(),
                    };
                    let Some(orig) = orig_opt else {
                        return gh_err(&format!("pull request #{} not found", num_opt.unwrap_or(1)));
                    };
                    if orig.state != "MERGED" {
                        return gh_err(&format!("pull request #{} is not merged and cannot be reverted", orig.number));
                    }
                    let rev_num = repo.next_number;
                    repo.next_number += 1;
                    repo.prs.push(GhPrRecord {
                        number: rev_num,
                        title: title_opt.unwrap_or_else(|| format!("Revert \"{}\"", orig.title)),
                        body: body_opt.unwrap_or_else(|| format!("Reverts {full}#{}", orig.number)),
                        state: "OPEN".into(),
                        head: format!("revert-{}-{}", orig.number, orig.head),
                        base: orig.base,
                        is_draft: draft,
                        labels: Vec::new(),
                        assignees: Vec::new(),
                        reviewers: Vec::new(),
                        comments: Vec::new(),
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/pull/{rev_num}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "checks" => {
                    let num_opt = args.iter().skip(2).find(|a| !a.starts_with('-')).and_then(|s| s.parse::<u64>().ok());
                    let pr_opt = match num_opt {
                        Some(n) => repo.prs.iter().find(|p| p.number == n).cloned(),
                        None => repo.prs.first().cloned(),
                    };
                    let Some(_pr) = pr_opt else {
                        return gh_err(&format!("pull request #{} not found", num_opt.unwrap_or(1)));
                    };
                    drop(map);
                    if let Some(fields) = &json_fields {
                        let arr = vec![
                            jval!({
                                "bucket": "pass",
                                "name": "build",
                                "state": "SUCCESS",
                                "workflow": "CI",
                                "description": "Build succeeded",
                                "link": format!("https://github.com/{full}/actions/runs/1"),
                                "event": "pull_request",
                                "startedAt": "2026-09-28T12:00:00Z",
                                "completedAt": "2026-09-28T12:00:01Z"
                            }),
                            jval!({
                                "bucket": "pass",
                                "name": "test",
                                "state": "SUCCESS",
                                "workflow": "CI",
                                "description": "All tests passed",
                                "link": format!("https://github.com/{full}/actions/runs/1"),
                                "event": "pull_request",
                                "startedAt": "2026-09-28T12:00:00Z",
                                "completedAt": "2026-09-28T12:00:01Z"
                            }),
                        ];
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!(
                            "build\tpass\t1s\thttps://github.com/{full}/actions/runs/1\tBuild succeeded\ntest\tpass\t1s\thttps://github.com/{full}/actions/runs/1\tAll tests passed\n"
                        ),
                        stderr: String::new(),
                        exit_code: 0,
                    }
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
                    let mut pos: Vec<String> = Vec::new();
                    let mut title_opt: Option<String> = None;
                    let mut notes = String::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" if i + 1 < args.len() => {
                                title_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-n" | "--notes" if i + 1 < args.len() => {
                                notes = args[i + 1].clone();
                                i += 2;
                            }
                            "-F" | "--notes-file" if i + 1 < args.len() => {
                                let p = resolve_posix_path(cwd, &args[i + 1]);
                                if let Ok(b) = fs.read_file(&p) {
                                    notes = String::from_utf8_lossy(&b).into_owned();
                                }
                                i += 2;
                            }
                            "-R" | "--repo" | "--target" => i += 2,
                            a if !a.starts_with('-') => {
                                pos.push(a.to_string());
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let tag = pos.first().cloned().unwrap_or_else(|| "v1.0.0".into());
                    let title = title_opt.unwrap_or_else(|| tag.clone());
                    let mut assets = Vec::new();
                    for file_arg in pos.iter().skip(1) {
                        let (path_part, _) = file_arg.split_once('#').unwrap_or((file_arg.as_str(), ""));
                        let name = path_part.rsplit('/').next().unwrap_or(path_part).to_string();
                        let resolved = resolve_posix_path(cwd, path_part);
                        let data = fs.read_file(&resolved).unwrap_or_default();
                        let size = data.len();
                        assets.push((
                            name.clone(),
                            size,
                            format!("https://github.com/{full}/releases/download/{tag}/{name}"),
                            data,
                        ));
                    }
                    repo.releases.push(GhReleaseRecord {
                        tag_name: tag.clone(),
                        name: title,
                        body: notes,
                        is_draft: args.iter().any(|a| a == "-d" || a == "--draft"),
                        is_prerelease: args.iter().any(|a| a == "-p" || a == "--prerelease"),
                        assets,
                    });
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/releases/tag/{tag}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" | "ls" => {
                    let arr: Vec<Value> = repo
                        .releases
                        .iter()
                        .map(|rel| {
                            jval!({
                                "tagName": rel.tag_name,
                                "name": rel.name,
                                "body": rel.body,
                                "isDraft": rel.is_draft,
                                "isPrerelease": rel.is_prerelease,
                                "assets": rel.assets.iter().map(|(n, sz, u, _)| jval!({ "name": n, "size": *sz, "url": u })).collect::<Vec<_>>()
                            })
                        })
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
                        let obj = jval!({
                            "tagName": rel.tag_name,
                            "name": rel.name,
                            "body": rel.body,
                            "isDraft": rel.is_draft,
                            "isPrerelease": rel.is_prerelease,
                            "assets": rel.assets.iter().map(|(n, sz, u, _)| jval!({ "name": n, "size": *sz, "url": u })).collect::<Vec<_>>(),
                            "url": format!("https://github.com/{full}/releases/tag/{}", rel.tag_name)
                        });
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
                "upload" => {
                    let pos: Vec<&str> = args
                        .iter()
                        .skip(2)
                        .filter(|a| !a.starts_with('-'))
                        .map(|s| s.as_str())
                        .collect();
                    let tag = pos.first().copied().unwrap_or("");
                    let Some(rel) = repo.releases.iter_mut().find(|r| r.tag_name == tag) else {
                        return gh_err("release not found");
                    };
                    for file_arg in pos.iter().skip(1) {
                        let (path_part, _) = file_arg.split_once('#').unwrap_or((*file_arg, ""));
                        let name = path_part.rsplit('/').next().unwrap_or(path_part).to_string();
                        let resolved = resolve_posix_path(cwd, path_part);
                        let data = fs.read_file(&resolved).unwrap_or_default();
                        let size = data.len();
                        rel.assets.retain(|(n, _, _, _)| n != &name);
                        rel.assets.push((
                            name.clone(),
                            size,
                            format!("https://github.com/{full}/releases/download/{tag}/{name}"),
                            data,
                        ));
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Uploaded assets to {tag}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "download" => {
                    let mut dir_opt: Option<String> = None;
                    let mut out_opt: Option<String> = None;
                    let mut tag_opt: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-D" | "--dir" if i + 1 < args.len() => {
                                dir_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-O" | "--output" if i + 1 < args.len() => {
                                out_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-p" | "--pattern" | "-A" | "--archive" | "-R" | "--repo" => i += 2,
                            a if !a.starts_with('-') => {
                                if tag_opt.is_none() {
                                    tag_opt = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let rel_opt = match tag_opt.as_deref() {
                        Some(t) => repo.releases.iter().find(|r| r.tag_name == t).cloned(),
                        None => repo.releases.last().cloned(),
                    };
                    let Some(rel) = rel_opt else {
                        return gh_err("release not found");
                    };
                    let dest_dir = dir_opt.map(|d| resolve_posix_path(cwd, &d)).unwrap_or_else(|| cwd.to_string());
                    let _ = fs.mkdir_all(&dest_dir);
                    if let Some(o) = out_opt {
                        let target = resolve_posix_path(cwd, &o);
                        let data = rel
                            .assets
                            .first()
                            .map(|(_, _, _, b)| b.clone())
                            .unwrap_or_else(|| format!("archive:{}\n", rel.tag_name).into_bytes());
                        let _ = fs.write_file(&target, &data);
                    } else {
                        for (name, _, _, data) in &rel.assets {
                            let _ = fs.write_file(&format!("{dest_dir}/{name}"), data);
                        }
                    }
                    BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let mut tag_opt: Option<String> = None;
                    let mut title_opt: Option<String> = None;
                    let mut notes_opt: Option<String> = None;
                    let mut draft_opt: Option<bool> = None;
                    let mut prerelease_opt: Option<bool> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        let a = args[i].as_str();
                        match a {
                            "-t" | "--title" if i + 1 < args.len() => {
                                title_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-n" | "--notes" if i + 1 < args.len() => {
                                notes_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--draft" => {
                                if i + 1 < args.len() && (args[i + 1] == "true" || args[i + 1] == "false") {
                                    draft_opt = Some(args[i + 1] != "false");
                                    i += 2;
                                } else {
                                    draft_opt = Some(true);
                                    i += 1;
                                }
                            }
                            "--prerelease" => {
                                if i + 1 < args.len() && (args[i + 1] == "true" || args[i + 1] == "false") {
                                    prerelease_opt = Some(args[i + 1] != "false");
                                    i += 2;
                                } else {
                                    prerelease_opt = Some(true);
                                    i += 1;
                                }
                            }
                            x if x.starts_with("--draft=") => {
                                draft_opt = Some(&x["--draft=".len()..] != "false");
                                i += 1;
                            }
                            x if x.starts_with("--prerelease=") => {
                                prerelease_opt = Some(&x["--prerelease=".len()..] != "false");
                                i += 1;
                            }
                            "-R" | "--repo" => i += 2,
                            x if !x.starts_with('-') => {
                                if tag_opt.is_none() {
                                    tag_opt = Some(x.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let tag = tag_opt.unwrap_or_default();
                    let Some(rel) = repo.releases.iter_mut().find(|r| r.tag_name == tag) else {
                        return gh_err("release not found");
                    };
                    if let Some(t) = title_opt {
                        rel.name = t;
                    }
                    if let Some(n) = notes_opt {
                        rel.body = n;
                    }
                    if let Some(d) = draft_opt {
                        rel.is_draft = d;
                    }
                    if let Some(p) = prerelease_opt {
                        rel.is_prerelease = p;
                    }
                    BuiltinOutcome {
                        stdout: format!("https://github.com/{full}/releases/tag/{}\n", rel.tag_name),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete-asset" => {
                    let pos: Vec<&str> = args
                        .iter()
                        .skip(2)
                        .filter(|a| !a.starts_with('-'))
                        .map(|s| s.as_str())
                        .collect();
                    let tag = pos.first().copied().unwrap_or("");
                    let asset = pos.get(1).copied().unwrap_or("");
                    let Some(rel) = repo.releases.iter_mut().find(|r| r.tag_name == tag) else {
                        return gh_err("release not found");
                    };
                    rel.assets.retain(|(n, _, _, _)| n != asset);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted asset {asset} from release {tag}\n"),
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
                repo.variables.insert(k.clone(), val);
                return BuiltinOutcome {
                    stdout: format!("✓ Set Actions variable {k}\n"),
                    stderr: String::new(),
                    exit_code: 0,
                };
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
                    return BuiltinOutcome {
                        stdout: format!("✓ Deleted Actions variable {k}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    };
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
                    repo.secrets.push(k.clone());
                }
                return BuiltinOutcome {
                    stdout: format!("✓ Set Actions secret {k}\n"),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            if sub == "delete" || sub == "remove" {
                if let Some(k) = args.iter().skip(2).find(|a| !a.starts_with('-')).cloned() {
                    repo.secrets.retain(|s| s != &k);
                    return BuiltinOutcome {
                        stdout: format!("✓ Deleted Actions secret {k}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    };
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
        "workflow" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            let find_wf_idx = |wfs: &[GhWorkflowRecord], sel: Option<&str>| -> Option<usize> {
                let Some(s) = sel else {
                    return if wfs.is_empty() { None } else { Some(0) };
                };
                wfs.iter().position(|w| {
                    w.id.to_string() == s
                        || w.name.eq_ignore_ascii_case(s)
                        || w.path.ends_with(s)
                })
            };
            match sub {
                "list" | "ls" => {
                    let show_all = args.iter().any(|a| a == "-a" || a == "--all");
                    let filtered: Vec<&GhWorkflowRecord> = repo
                        .workflows
                        .iter()
                        .filter(|w| show_all || w.state == "active")
                        .collect();
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = filtered
                            .iter()
                            .map(|w| {
                                jval!({
                                    "id": w.id,
                                    "name": w.name,
                                    "path": w.path,
                                    "state": w.state
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for w in filtered {
                        out.push_str(&format!("{}\t{}\t{}\n", w.name, w.state, w.id));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let yaml_flag = args.iter().any(|a| a == "-y" || a == "--yaml");
                    let sel = args.iter().skip(2).find(|a| !a.starts_with('-')).map(|s| s.as_str());
                    let Some(idx) = find_wf_idx(&repo.workflows, sel) else {
                        return gh_err("workflow not found");
                    };
                    let w = &repo.workflows[idx];
                    if yaml_flag {
                        return BuiltinOutcome { stdout: w.content.clone(), stderr: String::new(), exit_code: 0 };
                    }
                    BuiltinOutcome {
                        stdout: format!("{} - {}\nID: {}\nState: {}\n", w.name, w.path, w.id, w.state),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "run" => {
                    let mut ref_branch = repo.default_branch.clone();
                    let mut sel: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-r" | "--ref" => {
                                if let Some(v) = args.get(i + 1) {
                                    ref_branch = v.clone();
                                }
                                i += 2;
                            }
                            "-R" | "--repo" | "-f" | "--raw-field" | "-F" | "--field" => i += 2,
                            a if !a.starts_with('-') => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let Some(idx) = find_wf_idx(&repo.workflows, sel.as_deref()) else {
                        return gh_err("workflow not found");
                    };
                    let wf_name = repo.workflows[idx].name.clone();
                    let wf_path = repo.workflows[idx].path.clone();
                    let wf_id = repo.workflows[idx].id;
                    st.gh_next_id += 1;
                    let run_id = st.gh_next_id;
                    st.gh_next_id += 1;
                    let job_id = st.gh_next_id;
                    let repo = st.gh_repos.get_mut(&full).unwrap();
                    repo.workflow_runs.push(GhWorkflowRunRecord {
                        database_id: run_id,
                        name: wf_name.clone(),
                        display_title: format!("Manual run of {wf_name}"),
                        workflow_name: wf_name.clone(),
                        workflow_database_id: wf_id,
                        head_branch: ref_branch.clone(),
                        event: "workflow_dispatch".into(),
                        status: "completed".into(),
                        conclusion: "success".into(),
                        attempt: 1,
                        url: format!("https://github.com/{full}/actions/runs/{run_id}"),
                        actor_login: st.gh_user.clone(),
                        job_id,
                        job_log: format!("{wf_name}\tbuild\t2026-09-28T12:00:00Z Completed workflow_dispatch\n"),
                    });
                    BuiltinOutcome {
                        stdout: format!("✓ Created workflow_dispatch event for {wf_path} at {ref_branch}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "enable" | "disable" => {
                    let mut sel: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-R" | "--repo" => i += 2,
                            a if !a.starts_with('-') => {
                                if sel.is_none() {
                                    sel = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let Some(idx) = find_wf_idx(&repo.workflows, sel.as_deref()) else {
                        return gh_err("workflow not found");
                    };
                    repo.workflows[idx].state = if sub == "enable" {
                        "active".into()
                    } else {
                        "disabled_manually".into()
                    };
                    let wf_name = repo.workflows[idx].name.clone();
                    let verb = if sub == "enable" { "Enabled" } else { "Disabled" };
                    BuiltinOutcome {
                        stdout: format!("✓ {verb} {wf_name}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown command \"{sub}\" for \"gh workflow\"")),
            }
        }
        "run" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            if repo.workflow_runs.is_empty() {
                repo.workflow_runs.push(GhWorkflowRunRecord {
                    database_id: 101,
                    name: "CI".into(),
                    display_title: "Initial CI run".into(),
                    workflow_name: "CI".into(),
                    workflow_database_id: 1,
                    head_branch: repo.default_branch.clone(),
                    event: "push".into(),
                    status: "completed".into(),
                    conclusion: "success".into(),
                    attempt: 1,
                    url: format!("https://github.com/{full}/actions/runs/101"),
                    actor_login: st.gh_user.clone(),
                    job_id: 201,
                    job_log: "CI\tbuild\t2026-09-28T12:00:00Z Running npm test\nCI\tbuild\t2026-09-28T12:00:01Z Pass\n".into(),
                });
            }
            match sub {
                "list" | "ls" => {
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = repo
                            .workflow_runs
                            .iter()
                            .map(|r| {
                                jval!({
                                    "attempt": r.attempt,
                                    "conclusion": r.conclusion,
                                    "createdAt": "2026-01-01T00:00:00Z",
                                    "databaseId": r.database_id,
                                    "displayTitle": r.display_title,
                                    "event": r.event,
                                    "headBranch": r.head_branch,
                                    "name": r.name,
                                    "number": r.database_id,
                                    "startedAt": "2026-01-01T00:00:00Z",
                                    "status": r.status,
                                    "updatedAt": "2026-01-01T00:00:00Z",
                                    "url": r.url,
                                    "workflowDatabaseId": r.workflow_database_id,
                                    "workflowName": r.workflow_name
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for r in &repo.workflow_runs {
                        out.push_str(&format!(
                            "{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                            r.status, r.conclusion, r.display_title, r.workflow_name, r.head_branch, r.event, r.database_id
                        ));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let log_flag = args.iter().skip(2).any(|a| a == "--log" || a == "--log-failed");
                    let sel_id = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-') && a.chars().all(|c| c.is_ascii_digit()))
                        .and_then(|s| s.parse::<u64>().ok());
                    let run_opt = match sel_id {
                        Some(id) => repo.workflow_runs.iter().find(|r| r.database_id == id),
                        None => repo.workflow_runs.first(),
                    };
                    let Some(r) = run_opt else {
                        return gh_err(&format!("run {} not found", sel_id.unwrap_or(0)));
                    };
                    if let Some(fields) = &json_fields {
                        let obj = jval!({
                            "attempt": r.attempt,
                            "conclusion": r.conclusion,
                            "createdAt": "2026-01-01T00:00:00Z",
                            "databaseId": r.database_id,
                            "displayTitle": r.display_title,
                            "event": r.event,
                            "headBranch": r.head_branch,
                            "name": r.name,
                            "number": r.database_id,
                            "startedAt": "2026-01-01T00:00:00Z",
                            "status": r.status,
                            "updatedAt": "2026-01-01T00:00:00Z",
                            "url": r.url,
                            "workflowDatabaseId": r.workflow_database_id,
                            "workflowName": r.workflow_name
                        });
                        return format_gh_json_output(&obj, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    if log_flag {
                        return BuiltinOutcome {
                            stdout: r.job_log.clone(),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    BuiltinOutcome {
                        stdout: format!(
                            "✓ {} {} · {}\nTriggered via {} by {}\n\nJOBS\n✓ build in 1s (ID {})\n",
                            r.head_branch, r.workflow_name, r.database_id, r.event, r.actor_login, r.job_id
                        ),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "watch" | "rerun" | "cancel" | "delete" => {
                    let sel_id = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-') && a.chars().all(|c| c.is_ascii_digit()))
                        .and_then(|s| s.parse::<u64>().ok());
                    let idx_opt = match sel_id {
                        Some(id) => repo.workflow_runs.iter().position(|r| r.database_id == id),
                        None => if repo.workflow_runs.is_empty() { None } else { Some(0) },
                    };
                    let Some(idx) = idx_opt else {
                        return gh_err("run not found");
                    };
                    let db_id = repo.workflow_runs[idx].database_id;
                    match sub {
                        "watch" => BuiltinOutcome {
                            stdout: format!("✓ Run {} ({}) completed with '{}'\n", repo.workflow_runs[idx].workflow_name, db_id, repo.workflow_runs[idx].conclusion),
                            stderr: String::new(),
                            exit_code: 0,
                        },
                        "rerun" => {
                            repo.workflow_runs[idx].attempt += 1;
                            repo.workflow_runs[idx].status = "completed".into();
                            repo.workflow_runs[idx].conclusion = "success".into();
                            BuiltinOutcome {
                                stdout: format!("✓ Requested rerun of run {db_id}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "cancel" => {
                            repo.workflow_runs[idx].status = "completed".into();
                            repo.workflow_runs[idx].conclusion = "cancelled".into();
                            BuiltinOutcome {
                                stdout: format!("✓ Requested cancellation of workflow run {db_id}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "delete" => {
                            repo.workflow_runs.remove(idx);
                            BuiltinOutcome {
                                stdout: format!("✓ Deleted workflow run {db_id}\n"),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        _ => unreachable!(),
                    }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "gist" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub.is_empty() || sub == "--help" || sub == "-h" || sub == "help" {
                return BuiltinOutcome {
                    stdout: "Usage: gh gist <create|list|view|edit|clone|delete|rename> [flags]\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "create" => {
                    let mut desc = String::new();
                    let mut filename_flag: Option<String> = None;
                    let mut is_public = false;
                    let mut pos_files: Vec<String> = Vec::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-d" | "--desc" if i + 1 < args.len() => {
                                desc = args[i + 1].clone();
                                i += 2;
                            }
                            "-f" | "--filename" if i + 1 < args.len() => {
                                filename_flag = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-p" | "--public" => {
                                is_public = true;
                                i += 1;
                            }
                            a if !a.starts_with('-') || a == "-" => {
                                pos_files.push(a.to_string());
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let mut files = Vec::new();
                    if pos_files.is_empty() || (pos_files.len() == 1 && pos_files[0] == "-") {
                        let fn_name = filename_flag.unwrap_or_else(|| "gistfile0.txt".into());
                        files.push(GhGistFileRecord {
                            filename: fn_name,
                            content: stdin.to_string(),
                            size: stdin.len(),
                        });
                    } else {
                        for farg in pos_files {
                            let resolved = resolve_posix_path(cwd, &farg);
                            let Ok(bytes) = fs.read_file(&resolved) else {
                                return gh_err(&format!("{farg}: No such file or directory"));
                            };
                            let content = String::from_utf8_lossy(&bytes).into_owned();
                            let fn_name = resolved.rsplit('/').next().unwrap_or(&farg).to_string();
                            let size = content.len();
                            files.push(GhGistFileRecord {
                                filename: fn_name,
                                content,
                                size,
                            });
                        }
                    }
                    st.gh_next_id += 1;
                    let digest = sha1_bytes(format!("gist:{}", st.gh_next_id).as_bytes());
                    let mut hex_id = String::new();
                    for b in &digest[..10] {
                        hex_id.push_str(&format!("{b:02x}"));
                    }
                    let ts = "2026-09-28T12:00:00Z".to_string();
                    let html_url = format!("https://gist.github.com/{}/{hex_id}", st.gh_user);
                    st.gh_gists.push(GhGistRecord {
                        id: hex_id,
                        description: desc,
                        is_public,
                        owner_login: st.gh_user.clone(),
                        files,
                        html_url: html_url.clone(),
                        created_at: ts.clone(),
                        updated_at: ts,
                    });
                    BuiltinOutcome {
                        stdout: format!("{html_url}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "list" | "ls" => {
                    let only_public = args.iter().any(|a| a == "--public");
                    let only_secret = args.iter().any(|a| a == "--secret");
                    let filtered: Vec<&GhGistRecord> = st
                        .gh_gists
                        .iter()
                        .filter(|g| (!only_public || g.is_public) && (!only_secret || !g.is_public))
                        .collect();
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = filtered
                            .iter()
                            .map(|g| {
                                let mut files_obj = Vec::new();
                                for f in &g.files {
                                    files_obj.push((
                                        f.filename.clone(),
                                        jval!({
                                            "filename": f.filename,
                                            "content": f.content,
                                            "size": f.size
                                        }),
                                    ));
                                }
                                jval!({
                                    "id": g.id,
                                    "description": g.description,
                                    "public": g.is_public,
                                    "files": JVal::Object(files_obj),
                                    "owner": { "login": g.owner_login },
                                    "htmlUrl": g.html_url,
                                    "createdAt": g.created_at,
                                    "updatedAt": g.updated_at
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for g in filtered {
                        let fc = g.files.len();
                        let plural = if fc == 1 { "" } else { "s" };
                        let vis = if g.is_public { "public" } else { "secret" };
                        out.push_str(&format!("{}\t{}\t{fc} file{plural}\t{vis}\t{}\n", g.id, g.description, g.updated_at));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let list_files = args.iter().any(|a| a == "--files");
                    let mut fn_filter: Option<String> = None;
                    let mut id_arg = String::new();
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-f" | "--filename" if i + 1 < args.len() => {
                                fn_filter = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--files" | "-r" | "--raw" => i += 1,
                            a if !a.starts_with('-') => {
                                if id_arg.is_empty() {
                                    id_arg = a.rsplit('/').next().unwrap_or(a).to_string();
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let gist_opt = if id_arg.is_empty() {
                        st.gh_gists.first()
                    } else {
                        st.gh_gists.iter().find(|g| g.id == id_arg).or_else(|| st.gh_gists.first())
                    };
                    let Some(g) = gist_opt else {
                        return gh_err(&format!("gist {id_arg} not found"));
                    };
                    if list_files {
                        let mut out = String::new();
                        for f in &g.files {
                            out.push_str(&format!("{}\n", f.filename));
                        }
                        return BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 };
                    }
                    let body: String = if let Some(ref fname) = fn_filter
                        && let Some(f) = g.files.iter().find(|f| &f.filename == fname)
                    {
                        f.content.clone()
                    } else {
                        g.files.iter().map(|f| f.content.as_str()).collect::<Vec<_>>().join("\n")
                    };
                    let stdout = if body.ends_with('\n') { body } else { format!("{body}\n") };
                    BuiltinOutcome { stdout, stderr: String::new(), exit_code: 0 }
                }
                "edit" => {
                    let mut id_arg = String::new();
                    let mut desc_opt: Option<String> = None;
                    let mut add_file: Option<String> = None;
                    let mut fn_flag: Option<String> = None;
                    let mut rm_file: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-d" | "--desc" if i + 1 < args.len() => {
                                desc_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-a" | "--add" if i + 1 < args.len() => {
                                add_file = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-f" | "--filename" if i + 1 < args.len() => {
                                fn_flag = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "-r" | "--remove" if i + 1 < args.len() => {
                                rm_file = Some(args[i + 1].clone());
                                i += 2;
                            }
                            a if !a.starts_with('-') => {
                                if id_arg.is_empty() {
                                    id_arg = a.rsplit('/').next().unwrap_or(a).to_string();
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let Some(g) = st.gh_gists.iter_mut().find(|g| g.id == id_arg) else {
                        return gh_err(&format!("gist {id_arg} not found"));
                    };
                    if let Some(d) = desc_opt {
                        g.description = d;
                    }
                    if let Some(af) = add_file {
                        let resolved = resolve_posix_path(cwd, &af);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            let content = String::from_utf8_lossy(&bytes).into_owned();
                            let size = content.len();
                            let fname = fn_flag.unwrap_or_else(|| resolved.rsplit('/').next().unwrap_or(&af).to_string());
                            if let Some(existing) = g.files.iter_mut().find(|f| f.filename == fname) {
                                existing.content = content;
                                existing.size = size;
                            } else {
                                g.files.push(GhGistFileRecord { filename: fname, content, size });
                            }
                        }
                    }
                    if let Some(rf) = rm_file {
                        g.files.retain(|f| f.filename != rf);
                    }
                    let gid = g.id.clone();
                    BuiltinOutcome { stdout: format!("✓ Edited gist {gid}\n"), stderr: String::new(), exit_code: 0 }
                }
                "rename" => {
                    let pos_args: Vec<&String> = args.iter().skip(2).filter(|a| !a.starts_with('-')).collect();
                    if pos_args.len() < 3 {
                        return gh_err("gist or file not found");
                    }
                    let id_arg = pos_args[0].rsplit('/').next().unwrap_or(pos_args[0]);
                    let old_name = pos_args[1];
                    let new_name = pos_args[2];
                    let Some(g) = st.gh_gists.iter_mut().find(|g| g.id == id_arg) else {
                        return gh_err("gist or file not found");
                    };
                    let Some(f) = g.files.iter_mut().find(|f| &f.filename == old_name) else {
                        return gh_err("gist or file not found");
                    };
                    f.filename = new_name.clone();
                    BuiltinOutcome {
                        stdout: format!("✓ Renamed {old_name} to {new_name}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let id_arg = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .map(|a| a.rsplit('/').next().unwrap_or(a).to_string())
                        .unwrap_or_default();
                    st.gh_gists.retain(|g| g.id != id_arg);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted gist {id_arg}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown command \"{sub}\" for \"gh gist\"")),
            }
        }
        "search" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub.is_empty() || sub == "--help" || sub == "-h" || sub == "help" {
                return BuiltinOutcome {
                    stdout: "Usage: gh search <prs|issues|repos|commits|code> [<query>] [flags]\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let mut state_filter: Option<String> = None;
            let mut owner_filter: Option<String> = None;
            let mut draft_filter: Option<bool> = None;
            let mut merged_filter: Option<bool> = None;
            let mut query_words: Vec<String> = Vec::new();
            let mut i = 2usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-R" | "--repo" | "--json" | "-q" | "--jq" | "-t" | "--template" | "-L" | "--limit" | "--author" | "--assignee" | "--label" | "--language" => {
                        i += 2;
                    }
                    "--state" if i + 1 < args.len() => {
                        state_filter = Some(args[i + 1].to_ascii_uppercase());
                        i += 2;
                    }
                    "--owner" if i + 1 < args.len() => {
                        owner_filter = Some(args[i + 1].to_ascii_lowercase());
                        i += 2;
                    }
                    "--draft" => {
                        draft_filter = Some(true);
                        i += 1;
                    }
                    "--merged" => {
                        merged_filter = Some(true);
                        i += 1;
                    }
                    a if a.starts_with("--") && a.contains('=') => i += 1,
                    a if !a.starts_with('-') => {
                        query_words.push(a.to_ascii_lowercase());
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let query = query_words.join(" ");
            let repo_filter = repo_flag.as_ref().map(|r| r.to_ascii_lowercase());
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            match sub {
                "repos" => {
                    let mut results = Vec::new();
                    let mut lines = String::new();
                    for (full, r) in &st.gh_repos {
                        if let Some(ref of) = owner_filter
                            && !r.owner.eq_ignore_ascii_case(of)
                        {
                            continue;
                        }
                        let hay = format!("{full} {}", r.description).to_ascii_lowercase();
                        if !query.is_empty() && !hay.contains(&query) {
                            continue;
                        }
                        let vis = if r.is_private { "PRIVATE" } else { "PUBLIC" };
                        results.push(jval!({
                            "name": r.name,
                            "nameWithOwner": full,
                            "description": r.description,
                            "visibility": vis,
                            "isPrivate": r.is_private,
                            "owner": { "login": r.owner },
                            "url": format!("https://github.com/{full}")
                        }));
                        lines.push_str(&format!("{full}\t{}\t{}\n", r.description, vis.to_ascii_lowercase()));
                    }
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(results), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome { stdout: lines, stderr: String::new(), exit_code: 0 }
                }
                "issues" => {
                    let mut results = Vec::new();
                    let mut lines = String::new();
                    for (full, r) in &st.gh_repos {
                        if let Some(ref rf) = repo_filter
                            && !full.eq_ignore_ascii_case(rf)
                        {
                            continue;
                        }
                        for iss in &r.issues {
                            if let Some(ref sf) = state_filter
                                && !iss.state.eq_ignore_ascii_case(sf)
                            {
                                continue;
                            }
                            let hay = format!("{} {}", iss.title, iss.body).to_ascii_lowercase();
                            if !query.is_empty() && !hay.contains(&query) {
                                continue;
                            }
                            results.push(jval!({
                                "number": iss.number,
                                "title": iss.title,
                                "body": iss.body,
                                "state": iss.state,
                                "repository": { "name": r.name, "nameWithOwner": full },
                                "url": format!("https://github.com/{full}/issues/{}", iss.number)
                            }));
                            lines.push_str(&format!("{full}\t#{}\t{}\t{}\n", iss.number, iss.state, iss.title));
                        }
                    }
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(results), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome { stdout: lines, stderr: String::new(), exit_code: 0 }
                }
                "prs" => {
                    let mut results = Vec::new();
                    let mut lines = String::new();
                    for (full, r) in &st.gh_repos {
                        if let Some(ref rf) = repo_filter
                            && !full.eq_ignore_ascii_case(rf)
                        {
                            continue;
                        }
                        for pr in &r.prs {
                            if let Some(ref sf) = state_filter
                                && !pr.state.eq_ignore_ascii_case(sf)
                            {
                                continue;
                            }
                            if let Some(df) = draft_filter
                                && pr.is_draft != df
                            {
                                continue;
                            }
                            if let Some(mf) = merged_filter
                                && (pr.state == "MERGED") != mf
                            {
                                continue;
                            }
                            let hay = format!("{} {} {}", pr.title, pr.body, pr.head).to_ascii_lowercase();
                            if !query.is_empty() && !hay.contains(&query) {
                                continue;
                            }
                            results.push(jval!({
                                "number": pr.number,
                                "title": pr.title,
                                "body": pr.body,
                                "state": pr.state,
                                "isDraft": pr.is_draft,
                                "repository": { "name": r.name, "nameWithOwner": full },
                                "url": format!("https://github.com/{full}/pull/{}", pr.number)
                            }));
                            lines.push_str(&format!("{full}\t#{}\t{}\t{}\n", pr.number, pr.state, pr.title));
                        }
                    }
                    if let Some(fields) = &json_fields {
                        return format_gh_json_output(&Value::Array(results), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome { stdout: lines, stderr: String::new(), exit_code: 0 }
                }
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "cache" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get_mut(&full).unwrap();
            if repo.caches.is_empty() {
                repo.caches.push(GhCacheRecord {
                    id: 1,
                    key: "node-modules-main".into(),
                    version: "v1".into(),
                    ref_name: "refs/heads/main".into(),
                    size_in_bytes: 4096,
                    created_at: "2026-09-28T12:00:00Z".into(),
                    last_accessed_at: "2026-09-28T12:00:00Z".into(),
                });
            }
            match sub {
                "list" | "ls" => {
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = repo
                            .caches
                            .iter()
                            .map(|c| {
                                jval!({
                                    "id": c.id,
                                    "key": c.key,
                                    "version": c.version,
                                    "ref": c.ref_name,
                                    "sizeInBytes": c.size_in_bytes,
                                    "createdAt": c.created_at,
                                    "lastAccessedAt": c.last_accessed_at
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for c in &repo.caches {
                        out.push_str(&format!("{}\t{}\t{} B\t{}\n", c.id, c.key, c.size_in_bytes, c.last_accessed_at));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "delete" => {
                    if args.iter().any(|a| a == "-a" || a == "--all") {
                        repo.caches.clear();
                        return BuiltinOutcome {
                            stdout: format!("✓ Deleted all caches from {full}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let target = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    repo.caches.retain(|c| c.id.to_string() != target && c.key != target);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted cache {target}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown command \"{sub}\" for \"gh cache\"")),
            }
        }
        "ssh-key" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" | "ls" => {
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = st
                            .gh_ssh_keys
                            .iter()
                            .map(|k| {
                                jval!({
                                    "id": k.id,
                                    "title": k.title,
                                    "key": k.key,
                                    "type": k.key_type,
                                    "createdAt": k.created_at
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for k in &st.gh_ssh_keys {
                        out.push_str(&format!("{}\t{}\t{}\t{}\t{}\n", k.title, k.key, k.created_at, k.id, k.key_type));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "add" => {
                    let mut title_opt: Option<String> = None;
                    let mut type_opt: Option<String> = None;
                    let mut key_file: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" if i + 1 < args.len() => {
                                title_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            "--type" if i + 1 < args.len() => {
                                type_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            a if !a.starts_with('-') || a == "-" => {
                                if key_file.is_none() {
                                    key_file = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let key_content = if let Some(ref kf) = key_file
                        && kf != "-"
                    {
                        let resolved = resolve_posix_path(cwd, kf);
                        fs.read_file(&resolved)
                            .map(|b| String::from_utf8_lossy(&b).trim().to_string())
                            .unwrap_or_default()
                    } else {
                        stdin.trim().to_string()
                    };
                    let parts: Vec<&str> = key_content.split_whitespace().collect();
                    let ktype_prefix = parts.first().copied().unwrap_or("ssh-ed25519");
                    let b64_data = if let Some(p1) = parts.get(1) {
                        (*p1).to_string()
                    } else {
                        base64_encode(&sha256_bytes(key_content.as_bytes()))
                    };
                    let comment = if parts.len() > 2 {
                        parts[2..].join(" ")
                    } else {
                        String::new()
                    };
                    let raw_decoded = base64_decode(&b64_data).unwrap_or_default();
                    let fp_digest = if !raw_decoded.is_empty() {
                        sha256_bytes(&raw_decoded)
                    } else {
                        sha256_bytes(b64_data.as_bytes())
                    };
                    let fp = format!("SHA256:{}", base64_encode(&fp_digest).trim_end_matches('='));
                    st.gh_next_id += 1;
                    let id = st.gh_next_id;
                    let key_type = if type_opt.as_deref() == Some("signing") {
                        "signing".to_string()
                    } else {
                        "authentication".to_string()
                    };
                    let title = title_opt.unwrap_or_else(|| {
                        if !comment.is_empty() {
                            comment
                        } else {
                            format!("key-{id}")
                        }
                    });
                    st.gh_ssh_keys.push(GhSshKeyRecord {
                        id,
                        title,
                        key: format!("{ktype_prefix} {b64_data}"),
                        key_type,
                        created_at: "2026-09-28T12:00:00Z".into(),
                    });
                    BuiltinOutcome {
                        stdout: format!("✓ Public key added to your account ({fp})\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let id = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(0);
                    st.gh_ssh_keys.retain(|k| k.id != id);
                    BuiltinOutcome {
                        stdout: format!("✓ SSH key {id} deleted from your account\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown command \"{sub}\" for \"gh ssh-key\"")),
            }
        }
        "gpg-key" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("list");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" | "ls" => {
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = st
                            .gh_gpg_keys
                            .iter()
                            .map(|k| {
                                jval!({
                                    "id": k.id,
                                    "keyId": k.key_id,
                                    "name": k.name,
                                    "rawKey": k.raw_key,
                                    "emails": [{ "email": k.email }],
                                    "createdAt": k.created_at,
                                    "expiresAt": Value::Null
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for k in &st.gh_gpg_keys {
                        out.push_str(&format!("{}\t{}\t{}\t\n", k.email, k.key_id, k.created_at));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "add" => {
                    let mut title_opt: Option<String> = None;
                    let mut key_file: Option<String> = None;
                    let mut i = 2usize;
                    while i < args.len() {
                        match args[i].as_str() {
                            "-t" | "--title" if i + 1 < args.len() => {
                                title_opt = Some(args[i + 1].clone());
                                i += 2;
                            }
                            a if !a.starts_with('-') || a == "-" => {
                                if key_file.is_none() {
                                    key_file = Some(a.to_string());
                                }
                                i += 1;
                            }
                            _ => i += 1,
                        }
                    }
                    let raw_key = if let Some(ref kf) = key_file
                        && kf != "-"
                    {
                        let resolved = resolve_posix_path(cwd, kf);
                        fs.read_file(&resolved)
                            .map(|b| String::from_utf8_lossy(&b).trim().to_string())
                            .unwrap_or_default()
                    } else {
                        let trimmed = stdin.trim();
                        if trimmed.is_empty() {
                            "-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKE\n-----END PGP PUBLIC KEY BLOCK-----".to_string()
                        } else {
                            trimmed.to_string()
                        }
                    };
                    let digest = sha256_bytes(raw_key.as_bytes());
                    let mut key_id = String::new();
                    for b in &digest[..8] {
                        key_id.push_str(&format!("{b:02X}"));
                    }
                    st.gh_next_id += 1;
                    let id = st.gh_next_id;
                    let name = title_opt.unwrap_or_else(|| st.gh_user.clone());
                    let email = format!("{}@github.com", st.gh_user);
                    st.gh_gpg_keys.push(GhGpgKeyRecord {
                        id,
                        key_id: key_id.clone(),
                        name,
                        raw_key,
                        email,
                        created_at: "2026-09-28T12:00:00Z".into(),
                    });
                    BuiltinOutcome {
                        stdout: format!("✓ GPG key {key_id} added to your account\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let sel = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    st.gh_gpg_keys.retain(|k| k.id.to_string() != sel && !k.key_id.eq_ignore_ascii_case(&sel));
                    BuiltinOutcome {
                        stdout: format!("✓ GPG key {sel} deleted\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => gh_err(&format!("unknown command \"{sub}\" for \"gh gpg-key\"")),
            }
        }
        "org" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub == "list" {
                return BuiltinOutcome {
                    stdout: "poe-platform\ngithub\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            BuiltinOutcome {
                stdout: "Work with GitHub organizations.\n\nUSAGE\n  gh org <command> [flags]\n\nCORE COMMANDS\n  list: List organizations for the authenticated user\n".into(),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        "ruleset" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get(&full).unwrap();
            match sub {
                "list" => BuiltinOutcome {
                    stdout: "1\tmain-branch-protection\tbranch\tactive\t2\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                },
                "view" => BuiltinOutcome {
                    stdout: format!("Ruleset: main-branch-protection (ID: 1)\nTarget: branch\nEnforcement: active\nSource: {full}\nRules: pull_request, required_status_checks\n"),
                    stderr: String::new(),
                    exit_code: 0,
                },
                "check" => {
                    let branch = args
                        .iter()
                        .skip(2)
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_else(|| repo.default_branch.clone());
                    BuiltinOutcome {
                        stdout: format!("Rules applying to branch \"{branch}\" in {full}:\n- pull_request (main-branch-protection)\n- required_status_checks (main-branch-protection)\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome {
                    stdout: "View info about repo rulesets.\n\nUSAGE\n  gh ruleset <command> [flags]\n\nCORE COMMANDS\n  list:  List rulesets for a repository\n  view:  View info about a ruleset\n  check: View rules that would apply to a given branch\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                },
            }
        }
        "extension" | "ext" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "list" => {
                    let mut out = String::new();
                    for (name, repo, ver) in &st.gh_extensions {
                        out.push_str(&format!("{name}\t{repo}\t{ver}\n"));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "install" => {
                    let repo = args.get(2).cloned().unwrap_or_else(|| "owner/gh-ext".into());
                    let short = repo.rsplit('/').next().unwrap_or("gh-ext");
                    let name = if short.starts_with("gh-") {
                        short.to_string()
                    } else {
                        format!("gh-{short}")
                    };
                    st.gh_extensions.retain(|(n, _, _)| n != &name);
                    st.gh_extensions.push((name, repo.clone(), "v1.0.0".into()));
                    BuiltinOutcome {
                        stdout: format!("✓ Installed extension {repo}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "remove" => {
                    let raw = args.get(2).cloned().unwrap_or_default();
                    let name = if raw.starts_with("gh-") {
                        raw
                    } else {
                        format!("gh-{raw}")
                    };
                    st.gh_extensions.retain(|(n, _, _)| n != &name);
                    BuiltinOutcome {
                        stdout: format!("✓ Removed extension {name}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "upgrade" => BuiltinOutcome {
                    stdout: "✓ Successfully upgraded extensions\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                },
                "search" => BuiltinOutcome {
                    stdout: "Showing extensions matching query\ngh-dash\tdlhdr/gh-dash\tA dashboard for gh\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                },
                _ => BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
            }
        }
        "status" => {
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            drop(map);
            let mut assigned_issues = Vec::new();
            let mut assigned_prs = Vec::new();
            let mut review_requests = Vec::new();
            for (full, r) in &st.gh_repos {
                for iss in &r.issues {
                    if iss.state == "OPEN" && iss.assignees.iter().any(|a| a == &st.gh_user) {
                        assigned_issues.push(format!("{full}#{}  {}", iss.number, iss.title));
                    }
                }
                for pr in &r.prs {
                    if pr.state == "OPEN" && pr.assignees.iter().any(|a| a == &st.gh_user) {
                        assigned_prs.push(format!("{full}#{}  {}", pr.number, pr.title));
                    }
                    if pr.state == "OPEN" && pr.reviewers.iter().any(|rv| rv == &st.gh_user) {
                        review_requests.push(format!("{full}#{}  {}", pr.number, pr.title));
                    }
                }
            }
            let issues_block = if assigned_issues.is_empty() {
                "  Nothing here ^_^".to_string()
            } else {
                assigned_issues.into_iter().map(|s| format!("  {s}")).collect::<Vec<_>>().join("\n")
            };
            let prs_block = if assigned_prs.is_empty() {
                "  Nothing here ^_^".to_string()
            } else {
                assigned_prs.into_iter().map(|s| format!("  {s}")).collect::<Vec<_>>().join("\n")
            };
            let reviews_block = if review_requests.is_empty() {
                "  Nothing here ^_^".to_string()
            } else {
                review_requests.into_iter().map(|s| format!("  {s}")).collect::<Vec<_>>().join("\n")
            };
            BuiltinOutcome {
                stdout: format!("Assigned Issues\n{issues_block}\n\nAssigned Pull Requests\n{prs_block}\n\nReview Requests\n{reviews_block}\n"),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        "completion" => {
            let mut shell_name = "bash".to_string();
            let mut i = 1usize;
            while i < args.len() {
                if (args[i] == "-s" || args[i] == "--shell") && i + 1 < args.len() {
                    shell_name = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            BuiltinOutcome {
                stdout: format!(
                    "# {shell_name} completion for gh\ncomplete -W \"pr repo issue api auth release run workflow gist search label secret variable cache ssh-key gpg-key attestation config alias status browse version\" gh\n"
                ),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        "browse" => {
            let mut branch_opt: Option<String> = None;
            let mut settings = false;
            let mut wiki = false;
            let mut releases = false;
            let mut projects = false;
            let mut pos_arg: Option<String> = None;
            let mut i = 1usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-R" | "--repo" => i += 2,
                    "-b" | "--branch" if i + 1 < args.len() => {
                        branch_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-s" | "--settings" => {
                        settings = true;
                        i += 1;
                    }
                    "-w" | "--wiki" => {
                        wiki = true;
                        i += 1;
                    }
                    "-r" | "--releases" => {
                        releases = true;
                        i += 1;
                    }
                    "-p" | "--projects" => {
                        projects = true;
                        i += 1;
                    }
                    "-n" | "--no-browser" | "-c" | "--commit" => i += 1,
                    a if !a.starts_with('-') => {
                        if pos_arg.is_none() {
                            pos_arg = Some(a.to_string());
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let full = resolve_gh_repo_key(st, repo_flag.as_deref(), env);
            let repo = st.gh_repos.get(&full).unwrap();
            let base_url = format!("https://github.com/{full}");
            let has_branch_flag = branch_opt.is_some();
            let branch = branch_opt.unwrap_or_else(|| repo.default_branch.clone());
            let target_url = if settings {
                format!("{base_url}/settings")
            } else if wiki {
                format!("{base_url}/wiki")
            } else if releases {
                format!("{base_url}/releases")
            } else if projects {
                format!("{base_url}/projects")
            } else if let Some(arg) = pos_arg {
                if arg.bytes().all(|b| b.is_ascii_digit()) && !arg.is_empty() {
                    let num: u64 = arg.parse().unwrap_or(0);
                    if repo.prs.iter().any(|p| p.number == num) {
                        format!("{base_url}/pull/{num}")
                    } else {
                        format!("{base_url}/issues/{num}")
                    }
                } else {
                    format!("{base_url}/blob/{branch}/{}", arg.trim_start_matches('/'))
                }
            } else if has_branch_flag {
                format!("{base_url}/tree/{branch}")
            } else {
                base_url
            };
            BuiltinOutcome {
                stdout: format!("{target_url}\n"),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        "attestation" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("verify");
            if sub != "verify" {
                return gh_err(&format!("unknown command \"{sub}\" for \"gh attestation\""));
            }
            let mut owner_opt: Option<String> = None;
            let mut bundle_opt: Option<String> = None;
            let mut is_json = json_fields.is_some();
            let mut file_arg: Option<String> = None;
            let mut i = 2usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-R" | "--repo" => i += 2,
                    "-o" | "--owner" if i + 1 < args.len() => {
                        owner_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-b" | "--bundle" if i + 1 < args.len() => {
                        bundle_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--format" if i + 1 < args.len() => {
                        if args[i + 1] == "json" {
                            is_json = true;
                        }
                        i += 2;
                    }
                    a if a == "--format=json" => {
                        is_json = true;
                        i += 1;
                    }
                    a if !a.starts_with('-') => {
                        if file_arg.is_none() {
                            file_arg = Some(a.to_string());
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let Some(farg) = file_arg else {
                return gh_err("artifact path required for attestation verify");
            };
            let resolved = resolve_posix_path(cwd, &farg);
            let Ok(bytes) = fs.read_file(&resolved) else {
                return gh_err(&format!("{farg}: No such file or directory"));
            };
            let digest_bytes = sha256_bytes(&bytes);
            let mut digest = String::new();
            for b in &digest_bytes {
                digest.push_str(&format!("{b:02x}"));
            }
            let map = states().lock().unwrap();
            let st = map.get(&fs_id).cloned().unwrap_or_default();
            let repo_str = repo_flag.unwrap_or_else(|| {
                format!("{}/Hello-World", owner_opt.unwrap_or_else(|| st.gh_user.clone()))
            });
            let _ = bundle_opt;
            if is_json {
                let res = jval!([{
                    "verified": true,
                    "subjectDigest": format!("sha256:{digest}"),
                    "issuer": "https://token.actions.githubusercontent.com",
                    "repository": repo_str,
                    "workflowRef": "octocat/Hello-World/.github/workflows/release.yml@refs/heads/main"
                }]);
                let s = to_pretty_json(&res);
                return BuiltinOutcome { stdout: format!("{s}\n"), stderr: String::new(), exit_code: 0 };
            }
            BuiltinOutcome {
                stdout: format!("Loaded digest sha256:{digest} for file://{farg}\n✓ Verification succeeded!\n"),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        "project" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub.is_empty() || sub == "--help" || sub == "-h" || sub == "help" {
                return BuiltinOutcome {
                    stdout: "Work with GitHub Projects.\n\nUSAGE\n  gh project <command> [flags]\n\nCORE COMMANDS\n  close\n  copy\n  create\n  delete\n  edit\n  field-create\n  field-delete\n  field-list\n  item-add\n  item-archive\n  item-create\n  item-delete\n  item-edit\n  item-list\n  link\n  list\n  mark-template\n  unlink\n  view\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let mut owner_opt: Option<String> = None;
            let mut title_opt: Option<String> = None;
            let mut short_desc_opt: Option<String> = None;
            let mut readme_opt: Option<String> = None;
            let mut name_opt: Option<String> = None;
            let mut dtype_opt: Option<String> = None;
            let mut id_opt: Option<String> = None;
            let mut body_opt: Option<String> = None;
            let mut url_opt: Option<String> = None;
            let mut repo_link_opt: Option<String> = repo_flag.clone();
            let mut undo = false;
            let mut is_json = false;
            let mut pos_num: Option<u64> = None;
            let mut i = 2usize;
            while i < args.len() {
                match args[i].as_str() {
                    "--owner" if i + 1 < args.len() => {
                        owner_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--title" if i + 1 < args.len() => {
                        title_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--short-description" if i + 1 < args.len() => {
                        short_desc_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--readme" if i + 1 < args.len() => {
                        readme_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--name" if i + 1 < args.len() => {
                        name_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--data-type" if i + 1 < args.len() => {
                        dtype_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--id" | "--item-id" if i + 1 < args.len() => {
                        id_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--body" if i + 1 < args.len() => {
                        body_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--url" if i + 1 < args.len() => {
                        url_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--repo" | "-R" if i + 1 < args.len() => {
                        repo_link_opt = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--format" if i + 1 < args.len() => {
                        if args[i + 1] == "json" {
                            is_json = true;
                        }
                        i += 2;
                    }
                    "--undo" => {
                        undo = true;
                        i += 1;
                    }
                    a if !a.starts_with('-') => {
                        if pos_num.is_none()
                            && let Ok(n) = a.parse::<u64>()
                        {
                            pos_num = Some(n);
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            let owner = owner_opt.unwrap_or_else(|| st.gh_user.clone());
            match sub {
                "create" => {
                    let num = (st.gh_projects.len() + 1) as u64;
                    let title = title_opt.unwrap_or_else(|| format!("Project {num}"));
                    let url = format!("https://github.com/orgs/{owner}/projects/{num}");
                    let p = GhProjectRecord {
                        number: num,
                        id: format!("PVT_{num}"),
                        title: title.clone(),
                        short_description: short_desc_opt.unwrap_or_default(),
                        readme: readme_opt.unwrap_or_default(),
                        is_public: false,
                        closed: false,
                        is_template: false,
                        owner: owner.clone(),
                        url: url.clone(),
                        fields: vec![
                            ("PVTF_1".into(), "Title".into(), "TITLE".into()),
                            ("PVTF_2".into(), "Status".into(), "SINGLE_SELECT".into()),
                        ],
                        items: Vec::new(),
                        linked_repos: Vec::new(),
                    };
                    st.gh_projects.push(p.clone());
                    if is_json {
                        let val = jval!({
                            "number": p.number,
                            "id": p.id,
                            "title": p.title,
                            "shortDescription": p.short_description,
                            "readme": p.readme,
                            "public": p.is_public,
                            "closed": p.closed,
                            "owner": p.owner,
                            "url": p.url
                        });
                        return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome { stdout: format!("{url}\n"), stderr: String::new(), exit_code: 0 }
                }
                "list" => {
                    if is_json {
                        let arr: Vec<Value> = st
                            .gh_projects
                            .iter()
                            .map(|p| {
                                jval!({
                                    "number": p.number,
                                    "id": p.id,
                                    "title": p.title,
                                    "closed": p.closed,
                                    "url": p.url
                                })
                            })
                            .collect();
                        let cnt = arr.len();
                        let val = jval!({ "projects": arr, "totalCount": cnt });
                        return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for p in &st.gh_projects {
                        let st_str = if p.closed { "closed" } else { "open" };
                        out.push_str(&format!("{}\t{}\t{st_str}\t{}\n", p.number, p.title, p.id));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                _ => {
                    let num = pos_num.unwrap_or(1);
                    if !st.gh_projects.iter().any(|p| p.number == num) {
                        st.gh_projects.push(GhProjectRecord {
                            number: num,
                            id: format!("PVT_{num}"),
                            title: format!("Project {num}"),
                            short_description: String::new(),
                            readme: String::new(),
                            is_public: false,
                            closed: false,
                            is_template: false,
                            owner: owner.clone(),
                            url: format!("https://github.com/orgs/{owner}/projects/{num}"),
                            fields: vec![
                                ("PVTF_1".into(), "Title".into(), "TITLE".into()),
                                ("PVTF_2".into(), "Status".into(), "SINGLE_SELECT".into()),
                            ],
                            items: Vec::new(),
                            linked_repos: Vec::new(),
                        });
                    }
                    if sub == "delete" {
                        st.gh_projects.retain(|p| p.number != num);
                        return BuiltinOutcome {
                            stdout: format!("Deleted project {num}\n"),
                            stderr: String::new(),
                            exit_code: 0,
                        };
                    }
                    let p = st.gh_projects.iter_mut().find(|p| p.number == num).unwrap();
                    match sub {
                        "view" => {
                            if is_json {
                                let val = jval!({
                                    "number": p.number,
                                    "id": p.id,
                                    "title": p.title,
                                    "closed": p.closed,
                                    "url": p.url
                                });
                                return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                            }
                            let st_str = if p.closed { "closed" } else { "open" };
                            BuiltinOutcome {
                                stdout: format!("Title: {}\nNumber: {}\nID: {}\nState: {st_str}\nURL: {}\n", p.title, p.number, p.id, p.url),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "edit" => {
                            if let Some(t) = title_opt {
                                p.title = t;
                            }
                            if let Some(sd) = short_desc_opt {
                                p.short_description = sd;
                            }
                            if let Some(rm) = readme_opt {
                                p.readme = rm;
                            }
                            BuiltinOutcome { stdout: format!("{}\n", p.url), stderr: String::new(), exit_code: 0 }
                        }
                        "close" => {
                            p.closed = !undo;
                            BuiltinOutcome { stdout: format!("{}\n", p.url), stderr: String::new(), exit_code: 0 }
                        }
                        "field-list" => {
                            if is_json {
                                let arr: Vec<Value> = p
                                    .fields
                                    .iter()
                                    .map(|(fid, fname, ftype)| jval!({ "id": fid, "name": fname, "dataType": ftype }))
                                    .collect();
                                let cnt = arr.len();
                                let val = jval!({ "fields": arr, "totalCount": cnt });
                                return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                            }
                            let mut out = String::new();
                            for (fid, fname, ftype) in &p.fields {
                                out.push_str(&format!("{fname}\t{ftype}\t{fid}\n"));
                            }
                            BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                        }
                        "field-create" => {
                            let fid = format!("PVTF_{}", p.fields.len() + 1);
                            p.fields.push((
                                fid.clone(),
                                name_opt.unwrap_or_else(|| "New Field".into()),
                                dtype_opt.unwrap_or_else(|| "TEXT".into()),
                            ));
                            BuiltinOutcome { stdout: format!("{fid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "field-delete" => {
                            let fid = id_opt.unwrap_or_default();
                            p.fields.retain(|(id, _, _)| id != &fid);
                            BuiltinOutcome { stdout: format!("Deleted field {fid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "item-create" | "item-add" => {
                            let iid = format!("PVTI_{}", p.items.len() + 1);
                            let ititle = title_opt.or_else(|| url_opt.clone()).unwrap_or_else(|| format!("Item {}", p.items.len() + 1));
                            let ibody = body_opt.unwrap_or_default();
                            let itype = if sub == "item-add" { "ISSUE" } else { "DRAFT_ISSUE" };
                            p.items.push((iid.clone(), ititle.clone(), ibody.clone(), itype.into(), url_opt));
                            if is_json {
                                let val = jval!({
                                    "id": iid,
                                    "title": ititle,
                                    "body": ibody,
                                    "type": itype,
                                    "fieldValues": {}
                                });
                                return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                            }
                            BuiltinOutcome { stdout: format!("Created item {iid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "item-list" => {
                            if is_json {
                                let arr: Vec<Value> = p
                                    .items
                                    .iter()
                                    .map(|(iid, ititle, ibody, itype, _)| {
                                        jval!({
                                            "id": iid,
                                            "title": ititle,
                                            "body": ibody,
                                            "type": itype,
                                            "fieldValues": {}
                                        })
                                    })
                                    .collect();
                                let cnt = arr.len();
                                let val = jval!({ "items": arr, "totalCount": cnt });
                                return format_gh_json_output(&val, &[], jq_expr.as_deref(), cwd, env, fs);
                            }
                            let mut out = String::new();
                            for (iid, ititle, _, itype, _) in &p.items {
                                out.push_str(&format!("{itype}\t{ititle}\t{iid}\n"));
                            }
                            BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                        }
                        "item-edit" => {
                            let iid = id_opt.unwrap_or_else(|| "PVTI_1".into());
                            if let Some(it) = p.items.iter_mut().find(|(id, _, _, _, _)| id == &iid) {
                                if let Some(t) = title_opt {
                                    it.1 = t;
                                }
                                if let Some(b) = body_opt {
                                    it.2 = b;
                                }
                            }
                            BuiltinOutcome { stdout: format!("Edited item {iid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "item-archive" => {
                            let iid = id_opt.unwrap_or_else(|| "PVTI_1".into());
                            BuiltinOutcome { stdout: format!("Archived item {iid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "item-delete" => {
                            let iid = id_opt.unwrap_or_default();
                            p.items.retain(|(id, _, _, _, _)| id != &iid);
                            BuiltinOutcome { stdout: format!("Deleted item {iid}\n"), stderr: String::new(), exit_code: 0 }
                        }
                        "link" | "unlink" => {
                            let rname = repo_link_opt.unwrap_or_else(|| "octocat/repo".into());
                            let verb = if sub == "link" { "Linked" } else { "Unlinked" };
                            BuiltinOutcome {
                                stdout: format!("{verb} {rname} to project {}\n", p.number),
                                stderr: String::new(),
                                exit_code: 0,
                            }
                        }
                        "mark-template" => {
                            p.is_template = !undo;
                            BuiltinOutcome { stdout: format!("{}\n", p.url), stderr: String::new(), exit_code: 0 }
                        }
                        _ => BuiltinOutcome { stdout: format!("{}\n", p.url), stderr: String::new(), exit_code: 0 },
                    }
                }
            }
        }
        "codespace" | "cs" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub.is_empty() || sub == "--help" || sub == "-h" || sub == "help" {
                return BuiltinOutcome {
                    stdout: "Connect to and manage codespaces.\n\nUSAGE\n  gh codespace <command> [flags]\n\nCORE COMMANDS\n  code\n  cp\n  create\n  delete\n  edit\n  jupyter\n  list\n  logs\n  ports\n  rebuild\n  ssh\n  stop\n  view\n".into(),
                    stderr: String::new(),
                    exit_code: 0,
                };
            }
            let mut cs_repo: Option<String> = repo_flag.clone();
            let mut cs_branch: Option<String> = None;
            let mut cs_name: Option<String> = None;
            let mut cs_machine: Option<String> = None;
            let mut cs_disp: Option<String> = None;
            let mut pos_arg: Option<String> = None;
            let mut i = 2usize;
            while i < args.len() {
                match args[i].as_str() {
                    "-r" | "-R" | "--repo" if i + 1 < args.len() => {
                        cs_repo = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-b" | "--branch" if i + 1 < args.len() => {
                        cs_branch = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-c" | "--codespace" if i + 1 < args.len() => {
                        cs_name = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-m" | "--machine" if i + 1 < args.len() => {
                        cs_machine = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "-d" | "--display-name" if i + 1 < args.len() => {
                        cs_disp = Some(args[i + 1].clone());
                        i += 2;
                    }
                    "--json" | "-q" | "--jq" | "-t" | "--template" => i += 2,
                    a if !a.starts_with('-') => {
                        if pos_arg.is_none() {
                            pos_arg = Some(a.to_string());
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            let mut map = states().lock().unwrap();
            let st = map.entry(fs_id).or_default();
            match sub {
                "create" => {
                    let name = format!("codespace-{}", st.gh_codespaces.len() + 1);
                    let disp = cs_disp.unwrap_or_else(|| name.clone());
                    let repo = cs_repo.unwrap_or_else(|| "octocat/repo".into());
                    let branch = cs_branch.unwrap_or_else(|| "main".into());
                    let machine = cs_machine.unwrap_or_else(|| "basicLinux32gb".into());
                    st.gh_codespaces.push(GhCodespaceRecord {
                        name: name.clone(),
                        display_name: disp,
                        repository: repo,
                        branch,
                        state: "Available".into(),
                        machine_name: machine,
                        created_at: "2026-09-28T12:00:00Z".into(),
                    });
                    BuiltinOutcome { stdout: format!("{name}\n"), stderr: String::new(), exit_code: 0 }
                }
                "list" => {
                    if let Some(fields) = &json_fields {
                        let arr: Vec<Value> = st
                            .gh_codespaces
                            .iter()
                            .map(|cs| {
                                jval!({
                                    "name": cs.name,
                                    "displayName": cs.display_name,
                                    "repository": cs.repository,
                                    "branch": cs.branch,
                                    "state": cs.state,
                                    "machineName": cs.machine_name,
                                    "createdAt": cs.created_at
                                })
                            })
                            .collect();
                        return format_gh_json_output(&Value::Array(arr), fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    let mut out = String::new();
                    for cs in &st.gh_codespaces {
                        out.push_str(&format!("{}\t{}\t{}\t{}\t{}\n", cs.name, cs.display_name, cs.repository, cs.branch, cs.state));
                    }
                    BuiltinOutcome { stdout: out, stderr: String::new(), exit_code: 0 }
                }
                "view" => {
                    let sel = cs_name
                        .or(pos_arg)
                        .unwrap_or_else(|| st.gh_codespaces.first().map(|c| c.name.clone()).unwrap_or_else(|| "codespace-1".into()));
                    let Some(cs) = st.gh_codespaces.iter().find(|c| c.name == sel) else {
                        return gh_err(&format!("codespace {sel} not found"));
                    };
                    if let Some(fields) = &json_fields {
                        let val = jval!({
                            "name": cs.name,
                            "displayName": cs.display_name,
                            "repository": cs.repository,
                            "branch": cs.branch,
                            "state": cs.state,
                            "machineName": cs.machine_name,
                            "createdAt": cs.created_at
                        });
                        return format_gh_json_output(&val, fields, jq_expr.as_deref(), cwd, env, fs);
                    }
                    BuiltinOutcome {
                        stdout: format!("Name: {}\nRepository: {}\nBranch: {}\nState: {}\n", cs.name, cs.repository, cs.branch, cs.state),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "stop" => {
                    let sel = cs_name.or(pos_arg).unwrap_or_default();
                    if let Some(cs) = st.gh_codespaces.iter_mut().find(|c| c.name == sel) {
                        cs.state = "Shutdown".into();
                    }
                    BuiltinOutcome {
                        stdout: format!("✓ Stopped codespace {sel}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                "delete" => {
                    let sel = cs_name.or(pos_arg).unwrap_or_default();
                    st.gh_codespaces.retain(|c| c.name != sel);
                    BuiltinOutcome {
                        stdout: format!("✓ Deleted codespace {sel}\n"),
                        stderr: String::new(),
                        exit_code: 0,
                    }
                }
                _ => BuiltinOutcome {
                    stdout: format!("✓ Codespace {sub} executed\n"),
                    stderr: String::new(),
                    exit_code: 0,
                },
            }
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

    #[test]
    fn unit_op_group_and_gh_gist_search_cache_keys_parity() {
        let vfs = MemoryVfs::new();
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        let mut noop = dummy_exec;

        let grp_create = cmd_op(
            &args(&["group", "create", "PlatformEng", "--description", "Core Platform", "--format", "json"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(grp_create.exit_code, 0);
        assert!(grp_create.stdout.contains("PlatformEng"));

        let grp_list = cmd_op(&args(&["group", "list"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        assert_eq!(grp_list.exit_code, 0);
        assert!(grp_list.stdout.contains("PlatformEng") && grp_list.stdout.contains("Core Platform"));

        let gist_create = cmd_gh(
            &args(&["gist", "create", "-d", "deploy snippet", "-f", "deploy.sh", "--public"]),
            "#!/bin/sh\necho ok\n",
            &mut cwd,
            &mut env,
            &vfs,
        );
        assert_eq!(gist_create.exit_code, 0);
        assert!(gist_create.stdout.starts_with("https://gist.github.com/octocat/"));

        let gist_view = cmd_gh(&args(&["gist", "view", "-f", "deploy.sh"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(gist_view.exit_code, 0);
        assert_eq!(gist_view.stdout, "#!/bin/sh\necho ok\n");

        let cache_ls = cmd_gh(&args(&["cache", "list"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(cache_ls.exit_code, 0);
        assert!(cache_ls.stdout.contains("node-modules-main"));

        let ssh_add = cmd_gh(
            &args(&["ssh-key", "add", "-", "-t", "laptop-key"]),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG9jdG9jYXQ= octocat@laptop\n",
            &mut cwd,
            &mut env,
            &vfs,
        );
        assert_eq!(ssh_add.exit_code, 0);
        assert!(ssh_add.stdout.contains("✓ Public key added to your account (SHA256:"));

        let gpg_add = cmd_gh(&args(&["gpg-key", "add", "-", "-t", "sec-gpg"]), "FAKE-PGP-BLOCK", &mut cwd, &mut env, &vfs);
        assert_eq!(gpg_add.exit_code, 0);
        assert!(gpg_add.stdout.contains("✓ GPG key "));

        let search_repos = cmd_gh(&args(&["search", "repos", "Hello"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(search_repos.exit_code, 0);
        assert!(search_repos.stdout.contains("octocat/Hello-World"));

        let _ = cmd_op(&args(&["vault", "create", "ProdVault"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        let vg_grant = cmd_op(
            &args(&["vault", "group", "grant", "--vault", "ProdVault", "--group", "PlatformEng", "--permissions", "view_items,view_and_copy_passwords,edit_items"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(vg_grant.exit_code, 0);
        let vg_list = cmd_op(&args(&["vault", "group", "list", "ProdVault", "--format", "json"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        assert_eq!(vg_list.exit_code, 0);
        assert!(vg_list.stdout.contains("PlatformEng") && vg_list.stdout.contains("edit_items"));

        let browse_out = cmd_gh(&args(&["browse", "-R", "octocat/Hello-World", "-s", "-n"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(browse_out.exit_code, 0);
        assert_eq!(browse_out.stdout, "https://github.com/octocat/Hello-World/settings\n");

        let proj_create = cmd_gh(&args(&["project", "create", "--title", "Roadmap"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(proj_create.exit_code, 0);
        assert!(proj_create.stdout.contains("/projects/1"));

        let cs_create = cmd_gh(&args(&["codespace", "create", "-R", "octocat/Hello-World", "-b", "main"]), "", &mut cwd, &mut env, &vfs);
        assert_eq!(cs_create.exit_code, 0);
        assert_eq!(cs_create.stdout, "codespace-1\n");
    }

    #[test]
    fn unit_op_environment_snapshot_plugin_and_completion_parity() {
        let vfs = MemoryVfs::new();
        let mut cwd = "/workspace".to_string();
        let mut env = BTreeMap::new();
        env.insert("API_TOKEN".to_string(), "super-secret-token".to_string());
        let mut noop = |words: &[String], _stdin: &str, _cwd: &mut String, child_env: &mut BTreeMap<String, String>| BuiltinOutcome {
            stdout: format!("cmd={} token={}\n", words.join(" "), child_env.get("API_TOKEN").cloned().unwrap_or_default()),
            stderr: String::new(),
            exit_code: 0,
        };

        let snap_create = cmd_op(
            &args(&["environment", "snapshot", "create", "dev-snap", "--vars=API_TOKEN,MISSING_VAR"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(snap_create.exit_code, 0);
        assert!(snap_create.stdout.contains("\"name\": \"dev-snap\"") && snap_create.stdout.contains("\"scope\": \"selected\""));
        assert!(!snap_create.stdout.contains("super-secret-token"));

        let snap_get = cmd_op(&args(&["environment", "snapshot", "get", "dev-snap"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        assert_eq!(snap_get.exit_code, 0);
        assert!(snap_get.stdout.contains("super-secret-token") && snap_get.stdout.contains("\"MISSING_VAR\": null"));

        let snap_restore_sh = cmd_op(
            &args(&["environment", "snapshot", "restore", "dev-snap", "--shell=bash"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(snap_restore_sh.exit_code, 0);
        assert_eq!(snap_restore_sh.stdout, "export API_TOKEN='super-secret-token'\nunset MISSING_VAR\n");

        let snap_restore_masked = cmd_op(
            &args(&["environment", "snapshot", "restore", "dev-snap", "--", "print-tok"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            &mut noop,
        );
        assert_eq!(snap_restore_masked.exit_code, 0);
        assert_eq!(snap_restore_masked.stdout, "cmd=print-tok token=<concealed by 1Password>\n");

        let plugin_ls = cmd_op(&args(&["plugin", "list"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        assert_eq!(plugin_ls.exit_code, 0);
        assert!(plugin_ls.stdout.starts_with("EXECUTABLE         NAME                  REQUIRED FIELDS\n"));
        assert!(plugin_ls.stdout.contains("gh                 GitHub                Token\n"));

        let comp_bash = cmd_op(&args(&["completion", "bash"]), "", &mut cwd, &mut env, &vfs, &mut noop);
        assert_eq!(comp_bash.exit_code, 0);
        assert!(comp_bash.stdout.contains("complete -o filenames -F _op op"));
    }

    #[test]
    fn unit_gh_repo_issue_pr_release_run_auth_deep_parity() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/.git").unwrap();
        vfs.write_file("/work/.git/config", b"[core]\n\trepositoryformatversion = 0\n").unwrap();
        vfs.write_file("/work/id_ed25519.pub", b"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployKey deploy@acme\n").unwrap();
        vfs.write_file("/work/artifact.tar.gz", b"BINARY-ARTIFACT-BYTES").unwrap();
        let mut env = BTreeMap::new();

        let login = cmd_gh(
            &args(&["auth", "login", "--with-token", "-h", "github.com", "-u", "secbot", "-p", "ssh", "-s", "repo,workflow"]),
            "gho_custom_token_12345\n",
            "/work",
            &mut env,
            &vfs,
        );
        assert_eq!(login.exit_code, 0);
        assert!(login.stdout.contains("✓ Logged in as secbot"));
        let setup_git = cmd_gh(&args(&["auth", "setup-git", "-h", "github.com"]), "", "/work", &mut env, &vfs);
        assert!(setup_git.stdout.contains("✓ Configured git credential helper for github.com"));

        assert_eq!(
            cmd_gh(&args(&["repo", "create", "acme/ops", "-d", "Ops Repo", "-h", "https://ops.acme.test", "--private"]), "", "/work", &mut env, &vfs).exit_code,
            0
        );
        assert_eq!(
            cmd_gh(&args(&["repo", "edit", "acme/ops", "--add-topic", "secops,infra", "--enable-auto-merge", "--delete-branch-on-merge"]), "", "/work", &mut env, &vfs).exit_code,
            0
        );
        let dk = cmd_gh(&args(&["repo", "deploy-key", "add", "/work/id_ed25519.pub", "-R", "acme/ops", "-t", "prod-deploy", "-w"]), "", "/work", &mut env, &vfs);
        assert!(dk.stdout.contains("✓ Deploy key added to acme/ops"));
        let al = cmd_gh(&args(&["repo", "autolink", "create", "SEC-", "https://jira.acme.test/browse/SEC-<num>", "-n", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(al.stdout.contains("✓ Created autolink "));

        cmd_gh(&args(&["issue", "create", "-R", "acme/ops", "-t", "Rotate keys", "-a", "@me"]), "", "/work", &mut env, &vfs);
        let pin = cmd_gh(&args(&["issue", "pin", "1", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(pin.stdout.contains("✓ Pinned issue #1"));
        let dev_create = cmd_gh(&args(&["issue", "develop", "1", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(dev_create.stdout.contains("https://github.com/acme/ops/tree/1-rotate-keys"));
        let dev = cmd_gh(&args(&["issue", "develop", "1", "-R", "acme/ops", "--list"]), "", "/work", &mut env, &vfs);
        assert!(dev.stdout.contains("1-rotate-keys\thttps://github.com/acme/ops/tree/1-rotate-keys"));

        cmd_gh(&args(&["pr", "create", "-R", "acme/ops", "-t", "Fix rotation", "-H", "1-rotate-keys", "-a", "@me", "-r", "alice"]), "", "/work", &mut env, &vfs);
        let checks = cmd_gh(&args(&["pr", "checks", "2", "-R", "acme/ops", "--json", "bucket,name,state"]), "", "/work", &mut env, &vfs);
        assert!(checks.stdout.contains("\"bucket\": \"pass\""));
        cmd_gh(&args(&["pr", "merge", "2", "-R", "acme/ops", "--squash"]), "", "/work", &mut env, &vfs);
        let rev = cmd_gh(&args(&["pr", "revert", "2", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(rev.stdout.contains("https://github.com/acme/ops/pull/3"));

        cmd_gh(&args(&["release", "create", "v1.0.0", "-R", "acme/ops", "-t", "v1.0.0", "-n", "Initial"]), "", "/work", &mut env, &vfs);
        let up = cmd_gh(&args(&["release", "upload", "v1.0.0", "/work/artifact.tar.gz", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(up.stdout.contains("✓ Uploaded assets to v1.0.0"));

        cmd_gh(&args(&["workflow", "run", "CI", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        let log_out = cmd_gh(&args(&["run", "view", "-R", "acme/ops", "--log"]), "", "/work", &mut env, &vfs);
        assert!(log_out.stdout.contains("Completed workflow_dispatch"));
        let rerun = cmd_gh(&args(&["run", "rerun", "-R", "acme/ops"]), "", "/work", &mut env, &vfs);
        assert!(rerun.stdout.contains("✓ Requested rerun of run "));
    }

}
