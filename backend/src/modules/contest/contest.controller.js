import { createContestSchema, createClueSchema, submitAnswerSchema, } from "./contest.schema.js";
import { createContest, createClue, submitAnswer, } from "./contest.service.js";
export async function createContestHandler(req, res) {
    const parsed = createContestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: "INVALID_INPUT",
            details: parsed.error.flatten(),
        });
    }
    try {
        const contest = await createContest(parsed.data);
        return res.status(201).json({
            success: true,
            data: {
                contest,
            },
        });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
        });
    }
}
export async function createClueHandler(req, res) {
    const contestId = req.params.contestId;
    if (!contestId ||
        Array.isArray(contestId)) {
        return res.status(400).json({
            success: false,
            error: "INVALID_CONTEST_ID",
        });
    }
    const parsed = createClueSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: "INVALID_INPUT",
            details: parsed.error.flatten(),
        });
    }
    try {
        const clue = await createClue(contestId, parsed.data);
        return res.status(201).json({
            success: true,
            data: {
                clue,
            },
        });
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error &&
            error.message ===
                "CONTEST_NOT_FOUND") {
            return res.status(404).json({
                success: false,
                error: "CONTEST_NOT_FOUND",
            });
        }
        return res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
        });
    }
}
export async function submitAnswerHandler(req, res) {
    const contestId = req.params.contestId;
    if (!contestId ||
        Array.isArray(contestId)) {
        return res.status(400).json({
            success: false,
            error: "INVALID_CONTEST_ID",
        });
    }
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "AUTHENTICATION_REQUIRED",
        });
    }
    const parsed = submitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: "INVALID_INPUT",
            details: parsed.error.flatten(),
        });
    }
    try {
        const result = await submitAnswer(req.user.userId, contestId, parsed.data);
        return res.status(200).json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        console.error(error);
        if (!(error instanceof Error)) {
            return res.status(500).json({
                success: false,
                error: "INTERNAL_SERVER_ERROR",
            });
        }
        const clientErrors = new Set([
            "CONTEST_NOT_FOUND",
            "CONTEST_NOT_ACTIVE",
            "CONTEST_NOT_STARTED",
            "CONTEST_FINISHED",
            "NO_CLUES_AVAILABLE",
            "CLUE_NOT_CURRENT",
            "CLUE_NOT_PUBLISHED",
            "CLUE_ALREADY_SOLVED",
        ]);
        if (clientErrors.has(error.message)) {
            const status = error.message ===
                "CONTEST_NOT_FOUND"
                ? 404
                : 409;
            return res.status(status).json({
                success: false,
                error: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
        });
    }
}
//# sourceMappingURL=contest.controller.js.map