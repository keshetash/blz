const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { encrypt, decrypt } = require('../crypto/aes');

function sanitizeUser(u, { showPrivate = false } = {}) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    last_seen_at: u.last_seen_at,
    bio: (showPrivate || !u.hide_bio) ? (u.bio || null) : null,
    birth_date: (showPrivate || !u.hide_birth_date) ? (u.birth_date || null) : null,
    hide_bio: showPrivate ? (u.hide_bio ? true : false) : undefined,
    hide_birth_date: showPrivate ? (u.hide_birth_date ? true : false) : undefined,
    no_group_add: showPrivate ? (u.no_group_add ? true : false) : undefined,
  };
}

function decryptMessage(msg) {
  let text = '';
  try {
    text = decrypt({
      ciphertext: msg.ciphertext,
      iv: msg.iv,
      authTag: msg.auth_tag,
    }).trim();
  } catch {
    text = '[encrypted]';
  }
  return {
    id: msg.id,
    chat_id: msg.chat_id,
    sender_id: msg.sender_id,
    text,
    created_at: msg.created_at,
    deleted_at: msg.deleted_at || null,
    attachment_url: msg.attachment_url || null,
    attachment_type: msg.attachment_type || null,
    attachment_name: msg.attachment_name || null,
    liked_by: JSON.parse(msg.liked_by || '[]'),
    is_system: msg.is_system ? true : false,
  };
}

// ─── Chats ─────────────────────────────────────────────────────────────────

function getUserChats(userId) {
  const db = getDb();

  const chats = db
    .prepare(
      `SELECT c.id, c.type, c.name, c.description, c.avatar_url, c.created_at, c.creator_id
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(userId);

  return chats.map((chat) => {
    const members = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
         FROM chat_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = ?`
      )
      .all(chat.id)
      .map(sanitizeUser);

    const lastMsg = db
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(chat.id);

    const myMember = db
      .prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .get([chat.id, userId]);

    const unread_count = lastMsg
      ? db.prepare(
          `SELECT COUNT(*) as cnt FROM messages
           WHERE chat_id = ? AND created_at > ? AND deleted_at IS NULL AND sender_id != ?`
        ).get([chat.id, myMember?.last_read_at ?? 0, userId])?.cnt ?? 0
      : 0;

    const partner = chat.type === 'direct'
      ? members.find((m) => m.id !== userId) : null;
    const partner_last_read_at = partner
      ? db.prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
          .get([chat.id, partner.id])?.last_read_at ?? 0
      : chat.type === 'group'
        ? db.prepare('SELECT MAX(last_read_at) as maxr FROM chat_members WHERE chat_id = ? AND user_id != ?')
            .get([chat.id, userId])?.maxr ?? 0
        : 0;

    return {
      ...chat,
      members,
      last_message: lastMsg ? decryptMessage(lastMsg) : null,
      unread_count: unread_count || 0,
      partner_last_read_at,
    };
  });
}

/**
 * Creates a group chat with a name, optional description, and at least 2 members (creator + 1+).
 */
function createGroupChat(name, creatorId, memberIds, description) {
  const db = getDb();

  // Filter out members who have blocked group adds
  const validMemberIds = memberIds.filter(id => {
    const u = db.prepare('SELECT no_group_add FROM users WHERE id = ?').get(id);
    return !u?.no_group_add;
  });

  const allMembers = [...new Set([creatorId, ...validMemberIds])];
  if (allMembers.length < 2) {
    throw Object.assign(new Error('Добавьте хотя бы одного участника'), { status: 400 });
  }

  const chatId = uuidv4();
  const now = Date.now();
  const desc = description ? description.trim() : null;

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO chats (id, type, name, description, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run([chatId, 'group', name.trim(), desc, creatorId, now]);
    for (const memberId of allMembers) {
      db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, memberId, now]);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getChatById(chatId, creatorId);
}

/**
 * Finds or creates a direct chat between two users.
 */
function getOrCreateDirectChat(userAId, userBId) {
  const db = getDb();

  const existing = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
       JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    )
    .get([userAId, userBId]);

  if (existing) return getChatById(existing.id, userAId);

  const chatId = uuidv4();
  const now = Date.now();

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO chats (id, type, created_at) VALUES (?, ?, ?)').run([chatId, 'direct', now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userAId, now]);
    db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, userBId, now]);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getChatById(chatId, userAId);
}

function getChatById(chatId, userId) {
  const db = getDb();
  const chat = db.prepare(
    'SELECT id, type, name, description, avatar_url, created_at, creator_id FROM chats WHERE id = ?'
  ).get(chatId);
  if (!chat) return null;

  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) return null;

  const members = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.last_seen_at
       FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`
    )
    .all(chatId)
    .map(sanitizeUser);

  const lastMsg = db
    .prepare('SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(chatId);

  const partner = chat.type === 'direct' ? members.find(m => m.id !== userId) : null;
  const partner_last_read_at = partner
    ? db.prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?')
        .get([chatId, partner.id])?.last_read_at ?? 0
    : chat.type === 'group'
      ? db.prepare('SELECT MAX(last_read_at) as maxr FROM chat_members WHERE chat_id = ? AND user_id != ?')
          .get([chatId, userId])?.maxr ?? 0
      : 0;

  return {
    ...chat,
    members,
    last_message: lastMsg ? decryptMessage(lastMsg) : null,
    unread_count: 0,
    partner_last_read_at,
  };
}

function markChatAsRead(chatId, userId) {
  const db = getDb();
  const now = Date.now();
  db.prepare('UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ?').run([now, chatId, userId]);
  return now;
}

function addChatMember(chatId, requesterId, newUserId) {
  const db = getDb();
  const chat = db.prepare('SELECT creator_id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') throw Object.assign(new Error('Chat not found'), { status: 404 });

  // Only the creator can add members
  if (chat.creator_id !== requesterId) {
    throw Object.assign(new Error('Only the group creator can add members'), { status: 403 });
  }

  const existing = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, newUserId]);
  if (existing) throw Object.assign(new Error('User already in chat'), { status: 409 });

  // Check if target user has blocked group adds
  const targetUser = db.prepare('SELECT no_group_add FROM users WHERE id = ?').get(newUserId);
  if (targetUser?.no_group_add) {
    throw Object.assign(new Error('Этот пользователь запретил добавлять себя в группы'), { status: 403 });
  }

  db.prepare('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)').run([chatId, newUserId, Date.now()]);
  return getChatById(chatId, requesterId);
}

function removeChatMember(chatId, requesterId, targetUserId) {
  const db = getDb();
  const chat = db.prepare('SELECT creator_id FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (chat.creator_id !== requesterId && requesterId !== targetUserId) {
    throw Object.assign(new Error('Only creator can remove members'), { status: 403 });
  }

  // Get target user name for system message
  const targetUser = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(targetUserId);
  const targetName = targetUser?.display_name || targetUser?.username || 'Пользователь';

  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run([chatId, targetUserId]);

  const updatedChat = getChatById(chatId, requesterId);
  const remaining = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId).map(r => r.user_id);

  // System message for remaining members
  const systemText = `Администратор удалил(а) ${targetName} из группы`;
  const sysMsg = saveMessage(chatId, requesterId, systemText, {}, true);

  return { updatedChat, sysMsg, remaining };
}

function leaveGroup(chatId, userId) {
  const db = getDb();
  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat || chat.type !== 'group') throw Object.assign(new Error('Not a group'), { status: 400 });

  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Not a member'), { status: 403 });

  const user = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(userId);
  const userName = user?.display_name || user?.username || 'Пользователь';

  // Remove member first
  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run([chatId, userId]);

  // Get remaining members
  const remaining = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);

  // Send system message visible to remaining members
  let sysMsg = null;
  if (remaining.length > 0) {
    const systemText = `${userName} покинул(а) чат`;
    sysMsg = saveMessage(chatId, userId, systemText, {}, true);
  }

  return { sysMsg, remaining: remaining.map(r => r.user_id) };
}

function deleteDirectChat(chatId, userId) {
  const db = getDb();
  const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });

  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  if (chat.type !== 'direct') throw Object.assign(new Error('Use leave for groups'), { status: 400 });

  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  db.prepare('DELETE FROM chats WHERE id = ?').run([chatId]);

  return members.map(m => m.user_id);
}

function updateChatMetadata(chatId, requesterId, { name, description, avatar_url }) {
  const db = getDb();
  const chat = db.prepare('SELECT creator_id FROM chats WHERE id = ?').get(chatId);
  if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (chat.creator_id !== requesterId) throw Object.assign(new Error('Only creator can update chat'), { status: 403 });
  if (name !== undefined) db.prepare('UPDATE chats SET name = ? WHERE id = ?').run([name, chatId]);
  if (description !== undefined) db.prepare('UPDATE chats SET description = ? WHERE id = ?').run([description, chatId]);
  if (avatar_url !== undefined) db.prepare('UPDATE chats SET avatar_url = ? WHERE id = ?').run([avatar_url, chatId]);
  return getChatById(chatId, requesterId);
}

function getUserById(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function updateUser(userId, { username, display_name, avatar_url, bio, birth_date, hide_bio, hide_birth_date, no_group_add }) {
  const db = getDb();
  if (username !== undefined && username !== null) {
    const clean = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(clean)) throw Object.assign(new Error('Invalid username'), { status: 400 });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run([clean, userId]);
  }
  if (display_name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run([display_name, userId]);
  if (avatar_url !== undefined) db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run([avatar_url, userId]);
  if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run([bio, userId]);
  if (birth_date !== undefined) db.prepare('UPDATE users SET birth_date = ? WHERE id = ?').run([birth_date, userId]);
  if (hide_bio !== undefined) db.prepare('UPDATE users SET hide_bio = ? WHERE id = ?').run([hide_bio ? 1 : 0, userId]);
  if (hide_birth_date !== undefined) db.prepare('UPDATE users SET hide_birth_date = ? WHERE id = ?').run([hide_birth_date ? 1 : 0, userId]);
  if (no_group_add !== undefined) db.prepare('UPDATE users SET no_group_add = ? WHERE id = ?').run([no_group_add ? 1 : 0, userId]);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function searchUsers(q, excludeId) {
  const db = getDb();
  const like = `%${q.toLowerCase()}%`;
  return db
    .prepare(
      `SELECT id, username, display_name, avatar_url, last_seen_at, no_group_add FROM users
       WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
       LIMIT 20`
    )
    .all([excludeId, like, like])
    .map(u => ({ ...sanitizeUser(u), no_group_add: u.no_group_add ? true : false }));
}

function getChatMessages(chatId, userId, { limit = 50, before = null } = {}) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, userId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const rows = before
    ? db.prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND created_at < ?
         ORDER BY created_at DESC LIMIT ?`
      ).all([chatId, before, limit])
    : db.prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ?`
      ).all([chatId, limit]);

  return rows.reverse().map(decryptMessage);
}

function saveMessage(chatId, senderId, text, attachment = {}, isSystem = false) {
  const db = getDb();
  if (!isSystem) {
    const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
    if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const { ciphertext, iv, authTag } = encrypt(text || '');
  const msgId = uuidv4();
  const now = Date.now();

  db.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, ciphertext, iv, auth_tag, created_at, attachment_url, attachment_type, attachment_name, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run([
    msgId, chatId, senderId, ciphertext, iv, authTag, now,
    attachment.attachment_url || null,
    attachment.attachment_type || null,
    attachment.attachment_name || null,
    isSystem ? 1 : 0,
  ]);

  return decryptMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId));
}

function toggleReaction(msgId, userId) {
  const db = getDb();
  const msg = db.prepare('SELECT liked_by FROM messages WHERE id = ?').get(msgId);
  if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
  let liked = JSON.parse(msg.liked_by || '[]');
  liked = liked.includes(userId) ? liked.filter((id) => id !== userId) : [...liked, userId];
  db.prepare('UPDATE messages SET liked_by = ? WHERE id = ?').run([JSON.stringify(liked), msgId]);
  return liked;
}

/**
 * Soft-delete messages that belong to senderId.
 * Returns array of actually deleted IDs.
 */
function deleteMessages(chatId, senderId, messageIds) {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get([chatId, senderId]);
  if (!member) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const now = Date.now();
  const deleted = [];
  for (const msgId of messageIds) {
    const msg = db.prepare('SELECT id, sender_id FROM messages WHERE id = ? AND chat_id = ?').get([msgId, chatId]);
    if (!msg || msg.sender_id !== senderId) continue; // skip foreign messages
    db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run([now, msgId]);
    deleted.push(msgId);
  }
  return deleted;
}

module.exports = {
  getUserChats, createGroupChat, getOrCreateDirectChat, getChatById,
  markChatAsRead, addChatMember, removeChatMember, updateChatMetadata,
  leaveGroup, deleteDirectChat,
  getUserById, updateUser, searchUsers, getChatMessages, saveMessage,
  toggleReaction, deleteMessages, sanitizeUser,
};
