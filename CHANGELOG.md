# Change Log

All notable changes to the "exoscript" extension will be documented in this file.

## [Unreleased]

### Added

- Card challenge (`~call battle(...)`) support: win/lose arguments are
  validated as jump anchors, with go-to-definition, hover, skill-name
  completion after `battle(`, and anchor completion after the comma. Skill
  names and difficulty tiers (`easy`/`medium`/`hard`/`impossible`/year
  number, or omitted) are validated against the game's actual usage
- Warning when `~set`ting built-in read-only values (`age`, `season`,
  `month`, `year`) - these can only be checked with `~if`
- Hover documentation for engine behaviors: jump arrows including the `>>>`
  return-to-choices re-execution gotcha, pronoun-variant text
  (`[nonbinary|female|male]`), special `~set` targets (bg, speaker, sprite
  positions, card, status, effect), `mem_flirt_`/`mem_dead_` side effects,
  the in-game doubling of `love_` changes, and the `hog_` wormhole icon
- New snippets: event skeleton, battle challenge with win/lose anchors,
  `[if]/[else]/[end]` block, pronoun-variant text, info choice (`>>>`),
  set speaker, set background

## [2.0.0]

First release shipping the full language server (the LSP work from the 1.1-1.2
development versions), plus a large accuracy pass validated against the game's
own story scripts.

### Added

- Language server features: completion, hover, go-to-definition, document
  symbols (outline), and folding
- Workspace-wide indexing: cross-file snippet completion, `~call story()`
  navigation, and variable completion now work without opening every file
  first, and stay in sync as files change on disk
- Conditional jumps (`> if cond ? a : b`) supported in validation, hover, and
  go-to-definition, with flexible spacing
- Duplicate story ID detection
- `plot_` variable prefix and `startonce` jump target
- Variable prefix typo detection now suggests corrections (e.g. `mme_` →
  "Did you mean mem_?")

### Fixed

- Jump targets resolve case-insensitively, matching the game engine
  (`> gohome` finds `*= goHome`)
- Inline ternary brackets `[if cond ? a : b]` and `[if cond ? a]` are no
  longer flagged as unclosed `[if]` blocks
- Story-level jumps (outside any choice) are no longer warned about
- Enum values and function arguments (e.g. `~if chara = high_anemone`,
  `call_fn(story_arg)`) are no longer flagged as unknown variable prefixes
- A `//` comment containing `/*` no longer swallows the rest of the file as a
  block comment
- Trailing `//` comments no longer leak into expression validation
- Commented-out code inside block comments is no longer validated
- Blank-named choices (`*` alone) are recognized as valid hidden choices
- Nested hidden choices (`**= id`) keep their nesting level in the outline
- `~disabled` is detected even after long banner-comment headers
- Plain `.txt` files that don't contain a story header no longer receive
  Exoscript diagnostics
- Removed the unmatched-quote hint (multi-paragraph dialogue is valid)

### Changed

- TextMate grammar scope renamed from `source.sample` to `source.exoscript`
- Packaged extension no longer bundles development dependencies (much smaller
  VSIX)
- CI overhauled: builds and tests on every push/PR, releases via
  semantic-release (honoring the `major:`/`minor:`/`fix:` commit convention),
  and publishes to the Marketplace with the released version

## [1.0.0]

- Added Language Server Protocol (LSP) support with real-time diagnostics
- Syntax error detection:
  - Invalid story headers
  - Unknown or malformed tilde commands (~if, ~set, etc.)
  - Unbalanced bracket expressions ([if]...[endif])
  - Unclosed block comments
  - Unbalanced parentheses in expressions
- Semantic validation:
  - Unknown jump targets
  - Duplicate choice IDs
  - Empty choice text warnings
  - Unknown variable prefix hints
- Added configurable `exoscript.maxNumberOfProblems` setting

## [0.0.1]

- Initial release

## [0.1.0]

- Added snippet

## [0.2.0]

- Bug fixes

## [0.3.0]

- Added language server groundwork

## [0.4.0]

- Added more snippets
- Added indentation rules

## [0.5.0]

- Fixes to vscode package

## [0.6.0]

- Store page fixes and more snippets

## [0.9.0]

- Added choiceid highlighting