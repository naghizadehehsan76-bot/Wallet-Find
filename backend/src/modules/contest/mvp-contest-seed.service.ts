import prisma from "../../config/prisma.js";
import { CONTEST_DURATION_MS, hasCompleteClueSequence } from "./contest.logic.js";
import { CHALLENGE_INTERVAL_MS, getChallengeNumberAt, getChallengeScheduleAnchor } from "./challenge-schedule.js";
import {
  CLUE_GENERATOR_VERSION,
  extractVisibleTextFromHtml,
  findUniqueAnchorBeforeTarget,
  isSearchableClueAnchor,
  sourceUrlMatchesAssignment,
  generatedClueInstruction,
  getSourceWordMatches,
  normalizeSourceText,
  type SourceWordMatch,
} from "./clue-source-text.js";

type SourceDocument = {
  title: string;
  url: string;
  text: string;
};

function pinWikipediaRevision(url: string, revisionId?: number): string {
  if (!revisionId || !Number.isInteger(revisionId) || revisionId < 1) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "fa.wikipedia.org" && parsed.hostname !== "en.wikipedia.org") return url;
    parsed.searchParams.set("oldid", String(revisionId));
    return parsed.toString();
  } catch {
    return url;
  }
}

type GeneratedRound = {
  content: string;
  correctAnswer: string;
  sourceUrl: string;
  hintAnchor: string;
  options: string[];
};

type ScheduledSourceAssignment = {
  id: string;
  language: "en" | "fa";
  url: string;
  challengeNumber: number;
  startsAt: string;
  sequence: number;
};

type RoundGenerationContext = {
  challengeNumber: number;
  startsAt: Date;
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

function getOptions(corpusWords: readonly string[], answer: string): string[] {
  // The combined corpus is tokenized once per generation, not once per
  // candidate answer. This avoids repeatedly scanning several full books.
  const candidates = corpusWords.filter((word) => word !== answer);
  if (candidates.length < 11) return [];

  return shuffle([answer, ...shuffle(candidates).slice(0, 11)]);
}

type StoredGeneratedClue = {
  sequence: number;
  content: string;
  sourceUrl: string | null;
  hintAnchor: string | null;
  options: unknown;
};

function hasCurrentGeneratedClues(clues: readonly StoredGeneratedClue[]): boolean {
  return (
    hasCompleteClueSequence(clues.map((clue) => clue.sequence)) &&
    clues.every((clue) =>
      clue.content.startsWith(CLUE_GENERATOR_VERSION) &&
      Boolean(clue.sourceUrl) &&
      typeof clue.hintAnchor === "string" &&
      isSearchableClueAnchor(clue.hintAnchor) &&
      Array.isArray(clue.options) &&
      clue.options.length === 12
    )
  );
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
      query?: { pages?: Record<string, { title?: string; fullurl?: string; extract?: string; lastrevid?: number }> };
      error?: { code?: string; info?: string };
    };
    if (data.error) {
      console.warn("Wikipedia batch extract API error", data.error);
      return [];
    }

    return Object.values(data.query?.pages ?? {})
      // The link is pinned to the same revision that supplied the extracted
      // text. If MediaWiki omitted a revision id, skip the page instead of
      // publishing a link whose contents can drift after generation.
      .filter((page) =>
        typeof page.extract === "string" &&
        page.extract.length > 300 &&
        Number.isSafeInteger(page.lastrevid) &&
        Number(page.lastrevid) > 0
      )
      .map((page) => {
        const title = page.title ?? "Wikipedia article";
        return {
          title,
          url: pinWikipediaRevision(
            page.fullurl ?? `https://${wikiDomain}/wiki/` + encodeURIComponent(title.replace(/ /g, "_")),
            page.lastrevid,
          ),
          text: normalizeSourceText(page.extract ?? ""),
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
  text: string;
  matches: SourceWordMatch[];
}>();

function buildRoundFromSource(
  source: SourceDocument,
  usedAnswers: ReadonlySet<string>,
  optionWords: readonly string[],
  language: "en" | "fa" = "en",
): GeneratedRound | null {
  let analysis = sourceAnalysisCache.get(source);
  if (!analysis) {
    const text = normalizeSourceText(source.text);
    analysis = {
      text,
      matches: getSourceWordMatches(text, language),
    };
    sourceAnalysisCache.set(source, analysis);
  }
  const { text, matches } = analysis;
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

    // Choose a literal phrase from one visible paragraph and sentence only.
    const anchor = findUniqueAnchorBeforeTarget(text, matches, index);
    if (!anchor) continue;

    return {
      content: generatedClueInstruction(language),
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

    return { title: book.title, url: book.pageUrl, text: normalizeSourceText(text) };
  } catch (error) {
    console.warn("Project Gutenberg source unavailable", {
      title: book.title,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchWikipediaArticleDocument(parsed: URL): Promise<SourceDocument | null> {
  const titlePart = parsed.pathname.slice("/wiki/".length);
  if (!titlePart) return null;

  let title: string;
  try {
    title = decodeURIComponent(titlePart).replace(/_/g, " ").trim();
  } catch {
    return null;
  }
  if (!title) return null;

  // A supplied oldid is part of the challenge contract: fetch and parse that
  // exact revision, rather than silently generating a hint from today's page.
  const requestedRevisionText = parsed.searchParams.get("oldid");
  const requestedRevision = requestedRevisionText && /^\d+$/.test(requestedRevisionText)
    ? Number(requestedRevisionText)
    : null;
  if (requestedRevisionText && (!requestedRevision || !Number.isSafeInteger(requestedRevision))) {
    console.warn("Wikipedia source has an invalid oldid revision", { url: parsed.toString() });
    return null;
  }

  const apiUrl = new URL("/w/api.php", parsed.origin);
  apiUrl.searchParams.set("action", "parse");
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("prop", "text|title|revid");
  apiUrl.searchParams.set("disabletoc", "1");
  apiUrl.searchParams.set("disableeditsection", "1");
  apiUrl.searchParams.set("disablelimitreport", "1");
  if (requestedRevision) {
    apiUrl.searchParams.set("oldid", String(requestedRevision));
  } else {
    apiUrl.searchParams.set("page", title);
  }

  try {
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "WalletFind/1.0 (visible Wikipedia revision clue generator)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.warn("Wikipedia revision parse failed", {
        url: parsed.toString(),
        revision: requestedRevision,
        status: response.status,
      });
      return null;
    }

    const data = await response.json() as {
      parse?: {
        title?: string;
        revid?: number;
        text?: string | { "*": string };
      };
      error?: { code?: string; info?: string };
    };
    if (data.error) {
      console.warn("Wikipedia revision parse API error", {
        url: parsed.toString(),
        revision: requestedRevision,
        error: data.error,
      });
      return null;
    }

    const page = data.parse;
    const revision = page?.revid;
    const html = typeof page?.text === "string"
      ? page.text
      : page?.text?.["*"] ?? "";

    if (
      !page ||
      !Number.isSafeInteger(revision) ||
      !revision ||
      (requestedRevision !== null && revision !== requestedRevision)
    ) {
      console.warn("Wikipedia did not return the requested revision", {
        url: parsed.toString(),
        requestedRevision,
        returnedRevision: revision,
      });
      return null;
    }

    // Derive hints from rendered article HTML, not raw wikitext or an extract
    // which may include template tracking text not visible/searchable in-page.
    const text = normalizeSourceText(extractVisibleTextFromHtml(html));
    if (text.length < 500) {
      console.warn("Wikipedia revision text was too short for clue generation", {
        url: parsed.toString(),
        revision,
        textLength: text.length,
      });
      return null;
    }

    return {
      title: page.title ?? title,
      // Keep an explicitly requested historical revision exactly as provided.
      // Otherwise pin the rendered text to the revision returned by parse.
      url: requestedRevision !== null
        ? parsed.toString()
        : pinWikipediaRevision(parsed.toString(), revision),
      text,
    };
  } catch (error) {
    console.warn("Wikipedia revision text unavailable", {
      url: parsed.toString(),
      revision: requestedRevision,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchConfiguredWebDocument(url: string): Promise<SourceDocument | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;

    // Do not scrape Wikipedia's entire HTML page: navigation, hidden labels and
    // markup boundaries can create phrases that are not searchable in the article.
    if (
      (parsed.hostname === "fa.wikipedia.org" || parsed.hostname === "en.wikipedia.org") &&
      parsed.pathname.startsWith("/wiki/")
    ) {
      return await fetchWikipediaArticleDocument(parsed);
    }

    const response = await fetch(parsed, {
      headers: { "User-Agent": "WalletFind/1.0 (public webpage clue generator)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const responseText = await response.text();
    const text = contentType.includes("html") || /<html|<body|<p[ >]/i.test(responseText.slice(0, 2000))
      ? extractVisibleTextFromHtml(responseText)
      : normalizeSourceText(responseText);

    return text.length >= 500 ? { title: parsed.hostname, url: parsed.toString(), text } : null;
  } catch (error) {
    console.warn("Configured clue source unavailable", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function getScheduledSourceAssignments(
  language: "en" | "fa",
  context: RoundGenerationContext,
): Promise<ScheduledSourceAssignment[]> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "scheduled_clue_sources" },
    select: { value: true },
  });
  if (!setting) return [];
  try {
    const parsed: unknown = JSON.parse(setting.value);
    if (!Array.isArray(parsed)) return [];
    const expectedStart = context.startsAt.getTime();
    return parsed.filter((item): item is ScheduledSourceAssignment => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<ScheduledSourceAssignment>;
      const assignedStart = typeof row.startsAt === "string" ? Date.parse(row.startsAt) : Number.NaN;
      return row.language === language &&
        row.challengeNumber === context.challengeNumber &&
        Number.isFinite(assignedStart) &&
        assignedStart === expectedStart &&
        typeof row.url === "string" && row.url.startsWith("https://") && row.url.length <= 500 &&
        Number.isInteger(row.sequence) && Number(row.sequence) >= 1 && Number(row.sequence) <= 12;
    }).sort((a, b) => a.sequence - b.sequence);
  } catch {
    return [];
  }
}



async function getConfiguredSourceUrls(language: "en" | "fa"): Promise<string[]> {
  const defaults = language === "fa" ? [
    "https://fa.wikipedia.org/w/api.php",
    "https://fa.wikipedia.org/wiki/ایران", "https://fa.wikipedia.org/wiki/تهران",
    "https://fa.wikipedia.org/wiki/فردوسی", "https://fa.wikipedia.org/wiki/شاهنامه",
    "https://fa.wikipedia.org/wiki/هوش_مصنوعی",
  ] : [
    "https://en.wikipedia.org/w/api.php", ...GUTENBERG_BOOKS.map((book) => book.textUrl),
    "https://en.wikipedia.org/wiki/Artificial_intelligence", "https://en.wikipedia.org/wiki/Paris",
    "https://en.wikipedia.org/wiki/Albert_Einstein", "https://en.wikipedia.org/wiki/History_of_science",
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
async function generateMvpRounds(
  language: "en" | "fa" = "en",
  context?: RoundGenerationContext,
): Promise<GeneratedRound[]> {
  const configuredUrls = await getConfiguredSourceUrls(language);
  const scheduledAssignments = context ? await getScheduledSourceAssignments(language, context) : [];
  const assignedUrls = [...new Set(scheduledAssignments.map((assignment) => assignment.url))];
  const wikiUrl = `https://${language === "fa" ? "fa" : "en"}.wikipedia.org/w/api.php`;
  const wikipediaDocuments = configuredUrls.includes(wikiUrl) ? await fetchWikipediaDocuments(12, language) : [];
  const gutenbergResults = language === "en" ? await Promise.all(
    GUTENBERG_BOOKS.filter((book) => configuredUrls.includes(book.textUrl)).map((book) => fetchGutenbergDocument(book)),
  ) : [];
  const knownUrls = new Set([wikiUrl, ...GUTENBERG_BOOKS.map((book) => book.textUrl)]);
  // Wikimedia and other public sources can rate-limit bursts of parallel
  // requests (HTTP 429). Fetch configured pages sequentially so a single round
  // generation does not hit the same host with several simultaneous requests.
  const plannedDocuments: Array<{ assignment: ScheduledSourceAssignment; source: SourceDocument | null }> = [];
  for (const assignment of scheduledAssignments) {
    plannedDocuments.push({
      assignment,
      source: await fetchConfiguredWebDocument(assignment.url),
    });
  }
  const plannedSourceUrls = new Set(assignedUrls);
  const customDocuments: Array<SourceDocument | null> = [];
  const customUrls = configuredUrls.filter((url) => !knownUrls.has(url) && !plannedSourceUrls.has(url));
  for (const url of customUrls) {
    customDocuments.push(await fetchConfiguredWebDocument(url));
  }
  const sources = [
    ...gutenbergResults.filter((source): source is SourceDocument => source !== null),
    ...wikipediaDocuments,
    ...customDocuments.filter((source): source is SourceDocument => source !== null),
    ...plannedDocuments.flatMap(({ source }) => source ? [source] : []),
  ];
  const usedAnswers = new Set<string>();
  const optionCorpus = sources.map((source) => source.text).join("\n");
  const optionWords = [...new Set(getSourceWordMatches(optionCorpus, language)
    .map((match) => match.word).filter((word) => language === "fa" || !COMMON_WORDS.has(word)))];

  // A scheduled source is pinned to its chosen cell. Fail the generation rather
  // than silently publishing a challenge that ignores an admin's assignment.
  const pinnedRounds = new Map<number, GeneratedRound>();
  for (const { assignment, source } of plannedDocuments) {
    if (!source) {
      throw new Error("MVP_SCHEDULED_SOURCE_UNAVAILABLE");
    }
    if (pinnedRounds.has(assignment.sequence)) {
      throw new Error("MVP_DUPLICATE_SCHEDULED_SOURCE_CELL");
    }
    let pinnedRound: GeneratedRound | null = null;
    for (let attempt = 0; attempt < 60 && !pinnedRound; attempt += 1) {
      pinnedRound = buildRoundFromSource(source, usedAnswers, optionWords, language);
    }
    if (!pinnedRound) {
      throw new Error("MVP_SCHEDULED_SOURCE_CANNOT_GENERATE_CLUE");
    }
    pinnedRounds.set(assignment.sequence, pinnedRound);
    usedAnswers.add(pinnedRound.correctAnswer);
  }

  const remainingCount = 12 - pinnedRounds.size;
  const rounds: GeneratedRound[] = [];
  for (const source of shuffle(sources)) {
    let attempts = 0;
    let sourceRoundCount = 0;
    while (rounds.length < remainingCount && sourceRoundCount < 3 && attempts < 40) {
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
    while (rounds.length < remainingCount && attempts < 40) {
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
    scheduledAssignments: scheduledAssignments.map(({ sequence, url }) => ({ sequence, hostname: new URL(url).hostname })),
    generatedRoundCount: rounds.length + pinnedRounds.size,
    uniqueAnswerCount: usedAnswers.size,
  });
  if (rounds.length < remainingCount) throw new Error("MVP_ROUND_GENERATION_FAILED");

  const result: Array<GeneratedRound | null> = Array.from({ length: 12 }, () => null);
  for (const [sequence, clue] of pinnedRounds) result[sequence - 1] = clue;
  const remainingRounds = shuffle(rounds);
  let nextRoundIndex = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] !== null) continue;
    result[index] = remainingRounds[nextRoundIndex++] ?? null;
  }
  const completeResult = result.filter((clue): clue is GeneratedRound => clue !== null);
  if (completeResult.length !== 12) throw new Error("MVP_ROUND_GENERATION_FAILED");
  return completeResult;
}

/**
 * Keep a playable MVP contest available without requiring an admin to seed it.
 * Safe to call on every server start: a contest is reused only when all twelve
 * rounds have a source URL, a hint anchor, and twelve word choices.
 */
async function ensureMvpActiveContestInternal(language: "en" | "fa" = "en") {
  // Persist the numbering anchor before recovery creates a replacement round;
  // otherwise an outage could make the recovered round reset the schedule.
  await getChallengeScheduleAnchor();
  const activeContests = await prisma.contest.findMany({
    where: { status: "ACTIVE", language },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      clues: {
        select: {
          sequence: true,
          content: true,
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
    clues: StoredGeneratedClue[];
  }) => hasCurrentGeneratedClues(contest.clues);

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

  // Activate a due scheduled round only if its hints use the verified format.
  const dueScheduled = await prisma.contest.findFirst({
    where: {
      status: "SCHEDULED",
      language,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      clues: { select: { sequence: true, content: true, sourceUrl: true, hintAnchor: true, options: true } },
    },
  });
  if (dueScheduled) {
    if (hasCurrentGeneratedClues(dueScheduled.clues)) {
      await prisma.contest.update({ where: { id: dueScheduled.id }, data: { status: "ACTIVE" } });
      return dueScheduled.id;
    }
    await prisma.contest.update({ where: { id: dueScheduled.id }, data: { status: "CANCELLED" } });
  }

  // Keep any future round queued, but do not return it as the current round.
  // If there is no active round, create one for the current 15-minute window.
  // Generate and validate all rounds before changing the current contest.
  // If an external source fails, the existing contest remains active.
  const clues = await generateMvpRounds(language);
  // Restore the missing current round at the most recent fixed boundary.
  // A future scheduled round, if present, remains queued for the next boundary.
  const ROUND_INTERVAL_MS = CHALLENGE_INTERVAL_MS;
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
      return !isPlayable(activeContest) || (effectiveEnd !== null && effectiveEnd.getTime() <= Date.now());
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

  console.log(`Created playable ${language === "fa" ? "Persian" : "English"} word-finding contest:`, contest.id);
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
  clues: StoredGeneratedClue[];
};

function isPlayableActiveContest(contest: ActiveContestForNext, now: Date): boolean {
  return (
    hasCurrentGeneratedClues(contest.clues) &&
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
      clues: { select: { sequence: true, content: true, sourceUrl: true, hintAnchor: true, options: true } },
    },
  });
  if (existingScheduled) {
    if (hasCurrentGeneratedClues(existingScheduled.clues)) return publicContest(existingScheduled);
    await prisma.contest.update({ where: { id: existingScheduled.id }, data: { status: "CANCELLED" } });
  }

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
        content: true,
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
  // Generate a normal set first so scheduling time is based on the actual
  // completion of source retrieval, as before. If this exact future round has
  // pinned sources, regenerate with those assignments applied to their cells.
  let clues = await generateMvpRounds(language);
  const intervalMs = CHALLENGE_INTERVAL_MS;
  const nextFixedBoundary = Math.ceil(Date.now() / intervalMs) * intervalMs;
  const previousRoundBoundary = completedContest.startsAt
    ? completedContest.startsAt.getTime() + intervalMs
    : 0;
  const startsAt = new Date(Math.max(nextFixedBoundary, previousRoundBoundary));
  const challengeNumber = await getChallengeNumberAt(startsAt);
  const plannedAssignments = await getScheduledSourceAssignments(language, { challengeNumber, startsAt });
  if (plannedAssignments.length > 0) {
    clues = await generateMvpRounds(language, { challengeNumber, startsAt });
  }

  try {
    const nextContest = await prisma.$transaction(async (tx) => {
      const activeContests = await tx.contest.findMany({
        where: { status: "ACTIVE", language },
        select: activeSelect,
      });

      const scheduledCandidates = await tx.contest.findMany({
        where: { status: "SCHEDULED", language, startsAt: { gt: new Date() } },
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
        select: activeSelect,
      });
      const scheduledCreatedByAnotherRequest = scheduledCandidates.find((candidate) =>
        hasCurrentGeneratedClues(candidate.clues)
      );
      if (scheduledCreatedByAnotherRequest) {
        return publicContest(scheduledCreatedByAnotherRequest);
      }
      const staleScheduledIds = scheduledCandidates.map((candidate) => candidate.id);
      if (staleScheduledIds.length > 0) {
        await tx.contest.updateMany({
          where: { id: { in: staleScheduledIds }, status: "SCHEDULED" },
          data: { status: "CANCELLED" },
        });
      }

      const contestCreatedByAnotherRequest = activeContests.find((contest) =>
        contest.id !== completedContestId && isPlayableActiveContest(contest, new Date())
      );

      if (contestCreatedByAnotherRequest) {
        return publicContest(contestCreatedByAnotherRequest);
      }

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
const lastScheduledSourceAssignmentAttemptAt = new Map<"en" | "fa", { at: number; signature: string }>();
const AUTOMATIC_ROUND_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Keep one future shared round queued even when nobody has completed the
 * current round yet. The generated round starts on a fixed 15-minute boundary.
 */
export async function ensureScheduledMvpContest(now = new Date(), language: "en" | "fa" = "en") {
  const scheduledCandidates = await prisma.contest.findMany({
    where: { status: "SCHEDULED", language, startsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      startsAt: true,
      clues: { select: { sequence: true, content: true, sourceUrl: true, hintAnchor: true, options: true } },
    },
  });
  let existingScheduled = scheduledCandidates.find((candidate) =>
    hasCurrentGeneratedClues(candidate.clues)
  );
  const staleScheduledIds = scheduledCandidates
    .filter((candidate) => !hasCurrentGeneratedClues(candidate.clues))
    .map((candidate) => candidate.id);
  if (staleScheduledIds.length > 0) {
    await prisma.contest.updateMany({
      where: { id: { in: staleScheduledIds }, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
  }

  // If an administrator adds a source assignment after the upcoming round was
  // generated, update that still-future round in place. This keeps the same
  // scheduled time and avoids creating a gap between rounds.
  if (existingScheduled?.startsAt) {
    const scheduledRound = existingScheduled;
    const scheduledStartAt = scheduledRound.startsAt;
    if (!scheduledStartAt) return { scheduled: true, contestId: scheduledRound.id };
    const actualChallengeNumber = await getChallengeNumberAt(scheduledStartAt);
    const generationContext = {
      challengeNumber: actualChallengeNumber,
      startsAt: scheduledStartAt,
    };
    const plannedAssignments = await getScheduledSourceAssignments(language, generationContext);
    const assignmentMismatch = plannedAssignments.some((assignment) => {
      const clue = scheduledRound.clues.find((item) => item.sequence === assignment.sequence);
      return !sourceUrlMatchesAssignment(clue?.sourceUrl, assignment.url);
    });
    if (assignmentMismatch) {
      const assignmentSignature = JSON.stringify({
        contestId: scheduledRound.id,
        challengeNumber: actualChallengeNumber,
        startsAt: scheduledStartAt.toISOString(),
        assignments: plannedAssignments.map(({ sequence, url }) => ({ sequence, url })),
      });
      const lastAttempt = lastScheduledSourceAssignmentAttemptAt.get(language);
      if (
        lastAttempt?.signature === assignmentSignature &&
        now.getTime() - lastAttempt.at < AUTOMATIC_ROUND_RETRY_DELAY_MS
      ) {
        return { scheduled: true, contestId: scheduledRound.id, sourceAssignmentApplied: false };
      }
      lastScheduledSourceAssignmentAttemptAt.set(language, {
        at: now.getTime(),
        signature: assignmentSignature,
      });
      try {
        const regeneratedClues = await generateMvpRounds(language, generationContext);
        await prisma.$transaction(async (tx) => {
          for (let index = 0; index < regeneratedClues.length; index += 1) {
            const clue = regeneratedClues[index];
            if (!clue) continue;
            await tx.contestClue.update({
              where: {
                contestId_sequence: {
                  contestId: scheduledRound.id,
                  sequence: index + 1,
                },
              },
              data: {
                content: clue.content,
                correctAnswer: clue.correctAnswer,
                sourceUrl: clue.sourceUrl,
                hintAnchor: clue.hintAnchor,
                options: clue.options,
                publishedAt: scheduledStartAt,
              },
            });
          }
          await tx.auditLog.create({
            data: {
              action: "SCHEDULED_CHALLENGE_SOURCES_APPLIED",
              entity: "Contest",
              entityId: scheduledRound.id,
              metadata: {
                challengeNumber: actualChallengeNumber,
                startsAt: scheduledStartAt?.toISOString(),
                assignments: plannedAssignments.map(({ sequence, url }) => ({
                  sequence,
                  hostname: new URL(url).hostname,
                })),
              },
            },
          });
        });
        lastScheduledSourceAssignmentAttemptAt.delete(language);
        return { scheduled: true, contestId: scheduledRound.id, sourceAssignmentApplied: true };
      } catch (error) {
        console.warn("Could not apply the scheduled source assignments; the existing round remains queued.", error);
        return { scheduled: true, contestId: scheduledRound.id, sourceAssignmentApplied: false };
      }
    }
  }
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
    const intervalMs = CHALLENGE_INTERVAL_MS;
    const nextBoundary = Math.ceil(now.getTime() / intervalMs) * intervalMs;
    const previousBoundary = previous?.startsAt
      ? previous.startsAt.getTime() + intervalMs
      : nextBoundary;
    const startsAt = new Date(Math.max(nextBoundary, previousBoundary));
    const challengeNumber = await getChallengeNumberAt(startsAt);
    const clues = await generateMvpRounds(language, { challengeNumber, startsAt });
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
