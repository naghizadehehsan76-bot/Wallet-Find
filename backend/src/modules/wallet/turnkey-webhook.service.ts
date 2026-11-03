import { verifyTurnkeyWebhookSignature, type TurnkeyWebhookVerificationKey } from "@turnkey/crypto";
import prisma from "../../config/prisma.js";

type VerifiedWebhookResult =
  | { accepted: true; duplicate: boolean; eventId: string }
  | { accepted: false; status: 400 | 401 | 503; error: string };

const TURNKEY_WEBHOOK_JWKS_URL =
  "https://api.turnkey.com/public/v1/discovery/webhooks/jwks";
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

type CachedJwks = {
  keys: TurnkeyWebhookVerificationKey[];
  expiresAt: number;
};

let cachedJwks: CachedJwks | null = null;
let jwksFetchInFlight: Promise<TurnkeyWebhookVerificationKey[]> | null = null;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractEventType(payload: Record<string, unknown>): string {
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : null;
  return readString(payload.eventType)
    ?? readString(payload.type)
    ?? readString(metadata?.event_type)
    ?? "UNKNOWN";
}

function extractOrganizationId(payload: Record<string, unknown>): string | null {
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : null;
  const nested = data?.organization && typeof data.organization === "object"
    ? data.organization as Record<string, unknown>
    : null;
  return readString(payload.organizationId)
    ?? readString(data?.organizationId)
    ?? readString(nested?.id);
}

function cacheTtlFromHeaders(cacheControl: string | null): number {
  const maxAge = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i);
  if (!maxAge) return DEFAULT_JWKS_CACHE_TTL_MS;
  const seconds = Number(maxAge[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_JWKS_CACHE_TTL_MS;
  return Math.min(seconds * 1000, MAX_JWKS_CACHE_TTL_MS);
}

async function fetchTurnkeyVerificationKeys(forceRefresh = false): Promise<TurnkeyWebhookVerificationKey[]> {
  if (!forceRefresh && cachedJwks && cachedJwks.expiresAt > Date.now()) {
    return cachedJwks.keys;
  }
  if (jwksFetchInFlight) return jwksFetchInFlight;

  jwksFetchInFlight = (async () => {
    const response = await fetch(TURNKEY_WEBHOOK_JWKS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`TURNKEY_JWKS_HTTP_${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { keys?: unknown }).keys)) {
      throw new Error("TURNKEY_JWKS_INVALID_RESPONSE");
    }

    const keys: TurnkeyWebhookVerificationKey[] = [];
    for (const item of (payload as { keys: unknown[] }).keys) {
      if (!item || typeof item !== "object") continue;
      const key = item as Record<string, unknown>;
      const keyId = readString(key.kid);
      const encodedPublicKey = readString(key.x);
      if (
        !keyId ||
        !encodedPublicKey ||
        key.kty !== "OKP" ||
        key.crv !== "Ed25519" ||
        key.alg !== "EdDSA" ||
        (key.turnkey_signature_algorithm !== undefined && key.turnkey_signature_algorithm !== "ed25519") ||
        (key.turnkey_signature_version !== undefined && key.turnkey_signature_version !== "v1")
      ) continue;

      let publicKey: Buffer;
      try {
        publicKey = Buffer.from(encodedPublicKey, "base64url");
      } catch {
        continue;
      }
      if (publicKey.length !== 32) continue;
      keys.push({ keyId, publicKey: publicKey.toString("hex"), algorithm: "ed25519" });
    }

    if (keys.length === 0) throw new Error("TURNKEY_JWKS_HAS_NO_VALID_ED25519_KEYS");
    cachedJwks = {
      keys,
      expiresAt: Date.now() + cacheTtlFromHeaders(response.headers.get("cache-control")),
    };
    return keys;
  })();

  try {
    return await jwksFetchInFlight;
  } finally {
    jwksFetchInFlight = null;
  }
}

/**
 * Verify the exact raw body using Turnkey's public JWKS. Keys are cached using
 * the provider's Cache-Control max-age and refreshed once on an unknown key ID
 * to support signing-key rotation without a manual Render environment update.
 * This endpoint remains an inbox only; no user balance is credited here.
 */
export async function receiveTurnkeyWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<VerifiedWebhookResult> {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 1_000_000) {
    return { accepted: false, status: 400, error: "INVALID_WEBHOOK_BODY" };
  }

  let verificationKeys: TurnkeyWebhookVerificationKey[];
  try {
    verificationKeys = await fetchTurnkeyVerificationKeys();
  } catch (error) {
    console.error("Turnkey webhook JWKS fetch failed", error);
    return { accepted: false, status: 503, error: "TURNKEY_WEBHOOK_KEY_DISCOVERY_UNAVAILABLE" };
  }

  let verification = verifyTurnkeyWebhookSignature({
    headers,
    body: rawBody,
    verificationKeys,
    maxTimestampAgeMs: 5 * 60 * 1000,
  });

  if (!verification.ok && verification.reason === "missing_key") {
    try {
      verificationKeys = await fetchTurnkeyVerificationKeys(true);
      verification = verifyTurnkeyWebhookSignature({
        headers,
        body: rawBody,
        verificationKeys,
        maxTimestampAgeMs: 5 * 60 * 1000,
      });
    } catch (error) {
      console.error("Turnkey webhook JWKS refresh failed", error);
      return { accepted: false, status: 503, error: "TURNKEY_WEBHOOK_KEY_DISCOVERY_UNAVAILABLE" };
    }
  }

  if (!verification.ok) {
    return { accepted: false, status: 401, error: "INVALID_TURNKEY_WEBHOOK_SIGNATURE" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { accepted: false, status: 400, error: "INVALID_WEBHOOK_JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { accepted: false, status: 400, error: "INVALID_WEBHOOK_PAYLOAD" };
  }

  const payload = parsed as Record<string, unknown>;
  const eventId = verification.eventId;
  if (!eventId || eventId.length > 255) {
    return { accepted: false, status: 400, error: "TURNKEY_WEBHOOK_EVENT_ID_REQUIRED" };
  }

  try {
    await prisma.turnkeyWebhookEvent.create({
      data: {
        eventId,
        eventType: extractEventType(payload),
        organizationId: extractOrganizationId(payload),
        payload: payload as never,
      },
    });
    return { accepted: true, duplicate: false, eventId };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return { accepted: true, duplicate: true, eventId };
    }
    throw error;
  }
}
