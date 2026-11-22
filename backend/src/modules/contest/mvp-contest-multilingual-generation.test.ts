import assert from "node:assert/strict";
import test from "node:test";

import { CHALLENGE_LANGUAGES, type ChallengeLanguage } from "./supported-languages.js";
import { CLUE_GENERATOR_VERSION, getSourceWordMatches, isSearchableClueAnchor } from "./clue-source-text.js";
import { buildRoundFromSource, type SourceDocument } from "./mvp-contest-seed.service.js";

const fixtures: Record<ChallengeLanguage, { prefix: string; markers: string[]; answers: string[] }> = {
  fa: {
    prefix: "پژوهشگران علمی میتوانند ساختارهای پیچیده را",
    markers: ["نشانه", "نمونه", "کلید", "رمز", "داده", "پژوهش", "عنوان", "مفهوم", "ساختار", "منبع", "اندازه", "فرایند"],
    answers: ["دانشمند", "فناوری", "معماری", "فرهنگ", "اقتصاد", "جغرافیا", "زیستگاه", "آموزش", "پزشکی", "مهندسی", "ادبیات", "انرژی"],
  },
  en: {
    prefix: "careful scientific researchers often discover",
    markers: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"],
    answers: ["astronomy", "telescope", "molecule", "algorithm", "ecosystem", "literature", "sculpture", "orchestra", "volcano", "glacier", "satellite", "microscope"],
  },
  de: {
    prefix: "wissenschaftliche forschung bringt wichtige erkenntnisse",
    markers: ["beispiel", "zeichen", "schlüssel", "muster", "quelle", "begriff", "ansicht", "umfang", "wirkung", "aufbau", "ablauf", "inhalt"],
    answers: ["wissenschaft", "technologie", "architektur", "gesellschaft", "geschichte", "entwicklung", "universität", "gesundheit", "umgebung", "bewegung", "erkenntnis", "forschung"],
  },
  es: {
    prefix: "investigadores estudian sistemas complejos para",
    markers: ["ejemplo", "señales", "llaves", "patrones", "fuente", "concepto", "mirada", "alcance", "efecto", "diseño", "proceso", "contenido"],
    answers: ["conocimiento", "tecnología", "arquitectura", "naturaleza", "desarrollo", "investigación", "universidad", "comunidad", "energía", "montaña", "cultura", "pensamiento"],
  },
  fr: {
    prefix: "chercheurs observent systèmes complexes pour comprendre",
    markers: ["exemple", "signes", "repères", "modèles", "source", "notion", "regard", "portée", "effets", "dessin", "étapes", "contenu"],
    answers: ["connaissance", "technologie", "architecture", "développement", "recherche", "université", "communauté", "énergie", "montagne", "culture", "pensée", "environnement"],
  },
  ar: {
    prefix: "يستطيع الباحثون دراسة انظمة معقدة لفهم",
    markers: ["علامة", "اشارة", "مفتاح", "رموز", "دليل", "عنوان", "مقياس", "نموذج", "مصدر", "بيان", "مفهوم", "منهج"],
    answers: ["التكنولوجيا", "المعمارية", "المجتمعات", "التاريخية", "التطوير", "الجامعات", "الصحة", "الحركة", "الثقافة", "الطاقة", "الطبيعة", "المعرفة"],
  },
  tr: {
    prefix: "bilimsel araştırmalar karmaşık sistemleri anlamak için",
    markers: ["örnekler", "işaretler", "anahtar", "kalıplar", "kaynak", "kavram", "bakış", "kapsam", "etkiler", "tasarım", "süreçler", "içerik"],
    answers: ["araştırma", "teknoloji", "mimarlık", "toplumlar", "gelişim", "üniversite", "sağlık", "hareket", "kültürler", "enerjiler", "doğalar", "düşünce"],
  },
  pt: {
    prefix: "pesquisadores estudam sistemas complexos para compreender",
    markers: ["exemplo", "sinais", "chaves", "padrões", "origem", "conceito", "olhares", "alcance", "efeitos", "desenho", "processos", "conteúdo"],
    answers: ["conhecimento", "tecnologia", "arquitetura", "natureza", "desenvolvimento", "pesquisa", "universidade", "comunidade", "energia", "montanha", "cultura", "pensamento"],
  },
};

test("every enabled language can build twelve distinct, searchable clues with twelve choices", () => {
  assert.deepEqual(Object.keys(fixtures).sort(), [...CHALLENGE_LANGUAGES].sort());

  for (const language of CHALLENGE_LANGUAGES) {
    const fixture = fixtures[language];
    assert.equal(fixture.markers.length, 12, language + " marker fixture count");
    assert.equal(fixture.answers.length, 12, language + " answer fixture count");

    const paragraphs = fixture.answers.map((answer, index) =>
      fixture.prefix + " " + fixture.markers[index] + " " + answer
    );
    const source: SourceDocument = {
      title: "Deterministic " + language + " generation fixture",
      url: "https://" + (language === "fa" ? "fa" : language) + ".wikisource.org/wiki/Test",
      text: paragraphs.join("\n\n"),
    };
    const usedAnswers = new Set<string>();
    const optionWords = [...new Set(
      getSourceWordMatches(paragraphs.join("\n\n"), language).map((match) => match.word),
    )];

    const clues = [];
    for (let index = 0; index < 12; index += 1) {
      const clue = buildRoundFromSource(source, usedAnswers, optionWords, language);
      assert.ok(clue, language + " must generate clue " + (index + 1));
      clues.push(clue);
      usedAnswers.add(clue.correctAnswer);
    }

    assert.equal(clues.length, 12, language + " must generate all twelve clues");
    assert.equal(usedAnswers.size, 12, language + " answers must be unique");
    for (const clue of clues) {
      assert.ok(clue, language + " generated a missing clue");
      assert.ok(clue.content.startsWith(CLUE_GENERATOR_VERSION), language + " clue version marker");
      assert.ok(clue.sourceUrl.startsWith("https://"), language + " source URL");
      assert.ok(isSearchableClueAnchor(clue.hintAnchor), language + " searchable anchor");
      assert.equal(clue.options.length, 12, language + " must provide twelve choices");
      assert.equal(new Set(clue.options).size, 12, language + " choices must be unique");
      assert.ok(clue.options.includes(clue.correctAnswer), language + " answer must be one of the choices");

    }
  }
});
