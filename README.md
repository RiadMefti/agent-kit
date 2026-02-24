# agentlab

## Description

`agentlab` is a terminal AI coding agent for real project work. It chats, runs tools, edits files, and keeps multi-step coding sessions in one CLI flow.

## Supports

- Providers:
  - OpenAI Codex
  - GitHub Copilot
  - Claude (subscription login via Claude Code, not API key mode)
- Core capabilities:
  - Provider/model switching from inside the CLI
  - Interactive login and auth status checks per provider
  - Session history save/resume

## Install

Install globally from npm:

```bash
npm install -g agentlab
```

Then run:

```bash
agentlab
```

## Local development

```bash
bun install
bun run build
bun run index.tsx
```

## Project story

This project started in a normal way, with direct manual coding.
Then it grew by using itself: agentlab was used to extend and refine agentlab.
