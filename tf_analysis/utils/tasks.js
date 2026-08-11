import { readFile } from 'fs/promises';

// Формат строки: "запрос;;URL_своей_страницы". Строки с # и пустые — пропускаются.
export async function readTasks(filename) {
  const content = await readFile(filename, 'utf-8');

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => {
      const [query, ownUrl] = line.split(';;').map(part => part && part.trim());
      if (!query || !ownUrl) {
        throw new Error(`Неверный формат строки в ${filename}: "${line}". Ожидается "запрос;;URL"`);
      }
      return { query, ownUrl };
    });
}
