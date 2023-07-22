import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from "node:path";
const __dirname = new URL('.', import.meta.url).pathname;
const proxyCode = await fs.readFile(path.join(__dirname, '../netlify/edge-functions/cors-proxy.ts'), 'utf8');
const hasConsole = /console\.\w\(/;
assert(!hasConsole.test(proxyCode), 'console.log() found in proxy code');
