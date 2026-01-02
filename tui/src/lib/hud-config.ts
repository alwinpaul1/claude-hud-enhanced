import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from './logger.js';

export type PanelId = 'status' | 'context' | 'cost' | 'contextInfo' | 'tools' | 'agents' | 'todos';

export interface HudConfig {
  panelOrder?: PanelId[];
  hiddenPanels?: PanelId[];
  width?: number;
}

const HUD_CONFIG_PATH = path.join(os.homedir(), '.claude', 'hud', 'config.json');
const PANEL_IDS: PanelId[] = [
  'status',
  'context',
  'cost',
  'contextInfo',
  'tools',
  'agents',
  'todos',
];

function normalizePanelList(value: unknown): PanelId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is PanelId => PANEL_IDS.includes(entry as PanelId));
  return Array.from(new Set(list));
}

export function readHudConfig(configPath: string = HUD_CONFIG_PATH): HudConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;

    const panelOrder = normalizePanelList(raw.panelOrder);
    const hiddenPanels = normalizePanelList(raw.hiddenPanels);
    const width = typeof raw.width === 'number' && raw.width > 0 ? raw.width : undefined;

    return {
      panelOrder,
      hiddenPanels,
      width,
    };
  } catch (err) {
    logger.debug('HudConfig', 'Failed to read config', { path: configPath, err });
    return null;
  }
}

export class HudConfigReader {
  private data: HudConfig | null = null;
  private lastRead = 0;
  private readonly refreshInterval = 30000;
  private readonly configPath: string;

  constructor(configPath: string = HUD_CONFIG_PATH) {
    this.configPath = configPath;
  }

  read(): HudConfig | null {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      this.data = readHudConfig(this.configPath);
      this.lastRead = now;
    }
    return this.data;
  }

  forceRefresh(): HudConfig | null {
    this.data = readHudConfig(this.configPath);
    this.lastRead = Date.now();
    return this.data;
  }
}
