/**
 * Folding Ranges for Exoscript
 *
 * Provides collapsible regions for stories, comments, and choices.
 */

import {
  FoldingRange,
  FoldingRangeKind,
} from 'vscode-languageserver/node';

import { StoryNode, ChoiceNode } from './types';
import { ParserResult } from './parser';

/**
 * Get folding ranges for an Exoscript document
 */
export function getFoldingRanges(text: string, parseResult: ParserResult): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  const lines = text.split(/\r?\n/);

  // Add story folding ranges
  for (const story of parseResult.document.stories) {
    if (story.range.end.line > story.range.start.line) {
      ranges.push({
        startLine: story.range.start.line,
        endLine: story.range.end.line,
        kind: FoldingRangeKind.Region
      });
    }

    // Add choice folding ranges within the story
    for (const choice of story.choices) {
      addChoiceFoldingRanges(choice, ranges);
    }
  }

  // Add block comment folding ranges
  addBlockCommentRanges(lines, ranges);

  // Add bracket [if]...[endif] folding ranges
  addBracketBlockRanges(lines, ranges);

  return ranges;
}

/**
 * Add folding ranges for a choice and its children
 */
function addChoiceFoldingRanges(choice: ChoiceNode, ranges: FoldingRange[]): void {
  // Only add folding if choice has children or spans multiple lines
  if (choice.children.length > 0) {
    // Find the end line (last child's end or choice's end)
    let endLine = choice.range.end.line;
    for (const child of choice.children) {
      if (child.range.end.line > endLine) {
        endLine = child.range.end.line;
      }
    }

    if (endLine > choice.range.start.line) {
      ranges.push({
        startLine: choice.range.start.line,
        endLine: endLine,
        kind: FoldingRangeKind.Region
      });
    }

    // Recurse into children
    for (const child of choice.children) {
      addChoiceFoldingRanges(child, ranges);
    }
  }
}

/**
 * Add folding ranges for block comments
 */
function addBlockCommentRanges(lines: string[], ranges: FoldingRange[]): void {
  let inBlockComment = false;
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlockComment) {
      const startIdx = line.indexOf('/*');
      if (startIdx !== -1) {
        const endIdx = line.indexOf('*/', startIdx + 2);
        if (endIdx === -1) {
          // Block comment starts but doesn't end on this line
          inBlockComment = true;
          blockStart = i;
        }
        // Single-line block comment doesn't need folding
      }
    } else {
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        // Block comment ends
        inBlockComment = false;
        if (i > blockStart) {
          ranges.push({
            startLine: blockStart,
            endLine: i,
            kind: FoldingRangeKind.Comment
          });
        }
      }
    }
  }
}

/**
 * Add folding ranges for [if]...[endif] blocks
 */
function addBracketBlockRanges(lines: string[], ranges: FoldingRange[]): void {
  interface IfFrame {
    line: number;
  }

  const stack: IfFrame[] = [];
  let inBlockComment = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let line = lines[lineNum];

    // Handle block comments
    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        inBlockComment = false;
        line = line.substring(endIdx + 2);
      } else {
        continue;
      }
    }

    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      const blockEnd = line.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        inBlockComment = true;
        line = line.substring(0, blockStart);
      } else {
        line = line.substring(0, blockStart) + line.substring(blockEnd + 2);
      }
    }

    // Skip line comments
    const commentIdx = line.indexOf('//');
    if (commentIdx !== -1) {
      line = line.substring(0, commentIdx);
    }

    // Find bracket expressions
    const bracketRegex = /\[([^\]]*)\]/g;
    let match;

    while ((match = bracketRegex.exec(line)) !== null) {
      const content = match[1].trim().toLowerCase();

      if (content.startsWith('if ') || content === 'if' || content.startsWith('if random')) {
        stack.push({ line: lineNum });
      } else if (content === 'endif' || content === 'end') {
        if (stack.length > 0) {
          const frame = stack.pop()!;
          if (lineNum > frame.line) {
            ranges.push({
              startLine: frame.line,
              endLine: lineNum,
              kind: FoldingRangeKind.Region
            });
          }
        }
      }
    }
  }
}
