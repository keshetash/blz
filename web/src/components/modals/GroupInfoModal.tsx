import { useState, useEffect, useRef } from 'react';
import { type Chat, type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { searchUsers } from '../../api/users';
import { addGroupMember } from '../../api/chats';
import { Avatar } from '../ui/Avatar';

// ── AddGroupMembersModal ───────────────────────────────────────────────────────
function AddGroupMembersModal({ chat, meId, onClose }: { chat: Chat; meId: string; onClose: () => void }) {
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
      const memberIds = new Set(chat.members.map(m => m.id));
      setSearchResults(res.filter(u => u.id !== meId && !memberIds.has(u.id)));
    } finally { setSearching(false); }
  }
  useEffect(() => { const t = setTimeout(doSearch, 350); return () => clearTimeout(t); }, [query]); // eslint-disable-line
  useEffect(() => {
    const memberIds = new Set(chat.members.map(m => m.id));
    setSearchResults(prev => prev.filter(u => !memberIds.has(u.id)));
  }, [chat.members]); // eslint-disable-line

  async function handleAdd(u: User) {
    if (addingId || addedIds.has(u.id)) return;
    setError(null); setAddingId(u.id);
    try {
      await addGroupMember(chat.id, u.id);
      setAddedIds(prev => new Set([...prev, u.id]));
    } catch (e: any) { setError(e?.message ?? 'Ошибка добавления'); }
    finally { setAddingId(null); }
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
                  <button key={u.id} className={`modalUserItem${isBlocked ? ' modalUserItemDisabled' : ''}`}
                    onClick={() => !isBlocked && !isAdded && handleAdd(u)}
                    disabled={isBlocked || isAdded || !!addingId}
                    title={isBlocked ? 'Пользователь запретил добавление в группы' : undefined}>
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
          {query.length >= 2 && !searching && searchResults.length === 0 && <div className="modalEmpty">Пользователи не найдены</div>}
          {query.length < 2 && <div className="modalEmpty">Введите имя или username для поиска</div>}
        </div>
        <div className="modalFooter">
          <button className="modalCreateBtn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}

// ── GroupInfoModal ─────────────────────────────────────────────────────────────
interface Props {
  chat: Chat;
  onClose: () => void;
  onViewUser: (id: string) => void;
  meId: string;
  onUpdateChat: (name: string, description: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}

export function GroupInfoModal({ chat, onClose, onViewUser, meId, onUpdateChat, onRemoveMember }: Props) {
  const isCreator = chat.creator_id === meId;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(chat.name || '');
  const [editDesc, setEditDesc] = useState(chat.description || '');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);
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

  useEffect(() => {
    if (removeConfirm && !chat.members.some(m => m.id === removeConfirm.id)) {
      setRemoveConfirm(null); setRemoveBusy(false);
    }
  }, [chat.members, removeConfirm]);

  useEffect(() => {
    if (!editing) { setEditName(chat.name || ''); setEditDesc(chat.description || ''); }
  }, [chat.name, chat.description, editing]);

  async function handleSaveEdit() {
    if (!editName.trim()) { setEditError('Введите название группы'); return; }
    setEditBusy(true); setEditError(null);
    try { await onUpdateChat(editName.trim(), editDesc.trim()); setEditing(false); }
    catch (e: any) { setEditError(e?.message ?? 'Ошибка'); }
    finally { setEditBusy(false); }
  }

  async function handleRemoveConfirm() {
    if (!removeConfirm) return;
    setRemoveBusy(true);
    try { await onRemoveMember(removeConfirm.id); setRemoveConfirm(null); }
    catch { /* upstream */ }
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
        <div className="giHeader">
          <div className="giAvatarFallback">{avatarLetter(chat.name || 'Г')}</div>
          {editing ? (
            <div className="giEditForm">
              <input className="giEditInput" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Название группы" maxLength={64} autoFocus />
              <textarea className="giEditTextarea" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Описание группы (необязательно)" rows={2} maxLength={256} />
              {editError && <div className="giEditError">{editError}</div>}
              <div className="giEditBtns">
                <button className="giEditCancelBtn" onClick={() => { setEditing(false); setEditError(null); }}>Отмена</button>
                <button className="giEditSaveBtn" onClick={handleSaveEdit} disabled={editBusy || !editName.trim()}>{editBusy ? '…' : 'Сохранить'}</button>
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
        <div className="giMemberLabel">Участники</div>
        {isCreator && (
          <button className="giAddMembersBtn" onClick={() => setShowAddMembers(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Добавить участников
          </button>
        )}
        <div className="giMemberList">
          {chat.members.map(m => (
            <button key={m.id} className="giMemberItem"
              onClick={() => { onViewUser(m.id); onClose(); }}
              onContextMenu={e => {
                if (!isCreator || m.id === meId || m.id === chat.creator_id) return;
                e.preventDefault();
                setMemberCtx({ x: e.clientX, y: e.clientY, user: m });
              }}>
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

      {memberCtx && (
        <div ref={ctxRef} className="ctxMenu" style={{ position: 'fixed', top: Math.min(memberCtx.y, window.innerHeight - 60), left: Math.min(memberCtx.x, window.innerWidth - 220), zIndex: 10100 }}>
          <button className="ctxItem ctxItemDanger" onClick={() => { setMemberCtx(null); setRemoveConfirm(memberCtx.user); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Удалить {memberCtx.user.display_name || memberCtx.user.username}
          </button>
        </div>
      )}

      {removeConfirm && (
        <div className="giConfirmOverlay" onClick={e => e.target === e.currentTarget && !removeBusy && setRemoveConfirm(null)}>
          <div className="confirmCard">
            <div className="confirmIcon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить участника?</div>
            <div className="confirmText">{removeConfirm.display_name || removeConfirm.username} будет удалён(а) из группы. Остальные участники увидят уведомление.</div>
            <div className="confirmBtns">
              <button className="confirmCancel" onClick={() => setRemoveConfirm(null)} disabled={removeBusy}>Отмена</button>
              <button className="confirmDelete" onClick={handleRemoveConfirm} disabled={removeBusy}>{removeBusy ? '…' : 'Удалить'}</button>
            </div>
          </div>
        </div>
      )}

      {showAddMembers && <AddGroupMembersModal chat={chat} meId={meId} onClose={() => setShowAddMembers(false)} />}
    </div>
  );
}
