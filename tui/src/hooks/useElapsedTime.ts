import { useState, useEffect, useRef } from 'react';

export function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export function useElapsedTime(): string {
  const sessionStartRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatDuration(Date.now() - sessionStartRef.current));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return elapsed;
}
