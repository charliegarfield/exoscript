# Change Log

All notable changes to the "exoscript" extension will be documented in this file.

## [Unreleased]

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