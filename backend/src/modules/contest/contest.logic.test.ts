import assert from "node:assert/strict";
import test from "node:test";

import {
  CLUE_GENERATOR_VERSION,
  extractVisibleTextFromHtml,
  findUniqueAnchorBeforeTarget,
  isSearchableClueAnchor,
  sourceUrlMatchesAssignment,
  generatedClueInstruction,
  getSourceWordMatches,
  normalizeSourceText,
} from "./clue-source-text.js";

import {
  calculateResponseTimeMs,
  getContestProgress,
  hasCompleteClueSequence,
  normalizeAnswer,
  REQUIRED_CLUE_COUNT,
  CONTEST_DURATION_MS,
  WRONG_ANSWER_LOCK_MS,
} from "./contest.logic.js";

test("answer normalization handles whitespace, case and Arabic/Persian variants", () => {
  assert.equal(normalizeAnswer("  كِتاب   A  "), "کتاب a");
  assert.equal(normalizeAnswer("سلام\u0640"), "سلام");
});

test("only a complete ordered set of twelve clues is playable", () => {
  const expected = Array.from(
    { length: REQUIRED_CLUE_COUNT },
    (_value, index) => index + 1,
  );

  assert.equal(hasCompleteClueSequence(expected), true);
  assert.equal(hasCompleteClueSequence([...expected].reverse()), true);
  assert.equal(hasCompleteClueSequence(expected.slice(1)), false);
  assert.equal(hasCompleteClueSequence([...expected.slice(0, 11), 11]), false);
  assert.equal(hasCompleteClueSequence([...expected, 13]), false);
});

test("progress exposes only the contiguous solved prefix", () => {
  const clues = Array.from({ length: REQUIRED_CLUE_COUNT }, (_value, index) => ({
    id: "clue-" + (index + 1),
    sequence: index + 1,
  }));

  const partial = getContestProgress(
    clues,
    new Set(["clue-1", "clue-3", "clue-4"]),
  );
  assert.equal(partial.solvedCount, 1);
  assert.equal(partial.currentClue?.sequence, 2);
  assert.equal(partial.completed, false);

  const complete = getContestProgress(
    clues,
    new Set(clues.map((clue) => clue.id)),
  );
  assert.equal(complete.solvedCount, REQUIRED_CLUE_COUNT);
  assert.equal(complete.currentClue, null);
  assert.equal(complete.completed, true);
});

test("contest duration is fifteen minutes and wrong answers lock for sixty seconds", () => {
  assert.equal(CONTEST_DURATION_MS, 900_000);
  assert.equal(WRONG_ANSWER_LOCK_MS, 60_000);
});

test("response time is measured from the shared contest start", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");
  const correctSubmittedAt = new Date("2026-10-21T10:05:30.250Z");

  assert.equal(
    calculateResponseTimeMs(correctSubmittedAt, [contestStartsAt]),
    330_250,
  );
});

test("contest finish time is measured from the shared round start", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");
  const finalAnswerSubmittedAt = new Date("2026-10-21T10:14:10.000Z");

  assert.equal(
    calculateResponseTimeMs(finalAnswerSubmittedAt, [contestStartsAt]),
    850_000,
  );
});

test("response time never becomes negative", () => {
  const now = new Date("2026-10-21T10:01:00.000Z");
  const futureStart = new Date("2026-10-21T10:02:00.000Z");

  assert.equal(calculateResponseTimeMs(now, [futureStart]), 0);
  assert.equal(calculateResponseTimeMs(now, []), 0);
});


test("HTML clue sources exclude site navigation and preserve paragraph boundaries", () => {
  const visible = extractVisibleTextFromHtml(
    '<html><body>' +
    '<nav>بی‌ای‌اِی‌ام رباتیک نرم</nav>' +
    '<main><p>رباتیک نرم برای ساخت سامانه‌های انعطاف‌پذیر به کار می‌رود.</p>' +
    '<p>طبقه‌بندی‌ها در بخش دیگری از متن توضیح داده می‌شوند.</p></main>' +
    '</body></html>',
  );

  assert.equal(visible.includes("بی‌ای‌اِی‌ام"), false);
  assert.equal(visible.includes("رباتیک نرم طبقه‌بندی‌ها"), false);
  assert.equal(visible.split("\n\n").length >= 2, true);
});

test("generated anchors are exact, unique, and immediately precede the answer", () => {
  const text = normalizeSourceText(
    "The short introduction gives some helpful background.\n\n" +
    "The system can identify patterns in medical images and categorize unusual cases reliably. " +
    "Researchers later reviewed the results carefully.",
  );
  const words = getSourceWordMatches(text, "en");
  const targetIndex = words.findIndex((word) => word.word === "unusual");

  assert.notEqual(targetIndex, -1);
  const anchor = findUniqueAnchorBeforeTarget(text, words, targetIndex);
  assert.ok(anchor);
  assert.equal(text.split(anchor).length - 1, 1);
  assert.equal(
    text.slice(text.indexOf(anchor) + anchor.length).trimStart().startsWith("unusual"),
    true,
  );
  assert.equal(/[\r\n]/.test(anchor), false);
});

test("ambiguous phrases repeated in a source are not accepted as clue anchors", () => {
  const paragraph = "The system can identify patterns in medical images and categorize unusual cases reliably.";
  const text = normalizeSourceText(paragraph + "\n\n" + paragraph);
  const words = getSourceWordMatches(text, "en");
  const firstTargetIndex = words.findIndex((word) => word.word === "unusual");

  assert.notEqual(firstTargetIndex, -1);
  assert.equal(findUniqueAnchorBeforeTarget(text, words, firstTargetIndex), null);
});

test("citation templates and maintenance labels cannot leak into a clue anchor", () => {
  const invalidAnchors = [
    "اطلاعات اصلی در ۲۱ آبان ۱۳۹۲.{{cite web}}: نگهداری یادکرد:تاریخ",
    "این یک عبارت قابل جستجو با {{cite web}} درون متن است",
    "عبارت طولانی و دارای نگهداری یادکرد:تاریخ برای بررسی",
    "این عبارت از میانهٔ یادکرد:تاریخ شروع شده و نباید سرنخ شود",
  ];
  for (const anchor of invalidAnchors) {
    assert.equal(isSearchableClueAnchor(anchor), false);
  }

  const validAnchor = "The system can identify patterns in medical images";
  assert.equal(isSearchableClueAnchor(validAnchor), true);

  const text = normalizeSourceText(
    "این صفحه یک توضیح کوتاه دارد. اطلاعات اصلی در ۲۱ آبان ۱۳۹۲.{{cite web}}: نگهداری یادکرد:تاریخ بررسی شده و نتیجهٔ نهایی برای کاربران منتشر شد.",
  );
  const words = getSourceWordMatches(text, "fa");
  const targetIndex = words.findIndex((word) => word.word === "بررسی");

  assert.notEqual(targetIndex, -1);
  const anchor = findUniqueAnchorBeforeTarget(text, words, targetIndex);
  assert.equal(anchor, null);
});

test("pinned Wikipedia source assignments require the exact same revision", () => {
  const article = "https://fa.wikipedia.org/wiki/%D8%A2%D8%BA%D9%88%D8%AA%D9%85%D8%A7%D9%86";
  const assigned = article + "?oldid=40209654";

  assert.equal(sourceUrlMatchesAssignment(assigned, assigned), true);
  assert.equal(sourceUrlMatchesAssignment(article + "?oldid=40209655", assigned), false);
  assert.equal(sourceUrlMatchesAssignment(article + "?oldid=40209654", article), true);
  assert.equal(sourceUrlMatchesAssignment(article + "?oldid=40209654", article + "?oldid=40209654#section"), true);
});

test("a sentence boundary is respected when Wikipedia template markup touches punctuation", () => {
  const text = normalizeSourceText(
    "مقدمه‌ای دربارهٔ موضوع وجود دارد. داده‌های اصلی در ۲۱ آبان ۱۳۹۲.{{cite web}}: نگهداری یادکرد:تاریخ جزئیات بیشتری را شرح می‌دهد.",
  );
  const words = getSourceWordMatches(text, "fa");
  const targetIndex = words.findIndex((word) => word.word === "جزئیات");

  assert.notEqual(targetIndex, -1);
  const anchor = findUniqueAnchorBeforeTarget(text, words, targetIndex);
  assert.equal(anchor, null);
});

test("generated clues carry a version marker used to retire old unreliable rounds", () => {
  assert.equal(CLUE_GENERATOR_VERSION, "[[WF_HINT_V3]]");
  assert.equal(generatedClueInstruction("fa").startsWith(CLUE_GENERATOR_VERSION), true);
  assert.equal(generatedClueInstruction("en").startsWith(CLUE_GENERATOR_VERSION), true);
});
