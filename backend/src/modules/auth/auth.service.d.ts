import type { RegisterInput, LoginInput } from "./auth.schema.js";
export declare function registerUser(input: RegisterInput): Promise<{
    user: {
        createdAt: Date;
        email: string;
        id: string;
        role: import("../../generated/prisma/enums.js").UserRole;
        username: string;
    };
    token: string;
}>;
export declare function loginUser(input: LoginInput): Promise<{
    user: {
        id: string;
        email: string;
        username: string;
        role: import("../../generated/prisma/enums.js").UserRole;
        createdAt: Date;
    };
    token: string;
}>;
//# sourceMappingURL=auth.service.d.ts.map