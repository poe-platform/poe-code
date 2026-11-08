/** Standard Python template and fragment values, without provider I/O. */
export const pythonLlmTemplateModule = /* @__PURE__ */ (() => String.raw`
import string as _string
from typing import Any as _Any, Optional as _Optional


class AttachmentType(BaseModel):
    type: str
    value: str


class Template(BaseModel):
    name: str
    prompt: _Optional[str] = None
    system: _Optional[str] = None
    attachments: _Optional[list[str]] = None
    attachment_types: _Optional[list[AttachmentType]] = None
    model: _Optional[str] = None
    defaults: _Optional[dict[str, _Any]] = None
    options: _Optional[dict[str, _Any]] = None
    extract: _Optional[bool] = None
    extract_last: _Optional[bool] = None
    schema_object: _Optional[dict] = None
    fragments: _Optional[list[str]] = None
    system_fragments: _Optional[list[str]] = None
    tools: _Optional[list[str]] = None
    functions: _Optional[str] = None
    model_config = ConfigDict(extra="forbid")

    class MissingVariables(Exception):
        pass

    def __init__(self, **data):
        super().__init__(**data)
        self._functions_is_trusted = False

    def evaluate(self, input, params=None):
        params = params or {}
        params["input"] = input
        for name, value in (self.defaults or {}).items():
            params.setdefault(name, value)
        prompt = self.interpolate(self.prompt, params) if self.prompt else input
        return prompt, self.interpolate(self.system, params)

    def vars(self):
        return {name for text in (self.prompt, self.system) if text
                for name in self.extract_vars(_string.Template(text))}

    @classmethod
    def interpolate(cls, text, params):
        if not text:
            return text
        template = _string.Template(text)
        missing = [name for name in cls.extract_vars(template) if name not in params]
        if missing:
            raise cls.MissingVariables("Missing variables: " + ", ".join(missing))
        return template.substitute(**params)

    @staticmethod
    def extract_vars(string_template):
        # The reference returns named occurrences, preserving duplicates.
        return [match.group("named")
                for match in string_template.pattern.finditer(string_template.template)
                if match.group("named")]


class Fragment(str):
    def __new__(cls, content, *args, **kwargs):
        return super().__new__(cls, content)

    def __init__(self, content, source=""):
        self.source = source

    def id(self):
        import hashlib
        return hashlib.sha256(self.encode("utf-8")).hexdigest()


class ModelError(Exception):
    pass


class NeedsKeyException(ModelError):
    pass
`)();
