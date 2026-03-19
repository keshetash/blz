import { useState, useRef } from 'react';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { resolveUrl } from '../ui/Avatar';
import { PasswordInput } from '../ui/PasswordInput';
import { authSetPassword } from '../../api/auth';
import { updateMe } from '../../api/users';
import { API_BASE_URL } from '../../config';

interface Props {
  me: User;
  token: string;
  onClose: () => void;
  onUpdate: (u: User) => void;
  onDeleteAccount: () => Promise<void>;
}

export function ProfileSettingsModal({ me, token, onClose, onUpdate, onDeleteAccount }: Props) {
  const [tab, setTab] = useState<'profile' | 'password' | 'privacy'>('profile');

  // Profile tab
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

  // Password tab
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  // Privacy tab
  const [noGroupAdd, setNoGroupAdd] = useState(me.no_group_add ?? false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyOk, setPrivacyOk] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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
      const next = await updateMe({ username: username.trim().toLowerCase() || null, display_name: displayName.trim() || '', avatar_url, bio: bio.trim() || null, birth_date: birthDate || null, hide_bio: hideBio, hide_birth_date: hideBirth });
      onUpdate(next); setProfileOk(true); setTimeout(() => setProfileOk(false), 2500);
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
    try { const next = await updateMe({ no_group_add: noGroupAdd }); onUpdate(next); setPrivacyOk(true); setTimeout(() => setPrivacyOk(false), 2500); }
    catch { /* ignore */ }
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
                {avatarPreview ? <img src={avatarPreview} alt="" className="psAvatarImg" /> : <div className="psAvatarFallback">{avatarLetter(displayName || username || '')}</div>}
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
            <div className="psField"><label className="psLabel">Имя</label><input className="psInput" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Как вас зовут" maxLength={64} /></div>
            <div className="psField">
              <label className="psLabel">Username</label>
              <div className="psInputPrefix"><span className="psAt">@</span><input className="psInput psInputPad" value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="username" maxLength={32} autoCapitalize="none" /></div>
            </div>
            <div className="psField">
              <label className="psLabel">О себе</label>
              <textarea className="psTextarea" value={bio} onChange={e => setBio(e.target.value)} placeholder="Расскажите о себе…" rows={3} maxLength={300} />
              <label className="psPrivacyLabel"><input type="checkbox" className="psCheckbox" checked={hideBio} onChange={e => setHideBio(e.target.checked)} />Скрыть от других пользователей</label>
            </div>
            <div className="psField">
              <label className="psLabel">Дата рождения</label>
              <input type="date" className="psInput" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
              <label className="psPrivacyLabel"><input type="checkbox" className="psCheckbox" checked={hideBirth} onChange={e => setHideBirth(e.target.checked)} />Скрыть от других пользователей</label>
            </div>
            {profileError && <div className="psError">{profileError}</div>}
            {profileOk && <div className="psOk">✓ Профиль сохранён</div>}
            <button className="psSaveBtn" onClick={onSaveProfile} disabled={profileBusy}>{profileBusy ? '…' : 'Сохранить изменения'}</button>
          </div>
        )}

        {tab === 'password' && (
          <div className="psBody">
            <div className="psPassStatus">
              <span className="psLabel" style={{ marginBottom: 0 }}>Статус пароля</span>
              <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>{me.has_password ? '✓ Установлен' : '✗ Не задан'}</span>
            </div>
            {me.has_password && <div className="psField"><label className="psLabel">Текущий пароль</label><PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder="Текущий пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" /></div>}
            <div className="psField"><label className="psLabel">Новый пароль</label><PasswordInput value={pwNew} onChange={setPwNew} placeholder="Минимум 6 символов" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" /></div>
            <div className="psField"><label className="psLabel">Повторите пароль</label><PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Повторите пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" /></div>
            {pwError && <div className="psError">{pwError}</div>}
            {pwOk && <div className="psOk">✓ Пароль успешно обновлён</div>}
            <button className="psSaveBtn" onClick={onSavePassword} disabled={pwBusy}>{pwBusy ? '…' : me.has_password ? 'Сменить пароль' : 'Установить пароль'}</button>
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
            <button className="psSaveBtn" onClick={onSavePrivacy} disabled={privacyBusy}>{privacyBusy ? '…' : 'Сохранить'}</button>
          </div>
        )}

        <div className="psDeleteSection">
          <button className="psDeleteBtn" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Удалить аккаунт
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modalOverlay" style={{ zIndex: 10200 }} onClick={e => e.target === e.currentTarget && !deletingAccount && setShowDeleteConfirm(false)}>
          <div className="confirmCard">
            <div className="confirmIcon" style={{ color: 'var(--danger, #f87171)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить аккаунт?</div>
            <div className="confirmText">Это действие необратимо. Все ваши личные чаты будут удалены, вы покинете все группы, а ваш никнейм освободится. Восстановить аккаунт будет невозможно.</div>
            <div className="confirmBtns">
              <button className="psDeleteCancelBtn" onClick={() => setShowDeleteConfirm(false)} disabled={deletingAccount}>Отмена</button>
              <button className="psDeleteConfirmBtn" disabled={deletingAccount} onClick={async () => { setDeletingAccount(true); try { await onDeleteAccount(); } catch { setDeletingAccount(false); } }}>
                {deletingAccount ? '…' : 'Удалить навсегда'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
