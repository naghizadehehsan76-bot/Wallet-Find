import type { ChallengeLanguage } from "./supported-languages.js";
import { getSourceWordMatches, normalizeSourceText } from "./clue-source-text.js";

type SourceDocument = {
  title: string;
  url: string;
  text: string;
};

type ArchiveSearchDocument = {
  identifier?: string;
  title?: string;
  language?: string | string[];
  licenseurl?: string | string[];
};

type ArchiveMetadata = {
  metadata?: {
    title?: string;
    language?: string | string[];
    licenseurl?: string | string[];
  };
  files?: Array<{
    name?: string;
    size?: string | number;
    source?: string;
  }>;
};

type FetchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
};

const LANGUAGE_CODES: Record<ChallengeLanguage, string> = {
  fa: "per",
  en: "eng",
  de: "ger",
  es: "spa",
  fr: "fre",
  ar: "ara",
  tr: "tur",
  pt: "por",
  ru: "rus",
  "zh-CN": "chi",
};

const LANGUAGE_ALIASES: Record<ChallengeLanguage, readonly string[]> = {
  fa: ["per", "fas", "fa", "persian", "farsi"],
  en: ["eng", "en", "english"],
  de: ["ger", "deu", "de", "german"],
  es: ["spa", "es", "spanish", "español"],
  fr: ["fre", "fra", "fr", "french", "français"],
  ar: ["ara", "ar", "arabic"],
  tr: ["tur", "tr", "turkish", "türkçe"],
  pt: ["por", "pt", "portuguese", "português"],
  ru: ["rus", "ru", "russian", "русский"],
  "zh-CN": ["chi", "zho", "zh", "zh-cn", "chinese", "中文"],
};

const MAX_SEARCH_RESULTS = 40;
const MAX_METADATA_LOOKUPS = 8;
const MAX_DOCUMENTS = 6;
const MAX_TEXT_LENGTH = 450_000;
const MIN_TEXT_LENGTH = 900;
const MIN_WORD_MATCHES = 30;


function values(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function hasCommerciallyUsableLicense(value: string | string[] | undefined): boolean {
  return values(value).some((license) => {
    try {
      const url = new URL(license);
      if (url.hostname !== "creativecommons.org") return false;
      const path = url.pathname.toLowerCase();
      // Public-domain declarations and CC0 need no per-clue attribution metadata.
      return (
        path.startsWith("/publicdomain/zero/") ||
        path.startsWith("/publicdomain/mark/")
      );
    } catch {
      return false;
    }
  });
}

function matchesLanguage(value: string | string[] | undefined, language: ChallengeLanguage): boolean {
  const aliases = new Set(LANGUAGE_ALIASES[language].map((item) => item.toLowerCase()));
  return values(value).some((item) => aliases.has(item.trim().toLowerCase()));
}

function isUsableText(text: string, language: ChallengeLanguage): boolean {
  if (text.length < MIN_TEXT_LENGTH) return false;
  return getSourceWordMatches(text, language).length >= MIN_WORD_MATCHES;
}

async function fetchJson<T>(url: URL, fetchImpl: typeof fetch): Promise<T | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WalletFind/1.0 (independent multilingual public-domain source fallback; https://wallet-find.com)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn("Internet Archive fallback request skipped", {
        host: url.hostname,
        status: response.status,
      });
      return null;
    }
    return await response.json() as T;
  } catch (error) {
    console.warn("Internet Archive fallback request failed", {
      host: url.hostname,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchText(url: URL, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/plain",
        "User-Agent": "WalletFind/1.0 (independent multilingual public-domain source fallback; https://wallet-find.com)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn("Internet Archive text download skipped", { status: response.status });
      return null;
    }
    const text = await response.text();
    return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
  } catch (error) {
    console.warn("Internet Archive text download failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadDocuments(
  language: ChallengeLanguage,
  fetchImpl: typeof fetch,
): Promise<SourceDocument[]> {
  const searchUrl = new URL("https://archive.org/advancedsearch.php");
  // Archive.org metadata uses inconsistent language identifiers. Search
  // the ISO code and common names, then validate the item's metadata below.
  const languageFilters = [...new Set([
    LANGUAGE_CODES[language],
    ...LANGUAGE_ALIASES[language],
  ])].map((value) => `language:"${value}"`).join(" OR ");
  searchUrl.searchParams.set(
    "q",
    `mediatype:texts AND (${languageFilters})`,
  );
  for (const field of ["identifier", "title", "language", "licenseurl"]) {
    searchUrl.searchParams.append("fl[]", field);
  }
  searchUrl.searchParams.set("rows", String(MAX_SEARCH_RESULTS));
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("output", "json");
  searchUrl.searchParams.append("sort[]", "downloads desc");

  const search = await fetchJson<{
    response?: { docs?: ArchiveSearchDocument[] };
  }>(searchUrl, fetchImpl);
  const searchResults = search?.response?.docs ?? [];
  let searchLicenseRejectedCount = 0;
  let searchLanguageRejectedCount = 0;
  const candidates = searchResults.filter((item) => {
    if (typeof item.identifier !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(item.identifier)) return false;
    if (!hasCommerciallyUsableLicense(item.licenseurl)) {
      searchLicenseRejectedCount += 1;
      return false;
    }
    if (!matchesLanguage(item.language, language)) {
      searchLanguageRejectedCount += 1;
      return false;
    }
    return true;
  });

  const documents: SourceDocument[] = [];
  let metadataLookupCount = 0;
  let metadataMissingCount = 0;
  let metadataLicenseRejectedCount = 0;
  let metadataLanguageRejectedCount = 0;
  let textFileMissingCount = 0;
  let textDownloadFailedCount = 0;
  let textRejectedCount = 0;
  for (const candidate of candidates.slice(0, MAX_METADATA_LOOKUPS)) {
    if (documents.length >= MAX_DOCUMENTS) break;
    const identifier = candidate.identifier;
    if (!identifier) continue;

    const metadataUrl = new URL(
      "https://archive.org/metadata/" + encodeURIComponent(identifier),
    );
    metadataLookupCount += 1;
    const metadata = await fetchJson<ArchiveMetadata>(metadataUrl, fetchImpl);
    const itemMetadata = metadata?.metadata;
    if (!itemMetadata) {
      metadataMissingCount += 1;
      continue;
    }
    if (!hasCommerciallyUsableLicense(itemMetadata.licenseurl)) {
      metadataLicenseRejectedCount += 1;
      continue;
    }
    if (!matchesLanguage(itemMetadata.language, language)) {
      metadataLanguageRejectedCount += 1;
      continue;
    }

    const textFiles = (metadata?.files ?? [])
      .filter((file) => {
        const name = file.name?.toLowerCase() ?? "";
        const size = Number(file.size);
        return (
          (name.endsWith("_djvu.txt") || name.endsWith(".txt") || name.endsWith(".txt.utf-8")) &&
          Number.isFinite(size) &&
          size >= MIN_TEXT_LENGTH &&
          size <= 5_000_000
        );
      })
      .sort((left, right) => {
        const leftName = left.name?.toLowerCase() ?? "";
        const rightName = right.name?.toLowerCase() ?? "";
        const leftRank = leftName.endsWith("_djvu.txt") ? 0 : 1;
        const rightRank = rightName.endsWith("_djvu.txt") ? 0 : 1;
        return leftRank - rightRank;
      });

    const file = textFiles[0];
    if (!file?.name) {
      textFileMissingCount += 1;
      continue;
    }

    const downloadUrl = new URL(
      "https://archive.org/download/" +
      encodeURIComponent(identifier) + "/" +
      file.name.split("/").map(encodeURIComponent).join("/"),
    );
    const downloaded = await fetchText(downloadUrl, fetchImpl);
    if (!downloaded) {
      textDownloadFailedCount += 1;
      continue;
    }

    const text = normalizeSourceText(downloaded);
    if (!isUsableText(text, language)) {
      textRejectedCount += 1;
      continue;
    }

    documents.push({
      title: itemMetadata.title ?? candidate.title ?? identifier,
      // The downloaded OCR/plain-text file is directly searchable by participants.
      url: downloadUrl.toString(),
      text,
    });
  }

  console.info("Internet Archive independent fallback selection completed", {
    language,
    searchResultCount: searchResults.length,
    candidateCount: candidates.length,
    searchLicenseRejectedCount,
    searchLanguageRejectedCount,
    metadataLookupCount,
    metadataMissingCount,
    metadataLicenseRejectedCount,
    metadataLanguageRejectedCount,
    textFileMissingCount,
    textDownloadFailedCount,
    textRejectedCount,
    acceptedSources: documents.length,
    sourceHosts: documents.map(() => "archive.org"),
  });
  return documents;
}

/**
 * Fetches independently hosted, explicitly open-licensed texts for a language.
 * Results are cached per process so an outage does not trigger repeated catalog
 * searches and metadata downloads every time a round is generated.
 */
export function createInternetArchiveSourceLoader(options: FetchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? 6 * 60 * 60 * 1_000;
  const cache = new Map<ChallengeLanguage, { expiresAt: number; documents: SourceDocument[] }>();
  const inFlight = new Map<ChallengeLanguage, Promise<SourceDocument[]>>();

  return async function fetchInternetArchiveDocuments(
    language: ChallengeLanguage,
    limit = MAX_DOCUMENTS,
  ): Promise<SourceDocument[]> {
    const cached = cache.get(language);
    if (cached && cached.expiresAt > now()) {
      return cached.documents.slice(0, Math.max(0, limit));
    }

    const pending = inFlight.get(language);
    if (pending) return (await pending).slice(0, Math.max(0, limit));

    const request = loadDocuments(language, fetchImpl)
      .then((documents) => {
        cache.set(language, {
          expiresAt: now() + (documents.length > 0 ? cacheTtlMs : 2 * 60 * 1_000),
          documents,
        });
        return documents;
      })
      .finally(() => {
        inFlight.delete(language);
      });

    inFlight.set(language, request);
    return (await request).slice(0, Math.max(0, limit));
  };
}

export const fetchInternetArchiveDocuments = createInternetArchiveSourceLoader();
