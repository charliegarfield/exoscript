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
    description: 'Persistent variable. Survives across groundhog loops (new game+).\n\n' +
      'Choices conditioned on a `hog_` show the wormhole "from a past life" icon.'
  },
  'skill_': {
    name: 'Skill',
    description: 'Character skill value (0-100+). Affects various checks and outcomes.'
  },
  'love_': {
    name: 'Relationship',
    description: 'Relationship value with a character. Affects dialogue and romance options.\n\n' +
      '⚠️ Values are doubled in-game: `~set love_x +2` grants 4 friendship points ' +
      '(`++` grants 2). Use increments in multiples of 2.'
  },
  'story_': {
    name: 'Story Flag',
    description: 'Story occurrence flag. Tracks whether a story event has happened.'
  },
  'plot_': {
    name: 'Plot Variable',
    description: 'Tracks plot progression.'
  },
  'call_': {
    name: 'Function Call',
    description: 'Calls a game function and returns its value.'
  }
};

/**
 * Special memory patterns with engine side effects
 */
const SPECIAL_MEM_PATTERNS: Array<{ prefix: string; name: string; description: string }> = [
  {
    prefix: 'mem_flirt_',
    name: 'Flirt Memory',
    description: 'Setting `mem_flirt_<characterID>` after a choice makes the lips (romance) icon appear on it.'
  },
  {
    prefix: 'mem_dead_',
    name: 'Death Memory',
    description: 'Setting `mem_dead_<name>` to anything other than false marks the character as dead ' +
      'in the character screen. The value is displayed as the cause of death.'
  }
];

/**
 * Special ~set targets (engine values, not variables)
 */
const SPECIAL_SET_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  'bg': {
    name: 'Background',
    description: 'Sets the scene background. Must be set at the start of non-character events or the ' +
      'screen stays black. Background IDs are listed in localization.tsv.'
  },
  'speaker': {
    name: 'Speaker',
    description: 'Sets the speaking character - dialogue in quotes takes their color. Persists until ' +
      'changed. ⚠️ Setting a character sprite also changes the speaker.'
  },
  'left': {
    name: 'Sprite Position (left)',
    description: 'Shows a character sprite on the left. ⚠️ Setting a sprite also changes the speaker to that character.'
  },
  'midleft': {
    name: 'Sprite Position (mid-left)',
    description: 'Shows a character sprite at mid-left. ⚠️ Setting a sprite also changes the speaker to that character.'
  },
  'midright': {
    name: 'Sprite Position (mid-right)',
    description: 'Shows a character sprite at mid-right. ⚠️ Setting a sprite also changes the speaker to that character.'
  },
  'right': {
    name: 'Sprite Position (right)',
    description: 'Shows a character sprite on the right. ⚠️ Setting a sprite also changes the speaker to that character.'
  },
  'card': {
    name: 'Card Grant',
    description: 'Gives the player a card. Card IDs are listed in ExocolonistCards - cards.tsv.'
  },
  'status': {
    name: 'Status',
    description: 'Applies a status. Status IDs are listed in Exocolonist - statuses.tsv.'
  },
  'effect': {
    name: 'Effect',
    description: 'Plays a visual or audio effect (e.g. transitions, silence).'
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

  // Jump arrows (>, >>, >!, >>>) - hover on the arrow itself, which has no
  // word characters and would otherwise produce no hover
  const indent = line.length - line.trimStart().length;
  const arrowMatch = line.trimStart().match(/^(>{1,3}!?)/);
  if (arrowMatch && position.character >= indent && position.character <= indent + arrowMatch[1].length) {
    return createHover(getJumpArrowDescription(arrowMatch[1], line.trim()));
  }

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

  // Special ~set targets (bg, speaker, sprite positions, card, ...)
  const setTargetMatch = line.trimStart().match(/^~set(?:if\s+[^?]+\?)?\s*(\w+)/);
  if (setTargetMatch && word === setTargetMatch[1]) {
    const special = SPECIAL_SET_DESCRIPTIONS[word.toLowerCase()];
    if (special) {
      return createHover(`**${special.name}**: \`~set ${word}\`\n\n${special.description}`);
    }
  }

  // Battle / card challenge call
  if (word === 'battle' && /~call/.test(line)) {
    return createHover(
      '**Card Challenge**: `~call battle(skill[_difficulty], winTarget, loseTarget)`\n\n' +
      'Starts a card challenge. Difficulty is `easy`/`medium`/`hard`/`impossible` ' +
      '(auto-balanced to age) or a year number; omit it to scale to the current age. ' +
      'The win/lose arguments are jump anchors (`*= name`) in this story; the player ' +
      'only sees the branch for their result. Both targets are optional.'
    );
  }

  // Special memory patterns (mem_flirt_, mem_dead_)
  for (const pattern of SPECIAL_MEM_PATTERNS) {
    if (word.toLowerCase().startsWith(pattern.prefix)) {
      return createHover(`**${pattern.name}**: \`${word}\`\n\n${pattern.description}`);
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

  // Check for bracket keywords - use the bracket expression containing the cursor
  const bracketRegex = /\[\s*(\w+)[^\]]*\]?/g;
  let bracketMatch;
  while ((bracketMatch = bracketRegex.exec(line)) !== null) {
    const start = bracketMatch.index;
    const end = bracketMatch.index + bracketMatch[0].length;
    if (position.character >= start && position.character <= end) {
      const keyword = bracketMatch[1].toLowerCase();
      if (BRACKET_DESCRIPTIONS[keyword] && position.character <= line.indexOf(bracketMatch[1], start) + bracketMatch[1].length) {
        return createHover(
          `**[${keyword}]**\n\n${BRACKET_DESCRIPTIONS[keyword]}`
        );
      }
      // Pronoun-variant text: [nonbinary|female|male]
      if (!BRACKET_DESCRIPTIONS[keyword]) {
        const content = bracketMatch[0].replace(/^\[/, '').replace(/\]$/, '');
        if (/^[^|[\]]+\|[^|[\]]*\|[^|[\]]*$/.test(content.trim())) {
          return createHover(
            `**Pronoun-variant text**: \`[${content.trim()}]\`\n\n` +
            'The game displays one option based on Sol\'s pronouns, in the order ' +
            '**[nonbinary|female|male]**. Used for pronouns, nicknames, verb forms - any text ' +
            'that changes with the player\'s pronouns.'
          );
        }
      }
      break;
    }
  }

  // Check for jump targets - covers simple jumps, both branches of
  // conditional jumps (> if cond ? target1 : target2), and battle win/lose anchors
  const trimmedLine = line.trimStart();
  if (trimmedLine.startsWith('>') || /battle\s*\(/.test(line)) {
    const story = findStoryAtLine(parseResult, position.line);
    if (story) {
      // Lookup is case-insensitive, matching the engine
      const choiceId = story.choiceIds.get(word.toLowerCase());
      if (choiceId) {
        const lineNum = choiceId.range.start.line + 1;
        return createHover(
          `**Jump Target**: \`${word}\`\n\n` +
          `Defined at line ${lineNum}` +
          (choiceId.isHidden ? ' (hidden choice)' : '')
        );
      }
      if (isSpecialTarget(word)) {
        return createHover(getSpecialTargetDescription(word));
      }
      // Only report "unknown" for the target of a simple jump; words in a
      // conditional jump's condition are not targets
      const simpleJump = trimmedLine.match(/^>{1,3}!?\s*(\w+)\s*$/);
      if (simpleJump && word === simpleJump[1]) {
        return createHover(
          `**Jump Target**: \`${word}\`\n\n` +
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
 * Describe a jump arrow (>, >>, >!, >>>)
 */
function getJumpArrowDescription(arrow: string, trimmedLine: string): string {
  const hasTarget = /^>{1,3}!?\s*\w/.test(trimmedLine);
  if (arrow === '>') {
    return '**Jump** `> target`\n\nJumps to the anchor `*= target` in this story, with a page break.';
  }
  if (arrow === '>>') {
    return '**Silent jump** `>> target`\n\nJumps to the anchor `*= target` without a page break.';
  }
  // >! or >>>
  if (arrow === '>>>' && !hasTarget) {
    return '**Return to choices** `>>>`\n\n' +
      'Acts as `backonce` without displaying text: shows this branch, then returns the player ' +
      'to the previous choice list (used for info choices like the bestiary).\n\n' +
      '⚠️ On returning, the engine **re-executes the `~set` lines of the textbox it returns to** - ' +
      'sprites or values set in this branch can be instantly overwritten.';
  }
  return `**No-break jump** \`${arrow} target\`\n\n` +
    'Jumps to the anchor without inserting a page break, continuing in the same textbox.';
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
