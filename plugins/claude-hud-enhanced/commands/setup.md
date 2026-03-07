---
description: Configure claude-hud-enhanced as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
---

**Note**: Placeholders like `{RUNTIME_PATH}`, `{SOURCE}`, and `{GENERATED_COMMAND}` should be substituted with actual detected values.

## Step 1: Detect Platform & Runtime

**macOS/Linux** (if `uname -s` returns "Darwin", "Linux", or a MINGW*/MSYS*/CYGWIN* variant):

> **Git Bash/MSYS2/Cygwin users on Windows**: Follow these macOS/Linux instructions, not the Windows section below. Your environment provides bash and Unix-like tools.

1. Get plugin path:
   ```bash
   ls ~/.claude/plugins/cache/claude-hud-enhanced/claude-hud-enhanced/ 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n | tail -1
   ```
   If empty, the plugin is not installed. **On Linux only** (if `uname -s` returns "Linux"), check for cross-device filesystem issue:
   ```bash
   [ "$(df --output=source ~/.claude /tmp 2>/dev/null | tail -2 | uniq | wc -l)" = "2" ] && echo "CROSS_DEVICE"
   ```
   If this outputs `CROSS_DEVICE`, explain that `/tmp` and `~/.claude` are on different filesystems, which causes `EXDEV: cross-device link not permitted` during installation. Provide the fix:
   ```bash
   mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp /plugin install claude-hud
   ```
   After they run this, re-check the plugin path and continue setup. For non-Linux systems (macOS, etc.), simply tell user to install via marketplace first.

2. Get runtime absolute path (prefer bun for performance, fallback to node):
   ```bash
   command -v bun 2>/dev/null || command -v node 2>/dev/null
   ```

   If empty, stop and tell user to install Node.js or Bun.

3. Verify the runtime exists:
   ```bash
   ls -la {RUNTIME_PATH}
   ```
   If it doesn't exist, re-detect or ask user to verify their installation.

4. Determine source file based on runtime:
   ```bash
   basename {RUNTIME_PATH}
   ```
   If result is "bun", use `src/index.ts` (bun has native TypeScript support). Otherwise use `dist/index.js` (pre-compiled).

5. Generate command (quotes around runtime path handle spaces, `exec` replaces shell to preserve stdin pipe):
   ```
   bash -c 'B=~/.claude/plugins/cache/claude-hud-enhanced/claude-hud-enhanced; V=$(ls "$B" 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n | tail -1); exec "{RUNTIME_PATH}" "$B/$V/{SOURCE}"'
   ```

**Windows** (Platform: `win32`):

**First, detect the shell**: Check the `Shell:` value from the environment context (shown in the system prompt).
- If Shell is `bash` (Git Bash, MSYS2, Cygwin): Use the **macOS/Linux instructions above** — they work identically since these provide a POSIX-compatible environment.
- If Shell is `powershell`, `pwsh`, or `cmd`: Use the **PowerShell instructions below**.
- If unsure, check: `echo $BASH_VERSION` — if it outputs a version string, use the macOS/Linux instructions.

**PowerShell instructions** (only when Shell is NOT bash):

1. Get plugin path:
   ```powershell
   (Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\claude-hud-enhanced\claude-hud-enhanced" | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
   ```
   If empty or errors, the plugin is not installed. Tell user to install via marketplace first.

2. Get runtime absolute path (prefer bun, fallback to node):
   ```powershell
   if (Get-Command bun -ErrorAction SilentlyContinue) { (Get-Command bun).Source } elseif (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source } else { Write-Error "Neither bun nor node found" }
   ```

   If neither found, stop and tell user to install Node.js or Bun.

3. **Resolve to actual `.exe` binary** (critical for Windows):
   The path from `Get-Command` may point to a shell wrapper script (e.g. `D:\nvm4w\nodejs\bun` — a bash script, not an executable). Verify the runtime is a real `.exe`:
   ```powershell
   # Check if the file is an actual executable
   [System.IO.Path]::GetExtension("{RUNTIME_PATH}")
   ```
   If the extension is NOT `.exe`, resolve the real binary:
   - For **bun**: Look for `bun.exe` nearby — check `{RUNTIME_DIR}\bun.exe` and `{RUNTIME_DIR}\node_modules\bun\bin\bun.exe`
   - For **node**: Look for `node.exe` — check `{RUNTIME_DIR}\node.exe`
   ```powershell
   # Example: resolve bun wrapper to real bun.exe
   $bunDir = Split-Path (Get-Command bun).Source
   $candidates = @(
     (Join-Path $bunDir "bun.exe"),
     (Join-Path $bunDir "node_modules\bun\bin\bun.exe")
   )
   $resolved = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
   if ($resolved) { $resolved } else { Write-Error "Could not find bun.exe" }
   ```
   Use the resolved `.exe` path as `{RUNTIME_PATH}`.

4. Check if runtime is bun (by filename). If bun, use `src\index.ts`. Otherwise use `dist\index.js`.

5. Generate command — **use the `.exe` directly, NOT a PowerShell wrapper**:

   The statusLine command runs every ~300ms. Using `powershell -Command "..."` spawns a visible console window each time, causing constant black window flickering. Instead, generate a direct executable command:
   ```
   {RUNTIME_PATH} {PLUGIN_PATH}\{SOURCE}
   ```
   Where `{PLUGIN_PATH}` is the **full static path** from step 1 (e.g. `C:\Users\Name\.claude\plugins\cache\claude-hud-enhanced\claude-hud-enhanced\0.1.1`), and `{RUNTIME_PATH}` is the resolved `.exe` from step 3.

   **Important**: Unlike macOS/Linux, the Windows command uses a static plugin path (no dynamic lookup). This is necessary because dynamic lookup requires a shell wrapper, which causes window flashing. The tradeoff is that after a plugin update, the user may need to re-run `/claude-hud-enhanced:setup`.

**WSL (Windows Subsystem for Linux)**: If running in WSL, use the macOS/Linux instructions. Ensure the plugin is installed in the Linux environment (`~/.claude/plugins/...`), not the Windows side.

## Step 2: Test Command

Run the generated command. It should produce output (the HUD lines) within a few seconds.

- If it errors, do not proceed to Step 3.
- If it hangs for more than a few seconds, cancel and debug.
- This test catches issues like broken runtime binaries, missing plugins, or path problems.

## Step 3: Apply Configuration

Read the settings file and merge in the statusLine config, preserving all existing settings:
- **macOS/Linux/Git Bash**: `~/.claude/settings.json`
- **Windows (native PowerShell)**: `$env:USERPROFILE\.claude\settings.json`

If the file doesn't exist, create it. If it contains invalid JSON, report the error and do not overwrite.
If a write fails with `File has been unexpectedly modified`, re-read the file and retry the merge once.

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

**Note**: On macOS/Linux, the generated command dynamically finds and runs the latest installed plugin version — updates are automatic. On Windows (PowerShell), the command uses a static path to avoid window flashing, so re-run `/claude-hud-enhanced:setup` after plugin updates. If the HUD suddenly stops working on any platform, re-run setup to verify the plugin is still installed.

## Step 4: Verify With User

Use AskUserQuestion:
- Question: "The HUD should now appear below your input field. Is it working?"
- Options: "Yes, I see it" / "No, something's wrong"

**If yes**: Ask the user if they'd like to ⭐ star the claude-hud-enhanced repository on GitHub to support the project. If they agree and `gh` CLI is available, run: `gh api -X PUT /user/starred/alwinpaul1/claude-hud-enhanced`. Only run the star command if they explicitly say yes.

**If no**: Debug systematically:

1. **Verify config was applied**:
   - Read settings file (`~/.claude/settings.json` or `$env:USERPROFILE\.claude\settings.json` on Windows)
   - Check statusLine.command exists and looks correct
   - If command contains a hardcoded version path (not using dynamic semver lookup), it may be a stale config from a previous setup

2. **Test the command manually** and capture error output:
   ```bash
   {GENERATED_COMMAND} 2>&1
   ```

3. **Common issues to check**:

   **"command not found" or empty output**:
   - Runtime path might be wrong: `ls -la {RUNTIME_PATH}`
   - On macOS with mise/nvm/asdf: the absolute path may have changed after a runtime update
   - Symlinks may be stale: `command -v node` often returns a symlink that can break after version updates
   - Solution: re-detect with `command -v bun` or `command -v node`, and verify with `realpath {RUNTIME_PATH}` (or `readlink -f {RUNTIME_PATH}`) to get the true absolute path

   **"No such file or directory" for plugin**:
   - Plugin might not be installed: `ls ~/.claude/plugins/cache/claude-hud-enhanced/`
   - Solution: reinstall plugin via marketplace

   **Windows: "bash not recognized"**:
   - Wrong command type for Windows
   - Solution: use the PowerShell command variant, or if using Git Bash, re-run setup

   **Windows: PowerShell execution policy error**:
   - Run: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

   **Windows: Black window flashing every ~300ms**:
   - The statusLine command is wrapped in `powershell -Command "..."`, which spawns a visible console window on each invocation
   - Solution: re-run `/claude-hud-enhanced:setup` — the fix generates a direct `.exe` command without a PowerShell wrapper

   **Windows: bun not executing / "not recognized"**:
   - `bun` may resolve to a bash shell wrapper script (common with nvm4w), not an actual `.exe`
   - Solution: find the real `bun.exe` binary (often at `{bun_dir}\node_modules\bun\bin\bun.exe`) and use that path

   **Windows: HUD shows "[claude-hud-enhanced] Initializing..." and never updates**:
   - stdin pipe not reaching the runtime. This can happen when Claude Code spawns the process directly on Windows
   - Solution: wrap the command with `bash -c exec`: `bash -c 'exec {RUNTIME_PATH} {PLUGIN_PATH}/{SOURCE}'`
   - This preserves the stdin pipe correctly through process replacement

   **Permission denied**:
   - Runtime not executable: `chmod +x {RUNTIME_PATH}`

   **WSL confusion**:
   - If using WSL, ensure plugin is installed in Linux environment, not Windows
   - Check: `ls ~/.claude/plugins/cache/claude-hud-enhanced/`

4. **If still stuck**: Show the user the exact command that was generated and the error, so they can report it or debug further
