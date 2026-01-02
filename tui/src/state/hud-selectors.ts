import type { ToolEntry, AgentEntry } from '../lib/types.js';
import type { HudConfig, PanelId } from '../lib/hud-config.js';

export const DEFAULT_PANEL_ORDER: PanelId[] = [
  'status',
  'context',
  'cost',
  'contextInfo',
  'tools',
  'agents',
  'todos',
];

export function resolvePanelOrder(config?: HudConfig | null): PanelId[] {
  const configOrder = config?.panelOrder;
  if (!configOrder || configOrder.length === 0) return DEFAULT_PANEL_ORDER;
  const ordered = [...configOrder];
  for (const panel of DEFAULT_PANEL_ORDER) {
    if (!ordered.includes(panel)) {
      ordered.push(panel);
    }
  }
  return ordered;
}

export function getHiddenPanelSet(config?: HudConfig | null): Set<PanelId> {
  return new Set(config?.hiddenPanels || []);
}

export function getVisibleTools(tools: ToolEntry[], maxVisible: number): ToolEntry[] {
  return tools.slice(-maxVisible);
}

export function getRecentAgents(agents: AgentEntry[], maxVisible: number): AgentEntry[] {
  return agents.slice(-maxVisible);
}

export function getRunningAgentCount(agents: AgentEntry[]): number {
  return agents.filter((agent) => agent.status === 'running').length;
}
