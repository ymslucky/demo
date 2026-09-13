export const DEFAULT_SITE_APEX: string;
export const ADMIN_ROLE: string;
export const JWKS_TTL_MS: number;
export function siteApex(raw: unknown): string | null;
export function normalizeIssuer(value: unknown): string;
export function parseList(raw: string | undefined): string[] | null;
export function deriveIssuers(env?: {
  siteDomain?: string;
  clerkIssuer?: string;
}): string[];
export function isAllowedAzp(azp: unknown, apex: unknown): boolean;
export function roleFromClaims(
  payload: Record<string, unknown> | null | undefined,
): string;
export function resetJwksCache(): void;
export function getJwks(
  issuer: string,
  opts?: { forceRefresh?: boolean },
): Promise<Array<Record<string, unknown>>>;
export function parseTokenPayload(token: unknown): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
} | null;
export function isTokenFresh(payload: unknown, now?: number): boolean;
export function verifyRs256(
  jwk: Record<string, unknown>,
  signingInput: string,
  signature: Uint8Array,
  cryptoObj: Crypto,
): Promise<boolean>;
export function verifyEs256(
  jwk: Record<string, unknown>,
  signingInput: string,
  signature: Uint8Array,
  cryptoObj: Crypto,
): Promise<boolean>;
export function verifySessionDetailed(
  token: unknown,
  deps?: {
    jwks?: Array<Record<string, unknown>> | null;
    now?: number;
    crypto?: Crypto;
    fetchJwks?: (
      issuer: string,
      opts?: { forceRefresh?: boolean },
    ) => Promise<Array<Record<string, unknown>>>;
    allowedIssuers?: string[];
    azpApex?: string;
  },
): Promise<
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }
>;
export function verifySessionToken(
  token: unknown,
  deps?: Parameters<typeof verifySessionDetailed>[1],
): Promise<Record<string, unknown> | null>;
export function apexFromIssuer(issuer: unknown): string;
export const clerkProvider: {
  id: "clerk";
  issuers(env?: { siteDomain?: string; issuerOverride?: string }): string[];
  roleFromClaims(payload: Record<string, unknown> | null | undefined): string;
  apexFromIssuer(issuer: unknown): string;
};
