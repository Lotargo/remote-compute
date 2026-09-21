# Project guidance

## Purpose

`remote-compute` is a compact bootstrap/setup utility for existing coding-agent harnesses. It should connect agents to official remote-compute provider tooling without becoming another planner, executor framework, or provider API client.

## Architectural constraints

- Keep the host agent in charge of planning, tool selection, permissions, retries, delegation, and verification.
- Prefer official provider CLIs/MCP servers over reimplementing provider APIs.
- Keep the agent-facing skill provider-neutral where practical.
- Provider-specific behavior should be discovered from the provider's current self-documentation instead of copied into a large static command reference.
- Do not add workload-specific logic for Sonata, ComfyUI, training, inference, or any other single workload.
- Treat remote workers as ephemeral and persistent state as external.
- Do not add a `remote-compute run` wrapper unless repeated real usage demonstrates that direct provider CLI usage is unreliable or unnecessarily expensive for agents.

## Host integration

Reuse the same integration principles already proven in `Lotargo/memory_plugin`:

- centralize client path resolution;
- respect XDG and client-specific config overrides;
- handle Windows executable shims explicitly;
- keep host-specific skill locations separate instead of assuming one universal path;
- prefer native client/provider commands before config-file fallbacks;
- verify the result of native operations when configuration is mutated;
- never overwrite or delete unrelated host configuration;
- make setup idempotent;
- make uninstall ownership-aware and fail closed.

The packaged skill must be treated as a directory, not only as a single `SKILL.md`, so references can be added later without changing the installer architecture.

## Security

- Never store, proxy, print, or commit OAuth tokens, cookies, refresh tokens, service-account secrets, or other credentials.
- Authentication helpers may launch official vendor authentication commands, but credentials remain owned by those tools.
- Never implement account rotation or quota circumvention.
- Do not silently commit or push a user's working tree.
- Do not delete a modified skill merely because it still contains a project marker.

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

Use each client's real skill directories. Codex may receive both its native skill copy and the shared `~/.agents/skills` copy; OpenCode, AGY/Antigravity, and Claude Code have their own layouts. Deduplicate paths when multiple host rules resolve to the same location.

## Development

- Keep runtime dependencies at zero unless a dependency clearly removes more complexity than it adds.
- Node.js 18+ is the current baseline.
- Keep commands small and inspectable: `setup`, `doctor`, `auth`, `uninstall`.
- Keep provider bootstrap code separate from host-integration code.
- Prefer dependency injection for HOME, cwd, env, and platform-sensitive helpers so local tests can use disposable temp environments.
- Local tests should use fake HOME/workspace/PATH/client executables and must not touch the developer's real agent configuration.
- Do not add CI/CD or GitHub Actions unless the repository owner explicitly asks for it. CI minutes are intentionally not being used right now.
- Tests and smoke checks are run locally for now.
- Do not add generated build output to the repository.
