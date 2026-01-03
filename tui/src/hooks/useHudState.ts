import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { HudStore } from '../state/hud-store.js';
import type { HudState } from '../state/hud-state.js';

export type { HudState };

interface UseHudStateOptions {
  fifoPath: string;
  sessionId?: string;
  initialTranscriptPath?: string;
}

export function useHudState({
  fifoPath,
  sessionId,
  initialTranscriptPath,
}: UseHudStateOptions): HudState {
  const store = useMemo(
    () => new HudStore({ fifoPath, initialTranscriptPath, initialSessionId: sessionId }),
    [fifoPath, initialTranscriptPath, sessionId],
  );

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );
}
