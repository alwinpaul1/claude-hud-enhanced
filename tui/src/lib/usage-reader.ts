import { spawn } from 'child_process';

export interface UsageData {
  sessionPercent: number;
  sessionResetTime: string;
  weekPercent?: number;
  weekResetTime?: string;
}

export class UsageReader {
  private cache: UsageData | null = null;
  private lastFetch: number = 0;
  private fetching: boolean = false;
  private readonly minInterval = 60000;

  async read(): Promise<UsageData | null> {
    const now = Date.now();

    if (this.cache && now - this.lastFetch < this.minInterval) {
      return this.cache;
    }

    if (this.fetching) {
      return this.cache;
    }

    this.fetching = true;

    try {
      const result = await this.fetchUsage();
      if (result) {
        this.cache = result;
        this.lastFetch = now;
      }
    } finally {
      this.fetching = false;
    }

    return this.cache;
  }

  private fetchUsage(): Promise<UsageData | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 2000);

      const proc = spawn('claude', ['/usage'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, NO_COLOR: '1' },
      });

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeout);
        resolve(this.parseOutput(output));
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  private parseOutput(output: string): UsageData | null {
    try {
      const lines = output.split('\n');
      let sessionPercent = 0;
      let sessionResetTime = '';
      let weekPercent: number | undefined;
      let weekResetTime: string | undefined;
      let inSession = false;
      let inWeek = false;

      for (const line of lines) {
        if (line.includes('Current session')) {
          inSession = true;
          inWeek = false;
          continue;
        }
        if (line.includes('Current week')) {
          inSession = false;
          inWeek = true;
          continue;
        }

        const percentMatch = line.match(/(\d+)%\s*used/);
        const resetMatch = line.match(/Resets?\s+(.+?)(?:\s*\(|$)/);

        if (inSession && percentMatch) {
          sessionPercent = parseInt(percentMatch[1], 10);
          inSession = false;
        }
        if (inSession && resetMatch) {
          sessionResetTime = resetMatch[1].trim();
        }

        if (inWeek && percentMatch && weekPercent === undefined) {
          weekPercent = parseInt(percentMatch[1], 10);
        }
        if (inWeek && resetMatch && !weekResetTime) {
          weekResetTime = resetMatch[1].trim();
          inWeek = false;
        }
      }

      if (sessionPercent > 0 || sessionResetTime) {
        return { sessionPercent, sessionResetTime, weekPercent, weekResetTime };
      }

      return null;
    } catch {
      return null;
    }
  }

  invalidate(): void {
    this.cache = null;
    this.lastFetch = 0;
  }
}
