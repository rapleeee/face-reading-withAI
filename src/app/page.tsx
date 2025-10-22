"use client";

import Image from "next/image";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  History,
  Instagram,
  Eye,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageCircle,
  Film,
  RefreshCw,
  Share2,
  Sparkles,
  Video,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type IndicatorLevel = "strength" | "opportunity" | "warning";

type ManifestPoint = {
  title: string;
  description: string;
  indicator: IndicatorLevel;
};

type FaceReadingResult = {
  expression: {
    headline: string;
    energyTone: string;
    personalityHighlight: string;
    confidence: number;
    baseLabel: string;
    baseConfidence: number;
  };
  manifesting: {
    pekerjaanKarir: ManifestPoint[];
    masaDepan: ManifestPoint[];
  };
  rekomendasiJurusan: {
    utama: {
      kode: string;
      nama: string;
      alasan: ManifestPoint[];
      langkahFokus: string;
      kebiasaanPendukung: string[];
    };
    alternatif: Array<{
      kode: string;
      nama: string;
      catatan: string;
    }>;
  };
  generatedAt: string;
  meta: {
    source: "ai" | "fallback";
    cached?: boolean;
  };
};

type LegacyFaceReadingResult = Omit<FaceReadingResult, "rekomendasiJurusan"> & {
  rekomendasiSekolah: {
    tipe: "SMK" | "SMA";
    alasan: ManifestPoint[];
    langkahCepat: string;
    kebiasaanPendukung: string[];
  };
};

type StoredSessionEntry = {
  id: string;
  image: string;
  result: FaceReadingResult | LegacyFaceReadingResult;
};

type SessionEntry = {
  id: string;
  image: string;
  result: FaceReadingResult;
};

const INIT_RESULT: FaceReadingResult | null = null;

const indicatorMeta: Record<
  IndicatorLevel,
  {
    label: string;
    wrapper: string;
    text: string;
    icon: ComponentType<{ className?: string }>;
  }
> = {
  strength: {
    label: "Kekuatan",
    wrapper:
      "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-900/20",
    text: "text-emerald-900 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  opportunity: {
    label: "Peluang",
    wrapper:
      "border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20",
    text: "text-amber-900 dark:text-amber-200",
    icon: Lightbulb,
  },
  warning: {
    label: "Catatan",
    wrapper:
      "border-rose-200 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-900/30",
    text: "text-rose-900 dark:text-rose-200",
    icon: AlertTriangle,
  },
};

const HISTORY_KEY = "face-reading-history-v1";

const CAPTURE_TIPS = [
  "Posisikan wajah sejajar kamera dengan pencahayaan menghadap depan.",
  "Pastikan dahi hingga dagu terlihat jelas, hindari menutupi wajah.",
  "Relaks dan tahan ekspresi natural selama 2 detik sebelum ambil foto.",
];

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const SITE_NAME = "Face Reading Vision";
const SITE_HANDLE = "facereading.ai";

const MAJOR_LABELS: Record<string, string> = {
  RPL: "Rekayasa Perangkat Lunak",
  DKV: "Desain Komunikasi Visual",
  TKJ: "Teknik Komputer dan Jaringan",
};

type MoodSnippet = {
  title: string;
  message: string;
  emoji: string;
};

const MOOD_SNIPPETS: Record<string, MoodSnippet> = {
  happiness: {
    title: "Mood Bahagia",
    message: "Wih, cerita dong! Energi kamu lagi cerah banget, bagikan kabar baikmu.",
    emoji: ":)",
  },
  sadness: {
    title: "Mood Lagi Teduh",
    message: "Semangat ya, tarik napas dalam-dalam. Kamu boleh rehat sebentar, nanti bangkit lagi.",
    emoji: "<3",
  },
  anger: {
    title: "Mood Super Fokus",
    message: "Salurkan tegasnya energi ke tugas penting biar hasilnya maksimal.",
    emoji: "!!",
  },
  surprise: {
    title: "Mood Penasaran",
    message: "Seru nih! Catat ide-ide baru sebelum menghilang dan eksplor pelan-pelan.",
    emoji: ":o",
  },
  fear: {
    title: "Mood Waspada",
    message: "Langkah kecil tetap kemajuan. Kamu aman, ambil satu progres dulu.",
    emoji: "^_^",
  },
  disgust: {
    title: "Mood Perfeksionis",
    message: "Standar kamu tinggi banget. Pilih satu hal untuk diperbaiki, sisanya biarkan mengalir.",
    emoji: ":|",
  },
  contempt: {
    title: "Mood Kritis Tajam",
    message: "Gunakan insight kamu buat kasih solusi bareng apresiasi ya.",
    emoji: "[]",
  },
  neutral: {
    title: "Mood Lagi Santai",
    message: "Tetap jaga energi seimbang, kamu siap adaptasi kapan pun dibutuhkan.",
    emoji: "c:",
  },
  unknown: {
    title: "Mood Belum Jelas",
    message: "Coba ambil foto lagi dengan pencahayaan lebih terang supaya AI bisa membaca ekspresi dengan jelas.",
    emoji: "*",
  },
};

const getMoodSnippet = (label?: string): MoodSnippet => {
  if (!label) return MOOD_SNIPPETS.unknown;
  const key = label.toLowerCase();
  return MOOD_SNIPPETS[key] ?? MOOD_SNIPPETS.unknown;
};

const upgradeLegacyResult = (
  result: FaceReadingResult | LegacyFaceReadingResult,
): FaceReadingResult => {
  if ("rekomendasiJurusan" in result) {
    return result;
  }

  const { rekomendasiSekolah, ...rest } = result as LegacyFaceReadingResult;
  const fallbackLegacy = rekomendasiSekolah ?? {
    tipe: "SMK" as const,
    alasan: [],
    langkahCepat: "Fokus pada pondasi belajar konsisten.",
    kebiasaanPendukung: [],
  };
  const mapped =
    fallbackLegacy.tipe === "SMK"
      ? { kode: "TKJ", nama: MAJOR_LABELS.TKJ }
      : { kode: "RPL", nama: MAJOR_LABELS.RPL };

  return {
    ...rest,
    rekomendasiJurusan: {
      utama: {
        kode: mapped.kode,
        nama: mapped.nama,
        alasan: fallbackLegacy.alasan,
        langkahFokus: fallbackLegacy.langkahCepat,
        kebiasaanPendukung: fallbackLegacy.kebiasaanPendukung,
      },
      alternatif: [],
    },
  };
};

async function createThumbnail(dataUrl: string, targetWidth = 360) {
  try {
    const image = await loadImageElement(dataUrl);
    if (!image.width || !image.height) return dataUrl;
    const ratio = targetWidth / image.width;
    const width = targetWidth;
    const height = Math.round(image.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.7);
  } catch (err) {
    console.warn("[history] gagal membuat thumbnail", err);
    return dataUrl;
  }
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Image loading hanya tersedia di browser"));
      return;
    }
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.crossOrigin = "anonymous";
    image.src = src;
  });
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [result, setResult] = useState<FaceReadingResult | null>(INIT_RESULT);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<SessionEntry[]>([]);
  const [storyTarget, setStoryTarget] = useState<"instagram" | "whatsapp" | "video" | null>(null);
  const [previewLoading, setPreviewLoading] = useState<"image" | "video" | null>(null);
  const [storyPreview, setStoryPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);

  const isSharingSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return (
      typeof navigator.share === "function" ||
      typeof navigator.clipboard !== "undefined"
    );
  }, []);

  const shareLabel = useMemo(() => {
    if (!isSharingSupported) return "Bagikan";
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      return "Bagikan";
    }
    return "Salin Ringkasan";
  }, [isSharingSupported]);

  useEffect(() => {
    let isCancelled = false;

    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        currentStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {
              setError("Gagal memutar kamera. Silakan izinkan akses kamera.");
            });
            setIsCameraReady(true);
          };
        }
      } catch (err) {
        console.error(err);
        setError(
          "Tidak dapat mengakses kamera. Pastikan perangkat memiliki webcam dan izin kamera sudah diberikan.",
        );
      }
    }

    initCamera();

    return () => {
      isCancelled = true;
      currentStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

useEffect(() => {
  if (typeof window === "undefined") return;
  let cancelled = false;
  const loadHistoryFromStorage = async () => {
    try {
      const stored = window.localStorage.getItem(HISTORY_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as StoredSessionEntry[];
      if (!Array.isArray(parsed)) return;
      const trimmed = parsed.slice(0, 5);
      const sanitized = await Promise.all(
        trimmed.map(async (entry) => {
          const upgraded = upgradeLegacyResult(entry.result);
          let image = entry.image ?? "";
          if (image && image.length > 200_000) {
            try {
              image = await createThumbnail(image, 320);
            } catch (err) {
              console.warn("[history] gagal mengecilkan gambar dari storage", err);
              image = image.slice(0, 200_000);
            }
          }
          const normalized: SessionEntry = {
            id: entry.id,
            image,
            result: upgraded,
          };
          return normalized;
        }),
      );
      if (!cancelled) {
        setHistory(sanitized);
      }
    } catch (err) {
      console.error("Gagal memuat riwayat:", err);
    }
  };
  loadHistoryFromStorage();
  return () => {
    cancelled = true;
  };
}, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const trimmed = history.slice(0, 5);
      const serialized = JSON.stringify(trimmed);
      if (serialized.length > 2_000_000) {
        console.warn("Riwayat terlalu besar, abaikan penyimpanan ke localStorage");
        window.localStorage.removeItem(HISTORY_KEY);
        return;
      }
      window.localStorage.setItem(HISTORY_KEY, serialized);
    } catch (err) {
      console.error("Gagal menyimpan riwayat:", err);
      try {
        window.localStorage.removeItem(HISTORY_KEY);
      } catch (removeErr) {
        console.error("Gagal menghapus riwayat lama:", removeErr);
      }
    }
  }, [history]);

  useEffect(() => {
    return () => {
      if (storyPreview) {
        URL.revokeObjectURL(storyPreview.url);
      }
    };
  }, [storyPreview]);

  const handleCapture = useCallback(() => {
    setActionMessage(null);
    setError(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      setError("Kamera belum siap. Coba beberapa saat lagi.");
      return;
    }

    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) {
      setError("Gagal mengambil gambar. Pastikan kamera aktif.");
      return;
    }

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Canvas tidak tersedia di browser ini.");
      return;
    }

    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
    const dataUrl = canvas.toDataURL("image/png");
    setSnapshot(dataUrl);
    setResult(null);
  }, []);

  const handleRetake = useCallback(() => {
    setSnapshot(null);
    setResult(null);
    setError(null);
    setActionMessage(null);
    setStoryTarget(null);
    if (storyPreview) {
      URL.revokeObjectURL(storyPreview.url);
      setStoryPreview(null);
    }
  }, [storyPreview]);

  const handleSelectHistory = useCallback(
    (entry: SessionEntry) => {
      setSnapshot(entry.image);
      setResult(entry.result);
      setError(null);
      setActionMessage("Menampilkan hasil dari riwayat sebelumnya.");
      setStoryTarget(null);
      if (storyPreview) {
        URL.revokeObjectURL(storyPreview.url);
        setStoryPreview(null);
      }
    },
    [storyPreview],
  );

  const requestAnalysis = useCallback(async () => {
    if (!snapshot) {
      setError("Ambil foto terlebih dahulu sebelum analisis.");
      return;
    }

    try {
      setIsAnalyzing(true);
      setError(null);
      setActionMessage(null);

      const response = await fetch("/api/face-reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: snapshot }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message ?? "Terjadi kesalahan saat analisis.");
      }

      const payload: FaceReadingResult = await response.json();
      setResult(payload);
      if (storyPreview) {
        URL.revokeObjectURL(storyPreview.url);
        setStoryPreview(null);
      }
      setStoryTarget(null);
      if (snapshot) {
        const thumb = await createThumbnail(snapshot, 320);
        const entry: SessionEntry = {
          id: `${Date.now()}`,
          image: thumb,
          result: payload,
        };
        setHistory((prev) => {
          const withoutDuplicate = prev.filter(
            (item) => item.image !== thumb,
          );
          return [entry, ...withoutDuplicate].slice(0, 5);
        });
      }
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Terjadi gangguan saat mengambil hasil face reading.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [snapshot, storyPreview]);

  const downloadPdf = useCallback(async () => {
    if (!result) return;

    try {
      setActionMessage(null);
      setStoryTarget(null);
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const marginLeft = 16;
      const maxWidth = 178;
      const lineHeight = 6;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Hasil Face Reading", marginLeft, 24);

      if (snapshot) {
        doc.addImage(snapshot, "PNG", 140, 18, 50, 38, undefined, "FAST");
      }

      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Dibuat pada: ${new Date(result.generatedAt).toLocaleString("id-ID")}`,
        marginLeft,
        34,
      );

      let cursorY = 48;

      const addSection = (title: string, bulletLines: string[]) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text(title, marginLeft, cursorY);
        cursorY += 6;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);

        bulletLines.forEach((line) => {
          const prepared = doc.splitTextToSize(`• ${line}`, maxWidth);
          prepared.forEach((item: string) => {
            if (cursorY > 280) {
              doc.addPage();
              cursorY = 20;
            }
            doc.text(item, marginLeft, cursorY);
            cursorY += lineHeight;
          });
          cursorY += 2;
        });
        cursorY += 4;
      };

      const pointLine = (point: ManifestPoint) =>
        `[${indicatorMeta[point.indicator].label}] ${point.title}: ${point.description}`;
      const moodSnippet = getMoodSnippet(result.expression.baseLabel);
      const sourceLine =
        result.meta.source === "fallback"
          ? "Mode fallback: analisis disusun dari template ekspresi karena model utama tidak tersedia."
          : result.meta.cached
            ? "Analisis diambil dari cache untuk mempercepat tampilan ulang."
            : "Analisis dihasilkan langsung oleh AI berdasarkan ekspresi terbaru.";

      addSection("Ekspresi Saat Ini", [
        sourceLine,
        `Mood terdeteksi: ${moodSnippet.title}`,
        moodSnippet.message,
        `${result.expression.headline} (confidence ${Math.round(result.expression.confidence * 100)}%)`,
        result.expression.energyTone,
        result.expression.personalityHighlight,
      ]);

      const pekerjaanBullets = result.manifesting.pekerjaanKarir.map(pointLine);
      if (pekerjaanBullets.length > 0) {
        addSection("Manifesting Pekerjaan & Karier", pekerjaanBullets);
      }

      const masaDepanBullets = result.manifesting.masaDepan.map(pointLine);
      if (masaDepanBullets.length > 0) {
        addSection("Manifesting Masa Depan", masaDepanBullets);
      }

      const jurusanUtama = result.rekomendasiJurusan.utama;
      const rekomendasiBullets = [
        `Jurusan utama: ${jurusanUtama.nama} (${jurusanUtama.kode})`,
        ...jurusanUtama.alasan.map(pointLine),
        `Langkah fokus: ${jurusanUtama.langkahFokus}`,
        ...jurusanUtama.kebiasaanPendukung.map(
          (item) => `Kebiasaan pendukung: ${item}`,
        ),
      ];
      if (result.rekomendasiJurusan.alternatif.length > 0) {
        rekomendasiBullets.push(
          "Alternatif jurusan:",
          ...result.rekomendasiJurusan.alternatif.map(
            (alt) =>
              `- ${alt.nama} (${alt.kode}): ${alt.catatan}`,
          ),
        );
      }
      addSection("Rekomendasi Jurusan", rekomendasiBullets);

      doc.save(`face-reading-${Date.now()}.pdf`);
      setActionMessage("PDF berhasil diunduh.");
    } catch (err) {
      console.error(err);
      setError("Gagal membuat PDF. Coba lagi atau gunakan browser lain.");
    }
  }, [result, snapshot]);

  const shareSummary = useCallback(async () => {
    if (!result) return;

    const confidencePercent = Math.round(result.expression.confidence * 100);
    const pointLine = (point: ManifestPoint) =>
      `[${indicatorMeta[point.indicator].label}] ${point.title}: ${point.description}`;
    const sourceSummary =
      result.meta.source === "fallback"
        ? "Catatan: mode fallback digunakan karena model utama sedang sibuk; insight berasal dari template ekspresi."
        : result.meta.cached
        ? "Catatan: hasil ditampilkan ulang dari cache analisis sebelumnya."
        : "Catatan: hasil ini diproses langsung oleh AI saat foto diambil.";
    const moodSnippet = getMoodSnippet(result.expression.baseLabel);
    const jurusanUtama = result.rekomendasiJurusan.utama;

    const textSummary = [
      "Hasil Face Reading:",
      `• Mood: ${moodSnippet.title}`,
      `• Catatan mood: ${moodSnippet.message}`,
      `• Ekspresi: ${result.expression.headline} (yakin ${confidencePercent}%)`,
      `• Energi: ${result.expression.energyTone}`,
      `• Personalitas: ${result.expression.personalityHighlight}`,
      `• ${sourceSummary}`,
      "• Manifesting Pekerjaan & Karier:",
      ...result.manifesting.pekerjaanKarir.map(
        (point) => `   - ${pointLine(point)}`,
      ),
      "• Manifesting Masa Depan:",
      ...result.manifesting.masaDepan.map((point) => `   - ${pointLine(point)}`),
      `• Jurusan utama: ${jurusanUtama.nama} (${jurusanUtama.kode})`,
      ...jurusanUtama.alasan.map(
        (point) => `   - ${pointLine(point)}`,
      ),
      `• Langkah fokus: ${jurusanUtama.langkahFokus}`,
      "• Kebiasaan pendukung:",
      ...jurusanUtama.kebiasaanPendukung.map(
        (item) => `   - ${item}`,
      ),
      ...(result.rekomendasiJurusan.alternatif.length > 0
        ? [
            "• Alternatif jurusan:",
            ...result.rekomendasiJurusan.alternatif.map(
              (alt) =>
                `   - ${alt.nama} (${alt.kode}): ${alt.catatan}`,
            ),
          ]
        : []),
      `Dibuat pada: ${new Date(result.generatedAt).toLocaleString("id-ID")}`,
    ].join("\n");

    try {
      if (navigator.share) {
        setStoryTarget(null);
        await navigator.share({
          title: "Hasil Face Reading",
          text: textSummary,
        });
        setActionMessage("Hasil berhasil dibagikan.");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(textSummary);
        setActionMessage("Ringkasan hasil disalin ke clipboard.");
      } else {
        setError("Browser tidak mendukung fitur bagikan.");
      }
    } catch (err) {
      console.error(err);
      setError("Gagal membagikan hasil. Coba cara lain.");
    }
  }, [result]);

  const resultAvailable = Boolean(result);

  const loadImage = useCallback((src: string) => loadImageElement(src), []);

  const buildStoryCanvas = useCallback(async () => {
    if (!result) {
      throw new Error("Hasil analisis belum tersedia.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas tidak didukung browser ini.");
    }

    let faceImage: HTMLImageElement | null = null;
    if (snapshot) {
      try {
        faceImage = await loadImage(snapshot);
      } catch (err) {
        console.warn("Gagal memuat snapshot untuk story", err);
      }
    }

    const drawWrappedText = (
      text: string,
      startX: number,
      startY: number,
      maxWidth: number,
      lineHeight: number,
    ) => {
      const words = text.split(" ");
      let line = "";
      let y = startY;
      for (let n = 0; n < words.length; n += 1) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line.trim(), startX, y);
          line = words[n] + " ";
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      if (line.trim()) {
        ctx.fillText(line.trim(), startX, y);
        y += lineHeight;
      }
      return y;
    };

    const drawScene = (glow = 0.18) => {
      ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

      const gradient = ctx.createLinearGradient(0, 0, 0, STORY_HEIGHT);
      gradient.addColorStop(0, "#0f172a");
      gradient.addColorStop(1, "#1d4ed8");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

      ctx.fillStyle = `rgba(15, 23, 42, ${0.45 + glow * 0.25})`;
      ctx.fillRect(72, 440, STORY_WIDTH - 144, STORY_HEIGHT - 512);

      ctx.save();
      const highlight = ctx.createLinearGradient(96, 460, STORY_WIDTH - 96, STORY_HEIGHT - 120);
      highlight.addColorStop(0, `rgba(56, 189, 248, ${0.14 + glow * 0.2})`);
      highlight.addColorStop(1, "rgba(59, 130, 246, 0.08)");
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.roundRect(96, 460, STORY_WIDTH - 192, STORY_HEIGHT - 560, 48);
      ctx.fill();
      ctx.restore();

      if (faceImage) {
        const maxPhotoWidth = STORY_WIDTH - 280;
        const maxPhotoHeight = 520;
        const scale = Math.min(
          maxPhotoWidth / faceImage.width,
          maxPhotoHeight / faceImage.height,
          1,
        );
        const photoWidth = faceImage.width * scale;
        const photoHeight = faceImage.height * scale;
        const photoX = (STORY_WIDTH - photoWidth) / 2;
        const photoY = 200;
        ctx.save();
        ctx.shadowColor = `rgba(15, 23, 42, ${0.35 + glow * 0.18})`;
        ctx.shadowBlur = 48;
        ctx.beginPath();
        ctx.roundRect(photoX, photoY, photoWidth, photoHeight, 36);
        ctx.closePath();
        ctx.fill();
        ctx.clip();
        ctx.drawImage(faceImage, photoX, photoY, photoWidth, photoHeight);
        ctx.restore();
      }

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(160, 220, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.arc(STORY_WIDTH - 180, 260, 36, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "600 28px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(SITE_NAME.toUpperCase(), 96, 160);
      ctx.font = "500 22px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`@${SITE_HANDLE}`, 96, 196);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 56px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText("Face Reading Story", 96, 520);

      ctx.font = "24px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(
        new Date(result.generatedAt).toLocaleString("id-ID", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
        96,
        560,
      );

      ctx.font = "bold 48px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "#fff";
      const confidencePercent = Math.round(result.expression.confidence * 100);
      let cursorY = drawWrappedText(
        `${result.expression.headline} (Yakin ${confidencePercent}%)`,
        120,
        680,
        STORY_WIDTH - 240,
        58,
      );

      ctx.font = "28px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      cursorY = drawWrappedText(
        `${result.expression.energyTone}. ${result.expression.personalityHighlight}.`,
        120,
        cursorY + 8,
        STORY_WIDTH - 240,
        40,
      );

      const storyMood = getMoodSnippet(result.expression.baseLabel);
      ctx.font = "28px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(125, 211, 252, 0.95)";
      cursorY = drawWrappedText(
        `${storyMood.title} ${storyMood.emoji}`,
        120,
        cursorY + 18,
        STORY_WIDTH - 240,
        36,
      );
      ctx.font = "26px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      cursorY = drawWrappedText(
        storyMood.message,
        120,
        cursorY + 6,
        STORY_WIDTH - 240,
        34,
      );

      const drawPointSection = (
        title: string,
        points: ManifestPoint[],
        startY: number,
      ) => {
        let y = startY;
        if (points.length === 0) return y;
        ctx.font = "bold 34px 'Helvetica Neue', Arial, sans-serif";
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(title, 120, y);
        y += 46;
        ctx.font = "28px 'Helvetica Neue', Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        points.slice(0, 3).forEach((point) => {
          const meta = indicatorMeta[point.indicator];
          const indicatorText = `[${meta.label}] ${point.title}: ${point.description}`;
          y = drawWrappedText(indicatorText, 140, y, STORY_WIDTH - 280, 38);
          y += 10;
        });
        return y + 12;
      };

      cursorY = drawPointSection(
        "Manifesting Karier",
        result.manifesting.pekerjaanKarir,
        cursorY + 12,
      );
      cursorY = drawPointSection(
        "Manifesting Masa Depan",
        result.manifesting.masaDepan,
        cursorY + 12,
      );
      const storyJurusan = result.rekomendasiJurusan.utama;
      cursorY = drawPointSection(
        `Jurusan Utama ${storyJurusan.nama}`,
        storyJurusan.alasan,
        cursorY + 12,
      );

      ctx.font = "28px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      cursorY = drawWrappedText(
        `Langkah fokus: ${storyJurusan.langkahFokus}`,
        120,
        cursorY + 8,
        STORY_WIDTH - 240,
        38,
      );

      ctx.font = "24px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      cursorY = drawWrappedText(
        "Kebiasaan pendukung: " +
          storyJurusan.kebiasaanPendukung
            .slice(0, 2)
            .map((item) => `• ${item}`)
            .join("  "),
        120,
        cursorY + 24,
        STORY_WIDTH - 240,
        34,
      );
      if (result.rekomendasiJurusan.alternatif.length > 0) {
        ctx.font = "24px 'Helvetica Neue', Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.68)";
        cursorY = drawWrappedText(
          "Alternatif: " +
            result.rekomendasiJurusan.alternatif
              .slice(0, 2)
              .map((alt) => `${alt.nama} (${alt.kode}) - ${alt.catatan}`)
              .join(" | "),
          120,
          cursorY + 16,
          STORY_WIDTH - 240,
          34,
        );
      }

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(96, STORY_HEIGHT - 160, STORY_WIDTH - 192, 2);
      ctx.font = "22px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(
        "Bagikan story ini dan wujudkan manifesting terbaikmu.",
        120,
        STORY_HEIGHT - 110,
      );

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "600 20px 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(SITE_HANDLE, STORY_WIDTH - 260, STORY_HEIGHT - 110);
    };

    return { canvas, drawScene };
  }, [loadImage, result, snapshot]);

  const generateStoryImage = useCallback(async () => {
    const { canvas, drawScene } = await buildStoryCanvas();
    drawScene(0.18);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Gagal membuat story image."));
      }, "image/png", 0.92);
    });
  }, [buildStoryCanvas]);

  const generateStoryVideo = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Browser belum mendukung perekaman video.");
    }

    const { canvas, drawScene } = await buildStoryCanvas();
    const captureStream = (canvas as HTMLCanvasElement & {
      captureStream?: (fps?: number) => MediaStream;
    }).captureStream;

    if (!captureStream) {
      throw new Error("Browser belum mendukung perekaman story video.");
    }

    const stream = captureStream.call(canvas, 30);
    const preferredTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const supportsType = typeof MediaRecorder.isTypeSupported === "function"
      ? (type: string) => MediaRecorder.isTypeSupported(type)
      : () => true;
    const mimeType = preferredTypes.find((type) => supportsType(type));
    if (!mimeType) {
      throw new Error("Format video tidak tersedia di browser ini.");
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];

    const tracks = stream.getTracks();

    const recording = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        tracks.forEach((track) => track.stop());
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.onerror = (event) => {
        tracks.forEach((track) => track.stop());
        reject(event.error ?? new Error("Perekaman video gagal."));
      };
    });

    const duration = 3600;
    const start = performance.now();

    const renderFrame = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const glow = 0.18 + 0.18 * Math.sin(progress * Math.PI * 4);
      drawScene(glow);
      if (progress < 1) {
        requestAnimationFrame(renderFrame);
      } else {
        recorder.stop();
      }
    };

    drawScene(0.18);
    recorder.start();
    requestAnimationFrame(renderFrame);

    return recording;
  }, [buildStoryCanvas]);

  const shareStory = useCallback(
    async (platform: "instagram" | "whatsapp") => {
      if (!result) {
        setError("Analisis belum tersedia untuk dibagikan.");
        return;
      }
      try {
        setStoryTarget(platform);
        setActionMessage(null);
        const blob = await generateStoryImage();
        const file = new File([blob], "face-reading-story.png", {
          type: "image/png",
        });

        const shareData: ShareData = {
          files: [file],
          title: "Face Reading AI",
          text:
            platform === "instagram"
              ? "Story face reading-ku sudah siap!"
              : "Bagikan manifesting wajahmu ke WhatsApp Story.",
        };

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share(shareData);
          setActionMessage(
            platform === "instagram"
              ? "Story dikirim ke lembar share, pilih Instagram Story untuk melanjutkan."
              : "Story dikirim ke lembar share, pilih WhatsApp untuk upload ke Status.",
          );
        } else if (navigator.share) {
          await navigator.share(shareData);
          setActionMessage("Story dibagikan melalui lembar share perangkat.");
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "face-reading-story.png";
          link.click();
          setActionMessage(
            "Browser belum mendukung share langsung. Story disimpan sebagai gambar, unggah manual ke Instagram/WhatsApp.",
          );
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
      } catch (err) {
        console.error(err);
        setError(
          platform === "instagram"
            ? "Gagal menyiapkan story Instagram. Coba lagi nanti."
            : "Gagal menyiapkan story WhatsApp. Coba lagi nanti.",
        );
      } finally {
        setStoryTarget(null);
      }
    },
    [generateStoryImage, result],
  );

  const shareStoryVideo = useCallback(async () => {
    if (!result) {
      setError("Analisis belum tersedia untuk dibagikan.");
      return;
    }
    try {
      setStoryTarget("video");
      setActionMessage(null);
      const blob = await generateStoryVideo();
      const file = new File([blob], "face-reading-story.webm", {
        type: blob.type || "video/webm",
      });

      const shareData: ShareData = {
        files: [file],
        title: "Face Reading AI",
        text: "Story video face reading siap dibagikan!",
      };

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(shareData);
        setActionMessage(
          "Story video dikirim ke lembar share. Pilih aplikasi favoritmu untuk mengunggahnya.",
        );
      } else if (navigator.share) {
        await navigator.share(shareData);
        setActionMessage("Story video dibagikan melalui lembar share perangkat.");
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "face-reading-story.webm";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setActionMessage(
          "Browser belum mendukung share langsung. Story video diunduh, unggah manual ke Instagram/WhatsApp.",
        );
      }
    } catch (err) {
      console.error(err);
      setError("Gagal menyiapkan story video. Coba lagi nanti.");
    } finally {
      setStoryTarget(null);
    }
  }, [generateStoryVideo, result]);

  const closeStoryPreview = useCallback(() => {
    if (storyPreview) {
      URL.revokeObjectURL(storyPreview.url);
      setStoryPreview(null);
    }
  }, [storyPreview]);

  const previewStoryMedia = useCallback(
    async (format: "image" | "video") => {
      if (!result) {
        setError("Analisis belum tersedia untuk dipreview.");
        return;
      }
      try {
        setPreviewLoading(format);
        setActionMessage(null);
        const blob =
          format === "image" ? await generateStoryImage() : await generateStoryVideo();
        if (storyPreview) {
          URL.revokeObjectURL(storyPreview.url);
        }
        const url = URL.createObjectURL(blob);
        setStoryPreview({ url, type: format });
      } catch (err) {
        console.error(err);
        setError(
          format === "video"
            ? "Gagal membuat preview story video. Pastikan browser mendukung perekaman WebM."
            : "Gagal membuat preview story. Coba lagi sebentar lagi.",
        );
      } finally {
        setPreviewLoading(null);
      }
    },
    [generateStoryImage, generateStoryVideo, result, storyPreview],
  );

  return (
    <div className="min-h-screen bg-zinc-50 pb-12 pt-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2">
          <Badge variant="secondary" className="w-fit gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            Face Reading AI
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Baca Ekspresi, Temukan Manifesting Masa Depanmu
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400 sm:text-lg">
            Ambil foto dari kamera, biarkan AI membaca ekspresi wajahmu, dan
            dapatkan saran cepat untuk langkah sekolah agar manifesting karier
            lebih terarah.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hasil bersifat interpretasi AI untuk refleksi diri, bukan diagnosis
            profesional.
          </p>
        </header>

        <main className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Kamera Live</CardTitle>
                <CardDescription>
                  Pastikan wajah terlihat jelas, lalu ambil foto untuk analisis.
                </CardDescription>
              </div>
              <Video className="hidden h-8 w-8 text-zinc-400 sm:block" />
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn(
                    "h-full w-full object-cover transition-opacity duration-300",
                    snapshot ? "opacity-0" : "opacity-100",
                    !isCameraReady && "opacity-0",
                  )}
                />
                {!isCameraReady && !error && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-100 dark:bg-zinc-900">
                    <Skeleton className="h-10 w-32" />
                    <p className="text-sm text-zinc-500">Mengaktifkan kamera...</p>
                  </div>
                )}
                {snapshot && (
                  <Image
                    src={snapshot}
                    alt="Snapshot wajah"
                    fill
                    sizes="(max-width: 1024px) 100vw, 600px"
                    className="object-cover"
                    priority
                    unoptimized
                  />
                )}
                {!snapshot && isCameraReady && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-y-[15%] left-1/2 w-px -translate-x-1/2 bg-white/50 dark:bg-white/20" />
                    <div className="absolute inset-x-[12%] top-1/2 h-px -translate-y-1/2 bg-white/50 dark:bg-white/20" />
                    <div className="absolute inset-[18%] rounded-full border border-white/30 dark:border-white/10" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20 dark:from-black/40 dark:via-transparent dark:to-black/50" />
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {!snapshot ? (
                  <Button
                    size="lg"
                    onClick={handleCapture}
                    disabled={!isCameraReady || Boolean(error)}
                    className="gap-2"
                  >
                    <Camera className="h-4 w-4" />
                    Ambil Snapshot
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={handleRetake}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Ambil Ulang
                  </Button>
                )}

                <Button
                  onClick={requestAnalysis}
                  disabled={!snapshot || isAnalyzing}
                  className="gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analisis Berjalan...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Analisis Wajah
                    </>
                  )}
                </Button>
              </div>
              {error && (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              {actionMessage && (
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {actionMessage}
                </p>
              )}
              <Separator className="my-2" />
              <div className="rounded-lg border border-zinc-200 bg-white/80 p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
                  <ListChecks className="h-4 w-4 text-emerald-500" />
                  <span className="font-semibold">Panduan Pengambilan Foto</span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
                  {CAPTURE_TIPS.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Ikuti langkah di atas untuk hasil yang lebih konsisten dan mudah
                  dianalisis AI.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-1 flex-col">
          <CardHeader className="gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Hasil Face Reading</CardTitle>
                {resultAvailable && result && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-emerald-500 text-emerald-950 dark:bg-emerald-400 dark:text-emerald-950">
                      {new Date(result.generatedAt).toLocaleString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Badge>
                    {result.meta.source === "fallback" && (
                      <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-400/30 dark:text-amber-200">
                        Mode Fallback
                      </Badge>
                    )}
                    {result.meta.cached && (
                      <Badge variant="outline" className="border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                        Cache
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <CardDescription>
                Hasil terbaru akan muncul di sini setelah analisis selesai.
              </CardDescription>
              {resultAvailable && result && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {result.meta.source === "fallback"
                    ? "Model utama sementara tidak tersedia, insight disusun dari template ekspresi agar kamu tetap mendapat arahan."
                    : result.meta.cached
                      ? "Ditampilkan ulang dari cache supaya kamu bisa meninjau kembali tanpa menunggu analisis baru."
                      : "Analisis diproses langsung oleh AI berdasarkan foto terakhir yang kamu ambil."}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              {!resultAvailable ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-6 rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
                  <Sparkles className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">
                      Belum ada hasil
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Ambil foto lalu jalankan analisis AI untuk melihat ekspresi
                      dan manifesting wajahmu.
                    </p>
                  </div>
                </div>
              ) : result ? (
                <div className="flex flex-1 flex-col gap-5">
                  <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                            Ekspresi Saat Ini
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                            {result.expression.headline}
                          </p>
                        </div>
                        <Badge className="mt-2 w-fit bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                          {Math.round(result.expression.confidence * 100)}% yakin
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                          <Activity className="h-4 w-4 text-emerald-500" />
                          {result.expression.energyTone}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                          <Sparkles className="h-4 w-4 text-purple-500" />
                          {result.expression.personalityHighlight}
                        </div>
                      </div>

                      {(() => {
                        const moodSnippet = getMoodSnippet(result.expression.baseLabel);
                        return (
                          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/50 dark:bg-sky-900/30 dark:text-sky-100">
                            <span className="font-semibold uppercase tracking-wide">
                              {moodSnippet.title}
                            </span>
                            <span className="ml-2 text-xs font-semibold text-sky-600 dark:text-sky-300">
                              {moodSnippet.emoji}
                            </span>
                            <p className="mt-1 text-sm leading-relaxed">
                              {moodSnippet.message}
                            </p>
                          </div>
                        );
                      })()}

                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 dark:bg-emerald-400"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(
                                12,
                                Math.round(result.expression.confidence * 100),
                              ),
                            )}%`,
                          }}
                        />
                      </div>

                      {(() => {
                        const moodSnippet = getMoodSnippet(result.expression.baseLabel);
                        return (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Mood terdeteksi:{" "}
                            <span className="font-semibold">{moodSnippet.title}</span>{" "}
                            (label model{" "}
                            <span className="font-semibold uppercase tracking-wide">
                              {result.expression.baseLabel}
                            </span>
                            ) dengan keyakinan sekitar{" "}
                            {Math.round(result.expression.baseConfidence * 100)}%.
                          </p>
                        );
                      })()}
                    </div>
                  </section>
                  <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div>
                      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                        Manifesting Pekerjaan & Karier
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Fokuskan energi ke area berikut untuk menguatkan potensi
                        karier.
                      </p>
                    </div>
                    <div className="grid gap-3">
                      {result.manifesting.pekerjaanKarir.map((point, idx) => {
                        const meta = indicatorMeta[point.indicator];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={`${point.title}-${idx}`}
                            className={cn(
                              "rounded-lg border p-4 shadow-sm transition duration-200",
                              meta.wrapper,
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <Icon className={cn("mt-1 h-4 w-4", meta.text)} />
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-xs font-semibold uppercase tracking-wide",
                                      meta.text,
                                    )}
                                  >
                                    {meta.label}
                                  </span>
                                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                    {point.title}
                                  </span>
                                </div>
                                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                  {point.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Separator />
                    <div>
                      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                        Manifesting Masa Depan
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Jangkauan jangka panjang untuk diselaraskan sejak dini.
                      </p>
                    </div>
                    <div className="grid gap-3">
                      {result.manifesting.masaDepan.map((point, idx) => {
                        const meta = indicatorMeta[point.indicator];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={`${point.title}-${idx}`}
                            className={cn(
                              "rounded-lg border p-4 shadow-sm transition duration-200",
                              meta.wrapper,
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <Icon className={cn("mt-1 h-4 w-4", meta.text)} />
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-xs font-semibold uppercase tracking-wide",
                                      meta.text,
                                    )}
                                  >
                                    {meta.label}
                                  </span>
                                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                    {point.title}
                                  </span>
                                </div>
                                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                  {point.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <section className="space-y-4 rounded-lg border border-emerald-500/40 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-950/30">
                    <div className="flex flex-col gap-2">
                      <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
                        Rekomendasi Jurusan
                      </h3>
                      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Jurusan utama: {result.rekomendasiJurusan.utama.nama} (
                        {result.rekomendasiJurusan.utama.kode})
                      </p>
                    </div>
                    <div className="grid gap-3">
                      {result.rekomendasiJurusan.utama.alasan.map((point, idx) => {
                        const meta = indicatorMeta[point.indicator];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={`${point.title}-${idx}`}
                            className={cn(
                              "rounded-lg border border-emerald-200/60 bg-white/80 p-4 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-950/50",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <Icon className={cn("mt-1 h-4 w-4", meta.text)} />
                              <div className="space-y-1">
                                <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                                  {point.title}
                                </span>
                                <p className="text-sm text-emerald-900/80 dark:text-emerald-200/90">
                                  {point.description}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Separator className="border-emerald-200 dark:border-emerald-800" />
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                        Langkah Fokus
                      </h4>
                      <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200">
                        {result.rekomendasiJurusan.utama.langkahFokus}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                        Kebiasaan Pendukung
                      </h4>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-emerald-900/80 dark:text-emerald-200">
                        {result.rekomendasiJurusan.utama.kebiasaanPendukung.map(
                          (item, idx) => (
                            <li key={`${item}-${idx}`}>{item}</li>
                          ),
                        )}
                      </ul>
                    </div>
                    {result.rekomendasiJurusan.alternatif.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                          Alternatif Jurusan
                        </h4>
                        <ul className="mt-2 space-y-2 text-sm text-emerald-900/80 dark:text-emerald-200">
                          {result.rekomendasiJurusan.alternatif.map((alt) => (
                            <li key={`${alt.kode}-${alt.nama}`} className="rounded-md border border-emerald-200/60 bg-white/80 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/40">
                              <span className="font-semibold">{alt.nama}</span>{" "}
                              <span className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                ({alt.kode})
                              </span>
                              <p className="mt-1 text-sm">{alt.catatan}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </CardContent>
            <Separator className="mx-6 mb-4 mt-auto" />
            <div className="flex flex-wrap items-center gap-3 px-6 pb-6">
              <Button
                variant="outline"
                onClick={downloadPdf}
                disabled={!resultAvailable}
                className={cn("gap-2", !resultAvailable && "cursor-not-allowed")}
              >
                <Download className="h-4 w-4" />
                Unduh PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => previewStoryMedia("image")}
                disabled={!resultAvailable || previewLoading === "image"}
                className={cn(
                  "gap-2",
                  (!resultAvailable || previewLoading === "image") && "cursor-not-allowed",
                )}
              >
                {previewLoading === "image" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Preview Story
              </Button>
              <Button
                variant="outline"
                onClick={() => previewStoryMedia("video")}
                disabled={!resultAvailable || previewLoading === "video"}
                className={cn(
                  "gap-2",
                  (!resultAvailable || previewLoading === "video") && "cursor-not-allowed",
                )}
              >
                {previewLoading === "video" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Film className="h-4 w-4" />
                )}
                Preview Video
              </Button>
              <Button
                variant="outline"
                onClick={() => shareStory("instagram")}
                disabled={!resultAvailable || Boolean(storyTarget)}
                className={cn(
                  "gap-2",
                  (!resultAvailable || Boolean(storyTarget)) && "cursor-not-allowed",
                )}
              >
                {storyTarget === "instagram" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Instagram className="h-4 w-4" />
                )}
                Story Instagram
              </Button>
              <Button
                variant="outline"
                onClick={() => shareStory("whatsapp")}
                disabled={!resultAvailable || Boolean(storyTarget)}
                className={cn(
                  "gap-2",
                  (!resultAvailable || Boolean(storyTarget)) && "cursor-not-allowed",
                )}
              >
                {storyTarget === "whatsapp" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                Story WhatsApp
              </Button>
              <Button
                variant="outline"
                onClick={shareStoryVideo}
                disabled={!resultAvailable || Boolean(storyTarget)}
                className={cn(
                  "gap-2",
                  (!resultAvailable || Boolean(storyTarget)) && "cursor-not-allowed",
                )}
              >
                {storyTarget === "video" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Film className="h-4 w-4" />
                )}
                Story Video
              </Button>
              <Button
                variant="outline"
                disabled={!resultAvailable || !isSharingSupported}
                onClick={shareSummary}
                className={cn(
                  "gap-2",
                  (!resultAvailable || !isSharingSupported) && "cursor-not-allowed",
                )}
              >
                <Share2 className="h-4 w-4" />
                {shareLabel}
              </Button>
            </div>
          </Card>
        </main>
        {history.length > 0 && (
          <Card className="border-dashed border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-zinc-500" />
                  Riwayat Analisis Terakhir
                </CardTitle>
                <CardDescription>
                  Klik salah satu untuk meninjau ulang hasil sebelumnya.
                </CardDescription>
              </div>
              <Badge variant="secondary">
                {history.length} sesi tersimpan
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleSelectHistory(entry)}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="relative h-32 w-full overflow-hidden">
                      <Image
                        src={entry.image}
                        alt="Riwayat snapshot wajah"
                        fill
                        sizes="200px"
                        className="object-cover transition duration-500 group-hover:scale-105"
                        unoptimized
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-xs font-medium text-white/90">
                        <span>
                          {new Date(entry.result.generatedAt).toLocaleDateString(
                            "id-ID",
                            {
                              day: "2-digit",
                              month: "short",
                            },
                          )}
                        </span>
                        <span>{entry.result.rekomendasiJurusan.utama.kode}</span>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col justify-between gap-2 p-4">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        {entry.result.expression.headline}
                      </p>
                      {(() => {
                        const moodSnippet = getMoodSnippet(entry.result.expression.baseLabel);
                        return (
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Mood: {moodSnippet.title}
                          </p>
                        );
                      })()}
                      <div className="flex flex-wrap items-center gap-1">
                        {entry.result.meta.source === "fallback" && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
                            Fallback
                          </span>
                        )}
                        {entry.result.meta.cached && (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            Cache
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                        <span>
                          {Math.round(entry.result.expression.confidence * 100)}%
                          yakin
                        </span>
                        <span>
                          {new Date(entry.result.generatedAt).toLocaleTimeString(
                            "id-ID",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {storyPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
          onClick={closeStoryPreview}
          role="presentation"
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-700/40 bg-zinc-950/80 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeStoryPreview}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900/80 text-zinc-200 transition hover:bg-zinc-800"
              aria-label="Tutup preview story"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="max-h-[80vh] overflow-auto p-6">
              <div className="mb-4 flex items-center justify-between gap-3 text-sm text-zinc-300">
                <span>
                  Preview Story {storyPreview.type === "video" ? "Video" : "Gambar"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = storyPreview.url;
                      link.download =
                        storyPreview.type === "video"
                          ? "face-reading-story.webm"
                          : "face-reading-story.png";
                      link.click();
                    }}
                    className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  >
                    Simpan
                  </Button>
                </div>
              </div>
              <div className="flex justify-center">
                {storyPreview.type === "video" ? (
                  <video
                    src={storyPreview.url}
                    className="h-[70vh] max-h-[960px] w-auto rounded-xl"
                    controls
                    autoPlay
                    loop
                  />
                ) : (
                  <Image
                    src={storyPreview.url}
                    alt="Preview story"
                    width={STORY_WIDTH / 2}
                    height={STORY_HEIGHT / 2}
                    className="h-auto max-h-[75vh] w-auto rounded-xl"
                    unoptimized
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
