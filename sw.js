// 🆕 Tonir Shaik Gallery — Service Worker
// শুধু "static" জিনিস (HTML shell, নিজের JS ফাইল, Google Fonts, favicon)
// cache করা হয়, যাতে দ্বিতীয়/পরবর্তী visit-এ সেগুলো নেটওয়ার্ক ছাড়াই
// প্রায় সাথে সাথে লোড হয়।
//
// ছবি (drive.google.com), লাইভ gallery-data (Cloudflare Worker), আর
// Apps Script (script.google.com) ইচ্ছাকৃতভাবে কখনো cache করা হয় না —
// এগুলো সবসময় সবচেয়ে নতুন ডেটা/ছবি দেখানোর জন্য সরাসরি নেটওয়ার্কে যায়।

const CACHE_NAME = 'tonir-gallery-v2';

const PRECACHE_URLS = [
  './',
  './index.html',
  './admin-upload.js',
  './workpic.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Inter:wght@400;500&display=swap',
  'https://tonirshaik.github.io/tonirshaik/web-app-manifest-512x512.png'
];

// এই host-গুলোর রিকোয়েস্ট কখনো intercept/cache করা হবে না
const NEVER_CACHE_HOSTS = [
  'drive.google.com',
  'script.google.com',
  'script.googleusercontent.com',
  'tonir-image-proxy.tonirshaik.workers.dev'
];

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
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return; // ছবি/লাইভ ডেটা কখনো cache না

  // Stale-while-revalidate: cache-এ থাকলে সেটা সাথে সাথে দেখানো হয়,
  // পাশাপাশি ব্যাকগ্রাউন্ডে নেটওয়ার্ক থেকে নতুন ভার্সন এনে cache আপডেট
  // করা হয় — পরের visit-এ সবচেয়ে নতুনটা পাওয়া যাবে। নেটওয়ার্ক না থাকলে
  // (অফলাইন) cache-টাই fallback হিসেবে কাজ করে।
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
});
