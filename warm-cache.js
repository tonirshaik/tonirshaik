/**
 * warm-cache.js
 * ------------------------------------------------------------------
 * উদ্দেশ্য: প্রতিটা ছবি প্রথম "real visitor" আসার আগেই Cloudflare Worker-এর
 * edge cache-এ বসিয়ে দেওয়া, যাতে কেউ কখনো "প্রথম মানুষ" হিসেবে ধীর
 * Drive fetch-এর মুখোমুখি না হয়।
 *
 * এটা করে কীভাবে:
 * 1. GitHub-এর লিগ্যাসি টেক্সট ফাইল (csvUrl) + Apps Script (APPS_SCRIPT_URL)
 *    থেকে সব ছবির লিংক সংগ্রহ করে — ঠিক index.html যেভাবে করে।
 * 2. প্রতিটা ছবির জন্য থাম্ব (200px) ও ফুল (1000px) — দুটো সাইজের
 *    proxy URL বানায়।
 * 3. সীমিত concurrency-তে (একসাথে ৫টা) সেই URL গুলো fetch করে —
 *    এতে Worker নিজে থেকেই Drive থেকে ছবি টেনে edge-এ cache করে ফেলে।
 *
 * চালানোর উপায়:
 *   - সরাসরি: `node warm-cache.js`  (Node 18+, built-in fetch দরকার)
 *   - অথবা GitHub Actions cron/manual trigger দিয়ে (নিচে workflow ফাইল আছে)
 *
 * নোট: এটা আপনার আসল Cloudflare Worker কোড replace করে না — সেটা
 * অপরিবর্তিত থাকে। এই স্ক্রিপ্ট শুধু Worker-কে "আগেভাগে" হিট করে।
 * যদি আপনার worker-এ আলাদা query param বা auth লাগে, নিচের
 * CSV_URL / APPS_SCRIPT_URL / IMAGE_PROXY_BASE ঠিক করে নিন।
 * ------------------------------------------------------------------
 */

const CSV_URL = 'https://raw.githubusercontent.com/tonirshaik/tonirshaik/refs/heads/main/Tonir%20photo%20Link.txt';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyLRiJ9ueiqnc7kYc188HTg41wJNF3W1eighA2WA7xq9nUfMTJflzefxdXsrjIHOgXiLw/exec';
const IMAGE_PROXY_BASE = 'https://tonir-image-proxy.tonirshaik.workers.dev';
const CONCURRENCY = 5;
const SIZES = [200, 1000]; // grid থাম্ব + lightbox ফুল সাইজ

function getDriveFileId(url) {
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    return null;
}

function isGoogleDriveUrl(url) {
    return /drive\.google\.com/.test(url);
}

function proxyUrl(rawUrl, size) {
    if (!isGoogleDriveUrl(rawUrl)) return null;
    const id = getDriveFileId(rawUrl);
    if (!id) return null;
    return `${IMAGE_PROXY_BASE}/img?id=${id}&sz=w${size}`;
}

function extractUrlsFromTxt(text) {
    const urls = [];
    text.split('\n').forEach(line => {
        line = line.trim();
        if (!line.startsWith('http')) return;
        const commaIdx = line.indexOf(',');
        const url = (commaIdx === -1 ? line : line.slice(0, commaIdx)).trim();
        urls.push(url);
    });
    return urls;
}

async function fetchOldUrls() {
    try {
        const res = await fetch(CSV_URL);
        const text = await res.text();
        return extractUrlsFromTxt(text);
    } catch (e) {
        console.error('legacy txt fetch failed:', e.message);
        return [];
    }
}

async function fetchLiveUrls() {
    try {
        const res = await fetch(APPS_SCRIPT_URL);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.images)) {
            return data.images.map(img => img.url).filter(Boolean);
        }
        return [];
    } catch (e) {
        console.error('apps script fetch failed:', e.message);
        return [];
    }
}

async function warmOne(url) {
    try {
        const r = await fetch(url, { method: 'GET' });
        console.log(r.ok ? 'OK  ' : `ERR ${r.status}`, url);
    } catch (e) {
        console.log('FAIL', url, e.message);
    }
}

async function runPool(tasks, concurrency) {
    let i = 0;
    async function worker() {
        while (i < tasks.length) {
            const idx = i++;
            await tasks[idx]();
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
}

(async function main() {
    const [oldUrls, liveUrls] = await Promise.all([fetchOldUrls(), fetchLiveUrls()]);
    const allRaw = Array.from(new Set([...liveUrls, ...oldUrls]));

    const jobs = [];
    allRaw.forEach(raw => {
        SIZES.forEach(size => {
            const u = proxyUrl(raw, size);
            if (u) jobs.push(() => warmOne(u));
        });
    });

    console.log(`Warming ${jobs.length} image URLs (${allRaw.length} photos x ${SIZES.length} sizes)...`);
    await runPool(jobs, CONCURRENCY);
    console.log('Done.');
})();
