import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../config/prisma.js";
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET is not defined");
    }
    return secret;
}
function createToken(userId, role) {
    const secret = getJwtSecret();
    return jwt.sign({
        userId,
        role,
    }, secret, {
        expiresIn: "7d",
    });
}
export async function registerUser(input) {
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [
                { email: input.email },
                { username: input.username },
            ],
        },
    });
    if (existingUser) {
        throw new Error("EMAIL_OR_USERNAME_ALREADY_EXISTS");
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
        data: {
            email: input.email,
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
    const token = createToken(user.id, user.role);
    return {
        user,
        token,
    };
}
export async function loginUser(input) {
    const user = await prisma.user.findUnique({
        where: {
            email: input.email,
        },
    });
    if (!user) {
        throw new Error("INVALID_CREDENTIALS");
    }
    const passwordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordValid) {
        throw new Error("INVALID_CREDENTIALS");
    }
    const token = createToken(user.id, user.role);
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
//# sourceMappingURL=auth.service.js.map