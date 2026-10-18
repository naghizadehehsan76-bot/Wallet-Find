import prisma from "../../config/prisma.js";
import { hasCompleteClueSequence } from "./contest.logic.js";

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

function getOptions(text: string, answer: string): string[] {
  const candidates = [...new Set(
    getWordMatches(text)
      .map((match) => match.word)
      .filter((word) => word !== answer && !COMMON_WORDS.has(word)),
  )];

  if (candidates.length < 11) return [];

  return shuffle([answer, ...shuffle(candidates).slice(0, 11)]);
}

function buildRoundFromSource(
  source: SourceDocument,
  usedAnswers: ReadonlySet<string>,
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

    const options = getOptions(source.text, match.word);
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

async function fetchWikipediaDocuments(limit: number): Promise<SourceDocument[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "random");
  url.searchParams.set("grnnamespace", "0");
  url.searchParams.set("grnlimit", String(limit));
  url.searchParams.set("prop", "extracts|info");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("exchars", "9000");

  const response = await fetch(url, {
    headers: { "User-Agent": "WalletFind/1.0 (English word-round generator)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error("WIKIPEDIA_SOURCE_UNAVAILABLE");
  }

  const data = await response.json() as {
    query?: {
      pages?: Record<string, {
        title?: string;
        fullurl?: string;
        extract?: string;
      }>;
    };
  };

  return Object.values(data.query?.pages ?? {})
    .filter((page) => typeof page.extract === "string" && page.extract.length > 300)
    .map((page) => ({
      title: page.title ?? "Wikipedia article",
      url: page.fullurl
        ?? "https://en.wikipedia.org/wiki/" + encodeURIComponent((page.title ?? "").replace(/ /g, "_")),
      text: page.extract ?? "",
    }));
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

    if (!response.ok) return null;

    let text = await response.text();
    text = text
      .replace(/\r/g, "")
      .replace(/^[\s\S]*?\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i, "")
      .replace(/\n\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*$/i, "");

    if (text.length < 1000) return null;

    return { title: book.title, url: book.pageUrl, text };
  } catch {
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

  for (const source of sources) {
    if (rounds.length >= 12) break;
    if (usedUrls.has(source.url)) continue;

    const round = buildRoundFromSource(source, usedAnswers);
    if (!round) continue;

    rounds.push(round);
    usedAnswers.add(round.correctAnswer);
    usedUrls.add(source.url);
  }

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

  // Retire previous active records that don't follow the new round format.
  if (activeContests.length > 0) {
    await prisma.contest.updateMany({
      where: {
        id: { in: activeContests.map((contest) => contest.id) },
        status: "ACTIVE",
      },
      data: { status: "FINISHED" },
    });
  }

  const clues = await generateMvpRounds();
  const contest = await prisma.contest.create({
    data: {
      title: "مسابقه واژه‌یابی انگلیسی Wallet Find",
      description: "۱۲ راند واژه‌یابی؛ راهنما را بخوان، لینک منبع را باز کن و کلمه را از میان ۱۲ گزینه انتخاب کن.",
      status: "ACTIVE",
      startsAt: now,
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
        })),
      },
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      action: "MVP_CONTEST_AUTO_CREATED",
      entity: "Contest",
      entityId: contest.id,
      metadata: {
        clueCount: clues.length,
        sourceDomains: [...new Set(clues.map((clue) => new URL(clue.sourceUrl).hostname))],
        createdAt: now.toISOString(),
      },
    },
  });

  console.log("Created playable English word-finding contest:", contest.id);
  return contest.id;
}
