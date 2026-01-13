/** Check if usage limit is reached (either window at 100%) */
export function isLimitReached(data) {
    return data.fiveHour === 100 || data.sevenDay === 100;
}
/** Check if a specific model quota is exhausted */
export function isModelQuotaExhausted(data, modelId) {
    const quota = data.modelQuotas?.find(q => q.modelId === modelId);
    return quota?.utilization === 100;
}
/** Get the most restrictive model quota */
export function getMostRestrictiveQuota(data) {
    if (!data.modelQuotas || data.modelQuotas.length === 0)
        return null;
    return data.modelQuotas.reduce((max, q) => (q.utilization ?? 0) > (max.utilization ?? 0) ? q : max);
}
//# sourceMappingURL=types.js.map