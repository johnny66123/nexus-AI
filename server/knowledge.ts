import path from 'node:path';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import * as XLSX from 'xlsx';
import type { KnowledgeDocument } from '../shared/schema.ts';

export async function extractDocumentText(
  buffer: Buffer,
  originalFilename: string,
): Promise<{ text: string; fileType: KnowledgeDocument['fileType'] }> {
  const ext = path.extname(originalFilename).toLowerCase();

  if (ext === '.pdf') {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    const text = Array.isArray(result.text) ? result.text.join('\n') : String(result.text ?? '');
    return { text: text.trim(), fileType: 'pdf' };
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value.trim(), fileType: 'docx' };
  }

  if (ext === '.csv') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `Sheet: ${name}\n${csv}`;
    });
    return { text: sheets.join('\n\n').trim(), fileType: 'csv' };
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `Sheet: ${name}\n${csv}`;
    });
    return { text: sheets.join('\n\n').trim(), fileType: 'xlsx' };
  }

  if (ext === '.txt' || ext === '.md' || ext === '.json') {
    return { text: buffer.toString('utf-8').trim(), fileType: 'txt' };
  }

  throw new Error(
    `Unsupported file extension "${ext || 'unknown'}". Upload PDF, DOCX, CSV, XLSX, or TXT/MD files.`,
  );
}

export function chunkText(text: string, maxChunkSize = 900, overlap = 120): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    let end = Math.min(cursor + maxChunkSize, clean.length);
    if (end < clean.length) {
      const newlineBreak = clean.lastIndexOf('\n', end);
      const spaceBreak = clean.lastIndexOf(' ', end);
      if (newlineBreak > cursor + maxChunkSize * 0.5) {
        end = newlineBreak;
      } else if (spaceBreak > cursor + maxChunkSize * 0.5) {
        end = spaceBreak;
      }
    }
    const piece = clean.slice(cursor, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}
