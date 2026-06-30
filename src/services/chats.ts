import { db } from "../db.ts";
import { getMediaJob, type MediaJob } from "./media.ts";
import type { ChatMessage, ChatRole } from "../types.ts";

export interface ChatRecord {
  id: string;
  title: string;
  modelPreset: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord extends ChatMessage {
  id: string;
  chatId: string;
  mediaJobs: MediaJob[];
  createdAt: string;
}

function titleFromMessage(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 54 ? `${clean.slice(0, 51)}...` : clean;
}

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function mediaJobsForMessage(value: string | null | undefined) {
  return safeJsonArray<string>(value)
    .map((id) => {
      try {
        return getMediaJob(id);
      } catch {
        return null;
      }
    })
    .filter((job): job is MediaJob => Boolean(job));
}

export function createChat(modelPreset = "balanced", title = "New chat"): ChatRecord {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO chats (id, title, model_preset) VALUES (?, ?, ?)").run(id, title, modelPreset);
  return getChat(id);
}

export function listChats(limit = 60): ChatRecord[] {
  return db
    .prepare(
      `SELECT id, title, model_preset AS modelPreset, created_at AS createdAt, updated_at AS updatedAt
       FROM chats
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as ChatRecord[];
}

export function getChat(id: string): ChatRecord {
  const chat = db
    .prepare(
      `SELECT id, title, model_preset AS modelPreset, created_at AS createdAt, updated_at AS updatedAt
       FROM chats
       WHERE id = ?`,
    )
    .get(id) as ChatRecord | null;
  if (!chat) throw new Error(`Chat ${id} was not found.`);
  return chat;
}

export function listChatMessages(chatId: string): ChatMessageRecord[] {
  getChat(chatId);
  const rows = db
    .prepare(
      `SELECT id, chat_id AS chatId, role, content, media_job_ids_json AS mediaJobIdsJson, created_at AS createdAt
       FROM messages
       WHERE chat_id = ?
       ORDER BY created_at, rowid`,
    )
    .all(chatId) as Array<Omit<ChatMessageRecord, "mediaJobs"> & { mediaJobIdsJson?: string | null }>;
  return rows.map(({ mediaJobIdsJson, ...row }) => ({ ...row, mediaJobs: mediaJobsForMessage(mediaJobIdsJson) }));
}

export function addChatMessage(chatId: string, role: ChatRole, content: string, mediaJobIds: string[] = []): ChatMessageRecord {
  const chat = getChat(chatId);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO messages (id, chat_id, role, content, media_job_ids_json) VALUES (?, ?, ?, ?, ?)").run(
    id,
    chatId,
    role,
    content,
    JSON.stringify(mediaJobIds),
  );
  if (chat.title === "New chat" && role === "user") {
    db.prepare("UPDATE chats SET title = ?, model_preset = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      titleFromMessage(content),
      chat.modelPreset,
      chatId,
    );
  } else {
    db.prepare("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(chatId);
  }
  const row = db
    .prepare(
      `SELECT id, chat_id AS chatId, role, content, media_job_ids_json AS mediaJobIdsJson, created_at AS createdAt
       FROM messages
       WHERE id = ?`,
    )
    .get(id) as Omit<ChatMessageRecord, "mediaJobs"> & { mediaJobIdsJson?: string | null };
  const { mediaJobIdsJson, ...message } = row;
  return { ...message, mediaJobs: mediaJobsForMessage(mediaJobIdsJson) };
}

export function updateChatModel(chatId: string, modelPreset: string) {
  getChat(chatId);
  db.prepare("UPDATE chats SET model_preset = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(modelPreset, chatId);
  return getChat(chatId);
}

export function deleteChat(chatId: string) {
  getChat(chatId);
  db.prepare("DELETE FROM chats WHERE id = ?").run(chatId);
  return { deleted: true, id: chatId };
}
