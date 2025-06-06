import mongoose from 'mongoose';
import { CONVERSATION_STATES } from '../prompts/chatPrompts.js';

const chatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  messages: [{
    role: {
      type: String,
      enum: ['system', 'user', 'assistant'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  userInfo: {
    name: String,
    stream: String,
    selectedRole: String
  },
  state: {
    type: String,
    enum: Object.values(CONVERSATION_STATES),
    default: CONVERSATION_STATES.INITIAL
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Update lastActive timestamp before saving
chatSessionSchema.pre('save', function(next) {
  this.lastActive = new Date();
  next();
});

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

export default ChatSession; 