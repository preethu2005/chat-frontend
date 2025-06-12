import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { format, formatDistanceToNow } from 'date-fns';
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';

interface User {
  _id: string;
  username: string;
  socketId: string;
  isOnline: boolean;
  status: 'online' | 'offline' | 'away';
  lastSeen: string;
  lastActive: string;
}

interface Message {
  _id: string;
  content: string;
  sender: {
    _id: string;
    username: string;
  };
  readBy: string[];
  createdAt: string;
  updatedAt: string;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [inputUsername, setInputUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activityTimeoutRef = useRef<NodeJS.Timeout>();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!isJoined || !username) return;

    const socket = io('http://192.168.174.90:3001', {
      withCredentials: true
    });

    setSocket(socket);

    // Fetch initial messages
    fetch('http://192.168.174.90:3001/api/messages')
      .then(res => res.json())
      .then(data => {
        console.log('Initial messages:', data);
        setMessages(data);
      })
      .catch(error => console.error('Error fetching messages:', error));

    // Fetch initial users
    fetch('http://192.168.174.90:3001/api/users')
      .then(res => res.json())
      .then(data => {
        console.log('Initial users:', data);
        setUsers(data);
      })
      .catch(error => console.error('Error fetching users:', error));

    socket.on('connect', () => {
      console.log('Socket connected');
      socket.emit('user:join', username);
    });

    socket.on('user:joined', (data) => {
      console.log('User joined:', data);
      setUsers(data.users);
      setMessages(data.messages);
    });

    socket.on('message:new', (message) => {
      console.log('New message:', message);
      setMessages(prev => [...prev, message]);
    });

    socket.on('users:update', (updatedUsers) => {
      console.log('Users updated:', updatedUsers);
      setUsers(updatedUsers);
    });

    socket.on('user:typing', (data) => {
      console.log('User typing:', data);
      if (data.isTyping) {
        setTypingUsers(prev => [...new Set([...prev, data.username])]);
      } else {
        setTypingUsers(prev => prev.filter(name => name !== data.username));
      }
    });

    socket.on('user:left', (data) => {
      console.log('User left:', data);
      setUsers(data.users);
    });

    return () => {
      socket.disconnect();
    };
  }, [isJoined, username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUsername.trim()) {
      setUsername(inputUsername.trim());
      setIsJoined(true);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim() && socket && activeChatId) {
      socket.emit('message:send', { chatId: activeChatId, content: newMessage });
      setNewMessage('');
    }
  };

  const handleTyping = (isTyping: boolean) => {
    if (socket) {
      socket.emit('user:typing', isTyping);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-500';
      case 'away':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getLastSeenText = (user: User) => {
    if (user.isOnline) {
      return 'Online';
    }
    if (user.status === 'away') {
      return 'Away';
    }
    return `Last seen ${formatDistanceToNow(new Date(user.lastSeen))} ago`;
  };

  // Handle user selection (start or get chat)
  const handleSelectUser = async (user: User) => {
    if (!socket || !user || !username) return;
    setSelectedUser(user);
    // Find self user object
    const self = users.find(u => u.username === username);
    if (!self) return;
    // Create or get chat
    const res = await fetch('http://192.168.174.90:3001/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId1: self._id, userId2: user._id })
    });
    const data = await res.json();
    setActiveChatId(data.chatId);
    // Join chat room
    socket.emit('chat:join', data.chatId);
    // Fetch messages for this chat
    const msgRes = await fetch(`http://192.168.174.90:3001/api/chats/${data.chatId}/messages`);
    const msgs = await msgRes.json();
    setChatMessages(msgs);
    // Mark as read
    await fetch(`http://192.168.174.90:3001/api/chats/${data.chatId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: self._id })
    });
  };

  // Helper to get unread count for a user
  const getUnreadCount = (user: User) => {
    // Find chat between self and user
    const self = users.find(u => u.username === username);
    if (!self) return 0;
    // Find chatId for this user
    // This is a simplification: in a real app, you'd keep a chat list in state
    // For now, we check chatMessages for unread messages from this user
    if (!chatMessages.length || !activeChatId) return 0;
    return chatMessages.filter(
      msg => msg.sender._id === user._id && !msg.readBy.includes(self._id)
    ).length;
  };

  // Listen for new messages in the active chat
  useEffect(() => {
    if (!socket || !activeChatId) return;
    const handler = (message: Message) => {
      setChatMessages(prev => [...prev, message]);
    };
    socket.on('message:new', handler);
    return () => {
      socket.off('message:new', handler);
    };
  }, [socket, activeChatId]);

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Welcome to Chat</h1>
            <p className="text-gray-600">Join the conversation!</p>
          </div>
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                Choose your username
              </label>
              <input
                id="username"
                type="text"
                value={inputUsername}
                onChange={(e) => setInputUsername(e.target.value)}
                placeholder="Enter your username"
                className="input"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Users sidebar */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
        {/* Sidebar header with logged-in user */}
        <div className="p-4 border-b border-gray-200">
          <div className="mb-2 text-xs text-gray-500">Logged in as</div>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-primary-600 font-medium">{getInitials(username)}</span>
            </div>
            <span className="font-semibold text-gray-800">{username}</span>
          </div>
        </div>
        {/* User list, excluding self */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {users.filter(user => user.username !== username).map((user) => (
            <div
              key={user._id}
              className={`flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer ${selectedUser && selectedUser._id === user._id ? 'bg-primary-100 font-semibold' : ''}`}
              onClick={() => handleSelectUser(user)}
            >
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-primary-600 font-medium">{getInitials(user.username)}</span>
                </div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(user.status)}`} />
                {/* Unread badge */}
                {getUnreadCount(user) > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {getUnreadCount(user)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate">{user.username}</p>
                <p className={`text-xs ${
                  user.status === 'online' ? 'text-green-500' :
                  user.status === 'away' ? 'text-yellow-500' :
                  'text-gray-500'
                }`}>
                  {getLastSeenText(user)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Chat header */}
        <div className="h-16 bg-white border-b border-gray-200 flex items-center px-6">
          <h1 className="text-xl font-semibold text-gray-800">Chat Room</h1>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {chatMessages.map((msg) => (
            <div
              key={msg._id}
              className={`flex ${msg.sender._id === socket?.id ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex items-end space-x-2 max-w-[70%] ${msg.sender._id === socket?.id ? 'flex-row-reverse space-x-reverse' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-600 text-sm font-medium">{getInitials(msg.sender.username)}</span>
                </div>
                <div>
                  <div className={`rounded-2xl px-4 py-2 ${
                    msg.sender._id === socket?.id
                      ? 'bg-primary-600 text-white rounded-br-none'
                      : 'bg-white text-gray-800 rounded-bl-none shadow-sm'
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                  <div className={`text-xs text-gray-500 mt-1 ${msg.sender._id === socket?.id ? 'text-right' : 'text-left'}`}>
                    {msg.sender.username} • {format(new Date(msg.createdAt), 'HH:mm')}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
          {typingUsers.length > 0 && (
            <div className="text-sm text-gray-500 italic px-4">
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}
        </div>

        {/* Message input */}
        <div className="p-4 bg-white border-t border-gray-200">
          <form onSubmit={handleSendMessage} className="flex items-center space-x-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onFocus={() => handleTyping(true)}
              onBlur={() => handleTyping(false)}
              placeholder="Type a message..."
              className="input"
            />
            <button type="submit" className="btn btn-primary">
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Fetch users and messages
  useEffect(() => {
    fetch('http://192.168.174.90:3001/api/users')
      .then(res => res.json())
      .then(setUsers);
    fetch('http://192.168.174.90:3001/api/messages')
      .then(res => res.json())
      .then(setMessages);
  }, []);

  // Delete user
  const deleteUser = async (userId: string) => {
    await fetch(`http://192.168.174.90:3001/api/users/${userId}`, { method: 'DELETE' });
    setUsers(users.filter(u => u._id !== userId));
  };

  // Delete message
  const deleteMessage = async (messageId: string) => {
    await fetch(`http://192.168.174.90:3001/api/messages/${messageId}`, { method: 'DELETE' });
    setMessages(messages.filter(m => m._id !== messageId));
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Admin Panel</h1>
      <h2 className="text-xl font-semibold mt-6 mb-2">Users</h2>
      <ul className="mb-8">
        {users.map(user => (
          <li key={user._id} className="flex items-center justify-between border-b py-2">
            <span>{user.username} ({user._id})</span>
            <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={() => deleteUser(user._id)}>Delete</button>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-semibold mt-6 mb-2">Messages</h2>
      <ul>
        {messages.map(msg => (
          <li key={msg._id} className="flex items-center justify-between border-b py-2">
            <span>{msg.sender.username}: {msg.content} ({msg._id})</span>
            <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={() => deleteMessage(msg._id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WrappedApp() {
  return (
    <Router>
      <Routes>
        <Route path="/admin-9f8a7b2c" element={<AdminPage />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </Router>
  );
} 