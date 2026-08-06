    const CATEGORY_LABELS = { single: 'Single', dual: 'Dual', group: 'Group' };

    let allPhotos = [];
    let currentList = [];
    let currentIdx = 0;
    let activeFilter = 'all';
    let searchQuery = '';

    const csvUrl = 'https://raw.githubusercontent.com/tonirshaik/tonirshaik/refs/heads/main/Tonir%20photo%20Link.txt';
    // 🆕 ব্যাটারি/CPU ফিক্স: ট্যাব/অ্যাপ ব্যাকগ্রাউন্ডে গেলে (screen
    // lock, app switch, অন্য ট্যাবে যাওয়া) সব infinite CSS animation
    // (search bar glow, mic ring spin/pulse ইত্যাদি) পজ করে দেওয়া হয়,
    // যাতে ব্যাকগ্রাউন্ডে থাকা অবস্থায় খামাখা GPU/CPU/battery না খায়।
    // আবার visible হলে normal-ই resume হয়ে যায়। CSS-এ body.anim-paused
    // দেখো।
    document.addEventListener('visibilitychange', () => {
        document.body.classList.toggle('anim-paused', document.hidden);
    });

    // 🆕 CLOUDFLARE EDGE CACHE: সরাসরি Apps Script (/exec) কল না করে
    // এখন tonir-image-proxy Worker-এর /gallery-data route কল করা হয় —
    // এটা একই Apps Script ডেটা রিটার্ন করে (same shape: { success,
    // images }), কিন্তু মাঝে Cloudflare edge-এ ৩০ সেকেন্ডের জন্য
    // globally cache করা থাকে (Cache API + KV)। ফলে যেকোনো visitor
    // (নতুন হোক বা পুরনো, বিশ্বের যেকোনো জায়গা থেকে) ওই ৩০ সেকেন্ডের
    // মধ্যে এলে Google Apps Script-এর slow cold-start এড়িয়ে
    // Cloudflare edge থেকেই instant রেসপন্স পায়। আসল Apps Script URL
    // (GAS_ORIGIN_URL) এখনো রাখা হলো ফলব্যাক/রেফারেন্স হিসেবে।
    const GAS_ORIGIN_URL = 'https://script.google.com/macros/s/AKfycbyLRiJ9ueiqnc7kYc188HTg41wJNF3W1eighA2WA7xq9nUfMTJflzefxdXsrjIHOgXiLw/exec';
    const APPS_SCRIPT_URL = 'https://tonir-image-proxy.tonirshaik.workers.dev/gallery-data';
    // 🆕 REVERTED TO LIVE BACKEND, তারপর EDGE-CACHED: সাধারণ ভিজিটরের
    // গ্যালারি-লোড (নিচের fetchLiveUploadsOnce) এখন উপরের
    // APPS_SCRIPT_URL (Cloudflare Worker /gallery-data) কল করে —
    // যেটা মাঝে থেকে আসল Apps Script (GAS_ORIGIN_URL, doGet()) কে
    // ৩০ সেকেন্ডের edge cache দিয়ে wrap করে। delete/upload/edit করলে
    // সর্বোচ্চ ৩০ সেকেন্ড পর সব ভিজিটর আপডেটেড ডেটা পাবে (admin নিজে
    // bust=1 দিয়ে সাথে সাথেই পাবে, নিচে দেখো)।
    // ⚠️ আগের ট্রেড-অফ (প্রতি লোডে সরাসরি Apps Script cold-start)
    // এখন অনেকটাই কমে গেছে যেহেতু বেশিরভাগ রিকোয়েস্ট Cloudflare edge
    // থেকেই সার্ভ হবে, Apps Script-এ পৌঁছাবে শুধু cache miss হলে।

    // 🆕 Google Apps Script কখনো কখনো (cold start-এ) অনেক দেরি করে বা
    // hang করে থাকে — তাই কোনো fetch যাতে অনির্দিষ্টকাল অপেক্ষা না করে,
    // একটা টাইমআউট বসানো হলো (ডিফল্ট ৮ সেকেন্ড)। সময় শেষ হলে fetch
    // reject হবে, আর caller-দের existing .catch() স্বাভাবিকভাবেই সেটা
    // handle করবে (যেমন cache/fallback দেখানো)।
    function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
        const opts = Object.assign({}, options, { signal: controller.signal });
        return fetch(url, opts).finally(() => clearTimeout(timer));
    }

    // 🛠️ FIX (bug from previous patch): অনেক পুরনো এন্ট্রির url আসলে
    // "drive.google.com/..." ফরম্যাটে না, বরং Google-এর
    // "lh3.googleusercontent.com/d/ID..." ফরম্যাটে সেভ আছে (redirect-এর
    // পর resolve হওয়া লিংক)। isGoogleDriveUrl() আগে শুধু
    // "drive.google.com" চিনত, তাই এই লিংকগুলো "Drive না" ধরে নিয়ে
    // toGenericThumb()-এর wsrv.nl fallback-এ পাঠানো হচ্ছিল — কিন্তু
    // wsrv.nl Google-এর এই session/cookie-নির্ভর googleusercontent
    // লিংক fetch করতে পারে না, ফলে প্রতিটা request net::ERR দিয়ে fail
    // করছিল (broken thumbnails, ২৪৮টা failed request)। এখন
    // googleusercontent.com-ও Drive হিসেবে চেনা হয়, আর getDriveFileId()
    // "/d/ID" প্যাটার্নও (file/ ছাড়া) ধরতে পারে, যাতে এগুলো নিজের
    // Cloudflare Worker proxy দিয়েই যায় (যেটা Drive API দিয়ে সঠিকভাবে
    // ফাইল আনতে পারে), wsrv.nl-এ না গিয়ে।
    function getDriveFileId(url) {
        let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = url.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
        if (m) return m[1];
        return null;
    }

    function isGoogleDriveUrl(url) {
        return /drive\.google\.com|googleusercontent\.com/.test(url);
    }

    // 🛠️ FIX: সরাসরি drive.google.com/thumbnail ব্যবহার করলে প্রতিটা
    // ছবিতে আগে একটা 302 redirect আসে (Slow 4G-তে ~700ms করে!), তারপর
    // আসল ছবি — মানে প্রতি ছবিতে ডবল round-trip। tonir-image-proxy
    // Worker-এর /img রুট এটাই সমাধান করে: Worker নিজে সার্ভার-সাইডে
    // Drive থেকে ছবি এনে Cloudflare edge cache + KV-তে রেখে দেয়, তাই
    // ব্রাউজার একটাই request পাঠায় আর কাছের edge server থেকে সরাসরি
    // ছবি পায় — কোনো redirect visitor পর্যন্ত পৌঁছায় না। ImgBB লিংক
    // (Drive না) এমনিতেই সরাসরি থাকে, প্রক্সির দরকার নেই।
    const IMAGE_PROXY_BASE = 'https://tonir-image-proxy.tonirshaik.workers.dev/img';
    function toRenderableUrl(url, size) {
        if (isGoogleDriveUrl(url)) {
            const id = getDriveFileId(url);
            if (id) {
                return IMAGE_PROXY_BASE + '?id=' + id + '&sz=w' + (size || 1000);
            }
        }
        return url;
    }

    // 🆕 UNIVERSAL THUMBNAIL FIX: আগে শুধু Drive URL রিসাইজ হতো
    // (toRenderableUrl), কিন্তু যেসব ImgBB ছবির জন্য backend থেকে
    // img.thumbUrl ফাঁকা/না-আসে (পুরনো এন্ট্রি, বা কোনো কারণে
    // thumb জেনারেট হয়নি), সেগুলোর জন্য fallback ছিল raw ImgBB
    // URL — মানে ফুল-সাইজ ২০০-৪৫০ KB ছবি সরাসরি গ্রিডে লোড হতো
    // (Network ট্যাবে দেখা 6.9 MB সমস্যার আসল কারণ)। এখন সেই
    // fallback-এও images.weserv.nl (ফ্রি, কোনো key লাগে না) দিয়ে
    // on-the-fly resize+webp করে ছোট thumbnail বানানো হয়, উৎস
    // যেটাই হোক না কেন।
    const THUMB_PROXY_BASE = 'https://wsrv.nl/';
    function toGenericThumb(url, size) {
        if (!url) return url;
        const bare = url.replace(/^https?:\/\//, '');
        return THUMB_PROXY_BASE + '?url=' + encodeURIComponent(bare) +
            '&w=' + (size || 200) + '&output=webp&q=70';
    }

    function toDownloadUrl(url) {
        if (isGoogleDriveUrl(url)) {
            const id = getDriveFileId(url);
            if (id) {
                return 'https://drive.google.com/uc?export=download&id=' + id;
            }
        }
        return url;
    }

    const SECTION_SEARCH_WORDS = {
        single: ['single', 'একজন'],
        dual: ['dual', 'couple', 'দুইজন', 'কাপল'],
        group: ['group', 'দলগত', 'গ্রুপ']
    };

    // 🆕 ব্যাকএন্ড এখন প্রতিটা ছবির সাথে native "cat" ফিল্ড ফেরত দেয়
    // (single/dual/group/"") — caption থেকে সম্পূর্ণ আলাদা। CATEGORY_MARKER
    // আর decodeCaptionCategory() শুধু ব্যাকওয়ার্ড-কম্প্যাটিবিলিটির জন্য
    // রাখা হয়েছে, যদি কোনো পুরনো টেস্ট এন্ট্রির caption-এ এখনো মার্কার
    // বসানো থাকে (নতুন আপলোডে আর হবে না)।
    const CATEGORY_MARKER = '::cat::';
    function decodeCaptionCategory(rawCaption) {
        const raw = String(rawCaption == null ? '' : rawCaption);
        const idx = raw.indexOf(CATEGORY_MARKER);
        if (idx === -1) return { names: raw.trim(), cat: null };
        const names = raw.slice(0, idx).trim();
        let cat = raw.slice(idx + CATEGORY_MARKER.length).trim().toLowerCase();
        if (cat !== 'single' && cat !== 'dual' && cat !== 'group') cat = null;
        return { names: names, cat: cat };
    }

    function parsePhotoFile(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const photos = [];
        let currentCat = 'uncategorized';

        lines.forEach(line => {
            const headerMatch = line.match(/^#\s*(single|dual|group)\b/i);
            if (headerMatch) {
                currentCat = headerMatch[1].toLowerCase();
                return;
            }
            if (line.startsWith('http')) {
                const commaIdx = line.indexOf(',');
                const url = (commaIdx === -1 ? line : line.slice(0, commaIdx)).trim();
                const namesRaw = commaIdx === -1 ? '' : line.slice(commaIdx + 1).trim();

                const idx = photos.length;
                const sectionWords = SECTION_SEARCH_WORDS[currentCat] || [];
                const searchIndex = [namesRaw, ...sectionWords]
                    .join(' ')
                    .toLowerCase();

                photos.push({
                    url: toRenderableUrl(url, 1000),
                    thumbUrl: isGoogleDriveUrl(url) ? toRenderableUrl(url, 200) : toGenericThumb(url, 200),
                    rawUrl: url,
                    downloadUrl: toDownloadUrl(url),
                    idx: idx,
                    cat: currentCat,
                    names: namesRaw,
                    searchIndex: searchIndex,
                    title: namesRaw || ('Photo ' + (idx + 1))
                });
            }

        });

        return photos;
    }

    function liveImageToPhoto(img, idx) {
        const decoded = decodeCaptionCategory(img.caption);
        const caption = decoded.names;
        let cat = String(img.cat || '').trim().toLowerCase();
        if (cat !== 'single' && cat !== 'dual' && cat !== 'group') cat = decoded.cat || 'uncategorized';
        const sectionWords = SECTION_SEARCH_WORDS[cat] || [];
        return {
            // Grid display: small, fast-loading thumbnail.
            // 🆕 THUMBNAIL FIX: ImgBB-হোস্টেড ছবির জন্য backend এখন সাথে
            // img.thumbUrl (ImgBB-এর medium/thumb লিংক) পাঠায় — সেটা থাকলে
            // সরাসরি সেটাই ব্যবহার হয় (toRenderableUrl শুধু Drive URL রিসাইজ
            // করতে পারে, ImgBB URL অপরিবর্তিতই রেখে দেয়)। পুরনো এন্ট্রি বা
            // Drive-hosted ছবির জন্য img.thumbUrl খালি থাকবে, তখন আগের মতোই
            // toRenderableUrl(img.url, 200) fallback হিসেবে ব্যবহার হয়।
            url: toRenderableUrl(img.url, 1000),
            // 🛠️ FIX: ব্যাকএন্ড কখনো কখনো Drive-hosted ছবির জন্যও img.thumbUrl-এ
            // ফুল-সাইজ লিংক পাঠিয়ে দেয় (শুধু ImgBB-এর জন্যই আসল thumb লিংক আসে)।
            // আগে সেটা যাচাই ছাড়াই ব্যবহার হতো — ফলে গ্রিডে thumbnail-এর বদলে
            // ২০০-৪৫০ KB এর ফুল ছবি লোড হতো (Network ট্যাবে দেখা 9MB সমস্যার
            // প্রধান কারণ)। এখন Drive URL হলে backend যাই পাঠাক, জোর করে
            // toRenderableUrl(...,200) দিয়ে ছোট, প্রক্সি-করা thumbnail বানানো হয়।
            thumbUrl: (img.thumbUrl && !isGoogleDriveUrl(img.thumbUrl))
                ? img.thumbUrl
                : (isGoogleDriveUrl(img.url) ? toRenderableUrl(img.url, 200) : toGenericThumb(img.url, 200)),
            rawUrl: img.url,
            // Download button: full-quality original file, not the thumbnail.
            downloadUrl: toDownloadUrl(img.url),
            idx: idx,
            cat: cat,
            names: caption,
            searchIndex: [caption, ...sectionWords].join(' ').toLowerCase(),
            title: caption || ('New Photo ' + (idx + 1)),
            fileId: img.id || null,
            date: img.date || null,
            acc: img.acc || 'self',
            isLive: true
        };
    }

    // 🆕 এই ফাংশন Cloudflare Worker /gallery-data রুট কল করে, যেটা
    // Apps Script (/exec, doGet())-এর একই shape-এর ডেটা রিটার্ন করে
    // ({ success, images, faces }), তাই বাকি সব downstream কোড
    // (liveImageToPhoto, buildMergedPhotoList ইত্যাদি) অপরিবর্তিত
    // থাকল। bust প্যারামিটার এখন সত্যিই কাজ করে (নিচে দেখো) — এটা
    // Worker-এর edge cache স্কিপ করাতে ব্যবহার হয়।
    // 🆕 এখন bust প্যারামিটার সত্যিই কাজ করে: bust=true হলে Worker-কে
    // ?bust=1 দিয়ে বলা হয় edge cache স্কিপ করে সরাসরি Apps Script থেকে
    // fresh ডেটা আনতে (admin upload/delete-এর পর নিজের স্ক্রিনে সাথে
    // সাথে ফলাফল দেখানোর জন্য ব্যবহার হয়, admin-upload.js দেখো)। bust
    // না থাকলে normal edge-cached রিকোয়েস্ট যায়।
    function fetchLiveUploadsOnce(timeoutMs, bust) {
        // 🆕 priority: 'high' — সাপোর্ট করা ব্রাউজারে (Chromium-ভিত্তিক)
        // এই রিকোয়েস্টকে অন্য সব asset (font, css ইত্যাদি)-এর আগে পাঠাতে
        // বলা হচ্ছে, যাতে আসল গ্যালারি ডেটা যত দ্রুত সম্ভব চলে আসে।
        // অসমর্থিত ব্রাউজারে এই অপশনটা এমনিই ignore হয়ে যায়, ভাঙে না।
        // 🆕 cache: 'no-store' বাদ দেওয়া হলো — Worker রেসপন্সে
        // Cache-Control: max-age=30 হেডার পাঠায়, browser নিজেও সেটা
        // মেনে চললে repeat-load এ আরও একটা (network-level) speed-up
        // পাওয়া যায়। bust হলে URL-এই ?bust=1 যোগ হয় বলে সেটা এমনিতেই
        // browser cache miss করবে, আলাদা করে no-store দরকার নেই।
        const url = bust ? APPS_SCRIPT_URL + '?bust=1' : APPS_SCRIPT_URL;
        return fetchWithTimeout(url, { priority: 'high' }, timeoutMs)
            .then(r => r.json())
            .then(res => (res && res.success && Array.isArray(res.images)) ? res.images : null)
            .catch(() => null);
    }

    function fetchLiveUploads() {
        // 🆕 timeout ১৫s করা হলো (আগে ১০s ছিল, তখন এটা একটা static
        // GitHub ফাইল fetch করত) — এখন সরাসরি Apps Script কল হওয়ায়
        // cold-start-এ একটু বেশি সময় লাগতে পারে, তাই সামান্য বাফার।
        return fetchLiveUploadsOnce(15000, false).then(images => images !== null ? images : []);
    }

    function retryLiveUploadsInBackground(oldPhotos) {
        fetchLiveUploadsOnce(25000, true).then(images => {
            if (images && images.length) {
                const merged = buildMergedPhotoList(oldPhotos, images);
                showGallery(merged);
                try {
                    localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(merged));
                    localStorage.setItem(PHOTO_CACHE_TIME_KEY, String(Date.now()));
                } catch (e) {}
            }
        });
    }

    function buildMergedPhotoList(oldPhotos, liveImages) {
        const newPhotos = [];
        const liveUrlSet = new Set();
        (liveImages || []).forEach(img => {
            try {
                if (img && img.url) {
                    newPhotos.push(liveImageToPhoto(img, newPhotos.length));
                    liveUrlSet.add(String(img.url).trim());
                }
            } catch (e) {
            }
        });
        // 🆕 ImgBB+GitHub route দিয়ে upload হওয়া ছবি এখন real date সহ
        // liveImages (doGet)-এই চলে আসে, কিন্তু legacy compatibility-র
        // জন্য একই লিংক এখনও GitHub টেক্সট ফাইলে (oldPhotos-এর সোর্স)
        // থেকে যায় — তাই ডুপ্লিকেট দেখা এড়াতে সেগুলো oldPhotos থেকে
        // বাদ দেওয়া হচ্ছে। এতে Drive vs ImgBB নির্বিশেষে সবকিছু
        // liveImages-এর (real-date sorted) অংশেই একবার দেখাবে।
        const dedupedOld = oldPhotos.filter(p => !liveUrlSet.has(String(p.rawUrl || p.url).trim()));
        const merged = [...newPhotos, ...dedupedOld];
        merged.forEach((p, i) => { p.idx = i; });
        return merged;
    }

    const PHOTO_CACHE_KEY = 'tonir_gallery_cache_v1';
    // 🆕 SHORT-TERM CACHE: Apps Script (doGet) কল-এ cold-start latency
    // থাকে (২-৫s+), মোবাইলে আরও বেশি লাগে। তাই ৪৫ সেকেন্ডের মধ্যে বারবার
    // reload/revisit করলে সেই সময়ের মধ্যে নতুন কোনো Apps Script কল না
    // করে সরাসরি localStorage cache থেকেই দেখানো হবে (নিচে দেখো)।
    // Admin নতুন ছবি upload করলে সেটা এই ৪৫ সেকেন্ডের মধ্যে অন্য ট্যাবে
    // সাথে সাথে না-ও দেখা যেতে পারে — এটাই ইচ্ছাকৃত trade-off (স্পিডের
    // বদলে সামান্য staleness)। TTL বাড়াতে/কমাতে চাইলে শুধু এই সংখ্যাটা
    // বদলাও।
    const PHOTO_CACHE_TIME_KEY = 'tonir_gallery_cache_time_v1';
    const PHOTO_CACHE_TTL_MS = 100000;

    function isPhotoCacheFresh() {
        try {
            const t = localStorage.getItem(PHOTO_CACHE_TIME_KEY);
            return !!t && (Date.now() - parseInt(t, 10) < PHOTO_CACHE_TTL_MS);
        } catch (e) {
            return false;
        }
    }

    function showGallery(photos) {
        allPhotos = photos;
        document.getElementById('photoCount').textContent = allPhotos.length;
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('masonry').style.display = '';
        currentList = allPhotos;
        renderGallery(currentList, true);
        buildStrip(allPhotos);
    }

    let paintedFromCache = false;
    Promise.resolve().then(() => {
        try {
            const cached = localStorage.getItem(PHOTO_CACHE_KEY);
            if (cached) {
                const cachedPhotos = JSON.parse(cached);
                if (Array.isArray(cachedPhotos) && cachedPhotos.length && !paintedFromCache) {
                    showGallery(cachedPhotos);
                    paintedFromCache = true;
                }
            }
        } catch (e) {  }
    });

    // 🆕 SPEED FIX: আগে এখানে প্রথমে legacy .txt ফাইল (csvUrl) resolve
    // হওয়ার জন্য অপেক্ষা করা হতো — localStorage cache না থাকলে (নতুন
    // ব্রাউজার) ততক্ষণ কোনো ছবিই দেখানো হতো না, যদিও আসল/নতুন সব ছবি
    // লাইভ ব্যাকএন্ডেই (fetchLiveUploads → doGet()) থাকে (ImgBB ছবিও
    // শুধু এখানেই, .txt-এ আর লেখা হয় না — backend দেখো)। এখন দুটো
    // fetch-ই "race" করে — যেটা আগে রেসপন্স দেয় সেটা দিয়েই সাথে সাথে
    // প্রথম পেইন্ট হয়ে যায় (blink-of-an-eye), বাকিটা এলে merge করে
    // ফাইনাল লিস্ট বসে। লাইভ ব্যাকএন্ড-ডেটাকে অগ্রাধিকার দেওয়া হয়
    // প্রথম-পেইন্টের জন্য (এটাই আসল/সঠিক-অর্ডারের ডেটা), .txt শুধু
    // ফলব্যাক/পরে-merge হিসেবে।
    const oldPhotosPromise = fetch(csvUrl)
        .then(r => r.text())
        .then(textData => textData ? parsePhotoFile(textData) : [])
        .catch(() => []);

    // 🆕 cache ৪৫s এর মধ্যে fresh থাকলে Apps Script (cold-start-প্রবণ)
    // কল স্কিপ করে সরাসরি cache থেকেই দেখানো হবে — cacheSkippedLiveFetch
    // true থাকলে নিচের .then() এ merge/repaint করা হবে না, কারণ
    // paintedFromCache থেকেই সঠিক গ্যালারি ইতিমধ্যে দেখানো হয়ে গেছে।
    const cacheSkippedLiveFetch = isPhotoCacheFresh();
    const liveImagesPromise = cacheSkippedLiveFetch ? Promise.resolve(null) : fetchLiveUploads();

    let oldPhotosResult = null;
    let liveImagesResult = null;
    let firstPaintDone = false;

    function maybeFirstPaint() {
        if (paintedFromCache || firstPaintDone) return;
        if (liveImagesResult && liveImagesResult.length > 0) {
            firstPaintDone = true;
            showGallery(liveImagesResult.map((img, i) => liveImageToPhoto(img, i)));
        } else if (oldPhotosResult !== null) {
            firstPaintDone = true;
            showGallery(oldPhotosResult);
        }
        // liveImagesResult resolved কিন্তু খালি, আর oldPhotosResult এখনো
        // আসেনি — তখন কিছু না করে oldPhotos আসা পর্যন্ত অপেক্ষা করা হয়,
        // যাতে খামাখা একটা ফাঁকা গ্যালারি ফ্ল্যাশ না করে।
    }

    function maybeFinalPaint() {
        if (oldPhotosResult === null || liveImagesResult === null) return;
        const merged = buildMergedPhotoList(oldPhotosResult, liveImagesResult);
        showGallery(merged);
        try {
            localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(merged));
            localStorage.setItem(PHOTO_CACHE_TIME_KEY, String(Date.now()));
        } catch (e) {}

        if (!liveImagesResult.length) {
            retryLiveUploadsInBackground(oldPhotosResult);
        }
    }

    oldPhotosPromise.then(oldPhotos => {
        oldPhotosResult = oldPhotos;
        maybeFirstPaint();
        maybeFinalPaint();
    }).catch(() => {
        oldPhotosResult = [];
        maybeFirstPaint();
        maybeFinalPaint();
        if (!paintedFromCache && !firstPaintDone) {
            document.getElementById('loadingState').innerHTML =
                '<p style="color:var(--muted)">Could not load photos. Check your connection.</p>';
        }
    });

    liveImagesPromise.then(liveImages => {
        if (liveImages === null && cacheSkippedLiveFetch) {
            // fresh cache থেকেই গ্যালারি দেখানো হয়ে গেছে, Apps Script
            // কল এই লোডে ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছে — কিছু করার নেই।
            return;
        }
        liveImagesResult = liveImages || [];
        maybeFirstPaint();
        maybeFinalPaint();
    });

    // =====================================================================
    // 🆕 VIRTUALIZED GRID — শুধু viewport + বাফার-এর ছবিগুলোই DOM-এ থাকে
    // -----------------------------------------------------------------
    // আগে "Load More"-এ ১৬টা করে ছবি DOM-এ *যোগ* হতো, কমতো না — হাজার
    // হাজার ছবিতে DOM ভারী হয়ে ব্রাউজার স্লো হয়ে যেত। এখন প্রতিটা ছবির
    // aspect-ratio সমান (3:4) হওয়ায় প্রতিটা row-এর উচ্চতা predictable,
    // তাই পুরো গ্রিডের row/column গণিত করে শুধু scroll-এর কাছাকাছি
    // থাকা ছবিগুলোই real DOM node হিসেবে বসানো হয় (absolute position
    // দিয়ে), বাকি জায়গাটা masonry container-এর height দিয়ে reserve করা
    // থাকে — scrollbar স্বাভাবিক আচরণ করে, কিন্তু DOM সবসময় হালকা থাকে।
    // =====================================================================

    let GRID_GAP = 16;
    const BUFFER_ROWS = 3; // viewport-এর উপরে/নিচে অতিরিক্ত কয়েক সারি রেন্ডার করা থাকে, যাতে দ্রুত scroll করলেও ফাঁকা না দেখায়

    const renderedItems = new Map(); // photo.idx -> DOM element (বর্তমানে DOM-এ যা আছে)
    let virtualPhotos = [];          // বর্তমানে layout করা তালিকা (currentList-এর সাথে মিরর করা)
    let virtualLayout = { columns: 4, itemWidth: 0, itemHeight: 0, rowHeight: 0, totalRows: 0 };

    function getColumnCount() {
        const w = window.innerWidth;
        if (w <= 400) return 4;
        if (w <= 700) return 2;
        if (w <= 1100) return 3;
        return 4;
    }

    function computeVirtualLayout() {
        const masonry = document.getElementById('masonry');
        const containerWidth = masonry.clientWidth || masonry.parentElement.clientWidth || window.innerWidth;
        const columns = getColumnCount();
        GRID_GAP = window.innerWidth <= 400 ? 6 : 16; // 🆕 ছোট ফোনে ৪ কলাম, তাই gap কমানো হলো যাতে ছবিগুলো ছোট বাক্সে বেশি চেপে না যায়
        const itemWidth = (containerWidth - GRID_GAP * (columns - 1)) / columns;
        const itemHeight = itemWidth * 4 / 3; // aspect-ratio 3 / 4 (width : height)
        const rowHeight = itemHeight + GRID_GAP;
        const totalRows = Math.ceil(virtualPhotos.length / columns);
        masonry.style.height = totalRows > 0 ? (totalRows * rowHeight - GRID_GAP) + 'px' : '0px';
        virtualLayout = { columns, itemWidth, itemHeight, rowHeight, totalRows };
    }

    function attachImgFallback(imgEl, photo) {
        // 🆕 প্রথমে thumbnail URL-টাই cache-busting param দিয়ে একবার retry
        // করা হয় (transient নেটওয়ার্ক/৪০৪ এড়াতে); তারপরও fail করলে
        // সরাসরি drive.google.com/uc?export=view লিংকে fallback করা হয়,
        // যেটা visitor-এর নিজের Google session-এর উপর নির্ভর করে বলে
        // সবচেয়ে কম-ব্যবহৃত শেষ ধাপ হিসেবে রাখা আছে।
        let stage = 0; // 0 = original, 1 = cache-bust retry, 2 = direct drive uc link, 3 = give up

        // 🆕 নতুন Drive-আপলোড করা ছবির ক্ষেত্রে file.setSharing() করার
        // পরও Google-এর নিজের CDN-এ thumbnail/uc লিংক আসলে সার্ভ হওয়া
        // শুরু করতে (permission propagate হতে) কিছুক্ষণ সময় লাগতে পারে —
        // এটা backend-এর কোনো bug না, Google Drive-এর নিজস্ব আচরণ।
        // তাই আপলোডের ৫ মিনিটের মধ্যেকার ছবির জন্য, বাকি সব fallback
        // fail করলেও সাথে সাথে বাদ না দিয়ে অল্প delay-তে (১সে, ২সে,
        // ৩সে) আরও কয়েকবার চেষ্টা করা হয়।
        const isFresh = !!(photo.date && (Date.now() - new Date(photo.date).getTime() < 5 * 60 * 1000));
        let freshRetries = 0;
        const MAX_FRESH_RETRIES = 3;

        // 🆕 রিট্রাই যত দ্রুতই করা হোক, Google-এর সার্ভার সাইড
        // propagation আসলে যতক্ষণ সময় নেয় ততক্ষণ ছবিটা আসবে না — তাই
        // মিলিসেকেন্ডে রিট্রাই করলেও ছবি তাড়াতাড়ি আসবে না। যেটা আসলে
        // চোখে লাগে সেটা হলো ব্রোকেন-ইমেজ আইকন। তাই সেটাই ঢেকে রাখা
        // হচ্ছে: fail করলে সাথে সাথে ছবিটা অদৃশ্য করে দেওয়া হয় (নিচের
        // dark background রঙই দেখা যায়), আর সফল হলে আস্তে fade-in
        // হয়ে যায় — কোনো ভাঙা আইকন কখনো দেখা যায় না।
        imgEl.addEventListener('load', function onLoad() {
            imgEl.style.opacity = '1';
        });

        imgEl.addEventListener('error', function onErr() {
            imgEl.style.opacity = '0';
            stage++;
            // 🛠️ FIX: আগে মাত্র ১ বার thumbnail retry করেই সরাসরি
            // full-resolution (uc?export=view, কখনো কখনো MB-এর ফাইল)
            // fallback-এ চলে যেত। Slow network-এ অনেক ছবি একসাথে লোড
            // হওয়ার সময় এই "error" প্রায়ই আসল broken image না, স্রেফ
            // সাময়িক network congestion — কিন্তু তার শাস্তি হিসেবে পুরো
            // পেজ বড় ফাইল ডাউনলোড করে আরও ধীর হয়ে যেত (একটা negative
            // feedback loop)। এখন full-resolution-এ যাওয়ার আগে ছোট
            // thumbnail দিয়েই আরও ২ বার (মোট ৩ বার) সামান্য backoff
            // দিয়ে retry করা হয় — congestion কমার সময় দেওয়া হয়।
            const MAX_THUMB_RETRIES = 3;
            if (stage <= MAX_THUMB_RETRIES) {
                const base = photo.thumbUrl || photo.url;
                const delay = 400 * stage; // 400ms, 800ms, 1200ms
                setTimeout(() => {
                    imgEl.src = base + (base.indexOf('?') === -1 ? '?' : '&') + 'retry=' + Date.now();
                }, delay);
                return;
            }
            if (stage === MAX_THUMB_RETRIES + 1 && isGoogleDriveUrl(photo.rawUrl)) {
                // 🆕 raw full-quality-এ যাওয়ার আগে আরেকটু ছোট সাইজ (w100)
                // দিয়ে একবার চেষ্টা — Drive-এর thumbnail engine কিছু
                // নির্দিষ্ট ফাইলে w200-তে বারবার fail করলেও ছোট সাইজে
                // সফল হতে পারে।
                const smallUrl = toRenderableUrl(photo.rawUrl, 100);
                imgEl.src = smallUrl + (smallUrl.indexOf('?') === -1 ? '?' : '&') + 'small=' + Date.now();
                return;
            }
            if (stage === MAX_THUMB_RETRIES + 2 && isGoogleDriveUrl(photo.rawUrl)) {
                const id = getDriveFileId(photo.rawUrl);
                if (id) {
                    imgEl.src = 'https://drive.google.com/uc?export=view&id=' + id;
                    return;
                }
            }
            if (isFresh && freshRetries < MAX_FRESH_RETRIES) {
                freshRetries++;
                const delay = 1000 * freshRetries;
                setTimeout(() => {
                    imgEl.src = photo.thumbUrl + (photo.thumbUrl.indexOf('?') === -1 ? '?' : '&') + 'wake=' + Date.now();
                }, delay);
                return;
            }
            const item = imgEl.closest('.photo-item, .strip-item');
            if (item) {
                if (item.classList.contains('photo-item')) {
                    renderedItems.delete(photo.idx);
                    const countEl = document.getElementById('photoCount');
                    if (countEl) {
                        const n = parseInt(countEl.textContent, 10);
                        if (!isNaN(n) && n > 0) countEl.textContent = n - 1;
                    }
                }
                item.remove();
            }
        });
    }

    function createPhotoElement(p) {
        const item = document.createElement('div');
        item.className = 'photo-item reveal' + (selectedKeys.has(getPhotoKey(p)) ? ' selected' : '');
        item.dataset.cat = p.cat;
        item.innerHTML = `
            <img src="${p.thumbUrl || p.url}" alt="${p.title}" loading="lazy" decoding="async" style="background:#0A1220;">
            <div class="photo-select-check" data-select-check>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <div class="photo-overlay">
                <div class="photo-meta">
                    <div class="photo-tag">${CATEGORY_LABELS[p.cat] || ''}</div>
                    <div class="photo-title">${p.title}</div>
                </div>
                <div class="photo-actions">
                    <button class="photo-action-btn" title="Download" onclick="dlImg('${p.downloadUrl}','Tonir-${p.idx + 1}.jpg');event.stopPropagation()">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/></svg>
                    </button>
                    <button class="photo-action-btn" title="Share" onclick="shareImg('${p.downloadUrl}','Tonir-${p.idx + 1}.jpg','${(p.title || 'Tonir Shaik').replace(/'/g, "\\'")}');event.stopPropagation()">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="18.5" r="2.4"/><path d="M8.2 10.6l7.5-4.1"/><path d="M8.2 13.4l7.5 4.1"/></svg>
                    </button>
                    <button class="photo-action-btn edit-tag-btn" title="Edit tags" onclick="event.stopPropagation();openEditTagsByIdx(${p.idx})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    ${p.fileId
                        ? `<button class="photo-action-btn delete-btn" title="Delete" onclick="event.stopPropagation();deletePhotoConfirm('${p.fileId}', this, '${p.acc || 'self'}')">×</button>`
                        : `<button class="photo-action-btn delete-btn" title="Delete" onclick="event.stopPropagation();deleteTextPhotoConfirm('${p.rawUrl.replace(/'/g, "\\'")}', this)">×</button>`}
                </div>
            </div>`;
        item.querySelector('[data-select-check]').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSelectPhoto(p);
        });
        item.addEventListener('click', () => {
            if (selectMode) { toggleSelectPhoto(p); return; }
            openLightbox(p.idx);
        });
        attachImgFallback(item.querySelector('img'), p);
        return item;
    }

    function positionItem(el, index) {
        const { columns, itemWidth, itemHeight, rowHeight } = virtualLayout;
        const row = Math.floor(index / columns);
        const col = index % columns;
        el.style.position = 'absolute';
        el.style.left = (col * (itemWidth + GRID_GAP)) + 'px';
        el.style.top = (row * rowHeight) + 'px';
        el.style.width = itemWidth + 'px';
        el.style.height = itemHeight + 'px';
    }

    function reconcileVirtualWindow() {
        const masonry = document.getElementById('masonry');
        const { rowHeight, totalRows, columns } = virtualLayout;

        if (!rowHeight || totalRows === 0) {
            renderedItems.forEach(el => el.remove());
            renderedItems.clear();
            return;
        }

        const rect = masonry.getBoundingClientRect();
        const scrolledIntoMasonry = -rect.top; // masonry container-এর ভেতরে কতটা scroll হয়েছে
        const viewportHeight = window.innerHeight;

        let startRow = Math.floor(scrolledIntoMasonry / rowHeight) - BUFFER_ROWS;
        let endRow = Math.ceil((scrolledIntoMasonry + viewportHeight) / rowHeight) + BUFFER_ROWS;
        startRow = Math.max(0, startRow);
        endRow = Math.min(totalRows, endRow);

        const startIdx = startRow * columns;
        const endIdx = Math.min(endRow * columns, virtualPhotos.length);

        // viewport-window এর বাইরে চলে যাওয়া node সরিয়ে ফেলা (DOM হালকা রাখতে)
        for (const [index, el] of renderedItems) {
            if (index < startIdx || index >= endIdx) {
                el.remove();
                renderedItems.delete(index);
            }
        }

        // window-এর ভেতরে থাকা কিন্তু এখনো DOM-এ নেই এমন ছবি যোগ করা
        for (let i = startIdx; i < endIdx; i++) {
            if (renderedItems.has(i)) continue;
            const p = virtualPhotos[i];
            if (!p) continue;
            const el = createPhotoElement(p);
            positionItem(el, i);
            masonry.appendChild(el);
            renderedItems.set(i, el);
            requestAnimationFrame(() => el.classList.add('visible'));
        }
    }

    let virtualUpdateScheduled = false;
    function scheduleVirtualUpdate() {
        if (virtualUpdateScheduled) return;
        virtualUpdateScheduled = true;
        requestAnimationFrame(() => {
            virtualUpdateScheduled = false;
            reconcileVirtualWindow();
        });
    }

    function resetVirtualGallery(photos) {
        virtualPhotos = photos;
        renderedItems.forEach(el => el.remove());
        renderedItems.clear();
        computeVirtualLayout();
        reconcileVirtualWindow();
    }

    window.addEventListener('scroll', scheduleVirtualUpdate, { passive: true });

    let virtualResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(virtualResizeTimer);
        virtualResizeTimer = setTimeout(() => {
            computeVirtualLayout(); // কলাম সংখ্যা বদলাতে পারে (breakpoint), তাই layout নতুন করে গণনা
            renderedItems.forEach(el => el.remove());
            renderedItems.clear();
            reconcileVirtualWindow();
        }, 150);
    });

    // =====================================================================
    // 🆕 MULTI-SELECT: bulk Download / Share / Edit tags / Delete
    // -----------------------------------------------------------------
    // গ্রিডটা ভার্চুয়ালাইজড (উপরে দেখো renderedItems/virtualPhotos) —
    // স্ক্রল করলে DOM নোড ক্রমাগত তৈরি/মুছে যেতে থাকে, তাই সিলেকশন কখনোই
    // শুধু DOM class দিয়ে মনে রাখা যাবে না। বরং একটা স্থিতিশীল key
    // (fileId থাকলে সেটা, নাহলে rawUrl) দিয়ে selectedKeys Set-এ রাখা হয় —
    // createPhotoElement() প্রতিবার তৈরি হওয়ার সময় এই Set দেখেই ঠিক করে
    // item-টা selected দেখাবে কিনা, তাই স্ক্রল করে ফিরে এলেও সিলেকশন হারায়
    // না। ডিলিট/এডিট-এর নেটওয়ার্ক লজিক এখানে নেই — সেগুলো admin-upload.js-এর
    // deleteMultipleConfirm() / openEditTagsForPhotos()-এ (bulk এর জন্য
    // নতুন যোগ করা, বিদ্যমান single-item লজিকই reuse করে)।
    // =====================================================================
    let selectMode = false;
    let selectedKeys = new Set();

    function getPhotoKey(p) {
        return p.fileId ? ('f:' + p.fileId) : ('u:' + (p.rawUrl || p.url));
    }

    function setSelectMode(on) {
        selectMode = on;
        document.body.classList.toggle('select-mode', on);
        const publicBtn = document.getElementById('publicSelectBtn');
        if (publicBtn) {
            publicBtn.classList.toggle('active', on);
            publicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (!on) {
            selectedKeys.clear();
            renderedItems.forEach(el => el.classList.remove('selected'));
        }
        updateBulkBar();
    }

    function toggleSelectPhoto(p) {
        const key = getPhotoKey(p);
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);

        const el = renderedItems.get(p.idx);
        if (el) el.classList.toggle('selected', selectedKeys.has(key));
        updateBulkBar();
    }

    function getSelectedPhotos() {
        return allPhotos.filter(p => selectedKeys.has(getPhotoKey(p))).sort((a, b) => a.idx - b.idx);
    }

    function updateBulkBar() {
        const bar = document.getElementById('bulkActionBar');
        if (!bar) return;
        const n = selectedKeys.size;
        document.getElementById('bulkCount').textContent = n + (n === 1 ? ' selected' : ' selected');
        ['bulkDownloadBtn', 'bulkShareBtn', 'bulkEditBtn', 'bulkDeleteBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = n === 0;
        });
    }

    const publicSelectBtn = document.getElementById('publicSelectBtn');
    if (publicSelectBtn) {
        publicSelectBtn.addEventListener('click', () => setSelectMode(!selectMode));
    }
    const bulkCancelBtn = document.getElementById('bulkCancelBtn');
    if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', () => setSelectMode(false));

    const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
    if (bulkSelectAllBtn) {
        bulkSelectAllBtn.addEventListener('click', () => {
            const allSelected = currentList.length > 0 && currentList.every(p => selectedKeys.has(getPhotoKey(p)));
            if (allSelected) {
                selectedKeys.clear();
            } else {
                currentList.forEach(p => selectedKeys.add(getPhotoKey(p)));
            }
            renderedItems.forEach((el, idx) => {
                const p = virtualPhotos[idx];
                if (p) el.classList.toggle('selected', selectedKeys.has(getPhotoKey(p)));
            });
            updateBulkBar();
        });
    }

    // ---- Bulk Download: একটার পর একটা staggered timeout দিয়ে ডাউনলোড
    // ট্রিগার করা হয় (ব্রাউজার একসাথে অনেকগুলো download popup ব্লক করে
    // দিতে পারে) ----
    const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');
    if (bulkDownloadBtn) {
        bulkDownloadBtn.addEventListener('click', () => {
            getSelectedPhotos().forEach((p, i) => {
                setTimeout(() => dlImg(p.downloadUrl, 'Tonir-' + (p.idx + 1) + '.jpg'), i * 500);
            });
        });
    }

    // ---- Bulk Share: multi-file Web Share সাপোর্ট করা ব্রাউজারে একসাথে
    // সব ফাইল শেয়ার করার চেষ্টা করে (ঠিক shareImg()-এর সিঙ্গেল-ফাইল
    // ভার্সনের মতোই লজিক), নাহলে শুধু গ্যালারি লিংক শেয়ার/কপি হয় ----
    const bulkShareBtn = document.getElementById('bulkShareBtn');
    if (bulkShareBtn) {
        bulkShareBtn.addEventListener('click', () => {
            const photos = getSelectedPhotos();
            if (photos.length === 0) return;
            const pageUrl = 'https://tonirshaik.github.io/tonirshaik/';
            const shareText = photos.length + ' photos — Tonir Shaik | Official Gallery';

            Promise.all(photos.map(p =>
                fetch(p.downloadUrl).then(r => r.blob()).then(blob =>
                    new File([blob], 'Tonir-' + (p.idx + 1) + '.jpg', { type: blob.type || 'image/jpeg' })
                )
            )).then(files => {
                if (navigator.canShare && navigator.canShare({ files: files })) {
                    return navigator.share({ files: files, title: shareText, text: shareText });
                }
                throw new Error('multi-file-share-unsupported');
            }).catch(() => {
                if (navigator.share) {
                    navigator.share({ title: shareText, text: shareText, url: pageUrl }).catch(() => {});
                } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(pageUrl).then(() => {
                        alert('লিংক কপি হয়েছে! এখন যেকোনো জায়গায় পেস্ট করে শেয়ার করতে পারবেন।');
                    }).catch(() => {});
                }
            });
        });
    }

    // ---- Bulk Edit tags: admin-upload.js-এর openEditTagsForPhotos() কল
    // করে — বিদ্যমান editTagList/overlay-ই আবার ব্যবহার হয়, শুধু
    // allPhotos-এর বদলে সিলেক্টেড ছবিগুলো দিয়ে list বসানো হয়, Prev/Next/Save
    // অপরিবর্তিতই কাজ করে ----
    const bulkEditBtn = document.getElementById('bulkEditBtn');
    if (bulkEditBtn) {
        bulkEditBtn.addEventListener('click', () => {
            const photos = getSelectedPhotos();
            if (photos.length === 0) return;
            if (window.openEditTagsForPhotos) window.openEditTagsForPhotos(photos);
        });
    }

    // ---- Bulk Delete: admin-upload.js-এর deleteMultipleConfirm() কল করে,
    // যেটা ব্যাকএন্ডের নতুন deleteMultiple action ব্যবহার করে ----
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', () => {
            const photos = getSelectedPhotos();
            if (photos.length === 0) return;
            if (!confirm('Are you sure you want to permanently delete ' + photos.length + ' selected photo(s)?')) return;
            if (window.deleteMultipleConfirm) {
                window.deleteMultipleConfirm(photos, bulkDeleteBtn, () => setSelectMode(false));
            }
        });
    }

    // ব্যাকওয়ার্ড-কম্প্যাটিবল নাম — showGallery() ও applyFiltersAndSearch()
    // আগের মতোই renderGallery(currentList, true) কল করে, তাই ওই দুই জায়গায়
    // কিছু বদলাতে হয়নি।
    function renderGallery(photos, reset) {
        if (reset) resetVirtualGallery(photos);
    }

    function buildStrip(photos) {
        // নিচের ছবির স্লাইডার বন্ধ করে দেওয়া হয়েছে (পারফরম্যান্সের জন্য) —
        // তাই এই ফাংশন আর কিছু করে না।
        return;
    }

    // Recomputes currentList from allPhotos using both the active category
    // filter and the active search query, then re-renders the grid from
    // scratch. Called whenever either the filter buttons or the search box
    // change, so the two always combine rather than override each other.
    let searchIsNumberRange = false;

    function applyFiltersAndSearch() {
        let list = activeFilter === 'all' ? allPhotos : allPhotos.filter(p => p.cat === activeFilter);
        searchIsNumberRange = false;
        if (searchQuery) {
            const isNumberOnly = /^\d+$/.test(searchQuery);
            if (isNumberOnly) {
                searchIsNumberRange = true;
                const startNum = parseInt(searchQuery, 10);
                list = list.filter(p => (p.idx + 1) >= startNum);
            } else {
                list = list.filter(p => p.searchIndex.indexOf(searchQuery) !== -1);
            }
        }
        currentList = list;
        renderGallery(currentList, true);
        updateSearchStatus(list.length);
    }

    function updateSearchStatus(count) {
        const status = document.getElementById('searchStatus');
        if (!searchQuery) {
            status.textContent = '';
            status.classList.remove('active');
            return;
        }
        status.classList.add('active');
        if (searchIsNumberRange) {
            status.textContent = count + (count === 1 ? ' photo' : ' photos') + ' from #' + searchQuery + ' to the end';
        } else {
            status.textContent = count + (count === 1 ? ' result' : ' results') + ' for "' + searchQuery + '"';
        }
    }

    // ---- Filter dropdown (replaces the old All/Single/Dual/Group button row) ----
    const filterDropdownBtn = document.getElementById('filterDropdownBtn');
    const filterDropdownMenu = document.getElementById('filterDropdownMenu');
    const filterDropdownLabel = document.getElementById('filterDropdownLabel');

    function closeFilterDropdown() {
        filterDropdownMenu.classList.remove('open');
        filterDropdownBtn.classList.remove('open');
        filterDropdownBtn.setAttribute('aria-expanded', 'false');
    }
    function toggleFilterDropdown() {
        const isOpen = filterDropdownMenu.classList.toggle('open');
        filterDropdownBtn.classList.toggle('open', isOpen);
        filterDropdownBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    filterDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilterDropdown();
    });

    document.querySelectorAll('.filter-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            activeFilter = item.dataset.filter;
            filterDropdownLabel.textContent = item.textContent;
            applyFiltersAndSearch();
            closeFilterDropdown();
        });
    });

    document.addEventListener('click', (e) => {
        if (!filterDropdownMenu.contains(e.target) && e.target !== filterDropdownBtn) {
            closeFilterDropdown();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeFilterDropdown();
    });

    // ---- Typing search (debounced, instant filter) ----
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    let searchDebounce = null;

    searchInput.addEventListener('input', () => {
        searchClear.style.display = searchInput.value ? 'block' : 'none';
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            searchQuery = searchInput.value.trim().toLowerCase();
            applyFiltersAndSearch();
        }, 150);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        searchQuery = '';
        applyFiltersAndSearch();
        searchInput.focus();
    });

    // ---- Voice search (Web Speech API, English + Bengali) ----
    const micBtn = document.getElementById('micBtn');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognizer = null;
    let isListening = false;

    let selectedLang = 'bn-BD';
    const langToggleBtn = document.getElementById('langToggleBtn');
    langToggleBtn.addEventListener('click', () => {
        if (isListening) stopListening();
        if (selectedLang === 'bn-BD') {
            selectedLang = 'en-IN';
            langToggleBtn.textContent = 'EN';
            langToggleBtn.classList.add('en');
            langToggleBtn.title = 'বাংলায় বদলাতে ক্লিক করো';
        } else {
            selectedLang = 'bn-BD';
            langToggleBtn.textContent = 'বাং';
            langToggleBtn.classList.remove('en');
            langToggleBtn.title = 'English-এ বদলাতে ক্লিক করো';
        }
    });

    function pickBestTranscript(alternatives) {
        const combinedIndex = allPhotos.map(p => p.searchIndex).join(' ');
        let best = (alternatives[0] && alternatives[0].transcript || '').trim();
        let bestScore = -1;
        for (let i = 0; i < alternatives.length; i++) {
            const t = (alternatives[i].transcript || '').trim();
            if (!t) continue;
            const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 1);
            let score = 0;
            words.forEach(w => { if (combinedIndex.indexOf(w) !== -1) score++; });
            if (score > bestScore) { bestScore = score; best = t; }
        }
        return best;
    }

    function runRecognition(lang) {
        const rec = new SpeechRecognition();
        rec.lang = lang;
        rec.interimResults = false;
        rec.maxAlternatives = 5;
        let gotResult = false;

        rec.onresult = (e) => {
            const transcript = pickBestTranscript(e.results[0]);
            if (!transcript) return;
            gotResult = true;
            searchInput.value = transcript;
            searchClear.style.display = 'block';
            searchQuery = transcript.toLowerCase();
            applyFiltersAndSearch();
        };

        rec.onerror = () => stopListening();
        rec.onend = () => stopListening();

        recognizer = rec;
        rec.start();
    }

    function stopListening() {
        isListening = false;
        micBtn.classList.remove('listening');
        if (recognizer) {
            try { recognizer.onend = null; recognizer.onerror = null; recognizer.stop(); } catch (e) {}
            recognizer = null;
        }
    }

    function startListening() {
        if (!SpeechRecognition) {
            document.getElementById('searchStatus').textContent =
                'Voice search isn\'t supported in this browser.';
            return;
        }
        isListening = true;
        micBtn.classList.add('listening');
        runRecognition(selectedLang);
    }

    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    });

    function openLightbox(idx) {
        const pos = currentList.findIndex(p => p.idx === idx);
        currentIdx = pos !== -1 ? pos : 0;
        updateLightbox();
        document.getElementById('lightbox').classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
        document.getElementById('lightbox').classList.remove('open');
        document.body.style.overflow = '';
    }
    function updateLightbox() {
        const p = currentList[currentIdx];
        document.getElementById('lbImg').src = p.url;
        document.getElementById('lbTitle').textContent = p.title;
        document.getElementById('lbCounter').textContent = (currentIdx + 1) + ' / ' + currentList.length;
        document.getElementById('lbDl').onclick = () => dlImg(p.downloadUrl, 'Tonir-' + (p.idx + 1) + '.jpg');
        document.getElementById('lbShare').onclick = () => shareImg(p.downloadUrl, 'Tonir-' + (p.idx + 1) + '.jpg', p.title || 'Tonir Shaik');
    }

    document.getElementById('lbClose').onclick = closeLightbox;
    document.getElementById('lightbox').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeLightbox();
    });
    document.getElementById('lbPrev').onclick = () => {
        currentIdx = (currentIdx - 1 + currentList.length) % currentList.length;
        updateLightbox();
    };
    document.getElementById('lbNext').onclick = () => {
        currentIdx = (currentIdx + 1) % currentList.length;
        updateLightbox();
    };
    document.addEventListener('keydown', e => {
        if (!document.getElementById('lightbox').classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') document.getElementById('lbPrev').click();
        if (e.key === 'ArrowRight') document.getElementById('lbNext').click();
    });

    // 🆕 মোবাইলে ছবি বড় করার পর বাম/ডানে সোয়াইপ (টান) করলে আগের/পরের ছবি দেখাবে
    (function() {
        const lbEl = document.getElementById('lightbox');
        const lbInner = lbEl.querySelector('.lb-inner');
        if (!lbInner) return;
        let touchStartX = 0, touchStartY = 0, touchMoved = false;

        lbInner.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchMoved = false;
        }, { passive: true });

        lbInner.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });

        lbInner.addEventListener('touchend', (e) => {
            if (!touchMoved) return;
            const touch = e.changedTouches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;
            // শুধু যখন হরাইজন্টাল টান ভার্টিক্যাল থেকে স্পষ্ট বেশি, তখনই সোয়াইপ ধরা হবে
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                if (dx < 0) document.getElementById('lbNext').click(); // বামে টান = পরের ছবি
                else document.getElementById('lbPrev').click();        // ডানে টান = আগের ছবি
            }
        });
    })();

    function dlImg(url, filename) {
        fetch(url)
            .then(r => r.blob())
            .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
            })
            .catch(() => window.open(url, '_blank'));
    }

    function shareImg(url, filename, title) {
        const pageUrl = 'https://tonirshaik.github.io/tonirshaik/';
        const shareText = title + ' — Tonir Shaik | Official Gallery';

        fetch(url)
            .then(r => r.blob())
            .then(blob => {
                const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    return navigator.share({
                        files: [file],
                        title: shareText,
                        text: shareText
                    });
                }
                throw new Error('file-share-unsupported');
            })
            .catch(() => {

                if (navigator.share) {
                    navigator.share({ title: shareText, text: shareText, url: pageUrl }).catch(() => {});
                } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(pageUrl).then(() => {
                        alert('লিংক কপি হয়েছে! এখন যেকোনো জায়গায় পেস্ট করে শেয়ার করতে পারবেন।');
                    }).catch(() => {
                        window.open(url, '_blank');
                    });
                } else {
                    window.open(url, '_blank');
                }
            });
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    (function() {
        const navEl = document.querySelector('nav');
        const headerEl = document.querySelector('.section-header');
        if (!navEl || !headerEl) return;
        function syncNavSpacing() {
            headerEl.style.paddingTop = (navEl.offsetHeight + 8) + 'px';
        }
        syncNavSpacing();
        window.addEventListener('load', syncNavSpacing);
        window.addEventListener('resize', syncNavSpacing);
        if (window.ResizeObserver) {
            new ResizeObserver(syncNavSpacing).observe(navEl);
        }
    })();

    (function() {
        const hamburgerBtn = document.getElementById('navHamburgerBtn');
        const drawer = document.getElementById('sideDrawer');
        const overlay = document.getElementById('sideDrawerOverlay');
        const closeBtn = document.getElementById('sideDrawerClose');

        function openDrawer() {
            drawer.classList.add('open');
            overlay.classList.add('open');
            hamburgerBtn.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
        function closeDrawer() {
            drawer.classList.remove('open');
            overlay.classList.remove('open');
            hamburgerBtn.classList.remove('open');
            document.body.style.overflow = '';
        }

        hamburgerBtn.addEventListener('click', () => {
            if (drawer.classList.contains('open')) closeDrawer();
            else openDrawer();
        });
        closeBtn.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeDrawer();
        });

        document.getElementById('sideGalleryLink').addEventListener('click', (e) => {
            e.preventDefault();
            closeDrawer();
            document.getElementById('navGalleryLink').click();
        });
        document.getElementById('sideWorkPicLink').addEventListener('click', (e) => {
            e.preventDefault();
            closeDrawer();
            document.getElementById('navWorkPicLink').click();
        });
    })();

    // 🆕 মোবাইলে সার্চ বার ডিফল্টে ছোট আইকন, ট্যাপ করলে খোলে (YouTube-স্টাইল)
    (function() {
        const searchBar = document.querySelector('.search-bar');
        const searchRow = document.querySelector('.search-row');
        const searchIcon = document.querySelector('.search-bar .search-icon');
        const searchInput = document.getElementById('searchInput');
        const navEl = document.querySelector('nav');
        if (!searchBar || !searchRow || !searchIcon || !searchInput || !navEl) return;

        function isMobile() { return window.matchMedia('(max-width: 600px)').matches; }

        function expand() {
            searchBar.classList.add('mobile-expanded');
            searchRow.classList.add('search-active');
            searchInput.focus();
        }
        function collapse() {
            searchBar.classList.remove('mobile-expanded');
            searchRow.classList.remove('search-active');
        }

        searchIcon.addEventListener('click', () => {
            if (!isMobile()) return;
            if (!searchBar.classList.contains('mobile-expanded')) expand();
        });

        document.addEventListener('click', (e) => {
            if (!isMobile()) return;
            if (!searchBar.contains(e.target) && searchInput.value.trim() === '') collapse();
        });

        window.addEventListener('resize', () => {
            if (!isMobile()) collapse();
        });
    })();


    // 3D টিল্ট ইফেক্ট বন্ধ করে দেওয়া হয়েছে যাতে ছবিতে ক্লিক/হোভার করলে
    // ছবিগুলো নড়াচড়া বা ঘোরাঘুরি না করে।
    /*
    (function() {
        function applyTilt(card) {
            if (card._tiltBound) return;
            card._tiltBound = true;

            card.addEventListener('mousemove', function(e) {
                const rect = card.getBoundingClientRect();
                const cx = rect.left + rect.width  / 2;
                const cy = rect.top  + rect.height / 2;
                const dx = (e.clientX - cx) / (rect.width  / 2);
                const dy = (e.clientY - cy) / (rect.height / 2);
                const rotX = -dy * 10;
                const rotY =  dx * 10;

                card.style.transform =
                    `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.04)`;
                card.style.transition = 'transform 0.08s ease';

                let shine = card.querySelector('.tilt-shine');
                if (!shine) {
                    shine = document.createElement('div');
                    shine.className = 'tilt-shine';
                    shine.style.cssText = `
                        position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:4;
                        background:radial-gradient(circle at 50% 50%, rgba(63,168,255,0.22) 0%, transparent 70%);
                        transition:opacity 0.3s;
                    `;
                    card.style.position = 'relative';
                    card.appendChild(shine);
                }
                const px = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1);
                const py = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
                shine.style.background = `radial-gradient(circle at ${px}% ${py}%, rgba(63,168,255,0.30) 0%, transparent 65%)`;
                shine.style.opacity = '1';
            });

            card.addEventListener('mouseleave', function() {
                card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)';
                card.style.transition = 'transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94)';
                const shine = card.querySelector('.tilt-shine');
                if (shine) shine.style.opacity = '0';
            });
        }

        function bindAll() {
            document.querySelectorAll('.photo-item').forEach(applyTilt);
        }
        bindAll();
        const observer = new MutationObserver(bindAll);
        observer.observe(document.getElementById('masonry') || document.body, { childList: true, subtree: true });
    })();
    */

    // 🆕 admin-upload.js ও workpic.js — এই দুইটা ফাইল শুধু admin/owner-এর
    // কাজে লাগে (password-protected upload/dashboard), কিন্তু আগে প্রতিটা
    // সাধারণ visitor-ও এগুলো ডাউনলোড করত। এখন এগুলো "lazy" — শুধুমাত্র
    // "Upload" বা "Work Pic" লিংকে প্রথমবার ক্লিক করলে তখন ডাউনলোড হয়।
    // capture-phase-এ handler বসিয়ে আসল script লোড হওয়ার আগেই ক্লিক ধরে
    // ফেলা হয়, script লোড শেষ হলে সেই handler সরিয়ে আবার click() dispatch
    // করা হয় — তখন script-এর নিজস্ব listener (যেটা এখন attach হয়ে গেছে)
    // স্বাভাবিকভাবেই কাজ করে, ঠিক যেন প্রথম ক্লিকেই সরাসরি কাজ করেছে।
    (function () {
        function lazyLoadOnFirstClick(linkId, scriptSrc) {
            const link = document.getElementById(linkId);
            if (!link) return;
            let loading = false;
            let loaded = false;

            function handler(e) {
                if (loaded) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                if (loading) return;
                loading = true;
                const prevCursor = link.style.cursor;
                link.style.cursor = 'wait';

                const script = document.createElement('script');
                script.src = scriptSrc;
                script.onload = function () {
                    loaded = true;
                    link.style.cursor = prevCursor;
                    link.removeEventListener('click', handler, true);
                    link.click(); // এখন script-এর real listener এটা ধরবে
                };
                script.onerror = function () {
                    loading = false;
                    link.style.cursor = prevCursor;
                };
                document.body.appendChild(script);
            }

            link.addEventListener('click', handler, true);
        }

        lazyLoadOnFirstClick('navGalleryLink', 'admin-upload.js');
        lazyLoadOnFirstClick('navWorkPicLink', 'js/workpic.js');
    })();
    // 🆕 SERVICE WORKER: HTML shell, নিজের JS, Google Fonts, favicon —
    // এগুলো cache করে রাখা হয় যাতে পরের visit-এ প্রায় instant লোড হয়।
    // window 'load'-এর পর register করা হচ্ছে যাতে প্রথমবারের render/paint
    // এতে বিন্দুমাত্র দেরি না হয়। ছবি/লাইভ ডেটা এখানে cache হয় না
    // (দেখুন sw.js-এ NEVER_CACHE_HOSTS)।
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
    }
