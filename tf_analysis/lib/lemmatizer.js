import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { MYSTEM_PATH } from '../config.js';

// Приводит текст к массиву { word, lemma } через Yandex Mystem (-nid --format json).
// Бинарник запускается один раз на весь текст страницы (не по одному слову) — так быстрее.
export function lemmatizeText(text) {
  return new Promise((resolve, reject) => {
    if (!existsSync(MYSTEM_PATH)) {
      reject(new Error(
        `Бинарник mystem не найден по пути ${MYSTEM_PATH}. ` +
        `Скачайте его вручную с https://yandex.ru/dev/mystem/ и положите в tf_analysis/bin/, ` +
        `либо задайте переменную окружения MYSTEM_PATH.`
      ));
      return;
    }

    const mystem = spawn(MYSTEM_PATH, ['-nid', '--format', 'json', '-e', 'utf-8']);

    let stdout = '';
    let stderr = '';

    mystem.stdout.on('data', chunk => { stdout += chunk.toString('utf-8'); });
    mystem.stderr.on('data', chunk => { stderr += chunk.toString('utf-8'); });

    mystem.on('error', reject);

    mystem.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`mystem завершился с кодом ${code}: ${stderr}`));
        return;
      }

      const tokens = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // строка не в формате JSON — пропускаем
        }

        const word = (parsed.text || '').trim();
        if (!word || !/[a-zA-Zа-яА-ЯёЁ]/.test(word)) continue; // пунктуация/пробелы

        const lemma = (parsed.analysis && parsed.analysis[0] && parsed.analysis[0].lex)
          ? parsed.analysis[0].lex
          : word.toLowerCase();

        tokens.push({ word, lemma });
      }

      resolve(tokens);
    });

    mystem.stdin.write(text, 'utf-8');
    mystem.stdin.end();
  });
}
