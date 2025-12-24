/**
 * Document Symbols for Exoscript
 *
 * Provides outline/symbol information for the document structure.
 */

import {
  DocumentSymbol,
  SymbolKind,
  Range as LSPRange,
} from 'vscode-languageserver/node';

import { StoryNode, ChoiceNode, ChoiceIdNode, Range } from './types';
import { ParserResult } from './parser';

/**
 * Convert internal Range to LSP Range
 */
function toLSPRange(range: Range): LSPRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}

/**
 * Get document symbols for an Exoscript document
 */
export function getDocumentSymbols(parseResult: ParserResult): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (const story of parseResult.document.stories) {
    const storySymbol = createStorySymbol(story);
    symbols.push(storySymbol);
  }

  return symbols;
}

/**
 * Create a symbol for a story
 */
function createStorySymbol(story: StoryNode): DocumentSymbol {
  const children: DocumentSymbol[] = [];

  // Add choice IDs (except implicit 'start')
  for (const [id, choiceId] of story.choiceIds) {
    if (id !== 'start') {
      children.push(createChoiceIdSymbol(choiceId));
    }
  }

  // Add choices with their nested structure
  for (const choice of story.choices) {
    const choiceSymbols = createChoiceSymbols(choice);
    children.push(...choiceSymbols);
  }

  // Sort children by line number
  children.sort((a, b) => a.range.start.line - b.range.start.line);

  return {
    name: story.id,
    kind: SymbolKind.Module,
    range: toLSPRange(story.range),
    selectionRange: toLSPRange(story.headerRange),
    children: children.length > 0 ? children : undefined
  };
}

/**
 * Create a symbol for a choice ID
 */
function createChoiceIdSymbol(choiceId: ChoiceIdNode): DocumentSymbol {
  const prefix = choiceId.isHidden ? '*= ' : '= ';
  return {
    name: prefix + choiceId.id,
    kind: SymbolKind.Key,
    range: toLSPRange(choiceId.range),
    selectionRange: toLSPRange(choiceId.range),
  };
}

/**
 * Create symbols for a choice and its children
 */
function createChoiceSymbols(choice: ChoiceNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  // Create the main choice symbol
  const stars = '*'.repeat(choice.level);
  const choiceText = choice.text.substring(0, 40) + (choice.text.length > 40 ? '...' : '');
  const name = choice.id
    ? `${stars}= ${choice.id.id}`
    : `${stars} ${choiceText || '(empty)'}`;

  const children: DocumentSymbol[] = [];

  // Add nested choices as children
  for (const childChoice of choice.children) {
    const childSymbols = createChoiceSymbols(childChoice);
    children.push(...childSymbols);
  }

  const choiceSymbol: DocumentSymbol = {
    name,
    kind: choice.id ? SymbolKind.Key : SymbolKind.Event,
    range: toLSPRange(choice.range),
    selectionRange: toLSPRange(choice.range),
    children: children.length > 0 ? children : undefined
  };

  symbols.push(choiceSymbol);
  return symbols;
}
