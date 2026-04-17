export interface OAuthInfo {
    subscriptionType: string | null;
    rateLimitTier: string | null;
}
export declare function readOAuthInfo(): OAuthInfo;
export declare function formatPlanLabel(info: OAuthInfo): string | null;
export declare function getPlanLabel(): string | null;
//# sourceMappingURL=oauth.d.ts.map