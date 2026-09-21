# Project guidance

## Purpose

`remote-compute` is a compact bootstrap/setup utility for existing coding-agent harnesses. It should connect agents to official remote-compute provider tooling without becoming another planner, executor framework, or provider API client.

## Architectural constraints

- Keep the host agent in charge of planning, tool selection, permissions, retries, and verification.
- Prefer official provider CLIs/MCP servers over reimplementing provider APIs.
- Keep the agent-facing skill provider-neutral where practical.
- Provider-specific behavior should be discovered from the provider's current self-documentation instead of copied into a large static command reference.
- Do not add workload-specific logic for Sonata, ComfyUI, training, inference, or any other single workload.
- Treat remote workers as ephemeral and persistent state as external.

## Security

- Never store, proxy, print, or commit OAuth tokens, cookies, refresh tokens, service-account secrets, or other credentials.
- Authentication helpers may launch official vendor authentication commands, but credentials remain owned by those tools.
- Never implement account rotation or quota circumvention.
- Do not silently commit or push a user's working tree.

## Scope discipline

Before adding a wrapper command, ask whether the official provider CLI already solves the problem. If it does, teach the skill to use that command rather than duplicating it.

Only add deterministic helper code when repeated real-world use shows that prose instructions are unreliable or unnecessarily expensive.

## Compatibility

Current agent hosts:

- Codex
- AGY / Antigravity CLI
- OpenCode
- Claude Code

Current provider:

- Google Colab via the official `colab` CLI

The shared Agent Skills location is preferred when supported. Avoid unnecessary duplicate copies of the same skill.

## Development

- Keep runtime dependencies at zero unless a dependency clearly removes more complexity than it adds.
- Node.js 18+ is the current baseline.
- Keep commands small and inspectable: `setup`, `doctor`, `auth`, `uninstall`.
- Do not add CI/CD or GitHub Actions unless the repository owner explicitly asks for it. CI minutes are intentionally not being used right now.
- Tests and smoke checks are run locally for now.
- Do not add generated build output to the repository.
