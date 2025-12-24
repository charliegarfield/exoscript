/**
 * Exoscript Language Server
 *
 * LSP server implementation for the Exoscript narrative scripting language.
 * Provides diagnostics for syntax and semantic errors.
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
  // Future enhancement imports:
  // CompletionItem,
  // CompletionItemKind,
  // TextDocumentPositionParams,
  // Hover,
  // Definition,
  // DocumentSymbol,
  // FoldingRange,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { analyzeDiagnostics } from './diagnostics';

// Create a connection for the server using Node's IPC or stdio
const connection = createConnection(ProposedFeatures.all);

// Create a document manager that syncs document content
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Server capabilities
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// let hasDiagnosticRelatedInformationCapability = false;

// Server settings
interface ExoscriptSettings {
  maxNumberOfProblems: number;
}

const defaultSettings: ExoscriptSettings = { maxNumberOfProblems: 100 };
let globalSettings: ExoscriptSettings = defaultSettings;

// Cache of document settings
const documentSettings: Map<string, Thenable<ExoscriptSettings>> = new Map();

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
  // hasDiagnosticRelatedInformationCapability = !!(
  //   capabilities.textDocument &&
  //   capabilities.textDocument.publishDiagnostics &&
  //   capabilities.textDocument.publishDiagnostics.relatedInformation
  // );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      // TODO: Future enhancement - Enable completion
      // completionProvider: {
      //   resolveProvider: true,
      //   triggerCharacters: ['~', '[', '>', '=', '*']
      // },

      // TODO: Future enhancement - Enable hover
      // hoverProvider: true,

      // TODO: Future enhancement - Enable go to definition
      // definitionProvider: true,

      // TODO: Future enhancement - Enable document symbols
      // documentSymbolProvider: true,

      // TODO: Future enhancement - Enable folding
      // foldingRangeProvider: true,
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
 * Document closed - clean up settings cache
 */
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

/**
 * Document content changed - validate
 */
documents.onDidChangeContent((change) => {
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

// TODO: Future enhancement - Completion handler
// connection.onCompletion(
//   (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
//     const document = documents.get(textDocumentPosition.textDocument.uri);
//     if (!document) {
//       return [];
//     }
//
//     const text = document.getText();
//     const position = textDocumentPosition.position;
//
//     // Get line content up to cursor
//     const lines = text.split(/\r?\n/);
//     const line = lines[position.line] || '';
//     const linePrefix = line.substring(0, position.character);
//
//     const completions: CompletionItem[] = [];
//
//     // Tilde command completions
//     if (linePrefix.trim() === '~' || linePrefix.trim().match(/^~\w*$/)) {
//       completions.push(
//         { label: 'if', kind: CompletionItemKind.Keyword, detail: 'Requirement condition' },
//         { label: 'ifd', kind: CompletionItemKind.Keyword, detail: 'Requirement (show disabled)' },
//         { label: 'set', kind: CompletionItemKind.Keyword, detail: 'Set variable/state' },
//         { label: 'setif', kind: CompletionItemKind.Keyword, detail: 'Conditional set' },
//         { label: 'call', kind: CompletionItemKind.Keyword, detail: 'Call function' },
//         { label: 'callif', kind: CompletionItemKind.Keyword, detail: 'Conditional call' },
//         { label: 'disabled', kind: CompletionItemKind.Keyword, detail: 'Disable file' },
//         { label: 'once', kind: CompletionItemKind.Keyword, detail: 'One-time event' },
//       );
//     }
//
//     // Variable prefix completions
//     if (linePrefix.match(/\b(var|mem|hog|skill|love|story)$/)) {
//       completions.push(
//         { label: 'var_', kind: CompletionItemKind.Variable, detail: 'Story-scoped variable' },
//         { label: 'mem_', kind: CompletionItemKind.Variable, detail: 'Game-scoped memory' },
//         { label: 'hog_', kind: CompletionItemKind.Variable, detail: 'Persistent groundhog variable' },
//         { label: 'skill_', kind: CompletionItemKind.Variable, detail: 'Character skill' },
//         { label: 'love_', kind: CompletionItemKind.Variable, detail: 'Relationship value' },
//         { label: 'story_', kind: CompletionItemKind.Variable, detail: 'Story occurrence' },
//       );
//     }
//
//     // Bracket keyword completions
//     if (linePrefix.match(/\[$/)) {
//       completions.push(
//         { label: 'if', kind: CompletionItemKind.Keyword },
//         { label: 'else', kind: CompletionItemKind.Keyword },
//         { label: 'elseif', kind: CompletionItemKind.Keyword },
//         { label: 'endif', kind: CompletionItemKind.Keyword },
//         { label: 'end', kind: CompletionItemKind.Keyword },
//         { label: 'or', kind: CompletionItemKind.Keyword },
//         { label: 'if random', kind: CompletionItemKind.Keyword },
//         { label: '=', kind: CompletionItemKind.Operator, detail: 'Variable interpolation' },
//       );
//     }
//
//     return completions;
//   }
// );

// TODO: Future enhancement - Completion resolve handler
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//   // Add documentation to completion items
//   return item;
// });

// TODO: Future enhancement - Hover handler
// connection.onHover(
//   (params: TextDocumentPositionParams): Hover | null => {
//     const document = documents.get(params.textDocument.uri);
//     if (!document) {
//       return null;
//     }
//
//     // Get word at position and provide hover info
//     return null;
//   }
// );

// TODO: Future enhancement - Definition handler
// connection.onDefinition(
//   (params: TextDocumentPositionParams): Definition | null => {
//     const document = documents.get(params.textDocument.uri);
//     if (!document) {
//       return null;
//     }
//
//     // Find definition of choice ID or jump target
//     return null;
//   }
// );

// TODO: Future enhancement - Document symbols handler
// connection.onDocumentSymbol(
//   (params: { textDocument: { uri: string } }): DocumentSymbol[] => {
//     const document = documents.get(params.textDocument.uri);
//     if (!document) {
//       return [];
//     }
//
//     // Return story IDs and choice IDs as symbols
//     return [];
//   }
// );

// TODO: Future enhancement - Folding ranges handler
// connection.onFoldingRanges(
//   (params: { textDocument: { uri: string } }): FoldingRange[] => {
//     const document = documents.get(params.textDocument.uri);
//     if (!document) {
//       return [];
//     }
//
//     // Return folding ranges for stories and choices
//     return [];
//   }
// );

// Listen for document changes
documents.listen(connection);

// Listen for connection
connection.listen();

connection.console.log('Exoscript Language Server starting...');
