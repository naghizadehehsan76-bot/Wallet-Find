import { verifyTurnkeyWebhookSignature } from "@turnkey/crypto";
import prisma from "../../config/prisma.js";

type VerifiedWebhookResult =
  | { accepted: true; duplicate: boolean; eventId: string }
  | { accepted: false; status: 400 | 401 | 503; error: string };

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

/**
 * Verify the exact raw body before parsing or persisting it. This endpoint is
 * intentionally an inbox only: no user balance is credited based on an
 * unvalidated/unknown event schema.
 */
export async function receiveTurnkeyWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<VerifiedWebhookResult> {
  const keyId = process.env.TURNKEY_WEBHOOK_KEY_ID?.trim();
  const publicKey = process.env.TURNKEY_WEBHOOK_PUBLIC_KEY?.trim();
  if (!keyId || !publicKey) {
    return { accepted: false, status: 503, error: "TURNKEY_WEBHOOK_NOT_CONFIGURED" };
  }
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 1_000_000) {
    return { accepted: false, status: 400, error: "INVALID_WEBHOOK_BODY" };
  }

  const verification = verifyTurnkeyWebhookSignature({
    headers,
    body: rawBody,
    verificationKeys: [{ keyId, publicKey, algorithm: "ed25519" }],
    maxTimestampAgeMs: 5 * 60 * 1000,
  });
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
  const eventIdHeader = headers["x-turnkey-event-id"];
  const eventId = readString(Array.isArray(eventIdHeader) ? eventIdHeader[0] : eventIdHeader);
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
