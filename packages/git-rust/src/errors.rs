use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ErrorCode {
    AlreadyExistsError,
    AmbiguousError,
    CheckoutConflictError,
    CherryPickMergeCommitError,
    CherryPickRootCommitError,
    CommitNotFetchedError,
    EmptyCommitError,
    EmptyServerResponseError,
    FastForwardError,
    GitPushError,
    HttpError,
    IndexResetError,
    InternalError,
    InvalidFilepathError,
    InvalidOidError,
    InvalidRefNameError,
    MaxDepthError,
    MergeConflictError,
    MergeNotSupportedError,
    MissingNameError,
    MissingParameterError,
    MultipleGitError,
    NoCommitError,
    NoRefspecError,
    NotFoundError,
    ObjectTypeError,
    ParseError,
    PushRejectedError,
    RemoteCapabilityError,
    SmartHttpError,
    UnknownTransportError,
    UnmergedPathsError,
    UnsafeFilepathError,
    UrlParseError,
    UserCanceledError,
}

impl ErrorCode {
    pub const ALL: &'static [ErrorCode] = &[
        ErrorCode::AlreadyExistsError,
        ErrorCode::AmbiguousError,
        ErrorCode::CheckoutConflictError,
        ErrorCode::CherryPickMergeCommitError,
        ErrorCode::CherryPickRootCommitError,
        ErrorCode::CommitNotFetchedError,
        ErrorCode::EmptyCommitError,
        ErrorCode::EmptyServerResponseError,
        ErrorCode::FastForwardError,
        ErrorCode::GitPushError,
        ErrorCode::HttpError,
        ErrorCode::IndexResetError,
        ErrorCode::InternalError,
        ErrorCode::InvalidFilepathError,
        ErrorCode::InvalidOidError,
        ErrorCode::InvalidRefNameError,
        ErrorCode::MaxDepthError,
        ErrorCode::MergeConflictError,
        ErrorCode::MergeNotSupportedError,
        ErrorCode::MissingNameError,
        ErrorCode::MissingParameterError,
        ErrorCode::MultipleGitError,
        ErrorCode::NoCommitError,
        ErrorCode::NoRefspecError,
        ErrorCode::NotFoundError,
        ErrorCode::ObjectTypeError,
        ErrorCode::ParseError,
        ErrorCode::PushRejectedError,
        ErrorCode::RemoteCapabilityError,
        ErrorCode::SmartHttpError,
        ErrorCode::UnknownTransportError,
        ErrorCode::UnmergedPathsError,
        ErrorCode::UnsafeFilepathError,
        ErrorCode::UrlParseError,
        ErrorCode::UserCanceledError,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::AlreadyExistsError => "AlreadyExistsError",
            ErrorCode::AmbiguousError => "AmbiguousError",
            ErrorCode::CheckoutConflictError => "CheckoutConflictError",
            ErrorCode::CherryPickMergeCommitError => "CherryPickMergeCommitError",
            ErrorCode::CherryPickRootCommitError => "CherryPickRootCommitError",
            ErrorCode::CommitNotFetchedError => "CommitNotFetchedError",
            ErrorCode::EmptyCommitError => "EmptyCommitError",
            ErrorCode::EmptyServerResponseError => "EmptyServerResponseError",
            ErrorCode::FastForwardError => "FastForwardError",
            ErrorCode::GitPushError => "GitPushError",
            ErrorCode::HttpError => "HttpError",
            ErrorCode::IndexResetError => "IndexResetError",
            ErrorCode::InternalError => "InternalError",
            ErrorCode::InvalidFilepathError => "InvalidFilepathError",
            ErrorCode::InvalidOidError => "InvalidOidError",
            ErrorCode::InvalidRefNameError => "InvalidRefNameError",
            ErrorCode::MaxDepthError => "MaxDepthError",
            ErrorCode::MergeConflictError => "MergeConflictError",
            ErrorCode::MergeNotSupportedError => "MergeNotSupportedError",
            ErrorCode::MissingNameError => "MissingNameError",
            ErrorCode::MissingParameterError => "MissingParameterError",
            ErrorCode::MultipleGitError => "MultipleGitError",
            ErrorCode::NoCommitError => "NoCommitError",
            ErrorCode::NoRefspecError => "NoRefspecError",
            ErrorCode::NotFoundError => "NotFoundError",
            ErrorCode::ObjectTypeError => "ObjectTypeError",
            ErrorCode::ParseError => "ParseError",
            ErrorCode::PushRejectedError => "PushRejectedError",
            ErrorCode::RemoteCapabilityError => "RemoteCapabilityError",
            ErrorCode::SmartHttpError => "SmartHttpError",
            ErrorCode::UnknownTransportError => "UnknownTransportError",
            ErrorCode::UnmergedPathsError => "UnmergedPathsError",
            ErrorCode::UnsafeFilepathError => "UnsafeFilepathError",
            ErrorCode::UrlParseError => "UrlParseError",
            ErrorCode::UserCanceledError => "UserCanceledError",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorDataValue {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    StringList(Vec<String>),
    Errors(Vec<GitError>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitError {
    pub code: ErrorCode,
    pub caller: String,
    pub message: String,
    pub data: BTreeMap<String, ErrorDataValue>,
    pub errors: Vec<GitError>,
}

impl GitError {
    pub fn new(
        code: ErrorCode,
        message: impl Into<String>,
        data: BTreeMap<String, ErrorDataValue>,
    ) -> Self {
        Self {
            code,
            caller: String::new(),
            message: message.into(),
            data,
            errors: Vec::new(),
        }
    }

    pub fn with_caller(mut self, caller: impl Into<String>) -> Self {
        self.caller = caller.into();
        self
    }

    pub fn is_git_error(&self) -> bool {
        true
    }

    pub fn already_exists(noun: &str, where_path: &str, can_force: bool) -> Self {
        let hint = if can_force {
            format!(" (Hint: use 'force: true' parameter to overwrite existing {noun}.)")
        } else {
            String::new()
        };
        let mut data = BTreeMap::new();
        data.insert("noun".into(), ErrorDataValue::Str(noun.into()));
        data.insert("where".into(), ErrorDataValue::Str(where_path.into()));
        data.insert("canForce".into(), ErrorDataValue::Bool(can_force));
        Self::new(
            ErrorCode::AlreadyExistsError,
            format!("Failed to create {noun} at {where_path} because it already exists.{hint}"),
            data,
        )
    }

    pub fn ambiguous(nouns: &str, short: &str, matches: Vec<String>) -> Self {
        let joined = matches.join(", ");
        let mut data = BTreeMap::new();
        data.insert("nouns".into(), ErrorDataValue::Str(nouns.into()));
        data.insert("short".into(), ErrorDataValue::Str(short.into()));
        data.insert("matches".into(), ErrorDataValue::StringList(matches));
        Self::new(
            ErrorCode::AmbiguousError,
            format!(
                "Found multiple {nouns} matching \"{short}\" ({joined}). Use a longer abbreviation length to disambiguate them."
            ),
            data,
        )
    }

    pub fn checkout_conflict(filepaths: Vec<String>) -> Self {
        let joined = filepaths.join(", ");
        let mut data = BTreeMap::new();
        data.insert("filepaths".into(), ErrorDataValue::StringList(filepaths));
        Self::new(
            ErrorCode::CheckoutConflictError,
            format!("Your local changes to the following files would be overwritten by checkout: {joined}"),
            data,
        )
    }

    pub fn cherry_pick_merge_commit(oid: &str, parent_count: usize) -> Self {
        let mut data = BTreeMap::new();
        data.insert("oid".into(), ErrorDataValue::Str(oid.into()));
        data.insert("parentCount".into(), ErrorDataValue::Int(parent_count as i64));
        Self::new(
            ErrorCode::CherryPickMergeCommitError,
            format!(
                "Cannot cherry-pick merge commit {oid}. Merge commits have {parent_count} parents and require specifying which parent to use as the base."
            ),
            data,
        )
    }

    pub fn cherry_pick_root_commit(oid: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("oid".into(), ErrorDataValue::Str(oid.into()));
        Self::new(
            ErrorCode::CherryPickRootCommitError,
            format!("Cannot cherry-pick root commit {oid}. Root commits have no parents."),
            data,
        )
    }

    pub fn commit_not_fetched(ref_name: &str, oid: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("ref".into(), ErrorDataValue::Str(ref_name.into()));
        data.insert("oid".into(), ErrorDataValue::Str(oid.into()));
        Self::new(
            ErrorCode::CommitNotFetchedError,
            format!(
                "Failed to checkout \"{ref_name}\" because commit {oid} is not available locally. Do a git fetch to make the branch available locally."
            ),
            data,
        )
    }

    pub fn empty_commit() -> Self {
        Self::new(
            ErrorCode::EmptyCommitError,
            "Cannot create an empty commit when disallowEmpty is true.",
            BTreeMap::new(),
        )
    }

    pub fn empty_server_response() -> Self {
        Self::new(
            ErrorCode::EmptyServerResponseError,
            "Empty response from git server.",
            BTreeMap::new(),
        )
    }

    pub fn fast_forward() -> Self {
        Self::new(
            ErrorCode::FastForwardError,
            "A simple fast-forward merge was not possible.",
            BTreeMap::new(),
        )
    }

    pub fn git_push(pretty_details: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert(
            "prettyDetails".into(),
            ErrorDataValue::Str(pretty_details.into()),
        );
        Self::new(
            ErrorCode::GitPushError,
            format!("One or more branches were not updated: {pretty_details}"),
            data,
        )
    }

    pub fn http(status_code: u16, status_message: &str, response: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("statusCode".into(), ErrorDataValue::Int(status_code as i64));
        data.insert(
            "statusMessage".into(),
            ErrorDataValue::Str(status_message.into()),
        );
        data.insert("response".into(), ErrorDataValue::Str(response.into()));
        Self::new(
            ErrorCode::HttpError,
            format!("HTTP Error: {status_code} {status_message}"),
            data,
        )
    }

    pub fn index_reset(filepath: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("filepath".into(), ErrorDataValue::Str(filepath.into()));
        Self::new(
            ErrorCode::IndexResetError,
            format!(
                "Could not merge index: Entry for '{filepath}' is not up to date. Either reset the index entry to HEAD, or stage your unstaged changes."
            ),
            data,
        )
    }

    pub fn internal(message: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("message".into(), ErrorDataValue::Str(message.into()));
        Self::new(
            ErrorCode::InternalError,
            format!(
                "An internal error caused this command to fail.\n\nIf you're using an application that depends on git-rust, please report this error to that application's developers.\n\nIf you're a developer and you believe this is a bug in git-rust, please file an issue with a minimal reproduction, version and environment details, and this error message: {message}"
            ),
            data,
        )
    }

    pub fn invalid_filepath(reason: Option<&str>) -> Self {
        let message = match reason {
            Some("leading-slash") | Some("trailing-slash") => {
                "\"filepath\" parameter should not include leading or trailing directory separators because these can cause problems on some platforms."
            }
            Some("directory") => "\"filepath\" should not be a directory.",
            _ => "invalid filepath",
        };
        let mut data = BTreeMap::new();
        data.insert(
            "reason".into(),
            reason.map(|r| ErrorDataValue::Str(r.into())).unwrap_or(ErrorDataValue::Null),
        );
        Self::new(ErrorCode::InvalidFilepathError, message, data)
    }

    pub fn invalid_oid(value: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("value".into(), ErrorDataValue::Str(value.into()));
        Self::new(
            ErrorCode::InvalidOidError,
            format!("Expected a 40-char hex object id but saw \"{value}\"."),
            data,
        )
    }

    pub fn invalid_ref_name(ref_name: &str, suggestion: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("ref".into(), ErrorDataValue::Str(ref_name.into()));
        data.insert("suggestion".into(), ErrorDataValue::Str(suggestion.into()));
        Self::new(
            ErrorCode::InvalidRefNameError,
            format!(
                "\"{ref_name}\" would be an invalid git reference. (Hint: a valid alternative would be \"{suggestion}\".)"
            ),
            data,
        )
    }

    pub fn max_depth(depth: usize) -> Self {
        let mut data = BTreeMap::new();
        data.insert("depth".into(), ErrorDataValue::Int(depth as i64));
        Self::new(
            ErrorCode::MaxDepthError,
            format!("Maximum search depth of {depth} exceeded."),
            data,
        )
    }

    pub fn merge_conflict(
        filepaths: Vec<String>,
        both_modified: Vec<String>,
        delete_by_us: Vec<String>,
        delete_by_theirs: Vec<String>,
    ) -> Self {
        let joined = filepaths.join(",");
        let mut data = BTreeMap::new();
        data.insert("filepaths".into(), ErrorDataValue::StringList(filepaths));
        data.insert(
            "bothModified".into(),
            ErrorDataValue::StringList(both_modified),
        );
        data.insert("deleteByUs".into(), ErrorDataValue::StringList(delete_by_us));
        data.insert(
            "deleteByTheirs".into(),
            ErrorDataValue::StringList(delete_by_theirs),
        );
        Self::new(
            ErrorCode::MergeConflictError,
            format!(
                "Automatic merge failed with one or more merge conflicts in the following files: {joined}. Fix conflicts then commit the result."
            ),
            data,
        )
    }

    pub fn merge_not_supported() -> Self {
        Self::new(
            ErrorCode::MergeNotSupportedError,
            "Merges with conflicts are not supported yet.",
            BTreeMap::new(),
        )
    }

    pub fn missing_name(role: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("role".into(), ErrorDataValue::Str(role.into()));
        Self::new(
            ErrorCode::MissingNameError,
            format!(
                "No name was provided for {role} in the argument or in the .git/config file."
            ),
            data,
        )
    }

    pub fn missing_parameter(parameter: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("parameter".into(), ErrorDataValue::Str(parameter.into()));
        Self::new(
            ErrorCode::MissingParameterError,
            format!(
                "The function requires a \"{parameter}\" parameter but none was provided."
            ),
            data,
        )
    }

    pub fn multiple(errors: Vec<GitError>) -> Self {
        let mut data = BTreeMap::new();
        data.insert("errors".into(), ErrorDataValue::Errors(errors.clone()));
        let mut err = Self::new(
            ErrorCode::MultipleGitError,
            "There are multiple errors that were thrown by the method. Please refer to the \"errors\" property to see more",
            data,
        );
        err.errors = errors;
        err
    }

    pub fn no_commit(ref_name: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("ref".into(), ErrorDataValue::Str(ref_name.into()));
        Self::new(
            ErrorCode::NoCommitError,
            format!(
                "\"{ref_name}\" does not point to any commit. You're maybe working on a repository with no commits yet. "
            ),
            data,
        )
    }

    pub fn no_refspec(remote: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("remote".into(), ErrorDataValue::Str(remote.into()));
        Self::new(
            ErrorCode::NoRefspecError,
            format!(
                "Could not find a fetch refspec for remote \"{remote}\". Make sure the config file has an entry like the following:\n[remote \"{remote}\"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n"
            ),
            data,
        )
    }

    pub fn not_found(what: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("what".into(), ErrorDataValue::Str(what.into()));
        Self::new(
            ErrorCode::NotFoundError,
            format!("Could not find {what}."),
            data,
        )
    }

    pub fn object_type(
        oid: &str,
        actual: &str,
        expected: &str,
        filepath: Option<&str>,
    ) -> Self {
        let at_part = filepath.map(|fp| format!("at {fp}")).unwrap_or_default();
        let mut data = BTreeMap::new();
        data.insert("oid".into(), ErrorDataValue::Str(oid.into()));
        data.insert("actual".into(), ErrorDataValue::Str(actual.into()));
        data.insert("expected".into(), ErrorDataValue::Str(expected.into()));
        if let Some(fp) = filepath {
            data.insert("filepath".into(), ErrorDataValue::Str(fp.into()));
        }
        Self::new(
            ErrorCode::ObjectTypeError,
            format!(
                "Object {oid} {at_part}was anticipated to be a {expected} but it is a {actual}."
            ),
            data,
        )
    }

    pub fn parse(expected: &str, actual: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("expected".into(), ErrorDataValue::Str(expected.into()));
        data.insert("actual".into(), ErrorDataValue::Str(actual.into()));
        Self::new(
            ErrorCode::ParseError,
            format!("Expected \"{expected}\" but received \"{actual}\"."),
            data,
        )
    }

    pub fn push_rejected(reason: &str) -> Self {
        let suffix = match reason {
            "not-fast-forward" => " because it was not a simple fast-forward",
            "tag-exists" => " because tag already exists",
            _ => "",
        };
        let mut data = BTreeMap::new();
        data.insert("reason".into(), ErrorDataValue::Str(reason.into()));
        Self::new(
            ErrorCode::PushRejectedError,
            format!("Push rejected{suffix}. Use \"force: true\" to override."),
            data,
        )
    }

    pub fn remote_capability(capability: &str, parameter: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("capability".into(), ErrorDataValue::Str(capability.into()));
        data.insert("parameter".into(), ErrorDataValue::Str(parameter.into()));
        Self::new(
            ErrorCode::RemoteCapabilityError,
            format!(
                "Remote does not support the \"{capability}\" so the \"{parameter}\" parameter cannot be used."
            ),
            data,
        )
    }

    pub fn smart_http(preview: &str, response: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("preview".into(), ErrorDataValue::Str(preview.into()));
        data.insert("response".into(), ErrorDataValue::Str(response.into()));
        Self::new(
            ErrorCode::SmartHttpError,
            format!(
                "Remote did not reply using the \"smart\" HTTP protocol. Expected \"001e# service=git-upload-pack\" but received: {preview}"
            ),
            data,
        )
    }

    pub fn unknown_transport(url: &str, transport: &str, suggestion: Option<&str>) -> Self {
        let mut data = BTreeMap::new();
        data.insert("url".into(), ErrorDataValue::Str(url.into()));
        data.insert("transport".into(), ErrorDataValue::Str(transport.into()));
        if let Some(s) = suggestion {
            data.insert("suggestion".into(), ErrorDataValue::Str(s.into()));
        }
        Self::new(
            ErrorCode::UnknownTransportError,
            format!(
                "Git remote \"{url}\" uses an unrecognized transport protocol: \"{transport}\""
            ),
            data,
        )
    }

    pub fn unmerged_paths(filepaths: Vec<String>) -> Self {
        let joined = filepaths.join(",");
        let mut data = BTreeMap::new();
        data.insert("filepaths".into(), ErrorDataValue::StringList(filepaths));
        Self::new(
            ErrorCode::UnmergedPathsError,
            format!(
                "Modifying the index is not possible because you have unmerged files: {joined}. Fix them up in the work tree, and then use 'git add/rm as appropriate to mark resolution and make a commit."
            ),
            data,
        )
    }

    pub fn unsafe_filepath(filepath: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("filepath".into(), ErrorDataValue::Str(filepath.into()));
        Self::new(
            ErrorCode::UnsafeFilepathError,
            format!("The filepath \"{filepath}\" contains unsafe character sequences"),
            data,
        )
    }

    pub fn url_parse(url: &str) -> Self {
        let mut data = BTreeMap::new();
        data.insert("url".into(), ErrorDataValue::Str(url.into()));
        Self::new(
            ErrorCode::UrlParseError,
            format!("Cannot parse remote URL: \"{url}\""),
            data,
        )
    }

    pub fn user_canceled() -> Self {
        Self::new(
            ErrorCode::UserCanceledError,
            "The operation was canceled.",
            BTreeMap::new(),
        )
    }
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for GitError {}
