/**
 * Exoscript Language Server
 *
 * LSP server implementation for the Exoscript narrative scripting language.
 * Provides diagnostics, completion, hover, go-to-definition, symbols, and folding.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DidChangeConfigurationNotification,
  Diagnostic,
  CompletionItem,
  TextDocumentPositionParams,
  Hover,
  Definition,
  Location,
  DocumentSymbol,
  FoldingRange,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { analyzeDiagnostics } from './diagnostics';
import { parse, ParserResult } from './parser';
import { getDocumentSymbols } from './symbols';
import { getFoldingRanges } from './folding';
import { getHover } from './hover';
import { getCompletions } from './completion';
import { StoryNode } from './types';

// Create a connection for the server using Node's IPC or stdio
const connection = createConnection(ProposedFeatures.all);

// Create a document manager that syncs document content
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for parsed documents
const documentParseCache: Map<string, ParserResult> = new Map();

// Server capabilities
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Server settings
interface ExoscriptSettings {
  maxNumberOfProblems: number;
}

const defaultSettings: ExoscriptSettings = { maxNumberOfProblems: 100 };
let globalSettings: ExoscriptSettings = defaultSettings;

// Cache of document settings
const documentSettings: Map<string, Thenable<ExoscriptSettings>> = new Map();

/**
 * Get cached parse result for a document, or parse it
 */
function getParseResult(document: TextDocument): ParserResult {
  const cached = documentParseCache.get(document.uri);
  if (cached) {
    return cached;
  }

  const result = parse(document.getText());
  documentParseCache.set(document.uri, result);
  return result;
}

/**
 * Initialize the server
 */
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;

  // Check client capabilities
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      // Completion
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['~', '>', '[', '_']
      },

      // Hover
      hoverProvider: true,

      // Go to definition
      definitionProvider: true,

      // Document symbols (outline)
      documentSymbolProvider: true,

      // Folding ranges
      foldingRangeProvider: true,
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

/**
 * Server initialized
 */
connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for configuration changes
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log('Workspace folder change event received.');
    });
  }

  connection.console.log('Exoscript Language Server initialized');
});

/**
 * Configuration changed
 */
connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = (
      (change.settings.exoscript || defaultSettings)
    ) as ExoscriptSettings;
  }

  // Revalidate all open documents
  documents.all().forEach(validateTextDocument);
});

/**
 * Get settings for a document
 */
function getDocumentSettings(resource: string): Thenable<ExoscriptSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }

  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'exoscript'
    });
    documentSettings.set(resource, result);
  }
  return result;
}

/**
 * Document closed - clean up caches
 */
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
  documentParseCache.delete(e.document.uri);
});

/**
 * Document content changed - invalidate cache and validate
 */
documents.onDidChangeContent((change) => {
  // Invalidate parse cache
  documentParseCache.delete(change.document.uri);
  validateTextDocument(change.document);
});

/**
 * Validate a text document and send diagnostics
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  const text = textDocument.getText();

  // Analyze the document
  let diagnostics: Diagnostic[] = analyzeDiagnostics(text);

  // Limit number of problems if configured
  if (diagnostics.length > settings.maxNumberOfProblems) {
    diagnostics = diagnostics.slice(0, settings.maxNumberOfProblems);
  }

  // Send diagnostics to the client
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

/**
 * Completion handler
 */
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const parseResult = getParseResult(document);
    return getCompletions(document, params.position, parseResult);
  }
);

/**
 * Hover handler
 */
connection.onHover(
  (params: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const parseResult = getParseResult(document);
    return getHover(document, params.position, parseResult);
  }
);

/**
 * Go to definition handler
 */
connection.onDefinition(
  (params: TextDocumentPositionParams): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const parseResult = getParseResult(document);
    const position = params.position;

    // Get line and check if we're on a jump target
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const line = lines[position.line] || '';

    // Check for jump syntax
    const jumpMatch = line.trimStart().match(/^>{1,3}!?\s*(\w+)/);
    if (jumpMatch) {
      const target = jumpMatch[1];
      const targetStartInLine = line.indexOf(target);
      const targetEndInLine = targetStartInLine + target.length;

      // Check if cursor is on the target
      if (position.character >= targetStartInLine && position.character <= targetEndInLine) {
        // Find the story containing this line
        const story = findStoryAtLine(parseResult, position.line);
        if (story) {
          const choiceId = story.choiceIds.get(target);
          if (choiceId) {
            return Location.create(params.textDocument.uri, {
              start: { line: choiceId.range.start.line, character: choiceId.range.start.character },
              end: { line: choiceId.range.end.line, character: choiceId.range.end.character }
            });
          }
        }
      }
    }

    return null;
  }
);

/**
 * Document symbols handler
 */
connection.onDocumentSymbol(
  (params: { textDocument: { uri: string } }): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const parseResult = getParseResult(document);
    return getDocumentSymbols(parseResult);
  }
);

/**
 * Folding ranges handler
 */
connection.onFoldingRanges(
  (params: { textDocument: { uri: string } }): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const parseResult = getParseResult(document);
    return getFoldingRanges(document.getText(), parseResult);
  }
);

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

// Listen for document changes
documents.listen(connection);

// Listen for connection
connection.listen();

connection.console.log('Exoscript Language Server starting...');
