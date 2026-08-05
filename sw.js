// 🆕 Tonir Shaik Gallery — Service Worker
// শুধু "static" জিনিস (HTML shell, নিজের JS ফাইল, Google Fonts, favicon/icon)
// cache করা হয়, যাতে দ্বিতীয়/পরবর্তী visit-এ সেগুলো নেটওয়ার্ক ছাড়াই
// প্রায় সাথে সাথে লোড হয়।
//
// ছবি (drive.google.com, ImgBB বা অন্য যেকোনো image host), লাইভ
// gallery-data (Cloudflare Worker), আর Apps Script (script.google.com)
// ইচ্ছাকৃতভাবে কখনো cache করা হয় না — এগুলো সবসময় সবচেয়ে নতুন
// ডেটা/ছবি দেখানোর জন্য সরাসরি নেটওয়ার্কে যায়।
//
// 🛠️ FIX: আগে এখানে একটা NEVER_CACHE_HOSTS blocklist ছিল (শুধু ৪টা
// hardcoded host বাদ দেওয়া হতো)। সমস্যা হলো — ImgBB-হোস্টেড ছবি (বা
// ভবিষ্যতে যোগ হওয়া যেকোনো নতুন image host) সেই লিস্টে না থাকায়
// ভুলবশত "static asset" হিসেবে ধরা পড়ে যেত, cache হয়ে যেত, আর প্রতি
// visit-এ পুরো ছবিটা আবার নেটওয়ার্ক থেকে (background revalidate)
// টেনে আনা হতো — Slow 4G-তে এটাই বাকি সব request-এর bandwidth কেড়ে
// নিয়ে পুরো পেজ ধীর করে দিচ্ছিল।
//
// এখন উল্টো approach: blocklist না, বরং allowlist — শুধু নিচের
// STATIC_ALLOWLIST-এ যা মেলে, শুধু সেটাই SW handle করে। বাকি সব
// (ছবি সহ, host যাই হোক) সরাসরি নেটওয়ার্কে চলে যায়, SW একদম touch
// করে না। নতুন কোনো image host যোগ হলেও আর কিছু ভাঙবে না।

const CACHE_NAME = 'tonir-gallery-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './admin-upload.js',
  './workpic.js',
  './sw.js',
  './web-app-manifest-512x512.png',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Inter:wght@400;500&display=swap'
];

// এই ৩ ধরনের request-ই শুধু SW handle করবে, বাকি সব pass-through
function isStaticAsset(url) {
  // ১. নিজের origin-এর HTML/JS/PNG/manifest ফাইল
  if (url.origin === self.location.origin) return true;
  // ২. Google Fonts (CSS + আসল font file দুটোই)
  if (url.hostname === 'fonts.googleapis.com') return true;
  if (url.hostname === 'fonts.gstatic.com') return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // একটা URL fail করলেও (যেমন workpic.js এখনো না থাকলে) যাতে
        // পুরো install ব্যর্থ না হয়, তাই allSettled ব্যবহার করা হলো
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return; // upload/edit/delete ইত্যাদি সবসময় নেটওয়ার্কে

  const url = new URL(req.url);
  if (!isStaticAsset(url)) return; // ছবি/লাইভ ডেটা/অন্য যেকোনো host — SW একদম টাচ করে না

  // index.html আর ./ (shell) — এগুলো মাঝেমধ্যেই বদলাতে পারে (নতুন
  // ফিচার, বাগ ফিক্স ইত্যাদি), তাই stale-while-revalidate: cache থেকে
  // সাথে সাথে দেখানো হয়, পাশাপাশি ব্যাকগ্রাউন্ডে নেটওয়ার্ক থেকে নতুন
  // ভার্সন এনে cache আপডেট করা হয় — পরের visit-এ সবচেয়ে নতুনটা পাওয়া
  // যাবে।
  const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isShell) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const networkFetch = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // 🆕 বাকি সব static asset (JS ফাইল, Google Fonts, manifest icon) —
  // এগুলো নাম বদলালেই (deploy) নতুন URL হয় বা কালেভদ্রে বদলায়, তাই
  // cache-first: cache-এ থাকলে network-এ না গিয়েই সাথে সাথে সার্ভ করা
  // হয় (bandwidth বাঁচে, বিশেষ করে বড় icon ফাইলে)। cache-এ না থাকলে
  // network থেকে এনে cache-এ রেখে দেওয়া হয়। ফাইল আপডেট করলে
  // CACHE_NAME (v2 → v3 ইত্যাদি) বাড়িয়ে দিলেই পুরনো cache মুছে নতুন
  // ভার্সন আসবে।
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        });
      })
    )
  );
});
