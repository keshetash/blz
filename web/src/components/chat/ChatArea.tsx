import { type Chat, type Message } from '../../types';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';

interface Props {
  activeChat: Chat | null;
  meId: string;
  messages: Message[];
  messageText: string;
  loadingMessages: boolean;
  partnerReadAt: number;
  selectedIds: Set<string>;
  hasSelection: boolean;
  onMessageTextChange: (v: string) => void;
  onSendMessage: () => void;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onOpenGroupInfo: () => void;
  onViewUser: (id: string) => void;
}

export function ChatArea({
  activeChat, meId, messages, messageText, loadingMessages, partnerReadAt,
  selectedIds, hasSelection, onMessageTextChange, onSendMessage,
  onToggleSelect, onClearSelection, onDeleteSelected, onOpenGroupInfo, onViewUser,
}: Props) {
  if (!activeChat) return <EmptyState />;

  return (
    <>
      <ChatHeader
        chat={activeChat}
        meId={meId}
        hasSelection={hasSelection}
        selectedCount={selectedIds.size}
        onCancelSelection={onClearSelection}
        onDeleteSelected={onDeleteSelected}
        onOpenInfo={onOpenGroupInfo}
        onViewUser={onViewUser}
      />
      <MessageList
        messages={messages}
        chat={activeChat}
        meId={meId}
        partnerReadAt={partnerReadAt}
        selectedIds={selectedIds}
        hasSelection={hasSelection}
        loadingMessages={loadingMessages}
        onToggleSelect={onToggleSelect}
        onClearSelection={onClearSelection}
        onViewUser={onViewUser}
      />
      <Composer
        value={messageText}
        onChange={onMessageTextChange}
        onSend={onSendMessage}
      />
    </>
  );
}
