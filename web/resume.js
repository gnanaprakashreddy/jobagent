const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`Failed to load ${src}`)) });
    document.head.appendChild(s);
  });
}

// Resume parsing happens entirely in the browser; the file is never uploaded anywhere.
export async function extractResume(file) {
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith('.pdf')) {
    const pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    text = pages.join('\n');
  } else if (name.endsWith('.docx')) {
    await loadScript(MAMMOTH);
    text = (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else {
    text = await file.text();
  }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new Error('Could not read much text from this file (scanned image?). Paste your resume text instead.');
  return text;
}
