import type { CreateContestInput, CreateClueInput, SubmitAnswerInput } from "./contest.schema.js";
export declare function createContest(data: CreateContestInput): Promise<{
    createdAt: Date;
    description: string | null;
    endsAt: Date | null;
    id: string;
    startsAt: Date | null;
    status: import("../../generated/prisma/enums.js").ContestStatus;
    title: string;
}>;
export declare function createClue(contestId: string, data: CreateClueInput): Promise<{
    content: string;
    contestId: string;
    createdAt: Date;
    id: string;
    publishedAt: Date | null;
    sequence: number;
    type: import("../../generated/prisma/enums.js").ClueType;
}>;
export declare function submitAnswer(userId: string, contestId: string, data: SubmitAnswerInput): Promise<{
    status: "CONTEST_COMPLETED";
    isCorrect: boolean;
    responseTimeMs: number;
    currentSequence: number;
    nextSequence: null;
} | {
    status: "INCORRECT";
    isCorrect: boolean;
    responseTimeMs: number;
    currentSequence: number;
    nextSequence: number;
} | {
    status: "CORRECT";
    isCorrect: boolean;
    responseTimeMs: number;
    currentSequence: number;
    nextSequence: number;
}>;
//# sourceMappingURL=contest.service.d.ts.map