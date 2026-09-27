use crate::utils::{Author, format_author};

pub struct GitRefStash;

impl GitRefStash {
    pub fn create_stash_reflog_entry(
        author: &Author,
        stash_commit: &str,
        message: &str,
    ) -> String {
        let zero = "0000000000000000000000000000000000000000";
        format!(
            "{zero} {stash_commit} {}\t{}\n",
            format_author(author),
            message.trim()
        )
    }

    pub fn parse_stash_reflog(content: &str, parsed: bool) -> Vec<String> {
        let lines: Vec<&str> = content
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        if !parsed {
            return lines.into_iter().map(|s| s.to_string()).collect();
        }
        lines
            .into_iter()
            .enumerate()
            .map(|(i, line)| {
                let msg = line.split('\t').nth(1).unwrap_or("");
                format!("stash@{{{i}}}: {msg}")
            })
            .collect()
    }
}
