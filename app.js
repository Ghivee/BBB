(() => {
    'use strict';

    const PAGES = ['beranda', 'marketplace', 'detail_produk', 'dashboard', 'tambah_produk', 'login', 'registrasi', 'lupa_password'];
    const AUTH_PAGES = new Set(['login', 'registrasi', 'lupa_password']);
    const DASHBOARD_TABS = ['products', 'purchases', 'wishlist', 'offers', 'messages', 'settings'];
    const INTENT_KEYS = ['wishlist', 'chat', 'offer', 'checkout'];
    const NO_IMAGE = '../marketplace/no-image.svg';
    const MAX_PHOTOS = 5;
    const PAGE_SIZE = 8;
    const backendAvailable = ['http:', 'https:'].includes(location.protocol);
    const backendUnavailableError = () => new Error(location.protocol === 'file:'
        ? 'Fitur akun dan transaksi perlu server. Jangan buka beranda.html langsung; jalankan `npx vercel dev` dari folder proyek.'
        : 'Server BBB.id tidak dapat dijangkau. Periksa koneksi internet dan status deployment Vercel.');
    const apiUrl = (path) => {
        if (!backendAvailable) throw backendUnavailableError();
        return new URL(`../api/${path}`, location.href);
    };
    const requestJson = async (url, options) => {
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            if (error instanceof TypeError) {
                const requestOrigin = new URL(url, location.href).origin;
                if (requestOrigin === location.origin) throw backendUnavailableError();
                throw new Error('Koneksi ke Supabase gagal. Periksa URL proyek, koneksi internet, dan pengaturan akses domain di Supabase.');
            }
            throw error;
        }
        const text = await response.text();
        let payload;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            throw new Error(`Server mengembalikan respons yang tidak valid (${response.status}). Pastikan fungsi API BBB.id ter-deploy.`);
        }
        return { response, payload };
    };

    let publicConfigPromise;
    const publicConfig = () => {
        if (!publicConfigPromise) {
            publicConfigPromise = requestJson(apiUrl('config'))
                .then(({ response, payload }) => {
                    if (!response.ok) throw new Error(payload?.error || `Konfigurasi server tidak tersedia (${response.status}).`);
                    return payload;
                });
        }
        return publicConfigPromise;
    };
    const authRequest = async (path, body, { token, query = '', method = 'POST' } = {}) => {
        const config = await publicConfig();
        const { response, payload } = await requestJson(`${config.supabaseUrl}/auth/v1/${path}${query}`, {
            method,
            headers: {
                apikey: config.supabaseAnonKey,
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(payload?.msg || payload?.message || payload?.error_description || `Permintaan akun gagal (${response.status}).`);
        return payload;
    };
    const tokenFromSession = async () => {
        const session = readSession();
        if (!session?.accessToken) return '';
        if (Number(session.expiresAt || 0) > Date.now() + 30000) return session.accessToken;
        if (!session.refreshToken) return '';
        const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refreshToken });
        const account = getStore('users', []).find((user) => user.id === session.userId);
        if (!account) return '';
        saveSession(account, session.remember, refreshed);
        return refreshed.access_token;
    };
    const apiRequest = async (path, { method = 'GET', body, token } = {}) => {
        const accessToken = token || await tokenFromSession();
        const { response, payload } = await requestJson(apiUrl(path), {
            method,
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok) throw new Error(payload?.error || `Permintaan ke server gagal (${response.status}).`);
        return payload;
    };
    const uploadImage = async (dataUrl, token, userId, name) => {
        if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl)) throw new Error('Format foto tidak didukung.');
        const [metadata, encoded] = dataUrl.split(',');
        const mime = metadata.match(/^data:(.*?);base64$/)[1];
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const config = await publicConfig();
        const objectPath = `${userId}/${Date.now().toString(36)}-${crypto.randomUUID()}-${name}`;
        const { response, payload } = await requestJson(`${config.supabaseUrl}/storage/v1/object/product-images/${objectPath}`, {
            method: 'POST',
            headers: {
                apikey: config.supabaseAnonKey,
                Authorization: `Bearer ${token}`,
                'Content-Type': mime,
                'x-upsert': 'false'
            },
            body: bytes
        });
        if (!response.ok) throw new Error(payload?.message || 'Foto gagal diunggah. Periksa konfigurasi storage Supabase.');
        return `${config.supabaseUrl}/storage/v1/object/public/product-images/${objectPath}`;
    };

    const pageFor = (name, params = {}) => {
        const query = new URLSearchParams(params).toString();
        return `../${name}/${name}.html${query ? `?${query}` : ''}`;
    };
    const currentPage = (() => {
        const name = location.pathname.split('/').pop().replace(/\.html$/i, '');
        return PAGES.includes(name) ? name : 'beranda';
    })();

    /* ------------------------------------------------------------------ *
     * Penyimpanan lokal
     * ------------------------------------------------------------------ */

    const getStore = (key, fallback = []) => {
        try {
            const value = localStorage.getItem(`bbb-${key}`);
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            console.error(`Tidak dapat membaca data ${key}.`, error);
            return fallback;
        }
    };
    const setStore = (key, value) => {
        try {
            localStorage.setItem(`bbb-${key}`, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Tidak dapat menyimpan data ${key}.`, error);
            toast('Penyimpanan browser penuh atau tidak tersedia. Kurangi jumlah atau ukuran foto.');
            return false;
        }
    };

    let toastTimer;
    const toast = (message) => {
        let node = document.querySelector('.bbb-toast');
        if (!node) {
            node = document.createElement('div');
            node.className = 'bbb-toast';
            node.setAttribute('role', 'status');
            node.hidden = true;
            document.body.append(node);
        }
        node.textContent = message;
        node.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { node.hidden = true; }, 3800);
    };

    const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const slugify = (value = '') => String(value).toLocaleLowerCase('id').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const parsePrice = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0;
    const rupiah = (value) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
    const sellerFeeRate = (price) => price < 100000 ? 0.05 : price <= 500000 ? 0.04 : 0.03;
    const initials = (name = '') => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('id') || '').join('') || '?';
    const setFormMessage = (node, message, success = false) => {
        if (!node) return;
        node.textContent = message;
        node.dataset.success = String(success);
    };

    /* ------------------------------------------------------------------ *
     * Kategori, kondisi, lokasi
     * ------------------------------------------------------------------ */

    const CATEGORIES = {
        buku: { label: 'Buku & Catatan', icon: 'menu_book' },
        elektronik: { label: 'Elektronik', icon: 'devices' },
        kost: { label: 'Perlengkapan Kos', icon: 'weekend' },
        pakaian: { label: 'Fashion', icon: 'checkroom' },
        lainnya: { label: 'Lainnya', icon: 'more_horiz' }
    };
    const CONDITIONS = {
        baru: { label: 'Baru', order: 0 },
        'bekas-seperti-baru': { label: 'Seperti Baru', order: 1 },
        'bekas-pakai': { label: 'Bekas Pakai', order: 2 }
    };
    const CONDITION_ALIASES = {
        baru: 'baru',
        new: 'baru',
        baru_: 'baru',
        seperti_baru: 'bekas-seperti-baru',
        'seperti-baru': 'bekas-seperti-baru',
        'like-new': 'bekas-seperti-baru',
        'like_new': 'bekas-seperti-baru',
        baik: 'bekas-pakai',
        bagus: 'bekas-pakai',
        good: 'bekas-pakai',
        'bekas-pakai': 'bekas-pakai',
        kurang: 'bekas-pakai',
        rusak: 'bekas-pakai',
        'butuh-sol': 'bekas-pakai'
    };
    const normalizeCondition = (value) => {
        const key = String(value ?? '').trim().toLocaleLowerCase('id');
        return CONDITIONS[CONDITION_ALIASES[key]] ? CONDITION_ALIASES[key] : 'bekas-pakai';
    };
    const conditionLabel = (value) => CONDITIONS[normalizeCondition(value)].label;

    /* Lokasi kanonik: satu label untuk seluruh situs supaya filter konsisten. */
    const LOCATIONS = {
        untidar: 'Universitas Tidar (UNTIDAR)',
        unimma: 'Universitas Muhammadiyah Magelang (UNIMMA)',
        akmil: 'Akademi Militer',
        pusat_kota: 'Pusat Kota Magelang (Alun-Alun)'
    };
    const LOCATION_KEYWORDS = [
        ['untidar', /untidar|tidar/i],
        ['unimma', /unimma|umm\b|muhammadiyah/i],
        ['akmil', /akmil|akademi milit/i],
        ['pusat_kota', /alun|pusat kota|kota magelang/i]
    ];
    const locationKey = (value) => {
        if (LOCATIONS[value]) return value;
        const text = String(value ?? '');
        const found = LOCATION_KEYWORDS.find(([, pattern]) => pattern.test(text));
        return found ? found[0] : '';
    };
    const locationLabel = (value) => {
        const text = String(value ?? '').trim();
        return LOCATIONS[text] || LOCATIONS[locationKey(text)] || text || 'Magelang';
    };

    const inferCategory = (title = '') => {
        const text = String(title).toLowerCase();
        if (/buku|kalkulus|catatan|purcell|modul|literatur/.test(text)) return 'buku';
        if (/laptop|macbook|elektronik|kalkulator|headphone|hp|smartphone|powerbank|mouse|keyboard/.test(text)) return 'elektronik';
        if (/baju|kemeja|kaos|fashion|sepatu|vans|jaket|celana|tas |dompet/.test(text)) return 'pakaian';
        if (/rak|lampu|perlengkapan kos|\bmeja\b|\bkursi\b|kosan|kompor|panci|dispenser/.test(text)) return 'kost';
        return 'lainnya';
    };

    /* ------------------------------------------------------------------ *
     * Sesi akun
     * ------------------------------------------------------------------ */

    const readSession = () => {
        try {
            return JSON.parse(sessionStorage.getItem('bbb-session') || localStorage.getItem('bbb-session') || 'null');
        } catch (error) {
            console.error('Tidak dapat membaca sesi akun.', error);
            return null;
        }
    };
    const currentUser = () => {
        const session = readSession();
        return session?.accessToken ? getStore('users', []).find((user) => user.id === session.userId) || null : null;
    };
    const accountKey = (key) => {
        const user = currentUser();
        return user ? `account-${user.id}-${key}` : key;
    };
    const getAccountStore = (key, fallback = []) => getStore(accountKey(key), fallback);
    const setAccountStore = (key, value) => setStore(accountKey(key), value);

    const requestLogin = (next = currentPage, intent = '') => {
        if (currentUser()) return true;
        const params = { next };
        if (INTENT_KEYS.includes(intent)) params.intent = intent;
        if (next === 'dashboard') {
            const tab = new URLSearchParams(location.search).get('tab');
            if (tab) params.tab = tab;
        }
        if (next === 'detail_produk') {
            const product = new URLSearchParams(location.search).get('product');
            if (product) params.product = product;
        }
        location.href = pageFor('login', params);
        return false;
    };
    const destinationAfterLogin = () => {
        const params = new URLSearchParams(location.search);
        const next = params.get('next');
        if (next === 'tambah_produk') return pageFor(next);
        if (next === 'dashboard') {
            const tab = params.get('tab');
            return pageFor(next, { tab: DASHBOARD_TABS.includes(tab) ? tab : 'products' });
        }
        if (next === 'detail_produk') {
            const product = params.get('product');
            const intent = params.get('intent');
            if (product && getStore('products').some((item) => item.id === product)) {
                const destination = { product };
                if (INTENT_KEYS.includes(intent)) destination.intent = intent;
                return pageFor(next, destination);
            }
        }
        return pageFor('beranda');
    };
    const saveFlash = (message) => {
        try {
            sessionStorage.setItem('bbb-flash', message);
        } catch (error) {
            console.error('Tidak dapat menyimpan notifikasi.', error);
        }
    };

    /* ------------------------------------------------------------------ *
     * Foto: baca file, perkecil, ubah ke JPEG di dalam browser
     * ------------------------------------------------------------------ */

    const readImageFile = (file, maxEdge = 900, quality = 0.82) => new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('File yang dipilih bukan gambar. Pilih berkas JPG, PNG, atau WebP.'));
            return;
        }
        const reader = new FileReader();
        reader.addEventListener('error', () => reject(new Error('Foto tidak dapat dibaca. Pilih berkas lain.')));
        reader.addEventListener('load', () => {
            const image = new Image();
            image.addEventListener('error', () => reject(new Error('Foto tidak dapat dibuka sebagai gambar.')));
            image.addEventListener('load', () => {
                const scale = Math.min(1, maxEdge / Math.max(image.width || 1, image.height || 1));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round((image.width || 1) * scale));
                canvas.height = Math.max(1, Math.round((image.height || 1) * scale));
                const context = canvas.getContext('2d');
                if (!context) {
                    reject(new Error('Browser ini tidak dapat memproses foto.'));
                    return;
                }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            });
            image.src = String(reader.result);
        });
        reader.readAsDataURL(file);
    });

    const photoButton = (icon, label, action) => `<button type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${action}><span class="material-symbols-outlined" aria-hidden="true">${icon}</span></button>`;
    const photoTile = (source, index, total) => `<figure class="bbb-photo" data-photo-index="${index}">
        <img src="${escapeHtml(source)}" alt="Foto ${index + 1}${index === 0 ? ' (sampul)' : ''}" loading="lazy">
        ${index === 0 ? '<figcaption>Sampul</figcaption>' : ''}
        <div class="bbb-photo-actions">
            ${index === 0 ? '' : photoButton('star', 'Jadikan foto sampul', 'data-photo-cover')}
            ${photoButton('close', `Hapus foto ${index + 1}`, 'data-photo-remove')}
        </div>
        <span class="sr-only">${total} foto dipilih</span>
    </figure>`;

    /**
     * Menyatukan satu-satunya alat input foto di situs ini: area lepas-tempel
     * + daftar foto + sampul + hapus. Dipakai halaman tambah/edit produk dan
     * pengaturan profil.
     */
    const createPhotoPicker = ({ drop, grid, hint, input, max = MAX_PHOTOS, initial = [], label = 'foto' }) => {
        let photos = initial.filter(Boolean);
        const limit = max;

        const paint = () => {
            if (grid) grid.innerHTML = photos.map((photo, index) => photoTile(photo, index, photos.length)).join('');
            if (drop) drop.hidden = photos.length >= limit;
            if (hint) {
                const labelText = label === 'profil' ? 'foto profil' : 'foto produk';
                hint.textContent = photos.length
                    ? `${photos.length} dari ${limit} ${labelText} dipilih${photos.length < limit ? `. Sisanya masih bisa ditambahkan.` : '.'}`
                    : `Belum ada ${labelText}. Format JPG/PNG, maksimal ${limit} foto.`;
            }
            [drop, grid].filter(Boolean).forEach((node) => { node.hidden = node === drop && photos.length >= limit; });
            if (grid) grid.hidden = !photos.length;
        };

        const add = async (files) => {
            const incoming = [...(files || [])].filter(Boolean);
            if (!incoming.length) return;
            if (photos.length >= limit) {
                toast(`Maksimal ${limit} ${label === 'profil' ? 'foto profil' : 'foto produk'}.`);
                return;
            }
            let skipped = 0;
            for (const file of incoming) {
                if (photos.length >= limit) {
                    skipped += 1;
                    continue;
                }
                try {
                    photos.push(await readImageFile(file));
                } catch (error) {
                    skipped += 1;
                    toast(error.message);
                }
            }
            paint();
            if (skipped > 1) toast(`${skipped} berkas dilewati karena bukan gambar atau sudah penuh.`);
        };

        grid?.addEventListener('click', (event) => {
            const tile = event.target.closest('[data-photo-index]');
            if (!tile) return;
            const index = Number(tile.dataset.photoIndex);
            if (event.target.closest('[data-photo-remove]')) {
                photos.splice(index, 1);
                paint();
            }
            if (event.target.closest('[data-photo-cover]')) {
                const [photo] = photos.splice(index, 1);
                photos.unshift(photo);
                paint();
            }
        });
        input?.addEventListener('change', () => {
            add(input.files);
            input.value = '';
        });
        if (drop) {
            drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
            drop.addEventListener('drop', (event) => {
                event.preventDefault();
                drop.classList.remove('is-dragging');
                add(event.dataTransfer?.files);
            });
        }
        paint();
        return { value: () => photos.slice(), set: (next) => { photos = next.filter(Boolean); paint(); }, clear: () => { photos = []; paint(); } };
    };

    /* ------------------------------------------------------------------ *
     * Kerangka halaman (header, navigasi, footer)
     * ------------------------------------------------------------------ */

    const NAV_ITEMS = [
        ['beranda', 'home', 'Beranda'],
        ['marketplace', 'search', 'Cari barang'],
        ['tambah_produk', 'add_circle', 'Jual barang'],
        ['dashboard', 'person', 'Akun saya']
    ];

    const renderShell = () => {
        document.body.classList.add('bbb-app');
        document.querySelectorAll('header, nav, footer').forEach((node) => node.remove());
        const isAuthPage = AUTH_PAGES.has(currentPage);
        const user = currentUser();
        const active = currentPage === 'detail_produk' ? 'marketplace' : currentPage;

        const header = document.createElement('header');
        header.className = 'bbb-header';
        if (isAuthPage) {
            const secondary = currentPage === 'login'
                ? `<a class="bbb-header-action primary" href="${pageFor('registrasi')}">Buat akun</a>`
                : currentPage === 'registrasi'
                    ? `<a class="bbb-header-action primary" href="${pageFor('login')}">Masuk</a>`
                    : '';
            header.innerHTML = `<div class="bbb-shell bbb-header-inner bbb-auth-header">
                <a class="bbb-brand" href="${pageFor('beranda')}" aria-label="BBB.id — Beranda">BBB<span>.id</span></a>
                <div class="bbb-header-actions">
                    <a class="bbb-header-action" href="${pageFor('marketplace')}">Jelajahi marketplace</a>
                    ${secondary}
                </div>
            </div>`;
        } else {
            header.innerHTML = `<div class="bbb-shell bbb-header-inner">
                <a class="bbb-brand" href="${pageFor('beranda')}" aria-label="BBB.id — Beranda">BBB<span>.id</span></a>
                <nav class="bbb-primary-nav" aria-label="Navigasi utama">
                    <a href="${pageFor('beranda')}"${active === 'beranda' ? ' aria-current="page"' : ''}>Beranda</a>
                    <a href="${pageFor('marketplace')}"${active === 'marketplace' ? ' aria-current="page"' : ''}>Cari barang</a>
                    <a href="${pageFor('dashboard', { tab: 'products' })}"${active === 'dashboard' && new URLSearchParams(location.search).get('tab') !== 'purchases' ? ' aria-current="page"' : ''}>Dashboard</a>
                    <a href="${pageFor('dashboard', { tab: 'purchases' })}"${active === 'dashboard' && new URLSearchParams(location.search).get('tab') === 'purchases' ? ' aria-current="page"' : ''}>Pesanan</a>
                </nav>
                <form class="bbb-header-search" role="search" aria-label="Cari produk">
                    <input name="q" type="search" placeholder="Cari buku, elektronik, perlengkapan kos..." aria-label="Kata kunci produk" autocomplete="off">
                    <button type="submit">Cari</button>
                </form>
                <div class="bbb-header-actions">
                    <a class="bbb-header-action primary" href="${pageFor('tambah_produk')}">+ Jual barang</a>
                    ${user
                        ? `<a class="bbb-header-action" href="${pageFor('dashboard')}">Akun</a><button class="bbb-header-action" type="button" data-logout>Keluar</button>`
                        : `<a class="bbb-header-action" href="${pageFor('login')}">Masuk</a><a class="bbb-header-action" href="${pageFor('registrasi')}">Daftar</a>`}
                </div>
            </div>`;
        }
        document.body.prepend(header);

        if (!isAuthPage) {
            const bottom = document.createElement('nav');
            bottom.className = 'bbb-bottom-nav';
            bottom.setAttribute('aria-label', 'Navigasi mobile');
            bottom.innerHTML = NAV_ITEMS.map(([page, icon, name]) => `<a href="${pageFor(page)}"${active === page ? ' aria-current="page"' : ''}><span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span>${name}</span></a>`).join('');
            document.body.append(bottom);
        }

        const footer = document.createElement('footer');
        footer.className = 'bbb-footer';
        footer.innerHTML = `<div class="bbb-shell bbb-footer-inner">
            <span>© 2026 BBB.id · Pasar mahasiswa Magelang</span>
            <nav class="bbb-footer-links" aria-label="Tautan footer">
                <a href="${pageFor('beranda')}#tentang">Tentang</a>
                <a href="${pageFor('marketplace')}">Bantuan &amp; panduan</a>
                <a href="${pageFor('dashboard')}">Akun &amp; aktivitas</a>
            </nav>
        </div>`;
        document.body.append(footer);

        if (isAuthPage) {
            const carried = new URLSearchParams();
            const current = new URLSearchParams(location.search);
            ['next', 'tab', 'product', 'intent'].forEach((key) => { if (current.has(key)) carried.set(key, current.get(key)); });
            if (carried.size) {
                document.querySelectorAll('a[href*="login/login.html"], a[href*="registrasi/registrasi.html"], a[href*="lupa_password/lupa_password.html"]').forEach((anchor) => {
                    anchor.href = `${anchor.href.split('?')[0]}?${carried}`;
                });
            }
        }

        header.querySelector('[data-logout]')?.addEventListener('click', () => {
            const token = readSession()?.accessToken;
            sessionStorage.removeItem('bbb-session');
            localStorage.removeItem('bbb-session');
            toast('Kamu sudah keluar. Sampai jumpa lagi.');
            if (token) authRequest('logout', {}, { token }).catch((error) => console.error('Sesi server tidak dapat ditutup.', error));
            window.setTimeout(() => { location.href = pageFor('beranda'); }, 350);
        });
        header.querySelector('form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const query = header.querySelector('input').value.trim();
            location.href = pageFor('marketplace', query ? { q: query } : {});
        });
    };

    /* ------------------------------------------------------------------ *
     * Data produk
     * ------------------------------------------------------------------ */

    const cardImage = (product) => product.image || product.photos?.[0] || NO_IMAGE;

    const productFromCard = (card) => {
        const title = card.querySelector('h3, h4')?.textContent.trim();
        if (!title) return null;
        const image = card.querySelector('img')?.getAttribute('src')
            || card.querySelector('[style*="background-image"]')?.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]
            || '';
        const price = parsePrice(card.querySelector('.text-price-tag, [class*="price-tag"]')?.textContent);
        const badge = card.querySelector('[data-condition-label], [class*="rounded-full"]')?.textContent.trim() || '';
        const locationText = card.querySelector('[data-location-label]')?.textContent.trim()
            || card.textContent.match(/(?:UNTIDAR|UNIMMA|UMM|UAM|Tidar|Magelang Utara|Mertoyudan|Bandongan|Secang|Kota Magelang)/i)?.[0]
            || 'Magelang';
        const key = locationKey(locationText);
        const label = badge.toLowerCase();
        const condition = card.dataset.condition
            || (label === 'baru' || label === 'new' ? 'baru'
                : label.includes('seperti baru') || label.includes('like new') ? 'bekas-seperti-baru'
                    : 'bekas-pakai');
        return {
            id: slugify(title),
            title,
            price,
            image,
            location: key ? LOCATIONS[key] : (locationText || 'Magelang'),
            locationValue: key || '',
            condition: normalizeCondition(condition),
            description: `${title}. Barang preloved terawat dari mahasiswa Magelang. COD di sekitar ${key ? LOCATIONS[key] : 'kampus'}.`,
            category: inferCategory(title),
            status: 'active',
            createdAt: Date.now(),
            owner: 'Mahasiswa Magelang',
            seed: true
        };
    };

    const decorate = (product) => ({
        ...product,
        category: CATEGORIES[product.category] ? product.category : inferCategory(product.title),
        condition: normalizeCondition(product.condition),
        conditionLabel: CONDITIONS[normalizeCondition(product.condition)].label,
        location: locationLabel(product.locationValue || product.location),
        locationValue: locationKey(product.locationValue || product.location) || product.locationValue || '',
        image: cardImage(product)
    });

    const productFromApi = (product) => ({
        ...product,
        id: product.id,
        title: product.title,
        price: Number(product.price),
        condition: product.condition,
        location: locationLabel(product.location_code),
        locationValue: product.location_code,
        photos: product.photos || [],
        image: product.photos?.[0] || NO_IMAGE,
        status: product.status,
        owner: product.seller?.full_name || 'Penjual BBB.id',
        ownerId: product.seller_id,
        sellerCampus: product.seller?.campus || '',
        createdAt: Date.parse(product.created_at) || Date.now(),
        seed: false,
        cloud: true
    });
    const orderFromApi = (order) => ({
        id: order.id,
        productId: order.product_id,
        title: order.products?.title || 'Produk BBB.id',
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        sellerName: order.products?.seller?.full_name || '',
        price: Number(order.item_amount),
        fee: 0,
        sellerNet: Number(order.item_amount),
        fulfillment: order.fulfillment,
        paymentMethod: order.payment_method,
        meetingPoint: order.meeting_point,
        deliveryFeeEstimate: Number(order.delivery_fee),
        status: order.order_status,
        paymentStatus: order.payment_status,
        totalAmount: Number(order.total_amount),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        payment: order.payments?.find((payment) => payment.status === 'PENDING') || order.payments?.[0] || null
    });
    const hydrateProducts = async ({ mine = false, id = '' } = {}) => {
        const params = new URLSearchParams();
        if (mine) params.set('mine', '1');
        if (id) params.set('id', id);
        const requests = [apiRequest(`products${params.size ? `?${params}` : ''}`)];
        if (mine) requests.push(apiRequest('products'));
        const responses = await Promise.all(requests);
        const products = [...new Map(responses.flat().map((row) => [row.id, productFromApi(row)])).values()];
        const seeds = getStore('products').filter((product) => product.seed && Number(product.price) > 0 && !/^\d+[.)]\s/.test(product.title || ''));
        const merged = [...seeds, ...products];
        if (!setStore('products', merged)) throw new Error('Produk tidak dapat dimuat ke penyimpanan browser.');
        return merged;
    };
    const hydrateOrders = async () => {
        const rows = await apiRequest('orders');
        const orders = rows.map(orderFromApi);
        if (!setStore('orders', orders)) throw new Error('Pesanan tidak dapat dimuat ke penyimpanan browser.');
        return orders;
    };

    /** Menyimpan kartu statis HTML ke localStorage lalu menggabungkannya dengan produk pengguna. */
    const syncSeedProducts = () => {
        const collected = [
            ...[...document.querySelectorAll('#product-grid > [data-seed-card]')].map(productFromCard),
            ...[...document.querySelectorAll('[data-bbb-featured-products] [data-seed-card]')].map(productFromCard)
        ].filter(Boolean);
        if (!collected.length) return getStore('products').map(decorate);

        const stored = getStore('products')
            .filter((product) => product.cloud || (product.seed && Number(product.price) > 0 && !/^\d+[.)]\s/.test(product.title || '')))
            .map(decorate);
        const byId = new Map(stored.map((product) => [product.id, product]));
        collected.forEach((product) => {
            const existing = byId.get(product.id);
            if (!existing) byId.set(product.id, product);
            else byId.set(product.id, { ...existing, image: existing.image && existing.image !== NO_IMAGE ? existing.image : product.image });
        });
        const merged = [...byId.values()];
        setStore('products', merged);
        return merged;
    };

    const productCardMarkup = (product, options = {}) => {
        const { ownerActions = false } = options;
        return `<article class="bbb-user-product" data-product-id="${escapeHtml(product.id)}">
            <a class="bbb-card-link" href="${pageFor('detail_produk', { product: product.id })}">
                <img src="${escapeHtml(cardImage(product))}" alt="${escapeHtml(product.title)}" loading="lazy" width="400" height="400">
                <div class="bbb-user-product-body">
                    <span class="bbb-status"${product.status === 'sold' ? ' data-status="sold"' : ''}>${escapeHtml(CONDITIONS[normalizeCondition(product.condition)].label)}</span>
                    <h3>${escapeHtml(product.title)}</h3>
                    <p><strong>${rupiah(product.price)}</strong> · ${escapeHtml(product.location || 'Magelang')}</p>
                </div>
            </a>
            <button class="bbb-marketplace-chat" type="button" data-product-chat="${escapeHtml(product.id)}"><span class="material-symbols-outlined" aria-hidden="true">chat</span>${product.status === 'sold' ? 'Lihat barang' : 'Chat Penjual'}</button>
            ${ownerActions ? `<div class="bbb-user-product-actions">
                <button type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
                <button type="button" data-toggle-product="${escapeHtml(product.id)}" data-next-status="${product.status === 'sold' ? 'active' : 'sold'}">${product.status === 'sold' ? 'Aktifkan' : 'Tandai terjual'}</button>
                <button type="button" data-delete-product="${escapeHtml(product.id)}">Hapus</button>
            </div>` : ''}
        </article>`;
    };

    const emptyState = (message, actionLabel, page) => `<div class="bbb-empty"><p>${escapeHtml(message)}</p>${actionLabel ? `<a class="bbb-header-action primary" href="${pageFor(page)}">${escapeHtml(actionLabel)}</a>` : ''}</div>`;

    /* ------------------------------------------------------------------ *
     * Halaman beranda
     * ------------------------------------------------------------------ */

    const initHome = () => {
        syncSeedProducts();
        const featuredGrid = document.querySelector('[data-bbb-featured-products] .bbb-featured-grid');
        if (featuredGrid) {
            getStore('products')
                .filter((product) => product.cloud && product.status === 'active')
                .sort((left, right) => right.createdAt - left.createdAt)
                .slice(0, 4)
                .forEach((product) => {
                    if (featuredGrid.querySelector(`[data-product-id="${CSS.escape(product.id)}"]`)) return;
                    const template = document.createElement('template');
                    template.innerHTML = productCardMarkup(product);
                    featuredGrid.append(template.content.firstElementChild);
                });
        }
        document.querySelectorAll('[data-bbb-featured-products] [data-seed-card]').forEach((card) => {
            const title = card.querySelector('h3')?.textContent.trim();
            if (!title) return;
            const id = slugify(title);
            const stored = getStore('products').find((item) => item.id === id);
            card.dataset.productId = id;
            card.style.cursor = 'pointer';
            card.addEventListener('click', (event) => {
                if (event.target.closest('a, button')) return;
                location.href = pageFor('detail_produk', { product: id });
            });
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') location.href = pageFor('detail_produk', { product: id });
            });
            card.tabIndex = 0;
            card.setAttribute('role', 'link');
            card.querySelector('h3').innerHTML = `<a class="bbb-card-link" href="${pageFor('detail_produk', { product: id })}">${escapeHtml(title)}</a>`;
            if (stored?.status === 'sold') card.hidden = true;
        });
    };

    /* ------------------------------------------------------------------ *
     * Halaman marketplace
     * ------------------------------------------------------------------ */

    const initMarketplace = () => {
        const grid = document.querySelector('#product-grid');
        if (!grid) return;

        const products = syncSeedProducts();
        const byTitle = new Map(products.map((product) => [product.title, product]));
        const cards = [...grid.children].filter((card) => card.querySelector('h3, h4'));
        const useFallbackImage = (image) => {
            const apply = () => {
                if (image.dataset.fallbackApplied) return;
                image.dataset.fallbackApplied = 'true';
                image.src = NO_IMAGE;
            };
            image.addEventListener('error', apply);
            if (image.complete && image.naturalWidth === 0) apply();
        };

        /* 1. kartu bawaan HTML -> pakai data produk tersimpan bila ada */
        const knownIds = new Set();
        cards.forEach((card, order) => {
            const title = card.querySelector('h3, h4').textContent.trim();
            const match = byTitle.get(title);
            card.dataset.order = String(order);
            card.querySelectorAll('img').forEach(useFallbackImage);
            if (!match) return;
            knownIds.add(match.id);
            card.dataset.productId = match.id;
            card.dataset.category = match.category;
            card.dataset.condition = match.condition;
            card.dataset.price = String(match.price);
            card.dataset.location = match.location;
            card.dataset.locationKey = match.locationValue || '';
            card.dataset.status = match.status || 'active';
            card.dataset.search = `${match.title} ${match.location} ${match.category} ${match.description}`.toLowerCase();
            card.dataset.order = String(Number.isFinite(match.createdAt) ? match.createdAt : order);
            const heading = card.querySelector('h3, h4');
            if (heading && !heading.querySelector('a') && !heading.closest('a')) {
                heading.innerHTML = `<a class="bbb-card-link" href="${pageFor('detail_produk', { product: match.id })}">${escapeHtml(title)}</a>`;
            }
        });

        /* 2. produk milik pengguna yang belum tampil */
        const searchText = (product) => `${product.title} ${product.location} ${product.category} ${product.description || ''}`.toLowerCase();
        products
            .filter((product) => product.status !== 'sold' && !knownIds.has(product.id))
            .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
            .forEach((product, index) => {
                const template = document.createElement('template');
                template.innerHTML = productCardMarkup(product);
                const card = template.content.firstElementChild;
                card.dataset.category = product.category;
                card.dataset.condition = product.condition;
                card.dataset.price = String(product.price);
                card.dataset.location = product.location;
                card.dataset.locationKey = product.locationValue || '';
                card.dataset.status = product.status || 'active';
                card.dataset.search = searchText(product);
                card.dataset.order = String(Number.isFinite(product.createdAt) ? product.createdAt : 100000 + index);
                card.querySelectorAll('img').forEach(useFallbackImage);
                grid.append(card);
                cards.push(card);
            });

        /* 3. tombol chat bawaan HTML diarahkan ke produk yang benar */
        cards.forEach((card) => {
            const button = card.querySelector('[data-product-chat], button');
            const productId = button?.dataset.productChat || card.dataset.productId;
            if (!button || !productId) return;
            button.removeAttribute('onclick');
            if (!button.dataset.productChat) button.dataset.productChat = productId;
            button.addEventListener('click', () => {
                location.href = pageFor('detail_produk', { product: button.dataset.productChat, intent: 'chat' });
            });
        });

        /* 4. kontrol pencarian, filter, urutan */
        const pagination = document.querySelector('[data-marketplace-pagination]');
        const conditionButtons = [...document.querySelectorAll('[data-condition-filter]')];
        const pageButtons = [...document.querySelectorAll('[data-page]:not([data-page-step])')];
        const stepButtons = [...document.querySelectorAll('[data-page-step]')];
        const searchInputs = [...document.querySelectorAll('[data-marketplace-search], .bbb-header-search input')];
        const resultInfo = document.querySelector('#result-info');
        const sort = document.querySelector('#product-sort');
        const priceSlider = document.querySelector('input[type="range"][data-max-price]');
        const categoryChecks = [...document.querySelectorAll('aside input[type="checkbox"]')];
        const locationRadios = [...document.querySelectorAll('aside input[type="radio"][name="location"]')];
        const params = new URLSearchParams(location.search);

        const state = {
            condition: params.get('kondisi') || 'all',
            query: (params.get('q') || '').trim().toLowerCase(),
            category: params.get('kategori') || 'all',
            page: Math.max(1, Number(params.get('halaman')) || 1),
            maxPrice: priceSlider ? Number(priceSlider.max) : Number.POSITIVE_INFINITY,
            locationKey: params.get('lokasi') || '',
            sort: sort?.value || 'latest'
        };
        if (conditionButtons.length && !conditionButtons.some((button) => button.dataset.conditionFilter === state.condition)) state.condition = 'all';

        searchInputs.forEach((input) => {
            input.value = params.get('q') || '';
            input.addEventListener('input', () => {
                state.query = input.value.trim().toLowerCase();
                searchInputs.forEach((other) => { if (other !== input) other.value = input.value; });
                state.page = 1;
                render();
            });
        });

        categoryChecks.forEach((input) => {
            const label = (input.parentElement?.textContent || '').trim().toLowerCase();
            const key = label.includes('semua') ? 'all'
                : label.includes('buku') ? 'buku'
                    : label.includes('elektronik') ? 'elektronik'
                        : label.includes('fashion') ? 'pakaian'
                            : 'kost';
            input.dataset.category = key;
            input.checked = key === state.category;
            input.addEventListener('change', () => {
                if (key === 'all') {
                    categoryChecks.forEach((item) => { item.checked = item === input; });
                    state.category = 'all';
                } else {
                    const all = categoryChecks.find((item) => item.dataset.category === 'all');
                    if (all) all.checked = false;
                    const checked = categoryChecks.filter((item) => item.checked).map((item) => item.dataset.category);
                    state.category = checked.length ? [...new Set(checked)].join(',') : 'all';
                }
                state.page = 1;
                render();
            });
        });

        conditionButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.conditionFilter === state.condition);
            button.addEventListener('click', () => {
                state.condition = button.dataset.conditionFilter;
                state.page = 1;
                conditionButtons.forEach((item) => item.classList.toggle('is-active', item === button));
                render();
            });
        });

        locationRadios.forEach((radio) => {
            const key = locationKey(radio.value || radio.parentElement.textContent.trim());
            radio.dataset.locationKey = key;
            radio.checked = key === state.locationKey || (!key && !state.locationKey);
            radio.addEventListener('change', () => {
                state.locationKey = locationKey(radio.value || radio.parentElement.textContent.trim());
                state.page = 1;
                render();
            });
        });

        if (priceSlider) {
            const valueOutput = document.querySelector('[data-price-output]');
            const paint = () => {
                if (valueOutput) valueOutput.textContent = Number(priceSlider.value) >= Number(priceSlider.max) ? `${rupiah(Number(priceSlider.max))}+` : rupiah(Number(priceSlider.value));
            };
            priceSlider.addEventListener('input', () => {
                state.maxPrice = Number(priceSlider.value);
                state.page = 1;
                paint();
                render();
            });
            paint();
        }

        pageButtons.forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); render(); }));
        stepButtons.forEach((button) => button.addEventListener('click', () => { state.page += Number(button.dataset.pageStep); render(); }));
        sort?.addEventListener('change', () => { state.sort = sort.value; render(); });

        function render() {
            const categories = state.category.split(',');
            const visible = cards.filter((card) => {
                if (!card.dataset.productId || card.dataset.status === 'sold') return false;
                if (state.condition !== 'all' && card.dataset.condition !== state.condition) return false;
                if (state.category !== 'all' && !categories.includes(card.dataset.category)) return false;
                if (Number(card.dataset.price || 0) > state.maxPrice) return false;
                if (state.locationKey && card.dataset.locationKey !== state.locationKey) return false;
                if (state.query && !(card.dataset.search || card.textContent).toLowerCase().includes(state.query)) return false;
                return true;
            });
            const priceOf = (card) => Number(card.dataset.price || 0);
            if (state.sort === 'low') visible.sort((left, right) => priceOf(left) - priceOf(right));
            else if (state.sort === 'high') visible.sort((left, right) => priceOf(right) - priceOf(left));
            else visible.sort((left, right) => {
                const leftOrder = Number(left.dataset.order || 0);
                const rightOrder = Number(right.dataset.order || 0);
                return leftOrder === rightOrder ? 0 : leftOrder > rightOrder ? -1 : 1;
            });

            const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
            state.page = Math.min(Math.max(1, state.page), pages);
            const slice = visible.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
            const shown = new Set(slice);
            cards.forEach((card) => { card.hidden = !shown.has(card); });

            grid.querySelector('.bbb-empty')?.remove();
            if (!visible.length) grid.insertAdjacentHTML('beforeend', emptyState('Belum ada produk yang cocok. Ubah kata kunci, kategori, atau filter lokasi.', 'Atur ulang filter', 'marketplace'));
            if (!shown.size) {
                grid.querySelector('.bbb-empty')?.addEventListener('click', (event) => {
                    if (!event.target.closest('a')) return;
                    state.category = 'all';
                    state.condition = 'all';
                    state.query = '';
                    state.locationKey = '';
                    state.maxPrice = priceSlider ? Number(priceSlider.max) : Number.POSITIVE_INFINITY;
                    if (priceSlider) priceSlider.value = priceSlider.max;
                    categoryChecks.forEach((item) => { item.checked = item.dataset.category === 'all'; });
                    locationRadios.forEach((item) => { item.checked = !item.dataset.locationKey; });
                    conditionButtons.forEach((item) => item.classList.toggle('is-active', item.dataset.conditionFilter === 'all'));
                    searchInputs.forEach((item) => { item.value = ''; });
                    state.page = 1;
                    render();
                });
            }

            if (resultInfo) {
                resultInfo.replaceChildren(
                    document.createTextNode('Menampilkan '),
                    Object.assign(document.createElement('strong'), { textContent: `${slice.length} dari ${visible.length}` }),
                    document.createTextNode(state.query ? ` produk untuk "${state.query}"` : ' produk ditemukan')
                );
            }
            if (pagination) {
                pageButtons.forEach((button) => {
                    const number = Number(button.dataset.page);
                    button.hidden = number > pages;
                    button.setAttribute('aria-current', number === state.page ? 'page' : 'false');
                });
                const dots = pagination.querySelector('[data-page-dots]');
                if (dots) dots.hidden = pages <= 3;
                stepButtons.forEach((button) => {
                    const step = Number(button.dataset.pageStep);
                    button.disabled = step < 0 ? state.page === 1 : state.page === pages;
                });
            }

            const next = new URLSearchParams(location.search);
            const sync = (key, value) => (value ? next.set(key, value) : next.delete(key));
            sync('q', state.query);
            sync('halaman', state.page > 1 ? String(state.page) : '');
            sync('kategori', state.category === 'all' ? '' : state.category);
            sync('kondisi', state.condition === 'all' ? '' : state.condition);
            sync('lokasi', state.locationKey);
            history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
        }
        render();
    };

    /* ------------------------------------------------------------------ *
     * Halaman tambah / edit produk
     * ------------------------------------------------------------------ */

    const initForm = () => {
        const form = document.querySelector('#product-form');
        if (!form) return;
        form.noValidate = true;
        const picker = createPhotoPicker({
            drop: form.querySelector('[data-photo-drop]'),
            grid: form.querySelector('[data-photo-grid]'),
            hint: form.querySelector('[data-photo-hint]'),
            input: form.querySelector('[data-photo-input]'),
            initial: []
        });

        const priceInput = form.elements.price;
        const priceOutput = form.querySelector('[data-price-output]');
        const paintPrice = () => {
            if (!priceOutput) return;
            const value = Number(priceInput.value);
            priceOutput.textContent = value > 0 ? rupiah(value) : 'Belum diisi';
        };
        priceInput?.addEventListener('input', paintPrice);
        paintPrice();

        const description = form.elements.description;
        const counter = form.querySelector('[data-description-count]');
        const paintCount = () => {
            if (!counter) return;
            const max = Number(description.getAttribute('maxlength')) || 1000;
            counter.textContent = `${description.value.length}/${max} karakter`;
        };
        description?.addEventListener('input', paintCount);
        paintCount();

        const params = new URLSearchParams(location.search);
        const editId = params.get('edit');
        const user = currentUser();
        const existing = editId ? getStore('products').find((item) => item.id === editId) : null;
        if (editId && (!existing || !user || (existing.ownerId !== user.id && existing.owner !== user.name))) {
            toast('Produk ini tidak tersedia atau bukan milik akunmu.');
            location.replace(pageFor('dashboard', { tab: 'products' }));
            return;
        }

        if (existing) {
            form.elements.product_name.value = existing.title || '';
            if ([...form.elements.category.options].some((option) => option.value === existing.category)) form.elements.category.value = existing.category;
            form.elements.price.value = existing.price ?? '';
            const locationValue = [...form.elements.location.options].some((option) => option.value === existing.locationValue) ? existing.locationValue : locationKey(existing.location);
            if (locationValue) form.elements.location.value = locationValue;
            form.elements.description.value = existing.description || '';
            const condition = { 'bekas-seperti-baru': 'seperti_baru', 'bekas-pakai': 'baik' }[normalizeCondition(existing.condition)] || 'baru';
            form.querySelector(`input[name="condition"][value="${CSS.escape(condition)}"]`)?.click();
            picker.set([...(existing.photos || []), existing.image].filter(Boolean));
            const heading = document.querySelector('main h1');
            if (heading) heading.textContent = 'Edit produk';
            const submitLabel = form.querySelector('[data-submit-label]');
            if (submitLabel) submitLabel.textContent = 'Simpan perubahan';
            form.querySelector('[data-cancel-product]')?.setAttribute('aria-label', 'Batal edit produk');
        }
        paintPrice();
        paintCount();

        form.querySelector('[data-cancel-product]')?.addEventListener('click', () => {
            location.href = pageFor('dashboard', { tab: 'products' });
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            const photos = picker.value();
            if (!photos.length) {
                toast('Tambahkan minimal satu foto produk agar pembeli bisa melihat barangnya.');
                form.querySelector('[data-photo-drop]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                form.querySelector('[data-photo-drop] input')?.focus();
                return;
            }
            const values = new FormData(form);
            const title = String(values.get('product_name')).trim();
            const price = Number(values.get('price'));
            if (!(price >= 1000)) {
                toast('Harga minimal Rp 1.000 agar layak diposting di marketplace.');
                priceInput.focus();
                return;
            }
            const submit = form.querySelector('[type="submit"]');
            submit.disabled = true;
            submit.querySelector('[data-submit-label]')?.replaceChildren(document.createTextNode('Menyimpan…'));
            try {
                const token = await tokenFromSession();
                if (!token) throw new Error('Sesi akun sudah berakhir. Masuk kembali untuk menyimpan produk.');
                const storedPhotos = await Promise.all(photos.map((photo, index) =>
                    photo.startsWith('data:') ? uploadImage(photo, token, user.id, `produk-${index + 1}.jpg`) : photo));
                const payload = {
                    title,
                    category: String(values.get('category')),
                    price,
                    condition: normalizeCondition(values.get('condition')),
                    location_code: locationKey(values.get('location')) || String(values.get('location')),
                    description: String(values.get('description')).trim(),
                    photos: storedPhotos
                };
                const saved = await apiRequest('products', {
                    method: existing?.cloud ? 'PATCH' : 'POST',
                    body: existing?.cloud ? { ...payload, id: existing.id } : payload,
                    token
                });
                const product = productFromApi(saved);
                const products = getStore('products').filter((item) => item.id !== product.id);
                if (!setStore('products', [...products, product])) return;
                saveFlash(existing ? 'Perubahan produk berhasil disimpan.' : 'Produk berhasil dipublikasikan.');
                location.href = pageFor('dashboard', { tab: 'products' });
            } catch (error) {
                console.error('Produk tidak dapat disimpan ke Supabase.', error);
                toast(error.message || 'Produk tidak dapat disimpan. Coba lagi.');
            } finally {
                submit.disabled = false;
                const label = submit.querySelector('[data-submit-label]');
                if (label) label.textContent = existing ? 'Simpan perubahan' : 'Terbitkan produk';
            }
        });
    };

    /* ------------------------------------------------------------------ *
     * Halaman detail produk
     * ------------------------------------------------------------------ */

    const initDetail = () => {
        const main = document.querySelector('main');
        const titleNode = document.querySelector('main h1');
        if (!main || !titleNode) return;
        let productId = new URLSearchParams(location.search).get('product');
        const products = getStore('products');
        let product = products.find((item) => item.id === productId);

        if (!product) {
            const title = titleNode.textContent.trim();
            const price = parsePrice(main.querySelector('.text-price-tag')?.textContent);
            if (!productId) productId = 'sepatu-lari-nike-flex-experience-rn-8';
            product = {
                id: productId,
                title,
                price,
                image: main.querySelector('img[data-gallery-main]')?.getAttribute('src') || '',
                location: LOCATIONS.untidar,
                locationValue: 'untidar',
                category: 'pakaian',
                condition: 'bekas-seperti-baru',
                description: main.querySelector('[data-description]')?.textContent.trim() || '',
                status: 'active',
                seed: true,
                owner: 'Mahasiswa Magelang',
                createdAt: Date.now()
            };
            setStore('products', [...products, product]);
        }
        const item = product;
        const seller = item.ownerId ? getStore('users', []).find((candidate) => candidate.id === item.ownerId) : null;

        titleNode.textContent = item.title;
        document.title = `${item.title} - BBB.id`;
        const priceNode = main.querySelector('.text-price-tag');
        if (priceNode) priceNode.textContent = rupiah(item.price);
        const conditionBadge = main.querySelector('[data-condition-badge]');
        if (conditionBadge) conditionBadge.textContent = CONDITIONS[normalizeCondition(item.condition)].label;
        const campusNode = main.querySelector('[data-seller-campus]');
        if (campusNode) campusNode.textContent = item.sellerCampus || 'Kampus belum diisi';
        const ownerNode = main.querySelector('[data-seller-name]');
        if (ownerNode) ownerNode.textContent = seller?.name || item.owner || 'Mahasiswa BBB.id';

        /* galeri: foto utama, thumbnail, tombol "+n foto" */
        const gallery = main.querySelector('[data-gallery]');
        const mainImage = main.querySelector('[data-gallery-main]');
        const photos = [item.image, ...(item.photos || [])].filter(Boolean);
        const galleryImages = photos.length ? photos : [mainImage?.getAttribute('src')].filter(Boolean);
        if (gallery && mainImage) {
            const useFallback = () => { if (!mainImage.dataset.fallbackApplied) { mainImage.dataset.fallbackApplied = '1'; mainImage.src = NO_IMAGE; } };
            mainImage.addEventListener('error', useFallback);
            if (mainImage.complete && mainImage.naturalWidth === 0) useFallback();
            mainImage.src = galleryImages[0];
            const paint = (active) => {
                gallery.querySelectorAll('[data-gallery-item]').forEach((node, index) => {
                    node.setAttribute('aria-pressed', String(index === active));
                });
            };
            gallery.innerHTML = galleryImages.slice(0, 3).map((source, index) => `<button class="bbb-gallery-item" type="button" data-gallery-item aria-pressed="${index === 0}" aria-label="Tampilkan foto ${index + 1}"><img src="${escapeHtml(source)}" alt="Foto produk ${index + 1}" loading="lazy"></button>`).join('')
                + (galleryImages.length > 3
                    ? `<button class="bbb-gallery-more" type="button" data-gallery-more aria-label="Tampilkan ${galleryImages.length} foto">+${galleryImages.length - 3} foto</button>`
                    : '');
            gallery.addEventListener('click', (event) => {
                const more = event.target.closest('[data-gallery-more]');
                if (more) {
                    toast(`Produk ini punya ${galleryImages.length} foto. Ketuk foto untuk melihatnya satu per satu.`);
                    return;
                }
                const node = event.target.closest('[data-gallery-item]');
                if (!node) return;
                const index = [...gallery.children].filter((child) => child.hasAttribute('data-gallery-item')).indexOf(node);
                if (index < 0) return;
                mainImage.src = galleryImages[index];
                paint(index);
            });
            paint(0);
        }

        /* deskripsi: satu paragraf per baris kosong */
        const descriptionNode = main.querySelector('[data-description]');
        if (descriptionNode && item.description) {
            descriptionNode.innerHTML = String(item.description)
                .split(/\n{2,}/)
                .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
                .join('');
        }

        /* FOTO PENJUAL: pakai foto profil bila ada */
        const sellerAvatar = main.querySelector('[data-seller-avatar]');
        if (sellerAvatar) {
            const avatar = document.createElement('div');
            avatar.className = 'bbb-avatar bbb-seller-avatar';
            avatar.setAttribute('aria-hidden', 'true');
            if (seller?.avatar) avatar.innerHTML = `<img src="${escapeHtml(seller.avatar)}" alt="">`;
            else avatar.textContent = initials(seller?.name || item.owner);
            sellerAvatar.replaceWith(avatar);
        }

        /* ulasan */
        const reviews = getStore('reviews').filter((review) => review.productId === item.id);
        const reviewMean = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1) : '0.0';
        const ratingNode = main.querySelector('[data-product-rating]');
        const reviewCount = main.querySelector('[data-review-count]');
        const reviewEmpty = main.querySelector('[data-review-empty]');
        const reviewList = main.querySelector('[data-product-review-list]');
        if (ratingNode) ratingNode.textContent = reviewMean;
        if (reviewCount) reviewCount.textContent = reviews.length ? `${reviews.length} ulasan` : 'Belum ada ulasan';
        if (reviewEmpty) reviewEmpty.hidden = reviews.length > 0;
        if (reviewList) {
            reviewList.innerHTML = reviews.slice(0, 5).map((review) => {
                const author = getStore('users', []).find((candidate) => candidate.id === review.buyerId);
                return `<article class="bbb-product-review">
                    <div class="bbb-product-review-head"><strong>${escapeHtml(author?.name || 'Pembeli BBB.id')}</strong><span class="bbb-review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} ${review.rating}/5</span></div>
                    ${review.comment ? `<p>${escapeHtml(review.comment)}</p>` : '<p>Tanpa komentar tambahan.</p>'}
                </article>`;
            }).join('');
        }

        /* komisi penjual */
        const feeNode = main.querySelector('[data-fee-info]');
        if (feeNode) {
            const fee = Math.round(item.price * sellerFeeRate(item.price));
            feeNode.textContent = `Komisi penjual BBB.id ${Math.round(sellerFeeRate(item.price) * 100)}% (${rupiah(fee)}) dipotong setelah transaksi selesai. Harga yang kamu bayar tetap ${rupiah(item.price)}.`;
        }

        /* wishlist */
        const wishButton = main.querySelector('[data-wishlist-toggle]');
        const paintWish = (on) => {
            if (!wishButton) return;
            wishButton.setAttribute('aria-pressed', String(on));
            wishButton.setAttribute('aria-label', on ? 'Hapus dari wishlist' : 'Simpan ke wishlist');
            wishButton.querySelector('.material-symbols-outlined')?.classList.toggle('icon-fill', on);
        };
        paintWish(getAccountStore('wishlist').includes(item.id));
        wishButton?.addEventListener('click', () => {
            if (!requestLogin('detail_produk', 'wishlist')) return;
            const saved = getAccountStore('wishlist');
            const exists = saved.includes(item.id);
            if (setAccountStore('wishlist', exists ? saved.filter((id) => id !== item.id) : [...saved, item.id])) {
                paintWish(!exists);
                toast(exists ? 'Produk dihapus dari wishlist.' : 'Produk tersimpan di wishlist.');
            }
        });

        /* aksi beli / tawar / chat */
        const buyer = currentUser();
        const busy = getStore('orders').some((order) => order.productId === item.id && !['cancelled', 'completed'].includes(order.status));
        const ownProduct = buyer && item.ownerId === buyer.id;
        const buyButton = main.querySelector('[data-buy-now]');
        if (buyButton) {
            if (!item.cloud) {
                buyButton.disabled = true;
                buyButton.textContent = 'Pemesanan belum tersedia';
                buyButton.title = 'Pilih barang yang dipublikasikan ke katalog akun BBB.id.';
            } else if (item.status === 'sold') {
                buyButton.disabled = true;
                buyButton.textContent = 'Produk terjual';
            } else if (ownProduct) {
                buyButton.disabled = true;
                buyButton.textContent = 'Produk milikmu';
            } else if (busy) {
                buyButton.disabled = true;
                buyButton.textContent = 'Menunggu transaksi';
            }
        }

        const openModal = (heading, label, kind, callback) => {
            const previous = document.activeElement;
            const backdrop = document.createElement('div');
            backdrop.className = 'bbb-modal-backdrop';
            const field = kind === 'textarea'
                ? `<textarea id="bbb-modal-input" maxlength="500" required></textarea>`
                : `<input id="bbb-modal-input" type="${kind}" ${kind === 'number' ? `inputmode="numeric" min="1000" step="1000" max="${Math.max(item.price - 1000, 1000)}"` : 'maxlength="120"'} required>`;
            backdrop.innerHTML = `<section class="bbb-modal" role="dialog" aria-modal="true" aria-labelledby="bbb-modal-title">
                <h2 id="bbb-modal-title">${escapeHtml(heading)}</h2>
                <p>${escapeHtml(item.title)}</p>
                <form><label for="bbb-modal-input">${escapeHtml(label)}</label>${field}
                    <div class="bbb-modal-actions"><button type="button" data-modal-cancel>Batal</button><button type="submit" data-modal-submit>Konfirmasi</button></div>
                </form>
            </section>`;
            document.body.append(backdrop);
            const close = () => {
                backdrop.remove();
                if (previous instanceof HTMLElement) previous.focus();
            };
            backdrop.querySelector('[data-modal-cancel]').addEventListener('click', close);
            backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
            backdrop.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
            backdrop.querySelector('form').addEventListener('submit', (event) => {
                event.preventDefault();
                const input = backdrop.querySelector('#bbb-modal-input');
                const value = input.value.trim();
                if (!input.reportValidity() || !value) return;
                if (callback(value) !== false) close();
            });
            const input = backdrop.querySelector('#bbb-modal-input');
            if (kind === 'number') {
                input.addEventListener('input', () => {
                    const amount = Number(input.value);
                    backdrop.querySelector('[data-modal-submit]').disabled = !amount || amount >= item.price;
                });
                backdrop.querySelector('[data-modal-submit]').disabled = true;
            }
            input.focus();
        };

        const openCheckout = () => {
            if (!requestLogin('detail_produk', 'checkout')) return;
            const account = currentUser();
            if (item.ownerId && item.ownerId === account.id) {
                toast('Kamu tidak dapat membeli produk milik sendiri.');
                return;
            }
            if (item.status === 'sold') {
                toast('Produk ini sudah terjual.');
                return;
            }
            const commission = Math.round(item.price * sellerFeeRate(item.price));
            const deliveryFee = 12000;
            const backdrop = document.createElement('div');
            backdrop.className = 'bbb-modal-backdrop';
            backdrop.innerHTML = `<section class="bbb-modal bbb-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="bbb-modal-title">
                <h2 id="bbb-modal-title">Atur transaksi lokal</h2>
                <p>${escapeHtml(item.title)} · ${rupiah(item.price)}</p>
                <form>
                    <label for="bbb-fulfillment">Cara menerima barang</label>
                    <select id="bbb-fulfillment" required>
                        <option value="meetup">COD / ambil langsung</option>
                        <option value="delivery">Antar dalam Kota Magelang (estimasi ongkir)</option>
                    </select>
                    <label for="bbb-payment-method">Metode pembayaran</label>
                    <select id="bbb-payment-method" required>
                        <option value="cod">Bayar langsung ke penjual (COD)</option>
                        <option value="online">Bayar online melalui YoBasePay</option>
                    </select>
                    <label for="bbb-meetup">Titik pertemuan atau patokan antar</label>
                    <input id="bbb-meetup" maxlength="120" placeholder="Contoh: gerbang UNTIDAR / area Alun-Alun Magelang" required>
                    <div class="bbb-checkout-summary">
                        <div><span>Harga barang</span><strong>${rupiah(item.price)}</strong></div>
                        <div data-delivery-line hidden><span>Estimasi pengiriman</span><strong>${rupiah(deliveryFee)}</strong></div>
                        <div class="bbb-checkout-total"><span data-payment-label>Perkiraan total pesanan</span><strong data-checkout-total>${rupiah(item.price)}</strong></div>
                    </div>
                    <p class="bbb-checkout-note" data-payment-note>Penjual akan mengonfirmasi ketersediaan barang sebelum pembayaran.</p>
                    <p class="bbb-checkout-note">Komisi penjual BBB.id ${Math.round(sellerFeeRate(item.price) * 100)}% (${rupiah(commission)}) dipotong dari harga barang setelah transaksi selesai.</p>
                    <div class="bbb-modal-actions"><button type="button" data-modal-cancel>Batal</button><button type="submit" data-modal-submit>Ajukan pesanan</button></div>
                </form>
            </section>`;
            document.body.append(backdrop);
            const fulfillment = backdrop.querySelector('#bbb-fulfillment');
            const paymentMethod = backdrop.querySelector('#bbb-payment-method');
            const meetingPoint = backdrop.querySelector('#bbb-meetup');
            const deliveryLine = backdrop.querySelector('[data-delivery-line]');
            const totalNode = backdrop.querySelector('[data-checkout-total]');
            const paymentLabel = backdrop.querySelector('[data-payment-label]');
            const paymentNote = backdrop.querySelector('[data-payment-note]');
            const close = () => backdrop.remove();
            const estimate = () => {
                const delivery = fulfillment.value === 'delivery' ? deliveryFee : 0;
                deliveryLine.hidden = !delivery;
                meetingPoint.required = true;
                totalNode.textContent = rupiah(item.price + delivery);
                paymentLabel.textContent = paymentMethod.value === 'online' ? 'Total tagihan YoBasePay' : 'Perkiraan total pesanan';
                paymentNote.textContent = paymentMethod.value === 'online'
                    ? 'Setelah penjual mengonfirmasi, tagihan YoBasePay akan dibuat untuk nominal pesanan yang tersimpan.'
                    : 'Bayar langsung ke penjual setelah barang diterima atau saat COD.';
            };
            fulfillment.addEventListener('change', estimate);
            paymentMethod.addEventListener('change', estimate);
            backdrop.querySelector('[data-modal-cancel]').addEventListener('click', close);
            backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
            backdrop.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
            backdrop.querySelector('form').addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                if (!form.reportValidity()) return;
                const submit = form.querySelector('[type="submit"]');
                submit.disabled = true;
                submit.textContent = 'Mencatat pesanan…';
                try {
                    const saved = await apiRequest('orders', {
                        method: 'POST',
                        body: {
                            product_id: item.id,
                            fulfillment: fulfillment.value,
                            payment_method: paymentMethod.value,
                            meeting_point: meetingPoint.value.trim()
                        }
                    });
                    const orders = getStore('orders').filter((order) => order.id !== saved.id);
                    if (!setStore('orders', [...orders, orderFromApi(saved)])) return;
                    saveFlash('Pesanan tercatat. Penjual akan mengonfirmasi sebelum pembayaran.');
                    location.href = pageFor('dashboard', { tab: 'purchases' });
                } catch (error) {
                    console.error('Pesanan tidak dapat dibuat.', error);
                    toast(error.message || 'Pesanan tidak dapat dibuat. Coba lagi.');
                    submit.disabled = false;
                    submit.textContent = 'Ajukan pesanan';
                }
            });
            estimate();
            fulfillment.focus();
        };

        main.querySelector('[data-chat-seller]')?.addEventListener('click', () => {
            if (!requestLogin('detail_produk', 'chat')) return;
            if (item.ownerId && item.ownerId === currentUser().id) {
                toast('Ini produk milikmu. Kelola dari Dashboard → Produk saya.');
                return;
            }
            openModal('Hubungi penjual', 'Pesan untuk penjual', 'textarea', (message) => {
                const sender = currentUser();
                const recipient = item.ownerId || '';
                const threadId = `${item.id}:${sender.id}:${recipient || 'seller'}`;
                const threads = getStore('threads');
                let thread = threads.find((candidate) => candidate.id === threadId);
                if (!thread) {
                    thread = { id: threadId, productId: item.id, productTitle: item.title, buyerId: sender.id, sellerId: recipient, sellerName: item.owner || 'Penjual BBB.id', messages: [] };
                    threads.push(thread);
                }
                thread.messages.push({ senderId: sender.id, text: message, createdAt: new Date().toISOString() });
                if (setStore('threads', threads)) {
                    toast('Pesan terkirim. Lanjutkan di Dashboard → Pesan.');
                    window.setTimeout(() => { location.href = pageFor('dashboard', { tab: 'messages' }); }, 700);
                }
            });
        });

        main.querySelector('[data-make-offer]')?.addEventListener('click', () => {
            if (!requestLogin('detail_produk', 'offer')) return;
            openModal('Ajukan harga', 'Tawaran kamu (dari harga barang)', 'number', (amount) => {
                const offer = Number(amount);
                if (!offer || offer >= item.price) {
                    toast('Harga tawaran harus lebih rendah dari harga barang.');
                    return false;
                }
                const offers = getStore('offers');
                offers.push({
                    id: `offer-${Date.now().toString(36)}`,
                    userId: currentUser().id,
                    sellerId: item.ownerId || '',
                    productId: item.id,
                    title: item.title,
                    amount: offer,
                    status: 'pending',
                    date: new Date().toISOString()
                });
                if (setStore('offers', offers)) toast(`Tawaran ${rupiah(offer)} berhasil dicatat.`);
                return true;
            });
        });
        buyButton?.addEventListener('click', openCheckout);

        /* produk serupa: sembunyikan bila tidak ada data */
        const similar = [...main.querySelectorAll('[data-similar-card]')].map((card) => {
            const title = card.querySelector('h3')?.textContent.trim() || '';
            const stored = getStore('products').find((candidate) => candidate.title === title);
            if (!stored) {
                card.remove();
                return null;
            }
            card.dataset.productId = stored.id;
            const anchor = card.querySelector('h3 a');
            if (anchor) anchor.href = pageFor('detail_produk', { product: stored.id });
            const image = card.querySelector('img');
            if (image) image.src = cardImage(stored);
            const price = card.querySelector('.text-price-tag');
            if (price) price.textContent = rupiah(stored.price);
            card.addEventListener('click', (event) => {
                if (event.target.closest('a, button')) return;
                location.href = pageFor('detail_produk', { product: stored.id });
            });
            card.tabIndex = 0;
            return stored;
        }).filter(Boolean);
        const similarSection = main.querySelector('[data-similar]');
        if (similarSection && !similar.length) similarSection.remove();

        /* intent: lanjutkan aksi setelah login */
        const intent = new URLSearchParams(location.search).get('intent');
        if (intent && INTENT_KEYS.includes(intent)) {
            const target = {
                wishlist: wishButton,
                chat: main.querySelector('[data-chat-seller]'),
                offer: main.querySelector('[data-make-offer]'),
                checkout: buyButton
            }[intent];
            const clean = new URLSearchParams(location.search);
            clean.delete('intent');
            history.replaceState(null, '', `${location.pathname}${clean.size ? `?${clean}` : ''}`);
            if (target && !target.disabled) window.setTimeout(() => target.click(), 120);
        }
    };

    /* ------------------------------------------------------------------ *
     * Halaman dashboard
     * ------------------------------------------------------------------ */

    const initDashboard = () => {
        const shell = document.querySelector('[data-dashboard]');
        const user = currentUser();
        if (!shell || !user) return;

        const ownedProduct = (product) => product.ownerId === user.id || (!product.ownerId && product.owner === user.name);
        const decorateAvatar = (node) => {
            if (!node) return;
            node.innerHTML = user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : escapeHtml(initials(user.name));
        };

        /* profil */
        const nameNode = shell.querySelector('[data-profile-name]');
        const campusNode = shell.querySelector('[data-profile-campus]');
        const verification = shell.querySelector('[data-verification-status]');
        const ratingNode = shell.querySelector('[data-profile-rating]');
        const transactionNode = shell.querySelector('[data-dashboard-transactions]');
        const productCountNode = shell.querySelector('[data-dashboard-products]');
        const paintProfile = () => {
            if (nameNode) nameNode.textContent = user.name;
            if (campusNode) campusNode.textContent = user.campus || 'Kampus belum diisi';
            if (verification) {
                const verified = user.verificationStatus === 'verified';
                verification.textContent = verified ? 'Mahasiswa terverifikasi' : 'Verifikasi mahasiswa belum selesai';
                verification.dataset.verified = String(verified);
            }
            const reviews = getStore('reviews').filter((review) => review.sellerId === user.id);
            if (ratingNode) ratingNode.textContent = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1) : '0.0';
            if (transactionNode) transactionNode.textContent = String(getStore('orders').filter((order) => order.status === 'completed' && [order.buyerId, order.sellerId].includes(user.id)).length);
            if (productCountNode) productCountNode.textContent = String(getStore('products').filter((item) => !item.seed && ownedProduct(item)).length);
            shell.querySelectorAll('[data-profile-avatar]').forEach(decorateAvatar);
        };
        paintProfile();

        /* tab tanpa reload supaya tidak berkedip */
        const tabList = [...shell.querySelectorAll('[data-dashboard-tab]')];
        const content = shell.querySelector('#dashboard-content');
        const flash = sessionStorage.getItem('bbb-flash');
        if (flash) sessionStorage.removeItem('bbb-flash');

        const counts = () => ({
            products: getStore('products').filter((item) => !item.seed && ownedProduct(item)).length,
            purchases: getStore('orders').filter((order) => [order.buyerId, order.sellerId].includes(user.id)).length,
            wishlist: getAccountStore('wishlist').length,
            offers: getStore('offers').filter((offer) => offer.userId === user.id || offer.sellerId === user.id).length,
            messages: getStore('threads').filter((thread) => [thread.buyerId, thread.sellerId].includes(user.id)).length,
            settings: 0
        });
        const paintTabs = (active) => {
            const values = counts();
            tabList.forEach((tab) => {
                const id = tab.dataset.dashboardTab;
                tab.classList.toggle('active', id === active);
                tab.setAttribute('aria-current', id === active ? 'page' : 'false');
                const badge = tab.querySelector('.bbb-tab-count');
                if (badge) badge.textContent = values[id] ? String(values[id]) : '';
            });
        };

        const heading = (title, description, action = '') => `<div class="bbb-dashboard-heading"><div><h2>${escapeHtml(title)}</h2>${description ? `<p class="bbb-dashboard-description">${description}</p>` : ''}</div>${action}</div>`;

        const renderProducts = () => {
            content.innerHTML = heading('Produk yang kamu jual', 'Produk berstatus tayang tampil di marketplace. Tandai terjual agar hilang dari pencarian.', `<a class="bbb-dashboard-cta" href="${pageFor('tambah_produk')}">+ Tambah produk</a>`)
                + '<div class="bbb-dashboard-grid" id="user-product-list"></div>';
            const list = content.querySelector('#user-product-list');
            const items = getStore('products').filter((item) => !item.seed && ownedProduct(item))
                .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
            if (!items.length) {
                list.innerHTML = emptyState('Belum ada produk yang kamu jual.', 'Pasang produk pertamamu', 'tambah_produk');
            } else {
                items.forEach((item) => list.insertAdjacentHTML('beforeend', productCardMarkup(item, { ownerActions: true })));
            }
            list.addEventListener('click', async (event) => {
                const edit = event.target.closest('[data-edit-product]');
                const remove = event.target.closest('[data-delete-product]');
                const toggle = event.target.closest('[data-toggle-product]');
                if (edit) location.href = pageFor('tambah_produk', { edit: edit.dataset.editProduct });
                if (remove && window.confirm('Hapus produk ini? Tindakan ini tidak bisa dibatalkan.')) {
                    try {
                        await apiRequest('products', { method: 'DELETE', body: { id: remove.dataset.deleteProduct } });
                        if (!setStore('products', getStore('products').filter((item) => item.id !== remove.dataset.deleteProduct))) return;
                        toast('Produk berhasil dihapus.');
                        paint();
                    } catch (error) {
                        console.error('Produk tidak dapat dihapus.', error);
                        toast(error.message || 'Produk tidak dapat dihapus.');
                    }
                }
                if (toggle) {
                    const products = getStore('products');
                    const item = products.find((product) => product.id === toggle.dataset.toggleProduct);
                    if (!item) return;
                    try {
                        const saved = await apiRequest('products', {
                            method: 'PATCH',
                            body: { id: item.id, status: toggle.dataset.nextStatus === 'sold' ? 'sold' : 'active' }
                        });
                        item.status = saved.status;
                        if (!setStore('products', products)) return;
                        toast(item.status === 'sold' ? 'Produk ditandai terjual.' : 'Produk kembali tayang.');
                        paint();
                    } catch (error) {
                        console.error('Status produk tidak dapat diperbarui.', error);
                        toast(error.message || 'Status produk tidak dapat diperbarui.');
                    }
                }
            });
        };

        const renderWishlist = () => {
            const ids = getAccountStore('wishlist');
            const items = getStore('products').filter((item) => ids.includes(item.id));
            content.innerHTML = heading('Wishlist kamu', 'Simpan barang yang ingin kamu bandingkan atau beli nanti.')
                + '<div class="bbb-dashboard-grid" id="wishlist-list"></div>';
            const list = content.querySelector('#wishlist-list');
            if (!items.length) {
                list.innerHTML = emptyState('Wishlist masih kosong. Simpan produk favorit untuk membandingkan nanti.', 'Cari produk', 'marketplace');
                return;
            }
            items.forEach((item) => list.insertAdjacentHTML('beforeend', productCardMarkup(item)));
            list.addEventListener('click', (event) => {
                const button = event.target.closest('[data-product-chat]');
                if (!button) return;
                event.preventDefault();
                const card = event.target.closest('[data-product-id]');
                const id = button.dataset.productChat || card?.dataset.productId;
                if (!id) return;
                location.href = pageFor('detail_produk', { product: id, intent: 'chat' });
            });
        };

        const renderOrders = () => {
            const labels = {
                'awaiting-seller': 'Menunggu konfirmasi penjual',
                confirmed: 'Pesanan dikonfirmasi',
                ready: 'Siap diterima',
                completed: 'Selesai',
                cancelled: 'Dibatalkan'
            };
            const orders = getStore('orders')
                .filter((order) => order.buyerId === user.id || order.sellerId === user.id)
                .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
            content.innerHTML = heading('Pesanan & pembelian', 'Pantau pembelianmu dan tangani pesanan masuk dari barang yang kamu jual.', `<a class="bbb-dashboard-cta" href="${pageFor('marketplace')}">Cari barang</a>`)
                + '<div class="bbb-order-list"></div>';
            const list = content.querySelector('.bbb-order-list');
            if (!orders.length) {
                list.innerHTML = emptyState('Belum ada pesanan. Pilih barang lokal, tentukan COD atau estimasi antar, lalu konfirmasi langsung dengan penjual.', 'Jelajahi barang', 'marketplace');
                return;
            }
            orders.forEach((order) => {
                const isBuyer = order.buyerId === user.id;
                const reviewDone = getStore('reviews').some((review) => review.orderId === order.id);
                const delivery = order.fulfillment === 'delivery' ? 'Antar dalam Kota Magelang' : 'COD / pengambilan langsung';
                const paymentLabel = order.paymentStatus === 'paid' ? 'Lunas'
                    : order.paymentStatus === 'pending' ? 'Menunggu pembayaran'
                        : order.paymentMethod === 'online' ? 'Belum dibayar' : 'Bayar langsung ke penjual';
                const actions = [];
                if (order.status === 'awaiting-seller' && !isBuyer) actions.push('<button type="button" data-order-action="confirm">Terima pesanan</button><button type="button" data-order-action="decline">Tolak</button>');
                if (order.status === 'awaiting-seller' && isBuyer) {
                    if (order.paymentMethod === 'cod') actions.push('<button type="button" data-order-action="confirm-offline">Sudah sepakat dengan penjual</button>');
                    actions.push('<button type="button" data-order-action="cancel">Batalkan</button>');
                }
                if (order.status === 'confirmed' && !isBuyer && (order.paymentMethod === 'cod' || order.paymentStatus === 'paid')) actions.push('<button type="button" data-order-action="ready">Tandai siap diserahkan</button>');
                if (order.status === 'confirmed' && isBuyer && order.paymentMethod === 'online' && order.paymentStatus !== 'paid') {
                    if (order.paymentStatus === 'pending' && order.payment?.payment_url) {
                        actions.push(`<a class="bbb-button" href="${escapeHtml(order.payment.payment_url)}" target="_blank" rel="noopener noreferrer">Lanjutkan pembayaran</a>`);
                    } else actions.push('<button type="button" data-order-action="pay">Bayar dengan YoBasePay</button>');
                }
                if (order.status === 'ready' && isBuyer) actions.push('<button type="button" data-order-action="complete">Barang diterima · selesai</button>');
                if (isBuyer && order.status === 'completed' && !reviewDone) actions.push('<button type="button" data-order-action="review">Beri ulasan</button>');
                const card = document.createElement('article');
                card.className = 'bbb-order-card';
                card.dataset.orderId = order.id;
                card.innerHTML = `<div class="bbb-order-top">
                        <div><span class="bbb-order-role">${isBuyer ? 'Pembelian' : 'Pesanan masuk'}</span><h3>${escapeHtml(order.title)}</h3></div>
                        <span class="bbb-status"${order.status === 'completed' || order.status === 'cancelled' ? ' data-status="sold"' : ''}>${escapeHtml(labels[order.status] || order.status)}</span>
                    </div>
                    <p>Harga barang ${rupiah(order.price)} · ${escapeHtml(delivery)}</p>
                    <p>Total ${rupiah(order.totalAmount || order.price + order.deliveryFeeEstimate)} · Pembayaran: ${escapeHtml(paymentLabel)}</p>
                    <p>Titik transaksi: ${escapeHtml(order.meetingPoint || 'belum ditentukan')}</p>
                    ${actions.length ? `<div class="bbb-order-actions">${actions.join('')}</div>` : ''}`;
                list.append(card);
            });
            list.addEventListener('click', async (event) => {
                const button = event.target.closest('[data-order-action]');
                if (!button) return;
                const orderId = button.closest('[data-order-id]')?.dataset.orderId;
                const order = getStore('orders').find((item) => item.id === orderId);
                if (!order || ![order.buyerId, order.sellerId].includes(user.id)) return;
                const action = button.dataset.orderAction;
                if (action === 'pay') {
                    button.disabled = true;
                    button.textContent = 'Membuat tagihan…';
                    try {
                        const payment = await apiRequest('payments/create', {
                            method: 'POST',
                            body: { order_id: order.id }
                        });
                        order.paymentStatus = 'pending';
                        order.payment = payment;
                        if (!setStore('orders', getStore('orders').map((item) => item.id === order.id ? order : item))) return;
                        location.href = payment.payment_url;
                    } catch (error) {
                        console.error('Tagihan YoBasePay tidak dapat dibuat.', error);
                        toast(error.message || 'Tagihan tidak dapat dibuat. Coba lagi.');
                        button.disabled = false;
                        button.textContent = 'Bayar dengan YoBasePay';
                    }
                    return;
                }
                if (action === 'review') {
                    if (order.buyerId !== user.id || order.status !== 'completed') return;
                    const form = document.createElement('form');
                    form.className = 'bbb-review-form';
                    form.innerHTML = `<label>Nilai transaksi
                            <select name="rating" required><option value="">Pilih nilai</option><option value="5">5 — Sangat baik</option><option value="4">4 — Baik</option><option value="3">3 — Cukup</option><option value="2">2 — Kurang</option><option value="1">1 — Buruk</option></select>
                        </label>
                        <label>Ulasan (opsional)<textarea name="comment" maxlength="400" placeholder="Bagikan pengalaman COD atau komunikasi dengan penjual"></textarea></label>
                        <button type="submit">Kirim ulasan</button>`;
                    button.replaceWith(form);
                    form.elements.rating.focus();
                    return;
                }
                const isBuyer = order.buyerId === user.id;
                const next = {
                    confirm: 'confirmed',
                    'confirm-offline': 'confirmed',
                    ready: 'ready',
                    complete: 'completed',
                    cancel: 'cancelled',
                    decline: 'cancelled'
                }[action];
                if (!next) return;
                if (next === 'completed' && !isBuyer) return;
                if (next === 'ready' && isBuyer) return;
                if (action === 'confirm' && isBuyer) return;
                if (action === 'cancel' && !window.confirm('Batalkan pesanan ini?')) return;
                const confirmation = action === 'decline' && !window.confirm('Tolak pesanan ini?')
                    ? false
                    : true;
                if (!confirmation) return;
                try {
                    const saved = await apiRequest('orders', { method: 'PATCH', body: { id: order.id, action } });
                    order.status = saved.order_status;
                    order.paymentStatus = saved.payment_status;
                    order.updatedAt = saved.updated_at;
                    const orders = getStore('orders').map((item) => item.id === order.id ? order : item);
                    if (!setStore('orders', orders)) return;
                } catch (error) {
                    console.error('Status pesanan tidak dapat diperbarui.', error);
                    toast(error.message || 'Pesanan tidak dapat diperbarui.');
                    return;
                }
                if (next === 'completed') {
                    const products = getStore('products');
                    const product = products.find((item) => item.id === order.productId);
                    if (product) {
                        product.status = 'sold';
                        if (!setStore('products', products)) return;
                    }
                    toast('Transaksi selesai. Jangan lupa beri ulasan.');
                } else if (next === 'cancelled') toast('Pesanan dibatalkan.');
                paint();
            });
            list.addEventListener('submit', (event) => {
                const form = event.target.closest('.bbb-review-form');
                if (!form) return;
                event.preventDefault();
                if (!form.reportValidity()) return;
                const order = getStore('orders').find((item) => item.id === form.closest('[data-order-id]')?.dataset.orderId);
                if (!order || order.buyerId !== user.id || order.status !== 'completed') return;
                const all = getStore('reviews');
                if (all.some((review) => review.orderId === order.id)) return;
                const review = {
                    id: `review-${Date.now().toString(36)}`,
                    orderId: order.id,
                    productId: order.productId,
                    sellerId: order.sellerId,
                    buyerId: user.id,
                    rating: Number(form.elements.rating.value),
                    comment: form.elements.comment.value.trim(),
                    createdAt: new Date().toISOString()
                };
                if (setStore('reviews', [...all, review])) {
                    toast('Ulasan terkirim. Terima kasih!');
                    paint();
                }
            });
        };

        const renderOffers = () => {
            const offers = getStore('offers')
                .filter((offer) => offer.userId === user.id || offer.sellerId === user.id)
                .sort((left, right) => new Date(right.date) - new Date(left.date));
            content.innerHTML = heading('Tawaran harga', 'Harga akhir dan cara transaksi tetap disepakati langsung oleh pembeli dan penjual.')
                + '<div class="bbb-offer-list"></div>';
            const list = content.querySelector('.bbb-offer-list');
            if (!offers.length) {
                list.innerHTML = emptyState('Belum ada tawaran harga.', 'Cari barang', 'marketplace');
                return;
            }
            offers.forEach((offer) => {
                const isSeller = offer.sellerId === user.id;
                const bidder = getStore('users', []).find((candidate) => candidate.id === offer.userId);
                const status = offer.status === 'pending' ? 'Menunggu balasan' : offer.status === 'accepted' ? 'Disetujui penjual' : 'Ditolak penjual';
                const card = document.createElement('article');
                card.className = 'bbb-offer-card';
                card.dataset.offerId = offer.id;
                card.innerHTML = `<div>
                        <span class="bbb-order-role">${isSeller ? `Tawaran dari ${escapeHtml(bidder?.name || 'Mahasiswa')}` : 'Tawaran kamu'}</span>
                        <h3>${escapeHtml(offer.title)}</h3>
                        <p>${rupiah(offer.amount)} · ${escapeHtml(status)}</p>
                    </div>
                    <div class="bbb-order-actions">
                        ${isSeller && offer.status === 'pending' ? '<button type="button" data-offer-action="accepted">Setujui</button><button type="button" data-offer-action="declined">Tolak</button>' : ''}
                        <a href="${pageFor('detail_produk', { product: offer.productId })}">Buka produk</a>
                    </div>`;
                list.append(card);
            });
            list.addEventListener('click', (event) => {
                const button = event.target.closest('[data-offer-action]');
                if (!button) return;
                const all = getStore('offers');
                const offer = all.find((item) => item.id === button.closest('[data-offer-id]')?.dataset.offerId);
                if (!offer || offer.sellerId !== user.id || offer.status !== 'pending') return;
                offer.status = button.dataset.offerAction;
                offer.updatedAt = new Date().toISOString();
                if (setStore('offers', all)) {
                    toast(offer.status === 'accepted' ? 'Tawaran disetujui. Hubungi pembeli untuk lanjut COD.' : 'Tawaran ditolak.');
                    paint();
                }
            });
        };

        const renderMessages = () => {
            const threads = getStore('threads')
                .filter((thread) => [thread.buyerId, thread.sellerId].includes(user.id))
                .sort((left, right) => (right.messages[right.messages.length - 1]?.createdAt || '').localeCompare(left.messages[left.messages.length - 1]?.createdAt || ''));
            content.innerHTML = heading('Pesan', 'Lanjutkan percakapan tentang barang yang kamu minati.')
                + '<div class="bbb-thread-list"></div>';
            const list = content.querySelector('.bbb-thread-list');
            if (!threads.length) {
                list.innerHTML = emptyState('Belum ada percakapan. Hubungi penjual melalui halaman produk untuk memulai.', 'Cari barang', 'marketplace');
                return;
            }
            threads.forEach((thread) => {
                const isBuyer = thread.buyerId === user.id;
                const other = getStore('users', []).find((candidate) => candidate.id === (isBuyer ? thread.sellerId : thread.buyerId));
                const messages = thread.messages.map((message) => {
                    const own = message.senderId === user.id;
                    return `<p class="${own ? 'bbb-message-own' : 'bbb-message-other'}"><strong>${own ? 'Kamu' : escapeHtml(other?.name || (isBuyer ? thread.sellerName : 'Pembeli') || 'Mahasiswa')}</strong>${escapeHtml(message.text)}</p>`;
                }).join('') || '<p>Belum ada pesan.</p>';
                const card = document.createElement('article');
                card.className = 'bbb-thread-card';
                card.innerHTML = `<div class="bbb-thread-heading">
                        <div><h3>${escapeHtml(thread.productTitle)}</h3><p>${isBuyer ? escapeHtml(thread.sellerName || other?.name || 'Penjual') : escapeHtml(other?.name || 'Pembeli')}</p></div>
                        <a href="${pageFor('detail_produk', { product: thread.productId })}">Lihat barang</a>
                    </div>
                    <div class="bbb-thread-messages">${messages}</div>
                    <form data-thread-id="${escapeHtml(thread.id)}">
                        <label class="sr-only" for="reply-${escapeHtml(thread.id)}">Balas percakapan tentang ${escapeHtml(thread.productTitle)}</label>
                        <textarea id="reply-${escapeHtml(thread.id)}" name="reply" maxlength="500" required placeholder="Tulis balasan yang sopan..."></textarea>
                        <button type="submit">Kirim balasan</button>
                    </form>`;
                list.append(card);
            });
            list.addEventListener('submit', (event) => {
                const form = event.target.closest('form[data-thread-id]');
                if (!form) return;
                event.preventDefault();
                if (!form.reportValidity()) return;
                const threads = getStore('threads');
                const thread = threads.find((item) => item.id === form.dataset.threadId);
                if (!thread || ![thread.buyerId, thread.sellerId].includes(user.id)) return;
                thread.messages.push({ senderId: user.id, text: form.elements.reply.value.trim(), createdAt: new Date().toISOString() });
                if (setStore('threads', threads)) paint();
            });
        };

        const renderSettings = () => {
            const saved = getAccountStore('settings', {});
            const displayName = saved.displayName || user.name;
            const campus = saved.campus || user.campus;
            content.innerHTML = heading('Pengaturan akun', 'Perubahan langsung diterapkan pada produk dan profil kamu.')
                + `<form class="bbb-settings-form" novalidate>
                    <div class="bbb-avatar-editor">
                        <div class="bbb-avatar bbb-dashboard-avatar" data-profile-avatar aria-hidden="true">${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : escapeHtml(initials(user.name))}</div>
                        <div class="bbb-avatar-editor-copy">
                            <strong>Foto profil</strong>
                            <span>Tampil di dashboard dan di halaman produk yang kamu jual. Maksimal 5 foto untuk produk; foto profil juga diperkecil agar hemat penyimpanan.</span>
                            <div class="bbb-avatar-editor-actions">
                                <label class="bbb-button" for="profile-photo-input">Pilih foto</label>
                                <button class="bbb-button danger" type="button" data-remove-avatar${user.avatar ? '' : ' disabled'}>Hapus foto</button>
                            </div>
                            <input class="sr-only" id="profile-photo-input" type="file" accept="image/*" data-profile-photo>
                        </div>
                    </div>
                    <label>Nama tampilan<input name="displayName" required maxlength="60" autocomplete="name" value="${escapeHtml(displayName)}"></label>
                    <label>Kampus<select name="campus">
                        <option value="Universitas Tidar (UNTIDAR)">Universitas Tidar (UNTIDAR)</option>
                        <option value="Universitas Muhammadiyah Magelang (UNIMMA)">Universitas Muhammadiyah Magelang (UNIMMA)</option>
                        <option value="Akademi Militer">Akademi Militer</option>
                    </select></label>
                    <div><button class="bbb-dashboard-cta" type="submit">Simpan pengaturan</button></div>
                </form>`;
            const form = content.querySelector('form');
            if (![...form.elements.campus.options].some((option) => option.value === campus)) {
                form.elements.campus.add(new Option(campus, campus));
            }
            form.elements.campus.value = campus;

            const photoInput = form.querySelector('[data-profile-photo]');
            const avatarNode = form.querySelector('[data-profile-avatar]');
            const removeButton = form.querySelector('[data-remove-avatar]');
            let pendingAvatar = user.avatar || '';
            const paintAvatar = () => {
                avatarNode.innerHTML = pendingAvatar ? `<img src="${escapeHtml(pendingAvatar)}" alt="">` : escapeHtml(initials(displayName || user.name));
                removeButton.disabled = !pendingAvatar;
            };
            photoInput.addEventListener('change', async () => {
                const file = photoInput.files?.[0];
                photoInput.value = '';
                if (!file) return;
                try {
                    pendingAvatar = await readImageFile(file, 420, 0.85);
                    paintAvatar();
                    toast('Foto baru siap. Klik "Simpan pengaturan" untuk menyimpan.');
                } catch (error) {
                    toast(error.message);
                }
            });
            removeButton.addEventListener('click', () => {
                pendingAvatar = '';
                paintAvatar();
            });

            form.addEventListener('submit', (event) => {
                event.preventDefault();
                if (!form.reportValidity()) return;
                const nextName = form.elements.displayName.value.trim();
                const nextCampus = form.elements.campus.value;
                if (!nextName) {
                    toast('Nama tampilan tidak boleh kosong.');
                    form.elements.displayName.focus();
                    return;
                }
                const users = getStore('users', []);
                const updated = { ...user, name: nextName, campus: nextCampus, avatar: pendingAvatar };
                if (!setStore('users', users.map((item) => (item.id === user.id ? updated : item)))) return;
                Object.assign(user, updated);
                const products = getStore('products');
                if (!setStore('products', products.map((product) => (ownedProduct(product) ? { ...product, owner: nextName, sellerCampus: nextCampus } : product)))) return;
                if (!setAccountStore('settings', { displayName: nextName, campus: nextCampus })) return;
                paintProfile();
                toast('Profil berhasil diperbarui.');
                paint();
            });
        };

        const renderers = {
            products: renderProducts,
            purchases: renderOrders,
            wishlist: renderWishlist,
            offers: renderOffers,
            messages: renderMessages,
            settings: renderSettings
        };

        const paint = () => {
            const requested = new URLSearchParams(location.search).get('tab');
            const tab = DASHBOARD_TABS.includes(requested) ? requested : 'products';
            content.setAttribute('aria-busy', 'true');
            paintTabs(tab);
            content.innerHTML = '';
            renderers[tab]();
            content.setAttribute('aria-busy', 'false');
            content.scrollIntoView({ block: 'nearest' });
        };

        const openTab = (tab, { push = true } = {}) => {
            const next = new URLSearchParams(location.search);
            next.set('tab', tab);
            if (push) history.pushState({ tab }, '', `${location.pathname}?${next}`);
            paint();
        };

        tabList.forEach((tab) => tab.addEventListener('click', (event) => {
            event.preventDefault();
            openTab(tab.dataset.dashboardTab);
        }));
        window.addEventListener('popstate', () => paint());
        content.addEventListener('click', (event) => {
            const link = event.target.closest('a[data-dashboard-tab]');
            if (!link) return;
            event.preventDefault();
            openTab(link.dataset.dashboardTab);
        });

        paint();
        if (flash) toast(flash);
    };

    /* ------------------------------------------------------------------ *
     * Sesi dan autentikasi
     * ------------------------------------------------------------------ */

    const initPasswordToggles = () => document.querySelectorAll('.bbb-password-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const input = button.parentElement?.querySelector('input');
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            button.textContent = show ? 'Sembunyikan' : 'Tampilkan';
            button.setAttribute('aria-label', `${show ? 'Sembunyikan' : 'Tampilkan'} kata sandi`);
            button.setAttribute('aria-pressed', String(show));
        });
    });
    const saveSession = (account, remember, authSession = {}) => {
        try {
            const value = JSON.stringify({
                userId: account.id,
                accessToken: authSession.access_token || readSession()?.accessToken || '',
                refreshToken: authSession.refresh_token || readSession()?.refreshToken || '',
                expiresAt: Date.now() + Number(authSession.expires_in || 3600) * 1000,
                remember
            });
            const storage = remember ? localStorage : sessionStorage;
            (remember ? sessionStorage : localStorage).removeItem('bbb-session');
            storage.setItem('bbb-session', value);
            return true;
        } catch (error) {
            console.error('Tidak dapat menyimpan sesi akun.', error);
            return false;
        }
    };
    const finishLogin = (account, remember = false, authSession = {}) => {
        if (!saveSession(account, remember, authSession)) return false;
        saveFlash(`Selamat datang, ${account.name}.`);
        location.href = destinationAfterLogin();
        return true;
    };
    const profileFromAuth = (user, profile) => ({
        id: user.id,
        email: user.email,
        name: profile.full_name,
        campus: profile.campus,
        phone: profile.phone,
        studentIdLast4: profile.student_id_last4,
        entryYear: profile.entry_year,
        avatar: profile.avatar_url || '',
        verificationStatus: 'pending',
        createdAt: profile.created_at
    });
    const persistAuthProfile = async (authSession, fields, avatarData = '') => {
        const authUser = authSession.user;
        if (!authUser?.id || !authSession.access_token) throw new Error('Supabase tidak mengembalikan sesi akun yang valid.');
        let avatarUrl = '';
        if (avatarData) avatarUrl = await uploadImage(avatarData, authSession.access_token, authUser.id, 'avatar.jpg');
        const profile = await apiRequest('profile', {
            method: 'PUT',
            token: authSession.access_token,
            body: {
                full_name: fields.full_name,
                campus: fields.campus,
                phone: fields.phone,
                student_id_last4: fields.student_id_last4,
                entry_year: fields.entry_year,
                avatar_url: avatarUrl || null
            }
        });
        const account = profileFromAuth(authUser, profile);
        const users = getStore('users', []).filter((user) => user.id !== account.id);
        if (!setStore('users', [...users, account])) throw new Error('Profil tidak dapat disimpan di browser ini.');
        return account;
    };

    /* ------------------------------------------------------------------ *
     * Halaman masuk
     * ------------------------------------------------------------------ */

    const initLogin = () => {
        if (currentUser()) {
            location.replace(destinationAfterLogin());
            return;
        }
        initPasswordToggles();
        const form = document.querySelector('#login-form');
        const message = document.querySelector('#login-message');
        const submit = form?.querySelector('[type="submit"]');
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = form.elements.email.value.trim().toLocaleLowerCase('id');
            const password = form.elements.password.value;
            if (!form.reportValidity()) return;
            submit.disabled = true;
            setFormMessage(message, 'Memeriksa akun…', true);
            try {
                const authSession = await authRequest('token?grant_type=password', { email, password });
                const authUser = authSession.user;
                const metadata = authUser?.user_metadata || {};
                const remoteProfile = await apiRequest('profile', { token: authSession.access_token });
                const profile = remoteProfile || await apiRequest('profile', {
                    method: 'PUT',
                    token: authSession.access_token,
                    body: {
                        full_name: metadata.full_name || authUser.email.split('@')[0],
                        campus: metadata.campus || '',
                        phone: metadata.phone || '',
                        student_id_last4: metadata.student_id_last4 || '',
                        entry_year: metadata.entry_year || null,
                        avatar_url: metadata.avatar_url || null
                    }
                });
                const account = {
                    id: authUser.id,
                    email: authUser.email,
                    name: profile.full_name,
                    campus: profile.campus,
                    phone: profile.phone,
                    studentIdLast4: profile.student_id_last4,
                    entryYear: profile.entry_year,
                    avatar: profile.avatar_url || '',
                    verificationStatus: 'pending',
                    createdAt: profile.created_at
                };
                const users = getStore('users', []).filter((user) => user.id !== account.id);
                if (!setStore('users', [...users, account])) {
                    setFormMessage(message, 'Profil tidak dapat disimpan di browser ini. Periksa pengaturan penyimpanan.');
                    return;
                }
                if (!finishLogin(account, form.elements.remember.checked, authSession)) {
                    setFormMessage(message, 'Sesi tidak dapat disimpan di browser ini. Periksa pengaturan penyimpanan browser.');
                }
            } catch (error) {
                console.error('Proses masuk gagal.', error);
                setFormMessage(message, error.message || 'Tidak dapat memproses masuk. Coba lagi.');
            } finally {
                submit.disabled = false;
            }
        });
    };

    /* ------------------------------------------------------------------ *
     * Halaman pendaftaran
     * ------------------------------------------------------------------ */

    const initRegistration = () => {
        if (currentUser()) {
            location.replace(pageFor('dashboard'));
            return;
        }
        initPasswordToggles();
        const form = document.querySelector('#register-form');
        const message = document.querySelector('#register-message');
        if (!form) return;
        const steps = [...form.querySelectorAll('[data-register-step]')];
        const progress = [...document.querySelectorAll('[data-progress]')];
        const backButton = form.querySelector('[data-register-back]');
        const nextButton = form.querySelector('[data-register-next]');
        const yearSelect = form.elements.entryYear;
        const campusOther = form.querySelector('[data-campus-other]');
        const campusOtherInput = form.elements.campusOther;

        form.elements.campus.addEventListener('change', () => {
            const other = form.elements.campus.value === 'Lainnya';
            campusOther.hidden = !other;
            campusOtherInput.disabled = !other;
            campusOtherInput.required = other;
            if (other) campusOtherInput.focus();
        });
        for (let year = new Date().getFullYear(); year >= new Date().getFullYear() - 10; year -= 1) {
            yearSelect.add(new Option(String(year), String(year)));
        }

        const photoPicker = createPhotoPicker({
            drop: form.querySelector('[data-photo-drop]'),
            grid: form.querySelector('[data-photo-grid]'),
            hint: form.querySelector('[data-photo-hint]'),
            input: form.querySelector('[data-profile-photo]'),
            max: 1,
            label: 'profil'
        });

        let step = 1;

        const setStep = (next) => {
            step = next;
            steps.forEach((fieldset) => {
                const active = Number(fieldset.dataset.registerStep) === step;
                fieldset.hidden = !active;
                fieldset.disabled = !active;
            });
            progress.forEach((item) => {
                const index = Number(item.dataset.progress);
                item.classList.toggle('is-current', index === step);
                item.classList.toggle('is-complete', index < step);
                if (index === step) item.setAttribute('aria-current', 'step');
                else item.removeAttribute('aria-current');
            });
            backButton.hidden = step === 1;
            nextButton.textContent = step === 3 ? 'Sudah memverifikasi email' : 'Lanjut';
            setFormMessage(message, '');
            steps[step - 1].querySelector('input, select')?.focus();
        };

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!steps[step - 1].reportValidity()) return;
            const email = form.elements.email.value.trim().toLocaleLowerCase('id');
            if (step === 1) {
                if (!form.elements.name.value.trim()) {
                    setFormMessage(message, 'Masukkan nama lengkap.');
                    form.elements.name.focus();
                    return;
                }
                if (form.elements.password.value.length < 8) {
                    setFormMessage(message, 'Kata sandi harus terdiri dari minimal 8 karakter.');
                    form.elements.password.focus();
                    return;
                }
                if (form.elements.password.value !== form.elements.confirmPassword.value) {
                    setFormMessage(message, 'Konfirmasi kata sandi belum sama.');
                    form.elements.confirmPassword.focus();
                    return;
                }
                setStep(2);
                return;
            }
            if (step === 2) {
                if (!form.elements.terms.checked) {
                    setFormMessage(message, 'Setujui ketentuan penggunaan untuk melanjutkan.');
                    form.elements.terms.focus();
                    return;
                }
                if (form.elements.campus.value === 'Lainnya' && !form.elements.campusOther.value.trim()) {
                    setFormMessage(message, 'Tulis nama perguruan tinggi kamu.');
                    form.elements.campusOther.focus();
                    return;
                }
                document.querySelector('[data-register-email]').textContent = email;
                setStep(3);
                nextButton.disabled = true;
                setFormMessage(message, 'Mengirim tautan verifikasi ke email…', true);
                try {
                    const metadata = {
                        full_name: form.elements.name.value.trim(),
                        campus: form.elements.campus.value === 'Lainnya' ? form.elements.campusOther.value.trim() : form.elements.campus.value,
                        phone: form.elements.phone.value.trim(),
                        student_id_last4: form.elements.studentId.value.trim().slice(-4),
                        entry_year: Number(form.elements.entryYear.value) || null
                    };
                    const callback = new URL(location.pathname, location.origin).href;
                    const result = await authRequest('signup', {
                        email,
                        password: form.elements.password.value,
                        data: metadata
                    }, { query: `?redirect_to=${encodeURIComponent(callback)}` });
                    if (result.access_token && result.user) {
                        const account = await persistAuthProfile(result, metadata, photoPicker.value()[0] || '');
                        finishLogin(account, false, result);
                        return;
                    }
                    setFormMessage(message, 'Tautan verifikasi telah dikirim. Buka email tersebut pada perangkat ini; setelah diverifikasi, kamu akan masuk otomatis.', true);
                } catch (error) {
                    console.error('Pendaftaran Supabase gagal.', error);
                    setStep(2);
                    setFormMessage(message, error.message || 'Tidak dapat mengirim verifikasi. Coba lagi.');
                } finally {
                    nextButton.disabled = false;
                }
                return;
            }
            setFormMessage(message, 'Buka tautan verifikasi pada email yang dikirim. Halaman ini akan masuk otomatis setelah email dikonfirmasi.', true);
        });

        backButton.addEventListener('click', () => setStep(Math.max(1, step - 1)));
        form.querySelector('[data-resend-code]').addEventListener('click', async () => {
            const email = form.elements.email.value.trim().toLocaleLowerCase('id');
            try {
                await authRequest('resend', { type: 'signup', email });
                setFormMessage(message, 'Tautan verifikasi baru sudah dikirim.', true);
            } catch (error) {
                console.error('Pengiriman ulang verifikasi gagal.', error);
                setFormMessage(message, error.message || 'Tautan verifikasi tidak dapat dikirim ulang.');
            }
        });
        setStep(1);
    };

    /* ------------------------------------------------------------------ *
     * Halaman lupa kata sandi
     * ------------------------------------------------------------------ */

    const initPasswordReset = () => {
        const requestedRecovery = new URLSearchParams(location.search).get('recovery') === '1';
        if (currentUser() && !requestedRecovery) {
            location.replace(pageFor('dashboard'));
            return;
        }
        const form = document.querySelector('#reset-form');
        const message = document.querySelector('#reset-message');
        if (!form) return;
        const steps = [...form.querySelectorAll('[data-reset-step]')];
        const submit = form.querySelector('[type="submit"]');
        const recoveryMode = new URLSearchParams(location.search).get('recovery') === '1';
        const recoveryToken = sessionStorage.getItem('bbb-recovery-token') || '';
        const recoveryActive = recoveryMode && Boolean(recoveryToken);

        const showStep = (next) => {
            steps.forEach((fieldset) => {
                const active = Number(fieldset.dataset.resetStep) === next;
                fieldset.hidden = !active;
                fieldset.disabled = !active;
            });
        };

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const activeStep = recoveryActive ? 2 : 1;
            if (!steps[activeStep - 1].reportValidity()) return;
            if (!recoveryActive) {
                const email = form.elements.email.value.trim().toLocaleLowerCase('id');
                const callback = new URL(location.pathname, location.origin).href;
                submit.disabled = true;
                try {
                    await authRequest('recover', { email }, { query: `?redirect_to=${encodeURIComponent(callback)}` });
                    setFormMessage(message, 'Jika email tersebut terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.', true);
                } catch (error) {
                    console.error('Permintaan pemulihan kata sandi gagal.', error);
                    setFormMessage(message, error.message || 'Tautan pemulihan tidak dapat dikirim.');
                } finally {
                    submit.disabled = false;
                }
                return;
            }
            if (!recoveryToken) {
                setFormMessage(message, 'Sesi pemulihan tidak tersedia. Minta tautan baru dari halaman ini.');
                return;
            }
            if (form.elements.password.value.length < 8) {
                setFormMessage(message, 'Kata sandi harus terdiri dari minimal 8 karakter.');
                form.elements.password.focus();
                return;
            }
            if (form.elements.password.value !== form.elements.confirmPassword.value) {
                setFormMessage(message, 'Ulasan kata sandi belum sama.');
                form.elements.confirmPassword.focus();
                return;
            }
            submit.disabled = true;
            try {
                await authRequest('user', { password: form.elements.password.value }, { token: recoveryToken, method: 'PUT' });
                sessionStorage.removeItem('bbb-recovery-token');
                saveFlash('Kata sandi berhasil diperbarui. Silakan masuk.');
                const params = new URLSearchParams();
                const current = new URLSearchParams(location.search);
                ['next', 'tab', 'product', 'intent'].forEach((key) => { if (current.has(key)) params.set(key, current.get(key)); });
                location.href = pageFor('login', Object.fromEntries(params));
            } catch (error) {
                console.error('Pemulihan kata sandi gagal.', error);
                setFormMessage(message, error.message || 'Tidak dapat memperbarui kata sandi. Coba lagi.');
            } finally {
                submit.disabled = false;
            }
        });

        if (!recoveryActive) {
            showStep(1);
        } else {
            showStep(2);
            submit.textContent = 'Simpan kata sandi baru';
        }
    };

    /* ------------------------------------------------------------------ *
     * Mulai
     * ------------------------------------------------------------------ */

    const completeAuthCallback = async () => {
        const params = new URLSearchParams(location.hash.slice(1));
        const accessToken = params.get('access_token');
        if (!accessToken) return false;
        const refreshToken = params.get('refresh_token') || '';
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        const config = await publicConfig();
        const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
            headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error('Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
        if (params.get('type') === 'recovery') {
            sessionStorage.setItem('bbb-recovery-token', accessToken);
            location.replace(pageFor('lupa_password', { recovery: '1' }));
            return true;
        }
        const user = await response.json();
        const metadata = user.user_metadata || {};
        const profile = await apiRequest('profile', { token: accessToken }) || await apiRequest('profile', {
            method: 'PUT',
            token: accessToken,
            body: {
                full_name: metadata.full_name || user.email.split('@')[0],
                campus: metadata.campus || '',
                phone: metadata.phone || '',
                student_id_last4: metadata.student_id_last4 || '',
                entry_year: metadata.entry_year || null,
                avatar_url: null
            }
        });
        const account = profileFromAuth(user, profile);
        const users = getStore('users', []).filter((item) => item.id !== account.id);
        if (!setStore('users', [...users, account])) throw new Error('Profil tidak dapat disimpan di browser ini.');
        if (!saveSession(account, false, { access_token: accessToken, refresh_token: refreshToken, expires_in: params.get('expires_in') || 3600 })) {
            throw new Error('Sesi tidak dapat disimpan di browser ini.');
        }
        saveFlash(`Selamat datang, ${account.name}.`);
        location.replace(destinationAfterLogin());
        return true;
    };
    const start = async () => {
        try {
            if (await completeAuthCallback()) return;
        } catch (error) {
            console.error('Verifikasi email gagal diselesaikan.', error);
            saveFlash(error.message || 'Verifikasi email gagal. Silakan masuk kembali.');
            location.replace(pageFor('login'));
            return;
        }
        const flash = sessionStorage.getItem('bbb-flash');
        renderShell();
        if (['dashboard', 'tambah_produk'].includes(currentPage) && !requestLogin(currentPage)) return;
        if (backendAvailable && ['beranda', 'marketplace', 'detail_produk'].includes(currentPage)) {
            try {
                const productId = currentPage === 'detail_produk' ? new URLSearchParams(location.search).get('product') || '' : '';
                await hydrateProducts({ id: productId });
            } catch (error) {
                console.error('Produk Supabase tidak dapat dimuat.', error);
                toast(error.message || 'Produk terbaru belum dapat dimuat.');
            }
        }
        if (backendAvailable && ['dashboard', 'tambah_produk'].includes(currentPage)) {
            try {
                await hydrateProducts({ mine: true });
                if (currentPage === 'dashboard') {
                    await hydrateOrders();
                    const query = new URLSearchParams(location.search);
                    const returnedTrx = query.get('payment_trxid');
                    if (returnedTrx) {
                        try {
                            const result = await apiRequest(`payments/status?trxid=${encodeURIComponent(returnedTrx)}`);
                            await hydrateOrders();
                            query.delete('payment_trxid');
                            history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}`);
                            toast(result.status === 'SUCCESS'
                                ? 'Pembayaran berhasil dikonfirmasi.'
                                : result.status === 'PENDING'
                                    ? 'Pembayaran masih menunggu konfirmasi gateway.'
                                    : `Status pembayaran: ${result.status}.`);
                        } catch (error) {
                            console.error('Status pembayaran setelah redirect tidak dapat diverifikasi.', error);
                            toast(error.message || 'Status pembayaran belum dapat diverifikasi.');
                        }
                    }
                }
            } catch (error) {
                console.error('Data akun Supabase tidak dapat dimuat.', error);
                toast(error.message || 'Data akun belum dapat dimuat.');
            }
        }
        if (currentPage === 'beranda') initHome();
        if (currentPage === 'marketplace') initMarketplace();
        if (currentPage === 'tambah_produk') initForm();
        if (currentPage === 'detail_produk') initDetail();
        if (currentPage === 'dashboard') initDashboard();
        if (currentPage === 'login') initLogin();
        if (currentPage === 'registrasi') initRegistration();
        if (currentPage === 'lupa_password') initPasswordReset();
        if (flash && currentPage !== 'dashboard') {
            sessionStorage.removeItem('bbb-flash');
            window.setTimeout(() => toast(flash), 120);
        }
    };
    start();
})();