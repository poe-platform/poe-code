import unittest

from poe_spawn._parse import parse_jsonl_line
from poe_spawn.types import AgentMessageEvent, SpawnResultEvent, ToolCompleteEvent, UsageEvent


class ParseJsonlLineTest(unittest.TestCase):
    def test_parses_known_event_into_generated_dataclass(self) -> None:
        event, result = parse_jsonl_line('{"event":"agent_message","text":"hello"}\n')

        self.assertEqual(event, AgentMessageEvent(event="agent_message", text="hello"))
        self.assertIsNone(result)

    def test_skips_lines_that_are_not_json(self) -> None:
        event, result = parse_jsonl_line("not-json\n")

        self.assertIsNone(event)
        self.assertIsNone(result)

    def test_parses_spawn_result_and_normalizes_nested_usage(self) -> None:
        event, result = parse_jsonl_line(
            '{"event":"spawn_result","exitCode":0,"threadId":"thread-1",'
            '"usage":{"inputTokens":3,"outputTokens":5},"protocolVersion":1}\n'
        )

        self.assertIsNone(event)
        self.assertEqual(
            result,
            SpawnResultEvent(
                event="spawn_result",
                exit_code=0,
                thread_id="thread-1",
                usage=UsageEvent(event="usage", input_tokens=3, output_tokens=5),
                protocol_version=1,
            ),
        )

    def test_skips_events_with_incompatible_runtime_field_types(self) -> None:
        event, result = parse_jsonl_line(
            '{"event":"usage","inputTokens":"three","outputTokens":5}\n'
        )

        self.assertIsNone(event)
        self.assertIsNone(result)

    def test_rejects_negative_usage_token_counts(self) -> None:
        for line in [
            '{"event":"usage","inputTokens":-1,"outputTokens":2,"cachedTokens":3}\n',
            '{"event":"usage","inputTokens":1,"outputTokens":-2,"cachedTokens":3}\n',
            '{"event":"usage","inputTokens":1,"outputTokens":2,"cachedTokens":-3}\n',
            '{"event":"spawn_result","exitCode":0,'
            '"usage":{"inputTokens":-1,"outputTokens":2,"cachedTokens":3}}\n',
        ]:
            with self.subTest(line=line):
                event, result = parse_jsonl_line(line)

                self.assertIsNone(event)
                self.assertIsNone(result)

    def test_rejects_non_finite_usage_costs(self) -> None:
        for line in [
            '{"event":"usage","inputTokens":1,"outputTokens":2,"costUsd":NaN}\n',
            '{"event":"usage","inputTokens":1,"outputTokens":2,"costUsd":Infinity}\n',
            '{"event":"usage","inputTokens":1,"outputTokens":2,"costUsd":-Infinity}\n',
            '{"event":"spawn_result","exitCode":0,'
            '"usage":{"inputTokens":1,"outputTokens":2,"costUsd":Infinity}}\n',
        ]:
            with self.subTest(line=line):
                event, result = parse_jsonl_line(line)

                self.assertIsNone(event)
                self.assertIsNone(result)

    def test_rejects_negative_spawn_result_numeric_fields(self) -> None:
        for line in [
            '{"event":"spawn_result","exitCode":-1}\n',
            '{"event":"spawn_result","exitCode":0,"protocolVersion":-1}\n',
        ]:
            with self.subTest(line=line):
                event, result = parse_jsonl_line(line)

                self.assertIsNone(event)
                self.assertIsNone(result)

    def test_preserves_tool_completion_without_kind(self) -> None:
        event, result = parse_jsonl_line(
            '{"event":"tool_complete","path":"unknown output"}\n'
        )

        self.assertEqual(
            event,
            ToolCompleteEvent(event="tool_complete", kind=None, path="unknown output"),
        )
        self.assertIsNone(result)

        event, result = parse_jsonl_line(
            '{"event":"spawn_result","exitCode":0,"threadId":7,'
            '"usage":{"inputTokens":3,"outputTokens":null}}\n'
        )

        self.assertIsNone(event)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
