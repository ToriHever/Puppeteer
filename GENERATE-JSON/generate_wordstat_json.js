#!/usr/bin/env node
// generate_phrases.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const phrasesTxt = path.join(__dirname, "phrases.txt");
  const outJson = path.join(__dirname, "phrases.json"); // фиксированное имя

  if (!fs.existsSync(phrasesTxt)) {
    console.error(`❌ Файл не найден: ${phrasesTxt}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(phrasesTxt, "utf8");
  const lines = raw
    .replace(/^\uFEFF/, "")               // убираем BOM
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("//"));

  if (lines.length === 0) {
    console.error("❌ В файле нет фраз.");
    process.exit(1);
  }

  const payload = lines.map(phrase => ({ phrase }));
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf8");

  console.log(`✅ Готово! Сохранено ${payload.length} фраз.`);
  console.log(`→ ${outJson}`);
}

if (import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main();
}
