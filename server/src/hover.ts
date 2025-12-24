/**
 * Hover Information for Exoscript
 *
 * Provides tooltip information when hovering over elements.
 */

import {
  Hover,
  MarkupContent,
  MarkupKind,
  Position,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { StoryNode } from './types';
import { ParserResult } from './parser';

/**
 * Command descriptions
 */
const COMMAND_DESCRIPTIONS: Record<string, { syntax: string; description: string }> = {
  'if': {
    syntax: '~if condition',
    description: 'Requirement condition. The choice/story is only available if the condition is true.'
  },
  'ifd': {
    syntax: '~ifd condition',
    description: 'Requirement condition (show disabled). Like ~if, but shows the choice as disabled instead of hiding it.'
  },
  'set': {
    syntax: '~set variable = value',
    description: 'Set a variable to a value when this choice is selected.'
  },
  'setif': {
    syntax: '~setif condition ? variable = value',
    description: 'Conditionally set a variable based on a condition.'
  },
  'call': {
    syntax: '~call function()',
    description: 'Call a game function when this choice is selected.'
  },
  'callif': {
    syntax: '~callif condition ? function()',
    description: 'Conditionally call a function based on a condition.'
  },
  'disabled': {
    syntax: '~disabled',
    description: 'Marks this file as disabled. The entire file will be skipped.'
  },
  'once': {
    syntax: '~once',
    description: 'This choice/story can only be selected once per playthrough.'
  }
};

/**
 * Variable prefix descriptions
 */
const PREFIX_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  'var_': {
    name: 'Story Variable',
    description: 'Story-scoped variable. Resets when the story ends.'
  },
  'mem_': {
    name: 'Memory Variable',
    description: 'Game-scoped memory. Persists across stories within the same playthrough.'
  },
  'hog_': {
    name: 'Groundhog Variable',
    description: 'Persistent variable. Survives across groundhog loops (new game+).'
  },
  'skill_': {
    name: 'Skill',
    description: 'Character skill value (0-100+). Affects various checks and outcomes.'
  },
  'love_': {
    name: 'Relationship',
    description: 'Relationship value with a character. Affects dialogue and romance options.'
  },
  'story_': {
    name: 'Story Flag',
    description: 'Story occurrence flag. Tracks whether a story event has happened.'
  },
  'call_': {
    name: 'Function Call',
    description: 'Calls a game function and returns its value.'
  }
};

/**
 * Bracket keyword descriptions
 */
const BRACKET_DESCRIPTIONS: Record<string, string> = {
  'if': 'Conditional text block. Text only appears if condition is true.',
  'else': 'Alternative text when the [if] condition is false.',
  'elseif': 'Additional condition check within an [if] block.',
  'endif': 'Ends an [if] conditional block.',
  'end': 'Ends an [if] conditional block (alternative to [endif]).',
  'or': 'Alternative option in a random block. One option is chosen randomly.',
  'random': 'Starts a random selection block. Use with [or] for alternatives.'
};

/**
 * Get hover information for a position in the document
 */
export function getHover(
  document: TextDocument,
  position: Position,
  parseResult: ParserResult
): Hover | null {
  const line = getLine(document, position.line);
  if (!line) return null;

  // Get word at position
  const wordRange = getWordRangeAtPosition(line, position.character);
  if (!wordRange) return null;

  const word = line.substring(wordRange.start, wordRange.end);
  const linePrefix = line.substring(0, wordRange.start).trimStart();

  // Check for tilde command
  if (linePrefix === '~' || linePrefix === '') {
    const tildeMatch = line.trimStart().match(/^~(\w+)/);
    if (tildeMatch) {
      const cmd = tildeMatch[1].toLowerCase();
      if (COMMAND_DESCRIPTIONS[cmd]) {
        return createHover(
          `**~${cmd}**\n\n` +
          `Syntax: \`${COMMAND_DESCRIPTIONS[cmd].syntax}\`\n\n` +
          COMMAND_DESCRIPTIONS[cmd].description
        );
      }
    }
  }

  // Check for variable with prefix
  for (const prefix of Object.keys(PREFIX_DESCRIPTIONS)) {
    if (word.startsWith(prefix) || linePrefix.endsWith(prefix.slice(0, -1))) {
      const fullWord = linePrefix.endsWith(prefix.slice(0, -1))
        ? prefix + word
        : word;

      if (fullWord.startsWith(prefix)) {
        const info = PREFIX_DESCRIPTIONS[prefix];
        return createHover(
          `**${info.name}**: \`${fullWord}\`\n\n${info.description}`
        );
      }
    }
  }

  // Check for bracket keywords
  const bracketMatch = line.substring(0, position.character + 10).match(/\[(\w+)/);
  if (bracketMatch && position.character >= line.indexOf('[' + bracketMatch[1])) {
    const keyword = bracketMatch[1].toLowerCase();
    if (BRACKET_DESCRIPTIONS[keyword]) {
      return createHover(
        `**[${keyword}]**\n\n${BRACKET_DESCRIPTIONS[keyword]}`
      );
    }
  }

  // Check for jump target
  const jumpMatch = line.trimStart().match(/^>{1,3}!?\s*(\w+)/);
  if (jumpMatch && word === jumpMatch[1]) {
    const target = jumpMatch[1];
    const story = findStoryAtLine(parseResult, position.line);

    if (story) {
      const choiceId = story.choiceIds.get(target);
      if (choiceId) {
        const lineNum = choiceId.range.start.line + 1;
        return createHover(
          `**Jump Target**: \`${target}\`\n\n` +
          `Defined at line ${lineNum}` +
          (choiceId.isHidden ? ' (hidden choice)' : '')
        );
      } else if (isSpecialTarget(target)) {
        return createHover(getSpecialTargetDescription(target));
      } else {
        return createHover(
          `**Jump Target**: \`${target}\`\n\n` +
          `⚠️ Unknown target - not defined in this story`
        );
      }
    }
  }

  // Check for choice ID definition
  const choiceIdMatch = line.trimStart().match(/^\*?=\s*(\w+)/);
  if (choiceIdMatch && word === choiceIdMatch[1]) {
    return createHover(
      `**Choice ID**: \`${word}\`\n\n` +
      `This ID can be used as a jump target with \`> ${word}\``
    );
  }

  return null;
}

/**
 * Create a hover response with markdown content
 */
function createHover(content: string): Hover {
  const markupContent: MarkupContent = {
    kind: MarkupKind.Markdown,
    value: content
  };
  return { contents: markupContent };
}

/**
 * Get a line from the document
 */
function getLine(document: TextDocument, lineNum: number): string | null {
  const lines = document.getText().split(/\r?\n/);
  return lines[lineNum] ?? null;
}

/**
 * Get the word range at a position
 */
function getWordRangeAtPosition(line: string, character: number): { start: number; end: number } | null {
  // Find word boundaries
  const wordRegex = /[\w_]+/g;
  let match;

  while ((match = wordRegex.exec(line)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;

    if (character >= start && character <= end) {
      return { start, end };
    }
  }

  return null;
}

/**
 * Find the story that contains a given line
 */
function findStoryAtLine(parseResult: ParserResult, line: number): StoryNode | null {
  for (const story of parseResult.document.stories) {
    if (line >= story.range.start.line && line <= story.range.end.line) {
      return story;
    }
  }
  return null;
}

/**
 * Check if a target is a special built-in target
 */
function isSpecialTarget(target: string): boolean {
  return ['start', 'end', 'back', 'backonce', 'startonce'].includes(target.toLowerCase());
}

/**
 * Get description for special jump targets
 */
function getSpecialTargetDescription(target: string): string {
  const descriptions: Record<string, string> = {
    'start': '**start**\n\nJumps to the beginning of the current story.',
    'end': '**end**\n\nEnds the current story and returns to the previous context.',
    'back': '**back**\n\nReturns to the previous choice point.',
    'backonce': '**backonce**\n\nReturns to the previous choice point (one-time).',
    'startonce': '**startonce**\n\nJumps to the start of the story (one-time).'
  };
  return descriptions[target.toLowerCase()] || `**${target}**\n\nSpecial jump target.`;
}
