# Changelog

All notable changes to `remote-compute` are documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows semantic versioning for published releases.

## [Unreleased]

No unreleased changes yet.

## [0.1.0] - 2026-09-22

Initial release of `remote-compute`.

### Highlights

- Added a compact **Google Colab remote-compute integration layer for existing coding-agent harnesses** instead of introducing a second planner/runtime.
- Added Google Colab through the official `google-colab-cli`, with package/discovery metadata centered on Colab rather than a generic cloud-orchestration promise.
- Added a transparent Windows -> WSL compatibility bridge, allowing users to stay in PowerShell and keep their repositories and agent CLIs on Windows.
- Added the official Colab OAuth2 copy-paste login flow, verified end-to-end from Windows through WSL to Google Colab.
- Added agent guidance for provider-native Google Drive mounting and persistent large-asset/checkpoint workflows without introducing a separate Drive API client.
- Kept runtime dependencies at zero and avoided Docker, a custom Colab API client, credential storage, and a generic SSH/cloud abstraction.

### Added

#### Agent host integration

- Detection and managed skill installation for:
  - Codex;
  - AGY / Antigravity CLI;
  - OpenCode;
  - Claude Code.
- Host-specific skill directories instead of assuming one universal layout.
- Support for XDG/OpenCode configuration overrides.
- Idempotent setup and ownership-aware uninstall behavior.
- Protection against overwriting unrelated skills or deleting modified managed skills.

#### Provider gateway

- Added `remote-compute colab <args...>` as a platform-neutral passthrough to the official Colab CLI.
- Native provider execution on supported hosts.
- Automatic WSL fallback on Windows when native `colab` is unavailable.
- Native provider support remains preferred automatically if it becomes available on Windows later.
- Provider flags are forwarded without reimplementing Colab command semantics.
- Provider-native Google Drive mounting remains available through `remote-compute colab drivemount ...`; no parallel Drive API/storage subsystem is introduced.
- Provider upload/download commands remain available through the same gateway for small disposable file transfers.

#### Windows / WSL compatibility

- Automatic `wsl.exe` discovery and WSL distro inspection.
- Optional WSL installation through `remote-compute setup --install-wsl`.
- Support for a specific distro through `--wsl-distro <name>` or `REMOTE_COMPUTE_WSL_DISTRO`.
- Provider execution through WSL without moving Codex, AGY, OpenCode, Claude Code, or the repository into Linux.
- Working-directory bridging through WSL's native `--cd` behavior.
- Added `remote-compute wsl-path` for explicit Windows -> Linux path translation.
- Path translation delegates to `wslpath`; drive letters such as `C:`, `F:`, and `Z:` are never hardcoded to `/mnt/<letter>`.

#### Colab bootstrap

- Added `remote-compute setup --install-colab`.
- `uv` is preferred for isolated Colab CLI installation.
- Added automatic user-space bootstrap of Astral's standalone `uv` installer when `uv` is missing.
- Existing `pipx` is supported as a fallback.
- Added explicit installation of the Google-maintained `jupyter-kernel-client` fork required by Colab CLI.
- The Google fork is pinned to a known revision to avoid resolving the incompatible same-named PyPI package.
- PEP 668 protections are respected; `remote-compute` does not use `--break-system-packages`.
- WSL executable discovery also checks `$HOME/.local/bin`, so shell profile edits are not required after tool bootstrap.

#### Authentication

- Added `remote-compute auth` using the official Colab OAuth2 copy-paste authorization flow.
- Managed provider calls default to `--auth=oauth2`.
- Explicit provider auth options are preserved, including `--auth=adc`.
- `gcloud` is optional and only relevant for explicit ADC workflows.
- Credentials remain owned by official Google tooling; `remote-compute` does not store OAuth tokens, cookies, authorization codes, or refresh tokens.

#### Diagnostics and lifecycle

- Added `remote-compute doctor` with checks for:
  - agent host discovery;
  - skill state and ownership;
  - provider transport;
  - WSL availability and distro selection;
  - Colab CLI availability;
  - OAuth2 provider access;
  - optional `gcloud` presence;
  - platform readiness.
- Added `remote-compute uninstall` and `--dry-run`.
- Added `remote-compute --version` and CLI help.

#### Agent skill policy

- Added a provider-facing skill that keeps planning inside the existing host harness.
- The skill teaches agents to:
  - prefer local compute when sufficient;
  - use Colab remote compute only when useful;
  - consult provider self-documentation through `remote-compute colab skill/help`;
  - use exact Git revisions for reproducible jobs;
  - avoid silently committing or pushing user work;
  - use provider upload/download for small disposable transfers;
  - use Colab's provider-native `drivemount` flow for persistent large assets/checkpoints when appropriate;
  - recognize Drive mounting as interactive and ask the user to complete consent rather than hanging unattended;
  - keep the hot working set on VM-local storage for compute-heavy access;
  - keep large assets and checkpoints outside Git;
  - treat remote workers as disposable;
  - persist important state externally;
  - collect artifacts before teardown;
  - stop unused paid/limited compute;
  - avoid reasoning about WSL drive mappings during normal operation.

### Fixed

- Fixed CRLF-sensitive contract tests on Windows.
- Fixed host-detection tests leaking real user PATH entries into hermetic test environments.
- Fixed Windows provider routing so Colab can execute through WSL without requiring users to work inside WSL directly.
- Fixed Debian/Ubuntu PEP 668 failures by replacing direct `pip install --user` bootstrap logic with isolated `uv` / `pipx` tooling.
- Fixed user-local WSL executable resolution for tools installed under `~/.local/bin`.
- Fixed authentication UX by using Colab's OAuth2 flow instead of requiring `gcloud` for the default path.
- Fixed Colab installation by pinning the Google-maintained `jupyter-kernel-client` fork required by the CLI.

### Verification

The release includes a local quality gate covering:

- ESLint;
- `node --check` syntax validation;
- host/path integration tests;
- skill lifecycle tests;
- native and WSL transport tests;
- Colab transport tests;
- provider gateway tests;
- path delegation tests for `C:`, `F:`, and `Z:`;
- package and CLI contract tests;
- `npm pack --dry-run` validation.

The Windows flow was also validated end-to-end with the real stack:

```text
PowerShell
   ↓
remote-compute
   ↓
WSL
   ↓
google-colab-cli
   ↓
OAuth2
   ↓
Google Colab
```

The validated environment reached `remote-compute doctor -> Status: READY`, and `remote-compute colab sessions` successfully queried the provider through the Windows -> WSL bridge.

### Known scope for 0.1.0

- Google Colab is the product focus and the only provider adapter in this release.
- The project intentionally does not treat generic SSH/HTTP-accessible compute as a missing provider; existing agent tools should be used directly for ordinary remote servers and exposed inference APIs.
- Additional provider adapters are not a roadmap requirement and should only be added when real provider-specific friction justifies them.
- The official Colab MCP is a possible future optional integration for interactive browser-notebook workflows; the official Colab CLI remains the default headless compute path.
- Windows uses WSL as the compatibility backend when native Colab is unavailable.
- Google Drive access uses Colab CLI's interactive provider-native `drivemount` flow rather than a custom Drive integration; unattended agents may require user consent before continuing.
- Fresh WSL installations may require a restart and one-time distro initialization before provider setup can finish.
- Mapped/network Windows drives may not be accessible to WSL depending on host configuration.
- CI/CD is intentionally not configured; the canonical verification gate is local via `npm run verify`.
- Linux and macOS are covered by the native transport contract suite; broader real-host validation will continue after the first release.

[Unreleased]: https://github.com/Lotargo/remote-compute/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Lotargo/remote-compute/releases/tag/v0.1.0
