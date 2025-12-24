/**
 * Exoscript LSP Type Definitions
 */

// Position in source document
export interface Position {
  line: number;      // 0-based line number
  character: number; // 0-based character offset
}

// Range in source document
export interface Range {
  start: Position;
  end: Position;
}

// Token types produced by the lexer
export enum TokenType {
  // Structure
  STORY_HEADER = 'STORY_HEADER',       // === storyID
  CHOICE = 'CHOICE',                   // *, **, ***, etc.
  CHOICE_ID = 'CHOICE_ID',             // = choiceID or *= hiddenChoice
  JUMP = 'JUMP',                       // >, >>, >!
  PAGE_BREAK = 'PAGE_BREAK',           // - (alone on line)

  // Commands
  TILDE_IF = 'TILDE_IF',               // ~if
  TILDE_IFD = 'TILDE_IFD',             // ~ifd
  TILDE_SET = 'TILDE_SET',             // ~set
  TILDE_SETIF = 'TILDE_SETIF',         // ~setif
  TILDE_CALL = 'TILDE_CALL',           // ~call
  TILDE_CALLIF = 'TILDE_CALLIF',       // ~callif
  TILDE_DISABLED = 'TILDE_DISABLED',   // ~disabled
  TILDE_ONCE = 'TILDE_ONCE',           // ~once

  // Bracket expressions (inline text)
  BRACKET_IF = 'BRACKET_IF',           // [if ...]
  BRACKET_ELSE = 'BRACKET_ELSE',       // [else]
  BRACKET_ELSEIF = 'BRACKET_ELSEIF',   // [elseif ...]
  BRACKET_ENDIF = 'BRACKET_ENDIF',     // [endif] or [end]
  BRACKET_OR = 'BRACKET_OR',           // [or] or [|]
  BRACKET_VAR = 'BRACKET_VAR',         // [=varname] or [=call_func()]
  BRACKET_RANDOM = 'BRACKET_RANDOM',   // [if random ...]

  // Comments
  COMMENT_LINE = 'COMMENT_LINE',       // // ...
  COMMENT_BLOCK_START = 'COMMENT_BLOCK_START', // /*
  COMMENT_BLOCK_END = 'COMMENT_BLOCK_END',     // */

  // Values
  VARIABLE = 'VARIABLE',               // var_*, mem_*, hog_*, skill_*, love_*, story_*
  OPERATOR = 'OPERATOR',               // =, !=, >, <, >=, <=, &&, ||, and, or
  NUMBER = 'NUMBER',                   // 42, -3, etc.
  BOOLEAN = 'BOOLEAN',                 // true, false
  NULL = 'NULL',                       // null, none
  IDENTIFIER = 'IDENTIFIER',           // general identifiers

  // Other
  TEXT = 'TEXT',                       // Plain narrative text
  NEWLINE = 'NEWLINE',
  WHITESPACE = 'WHITESPACE',
  EOF = 'EOF',
  ERROR = 'ERROR',                     // Lexer error token
}

// A token produced by the lexer
export interface Token {
  type: TokenType;
  value: string;
  range: Range;
  // For certain tokens, store additional data
  data?: {
    choiceLevel?: number;      // For CHOICE: number of asterisks
    jumpType?: 'normal' | 'silent' | 'nobreak';  // For JUMP: >, >>, >!
    targetId?: string;         // For JUMP: target choice ID
    choiceId?: string;         // For CHOICE_ID: the ID
    storyId?: string;          // For STORY_HEADER: the ID
    isHidden?: boolean;        // For CHOICE_ID: *= vs =
    condition?: string;        // For tilde commands: the condition/expression
  };
}

// Line classification for quick parsing
export enum LineType {
  EMPTY = 'EMPTY',
  COMMENT = 'COMMENT',
  STORY_HEADER = 'STORY_HEADER',
  TILDE_COMMAND = 'TILDE_COMMAND',
  CHOICE = 'CHOICE',
  CHOICE_ID = 'CHOICE_ID',
  JUMP = 'JUMP',
  PAGE_BREAK = 'PAGE_BREAK',
  TEXT = 'TEXT',
  IN_BLOCK_COMMENT = 'IN_BLOCK_COMMENT',
}

// Parser error/warning
export interface ParseError {
  message: string;
  range: Range;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string;  // Error code for categorization
}

// AST node types
export interface StoryNode {
  type: 'story';
  id: string;
  range: Range;
  headerRange: Range;
  requirements: TildeCommandNode[];
  mutations: TildeCommandNode[];
  choices: ChoiceNode[];
  choiceIds: Map<string, ChoiceIdNode>;  // For jump target validation
}

export interface ChoiceNode {
  type: 'choice';
  level: number;           // 1 for *, 2 for **, etc.
  text: string;
  range: Range;
  id?: ChoiceIdNode;
  requirements: TildeCommandNode[];
  mutations: TildeCommandNode[];
  jumps: JumpNode[];
  children: ChoiceNode[];  // Nested choices
  pageBreaks: Range[];
}

export interface ChoiceIdNode {
  type: 'choice_id';
  id: string;
  range: Range;
  isHidden: boolean;       // *= vs =
}

export interface JumpNode {
  type: 'jump';
  target: string;
  range: Range;
  jumpType: 'normal' | 'silent' | 'nobreak';  // >, >>, >!
}

export interface TildeCommandNode {
  type: 'tilde_command';
  command: 'if' | 'ifd' | 'set' | 'setif' | 'call' | 'callif' | 'disabled' | 'once';
  expression: string;
  range: Range;
}

// Document-level AST
export interface DocumentNode {
  type: 'document';
  stories: StoryNode[];
  errors: ParseError[];
  isDisabled: boolean;    // true if ~disabled at start
}

// Variable prefix types for validation
export const VARIABLE_PREFIXES = [
  'var_',
  'mem_',
  'hog_',
  'skill_',
  'love_',
  'story_',
  'call_',
] as const;

export type VariablePrefix = typeof VARIABLE_PREFIXES[number];

// Valid tilde commands
export const TILDE_COMMANDS = [
  'if',
  'ifd',
  'set',
  'setif',
  'call',
  'callif',
  'disabled',
  'once',
] as const;

export type TildeCommand = typeof TILDE_COMMANDS[number];

// Valid operators
export const OPERATORS = [
  '=',
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '&&',
  '||',
  'and',
  'or',
  '++',
  '--',
  '+=',
  '-=',
  '?',
  ':',
] as const;

export type Operator = typeof OPERATORS[number];

// Keywords that appear in bracket expressions
export const BRACKET_KEYWORDS = [
  'if',
  'else',
  'elseif',
  'endif',
  'end',
  'or',
  'random',
  'first',
] as const;

export type BracketKeyword = typeof BRACKET_KEYWORDS[number];
