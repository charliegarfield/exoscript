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

import { ParseError, Range, VARIABLE_PREFIXES } from './types';
import { parse, validateBrackets, ParserResult } from './parser';
import { stripComments } from './lexer';

/**
 * Analyze a document and return LSP diagnostics.
 * Pass a cached ParserResult to avoid re-parsing the document.
 */
export function analyzeDiagnostics(text: string, cachedParse?: ParserResult): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse the document (or reuse the caller's parse result)
    const parseResult = cachedParse ?? parse(text);

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
  let inBlockComment = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    // Strip comments so commented-out code isn't validated
    const stripped = stripComments(lines[lineNum], inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const line = stripped.code;
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

    // 2. Check for story header without ID
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

    // 4. Check for likely-misspelled variable prefixes in ~set/~if.
    // Underscored words are often plain enum VALUES (e.g. `~if chara = high_anemone`),
    // so only flag a prefix when it's one edit away from a real one - a probable typo.
    if (tildeMatch && ['if', 'ifd', 'set', 'setif'].includes(tildeMatch[1].toLowerCase())) {
      const validPrefixes = VARIABLE_PREFIXES.map(p => p.slice(0, -1));
      const varRegex = /\b([a-z]+)_\w+\b/g;
      let varMatch;
      while ((varMatch = varRegex.exec(line)) !== null) {
        const prefix = varMatch[1];
        if (validPrefixes.includes(prefix)) {
          continue;
        }
        // Words on the right of an operator are values, and words after ( or ,
        // are function arguments (e.g. `~set right = cal_angry`,
        // `call_seasonsSinceStory(hug_rex)`) - not variables
        const before = line.substring(0, varMatch.index).trimEnd();
        if (/[=<>+\-(,]$/.test(before)) {
          continue;
        }
        const nearMiss = validPrefixes.find(p => editDistanceIsOne(prefix, p));
        if (nearMiss) {
          diagnostics.push({
            severity: DiagnosticSeverity.Hint,
            range: {
              start: { line: lineNum, character: varMatch.index },
              end: { line: lineNum, character: varMatch.index + varMatch[0].length }
            },
            message: `Unknown variable prefix: ${prefix}_. Did you mean ${nearMiss}_?`,
            source: 'exoscript',
            code: 'unknown-prefix'
          });
        }
      }
    }

    // 5. Check for suspicious operator usage
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

/**
 * True if a and b are exactly one edit apart (insert, delete, substitute,
 * or adjacent transposition) - used to spot probable prefix typos.
 */
function editDistanceIsOne(a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) {
    return false;
  }
  if (lenDiff === 1) {
    // Insertion/deletion: shorter must match longer with one char skipped
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < long.length; i++) {
      if (short === long.slice(0, i) + long.slice(i + 1)) {
        return true;
      }
    }
    return false;
  }
  // Same length: substitution of one char, or one adjacent transposition
  let firstDiff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (firstDiff === -1) {
        firstDiff = i;
      } else if (firstDiff === i - 1 && a[i] === b[firstDiff] && a[firstDiff] === b[i]) {
        // Transposition - rest must match
        return a.slice(i + 1) === b.slice(i + 1);
      } else {
        return false;
      }
    }
  }
  return firstDiff !== -1;
}
