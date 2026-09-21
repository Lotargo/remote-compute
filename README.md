# remote-compute

A compact setup layer that teaches existing coding-agent harnesses how to use remote compute without replacing their planner, tool loop, or provider CLIs.

`remote-compute` is intentionally **not** another agent runtime. It installs a small provider-neutral skill, checks the local environment, helps with official authentication flows, and then gets out of the way.

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
        official provider CLI
                 │
                 ▼
          remote compute
```

The agent keeps responsibility for planning and verification. The provider CLI keeps responsibility for provisioning and execution. This package only connects the pieces.

## Why

Typical workflow:

1. Develop locally.
2. Keep reproducible source state in Git.
3. Use remote compute only when local CPU, RAM, GPU, VRAM, or platform support is insufficient.
4. Keep large assets such as model weights, datasets, and checkpoints outside Git (for example in Google Drive).
5. Treat remote workers as disposable.
6. Persist important state outside the worker and collect artifacts before shutdown.

The same policy works for model training, ComfyUI, CUDA benchmarks, data processing, compilation, or any other workload. There is no Sonata-specific or ComfyUI-specific runtime logic here.

## Supported agent hosts

The initial setup detects these CLIs when they are present on `PATH`:

- `codex`
- `agy`
- `opencode`
- `claude`

For Codex, AGY, and OpenCode, the shared skill is installed under `~/.agents/skills/remote-compute/` when applicable. Claude Code additionally receives the skill under `~/.claude/skills/remote-compute/`.

At least one supported agent host is required for setup to be useful. You do **not** need to install every supported agent.

## Requirements

- Node.js 18+
- at least one supported agent CLI
- for the current provider: the official Google Colab CLI

Google's Colab CLI currently supports Linux and macOS. On Windows, use it from WSL until upstream Windows support exists.

Official Colab CLI installation:

```bash
uv tool install google-colab-cli
```

or:

```bash
pip install google-colab-cli
```

The setup command can offer to install it when it is missing.

## Install

Until an npm release exists, install directly from GitHub:

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

## Commands

### `remote-compute setup`

Detects supported agent hosts, installs or refreshes the `remote-compute` skill, checks the Colab CLI, and prints the remaining authentication step when necessary.

Useful flags:

```bash
remote-compute setup --yes
remote-compute setup --install-colab
remote-compute setup --force
```

`--force` only affects skill files managed by this project. The installer will not silently overwrite an unrelated skill with the same name.

### `remote-compute doctor`

Checks:

- supported agent hosts
- installed skill locations
- `colab` availability
- optional `gcloud` availability
- whether a read-only Colab command can authenticate
- platform compatibility

```bash
remote-compute doctor
```

### `remote-compute auth`

Starts the official Google Application Default Credentials browser flow through `gcloud`, using the scopes required by the Colab CLI, then verifies access with a read-only Colab command.

```bash
remote-compute auth
```

This project does not receive, proxy, or store Google credentials. Authentication remains owned by Google's tooling.

### `remote-compute uninstall`

Removes only skill directories installed by this package. It does not uninstall agent CLIs, Colab CLI, Google Cloud CLI, or delete credentials.

```bash
remote-compute uninstall
```

## Agent behavior

The installed skill is deliberately small. Its main rules are:

- prefer local execution when local resources are sufficient;
- use remote compute as a capability, not as a separate planning system;
- query the provider's own self-documentation instead of guessing provider flags;
- use Git revisions for reproducible jobs;
- do not commit or push user work without permission;
- keep large binaries outside Git;
- copy hot assets to the remote worker's local disk before compute-heavy use;
- checkpoint long jobs to persistent storage;
- collect artifacts before shutdown;
- stop unused paid compute.

For Colab-specific details, the skill tells the agent to consult the installed provider directly with commands such as `colab skill` and `colab help`. This avoids duplicating Google's fast-changing CLI documentation inside this repository.

## What this project intentionally does not do

- no second agent harness
- no custom Colab API client
- no credential storage
- no workload-specific runtime
- no model or dataset hosting
- no automatic Git commits or pushes
- no CI/CD in this repository for now

If repeated provider workflows later prove too error-prone as prose, they can become small deterministic helpers without moving planning out of Codex, AGY, Claude Code, or OpenCode.

## Roadmap

The skill is provider-neutral even though Colab is the first provider. Possible future adapters can include SSH workers, local Docker, RunPod, Vast.ai, or GCP without changing the agent-facing mental model.

## Status

Early alpha. The first goal is a small, inspectable setup utility with minimal moving parts and no runtime dependencies.
