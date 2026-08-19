import { getProviderLabel } from '../stdin.js';
import { formatAuthSegment } from '../auth.js';
function formatEffortSuffix(ctx, format) {
    if (!ctx.effortLevel) {
        return '';
    }
    // Ultracode's marker lives in the level text ("ultracode(xhigh)"), so the
    // symbol alone cannot represent it; keep the full form in symbol mode.
    const isUltracode = ctx.effortLevel.startsWith('ultracode(');
    if (format === 'symbol' && ctx.effortSymbol && !isUltracode) {
        return ` ${ctx.effortSymbol}`;
    }
    if (format === 'text' || !ctx.effortSymbol) {
        return ` ${ctx.effortLevel}`;
    }
    return ` ${ctx.effortSymbol} ${ctx.effortLevel}`;
}
export function formatModelDisplay(model, ctx) {
    const display = ctx.config?.display;
    const effortSuffix = formatEffortSuffix(ctx, display?.effortFormat ?? 'full');
    const autoProvider = getProviderLabel(ctx.stdin);
    let core;
    if (display?.showProvider) {
        const providerLabel = display.providerName?.trim() || autoProvider;
        const base = `${model}${effortSuffix}`;
        core = providerLabel ? `${providerLabel} | ${base}` : base;
    }
    else {
        core = autoProvider ? `${model}${effortSuffix} | ${autoProvider}` : `${model}${effortSuffix}`;
    }
    // Enhanced: fold the auth/plan label into the model bracket
    // (`[Opus 4.8 | Claude Max 20x]`) instead of trailing it as its own segment.
    // The line renderers suppress the trailing auth segment when this is on, so
    // the label renders exactly once. `showAuth`/`showAuthUser` still control
    // whether the label exists at all.
    if (display?.showAuthInModel) {
        const authSegment = formatAuthSegment(ctx.authInfo, display);
        if (authSegment) {
            core = `${core} | ${authSegment}`;
        }
    }
    return core;
}
//# sourceMappingURL=model-display.js.map