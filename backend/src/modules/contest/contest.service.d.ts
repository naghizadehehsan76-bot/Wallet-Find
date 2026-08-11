import type { CreateContestInput } from "./contest.schema.js";
export declare function createContest(data: CreateContestInput): Promise<{
    createdAt: Date;
    description: string | null;
    endsAt: Date | null;
    id: string;
    startsAt: Date | null;
    status: import("../../generated/prisma/enums.js").ContestStatus;
    title: string;
}>;
import type { CreateClueInput } from "./contest.schema.js";
export declare function createClue(contestId: string, data: CreateClueInput): Promise<{
    content: string;
    contestId: string;
    createdAt: Date;
    id: string;
    publishedAt: Date | null;
    sequence: number;
    type: import("../../generated/prisma/enums.js").ClueType;
}>;
//# sourceMappingURL=contest.service.d.ts.map