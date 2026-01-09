export const templateFixtures = new Map<string, string>([
  [
    "python/env.hbs",
    [
      "POE_API_KEY={{apiKey}}",
      "POE_BASE_URL=https://api.poe.com/v1",
      "MODEL={{model}}"
    ].join("\n")
  ],
  [
    "python/main.py.hbs",
    [
      "import os",
      "from openai import OpenAI",
      "from dotenv import load_dotenv",
      "",
      "load_dotenv()",
      "",
      "client = OpenAI(",
      '    _key=os.getenv("POE_API_KEY"),',
      '    base_url=os.getenv("POE_BASE_URL")',
      ")",
      "",
      "response = client.chat.completions.create(",
      '    model=os.getenv("MODEL", "{{model}}"),',
      '    messages=[{"role": "user", "content": "Tell me a joke"}]',
      ")",
      "",
      "print(response.choices[0].message.content)"
    ].join("\n")
  ],
  [
    "python/requirements.txt.hbs",
    ["openai>=1.0.0", "python-dotenv>=1.0.0"].join("\n")
  ],
  [
    "codex/config.toml.hbs",
    [
      'model_provider = "poe"',
      'model = "{{model}}"',
      'model_reasoning_effort = "{{reasoningEffort}}"',
      "",
      "[model_providers.poe]",
      'name = "poe"',
      'base_url = "https://api.poe.com/v1"',
      'wire_api = "chat"',
      'experimental_bearer_token = "{{apiKey}}"'
    ].join("\n")
  ]
]);
