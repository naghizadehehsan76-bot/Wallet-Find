import jwt from "jsonwebtoken";
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET is not defined");
    }
    return secret;
}
export function requireAuth(req, res, next) {
    try {
        const authorization = req.headers.authorization;
        if (!authorization) {
            return res.status(401).json({
                success: false,
                error: "AUTHENTICATION_REQUIRED",
            });
        }
        if (!authorization.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                error: "INVALID_AUTHORIZATION_HEADER",
            });
        }
        const token = authorization.substring(7).trim();
        if (!token) {
            return res.status(401).json({
                success: false,
                error: "INVALID_TOKEN",
            });
        }
        const decoded = jwt.verify(token, getJwtSecret());
        if (typeof decoded !== "object" ||
            decoded === null ||
            typeof decoded.userId !== "string" ||
            typeof decoded.role !== "string") {
            return res.status(401).json({
                success: false,
                error: "INVALID_TOKEN",
            });
        }
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
        };
        next();
    }
    catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({
                success: false,
                error: "TOKEN_EXPIRED",
            });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                success: false,
                error: "INVALID_TOKEN",
            });
        }
        console.error(error);
        return res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
        });
    }
}
export function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "AUTHENTICATION_REQUIRED",
        });
    }
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            error: "ADMIN_ACCESS_REQUIRED",
        });
    }
    next();
}
//# sourceMappingURL=auth.middleware.js.map