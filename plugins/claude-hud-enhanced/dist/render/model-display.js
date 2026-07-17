import { getProviderLabel } from '../stdin.js';
import { formatAuthSegment } from '../auth.js';
export function formatModelDisplay(model, ctx) {
    let effortSuffix = '';
    if (ctx.effortLevel && ctx.effortSymbol) {
        effortSuffix = ` ${ctx.effortSymbol} ${ctx.effortLevel}`;
    }
    else if (ctx.effortLevel) {
        effortSuffix = ` ${ctx.effortLevel}`;
    }
    const display = ctx.config?.display;
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