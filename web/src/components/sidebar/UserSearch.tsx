import { type User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  busy: boolean;
  error: string | null;
  results: User[];
  onStartChat: (u: User) => void;
}

export function UserSearch({ value, onChange, onSearch, busy, error, results, onStartChat }: Props) {
  return (
    <div className="sidebarSearch">
      <div className="searchRow">
        <svg className="searchIcon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <input
          className="searchInput"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch()}
          placeholder="Поиск пользователей…"
        />
        {value.trim().length >= 2 && (
          <button className="searchBtn" onClick={onSearch} disabled={busy}>
            {busy ? '…' : 'Найти'}
          </button>
        )}
      </div>
      {error && <div className="searchError">{error}</div>}
      {results.length > 0 && (
        <div className="searchResults">
          {results.map(u => (
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
  );
}
