import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './app.css';
import { type Chat, type Message, type User } from './types';
import { authLogin, authLoginPassword, authRegister, authSetPassword } from './api/auth';
import {
  createDirectChat, createGroupChat, getChats, getChatMessages,
  sendChatMessage, markChatRead, deleteMessages as apiDeleteMessages,
  leaveGroup as apiLeaveGroup, deleteDirectChat as apiDeleteDirectChat,
  addGroupMember as apiAddGroupMember,
  removeGroupMember as apiRemoveGroupMember,
  updateGroupChat as apiUpdateGroupChat,
} from './api/chats';
import { searchUsers, updateMe, getUserById } from './api/users';
import { connectSocket, disconnectSocket, getSocket, joinChat, setActiveChat } from './socket/socketClient';
import { getSession, setSession, clearSession } from './storage/session';
import { API_BASE_URL } from './config';

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
    <svg className="msgStatus read" width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path d="M1 5.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5L9.5 9L15 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    <svg className="msgStatus sent" width="12" height="10" viewBox="0 0 12 10" fill="none">
      <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Avatar component ──────────────────────────────────────────────────────────
function resolveUrl(url?: string | null): string | null {
  if (!url) return null;
  // Relative paths from local disk storage → prefix with backend URL
  if (url.startsWith('/uploads/')) return `${API_BASE_URL}${url}`;
  return url;
}

function Avatar({ user, size = 36, radius = 11 }: { user?: User | null; size?: number; radius?: number }) {
  const src = resolveUrl(user?.avatar_url);
  if (src) {
    return (
      <img
        src={src}
        alt={user?.display_name || user?.username || ''}
        style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0, display: 'block' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  const name = user?.display_name || user?.username || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: 'var(--accent-dim)', color: 'var(--accent)',
      display: 'grid', placeItems: 'center',
      fontWeight: 700, fontSize: Math.round(size * 0.42),
      flexShrink: 0,
    }}>
      {avatarLetter(name)}
    </div>
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

// ── UserProfileModal ──────────────────────────────────────────────────────────
function UserProfileModal({ userId, onClose, onStartChat }: {
  userId: string;
  onClose: () => void;
  onStartChat?: (u: User) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getUserById(userId).then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [userId]);

  function formatBirthDate(d: string) {
    try {
      const parts = d.split('-');
      if (parts.length === 3) {
        const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
        return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
      }
      return d;
    } catch { return d; }
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profileViewCard">
        <button className="pvCloseBtn" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        {loading ? (
          <div className="pvLoading">Загрузка…</div>
        ) : !user ? (
          <div className="pvLoading">Пользователь не найден</div>
        ) : (<>
          <div className="pvHeader">
            <div className="pvAvatarWrap">
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="pvAvatarImg" />
                : <div className="pvAvatarFallback">{avatarLetter(user.display_name || user.username || '')}</div>
              }
            </div>
            <div className="pvName">{user.display_name || user.username}</div>
            {user.username && <div className="pvUsername">@{user.username}</div>}
          </div>
          <div className="pvBody">
            {user.bio && (
              <div className="pvField">
                <div className="pvFieldLabel">О себе</div>
                <div className="pvFieldValue">{user.bio}</div>
              </div>
            )}
            {user.birth_date && (
              <div className="pvField">
                <div className="pvFieldLabel">Дата рождения</div>
                <div className="pvFieldValue">{formatBirthDate(user.birth_date)}</div>
              </div>
            )}
            {!user.bio && !user.birth_date && (
              <div className="pvEmpty">Профиль пуст</div>
            )}
          </div>
          {onStartChat && (
            <div className="pvFooter">
              <button className="pvChatBtn" onClick={() => { onStartChat(user); onClose(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Написать сообщение
              </button>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

// ── GroupInfoModal ─────────────────────────────────────────────────────────────
function GroupInfoModal({ chat, onClose, onViewUser, meId, onUpdateChat, onRemoveMember }: {
  chat: Chat;
  onClose: () => void;
  onViewUser: (id: string) => void;
  meId: string;
  onUpdateChat: (name: string, description: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}) {
  const isCreator = chat.creator_id === meId;

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(chat.name || '');
  const [editDesc, setEditDesc] = useState(chat.description || '');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add members modal
  const [showAddMembers, setShowAddMembers] = useState(false);

  // Member context menu
  const [memberCtx, setMemberCtx] = useState<{ x: number; y: number; user: User } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<User | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const ctxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!memberCtx) return;
    function handleClick(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setMemberCtx(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [memberCtx]);

  // Auto-dismiss confirm dialog if the target was already removed via socket
  useEffect(() => {
    if (removeConfirm && !chat.members.some(m => m.id === removeConfirm.id)) {
      setRemoveConfirm(null);
      setRemoveBusy(false);
    }
  }, [chat.members, removeConfirm]);

  // Keep edit fields in sync when not editing (e.g. another admin updated via socket)
  useEffect(() => {
    if (!editing) {
      setEditName(chat.name || '');
      setEditDesc(chat.description || '');
    }
  }, [chat.name, chat.description, editing]);

  async function handleSaveEdit() {
    if (!editName.trim()) { setEditError('Введите название группы'); return; }
    setEditBusy(true); setEditError(null);
    try {
      await onUpdateChat(editName.trim(), editDesc.trim());
      setEditing(false);
    } catch (e: any) { setEditError(e?.message ?? 'Ошибка'); }
    finally { setEditBusy(false); }
  }

  async function handleRemoveConfirm() {
    if (!removeConfirm) return;
    setRemoveBusy(true);
    try {
      await onRemoveMember(removeConfirm.id);
      setRemoveConfirm(null);
    } catch { /* handled upstream */ }
    finally { setRemoveBusy(false); }
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && !removeConfirm && onClose()}>
      <div className="groupInfoCard">
        <button className="pvCloseBtn" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Header */}
        <div className="giHeader">
          <div className="giAvatarFallback">{avatarLetter(chat.name || 'Г')}</div>
          {editing ? (
            <div className="giEditForm">
              <input
                className="giEditInput"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Название группы"
                maxLength={64}
                autoFocus
              />
              <textarea
                className="giEditTextarea"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Описание группы (необязательно)"
                rows={2}
                maxLength={256}
              />
              {editError && <div className="giEditError">{editError}</div>}
              <div className="giEditBtns">
                <button className="giEditCancelBtn" onClick={() => { setEditing(false); setEditError(null); }}>
                  Отмена
                </button>
                <button className="giEditSaveBtn" onClick={handleSaveEdit} disabled={editBusy || !editName.trim()}>
                  {editBusy ? '…' : 'Сохранить'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="giNameRow">
                <div className="giName">{chat.name || 'Группа'}</div>
                {isCreator && (
                  <button className="giEditBtn" onClick={() => setEditing(true)} title="Редактировать">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
              </div>
              <div className="giMeta">{chat.members.length} участников</div>
              {chat.description && <div className="giDesc">{chat.description}</div>}
            </>
          )}
        </div>

        {/* Members section */}
        <div className="giMemberLabel">Участники</div>

        {isCreator && (
          <button className="giAddMembersBtn" onClick={() => setShowAddMembers(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/>
              <line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Добавить участников
          </button>
        )}

        <div className="giMemberList">
          {chat.members.map(m => (
            <button
              key={m.id}
              className="giMemberItem"
              onClick={() => { onViewUser(m.id); onClose(); }}
              onContextMenu={e => {
                if (!isCreator || m.id === meId || m.id === chat.creator_id) return;
                e.preventDefault();
                setMemberCtx({ x: e.clientX, y: e.clientY, user: m });
              }}
            >
              <Avatar user={m} size={38} radius={12} />
              <div className="giMemberInfo">
                <div className="giMemberName">{m.display_name || m.username}</div>
                {m.username && <div className="giMemberSub">@{m.username}</div>}
              </div>
              <div className="giBadges">
                {m.id === meId && <span className="giYouBadge">Вы</span>}
                {m.id === chat.creator_id && <span className="giAdminBadge">Создатель</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Context menu — rendered OUTSIDE groupInfoCard to escape its stacking context */}
      {memberCtx && (
        <div
          ref={ctxRef}
          className="ctxMenu"
          style={{
            position: 'fixed',
            top: Math.min(memberCtx.y, window.innerHeight - 60),
            left: Math.min(memberCtx.x, window.innerWidth - 220),
            zIndex: 10100,
          }}
        >
          <button className="ctxItem ctxItemDanger" onClick={() => { setMemberCtx(null); setRemoveConfirm(memberCtx.user); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Удалить {memberCtx.user.display_name || memberCtx.user.username}
          </button>
        </div>
      )}

      {/* Confirm dialog — rendered OUTSIDE groupInfoCard at full-screen overlay */}
      {removeConfirm && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !removeBusy && setRemoveConfirm(null)}>
          <div className="confirmCard">
            <div className="confirmIcon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить участника?</div>
            <div className="confirmText">
              {removeConfirm.display_name || removeConfirm.username} будет удалён(а) из группы. Остальные участники увидят уведомление.
            </div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setRemoveConfirm(null)} disabled={removeBusy}>Отмена</button>
              <button className="confirmDelete" onClick={handleRemoveConfirm} disabled={removeBusy}>
                {removeBusy ? '…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add members sub-modal */}
      {showAddMembers && (
        <AddGroupMembersModal
          chat={chat}
          meId={meId}
          onClose={() => setShowAddMembers(false)}
        />
      )}
    </div>
  );
}

// ── AddGroupMembersModal ───────────────────────────────────────────────────────
function AddGroupMembersModal({ chat, meId, onClose }: {
  chat: Chat;
  meId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function doSearch() {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await searchUsers(query);
      // Exclude already-in-group members and self
      const memberIds = new Set(chat.members.map(m => m.id));
      setSearchResults(res.filter(u => u.id !== meId && !memberIds.has(u.id)));
    } finally { setSearching(false); }
  }
  useEffect(() => { const t = setTimeout(doSearch, 350); return () => clearTimeout(t); }, [query]); // eslint-disable-line

  // When socket updates chat.members, remove newly-added users from search results
  useEffect(() => {
    const memberIds = new Set(chat.members.map(m => m.id));
    setSearchResults(prev => prev.filter(u => !memberIds.has(u.id)));
  }, [chat.members]); // eslint-disable-line

  async function handleAdd(u: User) {
    if (addingId || addedIds.has(u.id)) return;
    setError(null);
    setAddingId(u.id);
    try {
      await apiAddGroupMember(chat.id, u.id);
      setAddedIds(prev => new Set([...prev, u.id]));
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка добавления');
    } finally { setAddingId(null); }
  }

  return (
    <div className="modalOverlay" style={{ zIndex: 10050 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modalCard">
        <div className="modalHeader">
          <div className="modalTitle">Добавить участников</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modalBody">
          <div className="modalField">
            <div className="modalSearch">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.7"/>
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <input className="modalSearchInput" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по username…" autoFocus />
              {searching && <span className="modalSearchSpin">…</span>}
            </div>
          </div>
          {error && <div className="modalError">{error}</div>}
          {searchResults.length > 0 && (
            <div className="modalUserList">
              {searchResults.map(u => {
                const isBlocked = !!u.no_group_add;
                const isAdded = addedIds.has(u.id);
                const isAdding = addingId === u.id;
                return (
                  <button
                    key={u.id}
                    className={`modalUserItem${isBlocked ? ' modalUserItemDisabled' : ''}`}
                    onClick={() => !isBlocked && !isAdded && handleAdd(u)}
                    disabled={isBlocked || isAdded || !!addingId}
                    title={isBlocked ? 'Пользователь запретил добавление в группы' : undefined}
                  >
                    <div className="modalUserAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                    <div className="modalUserInfo">
                      <div className="modalUserName">{u.display_name || u.username}</div>
                      {u.username && <div className="modalUserSub">@{u.username}</div>}
                    </div>
                    {isBlocked ? (
                      <div className="modalUserLock">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                    ) : isAdded ? (
                      <div className="modalUserAdded">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    ) : isAdding ? (
                      <div className="modalUserAdding">…</div>
                    ) : (
                      <div className="modalUserCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {query.length >= 2 && !searching && searchResults.length === 0 && (
            <div className="modalEmpty">Пользователи не найдены</div>
          )}
          {query.length < 2 && (
            <div className="modalEmpty">Введите имя или username для поиска</div>
          )}
        </div>
        <div className="modalFooter">
          <button className="modalCreateBtn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}

// ── ProfileSettingsModal ──────────────────────────────────────────────────────
function ProfileSettingsModal({ me, token, onClose, onUpdate }: {
  me: User; token: string; onClose: () => void; onUpdate: (u: User) => void;
}) {
  const [tab, setTab] = useState<'profile' | 'password' | 'privacy'>('profile');

  const [displayName, setDisplayName] = useState(me.display_name ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [birthDate, setBirthDate] = useState(me.birth_date ?? '');
  const [hideBio, setHideBio] = useState(me.hide_bio ?? false);
  const [hideBirth, setHideBirth] = useState(me.hide_birth_date ?? false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(resolveUrl(me.avatar_url) ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [noGroupAdd, setNoGroupAdd] = useState(me.no_group_add ?? false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyOk, setPrivacyOk] = useState(false);

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setAvatarFile(f);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  async function uploadAvatar(file: File): Promise<string> {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${API_BASE_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (!res.ok) throw new Error('Ошибка загрузки аватара');
    return (await res.json()).url as string;
  }

  async function onSaveProfile() {
    setProfileError(null); setProfileBusy(true); setProfileOk(false);
    try {
      let avatar_url = me.avatar_url ?? null;
      if (avatarFile) avatar_url = await uploadAvatar(avatarFile);
      const next = await updateMe({
        username: username.trim().toLowerCase() || null,
        display_name: displayName.trim() || '',
        avatar_url,
        bio: bio.trim() || null,
        birth_date: birthDate || null,
        hide_bio: hideBio,
        hide_birth_date: hideBirth,
      });
      onUpdate(next);
      setProfileOk(true);
      setTimeout(() => setProfileOk(false), 2500);
    } catch (e: any) { setProfileError(e?.message ?? 'Ошибка'); }
    finally { setProfileBusy(false); }
  }

  async function onSavePassword() {
    setPwError(null); setPwOk(false);
    if (pwNew.length < 6) return setPwError('Пароль: минимум 6 символов');
    if (pwNew !== pwConfirm) return setPwError('Пароли не совпадают');
    setPwBusy(true);
    try {
      await authSetPassword(pwNew, me.has_password ? pwCurrent : undefined);
      onUpdate({ ...me, has_password: true });
      setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwOk(true);
      setTimeout(() => setPwOk(false), 2500);
    } catch (e: any) { setPwError(e?.message ?? 'Ошибка'); }
    finally { setPwBusy(false); }
  }

  async function onSavePrivacy() {
    setPrivacyBusy(true); setPrivacyOk(false);
    try {
      const next = await updateMe({ no_group_add: noGroupAdd });
      onUpdate(next);
      setPrivacyOk(true);
      setTimeout(() => setPrivacyOk(false), 2500);
    } catch (e: any) { /* ignore */ }
    finally { setPrivacyBusy(false); }
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="psCard">
        <div className="psHeader">
          <div className="psTitle">Настройки профиля</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="psTabs">
          <button className={`psTab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>Профиль</button>
          <button className={`psTab${tab === 'password' ? ' active' : ''}`} onClick={() => setTab('password')}>Пароль</button>
          <button className={`psTab${tab === 'privacy' ? ' active' : ''}`} onClick={() => setTab('privacy')}>Конфиденциальность</button>
        </div>

        {tab === 'profile' && (
          <div className="psBody">
            <div className="psAvatarSection">
              <div className="psAvatarWrap" onClick={() => fileRef.current?.click()} title="Изменить фото">
                {avatarPreview
                  ? <img src={avatarPreview} alt="" className="psAvatarImg" />
                  : <div className="psAvatarFallback">{avatarLetter(displayName || username || '')}</div>
                }
                <div className="psAvatarOverlay">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
              </div>
              <div className="psAvatarHint">Нажмите чтобы изменить фото</div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarPick} />
            </div>
            <div className="psField">
              <label className="psLabel">Имя</label>
              <input className="psInput" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Как вас зовут" maxLength={64} />
            </div>
            <div className="psField">
              <label className="psLabel">Username</label>
              <div className="psInputPrefix">
                <span className="psAt">@</span>
                <input className="psInput psInputPad" value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username" maxLength={32} autoCapitalize="none" />
              </div>
            </div>
            <div className="psField">
              <label className="psLabel">О себе</label>
              <textarea className="psTextarea" value={bio} onChange={e => setBio(e.target.value)} placeholder="Расскажите о себе…" rows={3} maxLength={300} />
              <label className="psPrivacyLabel">
                <input type="checkbox" className="psCheckbox" checked={hideBio} onChange={e => setHideBio(e.target.checked)} />
                Скрыть от других пользователей
              </label>
            </div>
            <div className="psField">
              <label className="psLabel">Дата рождения</label>
              <input type="date" className="psInput" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
              <label className="psPrivacyLabel">
                <input type="checkbox" className="psCheckbox" checked={hideBirth} onChange={e => setHideBirth(e.target.checked)} />
                Скрыть от других пользователей
              </label>
            </div>
            {profileError && <div className="psError">{profileError}</div>}
            {profileOk && <div className="psOk">✓ Профиль сохранён</div>}
            <button className="psSaveBtn" onClick={onSaveProfile} disabled={profileBusy}>
              {profileBusy ? '…' : 'Сохранить изменения'}
            </button>
          </div>
        )}

        {tab === 'password' && (
          <div className="psBody">
            <div className="psPassStatus">
              <span className="psLabel" style={{ marginBottom: 0 }}>Статус пароля</span>
              <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>
                {me.has_password ? '✓ Установлен' : '✗ Не задан'}
              </span>
            </div>
            {me.has_password && (
              <div className="psField">
                <label className="psLabel">Текущий пароль</label>
                <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder="Текущий пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
              </div>
            )}
            <div className="psField">
              <label className="psLabel">Новый пароль</label>
              <PasswordInput value={pwNew} onChange={setPwNew} placeholder="Минимум 6 символов" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
            </div>
            <div className="psField">
              <label className="psLabel">Повторите пароль</label>
              <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Повторите пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
            </div>
            {pwError && <div className="psError">{pwError}</div>}
            {pwOk && <div className="psOk">✓ Пароль успешно обновлён</div>}
            <button className="psSaveBtn" onClick={onSavePassword} disabled={pwBusy}>
              {pwBusy ? '…' : me.has_password ? 'Сменить пароль' : 'Установить пароль'}
            </button>
          </div>
        )}

        {tab === 'privacy' && (
          <div className="psBody">
            <div className="psPrivacySection">
              <div className="psPrivacyTitle">Группы</div>
              <div className="psPrivacyDesc">Управляйте тем, кто может добавлять вас в групповые чаты.</div>
              <label className="psPrivacyRow">
                <div className="psPrivacyRowText">
                  <div className="psPrivacyRowLabel">Запретить добавление в группы</div>
                  <div className="psPrivacyRowSub">Никто не сможет добавить вас в групповой чат без вашего согласия</div>
                </div>
                <div className={`psToggle${noGroupAdd ? ' on' : ''}`} onClick={() => setNoGroupAdd(v => !v)}>
                  <div className="psToggleKnob" />
                </div>
              </label>
            </div>
            {privacyOk && <div className="psOk">✓ Настройки сохранены</div>}
            <button className="psSaveBtn" onClick={onSavePrivacy} disabled={privacyBusy}>
              {privacyBusy ? '…' : 'Сохранить'}
            </button>
          </div>
        )}
      </div>
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
              {displayList.map(u => {
                const isBlocked = !!u.no_group_add;
                return (
                  <button
                    key={u.id}
                    className={`modalUserItem${isBlocked ? ' modalUserItemDisabled' : ''}`}
                    onClick={() => !isBlocked && toggleUser(u)}
                    title={isBlocked ? 'Пользователь запретил добавление в группы' : undefined}
                    disabled={isBlocked}
                  >
                    <div className="modalUserAvatar">{avatarLetter(u.display_name || u.username || '')}</div>
                    <div className="modalUserInfo">
                      <div className="modalUserName">{u.display_name || u.username}</div>
                      {u.username && <div className="modalUserSub">@{u.username}</div>}
                    </div>
                    {isBlocked ? (
                      <div className="modalUserLock" title="Запретил добавление в группы">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                    ) : (
                      <div className="modalUserCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
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

// ── ChatContextMenu ───────────────────────────────────────────────────────────
function ChatContextMenu({ x, y, chat, onClose, onDelete, onLeave }: {
  x: number; y: number; chat: Chat;
  onClose: () => void;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 100),
    left: Math.min(x, window.innerWidth - 180),
    zIndex: 9999,
  };

  return (
    <div ref={ref} className="ctxMenu" style={style}>
      {chat.type === 'direct' ? (
        <button className="ctxItem ctxItemDanger" onClick={() => { onClose(); onDelete(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
          Удалить чат
        </button>
      ) : (
        <button className="ctxItem ctxItemDanger" onClick={() => { onClose(); onLeave(); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Покинуть группу
        </button>
      )}
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
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>{busy ? '…' : 'Удалить'}</button>
        </div>
      </div>
    </div>
  );
}

// ── ChatActionConfirmModal ─────────────────────────────────────────────────────
function ChatActionConfirmModal({ chat, onConfirm, onCancel, busy }: {
  chat: Chat; onConfirm: () => void; onCancel: () => void; busy: boolean;
}) {
  const isGroup = chat.type === 'group';
  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="confirmCard">
        <div className="confirmIcon">
          {isGroup ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          )}
        </div>
        <div className="confirmTitle">
          {isGroup ? 'Покинуть группу?' : 'Удалить чат?'}
        </div>
        <div className="confirmText">
          {isGroup
            ? `Вы покинете «${chat.name || 'Группу'}». Остальные участники увидят уведомление.`
            : 'Чат будет удалён для обоих участников. Действие нельзя отменить.'}
        </div>
        <div className="confirmBtns">
          <button className="confirmCancel" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="confirmDelete" onClick={onConfirm} disabled={busy}>
            {busy ? '…' : isGroup ? 'Покинуть' : 'Удалить'}
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

  const [theme, setTheme] = useState<Theme>(() => { const t = getStoredTheme(); applyTheme(t); return t; });
  const toggleTheme = useCallback(() => {
    setTheme(prev => { const next: Theme = prev === 'dark' ? 'light' : 'dark'; applyTheme(next); return next; });
  }, []);

  type AuthTab = 'login' | 'register';
  const [authTab, setAuthTab] = useState<AuthTab>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [showProfile, setShowProfile] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [chatCtxMenu, setChatCtxMenu] = useState<{ x: number; y: number; chat: Chat } | null>(null);
  const [chatActionConfirm, setChatActionConfirm] = useState<Chat | null>(null);
  const [chatActionBusy, setChatActionBusy] = useState(false);

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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => { setSelectedIds(new Set()); }, [activeChatId]);

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
          ...c, last_message: msg, unread_count: isActive ? 0 : (c.unread_count ?? 0) + 1,
        } : c);
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
      setChats(prev => prev.map(c => c.id !== chatId ? c : {
        ...c,
        // For groups: keep max across all readers; for direct: just update
        partner_last_read_at: Math.max(c.partner_last_read_at ?? 0, readAt),
      }));
    };

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
      socket.off('new-message', onNewMessage); socket.off('chat-read', onChatRead);
      socket.off('messages-deleted', onMessagesDeleted); socket.off('chat-created', onChatCreated);
      socket.off('chat-updated', onChatUpdated); socket.off('chat-removed', onChatRemoved);
      disconnectSocket();
    };
  }, [token, me]); // eslint-disable-line

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

  function applySession(res: { token: string; user: User }) {
    setToken(res.token); setMe(res.user); setSession({ token: res.token, user: res.user });
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

  async function onConfirmChatAction() {
    if (!chatActionConfirm) return;
    setChatActionBusy(true);
    try {
      if (chatActionConfirm.type === 'group') {
        await apiLeaveGroup(chatActionConfirm.id);
      } else {
        await apiDeleteDirectChat(chatActionConfirm.id);
      }
      // Socket will fire 'chat-removed' — but also handle locally just in case
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
  const isGroup = activeChat?.type === 'group';

  return (
    <>
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreate={onCreateGroup} contacts={contacts} meId={me.id} />}
      {showDeleteConfirm && <DeleteConfirmModal count={selectedIds.size} onConfirm={handleDeleteConfirm} onCancel={() => setShowDeleteConfirm(false)} busy={deleteBusy} />}
      {showProfileSettings && <ProfileSettingsModal me={me} token={token} onClose={() => setShowProfileSettings(false)} onUpdate={onUpdateMe} />}
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
          onRemoveMember={async (userId) => {
            await apiRemoveGroupMember(activeChat.id, userId);
            // Socket 'chat-updated' will refresh the chat; 'chat-removed' for the kicked user
          }}
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
                <button className="searchBtn" onClick={onSearchUsers} disabled={userSearchBusy}>{userSearchBusy ? '…' : 'Найти'}</button>
              )}
            </div>
            {userSearchError && <div className="searchError">{userSearchError}</div>}
            {userResults.length > 0 && (
              <div className="searchResults">
                {userResults.map(u => (
                  <button key={u.id} className="srItem" onClick={() => onStartChat(u)}>
                    <Avatar user={u} size={34} radius={10} />
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
                <button key={c.id}
                  className={`chatItem${c.id === activeChatId ? ' active' : ''}`}
                  onClick={() => setActiveChatId(c.id)}
                  onContextMenu={e => { e.preventDefault(); setChatCtxMenu({ x: e.clientX, y: e.clientY, chat: c }); }}
                >
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

          {/* Sidebar bottom */}
          <div className="sidebarBottom">
            {showProfile && (
              <div className="profilePanel">
                <div className="ppSection">
                  <div className="ppTopRow">
                    <Avatar user={me} size={52} radius={16} />
                    <div className="ppInfo">
                      <div className="ppName">{me.display_name || me.username}</div>
                      <div className="ppSub">@{me.username}</div>
                    </div>
                  </div>
                  <button className="ppSettingsBtn" onClick={() => { setShowProfileSettings(true); setShowProfile(false); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Настройки профиля
                  </button>
                </div>
                <hr className="ppDivider" />
                <button className="ppLogout" onClick={onLogout}>Выйти из аккаунта</button>
              </div>
            )}
            <div className="sidebarBottomRow">
              <button className="meBtn" onClick={() => setShowProfile(v => !v)}>
                <Avatar user={me} size={36} radius={11} />
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
            {/* Chat header */}
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
                <button
                  className="chHeaderBtn"
                  onClick={() => {
                    if (isGroup) setShowGroupInfo(true);
                    else {
                      const other = activeChat.members.find(m => m.id !== me.id);
                      if (other) setViewUserId(other.id);
                    }
                  }}
                >
                  <div className={`chAvatar${isGroup ? ' group' : ''}`}>
                    {avatarLetter(chatTitle(activeChat, me.id))}
                  </div>
                  <div>
                    <div className="chName">{chatTitle(activeChat, me.id)}</div>
                    <div className="chSub">{chatSubtitle(activeChat, me.id)}</div>
                  </div>
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="messages" onClick={() => hasSelection && setSelectedIds(new Set())}>
              {loadingMessages && <div className="msgHint">Загрузка…</div>}
              {messages.map((m, idx) => {
                const isOwn = m.sender_id === me.id;
                const isRead = isOwn && partnerReadAt >= m.created_at;
                const isSelected = selectedIds.has(m.id);
                const sender = !isOwn ? activeChat.members.find(mb => mb.id === m.sender_id) : undefined;
                const nextMsg = messages[idx + 1];
                const isLastInRow = !nextMsg || nextMsg.sender_id !== m.sender_id;
                const showAvatar = isGroup && !isOwn && isLastInRow && !m.is_system;
                const showName = isGroup && !isOwn && !m.is_system && (idx === 0 || messages[idx - 1].sender_id !== m.sender_id || messages[idx - 1].is_system);

                // System messages (leave/join notifications)
                if (m.is_system) {
                  return (
                    <div key={m.id} className="msgSystem">
                      <span>{m.text}</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`msg ${isOwn ? 'out' : 'in'}${isSelected ? ' selected' : ''}${isGroup && !isOwn ? ' inGroup' : ''}`}
                    onContextMenu={e => { if (!isOwn) return; e.preventDefault(); toggleSelect(m.id); }}
                    onClick={e => { if (!isOwn || !hasSelection) return; e.stopPropagation(); toggleSelect(m.id); }}
                  >
                    {isGroup && !isOwn && (
                      <div className="msgAvatarSlot">
                        {showAvatar ? (
                          <button className="msgSenderAvatarBtn" onClick={e => { e.stopPropagation(); setViewUserId(m.sender_id); }}>
                            <Avatar user={sender} size={32} radius={10} />
                          </button>
                        ) : <div style={{ width: 32 }} />}
                      </div>
                    )}
                    <div className="bubble">
                      {isSelected && (
                        <div className="msgCheckmark">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                          </svg>
                        </div>
                      )}
                      {showName && (
                        <button className="bubbleSenderName" onClick={e => { e.stopPropagation(); setViewUserId(m.sender_id); }}>
                          {sender?.display_name || sender?.username || 'Пользователь'}
                        </button>
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
