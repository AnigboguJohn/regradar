/**
 * Conversation actions shared by the sidebar menu, the Ask page and Settings → Chats.
 * Every change fires CONVERSATIONS_EVENT so each place showing conversations refreshes.
 */
import { api, del, patch, type Citation } from "./api";
import { exportAsPdf, exportAsText } from "./exportChat";

export interface Conversation {
  id: string; title: string; created_at?: string; updated_at?: string;
  pinned_at?: string | null; archived_at?: string | null; message_count?: number;
}
export interface ConversationMessage { id: number | string; conversation_id?: string; question: string; answer: string; citations: Citation[]; mode: string; created_at?: string }

export const CONVERSATIONS_EVENT = "regradar:conversations";
export const notifyConversations = () => window.dispatchEvent(new Event(CONVERSATIONS_EVENT));

export const listConversations = (archived = false) =>
  api<{ conversations: Conversation[] }>(`/conversations${archived ? "?archived=1" : ""}`).then((r) => r.conversations);

export const getConversation = (id: string) =>
  api<{ conversation: Conversation; messages: ConversationMessage[] }>(`/conversations/${id}`);

export async function updateConversation(id: string, b: { title?: string; pinned?: boolean; archived?: boolean }) {
  const r = await patch<{ conversation: Conversation }>(`/conversations/${id}`, b);
  notifyConversations();
  return r.conversation;
}

export async function deleteConversation(id: string) {
  await del(`/conversations/${id}`);
  notifyConversations();
}

export async function exportConversation(id: string, format: "pdf" | "txt") {
  const r = await getConversation(id);
  (format === "pdf" ? exportAsPdf : exportAsText)(r.conversation.title, r.messages);
}
