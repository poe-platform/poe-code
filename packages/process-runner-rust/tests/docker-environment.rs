use process_runner_rust::docker_environment::{self, Job, LogPoll};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn detached_jobs_parse_only_complete_safe_decimal_codes_and_preserve_error_text() {
    let job = Job::new(u("docker"), Some(u("colima")), u("cid"), Some(u("a'b")));
    assert_eq!(job.status(0, &u(" \n0\t")).unwrap(), ("exited", Some(0.0)));
    assert_eq!(job.status(0, &u(" ")).unwrap(), ("running", None));
    assert_eq!(job.status(1, &u("junk")).unwrap(), ("lost", None));
    for code in ["-1", "1x", "9007199254740992", "1.0", ""] {
        assert!(docker_environment::exit_code(&u(code), "docker wait").is_err());
    }
    assert_eq!(
        docker_environment::exit_code(&u("9007199254740991"), "docker wait").unwrap(),
        9007199254740991.0
    );
    assert_eq!(docker_environment::wait(&u(" \n"), 7.0).unwrap(), 7.0);
    assert_eq!(docker_environment::wait(&u("000"), 7.0).unwrap(), 0.0);
    assert_eq!(
        job.status_args(),
        [
            "--context",
            "colima",
            "exec",
            "cid",
            "sh",
            "-c",
            "test -f '/tmp/poe-jobs/a'\\''b.exit' && cat '/tmp/poe-jobs/a'\\''b.exit' || true"
        ]
        .map(u)
    );
    let container = Job::new(u("podman"), Some(u("colima")), u("cid"), None);
    assert_eq!(
        container.status(0, &u("paused")).unwrap(),
        ("running", None)
    );
    assert_eq!(container.status(0, &u("exited")).unwrap(), ("exited", None));
    assert_eq!(
        container.status_args(),
        ["inspect", "-f", "{{.State.Status}}", "cid"].map(u)
    );
}
#[test]
fn log_poll_only_performs_final_read_for_exited_detached_jobs() {
    let mut detached = LogPoll::new(true, true);
    assert_eq!(detached.after_read(), "status");
    assert_eq!(detached.after_status("running"), "sleep");
    assert_eq!(detached.after_status("exited"), "read");
    assert_eq!(detached.after_read(), "return");
    let mut lost = LogPoll::new(true, true);
    assert_eq!(lost.after_status("lost"), "return");
    let mut container = LogPoll::new(true, false);
    assert_eq!(container.after_status("exited"), "return");
    let single = LogPoll::new(false, true);
    assert_eq!(single.after_read(), "return");
    for bytes in [vec![0xf0], vec![0xf0, 0x9f], vec![0xf0, 0x9f, 0x98]] {
        assert_eq!(docker_environment::complete_prefix(&bytes), 0);
    }
    assert_eq!(docker_environment::complete_prefix("a😀".as_bytes()), 5);
    assert_eq!(docker_environment::complete_prefix(&[0x80, 0x80]), 2);
    assert_eq!(docker_environment::complete_prefix(&[0xff]), 1);
}
#[test]
fn exec_args_and_shell_quotes_preserve_unicode_env_separation_and_order() {
    assert_eq!(docker_environment::shell_quote(&u("x'猫")), u("'x'\\''猫'"));
    assert_eq!(
        docker_environment::exec_args(docker_environment::Exec {
            engine: &u("docker"),
            context: Some(&u("colima")),
            container: &u("cid"),
            interactive: true,
            tty: true,
            cwd: Some(&u("/work")),
            keys: &[u("TOKEN")],
            env_file: Some(&u("/private/env")),
            command: &u("echo"),
            args: &[u("猫")],
        }),
        [
            "--context",
            "colima",
            "exec",
            "-i",
            "-t",
            "-w",
            "/work",
            "--env-file",
            "/private/env",
            "cid",
            "echo",
            "猫"
        ]
        .map(u)
    );
}
