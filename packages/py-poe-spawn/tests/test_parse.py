import unittest

from poe_spawn._parse import parse_jsonl_line
from poe_spawn.types import AgentMessageEvent, SpawnResultEvent, UsageEvent


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


if __name__ == "__main__":
    unittest.main()
