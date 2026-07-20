import io
import threading
import unittest
import warnings
from unittest import mock

from poe_spawn import Agent, PoeCodeNotFoundError, SessionStartEvent, UsageEvent, spawn
from poe_spawn import AgentMessageEvent
from poe_spawn._spawn import _resolve_cli_command


class FakeProcess:
    def __init__(self, stdout_text: str, wait_code: int = 0) -> None:
        self.stdout = io.StringIO(stdout_text)
        self.wait_code = wait_code
        self.returncode = None
        self.sent_signals = []

    def poll(self):
        return self.returncode

    def send_signal(self, sig) -> None:
        self.sent_signals.append(sig)

    def wait(self) -> int:
        self.returncode = self.wait_code
        return self.wait_code


class FailingSignalProcess(FakeProcess):
    def send_signal(self, sig) -> None:
        self.sent_signals.append(sig)
        raise PermissionError("signal denied")


class TimeoutWaitOnlyCancelEvent:
    def __init__(self) -> None:
        self._event = threading.Event()

    def wait(self, timeout=None) -> bool:
        return self._event.wait(timeout)


class BlockingWaitOnlyCancelEvent:
    def wait(self) -> bool:
        return False


class ResolveCliCommandTest(unittest.TestCase):
    def test_prefers_poe_code_on_path(self) -> None:
        with mock.patch("poe_spawn._spawn.shutil.which") as which:
            which.side_effect = lambda name: "/usr/local/bin/poe-code" if name == "poe-code" else None

            self.assertEqual(_resolve_cli_command(), ["/usr/local/bin/poe-code"])

    def test_falls_back_to_npx(self) -> None:
        with mock.patch("poe_spawn._spawn.shutil.which") as which:
            which.side_effect = lambda name: "/usr/local/bin/npx" if name == "npx" else None

            self.assertEqual(_resolve_cli_command(), ["/usr/local/bin/npx", "--yes", "poe-code"])

    def test_raises_diagnostic_when_no_cli_can_be_found(self) -> None:
        with mock.patch("poe_spawn._spawn.shutil.which", return_value=None), mock.patch(
            "poe_spawn._spawn._read_command_version"
        ) as read_version:
            read_version.side_effect = lambda name: {"node": "v22.1.0", "npm": "10.7.0"}[name]

            with self.assertRaises(PoeCodeNotFoundError) as context:
                _resolve_cli_command()

        message = str(context.exception)
        self.assertIn("poe-code CLI not found on PATH.", message)
        self.assertIn("Python:", message)
        self.assertIn("PATH:", message)
        self.assertIn("Node: v22.1.0", message)
        self.assertIn("npm: 10.7.0", message)


class SpawnTest(unittest.TestCase):
    def test_spawn_streams_events_skips_bad_json_and_exposes_result_after_consumption(self) -> None:
        fake_process = FakeProcess(
            "\n".join(
                [
                    '{"event":"session_start","threadId":"thread-1"}',
                    "not-json",
                    '{"event":"agent_message","text":"hello"}',
                    '{"event":"usage","inputTokens":1,"outputTokens":2}',
                    '{"event":"spawn_result","exitCode":0,"threadId":"thread-1",'
                    '"usage":{"inputTokens":1,"outputTokens":2},"protocolVersion":1}',
                ]
            )
            + "\n"
        )
        popen_calls = []

        def fake_popen(*args, **kwargs):
            popen_calls.append((args, kwargs))
            return fake_process

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", side_effect=fake_popen
        ):
            handle = spawn("codex", "Fix the bug", model="gpt-5", activity_timeout_ms=2500)

            with self.assertRaises(RuntimeError):
                _ = handle.result

            events = list(handle.events)

        self.assertEqual(
            events,
            [
                SessionStartEvent(event="session_start", thread_id="thread-1"),
                AgentMessageEvent(event="agent_message", text="hello"),
                UsageEvent(event="usage", input_tokens=1, output_tokens=2),
            ],
        )
        self.assertEqual(handle.result.exit_code, 0)
        self.assertEqual(handle.result.thread_id, "thread-1")
        self.assertEqual(handle.result.usage, UsageEvent(event="usage", input_tokens=1, output_tokens=2))
        self.assertEqual(handle.result.protocol_version, 1)

        args, kwargs = popen_calls[0]
        self.assertEqual(
            args[0],
            [
                "poe-code",
                "--yes",
                "spawn",
                "--model",
                "gpt-5",
                "--activity-timeout-ms",
                "2500",
                "codex",
                "Fix the bug",
            ],
        )
        self.assertEqual(kwargs["env"]["OUTPUT_FORMAT"], "json")
        self.assertEqual(kwargs["stderr"], None)

    def test_cancel_sends_interrupt_signal_to_child(self) -> None:
        fake_process = FakeProcess("")

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Stop now")
            handle.cancel()

        self.assertEqual(len(fake_process.sent_signals), 1)

    def test_spawn_synthesizes_result_when_cli_omits_spawn_result(self) -> None:
        fake_process = FakeProcess(
            "\n".join(
                [
                    '{"event":"session_start","threadId":"thread-9"}',
                    '{"event":"usage","inputTokens":8,"outputTokens":13}',
                ]
            )
            + "\n",
            wait_code=7,
        )

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Fix the bug")
            events = list(handle.events)

        self.assertEqual(len(events), 2)
        self.assertEqual(handle.result.exit_code, 7)
        self.assertEqual(handle.result.thread_id, "thread-9")
        self.assertEqual(handle.result.usage, UsageEvent(event="usage", input_tokens=8, output_tokens=13))

    def test_spawn_preserves_protocol_result_exit_code(self) -> None:
        fake_process = FakeProcess('{"event":"spawn_result","exitCode":9,"threadId":"t"}\n')

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Report result")
            list(handle.events)

        self.assertEqual(handle.result.exit_code, 9)
        self.assertEqual(handle.result.thread_id, "t")

    def test_pretty_inherits_terminal_output_and_returns_exit_code(self) -> None:
        fake_process = FakeProcess("", wait_code=3)
        popen_calls = []

        def fake_popen(*args, **kwargs):
            popen_calls.append((args, kwargs))
            return fake_process

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", side_effect=fake_popen
        ):
            result = spawn.pretty("codex", "Show output", log_dir="/tmp/spawn-log")

        self.assertEqual(result.exit_code, 3)

        args, kwargs = popen_calls[0]
        self.assertEqual(
            args[0],
            [
                "poe-code",
                "--yes",
                "spawn",
                "--log-dir",
                "/tmp/spawn-log",
                "codex",
                "Show output",
            ],
        )
        self.assertEqual(kwargs["env"]["OUTPUT_FORMAT"], "terminal")
        self.assertIsNone(kwargs["stdout"])
        self.assertIsNone(kwargs["stderr"])

    def test_spawn_stops_cancel_watcher_after_normal_completion(self) -> None:
        fake_process = FakeProcess('{"event":"agent_message","text":"done"}\n')
        cancel_event = threading.Event()

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Finish normally", cancel_event=cancel_event)
            self.assertIsNotNone(handle._cancel_watcher)

            events = list(handle.events)

        self.assertEqual(events, [AgentMessageEvent(event="agent_message", text="done")])
        self.assertFalse(handle._cancel_watcher.is_alive())

    def test_spawn_stops_timeout_wait_only_cancel_watcher_after_normal_completion(self) -> None:
        fake_process = FakeProcess('{"event":"agent_message","text":"done"}\n')
        cancel_event = TimeoutWaitOnlyCancelEvent()

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Finish normally", cancel_event=cancel_event)
            self.assertIsNotNone(handle._cancel_watcher)

            events = list(handle.events)

        self.assertEqual(events, [AgentMessageEvent(event="agent_message", text="done")])
        self.assertFalse(handle._cancel_watcher.is_alive())

    def test_spawn_rejects_invalid_cancel_event_before_starting_process(self) -> None:
        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen"
        ) as popen:
            with self.assertRaises(TypeError):
                spawn("codex", "Invalid cancellation", cancel_event=object())

        popen.assert_not_called()

    def test_spawn_rejects_blocking_wait_only_cancel_event_before_starting_process(self) -> None:
        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen"
        ) as popen:
            with self.assertRaises(TypeError):
                spawn("codex", "Invalid cancellation", cancel_event=BlockingWaitOnlyCancelEvent())

        popen.assert_not_called()

    def test_spawn_surfaces_async_cancel_signal_failure(self) -> None:
        fake_process = FailingSignalProcess('{"event":"agent_message","text":"done"}\n')
        cancel_event = threading.Event()

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Cancel", cancel_event=cancel_event)
            cancel_event.set()
            with self.assertRaises(PermissionError):
                list(handle.events)

        self.assertEqual(len(fake_process.sent_signals), 1)

    def test_spawn_returns_handle_when_preset_cancel_signal_fails(self) -> None:
        fake_process = FailingSignalProcess('{"event":"agent_message","text":"done"}\n')
        cancel_event = threading.Event()
        cancel_event.set()

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", return_value=fake_process
        ):
            handle = spawn("codex", "Already cancelled", cancel_event=cancel_event)
            with self.assertRaises(PermissionError):
                list(handle.events)

        self.assertEqual(len(fake_process.sent_signals), 1)

    def test_spawn_serializes_mcp_servers(self) -> None:
        fake_process = FakeProcess("")
        popen_calls = []

        def fake_popen(*args, **kwargs):
            popen_calls.append((args, kwargs))
            return fake_process

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", side_effect=fake_popen
        ):
            handle = spawn(
                "codex",
                "Run with MCP",
                mcp_servers={"local": {"command": "server", "args": ["--stdio"]}},
            )
            list(handle.events)

        args, _ = popen_calls[0]
        self.assertEqual(
            args[0],
            [
                "poe-code",
                "--yes",
                "spawn",
                "--mcp-servers",
                '{"local":{"command":"server","args":["--stdio"]}}',
                "codex",
                "Run with MCP",
            ],
        )

    def test_spawn_accepts_deprecated_mcp_config_alias(self) -> None:
        fake_process = FakeProcess("")
        popen_calls = []

        def fake_popen(*args, **kwargs):
            popen_calls.append((args, kwargs))
            return fake_process

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen", side_effect=fake_popen
        ), warnings.catch_warnings(record=True) as caught_warnings:
            warnings.simplefilter("always")
            handle = spawn(
                "codex",
                "Run with MCP",
                mcp_config={"local": {"command": "server", "args": ["--stdio"]}},
            )
            list(handle.events)

        self.assertEqual(len(caught_warnings), 1)
        self.assertIn("mcp_config is deprecated", str(caught_warnings[0].message))
        args, _ = popen_calls[0]
        self.assertEqual(
            args[0],
            [
                "poe-code",
                "--yes",
                "spawn",
                "--mcp-servers",
                '{"local":{"command":"server","args":["--stdio"]}}',
                "codex",
                "Run with MCP",
            ],
        )

    def test_spawn_rejects_conflicting_mcp_options(self) -> None:
        with self.assertRaises(ValueError):
            spawn(
                "codex",
                "Conflicting MCP config",
                mcp_servers={"one": {"command": "server-a"}},
                mcp_config={"two": {"command": "server-b"}},
            )

    def test_pretty_rejects_fractional_activity_timeout(self) -> None:
        with mock.patch("poe_spawn._spawn.subprocess.Popen") as popen:
            with self.assertRaises(ValueError):
                spawn.pretty("codex", "Invalid timeout", activity_timeout_ms=1.9)

        popen.assert_not_called()

    def test_pretty_rejects_string_args(self) -> None:
        with mock.patch("poe_spawn._spawn.subprocess.Popen") as popen:
            with self.assertRaises(TypeError):
                spawn.pretty("codex", "Invalid args", args="--verbose")

        popen.assert_not_called()

    def test_rejects_non_string_spawn_command_fields_before_starting_process(self) -> None:
        cases = [
            ("agent", {"agent": 123, "prompt": "Prompt"}),
            ("prompt", {"agent": "codex", "prompt": 123}),
            ("cwd", {"agent": "codex", "prompt": "Prompt", "cwd": 123}),
            ("model", {"agent": "codex", "prompt": "Prompt", "model": 123}),
            ("mode", {"agent": "codex", "prompt": "Prompt", "mode": 123}),
            ("log_dir", {"agent": "codex", "prompt": "Prompt", "log_dir": 123}),
            ("args[1]", {"agent": "codex", "prompt": "Prompt", "args": ["--flag", 123]}),
        ]

        with mock.patch("poe_spawn._spawn._resolve_cli_command", return_value=["poe-code"]), mock.patch(
            "poe_spawn._spawn.subprocess.Popen"
        ) as popen:
            for field, kwargs in cases:
                with self.subTest(field=field):
                    with self.assertRaises(TypeError) as context:
                        spawn.pretty(**kwargs)
                    self.assertIn(field, str(context.exception))

        popen.assert_not_called()

    def test_agent_enum_matches_spawn_visible_agents(self) -> None:
        self.assertEqual(
            [agent.value for agent in Agent],
            [
                "claude-code",
                "claude",
                "codex",
                "cursor",
                "cursor-agent",
                "gemini-cli",
                "gemini",
                "goose",
                "kimi",
                "kimi-cli",
                "opencode",
                "pi",
                "pi-agent",
                "poe-agent",
            ],
        )


if __name__ == "__main__":
    unittest.main()
