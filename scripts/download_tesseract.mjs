import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '..', 'extension', 'lib', 'tesseract');

fs.mkdirSync(targetDir, { recursive: true });

const files = [
  {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
    dest: 'tesseract.min.js'
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/worker.min.js',
    dest: 'worker.min.js'
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
    dest: 'tesseract-core.wasm.js'
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm',
    dest: 'tesseract-core.wasm'
  },
  {
    url: 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz',
    dest: 'eng.traineddata.gz'
  }
];

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: status code ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✓ Downloaded ${path.basename(destPath)} (${fs.statSync(destPath).size} bytes)`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

console.log('🚀 Downloading Tesseract.js offline assets into extension/lib/tesseract ...');
for (const file of files) {
  const destPath = path.join(targetDir, file.dest);
  try {
    await download(file.url, destPath);
  } catch (err) {
    console.error(`❌ Error downloading ${file.dest}:`, err.message);
  }
}
console.log('🎉 Tesseract.js assets ready!');
