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
  FileChangeType,
  WorkspaceFolder,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

// Workspace-wide story registry: storyId -> { uri, range }
interface StoryInfo {
  uri: string;
  storyId: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}
// All stories in workspace, keyed by LOWERCASED story ID because the engine
// resolves story/snippet references case-insensitively
const workspaceStories: Map<string, StoryInfo> = new Map();
// Snippet stories specifically (for completion, subset of workspaceStories)
const workspaceSnippets: Map<string, StoryInfo> = new Map();

// Workspace-wide variable registry: variableName -> { uri, usageCount }
interface VariableInfo {
  uri: string;
  prefix: string;  // 'var_', 'mem_', 'hog_', etc.
  name: string;    // full variable name including prefix
  usageCount: number;
}
// Maps variable name -> VariableInfo (tracks first occurrence and usage count)
const workspaceVariables: Map<string, VariableInfo> = new Map();
// Maps uri -> Set of variable names (for cleanup when document closes)
const documentVariables: Map<string, Set<string>> = new Map();

// Server capabilities
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Workspace folders captured at initialize (for the initial index scan)
let initialWorkspaceFolders: WorkspaceFolder[] = [];

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

  if (params.workspaceFolders) {
    initialWorkspaceFolders = params.workspaceFolders;
  } else if (params.rootUri) {
    initialWorkspaceFolders = [{ uri: params.rootUri, name: 'workspace' }];
  }

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
    connection.workspace.onDidChangeWorkspaceFolders((event) => {
      scanWorkspaceFolders(event.added);
      // Note: entries from removed folders are kept until their files change;
      // stale entries only affect completion suggestions, not correctness
    });
  }

  // Index the whole workspace so cross-file snippets/stories/variables
  // are available without opening every file first
  scanWorkspaceFolders(initialWorkspaceFolders);

  connection.console.log('Exoscript Language Server initialized');
});

/**
 * Watched files changed on disk (the client watches *.exo/*.exotxt/*.txt).
 * Keep the workspace index in sync for files not open in the editor.
 */
connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    // Open documents are indexed from editor content instead
    if (documents.get(change.uri)) {
      continue;
    }
    if (change.type === FileChangeType.Deleted) {
      removeDocumentFromRegistries(change.uri);
      documentParseCache.delete(change.uri);
    } else {
      indexFileFromDisk(change.uri);
    }
  }
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
 * Extract variables from document text and update the registry
 */
function updateVariablesFromDocument(uri: string, text: string): void {
  // Remove old variables from this document
  const oldVars = documentVariables.get(uri);
  if (oldVars) {
    for (const varName of oldVars) {
      const info = workspaceVariables.get(varName);
      if (info) {
        info.usageCount--;
        if (info.usageCount <= 0) {
          workspaceVariables.delete(varName);
        }
      }
    }
  }

  // Find all variables in the document
  const newVars = new Set<string>();

  // Match variable patterns: prefix followed by identifier
  const varRegex = /\b(var_|mem_|hog_|skill_|love_|story_|plot_)(\w+)\b/g;
  let match;

  while ((match = varRegex.exec(text)) !== null) {
    const fullName = match[0];
    const prefix = match[1];

    if (!newVars.has(fullName)) {
      newVars.add(fullName);

      const existing = workspaceVariables.get(fullName);
      if (existing) {
        existing.usageCount++;
      } else {
        workspaceVariables.set(fullName, {
          uri: uri,
          prefix: prefix,
          name: fullName,
          usageCount: 1
        });
      }
    }
  }

  documentVariables.set(uri, newVars);
}

/**
 * Update story and snippet registries from a parsed document
 */
function updateStoriesFromDocument(uri: string, parseResult: ParserResult): void {
  // Remove any existing stories/snippets from this document
  for (const [id, info] of workspaceStories) {
    if (info.uri === uri) {
      workspaceStories.delete(id);
    }
  }
  for (const [id, info] of workspaceSnippets) {
    if (info.uri === uri) {
      workspaceSnippets.delete(id);
    }
  }

  // Add all stories from this document (keys lowercased for
  // case-insensitive lookup; StoryInfo keeps the original ID)
  for (const story of parseResult.document.stories) {
    const storyInfo: StoryInfo = {
      uri: uri,
      storyId: story.id,
      range: story.headerRange
    };

    const key = story.id.toLowerCase();
    workspaceStories.set(key, storyInfo);

    // Also add to snippets if it's a snippet
    if (key.startsWith('snippet_')) {
      workspaceSnippets.set(key, storyInfo);
    }
  }
}

/**
 * Remove all registry entries contributed by a document
 */
function removeDocumentFromRegistries(uri: string): void {
  for (const [id, info] of workspaceStories) {
    if (info.uri === uri) {
      workspaceStories.delete(id);
    }
  }
  for (const [id, info] of workspaceSnippets) {
    if (info.uri === uri) {
      workspaceSnippets.delete(id);
    }
  }
  const oldVars = documentVariables.get(uri);
  if (oldVars) {
    for (const varName of oldVars) {
      const info = workspaceVariables.get(varName);
      if (info) {
        info.usageCount--;
        if (info.usageCount <= 0) {
          workspaceVariables.delete(varName);
        }
      }
    }
    documentVariables.delete(uri);
  }
}

/**
 * Index a file's text into the workspace registries (stories, snippets, variables)
 */
function indexText(uri: string, text: string): void {
  const parseResult = parse(text);
  updateStoriesFromDocument(uri, parseResult);
  updateVariablesFromDocument(uri, text);
}

// File extensions the language claims. Plain .txt files are only treated as
// Exoscript when they actually contain a story header, so arbitrary text
// files aren't indexed or flooded with diagnostics.
const EXO_EXTENSIONS = ['.exo', '.exotxt'];
const STORY_HEADER_RE = /^[ \t]*===[ \t]*\w+/m;

function looksLikeExoscript(filePath: string, text: string): boolean {
  const lower = filePath.toLowerCase();
  if (EXO_EXTENSIONS.some(ext => lower.endsWith(ext)) || lower.endsWith('.exo.txt')) {
    return true;
  }
  return STORY_HEADER_RE.test(text);
}

/**
 * Index a file from disk (used for files that aren't open in the editor)
 */
function indexFileFromDisk(uri: string): void {
  try {
    const filePath = fileURLToPath(uri);
    const stat = fs.statSync(filePath);
    // Skip anything implausibly large for a story file
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
      return;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    if (!looksLikeExoscript(filePath, text)) {
      return;
    }
    indexText(uri, text);
  } catch {
    // Unreadable or non-file URI - ignore
  }
}

/**
 * Recursively scan workspace folders and index all Exoscript files,
 * so cross-file features work without every file being opened first.
 */
function scanWorkspaceFolders(folders: WorkspaceFolder[]): void {
  const SKIP_DIRS = new Set(['node_modules', 'out', 'dist']);
  let indexed = 0;

  const scanDir = (dir: string, depth: number) => {
    if (depth > 10) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.exo') || lower.endsWith('.exotxt') || lower.endsWith('.txt')) {
          const uri = pathToFileURL(fullPath).toString();
          if (!documents.get(uri)) {
            indexFileFromDisk(uri);
            indexed++;
          }
        }
      }
    }
  };

  for (const folder of folders) {
    try {
      scanDir(fileURLToPath(folder.uri), 0);
    } catch {
      // Non-file workspace folder - skip
    }
  }
  connection.console.log(`Exoscript: scanned workspace, examined ${indexed} candidate files`);
}

/**
 * Document closed - drop per-document caches, then re-index from disk so the
 * workspace registries reflect the saved file (unsaved edits are discarded,
 * and the file's stories stay available to other documents)
 */
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
  documentParseCache.delete(e.document.uri);

  removeDocumentFromRegistries(e.document.uri);
  indexFileFromDisk(e.document.uri);
});

/**
 * Document content changed - invalidate cache and validate
 */
documents.onDidChangeContent((change) => {
  // Invalidate parse cache
  documentParseCache.delete(change.document.uri);

  // Update snippet registry (parse and scan for snippet_ stories)
  const parseResult = getParseResult(change.document);
  updateStoriesFromDocument(change.document.uri, parseResult);

  // Update variable registry
  updateVariablesFromDocument(change.document.uri, change.document.getText());

  validateTextDocument(change.document);
});

/**
 * Validate a text document and send diagnostics
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  const text = textDocument.getText();

  // Plain .txt files that don't look like Exoscript get no diagnostics -
  // the language association claims all .txt files, and flooding arbitrary
  // text files with Exoscript errors would be hostile
  if (!looksLikeExoscript(textDocument.uri, text)) {
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    return;
  }

  // Analyze the document, reusing the cached parse
  let diagnostics: Diagnostic[] = analyzeDiagnostics(text, getParseResult(textDocument));

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
    // Convert snippets and variables maps to arrays for completion
    const snippets = Array.from(workspaceSnippets.values());
    const variables = Array.from(workspaceVariables.values());
    return getCompletions(document, params.position, parseResult, snippets, variables);
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

    // On jump lines and battle calls, resolve the word under the cursor -
    // this covers simple jumps, both branches of conditional jumps
    // (> if cond ? a : b), and battle(skill_diff, win, lose) anchors.
    // All lookups are case-insensitive, matching the engine.
    if (line.trimStart().startsWith('>') || /battle\s*\(/.test(line)) {
      const word = getWordAtCharacter(line, position.character);
      if (word) {
        // Check for cross-file snippet first
        if (word.toLowerCase().startsWith('snippet_')) {
          const snippet = workspaceSnippets.get(word.toLowerCase());
          if (snippet) {
            return Location.create(snippet.uri, {
              start: { line: snippet.range.start.line, character: snippet.range.start.character },
              end: { line: snippet.range.end.line, character: snippet.range.end.character }
            });
          }
        }

        // Find the story containing this line for local choice IDs
        const story = findStoryAtLine(parseResult, position.line);
        if (story) {
          const choiceId = story.choiceIds.get(word.toLowerCase());
          if (choiceId) {
            return Location.create(params.textDocument.uri, {
              start: { line: choiceId.range.start.line, character: choiceId.range.start.character },
              end: { line: choiceId.range.end.line, character: choiceId.range.end.character }
            });
          }
        }
      }
    }

    // Check for ~call story(storyId) syntax
    const storyCallMatch = line.match(/~call(?:if\s+[^?]+\?)?\s*story\s*\(\s*(\w+)\s*\)/);
    if (storyCallMatch) {
      const storyId = storyCallMatch[1];
      const storyIdStart = line.indexOf(storyId, line.indexOf('story'));
      const storyIdEnd = storyIdStart + storyId.length;

      // Check if cursor is on the story ID
      if (position.character >= storyIdStart && position.character <= storyIdEnd) {
        const storyInfo = workspaceStories.get(storyId.toLowerCase());
        if (storyInfo) {
          return Location.create(storyInfo.uri, {
            start: { line: storyInfo.range.start.line, character: storyInfo.range.start.character },
            end: { line: storyInfo.range.end.line, character: storyInfo.range.end.character }
          });
        }
      }
    }

    return null;
  }
);

/**
 * Get the word (identifier) at a character position in a line
 */
function getWordAtCharacter(line: string, character: number): string | null {
  const wordRegex = /\w+/g;
  let match;
  while ((match = wordRegex.exec(line)) !== null) {
    if (character >= match.index && character <= match.index + match[0].length) {
      return match[0];
    }
  }
  return null;
}

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
