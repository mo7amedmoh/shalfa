import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const budget = 400 * 1024;
const assets = join(process.cwd(), 'dist', 'assets');
const files = (await readdir(assets)).filter((file) => /^index-[^/]+\.js$/.test(file));
if (files.length !== 1) throw new Error(`Expected one initial index chunk, found ${files.length}.`);
const file = files[0];
const compressed = gzipSync(await readFile(join(assets, file)), { level: 9 });
console.log(`Initial JS: ${file} ${(await readFile(join(assets, file))).length} bytes; gzip ${compressed.length} bytes; budget ${budget} bytes`);
if (compressed.length > budget) throw new Error(`Initial JS gzip budget exceeded by ${compressed.length - budget} bytes.`);
