import type { RenderContext } from '../types.js';
import { dim } from './colors.js';

export function renderLastMessageLine(ctx: RenderContext): string | null {
    const msg = ctx.transcript.lastUserMessage;

    if (!msg) {
        return null;
    }

    // Calculate max length based on terminal width or reasonable default
    const maxLen = 80;
    let displayMsg = msg;

    if (msg.length > maxLen) {
        displayMsg = msg.slice(0, maxLen - 3) + '...';
    }

    return `${dim('💬')} ${dim(displayMsg)}`;
}
