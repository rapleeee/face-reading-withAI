import { createHash } from "crypto";
import { NextResponse } from "next/server";

const HF_MODEL_URL =
  "https://api-inference.huggingface.co/models/nateraw/vision-transformer-emotion-ferplus";
const TOGETHER_URL = "https://api.together.xyz/v1/chat/completions";
const TOGETHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free";

const EXPRESSION_LABELS: Record<string, string> = {
  neutral: "Wajah tampak netral dan tenang.",
  happiness: "Ekspresi bahagia mendominasi, menunjukkan energi positif dan terbuka.",
  surprise: "Ada unsur terkejut atau rasa kagum yang kuat.",
  sadness: "Ekspresi sedih terlihat, perlunya dukungan emosional.",
  anger: "Wajah menunjukkan ketegasan dan fokus tinggi, mungkin ada sedikit ketegangan.",
  disgust: "Ekspresi kurang nyaman atau ada hal yang membuat kurang sreg.",
  fear: "Ada sinyal kehati-hatian tinggi atau keraguan yang perlu ditenangkan.",
  contempt: "Ekspresi kritis, menggambarkan standar tinggi terhadap diri atau sekitar.",
};

const DEFAULT_EXPRESSION =
  "Ekspresi wajah dominan tidak terdeteksi dengan jelas. Coba ambil ulang foto dengan pencahayaan lebih terang dan wajah menghadap kamera.";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

const rateBuckets = new Map<string, number[]>();
const analysisCache = new Map<string, { timestamp: number; data: AnalysisPayload }>();

function checkRateLimit(key: string) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = rateBuckets.get(key) ?? [];
  const filtered = timestamps.filter((ts) => ts > windowStart);
  if (filtered.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, filtered);
    return true;
  }
  filtered.push(now);
  rateBuckets.set(key, filtered);
  return false;
}

type ExpressionInsight = {
  narrative: string;
  confidence: number;
  label: string;
};

type AiStructuredResult = {
  expressionSummary?: {
    headline?: string;
    energyTone?: string;
    personalityHighlight?: string;
    confidenceModifier?: number;
  };
  manifesting?: {
    pekerjaanKarir?: Array<ManifestingPoint>;
    masaDepan?: Array<ManifestingPoint>;
  };
  rekomendasiSekolah?: {
    tipe?: "SMK" | "SMA";
    alasan?: Array<ManifestingPoint>;
    langkahCepat?: string;
    kebiasaanPendukung?: string[];
  };
};

type ManifestingPoint = {
  title?: string;
  description?: string;
  indicator?: "strength" | "opportunity" | "warning";
};

const createPoint = (
  indicator: "strength" | "opportunity" | "warning",
  title: string,
  description: string,
): ManifestingPoint => ({ indicator, title, description });

type AnalysisPayload = {
  expression: {
    headline: string;
    energyTone: string;
    personalityHighlight: string;
    confidence: number;
    baseLabel: string;
    baseConfidence: number;
  };
  manifesting: {
    pekerjaanKarir: Array<{
      title: string;
      description: string;
      indicator: "strength" | "opportunity" | "warning";
    }>;
    masaDepan: Array<{
      title: string;
      description: string;
      indicator: "strength" | "opportunity" | "warning";
    }>;
  };
  rekomendasiSekolah: {
    tipe: "SMK" | "SMA";
    alasan: Array<{
      title: string;
      description: string;
      indicator: "strength" | "opportunity" | "warning";
    }>;
    langkahCepat: string;
    kebiasaanPendukung: string[];
  };
  meta: {
    source: "ai" | "fallback";
    cached?: boolean;
  };
};

export async function POST(req: Request) {
  const hfToken = process.env.NEXT_PUBLIC_HF_TOKEN ?? process.env.HF_TOKEN;
  const togetherToken = process.env.TOGETHER_API_KEY;

  if (!hfToken || !togetherToken) {
    return NextResponse.json(
      {
        message:
          "Konfigurasi API belum lengkap. Tambahkan NEXT_PUBLIC_HF_TOKEN dan TOGETHER_API_KEY pada environment.",
      },
      { status: 500 },
    );
  }

  try {
    const forwarded = req.headers.get("x-forwarded-for") ?? "";
    const clientKey = forwarded.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "anonymous";

    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { message: "Gambar tidak ditemukan di permintaan." },
        { status: 400 },
      );
    }

    const base64Data = image.split(",")[1];
    if (!base64Data) {
      return NextResponse.json(
        { message: "Format gambar tidak valid." },
        { status: 400 },
      );
    }

    if (checkRateLimit(clientKey)) {
      return NextResponse.json(
        {
          message:
            "Terlalu banyak analisis dalam waktu singkat. Coba lagi dalam beberapa detik.",
        },
        { status: 429 },
      );
    }

    const imageHash = createHash("sha256").update(base64Data).digest("hex");
    const now = Date.now();
    const cachedEntry = analysisCache.get(imageHash);
    if (cachedEntry && now - cachedEntry.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        ...cachedEntry.data,
        meta: { ...cachedEntry.data.meta, cached: true },
        generatedAt: new Date().toISOString(),
      });
    }

    const imageBuffer = Buffer.from(base64Data, "base64");

    const expression = await detectExpression(hfToken, imageBuffer);
    let aiResult: AiStructuredResult | null = null;
    let metaSource: "ai" | "fallback" = "ai";

    try {
      aiResult = await generateFaceReading(togetherToken, {
        expression,
        imageHint: base64Data.slice(0, 64),
      });
    } catch (err) {
      console.error("[face-reading] together fallback:", err);
      aiResult = buildFallbackAnalysis(expression);
      metaSource = "fallback";
    }

    const normalizePoints = (items?: Array<ManifestingPoint>) =>
      (items ?? [])
        .filter(
          (item): item is ManifestingPoint =>
            Boolean(item?.title) && Boolean(item?.description),
        )
        .map((item) => ({
          title: item.title!.trim(),
          description: item.description!.trim(),
          indicator: item.indicator ?? "opportunity",
        }));

    const manifestingKarir = normalizePoints(
      aiResult.manifesting?.pekerjaanKarir,
    );
    const manifestingMasaDepan = normalizePoints(
      aiResult.manifesting?.masaDepan,
    );

    const alasanSekolah = normalizePoints(aiResult.rekomendasiSekolah?.alasan);

    const confidenceModifier =
      aiResult.expressionSummary?.confidenceModifier ?? 0;
    const expressionConfidence = Number.isFinite(confidenceModifier)
      ? Math.max(0, Math.min(1, expression.confidence + confidenceModifier))
      : expression.confidence;

    const basePayload: AnalysisPayload = {
      expression: {
        headline:
          aiResult.expressionSummary?.headline ?? expression.narrative,
        energyTone:
          aiResult.expressionSummary?.energyTone ??
          "Energi netral, tetap jaga kestabilan emosi.",
        personalityHighlight:
          aiResult.expressionSummary?.personalityHighlight ??
          "Karakter terlihat seimbang dan responsif.",
        confidence: expressionConfidence,
        baseLabel: expression.label,
        baseConfidence: expression.confidence,
      },
      manifesting: {
        pekerjaanKarir: manifestingKarir,
        masaDepan: manifestingMasaDepan,
      },
      rekomendasiSekolah: {
        tipe: aiResult.rekomendasiSekolah?.tipe === "SMK" ? "SMK" : "SMA",
        alasan: alasanSekolah,
        langkahCepat:
          aiResult.rekomendasiSekolah?.langkahCepat ??
          "Tetapkan jadwal belajar mingguan dan eksplor kegiatan ekstrakurikuler untuk menguatkan potensi.",
        kebiasaanPendukung:
          aiResult.rekomendasiSekolah?.kebiasaanPendukung ?? [
            "Bangun rutinitas belajar terjadwal setiap pekan.",
            "Cari mentor atau komunitas yang mendukung minat utama.",
          ],
      },
      meta: {
        source: metaSource,
      },
    };

    analysisCache.set(imageHash, { timestamp: now, data: basePayload });

    return NextResponse.json({
      ...basePayload,
      meta: { ...basePayload.meta },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[face-reading] error:", error);
    const fallbackMessage =
      "Terjadi kesalahan saat menjalankan face reading. Coba lagi beberapa saat.";
    const message =
      error instanceof Error && error.message ? error.message : fallbackMessage;
    return NextResponse.json({ message }, { status: 500 });
  }
}

async function detectExpression(
  token: string,
  image: Buffer,
): Promise<ExpressionInsight> {
  const response = await fetch(HF_MODEL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: image as unknown as ArrayBuffer,
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[huggingface] error:", detail);
    return {
      narrative: DEFAULT_EXPRESSION,
      confidence: 0.35,
      label: "unknown",
    };
  }

  const data = (await response.json()) as Array<{
    label: string;
    score: number;
  }>;

  if (!Array.isArray(data) || data.length === 0) {
    return {
      narrative: DEFAULT_EXPRESSION,
      confidence: 0.35,
      label: "unknown",
    };
  }

  const top = data.sort((a, b) => b.score - a.score)[0];
  const refinedLabel = EXPRESSION_LABELS[top.label.toLowerCase()] ?? null;

  return {
    narrative:
      refinedLabel ??
      `Ekspresi dominan: ${top.label} dengan tingkat keyakinan ${(top.score * 100).toFixed(0)}%.`,
    confidence: Math.max(0, Math.min(1, top.score)),
    label: top.label,
  };
}

function buildFallbackAnalysis(
  expression: ExpressionInsight,
): AiStructuredResult {
  const label = expression.label.toLowerCase();

  const fallback: {
    energyTone: string;
    personality: string;
    schoolType: "SMK" | "SMA";
    karir: ManifestingPoint[];
    masaDepan: ManifestingPoint[];
    alasan: ManifestingPoint[];
    langkah: string;
    kebiasaan: string[];
    confidenceModifier: number;
  } = {
    energyTone:
      "Energi wajah terlihat stabil; gunakan untuk menjaga ritme belajar konsisten.",
    personality:
      "Karakter adaptif dan tangguh, tinggal menguatkan keberanian tampil.",
    schoolType: "SMA",
    karir: [
      createPoint(
        "strength",
        "Kekuatan fokus diri",
        "Ekspresi menandakan kemampuan menjaga perhatian sehingga mudah mengerjakan tugas berbasis analisis.",
      ),
      createPoint(
        "opportunity",
        "Latih komunikasi",
        "Coba rutin latihan presentasi singkat agar ide tersampaikan dengan percaya diri.",
      ),
    ],
    masaDepan: [
      createPoint(
        "opportunity",
        "Perluas jejaring pembelajaran",
        "Ikut komunitas belajar daring untuk bertukar wawasan dan menjaga motivasi.",
      ),
      createPoint(
        "warning",
        "Jaga keseimbangan emosi",
        "Sisihkan waktu istirahat terjadwal supaya pikiran tetap jernih saat mengambil keputusan besar.",
      ),
    ],
    alasan: [
      createPoint(
        "strength",
        "Fondasi akademik luas",
        "Jalur SMA membantu menguatkan dasar teori yang mendukung pilihan studi tinggi.",
      ),
      createPoint(
        "opportunity",
        "Eksplorasi organisasi",
        "Aktif di OSIS atau komunitas riset memberi ruang melatih kepemimpinan bertahap.",
      ),
    ],
    langkah:
      "Tentukan target nilai tiap semester lalu evaluasi progres setiap akhir pekan.",
    kebiasaan: [
      "Catat refleksi mood dan belajar selama 5 menit setiap malam.",
      "Ikuti diskusi kelompok minimal seminggu sekali untuk mengasah komunikasi.",
    ],
    confidenceModifier: -0.15,
  };

  switch (label) {
    case "happiness":
      fallback.energyTone =
        "Energi wajah ceria dan hangat, mudah membangun situasi kolaboratif.";
      fallback.personality =
        "Karakter supel serta ekspresif, cocok memimpin aktivitas kreatif.";
      fallback.schoolType = "SMK";
      fallback.karir = [
        createPoint(
          "strength",
          "Karisma tim",
          "Aura positif memudahkan mengambil peran koordinasi dalam proyek bersama.",
        ),
        createPoint(
          "opportunity",
          "Salurkan ide visual",
          "Eksplor kelas multimedia atau desain untuk menyalurkan imajinasi.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Bangun portofolio",
          "Kumpulkan hasil karya tiap bulan sebagai bukti konsistensi kreativitas.",
        ),
        createPoint(
          "warning",
          "Atur prioritas",
          "Gunakan to-do list harian agar energi tidak terpecah ke terlalu banyak aktivitas.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Praktik langsung",
          "SMK menyediakan studio dan praktik industri untuk menyalurkan kreativitasmu.",
        ),
        createPoint(
          "opportunity",
          "Relasi profesi",
          "Magang singkat membantu memahami realita kerja kreatif sejak dini.",
        ),
      ];
      fallback.langkah =
        "Susun portofolio mini berisi proyek sekolah atau karya mandiri dalam 3 bulan ke depan.";
      fallback.kebiasaan = [
        "Dokumentasikan progres proyek mingguan dalam bentuk foto atau video pendek.",
        "Ikut komunitas kreatif daring untuk bertukar ide dan feedback.",
      ];
      break;
    case "anger":
      fallback.energyTone =
        "Energi tegas menonjol, cocok untuk peran yang membutuhkan keberanian keputusan.";
      fallback.personality =
        "Karakter kompetitif dan berorientasi hasil, butuh kanal produktif agar energi tersalurkan.";
      fallback.schoolType = "SMK";
      fallback.karir = [
        createPoint(
          "strength",
          "Kecepatan respon",
          "Ketegasanmu membantu menyelesaikan tugas operasional di bawah tekanan.",
        ),
        createPoint(
          "warning",
          "Kelola emosi",
          "Latih teknik napas atau olahraga ringan sebelum mengambil keputusan penting.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Peran kepemimpinan",
          "Ambil posisi koordinator proyek untuk menyalurkan insting memimpin.",
        ),
        createPoint(
          "warning",
          "Bangun empati",
          "Sisihkan waktu mendengar masukan tim agar keputusan lebih diterima.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Skill teknis cepat",
          "SMK memberi banyak praktik sehingga energi kompetitifmu tersalurkan.",
        ),
        createPoint(
          "opportunity",
          "Koneksi industri",
          "Kegiatan prakerin membuka peluang mengenal kultur kerja sebenarnya.",
        ),
      ];
      fallback.langkah =
        "Terapkan metode GTD (Getting Things Done) sederhana untuk menjaga fokus prioritas.";
      fallback.kebiasaan = [
        "Mulai hari dengan 5 menit pernapasan atau peregangan.",
        "Catat pemicu emosi dan siapkan respon alternatif yang lebih tenang.",
      ];
      break;
    case "sadness":
      fallback.energyTone =
        "Energi terlihat lembut dan empatik, mudah menangkap perasaan orang lain.";
      fallback.personality =
        "Karakter peduli, cocok pada peran pelayanan atau pendampingan.";
      fallback.schoolType = "SMA";
      fallback.karir = [
        createPoint(
          "strength",
          "Empati tinggi",
          "Kepekaan emosimu memberi nilai tambah pada bidang sosial atau pendidikan.",
        ),
        createPoint(
          "opportunity",
          "Bangun daya juang",
          "Perkuat ketahanan mental melalui journaling dan dukungan komunitas.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Peran konselor",
          "Pertimbangkan jalur psikologi, keperawatan, atau bimbingan belajar.",
        ),
        createPoint(
          "warning",
          "Self-care rutin",
          "Tetapkan ritual self-care tiap pekan agar empati tidak membuatmu kelelahan.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Pendalaman teori",
          "SMA memberi ruang mengeksplor ilmu sosial dan humaniora lebih luas.",
        ),
        createPoint(
          "opportunity",
          "Aktivitas relawan",
          "Ikut kegiatan sosial sekolah untuk menyalurkan rasa peduli.",
        ),
      ];
      fallback.langkah =
        "Buat daftar dukungan (teman/guru) yang bisa dihubungi saat membutuhkan semangat.";
      fallback.kebiasaan = [
        "Tuliskan tiga hal yang kamu syukuri setiap malam.",
        "Latihan mindfulness 5 menit setelah bangun tidur.",
      ];
      break;
    case "fear":
      fallback.energyTone =
        "Ekspresi berhati-hati menunjukkan kebutuhan akan rasa aman sebelum melangkah.";
      fallback.personality =
        "Karakter analitis namun membutuhkan dorongan kepercayaan diri.";
      fallback.schoolType = "SMA";
      fallback.karir = [
        createPoint(
          "strength",
          "Detil dan teliti",
          "Kehati-hatianmu cocok di bidang riset, akuntansi, atau kontrol kualitas.",
        ),
        createPoint(
          "opportunity",
          "Bangun keberanian",
          "Mulai ambil proyek kecil bertahap untuk melatih percaya diri.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Perencanaan matang",
          "Profesi analis data atau perencana keuangan selaras dengan gaya berpikir sistematismu.",
        ),
        createPoint(
          "warning",
          "Atasi overthinking",
          "Gunakan teknik 5-4-3-2-1 atau journaling untuk meredam kekhawatiran.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Tahap eksploratif",
          "SMA memberi waktu mengenali minat tanpa tekanan spesialisasi dini.",
        ),
        createPoint(
          "opportunity",
          "Pembinaan akademik",
          "Bisa mengikuti bimbingan belajar terstruktur untuk menguatkan rasa percaya diri.",
        ),
      ];
      fallback.langkah =
        "Susun rencana mingguan berisi tiga prioritas utama agar fokus mudah dijaga.";
      fallback.kebiasaan = [
        "Gunakan daftar afirmasi positif setiap pagi.",
        "Cek-in emosi di tengah hari dengan skala 1-5 lalu sesuaikan aktivitas.",
      ];
      break;
    case "surprise":
      fallback.energyTone =
        "Energi penuh rasa ingin tahu, cepat menangkap informasi baru.";
      fallback.personality =
        "Karakter eksploratif dan adaptif, senang mencoba hal berbeda.";
      fallback.schoolType = "SMK";
      fallback.karir = [
        createPoint(
          "strength",
          "Respons cepat",
          "Kamu sigap mengatasi perubahan, cocok di bidang teknologi atau event.",
        ),
        createPoint(
          "opportunity",
          "Struktur belajar",
          "Susun kerangka belajar agar rasa penasaran tetap terarah.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Inovasi berkelanjutan",
          "Bidang startup atau riset terapan memberi ruang eksplorasi tanpa batas.",
        ),
        createPoint(
          "warning",
          "Hindari loncat-loncat",
          "Tentukan satu fokus utama tiap semester agar hasil terasa nyata.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Belajar berbasis proyek",
          "SMK memberi pengalaman langsung sehingga rasa ingin tahumu tersalurkan.",
        ),
        createPoint(
          "opportunity",
          "Jejaring industri",
          "Bisa membangun koneksi profesional sejak dini lewat praktik kerja lapangan.",
        ),
      ];
      fallback.langkah =
        "Ambil satu proyek ekstrakurikuler dan jadikan studi kasus portofolio.";
      fallback.kebiasaan = [
        "Gunakan papan ide untuk menampung inspirasi sebelum diekseksi.",
        "Review pembelajaran tiap Jumat untuk memilih ide teratas minggu berikutnya.",
      ];
      break;
    case "disgust":
      fallback.energyTone =
        "Ekspresi menunjukkan standar tinggi dan keinginan menjaga kualitas.";
      fallback.personality =
        "Karakter perfeksionis, teliti terhadap detail dan lingkungan.";
      fallback.schoolType = "SMK";
      fallback.karir = [
        createPoint(
          "strength",
          "Kontrol kualitas",
          "Kepekaanmu terhadap detail cocok di bidang kuliner, kecantikan, atau produksi.",
        ),
        createPoint(
          "opportunity",
          "Kelola ekspektasi",
          "Belajar membagi standar: mana yang wajib tinggi dan mana yang bisa fleksibel.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Spesialis kualitas",
          "Pertimbangkan profesi QC, UX, atau desain interior yang menuntut cita rasa.",
        ),
        createPoint(
          "warning",
          "Hindari overkritik",
          "Gunakan sudut pandang apresiasi sebelum memberi evaluasi pada orang lain.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Workshop intensif",
          "SMK menyediakan ruang praktik detail untuk menyalurkan standar mutu.",
        ),
        createPoint(
          "opportunity",
          "Mentor profesional",
          "Bisa belajar langsung dari praktisi sehingga standar tinggi terjaga.",
        ),
      ];
      fallback.langkah =
        "Buat checklist mutu pribadi sebelum memulai dan selesai mengerjakan proyek.";
      fallback.kebiasaan = [
        "Latihan sensory check selama 10 menit tiap hari.",
        "Berikan apresiasi diri atas progres kecil untuk menjaga motivasi.",
      ];
      break;
    case "contempt":
      fallback.energyTone =
        "Ekspresi kritis menandakan intuisi tajam dalam menilai kondisi.";
      fallback.personality =
        "Karakter analitis dan tegas, cocok menjadi penasehat atau strategi.";
      fallback.schoolType = "SMA";
      fallback.karir = [
        createPoint(
          "strength",
          "Analisis tajam",
          "Kemampuan menilai cepat membantu di bidang hukum, debat, atau riset kebijakan.",
        ),
        createPoint(
          "warning",
          "Bangun empati komunikatif",
          "Sertakan langkah solutif saat menyampaikan kritik agar penerimaan lebih baik.",
        ),
      ];
      fallback.masaDepan = [
        createPoint(
          "opportunity",
          "Peran strategi",
          "Pertimbangkan profesi konsultan, analis bisnis, atau content strategist.",
        ),
        createPoint(
          "warning",
          "Jaga fleksibilitas",
          "Latih melihat sisi positif agar tidak terjebak pada penilaian yang terlalu keras.",
        ),
      ];
      fallback.alasan = [
        createPoint(
          "strength",
          "Basis teori luas",
          "SMA memberi bekal logika dan literasi untuk mendukung kemampuan kritismu.",
        ),
        createPoint(
          "opportunity",
          "Forum debat",
          "Aktif di klub debat melatih penyampaian kritik secara elegan.",
        ),
      ];
      fallback.langkah =
        "Setiap memberi evaluasi, sertakan minimal dua apresiasi dan satu alternatif solusi.";
      fallback.kebiasaan = [
        "Latihan menulis opini dengan format sandwich feedback.",
        "Ikuti konten atau buku tentang empati dan komunikasi asertif.",
      ];
      break;
    default:
      break;
  }

  return {
    expressionSummary: {
      headline: expression.narrative,
      energyTone: fallback.energyTone,
      personalityHighlight: fallback.personality,
      confidenceModifier: fallback.confidenceModifier,
    },
    manifesting: {
      pekerjaanKarir: fallback.karir,
      masaDepan: fallback.masaDepan,
    },
    rekomendasiSekolah: {
      tipe: fallback.schoolType,
      alasan: fallback.alasan,
      langkahCepat: fallback.langkah,
      kebiasaanPendukung: fallback.kebiasaan,
    },
  };
}

async function generateFaceReading(
  token: string,
  input: { expression: ExpressionInsight; imageHint: string },
) {
  const systemPrompt = [
    "Kamu adalah peramal wajah modern yang komunikatif, fokus pada pengembangan diri.",
    "Gunakan bahasa Indonesia, tone positif, dan hindari klaim medis.",
    "Balas hanya dalam format JSON dengan struktur:",
    "{",
    '  "expressionSummary": {',
    '     "headline": "string singkat",',
    '     "energyTone": "1 kalimat",',
    '     "personalityHighlight": "1 kalimat",',
    '     "confidenceModifier": 0.0',
    "  },",
    '  "manifesting": {',
    '     "pekerjaanKarir": [',
    '        {"title": "string", "description": "maks 2 kalimat", "indicator": "strength|opportunity|warning"}',
    "     ],",
    '     "masaDepan": [',
    '        {"title": "string", "description": "maks 2 kalimat", "indicator": "strength|opportunity|warning"}',
    "     ]",
    "  },",
    '  "rekomendasiSekolah": {',
    '     "tipe": "SMK atau SMA",',
    '     "alasan": [',
    '        {"title": "string", "description": "maks 2 kalimat", "indicator": "strength|opportunity|warning"}',
    "     ],",
    '     "langkahCepat": "1 kalimat praktis",',
    '     "kebiasaanPendukung": ["bullet singkat", "..."]',
    "  }",
    "}",
    "Pastikan setiap indikator selaras dengan tone positif, hindari klaim medis.",
  ].join(" ");

  const userPrompt = [
    "Analisis wajah berikut untuk membuat hasil face reading:",
    `- Ekspresi utama: ${input.expression.narrative}.`,
    `- Label model: ${input.expression.label} dengan confidence ${(input.expression.confidence * 100).toFixed(1)}%.`,
    `- Hash singkat gambar (untuk referensi saja): ${input.imageHint}.`,
    "- Gunakan ekspresi sebagai dasar untuk menyusun manifesting karier dan masa depan.",
    "- Pertimbangkan gambaran umum face reading modern (potensi, karakter, peluang).",
    "- Pilih rekomendasi sekolah SMK atau SMA sesuai narasi manifesting.",
    "- Langkah cepat harus aplikatif untuk pelajar (misal: fokus jurusan, kegiatan, kebiasaan belajar).",
    "Jika informasi ekspresi kurang jelas, buat analisis umum yang tetap relevan dan positif.",
  ].join("\n");

  const response = await fetch(TOGETHER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TOGETHER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 700,
      temperature: 0.7,
      top_p: 0.9,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Together API error (${response.status})`;
    try {
      const detailText = await response.text();
      try {
        const parsed = JSON.parse(detailText) as {
          error?: { message?: string };
          message?: string;
        };
        errorMessage = parsed?.error?.message ?? parsed?.message ?? errorMessage;
      } catch {
        if (detailText) {
          errorMessage = `${errorMessage}: ${detailText.slice(0, 180)}`;
        }
      }
    } catch (fetchErr) {
      console.error("[together] read error:", fetchErr);
    }
    throw new Error(errorMessage);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload?.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error("Model tidak mengembalikan hasil.");
  }

  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as AiStructuredResult;
    return parsed;
  } catch (error) {
    console.error("[together] parse error:", error, cleaned);
    throw new Error("Gagal memahami hasil AI. Coba ulangi analisis.");
  }
}
