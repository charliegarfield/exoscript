/**
 * Exoscript VS Code Extension Client
 *
 * Starts the Exoscript Language Server and manages its lifecycle.
 */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // Path to the server module
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  // Server options - run the server as a Node module
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009']
      }
    }
  };

  // Client options - which documents the server handles
  const clientOptions: LanguageClientOptions = {
    // Register the server for Exoscript documents
    documentSelector: [
      { scheme: 'file', language: 'exoscript' }
    ],
    synchronize: {
      // Notify the server about file changes to exoscript files
      fileEvents: workspace.createFileSystemWatcher('**/*.{exo,exotxt,txt}')
    }
  };

  // Create and start the language client
  client = new LanguageClient(
    'exoscriptLanguageServer',
    'Exoscript Language Server',
    serverOptions,
    clientOptions
  );

  // Start the client, which also starts the server
  client.start();

  console.log('Exoscript Language Server is now active');
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
