import * as vscode from 'vscode';
import { LitellmMonitor, Status } from './statusMonitor';

let monitor: LitellmMonitor | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('claudeXnemo');
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  context.subscriptions.push(output, statusBarItem);

  monitor = new LitellmMonitor(statusBarItem, output);
  context.subscriptions.push(monitor);

  const startCmd = vscode.commands.registerCommand('claudeXnemo.start', async () => {
    await monitor!.start();
  });
  const stopCmd = vscode.commands.registerCommand('claudeXnemo.stop', async () => {
    await monitor!.stop();
  });
  const restartCmd = vscode.commands.registerCommand('claudeXnemo.restart', async () => {
    await monitor!.restart();
  });
  const showStatusCmd = vscode.commands.registerCommand('claudeXnemo.showStatus', async () => {
    await monitor!.showStatus();
  });
  const toggleCmd = vscode.commands.registerCommand('claudeXnemo.toggle', async () => {
    if (monitor!.isRunning()) {
      await monitor!.stop();
    } else {
      await monitor!.start();
    }
  });

  context.subscriptions.push(startCmd, stopCmd, restartCmd, showStatusCmd, toggleCmd);

  // Initialize the status bar text immediately.
  monitor.updateStatusBar();

  void vscode.window.showInformationMessage('claudeXnemo extension activated. Click the status bar dot (🔴/🟢) to start/stop litellm.');
}

export function deactivate(): void {
  if (monitor) {
    monitor.dispose();
    monitor = undefined;
  }
}

// Exposed for tests / external callers.
export { LitellmMonitor, Status };
