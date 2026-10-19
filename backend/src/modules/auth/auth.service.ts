import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../config/prisma.js";
import type {
  RegisterInput,
  LoginInput,
} from "./auth.schema.js";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not defined");
  }

  return secret;
}

function createToken(userId: string, role: string): string {
  const secret = getJwtSecret();

  return jwt.sign(
    {
      userId,
      role,
    },
    secret,
    {
      expiresIn: "7d",
    }
  );
}

export async function registerUser(input: RegisterInput) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: normalizedEmail, mode: "insensitive" } },
        { username: input.username },
      ],
    },
  });

  if (existingUser) {
    throw new Error("EMAIL_OR_USERNAME_ALREADY_EXISTS");
  }

  const passwordHash = await bcrypt.hash(
    input.password,
    12
  );

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      username: input.username,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      createdAt: true,
    },
  });

  const token = createToken(
    user.id,
    user.role
  );

  return {
    user,
    token,
  };
}

export async function loginUser(input: LoginInput) {
  const normalizedEmail = input.email.trim();
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
  });

  if (!user) {
    throw new Error("EMAIL_NOT_REGISTERED");
  }

  const passwordValid = await bcrypt.compare(
    input.password,
    user.passwordHash
  );

  if (!passwordValid) {
    throw new Error("INVALID_PASSWORD");
  }

  const token = createToken(
    user.id,
    user.role
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
  };
}