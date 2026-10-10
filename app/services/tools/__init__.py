"""Teacher tools: meeting notes, feedback, adapt a reading, parent email.

Jobs, not prompts: the teacher fills a small form, a background job asks the model for
strict JSON (validated, one repair retry), and the result is a private draft the teacher
edits. Nothing is sent and nothing is graded. Prompts live in each tool's module."""

from .common import TOOLS, NotFound, ToolError
from .worker import ToolWorker

__all__ = ["TOOLS", "NotFound", "ToolError", "ToolWorker"]
