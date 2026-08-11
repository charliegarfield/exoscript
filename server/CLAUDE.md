# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Build the LSP server
npm run build

# Watch mode for development
npm run watch

# Run tests
npm test

# From parent directory - build both client and server
npm run build

# Install all dependencies (parent, client, server)
npm run install:all
```

## Architecture

This is an LSP (Language Server Protocol) server for **Exoscript**, a narrative scripting language from the game "I Was a Teenage Exocolonist".

### Processing Pipeline

```
Document Text → Lexer → Tokens → Parser → AST → LSP Features
```

1. **Lexer** (`lexer.ts`): Line-by-line tokenization producing tokens with type, value, and range
2. **Parser** (`parser.ts`): Builds AST with `DocumentNode` → `StoryNode` → `ChoiceNode` hierarchy, validates jump targets and bracket expressions
3. **LSP Features**: Diagnostics, completion, hover, go-to-definition, symbols, folding

### Source Files

| File | Purpose |
|------|---------|
| `server.ts` | Main LSP server, connection handling, caching, workspace registries |
| `lexer.ts` | Tokenizer for Exoscript syntax |
| `parser.ts` | AST parser and semantic validation |
| `types.ts` | Token types, line types, AST node interfaces |
| `diagnostics.ts` | Parse error to LSP Diagnostic conversion |
| `completion.ts` | Autocomplete for commands, variables, snippets |
| `hover.ts` | Hover documentation |
| `symbols.ts` | Document outline/symbols |
| `folding.ts` | Code folding ranges |
| `tests.ts` | Test suite (run with ts-node) |

### Workspace-Wide State

The server maintains cross-file registries in `server.ts`:
- **Parse cache**: `Map<uri, ParserResult>` - cached parse results
- **Story registry**: `Map<storyId, StoryInfo>` - all stories across workspace
- **Snippet registry**: `Map<snippetId, StoryInfo>` - stories with `snippet_` prefix
- **Variable registry**: `Map<varName, VariableInfo>` - tracks usage counts

## Exoscript Language

### Constructs

- **Story headers**: `=== storyID`
- **Choices**: `*`, `**`, `***` (nested levels)
- **Choice IDs**: `= choiceID` or `*= hiddenChoice`
- **Jumps**: `>target`, `>>silent`, `>!nobreak`
- **Tilde commands**: `~if`, `~ifd`, `~set`, `~setif`, `~call`, `~callif`, `~once`, `~disabled`
- **Bracket expressions**: `[if condition]...[else]...[endif]`
- **Variable prefixes**: `var_`, `mem_`, `hog_`, `skill_`, `love_`, `story_`, `plot_`
- **Comments**: `//` line, `/* */` block

### File Extensions

`.txt`, `.exo`, `.exotxt`, `.exo.txt`

## Adding Features

**New tilde command**: Update `TILDE_COMMANDS` in types.ts → lexer patterns → parser handlers → completion.ts/hover.ts

**New LSP feature**: Implement handler in server.ts, add provider module if complex

**New validation**: Add to `analyzeDiagnostics()` in diagnostics.ts or parser validation

**Fix tokenization**: Modify lexer.ts patterns

**Fix AST issues**: Modify parser.ts node building
