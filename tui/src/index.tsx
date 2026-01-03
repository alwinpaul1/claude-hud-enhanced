import React, { useState, useEffect, useCallback } from 'react';
import { render } from 'ink';
import minimist from 'minimist';
import { existsSync, mkdirSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { App } from './app.js';
import { logger } from './lib/logger.js';

const HUD_DIR = path.join(os.homedir(), '.claude', 'hud');
const REFRESH_FILE = path.join(HUD_DIR, 'refresh.json');

interface SessionConfig {
  sessionId: string;
  fifoPath: string;
  transcriptPath?: string;
}

function Root({ initialSession }: { initialSession: SessionConfig }) {
  const [session, setSession] = useState(initialSession);

  const readRefreshFile = useCallback(async (): Promise<SessionConfig | null> => {
    if (!existsSync(REFRESH_FILE)) return null;
    try {
      const data = await readFile(REFRESH_FILE, 'utf-8');
      const parsed = JSON.parse(data) as {
        sessionId?: string;
        fifoPath?: string;
        transcriptPath?: string;
      };
      if (parsed.sessionId && parsed.fifoPath) {
        return {
          sessionId: parsed.sessionId,
          fifoPath: parsed.fifoPath,
          transcriptPath: parsed.transcriptPath,
        };
      }
    } catch (err) {
      logger.warn('Root', 'Failed to parse refresh file', { err });
    }
    return null;
  }, []);

  const handleRefresh = useCallback(() => {
    void readRefreshFile().then((next) => {
      if (!next) return;
      setSession((prev) => {
        if (
          prev.sessionId === next.sessionId &&
          prev.fifoPath === next.fifoPath &&
          prev.transcriptPath === next.transcriptPath
        ) {
          return prev;
        }
        return next;
      });
    });
  }, [readRefreshFile]);

  useEffect(() => {
    process.on('SIGUSR1', handleRefresh);
    try {
      mkdirSync(HUD_DIR, { recursive: true });
    } catch (err) {
      logger.debug('Root', 'Failed to create HUD dir', { err });
    }

    let watcher: ReturnType<typeof watch> | null = null;
    try {
      watcher = watch(HUD_DIR, { persistent: false }, (_event, filename) => {
        if (filename === 'refresh.json' || filename?.toString() === 'refresh.json') {
          handleRefresh();
        }
      });
    } catch (err) {
      logger.debug('Root', 'Failed to watch HUD dir', { err });
    }

    // Poll as a fallback if file watching is unreliable.
    const pollInterval = setInterval(() => {
      void readRefreshFile().then((next) => {
        if (!next || next.sessionId === session.sessionId) return;
        setSession(next);
      });
    }, 5000);
    return () => {
      process.removeListener('SIGUSR1', handleRefresh);
      clearInterval(pollInterval);
      watcher?.close();
    };
  }, [handleRefresh, readRefreshFile, session.sessionId]);

  // Key forces full remount on session change, resetting all state
  return (
    <App
      key={session.sessionId}
      sessionId={session.sessionId}
      fifoPath={session.fifoPath}
      initialTranscriptPath={session.transcriptPath}
    />
  );
}

const args = minimist(process.argv.slice(2));
const sessionId = args.session || 'unknown';
const fifoPath = args.fifo || '';

if (!fifoPath) {
  console.error('Usage: node index.js --session <id> --fifo <path>');
  process.exit(1);
}

render(<Root initialSession={{ sessionId, fifoPath }} />);
