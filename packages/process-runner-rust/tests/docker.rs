use process_runner_rust::docker::{self, Mount, Port, RunArgs};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn docker_argument_order_preserves_env_names_unicode_and_opaque_values() {
    let input = RunArgs {
        engine: u("docker"),
        context: Some(u("colima")),
        image: u("node:22"),
        command: u("npm"),
        args: vec![u("run"), u("dev")],
        cwd: Some(u("/repo")),
        env_keys: vec![u("TOKEN"), vec![0xd800]],
        env_file: Some(u("/tmp/env")),
        mounts: vec![Mount {
            source: u("/home/repo"),
            target: u("/workspace"),
            readonly: true,
        }],
        ports: vec![Port {
            host: 8080.0,
            container: 3000.0,
            protocol: Some(u("udp")),
        }],
        network: Some(u("net")),
        name: u("test"),
        detached: true,
        interactive: true,
        tty: true,
        rm: true,
        extra: vec![u("--pull=never")],
    };
    let actual = docker::run_args(&input).unwrap();
    let expected = [
        "docker",
        "--context",
        "colima",
        "run",
        "--rm",
        "-d",
        "-i",
        "-t",
        "--name",
        "test",
        "-w",
        "/repo",
        "--env-file",
        "/tmp/env",
        "-v",
        "/home/repo:/workspace:ro",
        "-p",
        "8080:3000/udp",
        "--network",
        "net",
        "--pull=never",
        "node:22",
        "npm",
        "run",
        "dev",
    ]
    .map(u);
    assert_eq!(actual, expected);
    assert_eq!(
        docker::env_args(&[vec![0xd800]], None),
        vec![u("-e"), vec![0xd800]]
    );
    assert!(docker::env_args(&[], Some(&u("ignored"))).is_empty());
}
#[test]
fn invalid_ports_and_env_entries_return_exact_errors_without_secrets() {
    for value in [0.0, -1.0, 1.5, 65536.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            docker::port_arg(
                &Port {
                    host: value,
                    container: 80.0,
                    protocol: None
                },
                2
            )
            .unwrap_err(),
            "Invalid Docker port mapping ports[2].host: port must be an integer from 1 to 65535."
        );
    }
    assert_eq!(
        docker::port_arg(
            &Port {
                host: 1.0,
                container: 2.0,
                protocol: Some(u("icmp"))
            },
            0
        )
        .unwrap_err(),
        "Invalid Docker port mapping 0: protocol must be tcp or udp."
    );
    assert_eq!(
        docker::serialize_env(&[(u("BAD=KEY"), u("hidden"))]).unwrap_err(),
        "Invalid Docker environment variable name: \"BAD=KEY\""
    );
    assert_eq!(
        docker::serialize_env(&[(u("TOKEN"), u("hidden\nvalue"))]).unwrap_err(),
        "Docker env-file values cannot contain newline characters."
    );
    assert_eq!(docker::serialize_env(&[]).unwrap(), u("\n"));
    assert_eq!(
        docker::serialize_env(&[(vec![0xd800], vec![0xdfff])]).unwrap(),
        vec![0xd800, 61, 0xdfff, 10]
    );
}
#[test]
fn context_profiles_are_selected_in_order_and_failed_parse_stops_detection() {
    assert_eq!(
        docker::context_args(&u("docker"), Some(&u("colima"))),
        vec![u("--context"), u("colima")]
    );
    assert!(docker::context_args(&u("podman"), Some(&u("colima"))).is_empty());
    assert_eq!(
        docker::detect_context(&u(
            "{\"name\":\"default\",\"status\":\"Running\",\"runtime\":\"docker\"}\nnot json"
        )),
        Some(u("colima"))
    );
    assert_eq!(
        docker::detect_context(&u(
            "not json\n{\"name\":\"default\",\"status\":\"Running\",\"runtime\":\"docker\"}"
        )),
        None
    );
    assert_eq!(
        docker::detect_context(&u(
            "{\"name\":null,\"profile\":\"named\",\"status\":\"Running\",\"runtime\":\"docker\"}"
        )),
        Some(u("colima-named"))
    );
    assert_eq!(
        docker::detect_context(&u(
            "{\"name\":\"\",\"profile\":\"ignored\",\"status\":\"Running\",\"runtime\":\"docker\"}"
        )),
        None
    );
    let mut calls = Vec::new();
    assert_eq!(
        docker::detect_engine(|engine| {
            calls.push(engine.to_owned());
            engine == "podman"
        })
        .unwrap(),
        "podman"
    );
    assert_eq!(calls, ["docker", "podman"]);
    assert_eq!(
        docker::detect_engine(|_| false).unwrap_err(),
        docker::ENGINE_ERROR
    );
}
