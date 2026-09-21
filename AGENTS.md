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
- Do not add a `remote-compute run` orchestration wrapper unless repeated real usage demonstrates that direct provider CLI usage is unreliable or unnecessarily expensive for agents.
- A thin provider passthrough such as `remote-compute colab ...` is allowed when it only normalizes platform transport and preserves the official provider CLI semantics.

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

## Provider transport

Provider transport is deterministic compatibility plumbing, not another agent harness.

Current transport policy:

- Linux/macOS: use native provider CLI when available.
- Windows: prefer native provider CLI if upstream supports it; otherwise use WSL as the compatibility backend.
- Do not require the host coding agent or user repository to move into WSL.
- Keep native and WSL transport logic separate from provider policy.
- Run arbitrary provider arguments through `wsl.exe --exec`; do not build shell command strings from user input.
- Pass Windows cwd through WSL's own `--cd` support.
- Never hardcode `C:`, `F:`, `Z:`, `/mnt/c`, or any other drive mapping.
- Translate explicit absolute Windows paths through WSL's own `wslpath` command.
- Treat mapped/network drives as potentially unavailable in WSL and report that condition rather than inventing a mount.
- `REMOTE_COMPUTE_WSL_DISTRO` / `--wsl-distro` may select a distro without changing Windows' global WSL default.
- WSL installation may require administrator privileges, restart, or one-time distro initialization; setup must report these states instead of hanging on an interactive prompt.
- Never remove a user's WSL distro during uninstall.

## Security

- Never store, proxy, print, or commit OAuth tokens, cookies, refresh tokens, service-account secrets, or other credentials.
- Authentication helpers may launch official vendor authentication commands, but credentials remain owned by those tools.
- On Windows, Google credentials used by a WSL-hosted Colab CLI must stay in that same WSL environment; do not copy ADC files between Windows and WSL.
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

Current provider transports:

- native
- Windows -> WSL

Use each client's real skill directories. Codex may receive both its native skill copy and the shared `~/.agents/skills` copy; OpenCode, AGY/Antigravity, and Claude Code have their own layouts. Deduplicate paths when multiple host rules resolve to the same location.

## Development

- Keep runtime dependencies at zero unless a dependency clearly removes more complexity than it adds.
- Node.js 18.18+ is the current baseline so ESLint 9 and the runtime agree on the supported floor.
- Keep commands small and inspectable: `setup`, `doctor`, `auth`, `colab`, `wsl-path`, `uninstall`.
- Keep provider bootstrap code separate from host-integration code and transport code.
- Prefer dependency injection for HOME, cwd, env, platform, and process runners so local tests can use disposable temp environments.
- Local tests should use fake HOME/workspace/PATH/client executables and must not touch the developer's real agent, WSL, or provider configuration.
- Contract tests should verify package metadata, CLI help, host definitions, skill metadata, transport files, and other public integration surfaces.
- Cross-platform tests should cover Windows executable shims/path behavior, Unix behavior, native-vs-WSL transport selection, WSL distro selection, and path delegation for multiple arbitrary drive letters.
- Tests must prove that path conversion is delegated to `wslpath`; do not merely test a homemade `/mnt/<letter>` conversion helper.
- ESLint is the general semantic/static linter. Do not rely on `node --check` alone.
- `npm run verify` is the canonical local quality gate and must include lint, syntax checks, tests, contract checks, platform checks, transport checks, and packaging validation.
- Keep `scripts/verify.sh` and `scripts/verify.bat` thin wrappers around the same `npm run verify` command so validation cannot drift between shells.
- Do not add CI/CD or GitHub Actions unless the repository owner explicitly asks for it. CI minutes are intentionally not being used right now.
- Tests and smoke checks are run locally for now.
- Do not add generated build output to the repository.
