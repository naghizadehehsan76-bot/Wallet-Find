import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS, hasCompleteClueSequence } from "./contest.logic.js";

type SourceDocument = {
  title: string;
  url: string;
  text: string;
};

type GeneratedRound = {
  content: string;
  correctAnswer: string;
  sourceUrl: string;
  hintAnchor: string;
  options: string[];
};

type WordMatch = {
  word: string;
  raw: string;
  index: number;
};

const COMMON_WORDS = new Set([
  "about", "above", "after", "again", "against", "almost", "along", "already",
  "also", "although", "always", "among", "another", "around", "because",
  "before", "being", "below", "between", "both", "could", "during", "each",
  "early", "every", "first", "found", "from", "have", "having", "into",
  "itself", "later", "least", "less", "many", "might", "more", "most",
  "never", "other", "often", "once", "only", "over", "same", "since",
  "some", "such", "than", "that", "their", "there", "these", "they",
  "thing", "those", "through", "under", "until", "upon", "using", "very",
  "were", "what", "when", "where", "which", "while", "whose", "will",
  "with", "within", "without", "would", "your", "been", "does", "doing",
  "make", "made", "like", "just", "well", "then", "them", "this", "much",
  "back", "even", "still", "take", "time", "years", "year", "part", "parts",
  "chapter", "volume", "project", "gutenberg", "ebook", "copyright",
]);

const GUTENBERG_BOOKS = [
  {
    title: "Alice's Adventures in Wonderland",
    textUrl: "https://www.gutenberg.org/cache/epub/11/pg11.txt",
    pageUrl: "https://www.gutenberg.org/cache/epub/11/pg11-images.html",
  },
  {
    title: "Pride and Prejudice",
    textUrl: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt",
    pageUrl: "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html",
  },
  {
    title: "Frankenstein",
    textUrl: "https://www.gutenberg.org/cache/epub/84/pg84.txt",
    pageUrl: "https://www.gutenberg.org/cache/epub/84/pg84-images.html",
  },
  {
    title: "The Adventures of Sherlock Holmes",
    textUrl: "https://www.gutenberg.org/cache/epub/1661/pg1661.txt",
    pageUrl: "https://www.gutenberg.org/cache/epub/1661/pg1661-images.html",
  },
];

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    const other = result[otherIndex];
    if (current === undefined || other === undefined) continue;
    result[index] = other;
    result[otherIndex] = current;
  }
  return result;
}

function getWordMatches(text: string, language: "en" | "fa" = "en"): WordMatch[] {
  return Array.from(text.matchAll(language === "fa" ? /[\u0600-\u06FF\u0750-\u077F]{3,16}/g : /\b[A-Za-z]{4,12}\b/g)).map((match) => ({
    word: match[0].toLowerCase(),
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function getOptions(corpusWords: readonly string[], answer: string): string[] {
  // The combined corpus is tokenized once per generation, not once per
  // candidate answer. This avoids repeatedly scanning several full books.
  const candidates = corpusWords.filter((word) => word !== answer);
  if (candidates.length < 11) return [];

  return shuffle([answer, ...shuffle(candidates).slice(0, 11)]);
}

async function fetchWikipediaDocuments(limit: number, language: "en" | "fa" = "en"): Promise<SourceDocument[]> {
  // Use at most two API requests (random titles + one batch extract). Never
  // fan out into individual article requests when Wikipedia rate-limits us.
  const wikiDomain = language === "fa" ? "fa.wikipedia.org" : "en.wikipedia.org";
  const apiUrl = new URL(`https://${wikiDomain}/w/api.php`);
  apiUrl.searchParams.set("action", "query");
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("list", "random");
  apiUrl.searchParams.set("rnnamespace", "0");
  apiUrl.searchParams.set("rnlimit", String(Math.min(limit, 12)));
  const headers = { "User-Agent": `WalletFind/1.0 (${language === "fa" ? "Persian" : "English"} word-round generator)` };

  try {
    const randomResponse = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!randomResponse.ok) {
      console.warn("Wikipedia random-page request skipped", { status: randomResponse.status });
      return [];
    }

    const randomData = await randomResponse.json() as {
      query?: { random?: Array<{ title?: string }> };
      error?: { code?: string; info?: string };
    };
    if (randomData.error) {
      console.warn("Wikipedia random-page API error", randomData.error);
      return [];
    }

    const titles = [...new Set(
      (randomData.query?.random ?? [])
        .map((page) => page.title)
        .filter((title): title is string => Boolean(title)),
    )];
    if (titles.length === 0) return [];

    const extractUrl = new URL(`https://${wikiDomain}/w/api.php`);
    extractUrl.searchParams.set("action", "query");
    extractUrl.searchParams.set("format", "json");
    extractUrl.searchParams.set("titles", titles.join("|"));
    extractUrl.searchParams.set("prop", "extracts|info");
    extractUrl.searchParams.set("inprop", "url");
    extractUrl.searchParams.set("explaintext", "1");
    extractUrl.searchParams.set("exchars", "9000");
    extractUrl.searchParams.set("redirects", "1");

    const extractResponse = await fetch(extractUrl, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!extractResponse.ok) {
      console.warn("Wikipedia batch extract skipped", { status: extractResponse.status });
      return [];
    }

    const data = await extractResponse.json() as {
      query?: { pages?: Record<string, { title?: string; fullurl?: string; extract?: string }> };
      error?: { code?: string; info?: string };
    };
    if (data.error) {
      console.warn("Wikipedia batch extract API error", data.error);
      return [];
    }

    return Object.values(data.query?.pages ?? {})
      .filter((page) => typeof page.extract === "string" && page.extract.length > 300)
      .map((page) => {
        const title = page.title ?? "Wikipedia article";
        return {
          title,
          url: page.fullurl
            ?? `https://${wikiDomain}/wiki/` + encodeURIComponent(title.replace(/ /g, "_")),
          text: page.extract ?? "",
        };
      });
  } catch (error) {
    console.warn("Wikipedia source unavailable; continuing with public-domain books.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// Source texts can contain hundreds of thousands of characters. Cache tokenization
// and normalization across attempts so the round generator does not repeatedly
// perform expensive synchronous work on the event loop while Render is checking
// the /health endpoint during startup.
const sourceAnalysisCache = new WeakMap<SourceDocument, {
  matches: WordMatch[];
  normalizedSource: string;
}>();

function buildRoundFromSource(
  source: SourceDocument,
  usedAnswers: ReadonlySet<string>,
  optionWords: readonly string[],
  language: "en" | "fa" = "en",
): GeneratedRound | null {
  let analysis = sourceAnalysisCache.get(source);
  if (!analysis) {
    analysis = {
      matches: getWordMatches(source.text, language),
      normalizedSource: source.text.replace(/\s+/g, " ").trim().toLowerCase(),
    };
    sourceAnalysisCache.set(source, analysis);
  }
  const { matches, normalizedSource } = analysis;
  if (matches.length < 20) return null;
  const candidateIndexes = shuffle(
    matches.map((_, index) => index).filter((index) => index >= 5),
  );

  for (const index of candidateIndexes) {
    const match = matches[index];
    if (!match) continue;
    if ((language === "en" && COMMON_WORDS.has(match.word)) || usedAnswers.has(match.word)) continue;
    if (language === "en" && match.raw[0] !== match.raw[0]?.toLowerCase()) continue;

    const options = getOptions(optionWords, match.word);
    if (options.length !== 12) continue;

    // Expand the exact phrase until it occurs only once in the source text.
    let anchor = "";
    for (let wordsBefore = 5; wordsBefore <= 10; wordsBefore += 1) {
      const firstWord = matches[index - wordsBefore];
      if (!firstWord) continue;

      const rawAnchor = source.text.slice(firstWord.index, match.index);
      if (/\n\s*\n/.test(rawAnchor) || /[.!?][)"'\]]*\s/.test(rawAnchor)) {
        continue;
      }

      const candidateAnchor = rawAnchor.replace(/\s+/g, " ").trim();
      if (!candidateAnchor || candidateAnchor.length < 25 || candidateAnchor.length > 160) continue;

      const searchableAnchor = candidateAnchor.toLowerCase();
      const firstOccurrence = normalizedSource.indexOf(searchableAnchor);
      if (firstOccurrence < 0) continue;
      if (normalizedSource.indexOf(searchableAnchor, firstOccurrence + 1) !== -1) {
        continue;
      }

      anchor = candidateAnchor;
      break;
    }

    if (!anchor) continue;

    return {
      content: language === "fa" ? "واژهٔ فارسیِ بلافاصله پس از عبارت نمایش‌داده‌شده در سرنخ را پیدا کن." : "Find the English word immediately after the phrase shown in the hint.",
      correctAnswer: match.word,
      sourceUrl: source.url,
      hintAnchor: anchor,
      options,
    };
  }

  return null;
}

async function fetchGutenbergDocument(book: {
  title: string;
  textUrl: string;
  pageUrl: string;
}): Promise<SourceDocument | null> {
  try {
    const response = await fetch(book.textUrl, {
      headers: { "User-Agent": "WalletFind/1.0 (English word-round generator)" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn("Project Gutenberg source returned a non-success status", {
        title: book.title,
        status: response.status,
      });
      return null;
    }

    let text = await response.text();
    text = text
      .replace(/\r/g, "")
      .replace(/^[\s\S]*?\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i, "")
      .replace(/\n\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*$/i, "");

    if (text.length < 1000) {
      console.warn("Project Gutenberg source text was too short", {
        title: book.title,
        textLength: text.length,
      });
      return null;
    }

    return { title: book.title, url: book.pageUrl, text };
  } catch (error) {
    console.warn("Project Gutenberg source unavailable", {
      title: book.title,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchConfiguredWebDocument(url: string): Promise<SourceDocument | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const response = await fetch(parsed, { headers: { "User-Agent": "WalletFind/1.0 (public webpage clue generator)" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    let text = await response.text();
    if (contentType.includes("html") || /<html|<body|<p[ >]/i.test(text.slice(0, 2000))) {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ");
    }
    return text.length >= 500 ? { title: parsed.hostname, url: parsed.toString(), text } : null;
  } catch (error) {
    console.warn("Configured clue source unavailable", { url, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function getConfiguredSourceUrls(language: "en" | "fa"): Promise<string[]> {
  const defaults = language === "fa" ? ["https://fa.wikipedia.org/w/api.php"] : [
    "https://en.wikipedia.org/w/api.php", ...GUTENBERG_BOOKS.map((book) => book.textUrl),
  ];
  const setting = await prisma.systemSetting.findUnique({ where: { key: `clue_sources_${language}` }, select: { value: true } });
  if (!setting) return defaults;
  try {
    const parsed: unknown = JSON.parse(setting.value);
    if (!Array.isArray(parsed)) return defaults;
    return [...new Set(parsed.filter((url): url is string => typeof url === "string")
      .map((url) => url.trim()).filter((url) => url.startsWith("https://") && url.length <= 500))];
  } catch { return defaults; }
}

/**
 * Generate each round from live English-language source text.
 * Wikipedia provides current article text; Project Gutenberg supplies
 * public-domain book text from a second domain. Curated clues keep the MVP
 * playable if either external source is temporarily unavailable.
 */
async function generateMvpRounds(language: "en" | "fa" = "en"): Promise<GeneratedRound[]> {
  const configuredUrls = await getConfiguredSourceUrls(language);
  const wikiUrl = `https://${language === "fa" ? "fa" : "en"}.wikipedia.org/w/api.php`;
  const wikipediaDocuments = configuredUrls.includes(wikiUrl) ? await fetchWikipediaDocuments(12, language) : [];
  const gutenbergResults = language === "en" ? await Promise.all(
    GUTENBERG_BOOKS.filter((book) => configuredUrls.includes(book.textUrl)).map((book) => fetchGutenbergDocument(book)),
  ) : [];
  const knownUrls = new Set([wikiUrl, ...GUTENBERG_BOOKS.map((book) => book.textUrl)]);
  const customDocuments = await Promise.all(configuredUrls.filter((url) => !knownUrls.has(url)).map(fetchConfiguredWebDocument));
  const sources = [
    ...gutenbergResults.filter((source): source is SourceDocument => source !== null),
    ...wikipediaDocuments,
    ...customDocuments.filter((source): source is SourceDocument => source !== null),
  ];
  const rounds: GeneratedRound[] = [];
  const usedAnswers = new Set<string>();
  const optionCorpus = sources.map((source) => source.text).join("\n");
  const optionWords = [...new Set(getWordMatches(optionCorpus, language)
    .map((match) => match.word).filter((word) => language === "fa" || !COMMON_WORDS.has(word)))];

  for (const source of shuffle(sources)) {
    let attempts = 0;
    let sourceRoundCount = 0;
    while (rounds.length < 12 && sourceRoundCount < 3 && attempts < 40) {
      attempts += 1;
      const round = buildRoundFromSource(source, usedAnswers, optionWords, language);
      if (!round) continue;
      rounds.push(round);
      usedAnswers.add(round.correctAnswer);
      sourceRoundCount += 1;
    }
  }
  for (const source of shuffle(sources)) {
    let attempts = 0;
    while (rounds.length < 12 && attempts < 40) {
      attempts += 1;
      const round = buildRoundFromSource(source, usedAnswers, optionWords, language);
      if (!round) continue;
      rounds.push(round);
      usedAnswers.add(round.correctAnswer);
    }
  }
  console.info("MVP clue generation summary", {
    language, configuredSourceCount: configuredUrls.length, sourceCount: sources.length,
    wikipediaSourceCount: wikipediaDocuments.length,
    gutenbergSourceCount: gutenbergResults.filter((source) => source !== null).length,
    customSourceCount: customDocuments.filter((source) => source !== null).length,
    generatedRoundCount: rounds.length, uniqueAnswerCount: usedAnswers.size,
  });
  if (rounds.length < 12) throw new Error("MVP_ROUND_GENERATION_FAILED");
  return shuffle(rounds).slice(0, 12);
}

/**
 * Keep a playable MVP contest available without requiring an admin to seed it.
 * Safe to call on every server start: a contest is reused only when all twelve
 * rounds have a source URL, a hint anchor, and twelve word choices.
 */
async function ensureMvpActiveContestInternal(language: "en" | "fa" = "en") {
  const activeContests = await prisma.contest.findMany({
    where: { status: "ACTIVE", language },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      clues: {
        select: {
          sequence: true,
          sourceUrl: true,
          hintAnchor: true,
          options: true,
        },
      },
    },
  });

  const now = new Date();

  const isPlayable = (contest: {
    startsAt: Date | null;
    endsAt: Date | null;
    clues: Array<{ sequence: number; sourceUrl: string | null; hintAnchor: string | null; options: unknown }>;
  }) =>
    hasCompleteClueSequence(contest.clues.map((clue) => clue.sequence)) &&
    contest.clues.every((clue) =>
      Boolean(clue.sourceUrl) &&
      typeof clue.hintAnchor === "string" &&
      clue.hintAnchor.trim().length >= 25 &&
      Array.isArray(clue.options) &&
      clue.options.length === 12
    );

  // Always prefer the currently playable round over a future scheduled round.
  // Otherwise a late joiner can be sent to the next round and see every clue locked.
  const playableContest = activeContests.find((contest) =>
    isPlayable(contest) &&
    (!contest.startsAt || contest.startsAt <= now) &&
    (!contest.endsAt || contest.endsAt > now),
  );
  if (playableContest) {
    console.log("MVP contest ready:", playableContest.id);
    return playableContest.id;
  }

  // Keep any future round queued, but do not return it as the current round.
  // If there is no active round, create one for the current 15-minute window.
  // Generate and validate all rounds before changing the current contest.
  // If an external source fails, the existing contest remains active.
  const clues = await generateMvpRounds(language);
  // Restore the missing current round at the most recent fixed boundary.
  // A future scheduled round, if present, remains queued for the next boundary.
  const ROUND_INTERVAL_MS = 15 * 60_000;
  const recoveryNow = Date.now();
  const startsAt = new Date(Math.floor(recoveryNow / ROUND_INTERVAL_MS) * ROUND_INTERVAL_MS);
  const endsAt = new Date(startsAt.getTime() + CONTEST_DURATION_MS);
  const status = "ACTIVE";
  const contest = await prisma.contest.create({
    data: {
      title: language === "fa" ? "چالش واژه‌یابی فارسی Wallet Find" : "Wallet Find English Word Challenge",
      description: language === "fa" ? "۱۲ سرنخ واژه‌یابی از منابع فارسی." : "12 word clues from English-language sources.",
      language,
      status,
      startsAt,
      endsAt,
      clues: {
        create: clues.map((clue, index) => ({
          sequence: index + 1,
          type: "WEB_PAGE",
          source: "SYSTEM",
          content: clue.content,
          correctAnswer: clue.correctAnswer,
          sourceUrl: clue.sourceUrl,
          hintAnchor: clue.hintAnchor,
          options: clue.options,
          publishedAt: startsAt,
        })),
      },
    },
    select: { id: true },
  });

  // Retire previous active records only after the replacement contest exists.
  const previousActiveIds = activeContests
    .filter((activeContest) => {
      const effectiveEnd = activeContest.endsAt ??
        (activeContest.startsAt ? new Date(activeContest.startsAt.getTime() + CONTEST_DURATION_MS) : null);
      return effectiveEnd !== null && effectiveEnd.getTime() <= Date.now();
    })
    .map((activeContest) => activeContest.id);
  if (previousActiveIds.length > 0) {
    await prisma.contest.updateMany({
      where: { id: { in: previousActiveIds }, status: "ACTIVE" },
      data: { status: "FINISHED" },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "MVP_CONTEST_AUTO_CREATED",
      entity: "Contest",
      entityId: contest.id,
      metadata: {
        clueCount: clues.length,
        sourceDomains: [...new Set(clues.map((clue) => new URL(clue.sourceUrl).hostname))],
        createdAt: startsAt.toISOString(),
      },
    },
  });

  console.log("Created playable English word-finding contest:", contest.id);
  return contest.id;
}


// Share initialization between server startup and any early request that
// arrives before the first round is ready. This prevents duplicate source
// downloads and duplicate contest creation during cold start.
const activeContestEnsurePromises = new Map<"en" | "fa", Promise<string>>();

export function ensureMvpActiveContest(language: "en" | "fa" = "en"): Promise<string> {
  const existing = activeContestEnsurePromises.get(language);
  if (existing) return existing;
  const pending = ensureMvpActiveContestInternal(language).finally(() => activeContestEnsurePromises.delete(language));
  activeContestEnsurePromises.set(language, pending);
  return pending;
}


type ActiveContestForNext = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  clues: Array<{
    sequence: number;
    sourceUrl: string | null;
    hintAnchor: string | null;
    options: unknown;
  }>;
};

function isPlayableActiveContest(contest: ActiveContestForNext, now: Date): boolean {
  return (
    hasCompleteClueSequence(contest.clues.map((clue) => clue.sequence)) &&
    contest.clues.every((clue) =>
      Boolean(clue.sourceUrl) &&
      typeof clue.hintAnchor === "string" &&
      clue.hintAnchor.trim().length >= 25 &&
      Array.isArray(clue.options) &&
      clue.options.length === 12
    ) &&
    (!contest.startsAt || contest.startsAt <= now) &&
    (!contest.endsAt || contest.endsAt > now)
  );
}

function publicContest(contest: ActiveContestForNext) {
  return {
    id: contest.id,
    title: contest.title,
    description: contest.description,
    status: contest.status,
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
  };
}

/**
 * Prepare the next shared round after a user completes all 12 clues. It starts
 * on the next fixed 15-minute boundary and does not interrupt the current round.
 */
export async function startNextMvpContest(userId: string, completedContestId: string) {
  const completedContest = await prisma.contest.findUnique({
    where: { id: completedContestId },
    select: {
      id: true,
      language: true,
      startsAt: true,
      clues: {
        select: {
          sequence: true,
          submissions: {
            where: { userId, isCorrect: true },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!completedContest) {
    throw new Error("CONTEST_NOT_FOUND");
  }

  const solvedSequences = completedContest.clues
    .filter((clue) => clue.submissions.length > 0)
    .map((clue) => clue.sequence);

  if (!hasCompleteClueSequence(solvedSequences)) {
    throw new Error("CONTEST_NOT_COMPLETED_BY_USER");
  }

  const now = new Date();
  const language = completedContest.language === "fa" ? "fa" : "en";
  const existingScheduled = await prisma.contest.findFirst({
    where: { status: "SCHEDULED", language, startsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      clues: { select: { sequence: true, sourceUrl: true, hintAnchor: true, options: true } },
    },
  });
  if (existingScheduled) return publicContest(existingScheduled);

  const activeSelect = {
    id: true,
    title: true,
    description: true,
    status: true,
    startsAt: true,
    endsAt: true,
    clues: {
      select: {
        sequence: true,
        sourceUrl: true,
        hintAnchor: true,
        options: true,
      },
    },
  } as const;

  const existingActive = await prisma.contest.findMany({
    where: { status: "ACTIVE", language },
    select: activeSelect,
  });

  const existingNext = existingActive.find((contest) =>
    contest.id !== completedContestId && isPlayableActiveContest(contest, now)
  );

  if (existingNext) {
    return publicContest(existingNext);
  }

  // Generate and validate the complete next contest before retiring the old
  // one. If an external source is unavailable, the finished contest remains
  // available and the caller receives a clear error instead of a broken round.
  const clues = await generateMvpRounds(language);

  try {
    const nextContest = await prisma.$transaction(async (tx) => {
      const activeContests = await tx.contest.findMany({
        where: { status: "ACTIVE", language },
        select: activeSelect,
      });

      const scheduledCreatedByAnotherRequest = await tx.contest.findFirst({
        where: { status: "SCHEDULED", language, startsAt: { gt: new Date() } },
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
        select: activeSelect,
      });
      if (scheduledCreatedByAnotherRequest) {
        return publicContest(scheduledCreatedByAnotherRequest);
      }

      const contestCreatedByAnotherRequest = activeContests.find((contest) =>
        contest.id !== completedContestId && isPlayableActiveContest(contest, new Date())
      );

      if (contestCreatedByAnotherRequest) {
        return publicContest(contestCreatedByAnotherRequest);
      }

      const ROUND_INTERVAL_MS = 15 * 60_000;
      const nextFixedBoundary = Math.ceil(Date.now() / ROUND_INTERVAL_MS) * ROUND_INTERVAL_MS;
      const previousRoundBoundary = completedContest.startsAt
        ? completedContest.startsAt.getTime() + ROUND_INTERVAL_MS
        : 0;
      const startsAt = new Date(Math.max(nextFixedBoundary, previousRoundBoundary));
      const endsAt = new Date(startsAt.getTime() + CONTEST_DURATION_MS);

      const created = await tx.contest.create({
        data: {
          title: "مسابقه واژه‌یابی انگلیسی Wallet Find",
          description: "۱۲ راند واژه‌یابی؛ راهنما را بخوان، لینک منبع را باز کن و کلمه را از میان ۱۲ گزینه انتخاب کن.",
          status: "SCHEDULED",
          startsAt,
          endsAt,
          clues: {
            create: clues.map((clue, index) => ({
              sequence: index + 1,
              type: "WEB_PAGE",
              source: "SYSTEM",
              content: clue.content,
              correctAnswer: clue.correctAnswer,
              sourceUrl: clue.sourceUrl,
              hintAnchor: clue.hintAnchor,
              options: clue.options,
              publishedAt: startsAt,
            })),
          },
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "MVP_NEXT_CONTEST_CREATED",
          entity: "Contest",
          entityId: created.id,
          metadata: {
            previousContestId: completedContestId,
            clueCount: clues.length,
            sourceDomains: [...new Set(clues.map((clue) => new URL(clue.sourceUrl).hostname))],
            createdAt: now.toISOString(),
            scheduledStartAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
        },
      });

      return created;
    }, { isolationLevel: "Serializable" });

    return nextContest;
  } catch (error) {
    // If two completed users press the button at nearly the same time, return
    // the replacement created by the winning transaction rather than making
    // the second click fail or creating multiple active contests.
    const activeAfterError = await prisma.contest.findMany({
      where: { status: "ACTIVE" },
      select: activeSelect,
    });
    const nextAfterError = activeAfterError.find((contest) =>
      contest.id !== completedContestId && isPlayableActiveContest(contest, new Date())
    );
    if (nextAfterError) {
      return publicContest(nextAfterError);
    }
    throw error;
  }
}


const lastAutomaticRoundAttemptAt = new Map<"en" | "fa", number>();
const AUTOMATIC_ROUND_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Keep one future shared round queued even when nobody has completed the
 * current round yet. The generated round starts on a fixed 15-minute boundary.
 */
export async function ensureScheduledMvpContest(now = new Date(), language: "en" | "fa" = "en") {
  const existingScheduled = await prisma.contest.findFirst({
    where: { status: "SCHEDULED", language, startsAt: { gt: now } },
    select: { id: true },
  });
  if (existingScheduled) return { scheduled: true, contestId: existingScheduled.id };

  if (now.getTime() - (lastAutomaticRoundAttemptAt.get(language) ?? 0) < AUTOMATIC_ROUND_RETRY_DELAY_MS) {
    return { scheduled: false, reason: "GENERATION_COOLDOWN" };
  }
  lastAutomaticRoundAttemptAt.set(language, now.getTime());

  const previous = await prisma.contest.findFirst({
    where: { status: { in: ["ACTIVE", "FINISHED"] }, language, startsAt: { not: null } },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, startsAt: true },
  });

  // Bootstrap the very first shared round as well. Previously the scheduler
  // required a prior ACTIVE/FINISHED round, so a fresh/empty database could
  // never create its first contest and /contests/active returned 404 forever.
  try {
    const clues = await generateMvpRounds();
    const intervalMs = 15 * 60_000;
    const nextBoundary = Math.ceil(now.getTime() / intervalMs) * intervalMs;
    const previousBoundary = previous?.startsAt
      ? previous.startsAt.getTime() + intervalMs
      : nextBoundary;
    const startsAt = new Date(Math.max(nextBoundary, previousBoundary));
    const endsAt = new Date(startsAt.getTime() + CONTEST_DURATION_MS);

    const created = await prisma.$transaction(async (tx) => {
      const raceWinner = await tx.contest.findFirst({
        where: { status: "SCHEDULED", language, startsAt: { gt: now } },
        select: { id: true },
      });
      if (raceWinner) return raceWinner;

      const round = await tx.contest.create({
        data: {
          title: language === "fa" ? "چالش واژه‌یابی فارسی Wallet Find" : "Wallet Find English Word Challenge",
          description: language === "fa" ? "۱۲ سرنخ واژه‌یابی از منابع فارسی." : "12 word clues from English-language sources.",
          language,
          status: "SCHEDULED",
          startsAt,
          endsAt,
          clues: {
            create: clues.map((clue, index) => ({
              sequence: index + 1,
              type: "WEB_PAGE",
              source: "SYSTEM",
              content: clue.content,
              correctAnswer: clue.correctAnswer,
              sourceUrl: clue.sourceUrl,
              hintAnchor: clue.hintAnchor,
              options: clue.options,
              publishedAt: startsAt,
            })),
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          action: previous ? "MVP_ROUND_AUTO_SCHEDULED" : "MVP_FIRST_ROUND_AUTO_CREATED",
          entity: "Contest",
          entityId: round.id,
          metadata: {
            ...(previous ? { sourceRoundId: previous.id } : { bootstrap: true }),
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            clueCount: clues.length,
          },
        },
      });
      return round;
    }, { isolationLevel: "Serializable" });

    return { scheduled: true, contestId: created.id };
  } catch (error) {
    console.warn("Could not automatically schedule the MVP round; will retry after cooldown.", error);
    return { scheduled: false, reason: "GENERATION_FAILED" };
  }
}
