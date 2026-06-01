#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.XAI_API_KEY;

if (!apiKey) {
  console.error("Missing XAI_API_KEY in the environment.");
  process.exit(1);
}

const defaultBaseName = "our-trips-earth-intro";
const baseName = process.env.XAI_OUTPUT_BASENAME || defaultBaseName;
const outputDir = path.resolve("public/brand");
const outputPath = path.join(outputDir, `${baseName}.mp4`);
const metadataPath = path.join(outputDir, `${baseName}.json`);

const defaultPrompt = [
  "Create a cinematic, photorealistic CGI travel brand intro video.",
  "Show a breathtaking medium-wide view of Earth from low Earth orbit, centered and slightly below frame center, with the planet's curvature clearly visible and a deep-space star field in the background.",
  "The Earth should feel close enough to see lush green forests, rich blue oceans, golden deserts, and crisp white cloud cover, while still fully reading as a round globe.",
  "The globe rotates slowly counter-clockwise as the camera performs a gentle dolly push-in and drifts closer over time, creating a sense of discovery.",
  "As the planet rotates, glowing destination pins and location markers appear one by one across multiple continents with elegant warm white and golden light, each with a subtle pulse and soft light-burst reveal.",
  'Reveal the brand title "OurTrips" elegantly over the scene with a refined, premium travel-brand aesthetic.',
  "Style should feel like polished satellite imagery blended with high-end cinematic CGI, clean, aspirational, and premium.",
  "Keep motion smooth, graceful, and realistic, with no visible spacecraft, no UI overlays, no extra text beyond the title, and no cartoon styling.",
].join(" ");

const generationConfig = {
  model: "grok-imagine-video",
  duration: Number(process.env.XAI_VIDEO_DURATION || 10),
  aspect_ratio: process.env.XAI_VIDEO_ASPECT_RATIO || "16:9",
  resolution: process.env.XAI_VIDEO_RESOLUTION || "720p",
  prompt: process.env.XAI_PROMPT || defaultPrompt,
};

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function startGeneration() {
  const response = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(generationConfig),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`xAI start request failed (${response.status}): ${text}`);
  }

  if (!data.request_id) {
    throw new Error(`xAI response did not include request_id: ${text}`);
  }

  return data.request_id;
}

async function pollGeneration(requestId) {
  for (;;) {
    const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`xAI poll request failed (${response.status}): ${text}`);
    }

    const progress = typeof data.progress === "number" ? `${data.progress}%` : "unknown";
    console.log(`Status: ${data.status ?? "unknown"} (${progress})`);

    if (data.status === "done") {
      if (!data.video?.url) {
        throw new Error(`Video completed without a download URL: ${text}`);
      }

      return data;
    }

    if (data.status === "failed" || data.status === "expired") {
      throw new Error(`Video generation ended with status "${data.status}": ${text}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function downloadVideo(videoUrl) {
  const response = await fetch(videoUrl);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Video download failed (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
}

async function writeMetadata(requestId, result) {
  const metadata = {
    request_id: requestId,
    generated_at: new Date().toISOString(),
    output_path: path.relative(process.cwd(), outputPath),
    ...generationConfig,
    result,
  };

  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function main() {
  await ensureOutputDir();

  console.log("Starting xAI video generation...");
  const requestId = await startGeneration();
  console.log(`Request ID: ${requestId}`);

  console.log("Polling for completion...");
  const result = await pollGeneration(requestId);

  console.log("Downloading video...");
  await downloadVideo(result.video.url);
  await writeMetadata(requestId, result);

  console.log(`Saved video to ${path.relative(process.cwd(), outputPath)}`);
  console.log(`Saved metadata to ${path.relative(process.cwd(), metadataPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
