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

const MAJOR_LABELS = {
  RPL: "Rekayasa Perangkat Lunak",
  DKV: "Desain Komunikasi Visual",
  TKJ: "Teknik Komputer dan Jaringan",
} as const;
type MajorCode = keyof typeof MAJOR_LABELS;
const MAJOR_CODES = Object.keys(MAJOR_LABELS) as Array<MajorCode>;
const DEFAULT_MAJOR_NOTES: Record<MajorCode, string> = {
  RPL: "Cocok untuk pemikir analitis yang senang membangun solusi digital.",
  DKV: "Selaras bagi yang ekspresif dan ingin menyalurkan kreativitas visual.",
  TKJ: "Pas untuk pribadi teknis yang suka merakit dan menjaga sistem teknologi.",
};

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
  rekomendasiJurusan?: {
    utama?: {
      kode?: string;
      nama?: string;
      alasan?: Array<ManifestingPoint>;
      langkahFokus?: string;
      kebiasaanPendukung?: string[];
    };
    alternatif?: Array<{
      kode?: string;
      nama?: string;
      catatan?: string;
    }>;
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

const DEFAULT_MAJOR_POINTS: Record<MajorCode, ManifestingPoint[]> = {
  RPL: [
    createPoint(
      "strength",
      "Logika terstruktur",
      "Mood yang stabil menandakan kemampuan menganalisis pola dan membangun solusi bertahap.",
    ),
    createPoint(
      "opportunity",
      "Eksperimen digital",
      "Gunakan rasa ingin tahu untuk mencoba membuat aplikasi atau automasi sederhana.",
    ),
  ],
  DKV: [
    createPoint(
      "strength",
      "Ekspresi kreatif",
      "Energi ekspresif cocok diterjemahkan menjadi karya visual dan storytelling kuat.",
    ),
    createPoint(
      "opportunity",
      "Sensitivitas estetika",
      "Asah kepekaan warna dan komposisi lewat latihan visual harian.",
    ),
  ],
  TKJ: [
    createPoint(
      "strength",
      "Ketekunan teknis",
      "Mood fokus menunjukkan ketelitian tinggi saat memecahkan masalah perangkat.",
    ),
    createPoint(
      "opportunity",
      "Problem solving nyata",
      "Gunakan rasa penasaran untuk membongkar dan memahami cara kerja jaringan.",
    ),
  ],
};

const DEFAULT_MAJOR_FOCUS: Record<
  MajorCode,
  { langkah: string; kebiasaan: string[] }
> = {
  RPL: {
    langkah:
      "Luangkan 30 menit per hari untuk latihan logika atau coding dasar di platform gratis.",
    kebiasaan: [
      "Catat ide masalah yang ingin kamu pecahkan lalu coba terjemahkan ke konsep aplikasi.",
      "Ikut komunitas pemrograman pemula seminggu sekali untuk review kode sederhana.",
    ],
  },
  DKV: {
    langkah:
      "Buat moodboard mingguan dari referensi visual untuk melatih rasa estetika.",
    kebiasaan: [
      "Lakukan sketsa cepat 10 menit setiap hari dengan tema berbeda.",
      "Unggah karya ke media sosial atau forum desain untuk meminta umpan balik.",
    ],
  },
  TKJ: {
    langkah:
      "Kerjakan proyek mini jaringan atau perakitan perangkat setiap pekan dan dokumentasikan prosesnya.",
    kebiasaan: [
      "Tulis checklist troubleshooting setiap kali menemukan masalah teknis.",
      "Ikut kanal komunitas teknologi untuk berdiskusi minimal dua kali seminggu.",
    ],
  },
};

type FallbackTemplate = {
  energyTone: string;
  personality: string;
  major: MajorCode;
  karir: ManifestingPoint[];
  masaDepan: ManifestingPoint[];
  alasan?: ManifestingPoint[];
  langkah?: string;
  kebiasaan?: string[];
  alternatifNotes?: Partial<Record<MajorCode, string>>;
  confidenceModifier?: number;
};

const FALLBACK_TEMPLATES: Record<string, FallbackTemplate> = {
  default: {
    energyTone:
      "Energi wajah terlihat stabil; gunakan untuk menjaga ritme belajar konsisten.",
    personality:
      "Karakter adaptif dan tangguh, tinggal menguatkan keberanian tampil.",
    major: "RPL",
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
        "Fondasi logika kuat",
        "Jurusan RPL membiasakan pemikiran terstruktur saat membangun aplikasi atau solusi digital.",
      ),
      createPoint(
        "opportunity",
        "Eksplorasi proyek",
        "Lingkungan RPL memberi ruang mencoba banyak proyek supaya potensimu terbukti nyata.",
      ),
    ],
    confidenceModifier: -0.15,
    alternatifNotes: {
      DKV: "Jika ingin menonjolkan sisi visual dan storytelling, DKV bisa jadi ruang mengekspresikan emosi.",
      TKJ: "Bila senang membongkar hardware dan jaringan, TKJ menawarkan tantangan teknis langsung.",
    },
  },
  neutral: {
    energyTone:
      "Ekspresi netral menggambarkan kestabilan dan kesiapan menerima pelajaran baru.",
    personality:
      "Karakter fleksibel, mudah menyesuaikan dengan berbagai situasi belajar.",
    major: "RPL",
    karir: [
      createPoint(
        "strength",
        "Analisis konsisten",
        "Ketelitianmu membantu merancang alur kerja aplikasi tanpa mudah terdistraksi.",
      ),
      createPoint(
        "opportunity",
        "Kolaborasi digital",
        "Libatkan teman untuk membuat proyek sederhana agar kemampuan tim semakin matang.",
      ),
    ],
    masaDepan: [
      createPoint(
        "opportunity",
        "Spesialis solusi",
        "Bidang pengembangan produk digital memberi banyak jalur peningkatan karier.",
      ),
      createPoint(
        "warning",
        "Jaga gairah belajar",
        "Konsisten cari tantangan baru agar tidak terjebak rutinitas yang monoton.",
      ),
    ],
    alternatifNotes: {
      DKV: "Jika ingin atmosfer lebih ekspresif, DKV menawarkan eksplorasi visual yang menyenangkan.",
      TKJ: "TKJ cocok bila kamu ingin memahami seluk-beluk infrastruktur teknologi secara langsung.",
    },
  },
  happiness: {
    energyTone:
      "Energi wajah ceria dan hangat, mudah membangun situasi kolaboratif.",
    personality:
      "Karakter supel serta ekspresif, cocok memimpin aktivitas kreatif.",
    major: "DKV",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Studio kreatif lengkap",
        "Jurusan DKV menyediakan fasilitas desain dan mentor kreatif untuk menyalurkan imajinasi.",
      ),
      createPoint(
        "opportunity",
        "Portofolio kuat",
        "Tiap proyek desain bisa dijadikan portofolio untuk menembus industri kreatif sejak dini.",
      ),
    ],
    langkah:
      "Susun portofolio mini berisi proyek sekolah atau karya mandiri dalam 3 bulan ke depan.",
    kebiasaan: [
      "Dokumentasikan progres proyek mingguan dalam bentuk foto atau video pendek.",
      "Ikut komunitas kreatif daring untuk bertukar ide dan feedback.",
    ],
    alternatifNotes: {
      RPL: "Jika ingin menyalurkan ide ke aplikasi interaktif, RPL bisa jadi kombinasi yang seru.",
      TKJ: "Energi positifmu juga bisa menghidupkan tim teknis di jurusan TKJ.",
    },
  },
  anger: {
    energyTone:
      "Energi tegas menonjol, cocok untuk peran yang membutuhkan keberanian keputusan.",
    personality:
      "Karakter kompetitif dan berorientasi hasil, butuh kanal produktif agar energi tersalurkan.",
    major: "TKJ",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Tantangan teknis nyata",
        "TKJ memberi banyak praktik lapangan untuk menyalurkan energi kompetitifmu.",
      ),
      createPoint(
        "opportunity",
        "Simulasi industri",
        "Kegiatan prakerin menyiapkan mental menghadapi tekanan kerja sebenarnya.",
      ),
    ],
    langkah:
      "Terapkan metode GTD (Getting Things Done) sederhana untuk menjaga fokus prioritas.",
    kebiasaan: [
      "Mulai hari dengan 5 menit pernapasan atau peregangan.",
      "Catat pemicu emosi dan siapkan respon alternatif yang lebih tenang.",
    ],
    alternatifNotes: {
      RPL: "Jika ingin menyalurkan ketegasan lewat problem solving digital, RPL bisa dicoba.",
      DKV: "Energi besar juga dapat diarahkan membuat konten berpengaruh di DKV.",
    },
  },
  sadness: {
    energyTone:
      "Energi terlihat lembut dan empatik, mudah menangkap perasaan orang lain.",
    personality:
      "Karakter peduli, cocok pada peran pelayanan atau pendampingan.",
    major: "RPL",
    karir: [
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
    ],
    masaDepan: [
      createPoint(
        "opportunity",
        "Solusi berdampak",
        "Menciptakan aplikasi bantu belajar atau kesehatan mental bisa jadi fokus menarik.",
      ),
      createPoint(
        "warning",
        "Jaga semangat",
        "Tetapkan penghargaan diri setiap kali menyelesaikan modul atau proyek.",
      ),
    ],
    alasan: [
      createPoint(
        "strength",
        "Kolaborasi empatik",
        "Proyek RPL menuntut kerja tim sehingga empati kamu menjadi keunggulan.",
      ),
      createPoint(
        "opportunity",
        "Transformasi ide jadi solusi",
        "Mood sensitif mempermudahmu merancang fitur yang benar-benar membantu pengguna.",
      ),
    ],
    kebiasaan: [
      "Refleksikan emosi dan ide solusi dalam jurnal setiap malam.",
      "Libatkan teman untuk pair programming ringan seminggu sekali.",
    ],
    alternatifNotes: {
      DKV: "Jika ingin menyalurkan emosi lewat visual, DKV bisa menjadi ruang berekspresi.",
      TKJ: "TKJ cocok bila kamu ingin fokus ke sistem yang menjamin kenyamanan banyak orang.",
    },
  },
  surprise: {
    energyTone:
      "Ekspresi penuh rasa ingin tahu, cepat menangkap informasi baru.",
    personality:
      "Karakter eksploratif dan adaptif, senang mencoba hal berbeda.",
    major: "RPL",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Eksperimen terencana",
        "RPL memungkinkanmu menguji ide inovatif melalui prototipe digital.",
      ),
      createPoint(
        "opportunity",
        "Jalur portofolio",
        "Setiap aplikasi kecil bisa dijadikan studi kasus untuk menonjolkan rasa ingin tahu.",
      ),
    ],
    langkah:
      "Ambil satu proyek ekstrakurikuler dan jadikan studi kasus portofolio.",
    kebiasaan: [
      "Gunakan papan ide untuk menampung inspirasi sebelum dieksekusi.",
      "Review pembelajaran tiap Jumat untuk memilih ide teratas minggu berikutnya.",
    ],
    alternatifNotes: {
      DKV: "Jika imajinasi visualmu menguat, DKV memberi ruang eksplorasi konsep unik.",
      TKJ: "TKJ cocok bila kamu ingin mendalami perangkat yang mendukung ide-ide besar.",
    },
  },
  disgust: {
    energyTone:
      "Ekspresi menunjukkan standar tinggi dan keinginan menjaga kualitas.",
    personality:
      "Karakter perfeksionis, teliti terhadap detail dan lingkungan.",
    major: "TKJ",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Kerapian sistem",
        "TKJ membiasakan standar check list dan dokumentasi sehingga perfeksimu tersalurkan.",
      ),
      createPoint(
        "opportunity",
        "Praktik bertahap",
        "Setiap proyek jaringan melatihmu menilai kualitas konfigurasi secara rinci.",
      ),
    ],
    langkah:
      "Buat checklist mutu pribadi sebelum memulai dan selesai mengerjakan proyek.",
    kebiasaan: [
      "Latihan sensory check selama 10 menit tiap hari.",
      "Berikan apresiasi diri atas progres kecil untuk menjaga motivasi.",
    ],
    alternatifNotes: {
      RPL: "Jika ingin mengontrol kualitas software, RPL memberi ruang testing dan QA.",
      DKV: "Ketekunan detailmu juga bermanfaat menciptakan karya visual yang presisi di DKV.",
    },
  },
  fear: {
    energyTone:
      "Ekspresi berhati-hati menunjukkan kebutuhan akan rasa aman sebelum melangkah.",
    personality:
      "Karakter analitis namun membutuhkan dorongan kepercayaan diri.",
    major: "TKJ",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Sistem yang aman",
        "TKJ mengajarkan cara menjaga jaringan tetap stabil sehingga selaras dengan kebutuhanmu akan rasa aman.",
      ),
      createPoint(
        "opportunity",
        "Proyek bertahap",
        "Pembelajaran praktikum memungkinkanmu menaikkan percaya diri setahap demi setahap.",
      ),
    ],
    langkah:
      "Susun rencana mingguan berisi tiga prioritas utama agar fokus mudah dijaga.",
    kebiasaan: [
      "Gunakan daftar afirmasi positif setiap pagi.",
      "Cek-in emosi di tengah hari dengan skala 1-5 lalu sesuaikan aktivitas.",
    ],
    alternatifNotes: {
      RPL: "Jika ingin belajar membangun solusi yang membantu orang banyak, RPL memberimu pijakan aman.",
      DKV: "Menyalurkan rasa hati-hati lewat karya visual di DKV bisa menjadi terapi kreatif.",
    },
  },
  contempt: {
    energyTone:
      "Ekspresi kritis menandakan intuisi tajam dalam menilai kondisi.",
    personality:
      "Karakter analitis dan tegas, cocok menjadi penasehat atau strategi.",
    major: "RPL",
    karir: [
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
    ],
    masaDepan: [
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
    ],
    alasan: [
      createPoint(
        "strength",
        "Logika tajam",
        "RPL memfasilitasi pola pikir kritis lewat debugging dan analisis sistem.",
      ),
      createPoint(
        "opportunity",
        "Solusi aplikatif",
        "Setiap kritik bisa diterjemahkan menjadi fitur baru pada aplikasi yang kamu bangun.",
      ),
    ],
    langkah:
      "Setiap memberi evaluasi, sertakan minimal dua apresiasi dan satu alternatif solusi.",
    kebiasaan: [
      "Latihan menulis opini dengan format sandwich feedback.",
      "Ikuti konten atau buku tentang empati dan komunikasi asertif.",
    ],
    alternatifNotes: {
      DKV: "Jika ingin mengasah kritik visual, DKV memberimu ruang menilai estetika.",
      TKJ: "TKJ cocok bila kamu ingin memastikan standar teknis dan keamanan tertata rapi.",
    },
  },
};

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
  rekomendasiJurusan: {
    utama: {
      kode: string;
      nama: string;
      alasan: Array<{
        title: string;
        description: string;
        indicator: "strength" | "opportunity" | "warning";
      }>;
      langkahFokus: string;
      kebiasaanPendukung: string[];
    };
    alternatif: Array<{
      kode: string;
      nama: string;
      catatan: string;
    }>;
  };
  meta: {
    source: "ai" | "fallback";
    cached?: boolean;
  };
};

const isMajorCode = (value: string): value is MajorCode =>
  Object.prototype.hasOwnProperty.call(MAJOR_LABELS, value);

const normalizeMajorCode = (value?: string): MajorCode => {
  const upper = (value ?? "").toUpperCase().trim();
  return isMajorCode(upper) ? (upper as MajorCode) : "RPL";
};

const resolveMajorName = (code?: string, providedName?: string): string => {
  const majorCode = normalizeMajorCode(code);
  if (providedName && providedName.trim()) {
    return providedName.trim();
  }
  return MAJOR_LABELS[majorCode];
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

    const sanitizeStringArray = (items?: Array<string>) =>
      (items ?? [])
        .map((entry) => entry?.trim())
        .filter((entry): entry is string => Boolean(entry));

    const manifestingKarir = normalizePoints(
      aiResult.manifesting?.pekerjaanKarir,
    );
    const manifestingMasaDepan = normalizePoints(
      aiResult.manifesting?.masaDepan,
    );

    const jurusanUtamaRaw = aiResult.rekomendasiJurusan?.utama ?? {};
    const utamaKode = normalizeMajorCode(jurusanUtamaRaw.kode);
    const utamaNama = resolveMajorName(jurusanUtamaRaw.kode, jurusanUtamaRaw.nama);

    let alasanJurusan = normalizePoints(jurusanUtamaRaw.alasan);
    if (alasanJurusan.length === 0) {
      alasanJurusan = normalizePoints(DEFAULT_MAJOR_POINTS[utamaKode]);
    }

    const langkahFokus =
      jurusanUtamaRaw.langkahFokus?.trim() ??
      DEFAULT_MAJOR_FOCUS[utamaKode].langkah;

    let kebiasaanPendukung = sanitizeStringArray(
      jurusanUtamaRaw.kebiasaanPendukung,
    );
    if (kebiasaanPendukung.length === 0) {
      kebiasaanPendukung = [...DEFAULT_MAJOR_FOCUS[utamaKode].kebiasaan];
    }

    const alternatifDariAi = (aiResult.rekomendasiJurusan?.alternatif ?? [])
      .map((item) => {
        const catatan = item?.catatan?.trim();
        if (!catatan) {
          return null;
        }
        const code = normalizeMajorCode(item?.kode);
        return {
          kode: code,
          nama: resolveMajorName(item?.kode, item?.nama),
          catatan,
        };
      })
      .filter(
        (
          item,
        ): item is {
          kode: MajorCode;
          nama: string;
          catatan: string;
        } => Boolean(item),
      );

    const alternatif: Array<{
      kode: string;
      nama: string;
      catatan: string;
    }> = [];
    const seenCodes = new Set<MajorCode>([utamaKode]);

    for (const alt of alternatifDariAi) {
      if (seenCodes.has(alt.kode)) continue;
      alternatif.push({
        kode: alt.kode,
        nama: alt.nama,
        catatan: alt.catatan,
      });
      seenCodes.add(alt.kode);
    }

    for (const code of MAJOR_CODES) {
      if (seenCodes.has(code)) continue;
      alternatif.push({
        kode: code,
        nama: MAJOR_LABELS[code],
        catatan: DEFAULT_MAJOR_NOTES[code],
      });
      seenCodes.add(code);
    }

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
      rekomendasiJurusan: {
        utama: {
          kode: utamaKode,
          nama: utamaNama,
          alasan: alasanJurusan,
          langkahFokus,
          kebiasaanPendukung,
        },
        alternatif,
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
  const template = FALLBACK_TEMPLATES[label] ?? FALLBACK_TEMPLATES.default;
  const major = template.major ?? "RPL";

  const alternatifNotes = new Map<MajorCode, string>();
  if (template.alternatifNotes) {
    for (const [code, note] of Object.entries(template.alternatifNotes)) {
      const normalized = normalizeMajorCode(code);
      if (note) {
        alternatifNotes.set(normalized, note);
      }
    }
  }

  for (const code of MAJOR_CODES) {
    if (code === major) continue;
    if (!alternatifNotes.has(code)) {
      alternatifNotes.set(code, DEFAULT_MAJOR_NOTES[code]);
    }
  }

  const langkah =
    template.langkah?.trim() ?? DEFAULT_MAJOR_FOCUS[major].langkah;
  const kebiasaan =
    template.kebiasaan && template.kebiasaan.length > 0
      ? template.kebiasaan.map((entry) => entry.trim()).filter(Boolean)
      : [...DEFAULT_MAJOR_FOCUS[major].kebiasaan];

  const alasan =
    template.alasan && template.alasan.length > 0
      ? template.alasan
      : DEFAULT_MAJOR_POINTS[major];

  const alternatif = Array.from(alternatifNotes.entries()).map(
    ([code, note]) => ({
      kode: code,
      nama: MAJOR_LABELS[code],
      catatan: note,
    }),
  );

  return {
    expressionSummary: {
      headline: expression.narrative,
      energyTone: template.energyTone,
      personalityHighlight: template.personality,
      confidenceModifier: template.confidenceModifier ?? -0.1,
    },
    manifesting: {
      pekerjaanKarir: template.karir,
      masaDepan: template.masaDepan,
    },
    rekomendasiJurusan: {
      utama: {
        kode: major,
        nama: MAJOR_LABELS[major],
        alasan,
        langkahFokus: langkah,
        kebiasaanPendukung: kebiasaan,
      },
      alternatif,
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
    '  "rekomendasiJurusan": {',
    '     "utama": {',
    '        "kode": "RPL atau DKV atau TKJ",',
    '        "nama": "string",',
    '        "alasan": [',
    '           {"title": "string", "description": "maks 2 kalimat", "indicator": "strength|opportunity|warning"}',
    "        ],",
    '        "langkahFokus": "1 kalimat praktis",',
    '        "kebiasaanPendukung": ["bullet singkat", "..."]',
    "     },",
    '     "alternatif": [',
    '        {"kode": "RPL|DKV|TKJ", "nama": "string", "catatan": "1 kalimat"}',
    "     ]",
    "  }",
    "}",
    "Pastikan setiap indikator selaras dengan tone positif, hindari klaim medis.",
    "Batasi kode jurusan hanya pada RPL, DKV, atau TKJ.",
  ].join(" ");

  const userPrompt = [
    "Analisis wajah berikut untuk membuat hasil face reading:",
    `- Ekspresi utama: ${input.expression.narrative}.`,
    `- Label model: ${input.expression.label} dengan confidence ${(input.expression.confidence * 100).toFixed(1)}%.`,
    `- Hash singkat gambar (untuk referensi saja): ${input.imageHint}.`,
    "- Gunakan ekspresi sebagai dasar untuk menyusun manifesting karier dan masa depan.",
    "- Pertimbangkan gambaran umum face reading modern (potensi, karakter, peluang).",
    "- Fokuskan rekomendasi jurusan pada RPL, DKV, atau TKJ. Pilih satu sebagai jurusan utama dan jadikan dua lainnya sebagai alternatif dengan catatan singkat yang relevan.",
    "- Langkah fokus harus aplikatif untuk pelajar (misal: aktivitas penguatan keterampilan, proyek mini, kebiasaan belajar).",
    "- Kebiasaan pendukung gunakan format bullet pendek yang mendukung jurusan utama.",
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
