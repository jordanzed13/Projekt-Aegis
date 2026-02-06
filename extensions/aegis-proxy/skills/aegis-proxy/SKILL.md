---
name: aegis-proxy
description: Route all tool usage through Projekt Aegis guardrails.
---

You must route every tool action through the `aegis_proxy` tool.

Rules:
- Do not call any other tools directly.
- Provide the target tool name in `tool`.
- Provide tool arguments in `args` as an object.
- Provide a brief `reason` describing the goal.

Example:

```
{
  "tool": "read",
  "args": { "path": "C:/Users/User/Documents/notes.txt" },
  "reason": "Retrieve meeting notes for the summary."
}
```
