export declare const DEFAULT_WINDOW_MS: number;
export declare const SCANNER_UA_MARKERS: string[];
export declare const TOKEN_RE: RegExp;

export interface LinkHit {
  sentAt?: Date | number | string;
  now?: Date | number | string;
  method?: string;
  userAgent?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
  windowMs?: number;
}
export interface ScannerVerdict {
  scanner: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: string[];
}
export declare function isLikelyScanner(hit?: LinkHit): ScannerVerdict;

export declare function renderConfirmPage(opts?: { action?: string; brand?: string; done?: boolean }): string;
export declare function parseUnsubscribe(request: Request): Promise<{
  action: "confirm-page" | "unsubscribe" | "invalid";
  token: string;
  oneClick?: boolean;
}>;
export declare function handleUnsubscribe(
  request: Request,
  opts: { onUnsubscribe: (token: string) => Promise<boolean> | boolean; brand?: string },
): Promise<Response>;
