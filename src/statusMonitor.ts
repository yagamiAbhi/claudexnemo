import * as net from 'net';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export enum Status {
  Stopped = 'stopped',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Error = 'error',
}

export interface LitellmSettings {
  litellmPath: string;
  configPath: string;
  port: number;
  apiKeyEnvVar: string;
  apiKey: string;
  envFilePath: string;
}

function resolveEnvVars(input: string): string {
  return input.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => {
    return process.env[name] ?? '';
  });
}

function resolveWorkspaceVars(input: string, workspaceFolder: vscode.WorkspaceFolder | undefined): string {
  if (workspaceFolder) {
    input = input.replace(/\$\{workspaceFolder\}/g, workspaceFolder.uri.fsPath);
  }
  return resolveEnvVars(input);
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function getSettings(): LitellmSettings {
  const config = vscode.workspace.getConfiguration('claudeXnemo');
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return {
    litellmPath: resolveWorkspaceVars(config.get<string>('litellmPath', '${env:APPDATA}\\Python\\Python314\\Scripts\\litellm.exe') ?? '', workspaceFolder),
    configPath: resolveWorkspaceVars(config.get<string>('configPath', 'C:\\AI-Setup\\litellm_config.yaml') ?? '', workspaceFolder),
    port: config.get<number>('port', 4000) ?? 4000,
    apiKeyEnvVar: config.get<string>('apiKeyEnvVar', 'NVIDIA_API_KEY') ?? 'NVIDIA_API_KEY',
    apiKey: config.get<string>('apiKey', '') ?? '',
    envFilePath: resolveWorkspaceVars(config.get<string>('envFilePath', '${workspaceFolder}\\.env') ?? '', workspaceFolder),
  };
}

function resolveApiKey(settings: LitellmSettings): string | undefined {
  // 1. stored setting
  if (settings.apiKey && settings.apiKey.trim()) {
    return settings.apiKey.trim();
  }
  // 2. shell/env var
  const fromEnv = process.env[settings.apiKeyEnvVar];
  if (fromEnv) {
    return fromEnv;
  }
  // 3. .env file fallback
  const fromFile = readEnvFile(settings.envFilePath)[settings.apiKeyEnvVar];
  if (fromFile) {
    return fromFile;
  }
  return undefined;
}

function portIsOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      if (!timedOut) {
        clearTimeout(timer);
        socket.end();
        resolve(true);
      }
    });
    socket.once('error', () => {
      if (!timedOut) {
        clearTimeout(timer);
        resolve(false);
      }
    });
    socket.connect(port, '127.0.0.1');
  });
}

export class LitellmMonitor {
  private child: child_process.ChildProcess | null = null;
  private status: Status = Status.Stopped;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly output: vscode.OutputChannel;
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(statusBarItem: vscode.StatusBarItem, output: vscode.OutputChannel) {
    this.statusBarItem = statusBarItem;
    this.output = output;
    this.updateStatusBar();
  }

  getStatus(): Status {
    return this.status;
  }

  isRunning(): boolean {
    return this.status === Status.Running;
  }

  private log(message: string) {
    const ts = new Date().toLocaleTimeString();
    this.output.appendLine(`[${ts}] ${message}`);
  }

  // Public so extension.ts can refresh the bar immediately on activation.
  public updateStatusBar(next?: Status) {
    if (next !== undefined) {
      this.setStatus(next);
    } else {
      this.setStatus(this.status);
    }
  }

  private setStatus(next: Status) {
    this.status = next;
    const settings = getSettings();
    const dot = next === Status.Running ? '🟢' : next === Status.Stopping || next === Status.Starting ? '🟡' : '🔴';
    this.statusBarItem.text = `${dot} claudeXnemo`;
    switch (next) {
      case Status.Running:
        this.statusBarItem.tooltip = `claudeXnemo (litellm) — RUNNING on port ${settings.port}\nClick to stop.`;
        break;
      case Status.Starting:
        this.statusBarItem.tooltip = `claudeXnemo (litellm) — STARTING on port ${settings.port}…`;
        break;
      case Status.Stopping:
        this.statusBarItem.tooltip = `claudeXnemo (litellm) — STOPPING…`;
        break;
      case Status.Error:
        this.statusBarItem.tooltip = `claudeXnemo (litellm) — ERROR. Click for details.`;
        break;
      default:
        this.statusBarItem.tooltip = `claudeXnemo (litellm) — STOPPED on port ${settings.port}\nClick to start.`;
        break;
    }
    this.statusBarItem.command = 'claudeXnemo.toggle';
    this.statusBarItem.show();
  }

  private detachChildHandlers() {
    if (!this.child) return;
    this.child.removeAllListeners('exit');
    this.child.removeAllListeners('error');
    this.child.removeAllListeners('close');
    this.child.stdout?.removeAllListeners('data');
    this.child.stderr?.removeAllListeners('data');
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning()) {
      this.log('claudeXnemo is already running.');
      return;
    }
    this.stopPolling();
    this.detachChildHandlers();

    const settings = getSettings();
    this.log(`Starting litellm: ${settings.litellmPath} --config ${settings.configPath} --port ${settings.port}`);
    this.setStatus(Status.Starting);

    const apiKey = resolveApiKey(settings);
    const env = { ...process.env };
    // DEBUG env var conflicts with Click's --debug option used by litellm.
    // If DEBUG=release (common with Node), Click passes it as --debug release and exits code 2.
    delete env.DEBUG;
    // Force UTF-8 for Python stdout/stderr so litellm's banner emoji doesn't
    // crash on Windows cp1252 console (UnicodeEncodeError).
    env.PYTHONUTF8 = '1';
    if (apiKey) {
      env[settings.apiKeyEnvVar] = apiKey;
      this.log(`API key supplied for ${settings.apiKeyEnvVar}.`);
    } else {
      this.log(`Warning: no API key found for ${settings.apiKeyEnvVar} (setting / env / .env).`);
    }

    try {
      this.child = child_process.spawn(settings.litellmPath, ['--config', settings.configPath, '--port', String(settings.port)], {
        env,
        windowsHide: false,
      });
    } catch (err) {
      this.log(`Failed to spawn litellm: ${err}`);
      this.setStatus(Status.Error);
      void vscode.window.showErrorMessage(`claudeXnemo: failed to start litellm — ${err}`);
      return;
    }

    this.child.stdout?.on('data', (data) => {
      this.log(`[litellm stdout] ${data}`.trimEnd());
    });
    this.child.stderr?.on('data', (data) => {
      this.log(`[litellm stderr] ${data}`.trimEnd());
    });

    this.child.on('error', (err) => {
      this.log(`litellm process error: ${err}`);
      this.detachChildHandlers();
      this.child = null;
      this.stopPolling();
      this.setStatus(Status.Error);
      void vscode.window.showErrorMessage(`claudeXnemo: process error — ${err.message}`);
    });

    this.child.on('exit', (code, signal) => {
      this.log(`litellm exited (code=${code}, signal=${signal})`);
      this.detachChildHandlers();
      this.child = null;
      this.stopPolling();
      this.setStatus(Status.Stopped);
      if (code && code !== 0) {
        void vscode.window.showWarningMessage(`claudeXnemo: litellm exited with code ${code}.`);
      }
    });

    // Poll the port until it opens (startup) then keep polling to detect death.
    let attempts = 0;
    const maxStartAttempts = 40; // ~20 seconds at 500ms
    this.pollTimer = setInterval(async () => {
      const open = await portIsOpen(settings.port, 600);
      if (open) {
        if (this.status !== Status.Running) {
          this.log(`litellm is responding on port ${settings.port}.`);
          this.setStatus(Status.Running);
        }
        attempts = 0;
        return;
      }
      if (this.status === Status.Starting) {
        attempts += 1;
        if (attempts >= maxStartAttempts) {
          this.log(`litellm did not become ready on port ${settings.port} in time.`);
          this.stopPolling();
          this.detachChildHandlers();
          this.child = null;
          this.setStatus(Status.Error);
          void vscode.window.showWarningMessage(`claudeXnemo: litellm did not become ready on port ${settings.port}. Check the Output panel.`);
        }
      } else if (this.status === Status.Running || this.status === Status.Stopping) {
        // Port closed while expected to be running -> process died.
        this.log(`Port ${settings.port} no longer responding.`);
        this.stopPolling();
        this.detachChildHandlers();
        this.child = null;
        this.setStatus(Status.Stopped);
      }
    }, 500);
  }

  async stop(): Promise<void> {
    if (!this.child && this.status !== Status.Starting && this.status !== Status.Stopping) {
      this.log('claudeXnemo is not running.');
      this.setStatus(Status.Stopped);
      return;
    }
    this.stopPolling();
    this.setStatus(Status.Stopping);

    const killTree = async (pid: number) => {
      try {
        // On Windows, taskkill /T /F kills the process tree.
        await new Promise<void>((resolve) => {
          child_process.exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, () => resolve());
        });
      } catch {
        /* ignore */
      }
    };

    if (this.child) {
      try {
        if (this.child.pid) {
          await killTree(this.child.pid);
        }
      } catch (err) {
        this.log(`taskkill failed: ${err}`);
      }
      try {
        if (!this.child.killed) {
          this.child.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
      this.child = null;
    }

    this.detachChildHandlers();
    // Brief pause to let the port close, then confirm stopped.
    await new Promise((r) => setTimeout(r, 700));
    const stillOpen = await portIsOpen(getSettings().port, 400);
    if (stillOpen) {
      this.log('Port still open after stop attempt; forcing again.');
      const settings = getSettings();
      try {
        child_process.execSync(`taskkill /PID ${settings.port} /T /F`, { windowsHide: true });
      } catch {
        /* ignore */
      }
    }
    this.setStatus(Status.Stopped);
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async showStatus(): Promise<void> {
    const settings = getSettings();
    const label = this.status === Status.Running ? 'RUNNING' : this.status === Status.Starting ? 'STARTING' : this.status === Status.Stopping ? 'STOPPING' : this.status === Status.Error ? 'ERROR' : 'STOPPED';
    void vscode.window.showInformationMessage(
      `claudeXnemo: ${label} (litellm on port ${settings.port}, config: ${settings.configPath})`
    );
  }

  dispose() {
    this.stopPolling();
    this.detachChildHandlers();
  }
}
