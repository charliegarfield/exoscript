/**
 * Exoscript Lexer
 *
 * Tokenizes Exoscript documents line by line, similar to the original
 * C# StoryParser approach.
 */

import {
  Token,
  TokenType,
  LineType,
  Range,
  Position,
  ParseError,
  TILDE_COMMANDS,
  TildeCommand,
} from './types';

export interface LexerResult {
  tokens: Token[];
  errors: ParseError[];
  lineTypes: LineType[];
}

export class Lexer {
  private text: string;
  private lines: string[];
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private lineTypes: LineType[] = [];
  private inBlockComment = false;
  private blockCommentStart: Position | null = null;

  constructor(text: string) {
    this.text = text;
    this.lines = text.split(/\r?\n/);
  }

  public tokenize(): LexerResult {
    for (let lineNum = 0; lineNum < this.lines.length; lineNum++) {
      this.tokenizeLine(lineNum);
    }

    // Check for unclosed block comment
    if (this.inBlockComment && this.blockCommentStart) {
      this.errors.push({
        message: 'Unclosed block comment',
        range: {
          start: this.blockCommentStart,
          end: { line: this.lines.length - 1, character: this.lines[this.lines.length - 1]?.length || 0 }
        },
        severity: 'error',
        code: 'unclosed-comment'
      });
    }

    // Add EOF token
    const lastLine = this.lines.length - 1;
    const lastChar = this.lines[lastLine]?.length || 0;
    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      range: {
        start: { line: lastLine, character: lastChar },
        end: { line: lastLine, character: lastChar }
      }
    });

    return {
      tokens: this.tokens,
      errors: this.errors,
      lineTypes: this.lineTypes
    };
  }

  private tokenizeLine(lineNum: number): void {
    const line = this.lines[lineNum];
    const trimmed = line.trim();

    // Handle block comment continuation
    if (this.inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        this.inBlockComment = false;
        this.blockCommentStart = null;
        this.tokens.push({
          type: TokenType.COMMENT_BLOCK_END,
          value: '*/',
          range: this.makeRange(lineNum, endIdx, endIdx + 2)
        });
        // Process rest of line after comment
        const restOfLine = line.substring(endIdx + 2);
        if (restOfLine.trim()) {
          this.tokenizeLineContent(lineNum, endIdx + 2, restOfLine);
        }
        this.lineTypes.push(LineType.COMMENT);
      } else {
        this.lineTypes.push(LineType.IN_BLOCK_COMMENT);
      }
      return;
    }

    // Empty line
    if (!trimmed) {
      this.lineTypes.push(LineType.EMPTY);
      return;
    }

    // Check for block comment start
    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      // Check if it closes on same line
      const blockEnd = line.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        this.inBlockComment = true;
        this.blockCommentStart = { line: lineNum, character: blockStart };
        this.tokens.push({
          type: TokenType.COMMENT_BLOCK_START,
          value: '/*',
          range: this.makeRange(lineNum, blockStart, blockStart + 2)
        });
        this.lineTypes.push(LineType.COMMENT);
        return;
      }
      // Block comment on single line - treat as line comment
    }

    // Line comment
    if (trimmed.startsWith('//')) {
      this.tokens.push({
        type: TokenType.COMMENT_LINE,
        value: trimmed,
        range: this.makeRange(lineNum, line.indexOf('//'), line.length)
      });
      this.lineTypes.push(LineType.COMMENT);
      return;
    }

    // Comment lines starting with ==== (4+ equals)
    if (/^====+/.test(trimmed)) {
      this.tokens.push({
        type: TokenType.COMMENT_LINE,
        value: trimmed,
        range: this.makeRange(lineNum, 0, line.length)
      });
      this.lineTypes.push(LineType.COMMENT);
      return;
    }

    // Story header: === storyID
    const storyMatch = trimmed.match(/^===\s+(\w+)/);
    if (storyMatch) {
      const startIdx = line.indexOf('===');
      this.tokens.push({
        type: TokenType.STORY_HEADER,
        value: storyMatch[0],
        range: this.makeRange(lineNum, startIdx, line.length),
        data: { storyId: storyMatch[1] }
      });
      this.lineTypes.push(LineType.STORY_HEADER);
      return;
    }

    // Invalid story header (=== without valid ID)
    if (trimmed.startsWith('===') && !trimmed.startsWith('====')) {
      const startIdx = line.indexOf('===');
      this.tokens.push({
        type: TokenType.ERROR,
        value: trimmed,
        range: this.makeRange(lineNum, startIdx, line.length)
      });
      this.errors.push({
        message: 'Invalid story header. Expected: === storyID',
        range: this.makeRange(lineNum, startIdx, line.length),
        severity: 'error',
        code: 'invalid-story-header'
      });
      this.lineTypes.push(LineType.STORY_HEADER);
      return;
    }

    // Tilde commands: ~if, ~ifd, ~set, ~setif, ~call, ~callif, ~disabled, ~once
    const tildeMatch = trimmed.match(/^~(\w+)\s*(.*)?$/);
    if (tildeMatch) {
      const cmd = tildeMatch[1].toLowerCase();
      const startIdx = line.indexOf('~');

      if (TILDE_COMMANDS.includes(cmd as TildeCommand)) {
        const tokenType = this.getTildeTokenType(cmd);
        this.tokens.push({
          type: tokenType,
          value: trimmed,
          range: this.makeRange(lineNum, startIdx, line.length),
          data: { condition: tildeMatch[2] || '' }
        });
        this.lineTypes.push(LineType.TILDE_COMMAND);

        // Validate tilde command syntax
        this.validateTildeCommand(cmd as TildeCommand, tildeMatch[2] || '', lineNum, startIdx);
      } else {
        this.tokens.push({
          type: TokenType.ERROR,
          value: trimmed,
          range: this.makeRange(lineNum, startIdx, line.length)
        });
        this.errors.push({
          message: `Unknown tilde command: ~${cmd}. Valid commands: ${TILDE_COMMANDS.join(', ')}`,
          range: this.makeRange(lineNum, startIdx, startIdx + cmd.length + 1),
          severity: 'error',
          code: 'unknown-tilde-command'
        });
        this.lineTypes.push(LineType.TILDE_COMMAND);
      }
      return;
    }

    // Jump: >, >>, >!, >>>
    const jumpMatch = trimmed.match(/^(>{1,3})(!?)\s*(.*)$/);
    if (jumpMatch) {
      const arrows = jumpMatch[1];
      const bang = jumpMatch[2];
      const target = jumpMatch[3].trim();
      const startIdx = line.indexOf('>');

      let jumpType: 'normal' | 'silent' | 'nobreak' = 'normal';
      if (arrows === '>>') {
        jumpType = 'silent';
      } else if (arrows === '>>>' || bang === '!') {
        jumpType = 'nobreak';
      }

      this.tokens.push({
        type: TokenType.JUMP,
        value: trimmed,
        range: this.makeRange(lineNum, startIdx, line.length),
        data: { jumpType, targetId: target || undefined }
      });
      this.lineTypes.push(LineType.JUMP);
      return;
    }

    // Choice ID alone: = choiceID (not preceded by *)
    const choiceIdMatch = trimmed.match(/^=\s*(\w+)\s*$/);
    if (choiceIdMatch && !trimmed.startsWith('==')) {
      const startIdx = line.indexOf('=');
      this.tokens.push({
        type: TokenType.CHOICE_ID,
        value: trimmed,
        range: this.makeRange(lineNum, startIdx, line.length),
        data: { choiceId: choiceIdMatch[1], isHidden: false }
      });
      this.lineTypes.push(LineType.CHOICE_ID);
      return;
    }

    // Choice with optional ID: * choice text, *= hiddenChoice, ** nested choice
    const choiceMatch = trimmed.match(/^(\*+)(=?)\s*(.*)$/);
    if (choiceMatch) {
      const stars = choiceMatch[1];
      const hasId = choiceMatch[2] === '=';
      const rest = choiceMatch[3].trim();
      const startIdx = line.indexOf('*');

      if (hasId) {
        // *= hiddenChoice (ID only, no choice text)
        const idMatch = rest.match(/^(\w+)\s*$/);
        if (idMatch) {
          this.tokens.push({
            type: TokenType.CHOICE_ID,
            value: trimmed,
            range: this.makeRange(lineNum, startIdx, line.length),
            data: {
              choiceId: idMatch[1],
              isHidden: true,
              choiceLevel: stars.length
            }
          });
        } else if (rest === '') {
          this.errors.push({
            message: 'Hidden choice marker *= requires an ID',
            range: this.makeRange(lineNum, startIdx, line.length),
            severity: 'error',
            code: 'missing-choice-id'
          });
        } else {
          // *= followed by text - might be ID followed by content
          this.tokens.push({
            type: TokenType.CHOICE_ID,
            value: trimmed,
            range: this.makeRange(lineNum, startIdx, line.length),
            data: {
              choiceId: rest.split(/\s/)[0],
              isHidden: true,
              choiceLevel: stars.length
            }
          });
        }
      } else {
        // Regular choice
        this.tokens.push({
          type: TokenType.CHOICE,
          value: trimmed,
          range: this.makeRange(lineNum, startIdx, line.length),
          data: { choiceLevel: stars.length }
        });
      }
      this.lineTypes.push(LineType.CHOICE);
      return;
    }

    // Page break: - (alone on line, with optional whitespace)
    if (/^-\s*$/.test(trimmed)) {
      const startIdx = line.indexOf('-');
      this.tokens.push({
        type: TokenType.PAGE_BREAK,
        value: '-',
        range: this.makeRange(lineNum, startIdx, startIdx + 1)
      });
      this.lineTypes.push(LineType.PAGE_BREAK);
      return;
    }

    // Regular text - also check for bracket expressions within
    this.tokens.push({
      type: TokenType.TEXT,
      value: line,
      range: this.makeRange(lineNum, 0, line.length)
    });
    this.lineTypes.push(LineType.TEXT);

    // Validate bracket expressions in text
    this.validateBracketExpressions(line, lineNum);
  }

  private tokenizeLineContent(lineNum: number, startOffset: number, content: string): void {
    // Simplified: just add as text for now
    // A more complete implementation would recursively tokenize
    const trimmed = content.trim();
    if (trimmed) {
      this.tokens.push({
        type: TokenType.TEXT,
        value: content,
        range: this.makeRange(lineNum, startOffset, startOffset + content.length)
      });
    }
  }

  private getTildeTokenType(cmd: string): TokenType {
    switch (cmd.toLowerCase()) {
      case 'if': return TokenType.TILDE_IF;
      case 'ifd': return TokenType.TILDE_IFD;
      case 'set': return TokenType.TILDE_SET;
      case 'setif': return TokenType.TILDE_SETIF;
      case 'call': return TokenType.TILDE_CALL;
      case 'callif': return TokenType.TILDE_CALLIF;
      case 'disabled': return TokenType.TILDE_DISABLED;
      case 'once': return TokenType.TILDE_ONCE;
      default: return TokenType.ERROR;
    }
  }

  private validateTildeCommand(cmd: TildeCommand, expression: string, lineNum: number, startIdx: number): void {
    // ~disabled and ~once don't require expressions
    if (cmd === 'disabled' || cmd === 'once') {
      return;
    }

    // Other commands should have an expression
    if (!expression.trim()) {
      // ~set, ~call with empty is sometimes valid (shorthand)
      if (cmd === 'set' || cmd === 'call') {
        // These can be valid without expression in some cases
        return;
      }
      this.errors.push({
        message: `~${cmd} requires a condition or expression`,
        range: this.makeRange(lineNum, startIdx, startIdx + cmd.length + 1),
        severity: 'warning',
        code: 'empty-tilde-expression'
      });
      return;
    }

    // Validate operators in if/ifd expressions
    if (cmd === 'if' || cmd === 'ifd') {
      this.validateConditionExpression(expression, lineNum, startIdx + cmd.length + 2);
    }

    // Validate set expressions
    if (cmd === 'set' || cmd === 'setif') {
      this.validateSetExpression(expression, lineNum, startIdx + cmd.length + 2);
    }
  }

  private validateConditionExpression(expr: string, lineNum: number, startOffset: number): void {
    // Check for common mistakes in condition expressions
    const trimmed = expr.trim();

    // Check for assignment = when comparison == might be intended
    // But single = is valid in Exoscript for equality check
    // So we don't flag this

    // Check for unbalanced parentheses
    let parenCount = 0;
    let foundError = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') parenCount++;
      if (trimmed[i] === ')') parenCount--;
      if (parenCount < 0 && !foundError) {
        this.errors.push({
          message: 'Unbalanced parentheses: unexpected )',
          range: this.makeRange(lineNum, startOffset + i, startOffset + i + 1),
          severity: 'error',
          code: 'unbalanced-parens'
        });
        foundError = true;
        parenCount = 0; // Reset to continue checking
      }
    }
    if (parenCount > 0) {
      this.errors.push({
        message: 'Unbalanced parentheses: missing )',
        range: this.makeRange(lineNum, startOffset, startOffset + trimmed.length),
        severity: 'error',
        code: 'unbalanced-parens'
      });
    }
  }

  private validateSetExpression(expr: string, lineNum: number, startOffset: number): void {
    const trimmed = expr.trim();

    // Check for unbalanced parentheses (for call expressions)
    let parenCount = 0;
    let foundError = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') parenCount++;
      if (trimmed[i] === ')') parenCount--;
      if (parenCount < 0 && !foundError) {
        this.errors.push({
          message: 'Unbalanced parentheses in set expression',
          range: this.makeRange(lineNum, startOffset + i, startOffset + i + 1),
          severity: 'error',
          code: 'unbalanced-parens'
        });
        foundError = true;
        parenCount = 0; // Reset to continue checking
      }
    }
    if (parenCount > 0) {
      this.errors.push({
        message: 'Unbalanced parentheses: missing )',
        range: this.makeRange(lineNum, startOffset, startOffset + trimmed.length),
        severity: 'error',
        code: 'unbalanced-parens'
      });
    }
  }

  private validateBracketExpressions(line: string, lineNum: number): void {
    // Find all bracket expressions in the line
    const bracketRegex = /\[([^\]]*)\]/g;
    let match;

    while ((match = bracketRegex.exec(line)) !== null) {
      const content = match[1].trim();
      const startIdx = match.index;
      const endIdx = match.index + match[0].length;

      // Check for valid bracket keywords
      if (content.startsWith('if ') || content === 'if') {
        // [if condition] - valid start
        continue;
      }
      if (content === 'else' || content.startsWith('else ')) {
        // [else] or [else if] or [else random] - valid
        continue;
      }
      if (content === 'elseif' || content.startsWith('elseif ')) {
        // [elseif condition] - valid
        continue;
      }
      if (content === 'endif' || content === 'end') {
        // [endif] or [end] - valid
        continue;
      }
      if (content === 'or' || content === '|' || content.startsWith('or ')) {
        // [or] or [|] - valid for random blocks
        continue;
      }
      if (content.startsWith('=')) {
        // [=variable] or [=call_func()] - variable interpolation
        continue;
      }

      // Unknown bracket expression - could be text or error
      // Don't flag as error since [text] is sometimes just literal text
    }

    // Check for unbalanced brackets in the line (simple check)
    let bracketCount = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '[') bracketCount++;
      if (line[i] === ']') bracketCount--;
    }
    // Note: We don't error on single-line unbalanced brackets because
    // [if] and [endif] are on different lines. This is handled by the parser.
  }

  private makeRange(line: number, start: number, end: number): Range {
    return {
      start: { line, character: start },
      end: { line, character: end }
    };
  }
}

/**
 * Tokenize an Exoscript document
 */
export function tokenize(text: string): LexerResult {
  const lexer = new Lexer(text);
  return lexer.tokenize();
}
