import client from './client';
import { type Chat, type Message } from '../types';

export async function getChats(): Promise<Chat[]> {
  const res = await client.get<Chat[]>('/chats');
  return res.data;
}

export async function createDirectChat(userId: string): Promise<Chat> {
  if (!userId) throw new Error('userId is required');
  const res = await client.post<Chat>('/chats', { userId });
  return res.data;
}

export async function createGroupChat(payload: {
  name: string;
  memberIds: string[];
  description?: string;
}): Promise<Chat> {
  const res = await client.post<Chat>('/chats/group', payload);
  return res.data;
}

export async function getChatMessages(chatId: string): Promise<Message[]> {
  const res = await client.get<Message[]>(`/chats/${chatId}/messages`);
  return res.data;
}

export async function sendChatMessage(
  chatId: string,
  payload: { text?: string; attachment_url?: string; attachment_type?: string; attachment_name?: string },
): Promise<Message> {
  const res = await client.post<Message>(`/chats/${chatId}/messages`, payload);
  return res.data;
}

export async function markChatRead(chatId: string): Promise<{ readAt: number }> {
  const res = await client.post<{ ok: boolean; readAt: number }>(`/chats/${chatId}/read`);
  return res.data;
}

export async function deleteMessages(chatId: string, messageIds: string[]): Promise<string[]> {
  const res = await client.delete<{ ok: boolean; deleted: string[] }>(`/chats/${chatId}/messages`, {
    data: { messageIds },
  });
  return res.data.deleted;
}
