# remote-compute

A compact setup layer that teaches existing coding-agent harnesses how to use remote compute without replacing their planner, tool loop, or provider CLIs.

`remote-compute` is intentionally **not** another agent runtime. It detects supported agent hosts, installs a provider-neutral skill into the host's real skill directories, prepares the provider tooling, bridges platform differences, helps launch the official authentication flow, and then stays out of planning.

Current provider: **Google Colab via the official `colab` CLI**.

## Mental model

```text
Codex / AGY / Claude Code / OpenCode
                 │
                 │ existing harness
                 ▼
        remote-compute skill
                 │
                 │ policy / workflow
                 ▼
      remote-compute colab
                 │
        ┌────────┴────────┐
        ▼                 ▼
 native colab          Windows
                         │
                         ▼
                        WSL
                         │
                         ▼
                   official colab
        └────────┬────────┘
                 ▼
          remote compute
```

The host agent keeps responsibility for planning, retries, permissions, delegation, and verification. The provider CLI keeps responsibility for provisioning and execution. `remote-compute` only owns setup, integration policy, and deterministic compatibility routing.

## Why

Typical workflow:

1. Develop locally in the user's normal environment.
2. Keep reproducible source state in Git when exact revision matters.
3. Use remote compute only when local CPU, RAM, GPU, VRAM, or platform support is insufficient.
4. Keep large assets such as model weights, datasets, checkpoints, and generated media outside Git, for example in Google Drive.
5. Copy the hot working set to the remote worker's local disk before compute-heavy use.
6. Treat remote workers as disposable.
7. Persist important state outside the worker and collect artifacts before shutdown.

The same policy works for model training, ComfyUI, CUDA benchmarks, rendering, data processing, compilation, or arbitrary Linux workloads. There is no Sonata-specific or ComfyUI-specific runtime logic here.

## Supported agent hosts

The setup currently detects these CLIs on `PATH`:

- `codex`
- `agy`
- `opencode`
- `claude`

At least one supported host is enough. You do **not** need to install every supported agent.

Skill installation is host-aware instead of assuming every client shares one directory:

```text
Codex
  ~/.codex/skills/remote-compute/
  ~/.agents/skills/remote-compute/

AGY / Antigravity
  ~/.gemini/config/skills/remote-compute/
  <workspace>/.agents/skills/remote-compute/   # when .agents already exists

OpenCode
  $OPENCODE_CONFIG_DIR/skills/remote-compute/
  or ~/.config/opencode/skills/remote-compute/

Claude Code
  ~/.claude/skills/remote-compute/
```

`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `OPENCODE_CONFIG_DIR` are respected where applicable.

## Requirements

- Node.js 18.18+
- at least one supported agent CLI
- for the current provider: the official Google Colab CLI

On Linux and macOS, Colab is used natively. On Windows, native Colab is preferred automatically if upstream adds support; otherwise `remote-compute` uses WSL as a compatibility backend. The user does not need to move Codex, AGY, Claude Code, OpenCode, or the repository into WSL.

No Docker runtime is required.

Colab installation prefers `uv tool install google-colab-cli`. If `uv` is missing, `remote-compute` can bootstrap Astral's official standalone `uv` installer into the provider user's `~/.local/bin` without modifying shell profiles, then install Colab through `uv`. Existing `pipx` is used as a fallback. The installer intentionally does **not** use `pip --break-system-packages` to bypass PEP 668 protections.

## Install

Until an npm release exists:

```bash
npm install -g github:Lotargo/remote-compute
```

Then:

```bash
remote-compute setup
```

After a future npm release:

```bash
npm install -g @lotargo/remote-compute
```

## Windows / WSL bridge

Windows remains the user's development environment. WSL exists only as a thin provider compatibility backend when the official Colab CLI cannot run natively.

```text
PowerShell / Windows agent
          │
          ▼
    remote-compute
          │
          ▼
       wsl.exe
          │
          ▼
 official Linux Colab CLI
          │
          ▼
        Colab
```

`remote-compute setup` detects WSL automatically. If WSL or a distro is missing it can offer installation, or installation can be requested explicitly:

```powershell
remote-compute setup --install-wsl --install-colab
```

By default Windows' configured default WSL distribution is used. A specific installed distro can be selected without changing the global WSL default:

```powershell
remote-compute setup --wsl-distro Ubuntu --install-colab
remote-compute doctor --wsl-distro Ubuntu
remote-compute auth --wsl-distro Ubuntu
```

The same selection can be supplied through `REMOTE_COMPUTE_WSL_DISTRO`.

A fresh WSL installation may require a Windows restart and/or one-time distro user initialization. `remote-compute` reports that state rather than pretending the provider is ready.

On modern Debian/Ubuntu releases, system Python can be marked as externally managed. `remote-compute` treats that as a reason **not** to force a global/user pip install. Instead it bootstraps `uv` in user space and installs the Colab CLI as an isolated tool.

### Windows paths

Drive letters are never hardcoded. The bridge passes the Windows working directory to WSL using WSL's own `--cd` support and uses WSL's own `wslpath` when an explicit absolute path translation is needed.

Examples:

```text
C:\projects\repo
F:\projects\repo
Z:\projects\repo
```

are not converted by string replacement such as `C:` -> `/mnt/c`. Instead:

```powershell
remote-compute wsl-path "F:\projects\repo\model.bin"
```

asks the selected WSL distro to translate the path. This respects custom WSL automount configuration. Mapped network drives may be unavailable inside WSL; that is reported as a real compatibility condition rather than hidden with an invented path.

For provider commands, prefer relative local paths. WSL starts the provider command in the current Windows working directory, so the repository can remain on its normal Windows drive.

## Commands

### `remote-compute setup`

Detects installed agent hosts, installs or refreshes the bundled `remote-compute` skill, prepares the provider transport, checks the Colab CLI, and reports the remaining authentication step when necessary.

```bash
remote-compute setup
remote-compute setup --install-colab
remote-compute setup --codex
remote-compute setup --agy --opencode
remote-compute setup --force
```

Windows-specific setup examples:

```powershell
remote-compute setup --install-wsl --install-colab
remote-compute setup --wsl-distro Ubuntu --install-colab
```

Host flags:

```text
--codex
--agy
--opencode
--claude
```

Without host flags, setup targets every supported host that is actually detected.

`--force` only refreshes a skill directory that still identifies itself as managed by this package. An unrelated skill with the same name is never overwritten.

### `remote-compute doctor`

Checks the real integration rather than only testing whether files exist:

- supported host CLI discovery;
- expected skill directories;
- exact packaged-skill ownership versus modified/unrelated copies;
- native versus WSL provider transport;
- WSL distro selection on Windows;
- `colab` availability in the selected transport;
- a read-only Colab sessions query;
- `gcloud` availability in the same provider environment;
- platform compatibility.

```bash
remote-compute doctor
remote-compute doctor --codex
remote-compute doctor --wsl-distro Ubuntu
```

The report uses `OK`, `WARN`, `INFO`, and `FAIL`. A failing required check produces a non-zero exit status.

### `remote-compute auth`

Starts the official Google Application Default Credentials flow through `gcloud` in the same environment where Colab runs, then verifies access with a read-only Colab command.

```bash
remote-compute auth
remote-compute auth --wsl-distro Ubuntu
```

This project does not receive, proxy, print, or store Google credentials. Authentication remains owned by Google's tooling.

### `remote-compute colab`

Transparent passthrough to the official Colab CLI:

```bash
remote-compute colab skill
remote-compute colab sessions
remote-compute colab help run
```

On Linux/macOS this invokes native `colab`. On Windows it prefers future native support if present and otherwise runs the same provider command through WSL. There is no second planner or custom Colab API client in this path.

### `remote-compute wsl-path`

Windows diagnostic/path bridge:

```powershell
remote-compute wsl-path "Z:\work\artifact.bin"
```

The result comes from `wslpath` inside the selected distro. No `/mnt/<drive>` convention is assumed by this package.

### `remote-compute uninstall`

Removes only unmodified skill directories that exactly match the packaged skill. If a user has changed a managed skill, it is preserved instead of being deleted.

```bash
remote-compute uninstall
remote-compute uninstall --codex
remote-compute uninstall --dry-run
```

Provider CLIs, WSL distributions, and Google credentials are never removed.

## Agent behavior

The bundled skill deliberately stays small. Its main rules are:

- prefer local execution when local resources are sufficient;
- use remote compute as a capability, not as a second planning system;
- use `remote-compute colab ...` as the platform-neutral provider gateway;
- query the provider's own self-documentation instead of guessing provider flags;
- use exact Git revisions for reproducible jobs;
- do not commit or push user work without permission;
- use disposable file transfer for quick uncommitted experiments;
- keep large binaries outside Git;
- copy hot assets to the remote worker's local disk before repeated compute-heavy access;
- checkpoint long jobs to persistent external storage;
- collect artifacts before shutdown;
- stop unused paid compute;
- never guess WSL drive mappings.

For Colab-specific details the skill tells the agent to consult the installed provider directly through the gateway:

```bash
remote-compute colab skill
remote-compute colab help
remote-compute colab help <command>
```

This avoids duplicating Google's fast-changing CLI documentation inside this repository.

## Architecture

The setup layer is split into small modules:

```text
src/
├── cli.mjs                command routing and UX
├── client_cli.mjs         cross-platform executable discovery and CLI launching
├── client_paths.mjs       host path resolution / XDG handling
├── hosts.mjs              supported host definitions and skill targets
├── skills.mjs             ownership-safe skill install/remove
├── colab.mjs              provider selection/bootstrap/auth/passthrough
└── transports/
    ├── native.mjs         native provider execution
    └── wsl.mjs            Windows -> WSL compatibility bridge
```

The host-integration layer intentionally follows patterns already proven in `Lotargo/memory_plugin`: centralized client paths, Windows npm-shim handling, host-specific targets, ownership-aware cleanup, native tooling first, and temp-environment tests.

There is still no custom Colab API client and no second harness.

## Local development and verification

No CI/CD or GitHub Actions are configured for now. Validation is intentionally local, but the local gate is comprehensive.

Install development dependencies once:

```bash
npm install
```

The full verification pipeline runs:

1. ESLint for semantic/static code-quality checks beyond syntax;
2. `node --check` for every source and test entry point;
3. unit/integration-style local tests;
4. package/CLI/skill contract tests;
5. native/Windows/WSL transport tests, including `C:`, `F:`, and `Z:` path delegation through `wslpath`;
6. an `npm pack --dry-run` packaging check.

Run everything with:

```bash
npm run verify
```

Platform wrappers are included so the same gate is easy to run from a native shell:

```bash
# Linux / macOS / WSL
sh scripts/verify.sh
```

```bat
:: Windows cmd.exe / PowerShell
scripts\verify.bat
```

Useful focused commands:

```bash
npm run lint
npm run lint:fix
npm run check
npm test
npm run test:contracts
npm run test:platform
npm run test:colab
npm run test:wsl
npm run package:check
```

The tests use temporary HOME/workspace/bin directories and fake CLIs so setup primitives can be exercised without modifying real Codex, AGY, OpenCode, Claude Code, WSL, or Colab configuration. Platform-sensitive helpers are tested through injected platform/env/runner values; running `verify.sh` and `verify.bat` on their native systems provides the final host-shell check.

Typical local development loop:

```bash
git clone https://github.com/Lotargo/remote-compute.git
cd remote-compute
npm install
npm run verify
npm link
remote-compute doctor
remote-compute setup
```

## What this project intentionally does not do

- no second agent harness;
- no custom Colab API client;
- no credential storage;
- no Docker requirement;
- no workload-specific runtime;
- no model or dataset hosting;
- no automatic Git commits or pushes;
- no hardcoded Windows drive mappings;
- no account rotation or quota circumvention;
- no CI/CD in this repository for now.

If repeated provider workflows later prove too error-prone as prose, they can become small deterministic helpers without moving planning out of Codex, AGY, Claude Code, or OpenCode.

## Roadmap

The skill is provider-neutral even though Colab is the first provider. Possible future adapters can include SSH workers, local Docker, RunPod, Vast.ai, or GCP without changing the agent-facing mental model.

The next design rule is simple: only add a wrapper when real usage proves that the official provider CLI plus the skill is not reliable enough. Platform bridges are allowed when they are deterministic compatibility layers rather than new orchestration systems.

## Status

Early alpha. The goal is a small, inspectable bootstrap utility with minimal moving parts and zero runtime dependencies.
