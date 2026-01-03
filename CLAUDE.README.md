<plugin>
  <name>Claude HUD</name>
  <description>Real-time statusline showing context usage, active tools, running agents, and todo progress. Always visible below your input.</description>
  <repository>github.com/jarrodwatts/claude-hud</repository>
</plugin>

<install>
  <command>claude /plugin install github.com/jarrodwatts/claude-hud</command>
  <post_install>Restart Claude Code after installation. The statusline appears automatically below your input.</post_install>
</install>

<requirements>
  <item>Claude Code v1.0.80 or later</item>
  <item>Node.js 18+ or Bun</item>
</requirements>

<what_it_shows>
  <line name="session">Model, context usage bar (color-coded), rules/MCPs/hooks counts, session duration</line>
  <line name="tools">Running tools with spinner, completed tools aggregated by type</line>
  <line name="agents">Active subagents with description and elapsed time</line>
  <line name="todos">Current task and progress counter</line>
</what_it_shows>

<context_colors>
  <threshold percent="0-70" color="green">Healthy</threshold>
  <threshold percent="70-85" color="yellow">Warning</threshold>
  <threshold percent="85-95" color="red">Critical</threshold>
  <threshold percent="95+" color="red">Shows COMPACT warning</threshold>
</context_colors>

<task_instruction>
If the user wants to install Claude HUD, run the install command above using bash.
After installation, inform them to restart Claude Code to see the statusline.
</task_instruction>
