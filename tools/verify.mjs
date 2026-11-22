/**
 * Pemeriksaan(build) BBB.id.
 * Menjalankan pemeriksaan:
 *   1. semua kelas Tailwind yang dipakai HTML benar-benar ada di app.css
 *   2. semua tautan internal menuju berkas yang ada
 *   3. app.js tidak punya selector data-* yang tidak ada di HTML
 *   4. tidak ada ID duplikat di satu halaman
 * Cara pakai: node tools/verify.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];
const add = (kind, message) => problems.push(`${kind}: ${message}`);
const warn = (message) => warnings.push(`warn: ${message}`);

const walk = (dir, filter) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git') return [];
    if (statSync(full).isDirectory()) return walk(full, filter);
    return filter(full) ? [full] : [];
});

const htmlFiles = walk(root, (file) => file.endsWith('.html'));
const cssFiles = walk(root, (file) => file.endsWith('.css') && !file.includes(`${'node_modules'}`));
const builtCssPath = join(root, 'app.css');

if (!existsSync(builtCssPath)) {
    add('build', 'app.css belum ada. Jalankan: npm run build');
}

const builtCss = existsSync(builtCssPath) ? readFileSync(builtCssPath, 'utf8') : '';
const sourceCss = readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(root, 'src', name), 'utf8'))
    .join('\n');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');

/* ---------- 1. cakupan kelas ---------- */

const cssEscape = (name) => {
    const escaped = name
        .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, (char) => `\\${char}`)
        .replace(/^([0-9])/, '\\3$1 ');
    return `.${escaped}`;
};

const definedClasses = new Set();
for (const match of builtCss.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
    definedClasses.add(match[1].replace(/\\(.)/g, '$1'));
}
const bbbClasses = new Set();
for (const match of sourceCss.matchAll(/\.((?:bbb|card-shadow|custom-|icon-fill|sr-only|hide-scrollbar|glass-panel|pb-safe|is-|material-symbols)[A-Za-z0-9_-]*)/g)) {
    bbbClasses.add(match[1]);
}

/* Prefix varian Tailwind: bukan nama kelas yang berdiri sendiri. */
const variantPrefixes = new Set([
    'sm', 'md', 'lg', 'xl', '2xl', 'dark', 'motion-safe', 'motion-reduce',
    'hover', 'focus', 'focus-within', 'focus-visible', 'active', 'visited', 'target',
    'disabled', 'enabled', 'checked', 'indeterminate', 'default', 'required', 'invalid',
    'valid', 'first', 'last', 'odd', 'even', 'first-of-type', 'last-of-type',
    'odd-of-type', 'even-of-type', 'only', 'empty', 'read-only', 'placeholder-shown',
    'autofill', 'in-range', 'out-of-range', 'group-hover', 'group-focus', 'group-active',
    'group-disabled', 'peer-checked', 'peer-focus', 'peer-invalid', 'before', 'after',
    'selection', 'marker', 'file', 'backdrop', 'print', 'ltr', 'rtl', 'open', 'has',
    'not', 'children', 'details', 'summary'
]);

const knownCustomClasses = /^(bbb-|card-shadow|custom-|icon-fill$|sr-only$|hide-scrollbar$|glass-panel$|pb-safe$|is-[a-z]|material-symbols-outlined$|group\/)/;
const arbitraryValue = /[[\]()#,:&%!$'"<>=+~|/*]/;

const missing = new Map();
htmlFiles.forEach((file) => {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
        for (const raw of match[1].split(/\s+/)) {
            const name = raw.trim();
            if (!name || knownCustomClasses.test(name)) continue;
            if (arbitraryValue.test(name)) continue;
            const parts = name.split(':');
            const token = parts[parts.length - 1];
            if (!token || variantPrefixes.has(parts[0]) || knownCustomClasses.test(token)) continue;
            if (!/^(?:-)?[a-z0-9]/.test(token)) continue;
            if (!definedClasses.has(token) && !bbbClasses.has(token)) {
                if (!missing.has(token)) missing.set(token, []);
                missing.get(token).push(relative(root, file));
            }
        }
    }
});
missing.forEach((files, name) => add('kelas hilang', `"${name}" tidak ada di app.css (dipakai di ${[...new Set(files)].join(', ')})`));

/* ---------- 2. tautan internal ---------- */

const pageDirs = ['beranda', 'marketplace', 'detail_produk', 'dashboard', 'tambah_produk', 'login', 'registrasi', 'lupa_password'];
htmlFiles.forEach((file) => {
    const html = readFileSync(file, 'utf8');
    const fromDir = dirname(file);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const value = match[1];
        if (/^(https?:|data:|mailto:|tel:|#|\/\/)/.test(value)) continue;
        const clean = value.split(/[?#]/)[0];
        if (!clean) continue;
        const target = resolve(fromDir, clean);
        if (!existsSync(target)) add('tautan rusak', `${relative(root, file)} -> ${value}`);
    }
});
pageDirs.forEach((page) => {
    if (!existsSync(join(root, page, `${page}.html`))) add('halaman hilang', `${page}/${page}.html`);
});

/* ---------- 3. kontrak app.js <-> HTML ---------- */

const htmlAll = htmlFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const attributeRefs = new Set([...appJs.matchAll(/\[data-([a-z-]+)/g)].map((match) => match[1]));
/* Atribut yang ditulis app.js saat runtime (kartu produk, dialog, daftar dashboard) tidak perlu ada di HTML. */
const camelCase = (name) => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
const writtenAttributes = new Set([
    ...[...appJs.matchAll(/(?<!\[)data-([a-z-]+)(?!\])/g)].map((match) => match[1]),
    ...[...appJs.matchAll(/dataset\.([a-zA-Z]+)\s*=/g)].map((match) => match[1].toLowerCase())
]);
attributeRefs.forEach((attribute) => {
    if (new RegExp(`data-${attribute}[\\s=>]`).test(htmlAll)) return;
    if (writtenAttributes.has(attribute) || writtenAttributes.has(camelCase(attribute).toLowerCase())) return;
    warn(`app.js mereferensikan [data-${attribute}] tetapi tidak ada di HTML mana pun`);
});
const idRefs = new Set([...appJs.matchAll(/querySelector\('#([a-zA-Z0-9_-]+)'\)/g)].map((match) => match[1]));
/* ID yang dibuat app.js saat runtime (dialog, daftar dashboard) tidak perlu ada di HTML. */
const dynamicIds = new Set([...appJs.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]));
idRefs.forEach((id) => {
    if (dynamicIds.has(id)) return;
    if (!new RegExp(`id="${id}"`).test(htmlAll)) add('id hilang', `#${id} dipakai app.js tapi tidak ada di HTML`);
});

/* ---------- 4. id duplikat ---------- */

htmlFiles.forEach((file) => {
    const html = readFileSync(file, 'utf8');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const seen = new Set();
    ids.forEach((id) => {
        if (seen.has(id)) add('id duplikat', `${relative(root, file)} punya dua #${id}`);
        seen.add(id);
    });
});

/* ---------- 5. pastikan app.css benar-benar hasil build ---------- */

if (sourceCss.includes('@tailwind')) {
    if (!/Verifikasi build/.test(builtCss) && builtCss.length < 5000) {
        add('build', 'app.css hasil build terlalu kecil, mungkin gagal');
    }
}

/* ---------- laporan ---------- */

[...warnings, ...problems].forEach((line) => console.log(line));
console.log(`\n${htmlFiles.length} berkas HTML diperiksa.`);
if (problems.length) {
    console.log(`\n${problems.length} masalah ditemukan.`);
    process.exit(1);
}
console.log('Tidak ada masalah. Semua kelas, tautan, dan kontrak HTML/JS valid.');