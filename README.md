# claudeXnemo — VS Code extension

Start and stop your local [litellm](https://litellm.ai/) proxy (`claudeXnemo`) from VS Code with a clickable red/yellow/green status dot in the status bar — no more manual PowerShell commands.

## What it does

| Dot | Meaning |
|-----|---------|
| 🔴 | litellm is stopped |
| 🟡 | starting or stopping |
| 🟢 | litellm is running and responding on the configured port |

Click the dot to toggle start/stop. Commands are also available in the Command Palette (`Ctrl+Shift+P` → "claudeXnemo").

Logs go to the **claudeXnemo** output channel (`View → Output → claudeXnemo`).

## Defaults (portable)

- `litellmPath`: `%APPDATA%\Python\Python314\Scripts\litellm.exe` (resolved automatically)
- `configPath`: `${workspaceFolder}\litellm_config.yaml` (this repo's config file)
- `port`: `4000`
- `apiKeyEnvVar`: `NVIDIA_API_KEY` (read from setting → shell env → project `.env`)

All of these can be changed in **File → Preferences → Settings → claudeXnemo**.

## Setup (for anyone cloning this repo)

### 1. Install dependencies

```powershell
npm install
```

### 2. Add your API key

Copy the example env file and add your key:

```powershell
copy .env.example .env
```

Then edit `.env` and replace `your-nvidia-api-key-here` with your actual NVIDIA API key.

Alternatively, set `NVIDIA_API_KEY` in your shell before opening VS Code, or paste it directly into the **claudeXnemo: Api Key** setting.

### 3. Run the extension

Press **F5** — this opens the Extension Development Host with the extension loaded.

Click `🔴 claudeXnemo` in the status bar to start litellm; it turns `🟢` once port 4000 responds.

## Packaging (to share as a .vsix)

```powershell
npm install -g vsce
vsce package
```

Produces a `.vsix` file installable via **Extensions → … → Install from VSIX**.

## Commands

- `claudeXnemo.start` — start litellm
- `claudeXnemo.stop` — stop litellm
- `claudeXnemo.restart` — restart litellm
- `claudeXnemo.showStatus` — show current status in a notification
- `claudeXnemo.toggle` — start if stopped, stop if running (bound to the status bar click)
