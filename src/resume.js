import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

export async function readResumeText(resumePath) {
  // In CI the resume comes from the RESUME_B64 secret (base64 of a PDF, DOCX or text file).
  if (process.env.RESUME_B64) {
    const buf = Buffer.from(process.env.RESUME_B64, 'base64');
    const ext = buf.subarray(0, 4).toString() === '%PDF' ? '.pdf' : buf.subarray(0, 2).toString() === 'PK' ? '.docx' : '.txt';
    resumePath = path.join(DATA_DIR, `resume-secret${ext}`);
    fs.writeFileSync(resumePath, buf);
  }
  if (!resumePath || !fs.existsSync(resumePath)) {
    throw new Error(`Resume not found at "${resumePath}". Set "resumePath" in profile.json (PDF, DOCX, TXT or MD).`);
  }
  const ext = path.extname(resumePath).toLowerCase();
  const cache = path.join(DATA_DIR, 'resume-cache.json');
  const mtime = fs.statSync(resumePath).mtimeMs;
  if (fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (c.path === resumePath && c.mtime === mtime) return c.text;
  }

  let text;
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(resumePath) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.default.extractRawText({ path: resumePath })).value;
  } else {
    text = fs.readFileSync(resumePath, 'utf8');
  }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new Error('Could not extract meaningful text from the resume (is it a scanned image?). Try a .txt/.md copy.');
  fs.writeFileSync(cache, JSON.stringify({ path: resumePath, mtime, text }));
  return text;
}
