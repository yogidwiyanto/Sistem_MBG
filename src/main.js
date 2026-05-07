import { Detector } from "./detector.js";
import { Renderer } from "./renderer.js";
import nutritionData from "./nutrition-data.js";

// AKG harian (Angka Kecukupan Gizi) dewasa rata-rata
const DAILY_REF = { cal: 2150, protein: 60, carbs: 325, fat: 65, fiber: 30 };

// DOM
const $ = (id) => document.getElementById(id);
const loadingOverlay = $("loading-overlay");
const loadingBar = $("loading-bar");
const loadingText = $("loading-text");
const app = $("app");

let detector = null;
let cameraStream = null;
let animFrameId = null;
let isDetecting = false;
let uploadedImage = null;
let frameCount = 0;
let lastFpsTime = performance.now();

// ===== INIT =====
async function init() {
  detector = new Detector();
  try {
    await detector.loadModel("/models/best.onnx", (pct, msg) => {
      loadingBar.style.width = pct + "%";
      loadingText.textContent = msg;
    });
    loadingBar.style.width = "100%";
    loadingText.textContent = "Siap!";
    setTimeout(() => {
      loadingOverlay.classList.add("fade-out");
      app.classList.remove("hidden");
      setTimeout(() => (loadingOverlay.style.display = "none"), 500);
    }, 400);
  } catch (e) {
    loadingText.textContent = "Gagal memuat model: " + e.message;
    console.error(e);
  }
}

// ===== PAGE NAVIGATION =====
const navLinks = document.querySelectorAll(".nav-link");
const pages = document.querySelectorAll(".page");

function switchPage(page) {
  navLinks.forEach((l) => l.classList.toggle("active", l.dataset.page === page));
  pages.forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  if (page !== "realtime") stopCamera();
}

navLinks.forEach((l) => l.addEventListener("click", (e) => { e.preventDefault(); switchPage(l.dataset.page); }));
$("nav-brand-link").addEventListener("click", (e) => { e.preventDefault(); switchPage("upload"); resetUpload(); });

// ===== UPLOAD FLOW =====
const dropzone = $("upload-dropzone");
const fileInput = $("file-input");
const uploadPlaceholder = $("upload-placeholder");
const uploadPreview = $("upload-preview");
const uploadPreparing = $("upload-preparing");
const previewImg = $("preview-image");
const preparingImg = $("preparing-image");
const uploadResults = $("upload-results");
const uploadHero = $("upload-hero");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault(); dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      uploadedImage = img;
      previewImg.src = img.src;
      preparingImg.src = img.src;
      uploadPlaceholder.classList.add("hidden");
      uploadPreparing.classList.add("hidden");
      uploadPreview.classList.remove("hidden");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

$("btn-change-photo").addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });

$("btn-analyze").addEventListener("click", async () => {
  if (!uploadedImage || !detector) return;
  // Show preparing state
  uploadPreview.classList.add("hidden");
  uploadPreparing.classList.remove("hidden");

  await new Promise((r) => setTimeout(r, 300));

  try {
    const dets = await detector.detect(uploadedImage, uploadedImage.width, uploadedImage.height);
    showUploadResults(dets);
  } catch (e) {
    console.error(e);
    alert("Gagal mendeteksi: " + e.message);
    uploadPreparing.classList.add("hidden");
    uploadPreview.classList.remove("hidden");
  }
});

function resetUpload() {
  uploadedImage = null;
  fileInput.value = "";
  uploadPlaceholder.classList.remove("hidden");
  uploadPreview.classList.add("hidden");
  uploadPreparing.classList.add("hidden");
  uploadResults.classList.add("hidden");
  uploadHero.classList.remove("hidden");
}

$("btn-back-upload").addEventListener("click", resetUpload);

// ===== SHOW UPLOAD RESULTS =====
function showUploadResults(detections) {
  uploadHero.classList.add("hidden");
  uploadResults.classList.remove("hidden");

  // Draw image + detections on canvas
  const canvas = $("results-canvas");
  const ctx = canvas.getContext("2d");
  const img = uploadedImage;
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const renderer = new Renderer(canvas);
  renderer.ctx = ctx;
  for (const det of detections) renderer.drawBox(det);

  // Unique foods
  const unique = new Map();
  for (const d of detections) {
    if (!unique.has(d.className) || unique.get(d.className).confidence < d.confidence)
      unique.set(d.className, d);
  }
  const foods = [...unique.keys()];

  // Title
  $("results-title-text").textContent = foods.length ? foods.join(", ") : "Tidak ada makanan terdeteksi";

  // Description
  const descFoods = foods.map((f) => nutritionData[f]?.nama_pangan || f).join(", ");
  $("detection-description").textContent = foods.length
    ? `Terdeteksi ${detections.length} item makanan: ${descFoods}.`
    : "Tidak ada makanan yang terdeteksi. Coba foto lain atau sesuaikan confidence.";

  // Tags
  const tagColors = ["food-tag-green", "food-tag-amber", "food-tag-blue"];
  $("food-tags").innerHTML = foods
    .map((f, i) => `<span class="food-tag ${tagColors[i % 3]}">${f}</span>`)
    .join("");

  // Calculate nutrition
  const servings = parseInt($("servings-input").value) || 1;
  updateNutrition(foods, servings);

  // Servings change listener
  $("servings-input").onchange = () => updateNutrition(foods, parseInt($("servings-input").value) || 1);

  // Kelayakan nutrisi
  showAdequacy(foods, servings);

  // Additional info
  showAdditionalInfo(foods);
}

function updateNutrition(foods, servings) {
  let t = { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 };
  for (const f of foods) {
    const n = nutritionData[f];
    if (n) {
      t.cal += n.energi_kkal;
      t.pro += n.protein_g;
      t.carb += n.karbohidrat_g;
      t.fat += n.lemak_g;
      t.fib += n.serat_g;
    }
  }
  // Apply servings
  Object.keys(t).forEach((k) => (t[k] *= servings));

  $("nut-calories").textContent = Math.round(t.cal);
  $("nut-protein").textContent = t.pro.toFixed(1) + "g";
  $("nut-carbs").textContent = t.carb.toFixed(1) + "g";
  $("nut-fat").textContent = t.fat.toFixed(1) + "g";
  $("nut-fiber").textContent = t.fib.toFixed(1) + "g";

  // Macro progress
  const pcts = {
    cal: Math.min(100, (t.cal / DAILY_REF.cal) * 100),
    pro: Math.min(100, (t.pro / DAILY_REF.protein) * 100),
    carb: Math.min(100, (t.carb / DAILY_REF.carbs) * 100),
    fat: Math.min(100, (t.fat / DAILY_REF.fat) * 100),
  };
  $("macro-cal").style.width = pcts.cal + "%";
  $("macro-cal-pct").textContent = Math.round(pcts.cal) + "%";
  $("macro-pro").style.width = pcts.pro + "%";
  $("macro-pro-pct").textContent = Math.round(pcts.pro) + "%";
  $("macro-carb").style.width = pcts.carb + "%";
  $("macro-carb-pct").textContent = Math.round(pcts.carb) + "%";
  $("macro-fat").style.width = pcts.fat + "%";
  $("macro-fat-pct").textContent = Math.round(pcts.fat) + "%";

  showAdequacy(foods, servings);
}

// ===== KELAYAKAN NUTRISI =====
function showAdequacy(foods, servings) {
  let t = { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 };
  for (const f of foods) {
    const n = nutritionData[f];
    if (n) { t.cal += n.energi_kkal; t.pro += n.protein_g; t.carb += n.karbohidrat_g; t.fat += n.lemak_g; t.fib += n.serat_g; }
  }
  Object.keys(t).forEach((k) => (t[k] *= servings));

  const items = [];
  // Kalori
  const calPct = (t.cal / DAILY_REF.cal) * 100;
  if (calPct < 15) items.push({ level: "warning", icon: "⚠️", text: `<strong>Kalori rendah</strong> — Makanan ini hanya menyumbang ${Math.round(calPct)}% kebutuhan harian (${Math.round(t.cal)} dari ${DAILY_REF.cal} kkal). Pertimbangkan menambah porsi atau sumber kalori lain.` });
  else if (calPct <= 40) items.push({ level: "good", icon: "✅", text: `<strong>Kalori cukup</strong> — Menyumbang ${Math.round(calPct)}% kebutuhan harian (${Math.round(t.cal)} kkal). Sesuai untuk satu kali makan.` });
  else items.push({ level: "bad", icon: "🔴", text: `<strong>Kalori tinggi</strong> — Menyumbang ${Math.round(calPct)}% kebutuhan harian (${Math.round(t.cal)} kkal). Perhatikan asupan makanan lain di hari ini.` });

  // Protein
  const proPct = (t.pro / DAILY_REF.protein) * 100;
  if (proPct < 10) items.push({ level: "warning", icon: "⚠️", text: `<strong>Protein rendah</strong> (${t.pro.toFixed(1)}g, ${Math.round(proPct)}% AKG). Tambahkan sumber protein seperti telur, daging, atau tempe.` });
  else if (proPct <= 40) items.push({ level: "good", icon: "✅", text: `<strong>Protein baik</strong> (${t.pro.toFixed(1)}g, ${Math.round(proPct)}% AKG). Asupan protein memadai untuk satu kali makan.` });
  else items.push({ level: "good", icon: "💪", text: `<strong>Protein tinggi</strong> (${t.pro.toFixed(1)}g, ${Math.round(proPct)}% AKG). Sangat baik untuk pembentukan otot.` });

  // Serat
  const fibPct = (t.fib / DAILY_REF.fiber) * 100;
  if (fibPct < 5) items.push({ level: "warning", icon: "⚠️", text: `<strong>Serat sangat rendah</strong> (${t.fib.toFixed(1)}g). Tambahkan sayur dan buah untuk memenuhi kebutuhan serat harian.` });
  else if (fibPct <= 30) items.push({ level: "good", icon: "✅", text: `<strong>Serat cukup</strong> (${t.fib.toFixed(1)}g, ${Math.round(fibPct)}% AKG).` });
  else items.push({ level: "good", icon: "🥦", text: `<strong>Serat tinggi</strong> (${t.fib.toFixed(1)}g, ${Math.round(fibPct)}% AKG). Sangat baik untuk pencernaan.` });

  // Lemak
  const fatPct = (t.fat / DAILY_REF.fat) * 100;
  if (fatPct > 40) items.push({ level: "bad", icon: "🔴", text: `<strong>Lemak tinggi</strong> (${t.fat.toFixed(1)}g, ${Math.round(fatPct)}% AKG). Pertimbangkan mengurangi makanan berlemak di sisa hari ini.` });

  $("adequacy-content").innerHTML = items
    .map((i) => `<div class="adequacy-item ${i.level}"><span class="adequacy-icon">${i.icon}</span><div class="adequacy-text">${i.text}</div></div>`)
    .join("");
}

function showAdditionalInfo(foods) {
  if (!foods.length) { $("additional-text").textContent = "Tidak ada makanan terdeteksi."; return; }
  const names = foods.map((f) => nutritionData[f]?.nama_pangan || f).join(", ");
  $("additional-text").textContent =
    `Makanan yang terdeteksi: ${names}. ` +
    `Estimasi nutrisi berdasarkan data TKPI 2017 (Tabel Komposisi Pangan Indonesia) per 100 gram bahan. ` +
    `Nilai aktual dapat bervariasi tergantung cara pengolahan, ukuran porsi, dan bahan tambahan. ` +
    `Gunakan informasi ini sebagai acuan, bukan sebagai pengganti konsultasi ahli gizi.`;
}

// ===== CAMERA / REALTIME =====
const video = $("video");
const cameraCanvas = $("camera-canvas");
const cameraPlaceholder = $("camera-placeholder");
let cameraRenderer = null;
let currentFacingMode = "environment"; // default to back camera

async function startCamera() {
  try {
    const attempts = [
      { video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: currentFacingMode } },
      { video: true },
    ];

    let stream = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch { continue; }
    }

    if (!stream) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      if (videoDevices.length > 0) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: videoDevices[0].deviceId } },
        });
      }
    }

    if (!stream) throw new Error("Tidak ada kamera yang ditemukan.");

    cameraStream = stream;
    video.srcObject = cameraStream;
    if (video.readyState < 1) {
      await new Promise((r) => { video.onloadedmetadata = r; });
    }
    await video.play();

    cameraCanvas.width = video.videoWidth;
    cameraCanvas.height = video.videoHeight;
    cameraRenderer = new Renderer(cameraCanvas);
    $("btn-start-cam").classList.add("hidden");
    $("camera-active-controls").classList.remove("hidden");
    $("camera-active-controls").style.display = "flex";

    // Use smaller input for the new 320x320 optimized model
    detector.setInputSize(320);
    isDetecting = true;
    detectLoop();
  } catch (e) {
    console.error("Camera error:", e);
    alert("Gagal mengakses kamera.\n\nPastikan:\n1. Kamera tidak dipakai aplikasi lain\n2. Izin kamera sudah diberikan\n3. Coba tutup tab/aplikasi lain yang pakai kamera\n\nDetail: " + e.message);
  }
}

function stopCamera() {
  isDetecting = false;
  if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }
  video.srcObject = null;
  if (cameraRenderer) cameraRenderer.clear();
  cameraPlaceholder.classList.remove("hidden");
  $("btn-start-cam").classList.remove("hidden");
  $("camera-active-controls").classList.add("hidden");
  $("camera-active-controls").style.display = "none";
  $("camera-fps").textContent = "0 FPS";
  $("live-results-list").innerHTML = '<div class="live-empty"><span>🔍</span><p>Arahkan kamera ke makanan</p></div>';
  $("live-nutrition").classList.add("hidden");
  $("live-count").textContent = "0 item";
  // Restore full size for upload mode
  detector.setInputSize(640);
}

async function detectLoop() {
  while (isDetecting) {
    const t0 = performance.now();
    try {
      const dets = await detector.detect(video, video.videoWidth, video.videoHeight);
      cameraRenderer.drawDetections(dets);
      updateLiveResults(dets);
    } catch (e) { console.error(e); }
    const elapsed = performance.now() - t0;
    $("camera-fps").textContent = Math.round(1000 / elapsed) + " FPS";
    // Yield to browser to keep UI responsive
    await new Promise((r) => setTimeout(r, 0));
  }
}

function updateLiveResults(dets) {
  const unique = new Map();
  for (const d of dets) {
    if (!unique.has(d.className) || unique.get(d.className).confidence < d.confidence)
      unique.set(d.className, d);
  }
  $("live-count").textContent = dets.length + " item";

  if (!dets.length) {
    $("live-results-list").innerHTML = '<div class="live-empty"><span>🔍</span><p>Arahkan kamera ke makanan</p></div>';
    $("live-nutrition").classList.add("hidden");
    return;
  }

  let html = "";
  for (const d of dets) {
    const n = nutritionData[d.className];
    const meta = n ? `${n.energi_kkal} kkal` : "";
    html += `<div class="live-item"><div class="live-item-color" style="background:${d.color}"></div><div class="live-item-info"><div class="live-item-name">${d.className}</div><div class="live-item-meta">${meta}</div></div><div class="live-item-conf">${(d.confidence * 100).toFixed(0)}%</div></div>`;
  }
  $("live-results-list").innerHTML = html;

  // Nutrition totals
  let t = { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 };
  for (const [name] of unique) {
    const n = nutritionData[name];
    if (n) { t.cal += n.energi_kkal; t.pro += n.protein_g; t.carb += n.karbohidrat_g; t.fat += n.lemak_g; t.fib += n.serat_g; }
  }
  $("ln-cal").textContent = Math.round(t.cal);
  $("ln-pro").textContent = t.pro.toFixed(1) + "g";
  $("ln-carb").textContent = t.carb.toFixed(1) + "g";
  $("ln-fat").textContent = t.fat.toFixed(1) + "g";
  $("ln-fib").textContent = t.fib.toFixed(1) + "g";
  $("live-nutrition").classList.remove("hidden");
}

$("btn-start-cam").addEventListener("click", startCamera);
$("btn-stop-cam").addEventListener("click", stopCamera);
$("btn-flip-cam").addEventListener("click", () => {
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  stopCamera();
  setTimeout(startCamera, 300); // Restart with new facingMode
});
$("conf-slider").addEventListener("input", (e) => {
  $("conf-val").textContent = e.target.value;
  if (detector) detector.setConfidence(parseInt(e.target.value) / 100);
});

// ===== START =====
init();
