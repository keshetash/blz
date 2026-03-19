import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './app.css';
import { type Chat, type Message, type User } from './types';
import { deleteAccount as apiDeleteAccount } from './api/auth';
import {
  createDirectChat, createGroupChat, getChats, getChatMessages,
  sendChatMessage, markChatRead, deleteMessages as apiDeleteMessages,
  leaveGroup as apiLeaveGroup, deleteDirectChat as apiDeleteDirectChat,
  removeGroupMember as apiRemoveGroupMember,
  updateGroupChat as apiUpdateGroupChat,
} from './api/chats';
import { searchUsers } from './api/users';
import { connectSocket, disconnectSocket, getSocket, joinChat, setActiveChat } from './socket/socketClient';
import { getSession, setSession, clearSession } from './storage/session';
import { type Theme, getStoredTheme, applyTheme } from './utils/theme';

// Components
import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { UserProfileModal } from './components/modals/UserProfileModal';
import { GroupInfoModal } from './components/modals/GroupInfoModal';
import { ProfileSettingsModal } from './components/modals/ProfileSettingsModal';
import { CreateGroupModal } from './components/modals/CreateGroupModal';
import {
  DeleteConfirmModal,
  ChatActionConfirmModal,
  ChatContextMenu,
} from './components/modals/ConfirmModals';

type ChatFilter = 'all' | 'groups' | 'direct';

export default function App() {
  // ── Session ────────────────────────────────────────────────────────────────
  const saved = useMemo(() => getSession(), []);
  const [token, setToken] = useState<string | null>(saved?.token ?? null);
  const [me, setMe] = useState<User | null>(saved?.user ?? null);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => { const t = getStoredTheme(); applyTheme(t); return t; });
  const toggleTheme = useCallback(() => {
    setTheme(prev => { const next: Theme = prev === 'dark' ? 'light' : 'dark'; applyTheme(next); return next; });
  }, []);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showProfile, setShowProfile] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [chatCtxMenu, setChatCtxMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [chatActionConfirm, setChatActionConfirm] = useState<Chat | null>(null);
  const [chatActionBusy, setChatActionBusy] = useState(false);

  // ── Chats ──────────────────────────────────────────────────────────────────
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId) ?? null, [chats, activeChatId]);
  const filteredChats = useMemo(() => {
    if (chatFilter === 'groups') return chats.filter(c => c.type === 'group');
    if (chatFilter === 'direct') return chats.filter(c => c.type === 'direct');
    return chats;
  }, [chats, chatFilter]);
  const contacts = useMemo(() => {
    const seen = new Set<string>();
    const list: User[] = [];
    for (const c of chats) {
      if (c.type !== 'direct') continue;
      const other = c.members.find(m => m.id !== me?.id);
      if (other && !seen.has(other.id)) { seen.add(other.id); list.push(other); }
    }
    return list;
  }, [chats, me]);

  // ── Messages ───────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  useEffect(() => { setSelectedIds(new Set()); }, [activeChatId]);
  const hasSelection = selectedIds.size > 0;

  // ── User search ────────────────────────────────────────────────────────────
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [userSearchBusy, setUserSearchBusy] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  // ── Mark read debounce ─────────────────────────────────────────────────────
  const markReadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleMarkRead(chatId: string) {
    if (markReadDebounceRef.current) clearTimeout(markReadDebounceRef.current);
    markReadDebounceRef.current = setTimeout(async () => {
      try {
        const { readAt } = await markChatRead(chatId);
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c));
        void readAt;
      } catch {}
    }, 300);
  }

  // ── Socket ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    const socket = getSocket();
    if (!socket) return;

    const onNewMessage = (msg: Message) => {
      const isActive = msg.chat_id === activeChatIdRef.current;
      setChats(prev => {
        if (!prev.some(c => c.id === msg.chat_id)) { refreshChats(); return prev; }
        return prev.map(c => c.id === msg.chat_id ? { ...c, last_message: msg, unread_count: isActive ? 0 : (c.unread_count ?? 0) + 1 } : c);
      });
      setMessages(prev => {
        if (!isActive) return prev;
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (isActive) scheduleMarkRead(msg.chat_id);
    };
    const onChatRead = ({ chatId, userId, readAt }: { chatId: string; userId: string; readAt: number }) => {
      if (userId === me?.id) return;
      setChats(prev => prev.map(c => c.id !== chatId ? c : { ...c, partner_last_read_at: Math.max(c.partner_last_read_at ?? 0, readAt) }));
    };
    const onMessagesDeleted = ({ chatId, messageIds }: { chatId: string; messageIds: string[] }) => {
      setMessages(prev => prev.filter(m => !(m.chat_id === chatId && messageIds.includes(m.id))));
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c;
        return c.last_message && messageIds.includes(c.last_message.id) ? { ...c, last_message: null } : c;
      }));
    };
    const onChatCreated = (chat: Chat) => setChats(prev => prev.some(c => c.id === chat.id) ? prev.map(c => c.id === chat.id ? chat : c) : [chat, ...prev]);
    const onChatUpdated = (chat: Chat) => setChats(prev => prev.map(c => c.id === chat.id ? chat : c));
    const onChatRemoved = ({ chatId }: { chatId: string }) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      setActiveChatId(prev => prev === chatId ? null : prev);
      if (activeChatIdRef.current === chatId) setMessages([]);
    };

    socket.on('new-message', onNewMessage);
    socket.on('chat-read', onChatRead);
    socket.on('messages-deleted', onMessagesDeleted);
    socket.on('chat-created', onChatCreated);
    socket.on('chat-updated', onChatUpdated);
    socket.on('chat-removed', onChatRemoved);
    socket.on('account-deleted', onLogout);
    return () => {
      socket.off('new-message', onNewMessage); socket.off('chat-read', onChatRead);
      socket.off('messages-deleted', onMessagesDeleted); socket.off('chat-created', onChatCreated);
      socket.off('chat-updated', onChatUpdated); socket.off('chat-removed', onChatRemoved);
      socket.off('account-deleted', onLogout);
      disconnectSocket();
    };
  }, [token, me]); // eslint-disable-line

  // ── Data loading ───────────────────────────────────────────────────────────
  async function refreshChats() {
    if (!token) return;
    setLoadingChats(true); setDataError(null);
    try {
      const list = await getChats();
      setChats(list);
      if (!activeChatIdRef.current && list.length) setActiveChatId(list[0].id);
    } catch (e: any) { setDataError(e?.message ?? 'Не удалось загрузить чаты'); }
    finally { setLoadingChats(false); }
  }
  useEffect(() => { if (token) refreshChats(); }, [token]); // eslint-disable-line

  useEffect(() => {
    if (!token || !activeChatId) return;
    setLoadingMessages(true); setDataError(null);
    joinChat(activeChatId); setActiveChat(activeChatId);
    getChatMessages(activeChatId)
      .then(msgs => { setMessages(msgs); scheduleMarkRead(activeChatId); })
      .catch((e: any) => setDataError(e?.message ?? 'Ошибка загрузки'))
      .finally(() => setLoadingMessages(false));
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, unread_count: 0 } : c));
    return () => { setActiveChat(null); };
  }, [token, activeChatId]); // eslint-disable-line

  // ── Handlers ───────────────────────────────────────────────────────────────
  function onUpdateMe(next: User) {
    setMe(next);
    if (token) setSession({ token, user: next });
  }

  async function onSearchUsers() {
    if (userSearch.trim().length < 2) return;
    setUserSearchError(null); setUserSearchBusy(true);
    try { setUserResults(await searchUsers(userSearch)); }
    catch (e: any) { setUserSearchError(e?.message ?? 'Ошибка поиска'); }
    finally { setUserSearchBusy(false); }
  }

  async function onStartChat(u: User) {
    setDataError(null);
    try {
      const chat = await createDirectChat(u.id);
      setChats(prev => prev.some(c => c.id === chat.id) ? prev.map(c => c.id === chat.id ? chat : c) : [chat, ...prev]);
      setActiveChatId(chat.id); setUserResults([]); setUserSearch('');
    } catch (e: any) { setDataError(e?.message ?? 'Ошибка'); }
  }

  async function onCreateGroup(name: string, description: string, memberIds: string[]) {
    const chat = await createGroupChat({ name, description: description || undefined, memberIds });
    setChats(prev => prev.some(c => c.id === chat.id) ? prev : [chat, ...prev]);
    setActiveChatId(chat.id); setChatFilter('all');
  }

  async function onSendMessage() {
    if (!activeChatId) return;
    const text = messageText.trim(); if (!text) return;
    setMessageText('');
    try { await sendChatMessage(activeChatId, { text }); }
    catch (e: any) { setDataError(e?.message ?? 'Ошибка отправки'); }
  }

  function toggleSelect(msgId: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(msgId) ? next.delete(msgId) : next.add(msgId); return next; });
  }

  async function handleDeleteConfirm() {
    if (!activeChatId || selectedIds.size === 0) return;
    setDeleteBusy(true);
    try {
      const deleted = await apiDeleteMessages(activeChatId, [...selectedIds]);
      setMessages(prev => prev.filter(m => !deleted.includes(m.id)));
      setSelectedIds(new Set()); setShowDeleteConfirm(false);
    } catch (e: any) { setDataError(e?.message ?? 'Ошибка удаления'); }
    finally { setDeleteBusy(false); }
  }

  async function onConfirmChatAction() {
    if (!chatActionConfirm) return;
    setChatActionBusy(true);
    try {
      if (chatActionConfirm.type === 'group') await apiLeaveGroup(chatActionConfirm.id);
      else await apiDeleteDirectChat(chatActionConfirm.id);
      setChats(prev => prev.filter(c => c.id !== chatActionConfirm.id));
      if (activeChatId === chatActionConfirm.id) { setActiveChatId(null); setMessages([]); }
      setChatActionConfirm(null);
    } catch (e: any) { setDataError(e?.message ?? 'Ошибка'); }
    finally { setChatActionBusy(false); }
  }

  function onLogout() {
    clearSession(); setToken(null); setMe(null); setChats([]); setMessages([]);
    setActiveChatId(null); setUserResults([]); setUserSearch(''); setShowProfile(false);
  }

  async function onDeleteAccount() {
    await apiDeleteAccount();
    onLogout();
  }

  // ── Auth screen ────────────────────────────────────────────────────────────
  if (!token || !me) {
    return (
      <AuthScreen
        theme={theme}
        onThemeToggle={toggleTheme}
        onAuthenticated={(t, u) => { setToken(t); setMe(u); }}
      />
    );
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  const partnerReadAt = activeChat?.partner_last_read_at ?? 0;

  return (
    <>
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreate={onCreateGroup} contacts={contacts} meId={me.id} />}
      {showDeleteConfirm && <DeleteConfirmModal count={selectedIds.size} onConfirm={handleDeleteConfirm} onCancel={() => setShowDeleteConfirm(false)} busy={deleteBusy} />}
      {showProfileSettings && <ProfileSettingsModal me={me} token={token} onClose={() => setShowProfileSettings(false)} onUpdate={onUpdateMe} onDeleteAccount={onDeleteAccount} />}
      {viewUserId && (
        <UserProfileModal
          userId={viewUserId}
          onClose={() => setViewUserId(null)}
          onStartChat={viewUserId !== me.id ? onStartChat : undefined}
        />
      )}
      {showGroupInfo && activeChat && (
        <GroupInfoModal
          chat={activeChat}
          onClose={() => setShowGroupInfo(false)}
          onViewUser={id => { setShowGroupInfo(false); setViewUserId(id); }}
          meId={me.id}
          onUpdateChat={async (name, description) => {
            const updated = await apiUpdateGroupChat(activeChat.id, { name, description });
            setChats(prev => prev.map(c => c.id === updated.id ? updated : c));
          }}
          onRemoveMember={async (userId) => { await apiRemoveGroupMember(activeChat.id, userId); }}
        />
      )}
      {chatCtxMenu && (
        <ChatContextMenu
          x={chatCtxMenu.x} y={chatCtxMenu.y} chat={chatCtxMenu.chat}
          onClose={() => setChatCtxMenu(null)}
          onDelete={() => setChatActionConfirm(chatCtxMenu.chat)}
          onLeave={() => setChatActionConfirm(chatCtxMenu.chat)}
        />
      )}
      {chatActionConfirm && (
        <ChatActionConfirmModal
          chat={chatActionConfirm}
          onConfirm={onConfirmChatAction}
          onCancel={() => setChatActionConfirm(null)}
          busy={chatActionBusy}
        />
      )}

      <div className={`layout${hasSelection ? ' selecting' : ''}`}>
        <Sidebar
          me={me}
          theme={theme}
          chats={chats}
          filteredChats={filteredChats}
          activeChatId={activeChatId}
          chatFilter={chatFilter}
          loadingChats={loadingChats}
          dataError={dataError}
          userSearch={userSearch}
          userResults={userResults}
          userSearchBusy={userSearchBusy}
          userSearchError={userSearchError}
          showProfile={showProfile}
          onUserSearchChange={setUserSearch}
          onSearchUsers={onSearchUsers}
          onStartChat={onStartChat}
          onFilterChange={f => { setChatFilter(f); }}
          onNewGroup={() => setShowCreateGroup(true)}
          onSelectChat={id => setActiveChatId(id)}
          onChatContextMenu={(e, chat) => setChatCtxMenu({ x: e.clientX, y: e.clientY, chat })}
          onToggleProfile={() => setShowProfile(v => !v)}
          onOpenSettings={() => { setShowProfileSettings(true); setShowProfile(false); }}
          onLogout={onLogout}
          onThemeToggle={toggleTheme}
        />
        <main className="chatArea">
          <ChatArea
            activeChat={activeChat}
            meId={me.id}
            messages={messages}
            messageText={messageText}
            loadingMessages={loadingMessages}
            partnerReadAt={partnerReadAt}
            selectedIds={selectedIds}
            hasSelection={hasSelection}
            onMessageTextChange={setMessageText}
            onSendMessage={onSendMessage}
            onToggleSelect={toggleSelect}
            onClearSelection={() => setSelectedIds(new Set())}
            onDeleteSelected={() => setShowDeleteConfirm(true)}
            onOpenGroupInfo={() => setShowGroupInfo(true)}
            onViewUser={id => setViewUserId(id)}
          />
        </main>
      </div>
    </>
  );
}
