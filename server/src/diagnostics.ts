/**
 * Exoscript Diagnostics
 *
 * Converts parser errors to LSP Diagnostic objects and provides
 * additional validation logic.
 */

import {
  Diagnostic,
  DiagnosticSeverity,
  Range as LSPRange,
} from 'vscode-languageserver';

import { ParseError, Range, DocumentNode } from './types';
import { parse, validateBrackets } from './parser';

/**
 * Analyze a document and return LSP diagnostics
 */
export function analyzeDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse the document
    const parseResult = parse(text);

    // Convert parser errors to LSP diagnostics
    for (const error of parseResult.errors) {
      diagnostics.push(convertToDiagnostic(error));
    }

    // If document is disabled, add an info diagnostic
    if (parseResult.document.isDisabled) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
        message: 'This file is disabled with ~disabled',
        source: 'exoscript'
      });
    }
  } catch (e) {
    // If parsing fails, report the error but continue
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: `Parser error: ${e instanceof Error ? e.message : String(e)}`,
      source: 'exoscript',
      code: 'parser-exception'
    });
  }

  try {
    // Validate bracket expressions
    const bracketErrors = validateBrackets(text);
    for (const error of bracketErrors) {
      diagnostics.push(convertToDiagnostic(error));
    }
  } catch (e) {
    // If bracket validation fails, report but continue
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: `Bracket validation error: ${e instanceof Error ? e.message : String(e)}`,
      source: 'exoscript',
      code: 'bracket-exception'
    });
  }

  try {
    // Additional validation
    additionalValidation(text, diagnostics);
  } catch (e) {
    // If additional validation fails, report but continue
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: `Validation error: ${e instanceof Error ? e.message : String(e)}`,
      source: 'exoscript',
      code: 'validation-exception'
    });
  }

  return diagnostics;
}

/**
 * Convert internal ParseError to LSP Diagnostic
 */
function convertToDiagnostic(error: ParseError): Diagnostic {
  return {
    severity: getSeverity(error.severity),
    range: convertRange(error.range),
    message: error.message,
    source: 'exoscript',
    code: error.code
  };
}

/**
 * Convert internal Range to LSP Range
 */
function convertRange(range: Range): LSPRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}

/**
 * Convert severity string to LSP DiagnosticSeverity
 */
function getSeverity(severity: ParseError['severity']): DiagnosticSeverity {
  switch (severity) {
    case 'error': return DiagnosticSeverity.Error;
    case 'warning': return DiagnosticSeverity.Warning;
    case 'info': return DiagnosticSeverity.Information;
    case 'hint': return DiagnosticSeverity.Hint;
    default: return DiagnosticSeverity.Warning;
  }
}

/**
 * Additional validation beyond parsing
 */
function additionalValidation(text: string, diagnostics: Diagnostic[]): void {
  const lines = text.split(/\r?\n/);

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmed = line.trim();

    // Check for common mistakes

    // 1. Typos in tilde commands
    const tildeMatch = trimmed.match(/^~(\w+)/);
    if (tildeMatch) {
      const cmd = tildeMatch[1].toLowerCase();
      const validCommands = ['if', 'ifd', 'set', 'setif', 'call', 'callif', 'disabled', 'once'];

      // Check for common typos
      const typoMap: Record<string, string> = {
        'iff': 'if',
        'fi': 'if',
        'ifdd': 'ifd',
        'sett': 'set',
        'setiff': 'setif',
        'calll': 'call',
        'calliff': 'callif',
        'disable': 'disabled',
        'disabeld': 'disabled',
      };

      if (typoMap[cmd]) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: lineNum, character: line.indexOf('~') },
            end: { line: lineNum, character: line.indexOf('~') + cmd.length + 1 }
          },
          message: `Did you mean ~${typoMap[cmd]}?`,
          source: 'exoscript',
          code: 'typo'
        });
      }
    }

    // 2. Check for mismatched quotes in text (simple check)
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Could be intentional (line continues), but flag as hint
      diagnostics.push({
        severity: DiagnosticSeverity.Hint,
        range: {
          start: { line: lineNum, character: 0 },
          end: { line: lineNum, character: line.length }
        },
        message: 'Unmatched quote - intentional if dialogue continues',
        source: 'exoscript',
        code: 'unmatched-quote'
      });
    }

    // 3. Check for empty choices
    const choiceMatch = trimmed.match(/^(\*+)\s*$/);
    if (choiceMatch) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: lineNum, character: line.indexOf('*') },
          end: { line: lineNum, character: line.length }
        },
        message: 'Empty choice text - use *= for hidden choices',
        source: 'exoscript',
        code: 'empty-choice'
      });
    }

    // 4. Check for story header without ID
    if (trimmed === '===') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: lineNum, character: line.indexOf('===') },
          end: { line: lineNum, character: line.indexOf('===') + 3 }
        },
        message: 'Story header requires an ID: === storyID',
        source: 'exoscript',
        code: 'missing-story-id'
      });
    }

    // 5. Check for invalid variable prefixes in ~set/~if
    if (tildeMatch && ['if', 'ifd', 'set', 'setif'].includes(tildeMatch[1].toLowerCase())) {
      const varMatch = line.match(/\b([a-z]+_\w+)\b/g);
      if (varMatch) {
        const validPrefixes = ['var_', 'mem_', 'hog_', 'skill_', 'love_', 'story_', 'call_', 'plot_'];
        for (const v of varMatch) {
          const prefix = v.substring(0, v.indexOf('_') + 1);
          if (v.includes('_') && !validPrefixes.includes(prefix)) {
            // Check if it's a known special variable type
            const knownTypes = ['age', 'season', 'month', 'job', 'location', 'chara', 'repeat', 'random', 'mapspot', 'biome', 'status', 'once', 'first', 'bg', 'left', 'right', 'midleft', 'midright', 'speaker', 'sprite'];
            const beforeUnderscore = v.split('_')[0];
            if (!knownTypes.includes(beforeUnderscore)) {
              diagnostics.push({
                severity: DiagnosticSeverity.Hint,
                range: {
                  start: { line: lineNum, character: line.indexOf(v) },
                  end: { line: lineNum, character: line.indexOf(v) + v.length }
                },
                message: `Unknown variable prefix: ${prefix}. Common prefixes: var_, mem_, hog_, skill_, love_, story_`,
                source: 'exoscript',
                code: 'unknown-prefix'
              });
            }
          }
        }
      }
    }

    // 6. Check for suspicious operator usage
    if (tildeMatch && ['if', 'ifd'].includes(tildeMatch[1].toLowerCase())) {
      // Check for single = when == might be intended (but = is valid in Exoscript)
      // Check for common operator mistakes
      if (line.includes('= =')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: lineNum, character: line.indexOf('= =') },
            end: { line: lineNum, character: line.indexOf('= =') + 3 }
          },
          message: 'Space in operator - did you mean == or =?',
          source: 'exoscript',
          code: 'spaced-operator'
        });
      }
      if (line.includes('& &') || line.includes('| |')) {
        const op = line.includes('& &') ? '& &' : '| |';
        const correct = line.includes('& &') ? '&&' : '||';
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: lineNum, character: line.indexOf(op) },
            end: { line: lineNum, character: line.indexOf(op) + 3 }
          },
          message: `Space in operator - did you mean ${correct}?`,
          source: 'exoscript',
          code: 'spaced-operator'
        });
      }
    }
  }
}

// TODO: Future enhancement - Completion provider
// export function getCompletions(text: string, position: Position): CompletionItem[] {
//   // Keywords: if, ifd, set, setif, call, callif, disabled, once
//   // Variable prefixes: var_, mem_, hog_, skill_, love_, story_
//   // Choice IDs from current document
//   // Operators: =, !=, >, <, >=, <=, &&, ||, and, or
//   return [];
// }

// TODO: Future enhancement - Hover provider
// export function getHoverInfo(text: string, position: Position): Hover | null {
//   // Show variable type hints
//   // Show jump target locations
//   // Show command documentation
//   return null;
// }

// TODO: Future enhancement - Go to definition
// export function getDefinition(text: string, position: Position): Location | null {
//   // Navigate to choice ID definitions
//   // Navigate to story headers
//   return null;
// }

// TODO: Future enhancement - Document symbols
// export function getDocumentSymbols(text: string): DocumentSymbol[] {
//   // List all story IDs
//   // List all choice IDs
//   return [];
// }

// TODO: Future enhancement - Folding ranges
// export function getFoldingRanges(text: string): FoldingRange[] {
//   // Fold story blocks
//   // Fold choice blocks
//   // Fold [if]...[endif] blocks
//   return [];
// }
