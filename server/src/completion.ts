/**
 * Completion for Exoscript
 *
 * Provides autocomplete suggestions based on context.
 */

import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { StoryNode, BATTLE_SKILLS } from './types';
import { ParserResult } from './parser';

/**
 * Tilde command completions
 */
const TILDE_COMPLETIONS: CompletionItem[] = [
  {
    label: 'if',
    kind: CompletionItemKind.Keyword,
    detail: 'Requirement condition',
    documentation: 'The choice/story is only available if the condition is true.',
    insertText: 'if ${1:condition}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'ifd',
    kind: CompletionItemKind.Keyword,
    detail: 'Requirement (show disabled)',
    documentation: 'Like ~if, but shows the choice as disabled instead of hiding it.',
    insertText: 'ifd ${1:condition}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'set',
    kind: CompletionItemKind.Keyword,
    detail: 'Set variable',
    documentation: 'Set a variable to a value when this choice is selected.',
    insertText: 'set ${1:variable} = ${2:value}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'setif',
    kind: CompletionItemKind.Keyword,
    detail: 'Conditional set',
    documentation: 'Conditionally set a variable based on a condition.',
    insertText: 'setif ${1:condition} ? ${2:variable} = ${3:value}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'call',
    kind: CompletionItemKind.Keyword,
    detail: 'Call function',
    documentation: 'Call a game function when this choice is selected.',
    insertText: 'call ${1:function}()',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'callif',
    kind: CompletionItemKind.Keyword,
    detail: 'Conditional call',
    documentation: 'Conditionally call a function based on a condition.',
    insertText: 'callif ${1:condition} ? ${2:function}()',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'disabled',
    kind: CompletionItemKind.Keyword,
    detail: 'Disable file',
    documentation: 'Marks this file as disabled. The entire file will be skipped.'
  },
  {
    label: 'once',
    kind: CompletionItemKind.Keyword,
    detail: 'One-time event',
    documentation: 'This choice/story can only be selected once per playthrough.'
  }
];

/**
 * Variable prefix completions
 */
const PREFIX_COMPLETIONS: CompletionItem[] = [
  {
    label: 'var_',
    kind: CompletionItemKind.Variable,
    detail: 'Story-scoped variable',
    documentation: 'Resets when the story ends.'
  },
  {
    label: 'mem_',
    kind: CompletionItemKind.Variable,
    detail: 'Game-scoped memory',
    documentation: 'Persists across stories within the same playthrough.'
  },
  {
    label: 'hog_',
    kind: CompletionItemKind.Variable,
    detail: 'Groundhog variable',
    documentation: 'Persists across groundhog loops (new game+).'
  },
  {
    label: 'skill_',
    kind: CompletionItemKind.Variable,
    detail: 'Character skill',
    documentation: 'Character skill value (0-100+).'
  },
  {
    label: 'love_',
    kind: CompletionItemKind.Variable,
    detail: 'Relationship value',
    documentation: 'Relationship value with a character.'
  },
  {
    label: 'story_',
    kind: CompletionItemKind.Variable,
    detail: 'Story flag',
    documentation: 'Tracks whether a story event has happened.'
  },
  {
    label: 'plot_',
    kind: CompletionItemKind.Variable,
    detail: 'Plot variable',
    documentation: 'Tracks plot progression.'
  },
  {
    label: 'call_',
    kind: CompletionItemKind.Function,
    detail: 'Function call',
    documentation: 'Calls a game function and returns its value.',
    insertText: 'call_()',
    insertTextFormat: InsertTextFormat.PlainText
  }
];

/**
 * Bracket keyword completions
 */
const BRACKET_COMPLETIONS: CompletionItem[] = [
  {
    label: 'if',
    kind: CompletionItemKind.Keyword,
    detail: 'Conditional block',
    documentation: 'Text only appears if condition is true.',
    insertText: 'if ${1:condition}]${2:text}[endif',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'if random',
    kind: CompletionItemKind.Keyword,
    detail: 'Random selection',
    documentation: 'Randomly choose between options.',
    insertText: 'if random]${1:option1}[or]${2:option2}[endif',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'else',
    kind: CompletionItemKind.Keyword,
    detail: 'Alternative branch',
    documentation: 'Text when the [if] condition is false.'
  },
  {
    label: 'elseif',
    kind: CompletionItemKind.Keyword,
    detail: 'Additional condition',
    documentation: 'Additional condition check within an [if] block.',
    insertText: 'elseif ${1:condition}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  {
    label: 'endif',
    kind: CompletionItemKind.Keyword,
    detail: 'End conditional',
    documentation: 'Ends an [if] conditional block.'
  },
  {
    label: 'end',
    kind: CompletionItemKind.Keyword,
    detail: 'End conditional',
    documentation: 'Ends an [if] conditional block (alternative to [endif]).'
  },
  {
    label: 'or',
    kind: CompletionItemKind.Keyword,
    detail: 'Random alternative',
    documentation: 'Alternative option in a random block.'
  },
  {
    label: '=',
    kind: CompletionItemKind.Operator,
    detail: 'Variable interpolation',
    documentation: 'Insert variable value into text.',
    insertText: '=${1:variable}',
    insertTextFormat: InsertTextFormat.Snippet
  }
];

/**
 * Special jump target completions
 */
const SPECIAL_JUMP_COMPLETIONS: CompletionItem[] = [
  {
    label: 'start',
    kind: CompletionItemKind.Reference,
    detail: 'Jump to start',
    documentation: 'Jumps to the beginning of the current story.'
  },
  {
    label: 'end',
    kind: CompletionItemKind.Reference,
    detail: 'End story',
    documentation: 'Ends the current story and returns to the previous context.'
  },
  {
    label: 'back',
    kind: CompletionItemKind.Reference,
    detail: 'Go back',
    documentation: 'Returns to the previous choice point.'
  },
  {
    label: 'backonce',
    kind: CompletionItemKind.Reference,
    detail: 'Go back (once)',
    documentation: 'Returns to the previous choice point (one-time).'
  },
  {
    label: 'startonce',
    kind: CompletionItemKind.Reference,
    detail: 'Jump to start (once)',
    documentation: 'Jumps to the start of the story (one-time).'
  }
];

/**
 * Snippet info passed from server
 */
export interface SnippetInfo {
  uri: string;
  storyId: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/**
 * Variable info passed from server
 */
export interface VariableInfo {
  uri: string;
  prefix: string;
  name: string;
  usageCount: number;
}

// Prefixes that are shared across files (persist across stories)
const CROSS_FILE_PREFIXES = ['mem_', 'hog_', 'skill_', 'love_', 'story_', 'plot_'];

/**
 * Get completion items for a position in the document
 */
export function getCompletions(
  document: TextDocument,
  position: Position,
  parseResult: ParserResult,
  workspaceSnippets: SnippetInfo[] = [],
  workspaceVariables: VariableInfo[] = []
): CompletionItem[] {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const line = lines[position.line] || '';
  const linePrefix = line.substring(0, position.character);
  const trimmedPrefix = linePrefix.trimStart();

  // Tilde command completion
  if (trimmedPrefix === '~' || trimmedPrefix.match(/^~\w*$/)) {
    return TILDE_COMPLETIONS;
  }

  // Jump target completion
  if (trimmedPrefix.match(/^>{1,3}!?\s*\w*$/)) {
    const story = findStoryAtLine(parseResult, position.line);
    const completions = [...SPECIAL_JUMP_COMPLETIONS];

    if (story) {
      // Add choice IDs from the current story (map keys are lowercased;
      // use the node's original-case ID for the label)
      for (const [key, choiceId] of story.choiceIds) {
        if (key !== 'start') { // start is already in special completions
          completions.push({
            label: choiceId.id,
            kind: CompletionItemKind.Reference,
            detail: choiceId.isHidden ? 'Hidden choice' : 'Choice ID',
            documentation: `Defined at line ${choiceId.range.start.line + 1}`
          });
        }
      }
    }

    // Add cross-file snippets
    const currentUri = document.uri;
    for (const snippet of workspaceSnippets) {
      const fileName = snippet.uri.split('/').pop() || snippet.uri;
      const isLocal = snippet.uri === currentUri;
      completions.push({
        label: snippet.storyId,
        kind: CompletionItemKind.Function,
        detail: isLocal ? 'Snippet (this file)' : `Snippet from ${fileName}`,
        documentation: `Cross-file snippet. Defined at line ${snippet.range.start.line + 1}`,
        sortText: isLocal ? '0' + snippet.storyId : '1' + snippet.storyId
      });
    }

    return completions;
  }

  // Battle skill completion: ~call battle(<here>
  if (linePrefix.match(/battle\s*\(\s*\w*$/)) {
    return BATTLE_SKILLS.map(skill => ({
      label: skill,
      kind: CompletionItemKind.EnumMember,
      detail: 'Battle skill',
      insertText: `${skill}_`,
      documentation: `Card challenge on ${skill}. Follow with easy, medium, hard, or a year number.`
    }));
  }

  // Battle win/lose target completion: ~call battle(skill_diff, <here>
  if (linePrefix.match(/battle\s*\([^)]*,\s*\w*$/)) {
    const story = findStoryAtLine(parseResult, position.line);
    const completions = [...SPECIAL_JUMP_COMPLETIONS];
    if (story) {
      for (const [key, choiceId] of story.choiceIds) {
        if (key !== 'start') {
          completions.push({
            label: choiceId.id,
            kind: CompletionItemKind.Reference,
            detail: choiceId.isHidden ? 'Hidden choice' : 'Choice ID',
            documentation: `Defined at line ${choiceId.range.start.line + 1}`
          });
        }
      }
    }
    return completions;
  }

  // Bracket keyword completion
  if (linePrefix.match(/\[\s*\w*$/)) {
    return BRACKET_COMPLETIONS;
  }

  // Variable prefix completion
  // Trigger when typing a partial prefix like "var" or "mem" (without underscore)
  const prefixMatch = linePrefix.match(/\b(var|mem|hog|skill|love|story|plot|call)$/);
  if (prefixMatch) {
    const typed = prefixMatch[1];
    return PREFIX_COMPLETIONS.filter(c => c.label.startsWith(typed));
  }

  // Snippet completion when typing snippet_ anywhere
  const snippetVarMatch = linePrefix.match(/\bsnippet_(\w*)$/);
  if (snippetVarMatch && workspaceSnippets.length > 0) {
    const partial = snippetVarMatch[1].toLowerCase();
    const currentUri = document.uri;

    const matchingSnippets = workspaceSnippets
      .filter(s => s.storyId.substring('snippet_'.length).toLowerCase().startsWith(partial))
      .sort((a, b) => {
        const aLocal = a.uri === currentUri ? 0 : 1;
        const bLocal = b.uri === currentUri ? 0 : 1;
        return aLocal - bLocal;
      });

    if (matchingSnippets.length > 0) {
      return matchingSnippets.map(snippet => {
        const fileName = snippet.uri.split('/').pop() || snippet.uri;
        const isLocal = snippet.uri === currentUri;
        return {
          label: snippet.storyId,
          kind: CompletionItemKind.Function,
          detail: isLocal ? 'Snippet (this file)' : `Snippet from ${fileName}`,
          sortText: (isLocal ? '0' : '1') + snippet.storyId
        };
      });
    }
  }

  // Specific variable completion (when typing mem_xxx, hog_xxx, etc.)
  const varMatch = linePrefix.match(/\b(mem_|hog_|skill_|love_|story_|plot_)(\w*)$/);
  if (varMatch && workspaceVariables.length > 0) {
    const prefix = varMatch[1];
    const partial = varMatch[2];
    const currentUri = document.uri;

    // Filter variables matching the prefix and partial name
    const matchingVars = workspaceVariables
      .filter(v => v.prefix === prefix && v.name.substring(prefix.length).startsWith(partial))
      .sort((a, b) => {
        // Sort: local first, then by usage count
        const aLocal = a.uri === currentUri ? 0 : 1;
        const bLocal = b.uri === currentUri ? 0 : 1;
        if (aLocal !== bLocal) return aLocal - bLocal;
        return b.usageCount - a.usageCount;
      });

    if (matchingVars.length > 0) {
      return matchingVars.map(v => {
        const fileName = v.uri.split('/').pop() || v.uri;
        const isLocal = v.uri === currentUri;
        return {
          label: v.name,
          kind: CompletionItemKind.Variable,
          detail: isLocal ? `Used ${v.usageCount}x (this file)` : `Used ${v.usageCount}x in ${fileName}`,
          sortText: (isLocal ? '0' : '1') + v.name
        };
      });
    }
  }

  // Snippet completion when typing ~call snippet_
  const snippetMatch = linePrefix.match(/~call(?:if\s+[^?]+\?)?\s*snippet_?\w*$/);
  if (snippetMatch && workspaceSnippets.length > 0) {
    const currentUri = document.uri;
    return workspaceSnippets.map(snippet => {
      // Get just the filename from the URI
      const fileName = snippet.uri.split('/').pop() || snippet.uri;
      const isLocal = snippet.uri === currentUri;
      return {
        label: snippet.storyId,
        kind: CompletionItemKind.Function,
        detail: isLocal ? 'Snippet (this file)' : `Snippet from ${fileName}`,
        documentation: `Defined at line ${snippet.range.start.line + 1}`,
        sortText: isLocal ? '0' + snippet.storyId : '1' + snippet.storyId // Prioritize local snippets
      };
    });
  }

  // Inside tilde command expression - suggest variable prefixes
  if (trimmedPrefix.match(/^~(if|ifd|set|setif|call|callif)\s+.*$/)) {
    return PREFIX_COMPLETIONS;
  }

  // Inside bracket expression - suggest variable prefixes for [=...]
  if (linePrefix.match(/\[=\w*$/)) {
    return PREFIX_COMPLETIONS.map(c => ({
      ...c,
      // Remove the [= since it's already typed
      insertText: c.insertText?.replace(/^\$\{1:/, '').replace(/\}$/, '') || c.label
    }));
  }

  return [];
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
