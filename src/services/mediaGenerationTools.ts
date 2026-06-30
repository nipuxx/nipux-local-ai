import { generateImage, generateSpeech, generateVideo, MediaUnavailableError, type MediaJob } from "./media.ts";

export type MediaGenerationToolName = "image_generation" | "speech_generation" | "video_generation";
export type MediaGenerationToolStatus = "ok" | "error";

export interface MediaGenerationToolEvent {
  tool: MediaGenerationToolName;
  status: MediaGenerationToolStatus;
  summary: string;
  mediaJobId?: string;
  error?: string;
}

export interface MediaGenerationToolRun {
  mediaJobs: MediaJob[];
  events: MediaGenerationToolEvent[];
  contextBlock: string;
}

function shouldGenerateImage(input: string) {
  return (
    /\b(generate|create|make|draw|render|produce)\b.{0,80}\b(image|picture|photo|illustration|art|poster|logo|visual)\b/i.test(input) ||
    /\b(image|picture|photo|illustration|art|poster|logo|visual)\b.{0,80}\b(generate|create|make|draw|render|produce)\b/i.test(input)
  );
}

function shouldGenerateVideo(input: string) {
  return (
    /\b(generate|create|make|render|produce)\b.{0,80}\b(video|clip|animation|movie)\b/i.test(input) ||
    /\b(video|clip|animation|movie)\b.{0,80}\b(generate|create|make|render|produce)\b/i.test(input)
  );
}

function shouldGenerateSpeech(input: string) {
  return (
    /\b(text[-\s]?to[-\s]?speech|tts|say this|voiceover|narration|spoken audio)\b/i.test(input) ||
    /\bread(?:\s+(?:this|it|that|the answer))?\s+aloud\b/i.test(input) ||
    /\b(generate|create|make|render|produce)\b.{0,80}\b(speech|voiceover|voice clip|audio narration|spoken audio)\b/i.test(input) ||
    /\b(speech|voiceover|voice clip|audio narration|spoken audio)\b.{0,80}\b(generate|create|make|render|produce)\b/i.test(input)
  );
}

function mediaPromptFromInput(input: string, words: string[]) {
  const quoted = input.match(/["“](.+?)["”]/)?.[1]?.trim();
  if (quoted) return quoted;
  const mediaWords = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const cleanup = new RegExp(`\\b(please|can you|could you|generate|create|make|draw|render|produce|an?|${mediaWords})\\b`, "gi");
  return input.replace(cleanup, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900) || input.slice(0, 900);
}

function imagePromptFromInput(input: string) {
  return mediaPromptFromInput(input, ["image", "picture", "photo", "illustration", "art", "poster", "logo", "visual"]);
}

function videoPromptFromInput(input: string) {
  return mediaPromptFromInput(input, ["video", "clip", "animation", "movie"]);
}

function speechPromptFromInput(input: string) {
  const quoted = input.match(/["“](.+?)["”]/)?.[1]?.trim();
  if (quoted) return quoted;
  const prefixed = input.match(
    /\b(?:read(?:\s+(?:this|it|that|the answer))?\s+aloud|say this|text[-\s]?to[-\s]?speech|tts|voiceover|narration)\s*[:,-]?\s*(.+)$/i,
  )?.[1]?.trim();
  if (prefixed) return prefixed.slice(0, 1800);
  return input
    .replace(
      /\b(please|can you|could you|generate|create|make|render|produce|an?|text[-\s]?to[-\s]?speech|tts|read|say|aloud|speech|voiceover|voice clip|audio narration|spoken audio|narration)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/^\s*[:,-]\s*/, "")
    .trim()
    .slice(0, 1800) || input.slice(0, 1800);
}

function formatMediaJobs(jobs: MediaJob[]) {
  if (!jobs.length) return "Media jobs: none requested";
  return `Media jobs:\n${jobs
    .map((job, index) => `${index + 1}. ${job.kind} (${job.id})\nstatus=${job.status}${job.error ? ` error=${job.error}` : ""}`)
    .join("\n")}`;
}

export function formatMediaGenerationToolEvents(events: MediaGenerationToolEvent[]) {
  if (!events.length) return "";
  return `Tool activity:\n${events
    .map((event) => {
      const details = [
        event.mediaJobId ? `job=${event.mediaJobId}` : "",
        event.error ? `error=${event.error}` : "",
      ].filter(Boolean);
      const suffix = details.length ? ` ${details.join(" ")}` : "";
      return `- ${event.tool} ${event.status}: ${event.summary}${suffix}`;
    })
    .join("\n")}`;
}

export async function runMediaGenerationTools(input: string): Promise<MediaGenerationToolRun> {
  const mediaJobs: MediaJob[] = [];
  const events: MediaGenerationToolEvent[] = [];

  if (shouldGenerateImage(input)) {
    const prompt = imagePromptFromInput(input);
    try {
      const result = await generateImage({ prompt, size: "1024x1024", n: 1, response_format: "b64_json" });
      mediaJobs.push(result.job);
      events.push({
        tool: "image_generation",
        status: "ok",
        mediaJobId: result.job.id,
        summary: `Created local image job ${result.job.id}.`,
      });
    } catch (error) {
      if (error instanceof MediaUnavailableError) {
        mediaJobs.push(error.job);
        events.push({
          tool: "image_generation",
          status: "error",
          mediaJobId: error.job.id,
          summary: "Local image generation is not ready.",
          error: error.message,
        });
      } else {
        events.push({
          tool: "image_generation",
          status: "error",
          summary: "Local image generation failed.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (shouldGenerateSpeech(input)) {
    const text = speechPromptFromInput(input);
    try {
      const result = await generateSpeech({ input: text, voice: "alloy", model: "local-speech", response_format: "mp3" });
      mediaJobs.push(result.job);
      events.push({
        tool: "speech_generation",
        status: "ok",
        mediaJobId: result.job.id,
        summary: `Created local speech job ${result.job.id}.`,
      });
    } catch (error) {
      if (error instanceof MediaUnavailableError) {
        mediaJobs.push(error.job);
        events.push({
          tool: "speech_generation",
          status: "error",
          mediaJobId: error.job.id,
          summary: "Local speech generation is not ready.",
          error: error.message,
        });
      } else {
        events.push({
          tool: "speech_generation",
          status: "error",
          summary: "Local speech generation failed.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (shouldGenerateVideo(input)) {
    const prompt = videoPromptFromInput(input);
    try {
      const result = await generateVideo({ prompt, seconds: 4, width: 1024, height: 576, model: "local-video" });
      mediaJobs.push(result.job);
      events.push({
        tool: "video_generation",
        status: "ok",
        mediaJobId: result.job.id,
        summary: `Created local video job ${result.job.id}.`,
      });
    } catch (error) {
      if (error instanceof MediaUnavailableError) {
        mediaJobs.push(error.job);
        events.push({
          tool: "video_generation",
          status: "error",
          mediaJobId: error.job.id,
          summary: "Local video generation is not ready.",
          error: error.message,
        });
      } else {
        events.push({
          tool: "video_generation",
          status: "error",
          summary: "Local video generation failed.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const contextParts = [
    formatMediaGenerationToolEvents(events) || "Tool activity: none requested",
    formatMediaJobs(mediaJobs),
  ];

  return { mediaJobs, events, contextBlock: contextParts.join("\n\n") };
}
