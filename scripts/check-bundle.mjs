import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const budget = 400 * 1024;
const assets = join(process.cwd(), 'dist', 'assets');
const indexHtml = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) throw new Error('Could not find the initial entry chunk in dist/index.html.');
const file = entryMatch[1];
const compressed = gzipSync(await readFile(join(assets, file)), { level: 9 });
console.log(`Initial JS: ${file} ${(await readFile(join(assets, file))).length} bytes; gzip ${compressed.length} bytes; budget ${budget} bytes`);
if (compressed.length > budget) throw new Error(`Initial JS gzip budget exceeded by ${compressed.length - budget} bytes.`);
