#![allow(
    clippy::byte_char_slices,
    clippy::chunks_exact_to_as_chunks,
    clippy::collapsible_if,
    clippy::collapsible_match,
    clippy::double_ended_iterator_last,
    clippy::explicit_counter_loop,
    clippy::field_reassign_with_default,
    clippy::for_kv_map,
    clippy::format_in_format_args,
    clippy::if_same_then_else,
    clippy::implicit_saturating_sub,
    clippy::int_plus_one,
    clippy::manual_checked_ops,
    clippy::manual_div_ceil,
    clippy::manual_ignore_case_cmp,
    clippy::manual_is_multiple_of,
    clippy::manual_pattern_char_comparison,
    clippy::manual_range_contains,
    clippy::manual_strip,
    clippy::map_entry,
    clippy::match_like_matches_macro,
    clippy::missing_safety_doc,
    clippy::needless_borrow,
    clippy::needless_late_init,
    clippy::needless_lifetimes,
    clippy::needless_range_loop,
    clippy::op_ref,
    clippy::ptr_arg,
    clippy::question_mark,
    clippy::redundant_guards,
    clippy::result_unit_err,
    clippy::to_digit_is_some,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::unnecessary_cast,
    clippy::unnecessary_mut_passed,
    clippy::unnecessary_sort_by,
    clippy::useless_conversion,
    clippy::useless_format,
    clippy::useless_vec,
    clippy::vec_init_then_push
)]

pub mod agent;
pub mod backend;
pub mod budget;
pub mod commands;
pub mod fs;
pub mod shell;
pub mod vfs;
pub mod wasm;

pub use agent::{
    AgentRunCommandRequest, BackgroundStatus, PoeAgentShellHost, PoeAgentShellOptions, ShellMode,
};
pub use backend::{BackendMode, CommandContext, CommandResult, HybridBackend, RustCommand};
pub use budget::{AllocationGuard, CancellationToken, ExecutionBudget, ShellLimits};
#[cfg(not(target_arch = "wasm32"))]
pub use fs::RealVfs;
pub use fs::{
    FileStat, FsError, FsErrorCode, MemoryVfs, MemoryVfsLimits, MountVfs, OverlayVfs, SafeBashFs,
    VfsEntryKind, VfsFileEntry,
};
pub use shell::{ExecOptions, ExecOutput, Shell, ShellOptions};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn unit_crate_root_public_api_shell_and_vfs_smoke() {
        let vfs = Arc::new(MemoryVfs::new());
        vfs.mkdir_all("/workspace").unwrap();
        let mut shell = Shell::new(
            vfs,
            ShellOptions {
                cwd: Some("/workspace".into()),
                ..Default::default()
            },
        );
        let out = shell.exec("printf 'root-api:%s' \"$(pwd)\"").unwrap();
        assert_eq!(out.exit_code, 0);
        assert_eq!(out.stdout, "root-api:/workspace");
    }
}
