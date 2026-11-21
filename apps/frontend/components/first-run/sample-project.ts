import type { CanvasHandle } from "@/components/image-canvas";

// 1x1 transparent PNG fallback if canvas context is unavailable (e.g. Node.js test environment)
const FALLBACK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function fallbackPngBlob(): Blob {
  const binary = atob(FALLBACK_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

function renderCharacterCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0f172a");
  bg.addColorStop(0.5, "#1e1b4b");
  bg.addColorStop(1, "#311042");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Border frame
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Inner decorative card
  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(24, 24, width - 48, height - 48);

  // Glowing circle behind character avatar
  const avatarGlow = ctx.createRadialGradient(width / 2, 180, 20, width / 2, 180, 120);
  avatarGlow.addColorStop(0, "rgba(56, 189, 248, 0.4)");
  avatarGlow.addColorStop(0.7, "rgba(168, 85, 247, 0.2)");
  avatarGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = avatarGlow;
  ctx.beginPath();
  ctx.arc(width / 2, 180, 120, 0, Math.PI * 2);
  ctx.fill();

  // Character silhouette (head & shoulders)
  ctx.fillStyle = "#38bdf8";
  // Head
  ctx.beginPath();
  ctx.arc(width / 2, 150, 45, 0, Math.PI * 2);
  ctx.fill();

  // Visor glow
  ctx.fillStyle = "#f43f5e";
  ctx.fillRect(width / 2 - 30, 145, 60, 12);

  // Shoulders & Torso
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.ellipse(width / 2, 250, 95, 55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Labels
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("CHARACTER CONCEPT", 36, 60);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Neon Scout · Unit 07", 36, 350);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px sans-serif";
  ctx.fillText("Role: Cyber Reconnaissance", 36, 380);
  ctx.fillText("Style: Hard-surface Sci-Fi / Anime", 36, 404);

  // Color palette swatches
  const swatches = ["#38bdf8", "#a855f7", "#f43f5e", "#fbbf24", "#34d399"];
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("PALETTE REFERENCE", 36, 445);
  swatches.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(46 + i * 36, 470, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function renderSceneCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Sunset sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.7);
  sky.addColorStop(0, "#020617");
  sky.addColorStop(0.4, "#1e1b4b");
  sky.addColorStop(0.7, "#be123c");
  sky.addColorStop(1, "#f97316");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.7);

  // Giant glowing sun
  const sun = ctx.createRadialGradient(width * 0.7, height * 0.5, 10, width * 0.7, height * 0.5, 80);
  sun.addColorStop(0, "#fef08a");
  sun.addColorStop(0.5, "#f59e0b");
  sun.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(width * 0.7, height * 0.5, 80, 0, Math.PI * 2);
  ctx.fill();

  // City skyline silhouette
  ctx.fillStyle = "#090d16";
  const buildings = [
    { x: 20, w: 50, h: 140 },
    { x: 80, w: 70, h: 200 },
    { x: 160, w: 45, h: 160 },
    { x: 215, w: 85, h: 230 },
    { x: 310, w: 60, h: 180 },
    { x: 380, w: 90, h: 210 },
    { x: 480, w: 55, h: 170 },
    { x: 545, w: 75, h: 150 },
  ];
  buildings.forEach((b) => {
    ctx.fillRect(b.x, height * 0.7 - b.h, b.w, b.h);
  });

  // Perspective floor
  const ground = ctx.createLinearGradient(0, height * 0.7, 0, height);
  ground.addColorStop(0, "#0b0f19");
  ground.addColorStop(1, "#020617");
  ctx.fillStyle = ground;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  // Grid lines on ground
  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= width; i += 40) {
    ctx.beginPath();
    ctx.moveTo(width / 2, height * 0.7);
    ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let y = height * 0.75; y < height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Text title banner
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.fillRect(20, 20, 260, 56);
  ctx.strokeStyle = "rgba(244, 63, 94, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 20, 260, 56);

  ctx.fillStyle = "#f43f5e";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("KEYFRAME · 16:9 CINEMATIC", 32, 40);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("Neo-Metropolis Sunset", 32, 62);
}

function renderMoodboardCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Dark charcoal backdrop
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, width, height);

  // Outer border
  ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  // Title header
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("VISUAL STYLE DIRECTION", 28, 44);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px sans-serif";
  ctx.fillText("Color & Material Exploration · Demo Canvas", 28, 66);

  // Grid of 4 mood cards
  const cards = [
    { label: "High Contrast Neon", color1: "#ec4899", color2: "#8b5cf6", x: 28, y: 90, w: 180, h: 140 },
    { label: "Industrial Weathered", color1: "#475569", color2: "#334155", x: 232, y: 90, w: 180, h: 140 },
    { label: "Atmospheric Smoke", color1: "#0ea5e9", color2: "#065f46", x: 28, y: 250, w: 180, h: 140 },
    { label: "Amber Hologram", color1: "#f59e0b", color2: "#ea580c", x: 232, y: 250, w: 180, h: 140 },
  ];

  cards.forEach((card) => {
    const cardGrad = ctx.createLinearGradient(card.x, card.y, card.x + card.w, card.y + card.h);
    cardGrad.addColorStop(0, card.color1);
    cardGrad.addColorStop(1, card.color2);
    ctx.fillStyle = cardGrad;
    ctx.fillRect(card.x, card.y, card.w, card.h);

    // Dark tag at bottom of card
    ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
    ctx.fillRect(card.x, card.y + card.h - 32, card.w, 32);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(card.label, card.x + 10, card.y + card.h - 12);
  });

  // Footer notes
  ctx.fillStyle = "#64748b";
  ctx.font = "11px sans-serif";
  ctx.fillText("Created with Lomra · Infinite Canvas Demo", 28, 418);
}

export async function createSampleBlob(
  width: number,
  height: number,
  render: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): Promise<Blob> {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        render(ctx, width, height);
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas export failed"));
          }, "image/png");
        });
      }
    } catch {
      // Fall through to fallback
    }
  }
  return fallbackPngBlob();
}

export async function createSampleFiles(): Promise<File[]> {
  const [characterBlob, sceneBlob, moodboardBlob] = await Promise.all([
    createSampleBlob(480, 520, renderCharacterCanvas),
    createSampleBlob(640, 360, renderSceneCanvas),
    createSampleBlob(440, 440, renderMoodboardCanvas),
  ]);

  return [
    new File([characterBlob], "demo-character-concept.png", { type: "image/png", lastModified: Date.now() }),
    new File([sceneBlob], "demo-scene-keyframe.png", { type: "image/png", lastModified: Date.now() }),
    new File([moodboardBlob], "demo-style-moodboard.png", { type: "image/png", lastModified: Date.now() }),
  ];
}

export async function loadSampleProject(canvas: CanvasHandle | null): Promise<string[]> {
  if (!canvas) throw new Error("Canvas is not ready");
  const files = await createSampleFiles();
  const addedIds: string[] = [];

  // Arrange items side-by-side with appropriate spacing
  const positions = [
    { x: -580, y: -40 },
    { x: -60, y: -40 },
    { x: 620, y: -40 },
  ];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pos = positions[i] ?? { x: i * 260, y: 0 };
    const ids = await canvas.addFiles([file], pos);
    addedIds.push(...ids);
  }

  // Frame all sample items in viewport
  try {
    if (typeof canvas.frameAll === "function") {
      canvas.frameAll();
    } else if (files[0]) {
      canvas.focusFile(files[0]);
    }
  } catch {
    // Optional focus
  }

  return addedIds;
}
