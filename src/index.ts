import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countRules, countMcpServers } from './config-reader.js';
import type { RenderContext } from './types.js';

async function main(): Promise<void> {
  try {
    const stdin = await readStdin();

    if (!stdin) {
      console.log('[claude-hud] Initializing...');
      return;
    }

    const transcriptPath = stdin.transcript_path ?? '';
    const transcript = await parseTranscript(transcriptPath);

    const rulesCount = await countRules(stdin.cwd);
    const mcpCount = await countMcpServers();

    const sessionDuration = formatSessionDuration(transcript.sessionStart);

    const ctx: RenderContext = {
      stdin,
      transcript,
      rulesCount,
      mcpCount,
      sessionDuration,
    };

    render(ctx);
  } catch (error) {
    console.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

function formatSessionDuration(sessionStart?: Date): string {
  if (!sessionStart) {
    return '';
  }

  const ms = Date.now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

main();
