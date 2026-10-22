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

function getWordMatches(text: string): WordMatch[] {
  return Array.from(text.matchAll(/\b[A-Za-z]{4,12}\b/g)).map((match) => ({
    word: match[0].toLowerCase(),
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function getOptions(corpusText: string, answer: string): string[] {
  // Use the combined source corpus for distractors. Short articles often do
  // not contain 11 distinct suitable words, even when their clue is valid.
  const candidates = [...new Set(
    getWordMatches(corpusText)
      .map((match) => match.word)
      .filter((word) => word !== answer && !COMMON_WORDS.has(word)),
  )];

  if (candidates.length < 11) return [];

  return shuffle([answer, ...shuffle(candidates).slice(0, 11)]);
}

function buildRoundFromSource(
  source: SourceDocument,
  usedAnswers: ReadonlySet<string>,
  optionCorpus: string,
): GeneratedRound | null {
  const matches = getWordMatches(source.text);
  if (matches.length < 20) return null;

  const normalizedSource = source.text.replace(/\s+/g, " ").trim().toLowerCase();
  const candidateIndexes = shuffle(
    matches.map((_, index) => index).filter((index) => index >= 5),
  );

  for (const index of candidateIndexes) {
    const match = matches[index];
    if (!match) continue;
    if (COMMON_WORDS.has(match.word) || usedAnswers.has(match.word)) continue;
    if (match.raw[0] !== match.raw[0]?.toLowerCase()) continue;

    const options = getOptions(optionCorpus, match.word);
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
      content: "Find the English word immediately after the phrase shown in the hint.",
      correctAnswer: match.word,
      sourceUrl: source.url,
      hintAnchor: anchor,
      options,
    };
  }

  return null;
}

async function fetchWikipediaArticle(title: string): Promise<SourceDocument | null> {
  const apiUrl = new URL("https://en.wikipedia.org/w/api.php");
  apiUrl.searchParams.set("action", "query");
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("titles", title);
  apiUrl.searchParams.set("prop", "extracts|info");
  apiUrl.searchParams.set("inprop", "url");
  apiUrl.searchParams.set("explaintext", "1");
  apiUrl.searchParams.set("exchars", "9000");
  apiUrl.searchParams.set("redirects", "1");

  try {
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "WalletFind/1.0 (English word-round generator)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn("Wikipedia article request failed", { title, status: response.status });
      return null;
    }

    const data = await response.json() as {
      query?: {
        pages?: Record<string, { title?: string; fullurl?: string; extract?: string }>;
      };
      error?: { code?: string; info?: string };
    };
    if (data.error) {
      console.warn("Wikipedia article API error", { title, code: data.error.code, info: data.error.info });
      return null;
    }

    const page = Object.values(data.query?.pages ?? {}).find(
      (candidate) => typeof candidate.extract === "string" && candidate.extract.length > 300,
    );
    if (!page) return null;

    const pageTitle = page.title ?? title;
    return {
      title: pageTitle,
      url: page.fullurl
        ?? "https://en.wikipedia.org/wiki/" + encodeURIComponent(pageTitle.replace(/ /g, "_")),
      text: page.extract ?? "",
    };
  } catch (error) {
    console.warn("Wikipedia article request unavailable", {
      title,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchWikipediaDocuments(limit: number): Promise<SourceDocument[]> {
  const headers = { "User-Agent": "WalletFind/1.0 (English word-round generator)" };
  const documents: SourceDocument[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  const addDocuments = (items: SourceDocument[]) => {
    for (const item of items) {
      const normalizedUrl = item.url.split("#")[0] ?? item.url;
      const normalizedTitle = item.title.trim().toLowerCase();
      if (!item.text || item.text.length <= 300) continue;
      if (seenUrls.has(normalizedUrl) || seenTitles.has(normalizedTitle)) continue;
      seenUrls.add(normalizedUrl);
      seenTitles.add(normalizedTitle);
      documents.push(item);
    }
  };

  let randomTitles: string[] = [];
  try {
    const randomUrl = new URL("https://en.wikipedia.org/w/api.php");
    randomUrl.searchParams.set("action", "query");
    randomUrl.searchParams.set("format", "json");
    randomUrl.searchParams.set("list", "random");
    randomUrl.searchParams.set("rnnamespace", "0");
    randomUrl.searchParams.set("rnlimit", String(Math.min(limit, 50)));

    const randomResponse = await fetch(randomUrl, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!randomResponse.ok) {
      throw new Error("HTTP " + randomResponse.status);
    }

    const randomData = await randomResponse.json() as {
      query?: { random?: Array<{ title?: string }> };
      error?: { code?: string; info?: string };
    };
    if (randomData.error) {
      throw new Error(randomData.error.code + ": " + randomData.error.info);
    }
    randomTitles = [...new Set(
      (randomData.query?.random ?? [])
        .map((page) => page.title)
        .filter((title): title is string => Boolean(title)),
    )];
    console.info("Wikipedia random title response", {
      requestedCount: Math.min(limit, 50),
      receivedTitleCount: randomTitles.length,
    });

    if (randomTitles.length > 0) {
      const extractUrl = new URL("https://en.wikipedia.org/w/api.php");
      extractUrl.searchParams.set("action", "query");
      extractUrl.searchParams.set("format", "json");
      extractUrl.searchParams.set("titles", randomTitles.join("|"));
      extractUrl.searchParams.set("prop", "extracts|info");
      extractUrl.searchParams.set("inprop", "url");
      extractUrl.searchParams.set("explaintext", "1");
      extractUrl.searchParams.set("exchars", "9000");
      extractUrl.searchParams.set("redirects", "1");

      const extractResponse = await fetch(extractUrl, {
        headers,
        signal: AbortSignal.timeout(12_000),
      });
      if (!extractResponse.ok) {
        throw new Error("Wikipedia batch extract HTTP " + extractResponse.status);
      }

      const data = await extractResponse.json() as {
        query?: {
          pages?: Record<string, { title?: string; fullurl?: string; extract?: string }>;
        };
        error?: { code?: string; info?: string };
      };
      if (data.error) {
        throw new Error("Wikipedia batch extract " + data.error.code + ": " + data.error.info);
      }

      const pages = Object.values(data.query?.pages ?? {});
      const validDocuments = pages
        .filter((page) => typeof page.extract === "string" && page.extract.length > 300)
        .map((page) => {
          const title = page.title ?? "Wikipedia article";
          return {
            title,
            url: page.fullurl
              ?? "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
            text: page.extract ?? "",
          };
        });
      addDocuments(validDocuments);
      console.info("Wikipedia batch extract response", {
        requestedTitleCount: randomTitles.length,
        returnedPageCount: pages.length,
        validDocumentCount: validDocuments.length,
      });
    }
  } catch (error) {
    console.warn("Wikipedia random batch unavailable; trying known article pages", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // The random/batch endpoint has returned only one usable article in Render.
  // If it does so again, fetch known article pages individually. This still
  // derives every answer and hint from the exact text used to build that clue.
  const fallbackTitles = [
    "Albert Einstein", "Paris", "Solar System", "Mount Everest", "Amazon rainforest",
    "Computer", "Internet", "Moon", "Earth", "Sun", "Gravity", "Eiffel Tower",
    "Bitcoin", "Leonardo da Vinci", "World War II", "Himalayas", "Nile", "Ocean",
    "Mathematics", "History of science", "Human brain", "Electricity", "DNA",
    "Photosynthesis", "Volcano", "Antarctica", "Saturn", "Venus", "Apollo 11",
    "William Shakespeare", "Artificial intelligence", "Cell (biology)", "Evolution",
    "Water", "Light", "Sound", "Solar energy", "Telescope", "Space exploration",
    "Printing press", "Evolutionary biology", "United Nations", "World Wide Web",
    "Cryptocurrency", "Blockchain", "Mars", "Jupiter", "Titanic", "Pacific Ocean",
    "Ancient Egypt", "Roman Empire", "Renaissance", "Mona Lisa", "Pyramid",
    "Electricity generation", "Photography", "Computer network", "Language",
  ].filter((title) => !randomTitles.some((randomTitle) => randomTitle.toLowerCase() === title.toLowerCase()));

  for (let offset = 0; offset < fallbackTitles.length && documents.length < limit; offset += 5) {
    const titles = fallbackTitles.slice(offset, offset + 5);
    const results = await Promise.all(titles.map((title) => fetchWikipediaArticle(title)));
    addDocuments(results.filter((item): item is SourceDocument => item !== null));
    console.info("Wikipedia fallback batch response", {
      requestedCount: titles.length,
      usableDocumentCount: results.filter(Boolean).length,
      totalUsableDocuments: documents.length,
    });
  }

  return documents.slice(0, limit);
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

/**
 * Generate each round from live English-language source text.
 * Wikipedia provides current article text; Project Gutenberg supplies
 * public-domain book text from a second domain. Curated clues keep the MVP
 * playable if either external source is temporarily unavailable.
 */
async function generateMvpRounds(): Promise<GeneratedRound[]> {
  const [wikipediaDocuments, gutenbergResults] = await Promise.all([
    fetchWikipediaDocuments(40).catch((error: unknown) => {
      console.warn("Wikipedia word source unavailable; using fallback material.", error);
      return [] as SourceDocument[];
    }),
    Promise.all(GUTENBERG_BOOKS.map((book) => fetchGutenbergDocument(book))),
  ]);

  const sources = [
    ...gutenbergResults.filter((source): source is SourceDocument => source !== null),
    ...wikipediaDocuments,
  ];
  const rounds: GeneratedRound[] = [];
  const usedAnswers = new Set<string>();
  const usedUrls = new Set<string>();
  const optionCorpus = sources.map((source) => source.text).join("\n");

  for (const source of sources) {
    if (rounds.length >= 12) break;
    if (usedUrls.has(source.url)) continue;

    const round = buildRoundFromSource(source, usedAnswers, optionCorpus);
    if (!round) {
      console.info("Skipped source: no valid unique clue could be generated", {
        title: source.title,
        url: source.url,
        textLength: source.text.length,
      });
      continue;
    }

    rounds.push(round);
    usedAnswers.add(round.correctAnswer);
    usedUrls.add(source.url);
  }

  console.info("MVP clue generation summary", {
    sourceCount: sources.length,
    wikipediaSourceCount: wikipediaDocuments.length,
    gutenbergSourceCount: gutenbergResults.filter(Boolean).length,
    generatedRoundCount: rounds.length,
    uniqueAnswerCount: usedAnswers.size,
  });

  // Never fill missing rounds with static clues: their source pages can change,
  // making the saved answer disagree with the word after the displayed anchor.
  // Every published clue must be generated from the exact source text it links to.
  if (rounds.length < 12) {
    throw new Error("MVP_ROUND_GENERATION_FAILED");
  }

  return rounds.slice(0, 12);
}

/**
 * Keep a playable MVP contest available without requiring an admin to seed it.
 * Safe to call on every server start: a contest is reused only when all twelve
 * rounds have a source URL, a hint anchor, and twelve word choices.
 */
export async function ensureMvpActiveContest() {
  const activeContests = await prisma.contest.findMany({
    where: { status: "ACTIVE" },
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
  const playableContest = activeContests.find((contest) =>
    hasCompleteClueSequence(contest.clues.map((clue) => clue.sequence)) &&
    contest.clues.every((clue) =>
      Boolean(clue.sourceUrl) &&
      typeof clue.hintAnchor === "string" &&
      clue.hintAnchor.trim().length >= 25 &&
      Array.isArray(clue.options) &&
      clue.options.length === 12
    ) &&
    (!contest.startsAt || contest.startsAt <= now) &&
    (!contest.endsAt || contest.endsAt > now),
  );

  if (playableContest) {
    console.log("MVP contest ready:", playableContest.id);
    return playableContest.id;
  }

  // Generate and validate all rounds before changing the current contest.
  // If an external source fails, the existing contest remains active.
  const clues = await generateMvpRounds();
  // New rounds begin only on fixed 15-minute boundaries.
  const ROUND_INTERVAL_MS = 15 * 60_000;
  const startsAt = new Date(Math.ceil(Date.now() / ROUND_INTERVAL_MS) * ROUND_INTERVAL_MS);
  const endsAt = new Date(startsAt.getTime() + CONTEST_DURATION_MS);
  const status = startsAt.getTime() <= Date.now() ? "ACTIVE" : "SCHEDULED";
  const contest = await prisma.contest.create({
    data: {
      title: "مسابقه واژه‌یابی انگلیسی Wallet Find",
      description: "۱۲ راند واژه‌یابی؛ راهنما را بخوان، لینک منبع را باز کن و کلمه را از میان ۱۲ گزینه انتخاب کن.",
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
  const existingScheduled = await prisma.contest.findFirst({
    where: { status: "SCHEDULED", startsAt: { gt: now } },
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
    where: { status: "ACTIVE" },
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
  const clues = await generateMvpRounds();

  try {
    const nextContest = await prisma.$transaction(async (tx) => {
      const activeContests = await tx.contest.findMany({
        where: { status: "ACTIVE" },
        select: activeSelect,
      });

      const scheduledCreatedByAnotherRequest = await tx.contest.findFirst({
        where: { status: "SCHEDULED", startsAt: { gt: new Date() } },
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


let lastAutomaticRoundAttemptAt = 0;
const AUTOMATIC_ROUND_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Keep one future shared round queued even when nobody has completed the
 * current round yet. The generated round starts on a fixed 15-minute boundary.
 */
export async function ensureScheduledMvpContest(now = new Date()) {
  const existingScheduled = await prisma.contest.findFirst({
    where: { status: "SCHEDULED", startsAt: { gt: now } },
    select: { id: true },
  });
  if (existingScheduled) return { scheduled: true, contestId: existingScheduled.id };

  if (now.getTime() - lastAutomaticRoundAttemptAt < AUTOMATIC_ROUND_RETRY_DELAY_MS) {
    return { scheduled: false, reason: "GENERATION_COOLDOWN" };
  }
  lastAutomaticRoundAttemptAt = now.getTime();

  const previous = await prisma.contest.findFirst({
    where: { status: { in: ["ACTIVE", "FINISHED"] }, startsAt: { not: null } },
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
        where: { status: "SCHEDULED", startsAt: { gt: now } },
        select: { id: true },
      });
      if (raceWinner) return raceWinner;

      const round = await tx.contest.create({
        data: {
          title: "مسابقه واژه‌یابی انگلیسی Wallet Find",
          description: "۱۲ راند واژه‌یابی؛ راهنما را بخوان و کلمه را از منبع پیدا کن.",
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
