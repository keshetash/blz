import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { PasswordInput } from '../ui/PasswordInput';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { authLogin, authLoginPassword, authRegister } from '../../api/auth';
import { setSession } from '../../storage/session';

interface Props {
  theme: Theme;
  onThemeToggle: () => void;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthScreen({ theme, onThemeToggle, onAuthenticated }: Props) {
  type AuthTab = 'login' | 'register';
  const [tab, setTab] = useState<AuthTab>('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applySession(res: { token: string; user: User }) {
    setSession({ token: res.token, user: res.user });
    onAuthenticated(res.token, res.user);
  }

  const onLogin = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = password
        ? await authLoginPassword(username.trim(), password)
        : await authLogin(username.trim());
      applySession(res);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  }, [username, password]); // eslint-disable-line

  const onRegister = useCallback(async () => {
    setError(null);
    if (!password) return setError('Введите пароль');
    if (password.length < 6) return setError('Пароль: минимум 6 символов');
    if (password !== passwordConfirm) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      applySession(await authRegister(username.trim(), password));
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка регистрации');
    } finally {
      setBusy(false);
    }
  }, [username, password, passwordConfirm]); // eslint-disable-line

  const loginReady = username.trim().length >= 3;
  const registerReady =
    username.trim().length >= 3 &&
    password.length >= 6 &&
    password === passwordConfirm;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (tab === 'login' && loginReady && !busy) onLogin();
    if (tab === 'register' && registerReady && !busy) onRegister();
  };

  return (
    <div className="authWrap">
      <button className="authThemeBtn" onClick={onThemeToggle}>
        <ThemeIcon theme={theme} />
      </button>
      <div className="authCard">
        <div className="authLogo">B</div>
        <div className="authTitle">Blizkie</div>
        <div className="authTabs">
          <button
            className={`authTab${tab === 'login' ? ' active' : ''}`}
            onClick={() => { setTab('login'); setError(null); }}
          >
            Войти
          </button>
          <button
            className={`authTab${tab === 'register' ? ' active' : ''}`}
            onClick={() => { setTab('register'); setError(null); }}
          >
            Регистрация
          </button>
        </div>

        {tab === 'login' && (
          <>
            <div className="authSub">Введите username чтобы войти или добавьте пароль</div>
            <div className="authLabel">Username</div>
            <input
              className="authInput"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username"
              autoCapitalize="none"
              autoComplete="username"
              autoFocus
              onKeyDown={handleKeyDown}
            />
            <div className="authLabel">
              Пароль <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(необязательно)</span>
            </div>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Пароль (если привязан)"
              onKeyDown={handleKeyDown}
            />
            <div className="authHint">Без пароля — вход по username · С паролем — проверка пароля</div>
          </>
        )}

        {tab === 'register' && (
          <>
            <div className="authSub">Создайте новый аккаунт с паролем</div>
            <div className="authLabel">Username</div>
            <input
              className="authInput"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username"
              autoCapitalize="none"
              autoComplete="username"
              autoFocus
              onKeyDown={handleKeyDown}
            />
            <div className="authLabel">Пароль</div>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Минимум 6 символов"
              onKeyDown={handleKeyDown}
            />
            <div className="authLabel">Повторите пароль</div>
            <PasswordInput
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              placeholder="Повторите пароль"
              onKeyDown={handleKeyDown}
            />
            <div className="authHint">Только латиница, цифры и _ · Минимум 3 символа</div>
          </>
        )}

        {error && <div className="authError">{error}</div>}
        <button
          className="authBtn"
          disabled={tab === 'login' ? (!loginReady || busy) : (!registerReady || busy)}
          onClick={tab === 'login' ? onLogin : onRegister}
        >
          {busy ? '…' : tab === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </div>
    </div>
  );
}
