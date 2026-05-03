---
name: intent
description: Set or clear the human-readable goal for the current Agents Observe session
argument-hint: [<short description of what this session is doing> | clear]
user_invocable: true
---

# /intent

Tag the current Claude Code session with a short, human-readable
description of what it's doing. Shows up as the row title on the
Agents Observe dashboard (replaces the random `twinkly-hugging-dragon`
slug) so you can scan a list of sessions at a glance and immediately
see what each one is for.

## Usage

- `/intent Refactoring symbol search to embeddings` — set the intent
- `/intent` — show the current intent
- `/intent clear` — clear the intent (will fall back to the
  auto-derived first-prompt summary if one exists)

## Instructions

The argument is in `$ARGUMENTS`.

### /intent <text>

1. If `$ARGUMENTS` is empty, run the "show current" branch below.
2. If `$ARGUMENTS` is exactly the word `clear` (case-insensitive),
   pass an empty string to the CLI — the server treats that as "clear
   the intent and let the auto-derive fallback show through":
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs intent \
     --session-id "$CLAUDE_SESSION_ID" \
     --cwd "$PWD" \
     --source manual \
     ""
   ```
3. Otherwise pass `$ARGUMENTS` as the intent text. The CLI joins all
   positional args, so quoting is optional:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs intent \
     --session-id "$CLAUDE_SESSION_ID" \
     --cwd "$PWD" \
     --source manual \
     $ARGUMENTS
   ```
4. Show the CLI's one-line confirmation to the user. If the CLI
   reports "(resolved via fallback)", remind the user they can pass
   `--session-id` for an exact match.

### /intent (no args, "show current")

1. If `$CLAUDE_SESSION_ID` is set, fetch the current intent from the
   API:
   ```bash
   curl -s "http://127.0.0.1:4981/api/sessions/$CLAUDE_SESSION_ID" | \
     node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('Intent: ' + (j.intent ?? '(none set)') + (j.intentSource ? ' [' + j.intentSource + ']' : ''));})"
   ```
2. If `$CLAUDE_SESSION_ID` is not set, tell the user to install a
   newer Claude Code release or run with `--session-id` explicitly,
   then exit.

## Notes

- Manual intents (set via this skill) are sticky — they aren't
  overwritten by the auto-derived fallback. Use `/intent clear` to
  drop back to the auto value.
- Intent text is capped at 200 characters server-side. Anything
  longer is truncated.
- The server broadcasts the change over WebSocket, so the dashboard
  updates instantly without a refresh.
