import { type Chat, type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { UserSearch } from './UserSearch';
import { FolderTabs } from './FolderTabs';
import { ChatList } from './ChatList';
import { SidebarBottom } from './SidebarBottom';

type ChatFilter = 'all' | 'groups' | 'direct';

interface Props {
  me: User;
  theme: Theme;
  chats: Chat[];
  filteredChats: Chat[];
  activeChatId: string | null;
  chatFilter: ChatFilter;
  loadingChats: boolean;
  dataError: string | null;
  userSearch: string;
  userResults: User[];
  userSearchBusy: boolean;
  userSearchError: string | null;
  showProfile: boolean;
  onUserSearchChange: (v: string) => void;
  onSearchUsers: () => void;
  onStartChat: (u: User) => void;
  onFilterChange: (f: ChatFilter) => void;
  onNewGroup: () => void;
  onSelectChat: (id: string) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: Chat) => void;
  onToggleProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onThemeToggle: () => void;
}

export function Sidebar({
  me, theme, filteredChats, activeChatId, chatFilter, loadingChats, dataError,
  userSearch, userResults, userSearchBusy, userSearchError, showProfile,
  onUserSearchChange, onSearchUsers, onStartChat, onFilterChange, onNewGroup,
  onSelectChat, onChatContextMenu, onToggleProfile, onOpenSettings, onLogout, onThemeToggle,
}: Props) {
  return (
    <aside className="sidebar">
      <UserSearch
        value={userSearch}
        onChange={onUserSearchChange}
        onSearch={onSearchUsers}
        busy={userSearchBusy}
        error={userSearchError}
        results={userResults}
        onStartChat={onStartChat}
      />
      <FolderTabs
        filter={chatFilter}
        onFilterChange={onFilterChange}
        onNewGroup={onNewGroup}
      />
      <ChatList
        chats={filteredChats}
        meId={me.id}
        activeChatId={activeChatId}
        filter={chatFilter}
        loading={loadingChats}
        error={dataError}
        onSelect={onSelectChat}
        onContextMenu={onChatContextMenu}
      />
      <SidebarBottom
        me={me}
        theme={theme}
        showProfile={showProfile}
        onToggleProfile={onToggleProfile}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
        onThemeToggle={onThemeToggle}
      />
    </aside>
  );
}
