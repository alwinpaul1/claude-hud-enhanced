import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from './logger.js';
import type { PricingConfig } from './cost-tracker.js';

export type PanelId = 'status' | 'context' | 'cost' | 'contextInfo' | 'tools' | 'agents' | 'todos';

export interface HudConfig {
  panelOrder?: PanelId[];
  hiddenPanels?: PanelId[];
  width?: number;
  pricing?: Partial<PricingConfig>;
}

export interface HudConfigReadResult {
  data: HudConfig | null;
  error?: string;
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

function normalizePricing(value: unknown): Partial<PricingConfig> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const result: Partial<PricingConfig> = {};

  if (raw.sonnet && typeof raw.sonnet === 'object') {
    const s = raw.sonnet as Record<string, unknown>;
    if (typeof s.input === 'number' && typeof s.output === 'number') {
      result.sonnet = { input: s.input, output: s.output };
    }
  }
  if (raw.opus && typeof raw.opus === 'object') {
    const o = raw.opus as Record<string, unknown>;
    if (typeof o.input === 'number' && typeof o.output === 'number') {
      result.opus = { input: o.input, output: o.output };
    }
  }
  if (raw.haiku && typeof raw.haiku === 'object') {
    const h = raw.haiku as Record<string, unknown>;
    if (typeof h.input === 'number' && typeof h.output === 'number') {
      result.haiku = { input: h.input, output: h.output };
    }
  }
  if (typeof raw.lastUpdated === 'string') {
    result.lastUpdated = raw.lastUpdated;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildHudConfig(raw: Record<string, unknown>): HudConfig {
  const panelOrder = normalizePanelList(raw.panelOrder);
  const hiddenPanels = normalizePanelList(raw.hiddenPanels);
  const width = typeof raw.width === 'number' && raw.width > 0 ? raw.width : undefined;
  const pricing = normalizePricing(raw.pricing);

  return {
    panelOrder,
    hiddenPanels,
    width,
    pricing,
  };
}

function normalizePanelList(value: unknown): PanelId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is PanelId => PANEL_IDS.includes(entry as PanelId));
  return Array.from(new Set(list));
}

export function readHudConfigWithStatus(configPath: string = HUD_CONFIG_PATH): HudConfigReadResult {
  try {
    if (!fs.existsSync(configPath)) {
      return { data: null };
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;
    return { data: buildHudConfig(raw) };
  } catch (err) {
    logger.debug('HudConfig', 'Failed to read config', { path: configPath, err });
    return { data: null, error: 'Failed to read hud config' };
  }
}

export async function readHudConfigWithStatusAsync(
  configPath: string = HUD_CONFIG_PATH,
): Promise<HudConfigReadResult> {
  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;
    return { data: buildHudConfig(raw) };
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return { data: null };
    }
    logger.debug('HudConfig', 'Failed to read config', { path: configPath, err });
    return { data: null, error: 'Failed to read hud config' };
  }
}

export function readHudConfig(configPath: string = HUD_CONFIG_PATH): HudConfig | null {
  return readHudConfigWithStatus(configPath).data;
}

export async function readHudConfigAsync(
  configPath: string = HUD_CONFIG_PATH,
): Promise<HudConfig | null> {
  const result = await readHudConfigWithStatusAsync(configPath);
  return result.data;
}

export class HudConfigReader {
  private data: HudConfig | null = null;
  private lastError: string | undefined;
  private lastRead = 0;
  private readonly refreshInterval = 30000;
  private readonly configPath: string;

  constructor(configPath: string = HUD_CONFIG_PATH) {
    this.configPath = configPath;
  }

  read(): HudConfig | null {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = readHudConfigWithStatus(this.configPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
    }
    return this.data;
  }

  readWithStatus(): HudConfigReadResult {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = readHudConfigWithStatus(this.configPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
      return result;
    }
    return { data: this.data, error: this.lastError };
  }

  async readWithStatusAsync(): Promise<HudConfigReadResult> {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = await readHudConfigWithStatusAsync(this.configPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
      return result;
    }
    return { data: this.data, error: this.lastError };
  }

  forceRefresh(): HudConfig | null {
    const result = readHudConfigWithStatus(this.configPath);
    this.data = result.data;
    this.lastError = result.error;
    this.lastRead = Date.now();
    return this.data;
  }

  async forceRefreshAsync(): Promise<HudConfig | null> {
    const result = await readHudConfigWithStatusAsync(this.configPath);
    this.data = result.data;
    this.lastError = result.error;
    this.lastRead = Date.now();
    return this.data;
  }
}
