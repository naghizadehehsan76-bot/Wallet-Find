import assert from "node:assert/strict";
import test from "node:test";

import { createInternetArchiveSourceLoader } from "./internet-archive-source.js";

const turkishText = [
  "Araştırmacılar teknolojinin gelişimini dikkatle inceler ve sonuçları ayrıntılı biçimde kaydeder.",
  "Üniversitelerde yapılan çalışmalar toplumların kültürel değişimini anlamaya yardımcı olur.",
  "Mühendisler mimarlık alanında kullanılan yöntemleri karşılaştırarak yeni çözümler geliştirir.",
  "Doğal çevrenin korunması sürdürülebilir kalkınma açısından büyük önem taşımaktadır.",
  "Bilimsel araştırmalar insanların yaşam kalitesini artırmak için farklı yaklaşımlar sunmaktadır.",
  "Ekonomik faaliyetler şehirlerin tarihsel gelişimini ve toplumsal hareketlerini etkileyebilir.",
  "Öğretmenler eğitim sistemindeki yenilikleri değerlendirerek öğrencilerin başarısını destekleyen yöntemler araştırır.",
  "Sanat eserleri farklı dönemlerin düşüncelerini ve toplumsal değerlerini gelecek kuşaklara aktarabilir.",
  "Bilgisayar mühendisliği alanındaki gelişmeler iletişim teknolojilerinin kullanımını her geçen gün değiştiriyor.",
  "Kent planlaması uzmanları ulaşım ağlarını inceler ve insanların günlük ihtiyaçlarına uygun çözümler hazırlar.",
  "Arkeolojik buluntular geçmiş uygarlıkların yaşam biçimleri hakkında önemli bilgiler ortaya çıkarır.",
  "Tarım faaliyetlerinde kullanılan modern teknikler doğal kaynakların daha verimli değerlendirilmesini sağlar.",
].join("\n\n");

test("Internet Archive fallback selects same-language, commercially usable text and caches it", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.hostname === "archive.org" && url.pathname === "/advancedsearch.php") {
      assert.match(url.searchParams.get("q") ?? "", /language:tur/);
      return new Response(JSON.stringify({
        response: {
          docs: [
            {
              identifier: "turkish-public-domain",
              title: "Turkish public-domain text",
              language: ["tur"],
              licenseurl: "https://creativecommons.org/licenses/by/4.0/",
            },
            {
              identifier: "turkish-noncommercial",
              title: "Non-commercial only",
              language: ["tur"],
              licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/",
            },
            {
              identifier: "wrong-language",
              title: "English text",
              language: ["eng"],
              licenseurl: "https://creativecommons.org/licenses/by/4.0/",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/metadata/turkish-public-domain") {
      return new Response(JSON.stringify({
        metadata: {
          title: "Turkish public-domain text",
          language: ["tur"],
          licenseurl: "https://creativecommons.org/licenses/by/4.0/",
        },
        files: [
          { name: "book_djvu.txt", size: String(turkishText.length), source: "derivative" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/download/turkish-public-domain/book_djvu.txt") {
      return new Response(turkishText, { status: 200, headers: { "content-type": "text/plain" } });
    }

    throw new Error("Unexpected request: " + url.toString());
  };

  let now = 1_000;
  const load = createInternetArchiveSourceLoader({
    fetchImpl,
    now: () => now,
    cacheTtlMs: 60_000,
  });

  const first = await load("tr", 6);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.title, "Turkish public-domain text");
  assert.match(first[0]?.url ?? "", /^https:\/\/archive\.org\/download\//);
  assert.match(first[0]?.url ?? "", /book_djvu\.txt$/);
  assert.match(first[0]?.text ?? "", /Araştırmacılar/);
  assert.equal(calls.length, 3);

  now += 30_000;
  const second = await load("tr", 6);
  assert.equal(second.length, 1);
  assert.equal(calls.length, 3, "a warm cache must not issue more archive requests");
});

test("Internet Archive fallback rejects records without explicit allowed licenses", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      response: {
        docs: [
          {
            identifier: "unknown-rights",
            title: "Unknown rights",
            language: ["ara"],
          },
          {
            identifier: "noncommercial-only",
            title: "Noncommercial only",
            language: ["ara"],
            licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/",
          },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const load = createInternetArchiveSourceLoader({ fetchImpl });
  const documents = await load("ar", 6);
  assert.deepEqual(documents, []);
  assert.equal(calls, 1, "unlicensed records must not be downloaded");
});
