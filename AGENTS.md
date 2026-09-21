# Project guidance

## Purpose

`remote-compute` is a compact setup and compatibility utility for existing coding-agent harnesses. It connects those harnesses to official remote-compute provider tooling without becoming another planner, executor framework, provider API client, or credential store.

The core boundary is simple:

- the host agent owns planning, delegation, permissions, retries, tool choice, and verification;
- the official provider tooling owns provider semantics, provisioning, remote execution, and provider-native storage integrations;
- `remote-compute` owns installation, skill policy, diagnostics, authentication handoff, and deterministic platform compatibility.

## Architectural constraints

- Keep the host agent in charge of planning and execution strategy.
- Prefer official provider CLIs or MCP servers over reimplementing provider APIs.
- Keep the agent-facing skill provider-neutral where practical.
- Discover provider-specific behavior from the provider's current self-documentation instead of maintaining a large copied command reference.
- Do not add workload-specific runtime logic for ComfyUI, training, inference, rendering, compilation, or any other single workload.
- Treat remote workers as ephemeral and important state as external/persistent.
- Do not add a `remote-compute run` orchestration layer unless repeated real usage proves the existing provider flow is insufficient.
- A thin passthrough such as `remote-compute colab ...` is allowed when it only normalizes platform transport/auth defaults and preserves official provider CLI semantics.
- Do not silently introduce Docker or another VM/container runtime as a requirement.

## Host integration

Reuse the integration principles already proven in `Lotargo/memory_plugin`:

- centralize client path resolution;
- respect XDG and client-specific config overrides;
- handle Windows executable shims explicitly;
- keep host-specific skill locations separate instead of assuming one universal path;
- prefer native client/provider commands before config-file fallbacks;
- verify the result of mutations;
- never overwrite or delete unrelated host configuration;
- make setup idempotent;
- make uninstall ownership-aware and fail closed.

The packaged skill is a directory, not merely one `SKILL.md`, so references can be added later without changing installer architecture.

Current agent hosts:

- Codex
- AGY / Antigravity CLI
- OpenCode
- Claude Code

Use each client's real skill directories. Codex may receive both its native skill copy and the shared `~/.agents/skills` copy. OpenCode, AGY/Antigravity, and Claude Code have their own layouts. Deduplicate paths when multiple host rules resolve to the same location.

## Provider transport

Provider transport is deterministic compatibility plumbing, not another agent harness.

Current policy:

- Linux/macOS: use native provider CLI when available.
- Windows: prefer native provider CLI if upstream supports it; otherwise use WSL as the compatibility backend.
- Do not require the host coding agent or user repository to move into WSL.
- Keep native and WSL transport logic separate from provider policy.
- Run provider argv through `wsl.exe --exec`; do not interpolate user arguments into shell command strings.
- Pass Windows cwd through WSL's own `--cd` support for normal provider execution.
- Never hardcode drive mappings such as `C:` -> `/mnt/c`, `F:` -> `/mnt/f`, or any equivalent convention.
- Translate explicit absolute Windows paths through WSL's own `wslpath` command.
- Treat mapped/network drives as potentially unavailable in WSL and report that condition rather than inventing a path.
- Support distro selection through `--wsl-distro` / `REMOTE_COMPUTE_WSL_DISTRO` without changing the user's global WSL default.
- Resolve user-local WSL tools under `$HOME/.local/bin` without requiring shell profile edits.
- WSL installation may require administrator privileges, restart, or one-time distro initialization; report these states instead of hanging on an interactive prompt.
- Never remove a user's WSL distro during uninstall.

## Current provider: Google Colab

The current provider is Google Colab through the official `google-colab-cli` / `colab` CLI.

### Bootstrap

- Prefer `uv tool install google-colab-cli`.
- Install the Google-maintained `jupyter-kernel-client` fork required by Colab CLI at the pinned revision already defined in provider bootstrap code.
- If `uv` is missing, bootstrap Astral's official standalone `uv` installer into the provider user's `~/.local/bin`.
- Existing `pipx` may be used as a fallback and must inject the same pinned Google kernel-client fork.
- Respect PEP 668. Never add `--break-system-packages` as an automatic workaround.
- Do not mutate shell profiles merely to expose bootstrapped tools; transport resolution should find managed user-local executables directly.

### Authentication

- The default managed authentication path is Colab's official OAuth2 copy-paste flow.
- Managed provider commands default to `--auth=oauth2` unless the caller explicitly supplies another auth mode.
- `gcloud` / ADC is optional and should only be treated as required when the user explicitly selects an ADC workflow such as `--auth=adc`.
- `remote-compute auth` may launch the official interactive OAuth2 flow, but credentials remain owned by Colab/Google tooling.
- Never store, proxy, log, print, commit, or copy OAuth tokens, refresh tokens, cookies, authorization codes, service-account secrets, or ADC credential files.
- Do not copy credentials between Windows and WSL.
- Access verification should use a harmless provider query such as `colab sessions` and must not claim success merely because login started.

### Persistent storage and Google Drive

- Use the official Colab CLI's `drivemount` capability for Google Drive access; do not add a parallel Drive API client or `remote-compute drive` subsystem while provider-native mounting is sufficient.
- Use provider-native upload/download for small one-off transfers where mounting persistent storage would add unnecessary interaction.
- Treat Drive mounting as interactive. It may require browser consent and a terminal confirmation, so non-interactive agents must ask the user to complete that step instead of hanging on a prompt.
- Do not assume Drive is mounted merely because a Colab session exists; verify the mount before starting work that depends on it.
- Keep lifecycle roles distinct: Git for reproducible source, upload/download for disposable transfer, Drive for durable large assets/checkpoints/shared outputs, and VM-local disk for the hot working set.
- For compute-heavy I/O, copy the hot subset from Drive to VM-local storage before repeated access. Persist important checkpoints/artifacts back to external storage at useful recovery points.
- Provider storage command syntax belongs to the official CLI. Teach agents to inspect `remote-compute colab help drivemount` rather than duplicating a large static reference here.

## Security and user-state boundaries

- Never implement account rotation or quota circumvention.
- Never provision paid compute without explicit user intent.
- Do not silently commit or push a user's working tree.
- Do not delete a modified managed skill merely because it still contains a project marker.
- Do not move large user assets into Git just to reach remote compute.
- Prefer persistent external storage for checkpoints, large models, datasets, and important artifacts.
- Treat remote worker-local storage as disposable.

## Scope discipline

Before adding a wrapper command, ask whether the official provider CLI already solves the problem. If it does, teach the skill to use that provider capability instead of duplicating it.

Only add deterministic helper code when it removes platform-specific friction or repeated real-world failures. Do not add speculative abstractions "for later".

The currently supported public CLI surface should stay small and inspectable:

- `setup`
- `doctor`
- `auth`
- `colab`
- `wsl-path`
- `uninstall`

## Documentation roles

Keep the documentation layers distinct:

- `README.md`: public user-facing installation, usage, architecture, and troubleshooting.
- `CHANGELOG.md`: release history and release-note source.
- `skills/remote-compute/SKILL.md`: runtime instructions for installed coding agents using remote compute.
- `AGENTS.md`: repository-development constraints for agents modifying this project.

`AGENTS.md` is development guidance and should not be added to the npm package unless there is a concrete runtime need for it.

When behavior changes, update the relevant public docs and changelog instead of leaving architecture decisions only in code or agent instructions.

## Development

- Keep runtime dependencies at zero unless a dependency clearly removes more complexity than it adds.
- Node.js 18.18+ is the current baseline so ESLint 9 and the runtime agree on the supported floor.
- Keep provider bootstrap code separate from host-integration code and transport code.
- Prefer dependency injection for HOME, cwd, env, platform, and process runners so tests can use disposable environments.
- Local tests must use fake HOME/workspace/PATH/client executables and must not touch the developer's real agent, WSL, provider, or credential configuration.
- Contract tests should verify package metadata, CLI help, host definitions, skill metadata, transport files, packaging surfaces, and other public integration contracts.
- Cross-platform tests should cover Windows executable shims/path behavior, Unix behavior, native-vs-WSL selection, WSL distro selection, OAuth2 defaults, provider passthrough, and path delegation for arbitrary drive letters.
- Tests must prove that Windows path conversion is delegated to `wslpath`; do not implement or test a homemade `/mnt/<letter>` mapper.
- ESLint is the general semantic/static linter. Do not rely on `node --check` alone.
- `npm run verify` is the canonical local quality gate and must include lint, syntax checks, tests, contract checks, platform/transport checks, and packaging validation.
- Keep `scripts/verify.sh` and `scripts/verify.bat` as thin wrappers around the same `npm run verify` command so validation cannot drift between shells.
- Do not add CI/CD or GitHub Actions unless the repository owner explicitly asks for it.
- Tests and smoke checks are intentionally local for now.
- Do not add generated build output to the repository.

## Release discipline

Before publishing a release:

- run the canonical local verification gate;
- confirm `npm pack --dry-run --ignore-scripts` contains only intended runtime/public files;
- keep `README.md`, `CHANGELOG.md`, CLI help, package version, and actual behavior consistent;
- preserve zero runtime dependencies unless intentionally changed;
- do not describe Linux/macOS or other environments as end-to-end validated unless they were actually exercised on those hosts;
- distinguish contract/test coverage from real-host smoke validation.

The Windows -> WSL -> Colab OAuth2 path has been validated end-to-end. Future compatibility claims should follow the same evidence standard.
