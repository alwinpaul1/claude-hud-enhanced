import React, { useState, useEffect, useCallback } from 'react';
import { render } from 'ink';
import minimist from 'minimist';
import { readFileSync, existsSync } from 'node:fs';
import { App } from './app.js';

const HUD_DIR = `${process.env.HOME}/.claude/hud`;
const REFRESH_FILE = `${HUD_DIR}/refresh.json`;

interface SessionConfig {
  sessionId: string;
  fifoPath: string;
  transcriptPath?: string;
}

function Root({ initialSession }: { initialSession: SessionConfig }) {
  const [session, setSession] = useState(initialSession);

  const handleRefresh = useCallback(() => {
    if (!existsSync(REFRESH_FILE)) return;
    try {
      const data = readFileSync(REFRESH_FILE, 'utf-8');
      const parsed = JSON.parse(data) as { sessionId?: string; fifoPath?: string; transcriptPath?: string };
      if (parsed.sessionId && parsed.fifoPath) {
        setSession({
          sessionId: parsed.sessionId,
          fifoPath: parsed.fifoPath,
          transcriptPath: parsed.transcriptPath,
        });
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  useEffect(() => {
    process.on('SIGUSR1', handleRefresh);
    // Also poll for changes every 2s as backup (SIGUSR1 can be unreliable)
    const pollInterval = setInterval(() => {
      if (!existsSync(REFRESH_FILE)) return;
      try {
        const data = readFileSync(REFRESH_FILE, 'utf-8');
        const parsed = JSON.parse(data) as { sessionId?: string; fifoPath?: string; transcriptPath?: string };
        if (parsed.sessionId && parsed.fifoPath && parsed.sessionId !== session.sessionId) {
          setSession({
            sessionId: parsed.sessionId,
            fifoPath: parsed.fifoPath,
            transcriptPath: parsed.transcriptPath,
          });
        }
      } catch {
        // Ignore
      }
    }, 2000);
    return () => {
      process.removeListener('SIGUSR1', handleRefresh);
      clearInterval(pollInterval);
    };
  }, [handleRefresh, session.sessionId]);

  // Key forces full remount on session change, resetting all state
  return (
    <App
      key={session.sessionId}
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
