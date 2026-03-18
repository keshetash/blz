import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './app.css';
import { type Chat, type Message, type User } from './types';
import { authLogin, authLoginPassword, authRegister, authSetPassword } from './api/auth';
import {
  createDirectChat, createGroupChat, getChats, getChatMessages,
  sendChatMessage, markChatRead, deleteMessages as apiDeleteMessages,
} from './api/chats';
import { searchUsers, updateMe } from './api/users';
import { connectSocket, disconnectSocket, getSocket, joinChat, setActiveChat } from './socket/socketClient';
import { getSession, setSession, clearSession } from './storage/session';

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(ts: number) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function chatTitle(chat: Chat, meId: string) {
  if (chat.type === 'group') return chat.name || 'Группа';
  const other = chat.members.find(m => m.id !== meId);
  return other?.display_name || other?.username || 'Диалог';
}
function chatSubtitle(chat: Chat, meId: string) {
  if (chat.type === 'group') return `${chat.members.length} участников`;
  const other = chat.members.find(m => m.id !== meId);
  return other?.username ? `@${other.username}` : '';
}
function avatarLetter(name: string) { return (name || '?').slice(0, 1).toUpperCase(); }

// ── Theme ────────────────────────────────────────────────────────────────────
type Theme = 'dark' | 'light';
function getStoredTheme(): Theme {
  try { return (localStorage.getItem('blizkie.theme') as Theme) || 'dark'; } catch { return 'dark'; }
}
function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('blizkie.theme', t); } catch {}
}

// ── Icons ────────────────────────────────────────────────────────────────────
function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}
function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === 'dark' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

// ── Message status checkmarks ─────────────────────────────────────────────────
function MsgStatus({ isRead }: { isRead: boolean }) {
  return isRead ? (
    // Double checkmark — read (blue)
    <svg className="msgStatus read" width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path d="M1 5.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5L9.5 9L15 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    // Single checkmark — sent (muted)
    <svg className="msgStatus sent" width="12" height="10" viewBox="0 0 12 10" fill="none">
      <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── PasswordInput ─────────────────────────────────────────────────────────────
function PasswordInput({ value, onChange, placeholder, className = 'authInput', wrapClass = 'authInputWrap', eyeClass = 'authEye', onKeyDown }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  className?: string; wrapClass?: string; eyeClass?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={wrapClass}>
      <input type={show ? 'text' : 'password'} className={className} value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder ?? 'Пароль'}
        autoComplete="current-password" onKeyDown={onKeyDown} />
      <button type="button" className={eyeClass} onClick={() => setShow(v => !v)} tabIndex={-1}>
        <EyeIcon visible={show} />
      </button>
    </div>
  );
}

// ── CreateGroupModal ──────────────────────────────────────────────────────────
function CreateGroupModal({ onClose, onCreate, contacts, meId }: {
  onClose: () => void;
  onCreate: (name: string, description: string, memberIds: string[]) => Promise<void>;
  contacts: User[];
  meId: string;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = useMemo(() =>
    contacts.filter(u => u.id !== meId && !selected.some(s => s.id === u.id)),
    [contacts, selected, meId]);

  async function doSearch() {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await searchUsers(query);
      setSearchResults(res.filter(u => u.id !== meId && !selected.some(s => s.id === u.id)));
    } finally { setSearching(false); }
  }
  useEffect(() => { const t = setTimeout(doSearch, 350); return () => clearTimeout(t); }, [query]); // eslint-disable-line

  function toggleUser(u: User) {
    setSelected(prev => prev.some(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);
    setSearchResults(prev => prev.filter(r => r.id !== u.id));
  }

  async function handleCreate() {
    if (!name.trim()) return setError('Введите название группы');
    if (selected.length < 1) return setError('Добавьте хотя бы одного участника');
    setBusy(true); setError(null);
    try { await onCreate(name.trim(), description.trim(), selected.map(u => u.id)); onClose(); }
    catch (e: any) { setError(e?.message ?? 'Ошибка'); }
    finally { setBusy(false); }
  }

  const displayList = query.length >= 2 ? searchResults : suggested;

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard">
        <div className="modalHeader">
          <div className="modalTitle">Новая группа</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modalBody">
          <div className="modalField">
            <label className="modalLabel">Название *</label>
            <input className="modalInput" value={name} onChange={e => setName(e.target.value)} placeholder="Например: Команда разработки" autoFocus maxLength={64} />
          </div>
          <div className="modalField">
            <label className="modalLabel">Описание <span className="modalOptional">(необязательно)</span></label>
            <textarea className="modalTextarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="О чём эта группа…" rows={2} maxLength={256} />
          </div>
          <div className="modalField">
            <label className="modalLabel">Участники</label>
            <div className="modalSearch">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.7"/>
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <input className="modalSearchInput" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по username…" />
              {searching && <span className="modalSearchSpin">…</span>}
            </div>
          </div>
          {selected.length > 0 && (
            <div className="memberChips">
              {selected.map(u => (
                <button key={u.id} className="memberChip" onClick={() => toggleUser(u)}>
                  <div className="memberChipAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                  <span>{u.display_name || u.username}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
          {displayList.length > 0 && (
            <div className="modalUserList">
              <div className="modalListLabel">{query.length >= 2 ? 'Результаты поиска' : 'Из личных чатов'}</div>
              {displayList.map(u => (
                <button key={u.id} className="modalUserItem" onClick={() => toggleUser(u)}>
                  <div className="modalUserAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                  <div className="modalUserInfo">
                    <div className="modalUserName">{u.display_name || u.username}</div>
                    {u.username && <div className="modalUserSub">@{u.username}</div>}
                  </div>
                  <div className="modalUserCheck">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
          {query.length >= 2 && !searching && searchResults.length === 0 && (
            <div className="modalEmpty">Пользователи не найдены</div>
          )}
        </div>
        {error && <div className="modalError">{error}</div>}
        <div className="modalFooter">
          <button className="modalCancelBtn" onClick={onClose}>Отмена</button>
          <button className="modalCreateBtn" onClick={handleCreate} disabled={busy || !name.trim() || selected.length === 0}>
            {busy ? '…' : `Создать${selected.length > 0 ? ` (${selected.length + 1})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DeleteConfirmModal ────────────────────────────────────────────────────────
function DeleteConfirmModal({ count, onConfirm, onCancel, busy }: {
  count: number; onConfirm: () => void; onCancel: () => void; busy: boolean;
}) {
  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmCard">
        <div className="confirmIcon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </div>
        <div className="confirmTitle">Удалить {count === 1 ? 'сообщение' : `${count} сообщения`}?</div>
        <div className="confirmText">
          {count === 1
            ? 'Это сообщение будет удалено для всех участников чата.'
            : `Эти ${count} сообщения будут удалены для всех участников чата.`}
          {' '}Действие нельзя отменить.
        </div>
        <div className="confirmBtns">
          <button className="confirmCancel" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>
            {busy ? '…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const saved = useMemo(() => getSession(), []);
  const [token, setToken] = useState<string | null>(saved?.token ?? null);
  const [me, setMe] = useState<User | null>(saved?.user ?? null);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => { const t = getStoredTheme(); applyTheme(t); return t; });
  const toggleTheme = useCallback(() => {
    setTheme(prev => { const next: Theme = prev === 'dark' ? 'light' : 'dark'; applyTheme(next); return next; });
  }, []);

  // ── Auth ───────────────────────────────────────────────────────────────────
  type AuthTab = 'login' | 'register';
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // ── Profile ────────────────────────────────────────────────────────────────
  const [profileUsername, setProfileUsername] = useState(saved?.user?.username ?? '');
  const [profileName, setProfileName] = useState(saved?.user?.display_name ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showPassSection, setShowPassSection] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  // ── Chats ──────────────────────────────────────────────────────────────────
  type ChatFilter = 'all' | 'groups' | 'direct';
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

  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [userSearchBusy, setUserSearchBusy] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, activeChatId]);

  // ── Selection & delete ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Clear selection when switching chats
  useEffect(() => { setSelectedIds(new Set()); }, [activeChatId]);

  function toggleSelect(msgId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(msgId) ? next.delete(msgId) : next.add(msgId);
      return next;
    });
  }

  async function handleDeleteConfirm() {
    if (!activeChatId || selectedIds.size === 0) return;
    setDeleteBusy(true);
    try {
      const deleted = await apiDeleteMessages(activeChatId, [...selectedIds]);
      setMessages(prev => prev.filter(m => !deleted.includes(m.id)));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    } catch (e: any) { setDataError(e?.message ?? 'Ошибка удаления'); }
    finally { setDeleteBusy(false); }
  }

  // ── Mark as read logic ─────────────────────────────────────────────────────
  const markReadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleMarkRead(chatId: string) {
    if (markReadDebounceRef.current) clearTimeout(markReadDebounceRef.current);
    markReadDebounceRef.current = setTimeout(async () => {
      try {
        const { readAt } = await markChatRead(chatId);
        // clear unread badge locally
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c));
        // update our own last_read_at (reflected in partner_last_read_at on their end via socket)
        void readAt; // readAt used by socket event on partner's side
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
        return prev.map(c => c.id === msg.chat_id ? {
          ...c,
          last_message: msg,
          unread_count: isActive ? 0 : (c.unread_count ?? 0) + 1,
        } : c);
      });
      setMessages(prev => {
        if (!isActive) return prev;
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Auto-mark read if this chat is open
      if (isActive) scheduleMarkRead(msg.chat_id);
    };

    // Partner read our messages — update partner_last_read_at
    const onChatRead = ({ chatId, userId, readAt }: { chatId: string; userId: string; readAt: number }) => {
      if (userId === me?.id) return; // our own read, already handled
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, partner_last_read_at: readAt } : c));
    };

    // Messages deleted by someone
    const onMessagesDeleted = ({ chatId, messageIds }: { chatId: string; messageIds: string[] }) => {
      setMessages(prev => prev.filter(m => !(m.chat_id === chatId && messageIds.includes(m.id))));
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c;
        const lastMsgDeleted = c.last_message && messageIds.includes(c.last_message.id);
        return lastMsgDeleted ? { ...c, last_message: null } : c;
      }));
    };

    const onChatCreated = (chat: Chat) =>
      setChats(prev => prev.some(c => c.id === chat.id) ? prev.map(c => c.id === chat.id ? chat : c) : [chat, ...prev]);
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
    return () => {
      socket.off('new-message', onNewMessage);
      socket.off('chat-read', onChatRead);
      socket.off('messages-deleted', onMessagesDeleted);
      socket.off('chat-created', onChatCreated);
      socket.off('chat-updated', onChatUpdated);
      socket.off('chat-removed', onChatRemoved);
      disconnectSocket();
    };
  }, [token, me]); // eslint-disable-line

  // ── Data loaders ───────────────────────────────────────────────────────────
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
    // Clear unread immediately on open
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, unread_count: 0 } : c));
    return () => { setActiveChat(null); };
  }, [token, activeChatId]); // eslint-disable-line

  // ── Handlers ───────────────────────────────────────────────────────────────
  function applySession(res: { token: string; user: User }) {
    setToken(res.token); setMe(res.user);
    setSession({ token: res.token, user: res.user });
    setProfileUsername(res.user.username ?? '');
    setProfileName(res.user.display_name ?? '');
  }

  async function onLogin() {
    setAuthError(null); setAuthBusy(true);
    try {
      const res = authPassword ? await authLoginPassword(authUsername.trim(), authPassword) : await authLogin(authUsername.trim());
      applySession(res);
    } catch (e: any) { setAuthError(e?.message ?? 'Ошибка входа'); }
    finally { setAuthBusy(false); }
  }

  async function onRegister() {
    setAuthError(null);
    if (!authPassword) return setAuthError('Введите пароль');
    if (authPassword.length < 6) return setAuthError('Пароль: минимум 6 символов');
    if (authPassword !== authPasswordConfirm) return setAuthError('Пароли не совпадают');
    setAuthBusy(true);
    try { applySession(await authRegister(authUsername.trim(), authPassword)); }
    catch (e: any) { setAuthError(e?.message ?? 'Ошибка регистрации'); }
    finally { setAuthBusy(false); }
  }

  async function onSendMessage() {
    if (!activeChatId) return;
    const text = messageText.trim(); if (!text) return;
    setMessageText('');
    try { await sendChatMessage(activeChatId, { text }); }
    catch (e: any) { setDataError(e?.message ?? 'Ошибка отправки'); }
  }

  async function onSaveProfile() {
    setProfileError(null); setProfileBusy(true);
    try {
      const next = await updateMe({ username: profileUsername.trim().toLowerCase() || null, display_name: profileName.trim() || '' });
      setMe(next); if (token) setSession({ token, user: next }); setShowProfile(false);
    } catch (e: any) { setProfileError(e?.message ?? 'Ошибка'); }
    finally { setProfileBusy(false); }
  }

  async function onSavePassword() {
    setPwError(null); setPwOk(false);
    if (pwNew.length < 6) return setPwError('Пароль: минимум 6 символов');
    if (pwNew !== pwConfirm) return setPwError('Пароли не совпадают');
    setPwBusy(true);
    try {
      await authSetPassword(pwNew, me?.has_password ? pwCurrent : undefined);
      setMe(prev => prev ? { ...prev, has_password: true } : prev);
      if (token && me) setSession({ token, user: { ...me, has_password: true } });
      setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwOk(true);
      setTimeout(() => { setPwOk(false); setShowPassSection(false); }, 2000);
    } catch (e: any) { setPwError(e?.message ?? 'Ошибка'); }
    finally { setPwBusy(false); }
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

  function onLogout() {
    clearSession(); setToken(null); setMe(null); setChats([]); setMessages([]);
    setActiveChatId(null); setUserResults([]); setUserSearch(''); setShowProfile(false);
  }

  // ── Auth screen ────────────────────────────────────────────────────────────
  if (!token || !me) {
    const loginReady = authUsername.trim().length >= 3;
    const registerReady = authUsername.trim().length >= 3 && authPassword.length >= 6 && authPassword === authPasswordConfirm;
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      if (authTab === 'login' && loginReady && !authBusy) onLogin();
      if (authTab === 'register' && registerReady && !authBusy) onRegister();
    };
    return (
      <div className="authWrap">
        <button className="authThemeBtn" onClick={toggleTheme}><ThemeIcon theme={theme} /></button>
        <div className="authCard">
          <div className="authLogo">B</div>
          <div className="authTitle">Blizkie</div>
          <div className="authTabs">
            <button className={`authTab${authTab === 'login' ? ' active' : ''}`} onClick={() => { setAuthTab('login'); setAuthError(null); }}>Войти</button>
            <button className={`authTab${authTab === 'register' ? ' active' : ''}`} onClick={() => { setAuthTab('register'); setAuthError(null); }}>Регистрация</button>
          </div>
          {authTab === 'login' && (<>
            <div className="authSub">Введите username чтобы войти или добавьте пароль</div>
            <div className="authLabel">Username</div>
            <input className="authInput" value={authUsername} onChange={e => setAuthUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username" autoCapitalize="none" autoComplete="username" autoFocus onKeyDown={handleKeyDown} />
            <div className="authLabel">Пароль <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(необязательно)</span></div>
            <PasswordInput value={authPassword} onChange={setAuthPassword} placeholder="Пароль (если привязан)" onKeyDown={handleKeyDown} />
            <div className="authHint">Без пароля — вход по username · С паролем — проверка пароля</div>
          </>)}
          {authTab === 'register' && (<>
            <div className="authSub">Создайте новый аккаунт с паролем</div>
            <div className="authLabel">Username</div>
            <input className="authInput" value={authUsername} onChange={e => setAuthUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username" autoCapitalize="none" autoComplete="username" autoFocus onKeyDown={handleKeyDown} />
            <div className="authLabel">Пароль</div>
            <PasswordInput value={authPassword} onChange={setAuthPassword} placeholder="Минимум 6 символов" onKeyDown={handleKeyDown} />
            <div className="authLabel">Повторите пароль</div>
            <PasswordInput value={authPasswordConfirm} onChange={setAuthPasswordConfirm} placeholder="Повторите пароль" onKeyDown={handleKeyDown} />
            <div className="authHint">Только латиница, цифры и _ · Минимум 3 символа</div>
          </>)}
          {authError && <div className="authError">{authError}</div>}
          <button className="authBtn" disabled={authTab === 'login' ? (!loginReady || authBusy) : (!registerReady || authBusy)} onClick={authTab === 'login' ? onLogin : onRegister}>
            {authBusy ? '…' : authTab === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </div>
      </div>
    );
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  const partnerReadAt = activeChat?.partner_last_read_at ?? 0;
  const hasSelection = selectedIds.size > 0;

  return (
    <>
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreate={onCreateGroup} contacts={contacts} meId={me.id} />}
      {showDeleteConfirm && (
        <DeleteConfirmModal count={selectedIds.size} onConfirm={handleDeleteConfirm} onCancel={() => setShowDeleteConfirm(false)} busy={deleteBusy} />
      )}

      <div className={`layout${hasSelection ? ' selecting' : ''}`}>
        <aside className="sidebar">
          <div className="sidebarSearch">
            <div className="searchRow">
              <svg className="searchIcon" viewBox="0 0 20 20" fill="none">
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              <input className="searchInput" value={userSearch} onChange={e => setUserSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSearchUsers()} placeholder="Поиск пользователей…" />
              {userSearch.trim().length >= 2 && (
                <button className="searchBtn" onClick={onSearchUsers} disabled={userSearchBusy}>
                  {userSearchBusy ? '…' : 'Найти'}
                </button>
              )}
            </div>
            {userSearchError && <div className="searchError">{userSearchError}</div>}
            {userResults.length > 0 && (
              <div className="searchResults">
                {userResults.map(u => (
                  <button key={u.id} className="srItem" onClick={() => onStartChat(u)}>
                    <div className="srAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                    <div>
                      <div className="srName">{u.display_name || u.username || u.id}</div>
                      {u.username && <div className="srSub">@{u.username}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="folderTabs">
            {(['all', 'direct', 'groups'] as const).map(f => (
              <button key={f} className={`folderTab${chatFilter === f ? ' active' : ''}`} onClick={() => setChatFilter(f)}>
                {f === 'all' ? 'Общее' : f === 'direct' ? 'Личные' : 'Группы'}
              </button>
            ))}
            <button className="newGroupBtn" onClick={() => setShowCreateGroup(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>Группа</span>
            </button>
          </div>

          <div className="chatList">
            {dataError && <div className="listErr">{dataError}</div>}
            {loadingChats && <div className="listHint">Загрузка…</div>}
            {!loadingChats && filteredChats.length === 0 && (
              <div className="listHint">
                {chatFilter === 'groups' ? 'Нет групп' : chatFilter === 'direct' ? 'Нет личных чатов' : 'Найдите пользователя выше чтобы начать диалог'}
              </div>
            )}
            {filteredChats.map(c => {
              const title = chatTitle(c, me.id);
              return (
                <button key={c.id} className={`chatItem${c.id === activeChatId ? ' active' : ''}`} onClick={() => setActiveChatId(c.id)}>
                  <div className={`ciAvatar${c.type === 'group' ? ' group' : ''}`}>{avatarLetter(title)}</div>
                  <div className="ciBody">
                    <div className="ciTop">
                      <span className="ciName">{title}</span>
                      {c.last_message && <span className="ciTime">{formatTime(c.last_message.created_at)}</span>}
                    </div>
                    <div className="ciBottom">
                      <span className="ciPreview">{c.last_message?.text || (c.last_message ? 'Вложение' : 'Нет сообщений')}</span>
                      {typeof c.unread_count === 'number' && c.unread_count > 0 && (
                        <span className="ciBadge">{c.unread_count}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="sidebarBottom">
            {showProfile && (
              <div className="profilePanel">
                <div className="ppSection">
                  <div className="ppTitle">Профиль</div>
                  <input className="ppInput" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Имя" />
                  <input className="ppInput" value={profileUsername} onChange={e => setProfileUsername(e.target.value)} placeholder="Username" />
                  {profileError && <div className="ppErr">{profileError}</div>}
                  <button className="ppSave" onClick={onSaveProfile} disabled={profileBusy}>{profileBusy ? '…' : 'Сохранить профиль'}</button>
                </div>
                <hr className="ppDivider" />
                <div className="ppSection">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="ppTitle">Пароль</div>
                    <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>{me.has_password ? '✓ Установлен' : '✗ Не задан'}</span>
                  </div>
                  {!showPassSection ? (
                    <button className="ppSecBtn" onClick={() => { setShowPassSection(true); setPwError(null); setPwOk(false); }}>
                      {me.has_password ? 'Сменить пароль' : 'Добавить пароль'}
                    </button>
                  ) : (<>
                    {me.has_password && <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder="Текущий пароль" className="ppInput" wrapClass="ppInputWrap" eyeClass="ppEye" />}
                    <PasswordInput value={pwNew} onChange={setPwNew} placeholder="Новый пароль (мин. 6 символов)" className="ppInput" wrapClass="ppInputWrap" eyeClass="ppEye" />
                    <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Повторите новый пароль" className="ppInput" wrapClass="ppInputWrap" eyeClass="ppEye" />
                    {pwError && <div className="ppErr">{pwError}</div>}
                    {pwOk && <div className="ppOk">Пароль успешно обновлён ✓</div>}
                    <div className="ppRow">
                      <button className="ppSave" onClick={onSavePassword} disabled={pwBusy}>{pwBusy ? '…' : 'Сохранить пароль'}</button>
                      <button className="ppSecBtn" onClick={() => { setShowPassSection(false); setPwError(null); }}>Отмена</button>
                    </div>
                  </>)}
                </div>
                <hr className="ppDivider" />
                <button className="ppLogout" onClick={onLogout}>Выйти из аккаунта</button>
              </div>
            )}
            <div className="sidebarBottomRow">
              <button className="meBtn" onClick={() => { setShowProfile(v => !v); setShowPassSection(false); }}>
                <div className="meAvatar">{avatarLetter(me.display_name || me.username || '')}</div>
                <div className="meInfo">
                  <div className="meName">{me.display_name || me.username || 'Пользователь'}</div>
                  <div className="meSub">@{me.username || ''}</div>
                </div>
              </button>
              <button className="themeToggle" onClick={toggleTheme} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
                <ThemeIcon theme={theme} />
              </button>
            </div>
          </div>
        </aside>

        <main className="chatArea">
          {activeChat ? (<>
            {/* Chat header — shows delete toolbar when messages selected */}
            <div className="chatHeader">
              {hasSelection ? (
                <>
                  <button className="selCancelBtn" onClick={() => setSelectedIds(new Set())}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                  <div className="selInfo">
                    <span className="selCount">{selectedIds.size}</span>
                    <span className="selLabel">{selectedIds.size === 1 ? 'сообщение выбрано' : 'сообщения выбраны'}</span>
                  </div>
                  <button className="selDeleteBtn" onClick={() => setShowDeleteConfirm(true)}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    Удалить
                  </button>
                </>
              ) : (
                <>
                  <div className={`chAvatar${activeChat.type === 'group' ? ' group' : ''}`}>
                    {avatarLetter(chatTitle(activeChat, me.id))}
                  </div>
                  <div>
                    <div className="chName">{chatTitle(activeChat, me.id)}</div>
                    <div className="chSub">{chatSubtitle(activeChat, me.id)}</div>
                  </div>
                </>
              )}
            </div>

            {/* Messages */}
            <div className="messages" onClick={() => hasSelection && setSelectedIds(new Set())}>
              {loadingMessages && <div className="msgHint">Загрузка…</div>}
              {messages.map(m => {
                const isOwn = m.sender_id === me.id;
                const isRead = isOwn && partnerReadAt >= m.created_at;
                const isSelected = selectedIds.has(m.id);
                return (
                  <div
                    key={m.id}
                    className={`msg ${isOwn ? 'out' : 'in'}${isSelected ? ' selected' : ''}`}
                    onContextMenu={e => {
                      if (!isOwn) return;
                      e.preventDefault();
                      toggleSelect(m.id);
                    }}
                    onClick={e => {
                      if (!isOwn || !hasSelection) return;
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }}
                  >
                    <div className="bubble">
                      {isSelected && (
                        <div className="msgCheckmark">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                          </svg>
                        </div>
                      )}
                      <div className="bubbleText">{m.text}</div>
                      <div className="bubbleMeta">
                        <span className="bubbleTime">{formatTime(m.created_at)}</span>
                        {isOwn && <MsgStatus isRead={isRead} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="composer">
              <input className="composerInput" value={messageText} onChange={e => setMessageText(e.target.value)}
                placeholder="Сообщение…"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }} />
              <button className="composerSend" onClick={onSendMessage} disabled={!messageText.trim()}>
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </>) : (
            <div className="emptyState">
              <div className="emptyLogo">B</div>
              <div className="emptyTitle">Blizkie</div>
              <div className="emptySub">Выберите чат или найдите пользователя</div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
