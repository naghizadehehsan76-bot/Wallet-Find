import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/auth.middleware.js";
import { getProfile } from "./profile.service.js";
import prisma from "../../config/prisma.js";

export async function getProfileHandler(
  req: AuthenticatedRequest,
  res: Response,
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    const profile = await getProfile(req.user.userId);
    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
    }
    console.error(error);
    return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
}


export async function updateProfileAvatarHandler(
  req: AuthenticatedRequest,
  res: Response,
) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
  }

  const avatarDataUrl = req.body?.avatarDataUrl;
  if (typeof avatarDataUrl !== "string") {
    return res.status(400).json({ success: false, error: "INVALID_AVATAR" });
  }

  const match = avatarDataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    return res.status(400).json({ success: false, error: "INVALID_AVATAR_FORMAT" });
  }

  const encodedImage = match[2] ?? "";
  const imageBytes = Buffer.from(encodedImage, "base64");
  if (imageBytes.length === 0 || imageBytes.length > 1024 * 1024) {
    return res.status(413).json({ success: false, error: "AVATAR_TOO_LARGE" });
  }

  try {
    const avatar = await prisma.user.update({
      where: { id: req.user.userId },
      data: { avatarDataUrl },
      select: { avatarDataUrl: true },
    });
    return res.status(200).json({ success: true, data: avatar });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "AVATAR_SAVE_FAILED" });
  }
}
