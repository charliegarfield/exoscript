/**
 * Exoscript Parser
 *
 * Builds an AST from lexer tokens and performs semantic validation.
 */

import {
  Token,
  TokenType,
  ParseError,
  DocumentNode,
  StoryNode,
  ChoiceNode,
  ChoiceIdNode,
  JumpNode,
  TildeCommandNode,
  Range,
} from './types';
import { tokenize, LexerResult } from './lexer';

export interface ParserResult {
  document: DocumentNode;
  errors: ParseError[];
}

export class Parser {
  private tokens: Token[] = [];
  private errors: ParseError[] = [];
  private current = 0;
  private stories: StoryNode[] = [];
  private isDisabled = false;
  private lines: string[];

  constructor(private text: string) {
    this.lines = text.split(/\r?\n/);
  }

  public parse(): ParserResult {
    // First, tokenize
    const lexerResult: LexerResult = tokenize(this.text);
    this.tokens = lexerResult.tokens;
    this.errors = [...lexerResult.errors];

    // Check for ~disabled at the start
    this.checkDisabled();

    // Parse stories
    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === TokenType.STORY_HEADER) {
        this.parseStory();
      } else if (token.type === TokenType.TILDE_DISABLED) {
        // ~disabled found not at start
        if (this.current > 0) {
          this.errors.push({
            message: '~disabled should be on the first line of the file',
            range: token.range,
            severity: 'warning',
            code: 'misplaced-disabled'
          });
        }
        this.advance();
      } else if (token.type === TokenType.EOF) {
        break;
      } else if (token.type === TokenType.TEXT) {
        // Check for content before first story header
        if (this.stories.length === 0 && !this.isDisabled && token.value.trim()) {
          this.errors.push({
            message: 'Content found before story header. Expected: === storyID',
            range: token.range,
            severity: 'warning',
            code: 'content-before-story'
          });
        }
        this.advance();
      } else if (this.isSkippableToken(token)) {
        this.advance();
      } else {
        this.advance();
      }
    }

    // Validate jump targets across all stories
    this.validateJumpTargets();

    return {
      document: {
        type: 'document',
        stories: this.stories,
        errors: this.errors,
        isDisabled: this.isDisabled
      },
      errors: this.errors
    };
  }

  private checkDisabled(): void {
    // Look for ~disabled in the first few tokens (before any story header)
    for (let i = 0; i < this.tokens.length && i < 10; i++) {
      const token = this.tokens[i];
      if (token.type === TokenType.STORY_HEADER) {
        break;
      }
      if (token.type === TokenType.TILDE_DISABLED) {
        this.isDisabled = true;
        break;
      }
    }
  }

  private parseStory(): void {
    const headerToken = this.advance();
    const storyId = headerToken.data?.storyId || 'unknown';

    const story: StoryNode = {
      type: 'story',
      id: storyId,
      range: headerToken.range,
      headerRange: headerToken.range,
      requirements: [],
      mutations: [],
      choices: [],
      choiceIds: new Map()
    };

    // Add default "start" choice ID
    story.choiceIds.set('start', {
      type: 'choice_id',
      id: 'start',
      range: headerToken.range,
      isHidden: true
    });

    // Parse story-level content until next story header
    let currentChoice: ChoiceNode | null = null;
    const choiceStack: ChoiceNode[] = [];

    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === TokenType.STORY_HEADER) {
        // New story, finish this one
        break;
      }

      if (token.type === TokenType.EOF) {
        break;
      }

      // Handle different token types
      switch (token.type) {
        case TokenType.TILDE_IF:
        case TokenType.TILDE_IFD:
          this.advance();
          const reqNode = this.parseTildeCommand(token);
          if (currentChoice) {
            currentChoice.requirements.push(reqNode);
          } else {
            story.requirements.push(reqNode);
          }
          break;

        case TokenType.TILDE_SET:
        case TokenType.TILDE_SETIF:
        case TokenType.TILDE_CALL:
        case TokenType.TILDE_CALLIF:
        case TokenType.TILDE_ONCE:
          this.advance();
          const mutNode = this.parseTildeCommand(token);
          if (currentChoice) {
            currentChoice.mutations.push(mutNode);
          } else {
            story.mutations.push(mutNode);
          }
          break;

        case TokenType.TILDE_DISABLED:
          this.advance();
          // Already handled at document level
          break;

        case TokenType.CHOICE:
          this.advance();
          const choiceNode = this.parseChoice(token);
          const level = token.data?.choiceLevel || 1;

          // Determine where to add this choice
          if (level === 1) {
            // Top-level choice
            story.choices.push(choiceNode);
            choiceStack.length = 0;
            choiceStack.push(choiceNode);
          } else {
            // Nested choice - find parent
            while (choiceStack.length >= level) {
              choiceStack.pop();
            }
            if (choiceStack.length > 0) {
              const parent = choiceStack[choiceStack.length - 1];
              parent.children.push(choiceNode);
              choiceStack.push(choiceNode);
            } else {
              // Orphaned nested choice
              this.errors.push({
                message: `Choice level ${level} has no parent choice`,
                range: token.range,
                severity: 'error',
                code: 'orphaned-choice'
              });
              story.choices.push(choiceNode);
              choiceStack.push(choiceNode);
            }
          }
          currentChoice = choiceNode;
          break;

        case TokenType.CHOICE_ID:
          this.advance();
          const choiceIdNode = this.parseChoiceId(token);

          // Register the choice ID
          if (story.choiceIds.has(choiceIdNode.id)) {
            this.errors.push({
              message: `Duplicate choice ID: ${choiceIdNode.id}`,
              range: token.range,
              severity: 'error',
              code: 'duplicate-choice-id'
            });
          } else {
            story.choiceIds.set(choiceIdNode.id, choiceIdNode);
          }

          // If this is a hidden choice (*=), create a choice node
          if (choiceIdNode.isHidden) {
            const hiddenChoice: ChoiceNode = {
              type: 'choice',
              level: token.data?.choiceLevel || 1,
              text: '',
              range: token.range,
              id: choiceIdNode,
              requirements: [],
              mutations: [],
              jumps: [],
              children: [],
              pageBreaks: []
            };
            story.choices.push(hiddenChoice);
            choiceStack.length = 0;
            choiceStack.push(hiddenChoice);
            currentChoice = hiddenChoice;
          } else if (currentChoice) {
            // = choiceID on its own line - attach to current choice
            currentChoice.id = choiceIdNode;
          }
          break;

        case TokenType.JUMP:
          this.advance();
          const jumpNode = this.parseJump(token);
          if (currentChoice) {
            currentChoice.jumps.push(jumpNode);
          } else {
            this.errors.push({
              message: 'Jump found outside of a choice',
              range: token.range,
              severity: 'warning',
              code: 'orphaned-jump'
            });
          }
          break;

        case TokenType.PAGE_BREAK:
          this.advance();
          if (currentChoice) {
            currentChoice.pageBreaks.push(token.range);
          }
          break;

        default:
          this.advance();
          break;
      }
    }

    // Update story range to include all content
    if (this.tokens.length > 0) {
      const lastToken = this.tokens[this.current - 1] || headerToken;
      story.range = {
        start: headerToken.range.start,
        end: lastToken.range.end
      };
    }

    this.stories.push(story);
  }

  private parseTildeCommand(token: Token): TildeCommandNode {
    const cmdMatch = token.value.match(/^~(\w+)\s*(.*)?$/);
    const cmd = cmdMatch?.[1]?.toLowerCase() || 'unknown';
    const expr = cmdMatch?.[2] || '';

    return {
      type: 'tilde_command',
      command: cmd as TildeCommandNode['command'],
      expression: expr,
      range: token.range
    };
  }

  private parseChoice(token: Token): ChoiceNode {
    const level = token.data?.choiceLevel || 1;
    const textMatch = token.value.match(/^\*+\s*(.*)$/);
    const text = textMatch?.[1] || '';

    return {
      type: 'choice',
      level,
      text,
      range: token.range,
      requirements: [],
      mutations: [],
      jumps: [],
      children: [],
      pageBreaks: []
    };
  }

  private parseChoiceId(token: Token): ChoiceIdNode {
    return {
      type: 'choice_id',
      id: token.data?.choiceId || 'unknown',
      range: token.range,
      isHidden: token.data?.isHidden || false
    };
  }

  private parseJump(token: Token): JumpNode {
    return {
      type: 'jump',
      target: token.data?.targetId || '',
      range: token.range,
      jumpType: token.data?.jumpType || 'normal'
    };
  }

  private validateJumpTargets(): void {
    for (const story of this.stories) {
      this.validateJumpsInStory(story);
    }
  }

  private validateJumpsInStory(story: StoryNode): void {
    const validateChoice = (choice: ChoiceNode) => {
      for (const jump of choice.jumps) {
        if (jump.target) {
          // Check for conditional jump syntax: > if condition ? target1 : target2
          const conditionalMatch = jump.target.match(/^if\s+.+\s+\?\s+(\w+)\s*:\s*(\w+)$/);
          if (conditionalMatch) {
            // Validate both targets
            const target1 = conditionalMatch[1];
            const target2 = conditionalMatch[2];
            if (!story.choiceIds.has(target1) && !this.isSpecialJumpTarget(target1)) {
              this.errors.push({
                message: `Unknown jump target: ${target1}`,
                range: jump.range,
                severity: 'warning',
                code: 'unknown-jump-target'
              });
            }
            if (!story.choiceIds.has(target2) && !this.isSpecialJumpTarget(target2)) {
              this.errors.push({
                message: `Unknown jump target: ${target2}`,
                range: jump.range,
                severity: 'warning',
                code: 'unknown-jump-target'
              });
            }
          } else {
            // Simple jump target
            const target = jump.target.split(/\s/)[0]; // Handle "backonce" etc.
            if (!story.choiceIds.has(target) && !this.isSpecialJumpTarget(target)) {
              this.errors.push({
                message: `Unknown jump target: ${target}`,
                range: jump.range,
                severity: 'warning',
                code: 'unknown-jump-target'
              });
            }
          }
        }
      }

      // Recurse into children
      for (const child of choice.children) {
        validateChoice(child);
      }
    };

    for (const choice of story.choices) {
      validateChoice(choice);
    }
  }

  private isSpecialJumpTarget(target: string): boolean {
    // Special jump targets that are always valid
    const specialTargets = [
      'start',
      'end',
      'back',
      'backonce',
      'startonce',
    ];
    return specialTargets.includes(target.toLowerCase());
  }

  private isSkippableToken(token: Token): boolean {
    return token.type === TokenType.COMMENT_LINE ||
           token.type === TokenType.COMMENT_BLOCK_START ||
           token.type === TokenType.COMMENT_BLOCK_END ||
           token.type === TokenType.TEXT ||
           token.type === TokenType.NEWLINE ||
           token.type === TokenType.WHITESPACE ||
           token.type === TokenType.PAGE_BREAK;
  }

  private peek(): Token {
    return this.tokens[this.current] || this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) {
      this.current++;
    }
    return token;
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length ||
           this.tokens[this.current]?.type === TokenType.EOF;
  }
}

/**
 * Parse an Exoscript document
 */
export function parse(text: string): ParserResult {
  const parser = new Parser(text);
  return parser.parse();
}

/**
 * Validate bracket expressions across the document
 * This is a separate pass to handle multi-line bracket structures
 */
export function validateBrackets(text: string): ParseError[] {
  const errors: ParseError[] = [];
  const lines = text.split(/\r?\n/);

  // Track bracket nesting
  interface BracketFrame {
    keyword: string;
    line: number;
    character: number;
  }

  const stack: BracketFrame[] = [];
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
      const startChar = match.index;

      // Opening brackets
      if (content.startsWith('if ') || content === 'if' ||
          content.startsWith('if random')) {
        stack.push({
          keyword: 'if',
          line: lineNum,
          character: startChar
        });
      }
      // Closing brackets
      else if (content === 'endif' || content === 'end') {
        if (stack.length === 0) {
          errors.push({
            message: `Unexpected [${content}] - no matching [if]`,
            range: {
              start: { line: lineNum, character: startChar },
              end: { line: lineNum, character: startChar + match[0].length }
            },
            severity: 'error',
            code: 'unmatched-endif'
          });
        } else {
          stack.pop();
        }
      }
      // Else/elseif/or are valid only inside an if block
      else if (content === 'else' || content.startsWith('else ') ||
               content === 'elseif' || content.startsWith('elseif ') ||
               content === 'or' || content.startsWith('or ') || content === '|') {
        if (stack.length === 0) {
          errors.push({
            message: `[${match[1].trim()}] outside of [if] block`,
            range: {
              start: { line: lineNum, character: startChar },
              end: { line: lineNum, character: startChar + match[0].length }
            },
            severity: 'error',
            code: 'orphaned-else'
          });
        }
      }
    }
  }

  // Check for unclosed brackets
  for (const frame of stack) {
    errors.push({
      message: `Unclosed [if] - missing [endif] or [end]`,
      range: {
        start: { line: frame.line, character: frame.character },
        end: { line: frame.line, character: frame.character + 3 }
      },
      severity: 'error',
      code: 'unclosed-if'
    });
  }

  return errors;
}
