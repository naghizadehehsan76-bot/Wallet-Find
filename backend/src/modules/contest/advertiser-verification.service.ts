import prisma from "../../config/prisma.js";

export type AdvertiserLandingConfirmationInput = {
  trackingToken: string;
  provider: string;
  referenceId?: string | null;
  confirmedAt?: Date;
};

export type AdvertiserLandingConfirmationResult =
  | { status: "CONFIRMED"; visitId: string }
  | { status: "ALREADY_CONFIRMED"; visitId: string }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ADVERTISER_ATTRIBUTED"; visitId: string }
  | { status: "CONFLICT"; visitId: string };

function validateInput(input: AdvertiserLandingConfirmationInput) {
  const trackingToken = input.trackingToken.trim();
  const provider = input.provider.trim();
  const referenceId = input.referenceId?.trim() || null;
  const confirmedAt = input.confirmedAt ?? new Date();

  if (!trackingToken || trackingToken.length > 128) {
    throw new Error("INVALID_TRACKING_TOKEN");
  }
  if (!provider || provider.length > 80) {
    throw new Error("INVALID_VERIFICATION_PROVIDER");
  }
  if (referenceId && referenceId.length > 255) {
    throw new Error("INVALID_EXTERNAL_REFERENCE");
  }
  if (!(confirmedAt instanceof Date) || !Number.isFinite(confirmedAt.getTime())) {
    throw new Error("INVALID_CONFIRMATION_TIME");
  }

  return { trackingToken, provider, referenceId, confirmedAt };
}

/**
 * Mark a partner-side landing only after a provider adapter has independently
 * authenticated the partner and validated its callback/API response.
 *
 * This function intentionally exposes no HTTP route. Never call it directly
 * with untrusted client-submitted data.
 */
export async function confirmAdvertiserLanding(
  input: AdvertiserLandingConfirmationInput,
): Promise<AdvertiserLandingConfirmationResult> {
  const { trackingToken, provider, referenceId, confirmedAt } = validateInput(input);
  const visit = await prisma.contestSourceVisit.findUnique({
    where: { trackingToken },
    select: {
      id: true,
      advertisementOrderId: true,
      externalVerificationStatus: true,
      externalVerificationProvider: true,
      externalReferenceId: true,
    },
  });

  if (!visit) return { status: "NOT_FOUND" };
  if (!visit.advertisementOrderId) {
    return { status: "NOT_ADVERTISER_ATTRIBUTED", visitId: visit.id };
  }

  if (visit.externalVerificationStatus === "CONFIRMED") {
    const sameConfirmation =
      visit.externalVerificationProvider === provider &&
      (visit.externalReferenceId ?? null) === referenceId;
    return {
      status: sameConfirmation ? "ALREADY_CONFIRMED" : "CONFLICT",
      visitId: visit.id,
    };
  }
  if (visit.externalVerificationStatus === "REJECTED") {
    return { status: "CONFLICT", visitId: visit.id };
  }

  const changed = await prisma.contestSourceVisit.updateMany({
    where: {
      id: visit.id,
      externalVerificationStatus: visit.externalVerificationStatus,
    },
    data: {
      externalVerificationStatus: "CONFIRMED",
      externalConfirmedAt: confirmedAt,
      externalVerificationProvider: provider,
      externalReferenceId: referenceId,
    },
  });

  if (changed.count === 1) {
    return { status: "CONFIRMED", visitId: visit.id };
  }

  // A concurrent callback may have confirmed this exact landing first.
  const latest = await prisma.contestSourceVisit.findUnique({
    where: { id: visit.id },
    select: {
      externalVerificationStatus: true,
      externalVerificationProvider: true,
      externalReferenceId: true,
    },
  });
  if (
    latest?.externalVerificationStatus === "CONFIRMED" &&
    latest.externalVerificationProvider === provider &&
    (latest.externalReferenceId ?? null) === referenceId
  ) {
    return { status: "ALREADY_CONFIRMED", visitId: visit.id };
  }
  return { status: "CONFLICT", visitId: visit.id };
}
