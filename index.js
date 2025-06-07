import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import connectDB from './config/db.js';
import openai from './config/openai.js';
import { getSystemPrompt, CONVERSATION_STATES, WELCOME_MESSAGE } from './prompts/chatPrompts.js';
import ChatSession from './models/ChatSession.js';
import { getOrCreateChatSession, updateConversationState } from './chatUtils.js';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
connectDB();

// Verify environment variables
const requiredEnvVars = ['OPENAI_API_KEY', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// CORS Configuration
app.use(cors({
  origin: ['https://ai-career-counselor-app.vercel.app', 'http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5500'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
  exposedHeaders: ['X-Session-ID']
}));

// Middleware
app.use(bodyParser.json());

// Input validation middleware
const validateMessage = (req, res, next) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Message must be a string' });
  }
  
  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message is too long (max 1000 characters)' });
  }
  
  if (message.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }
  
  next();
};

// Routes
app.post('/api/conversation', validateMessage, async (req, res) => {
  try {
    const { message, context } = req.body;

    // Debug logging
    console.log('Request details:', {
      message,
      contextLength: context?.length,
      context: context
    });

    // Prepare messages for GPT-4
    const messages = [
      {
        role: "system",
        content: getSystemPrompt(CONVERSATION_STATES.INITIAL)
      },
      ...context,
      { role: "user", content: message }
    ];

    console.log('Sending to GPT-4:', {
      messageCount: messages.length,
      lastUserMessage: message
    });

    // Log OpenAI API request
    console.log('OpenAI API Request:', {
      model: "gpt-4",
      messageCount: messages.length,
      temperature: 0.7,
      max_tokens: 500
    });

    // Get response from GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: messages,
      temperature: 0.7,
      max_tokens: 500
    });

    // Log OpenAI API response
    console.log('OpenAI API Response:', {
      status: 'success',
      responseLength: completion.choices[0].message.content.length,
      usage: completion.usage
    });

    const response = completion.choices[0].message.content;
    console.log('GPT-4 Response:', response);

    // Update context with both user message and assistant response
    const updatedContext = [
      ...context,
      { role: "user", content: message },
      { role: "assistant", content: response }
    ];

    console.log('Updated context length:', updatedContext.length);

    res.json({
      response: response,
      context: updatedContext
    });
  } catch (error) {
    console.error('Detailed error in /api/conversation:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
});

app.post('/api/chat', validateMessage, async (req, res) => {
  try {
    const { message } = req.body;
    const sessionId = req.headers['x-session-id'];

    let chatSession = null;
    let isNewSession = false;

    if (sessionId) {
      chatSession = await ChatSession.findOne({ sessionId });
    }

    if (!chatSession) {
      // Create new session if none exists
      const newSessionId = uuidv4();
      chatSession = new ChatSession({
        sessionId: newSessionId,
        messages: [
          {
            role: 'system',
            content: getSystemPrompt(CONVERSATION_STATES.INITIAL)
          },
          {
            role: 'assistant',
            content: WELCOME_MESSAGE
          }
        ],
        state: CONVERSATION_STATES.ASK_USER_INFO,
        userInfo: {}
      });
      await chatSession.save();
      isNewSession = true;
      console.log('Created new session:', newSessionId);
    }

    console.log('Chat session:', chatSession);

    // Update conversation state based on user message
    updateConversationState(chatSession, message);

    // Add user message to session
    chatSession.messages.push({
      role: 'user',
      content: message
    });

    let response;
    if (isNewSession) {
      // For new sessions, send the welcome message
      response = WELCOME_MESSAGE;
      chatSession.messages.push({
        role: 'assistant',
        content: response
      });
    } else {
      // For existing sessions, get response from GPT-4
      const messages = [
        {
          role: 'system',
          content: getSystemPrompt(chatSession.state, chatSession.userInfo)
        },
        ...chatSession.messages.slice(1).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      console.log('Sending to GPT-4:', {
        messageCount: messages.length,
        lastUserMessage: message,
        state: chatSession.state,
        userInfo: chatSession.userInfo
      });

      // Log OpenAI API request
      console.log('OpenAI API Request:', {
        model: "gpt-3.5-turbo",
        messageCount: messages.length,
        temperature: 0.3,
        max_tokens: 700,
        state: chatSession.state
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: messages,
        temperature: 0.3,
        max_tokens: 700
      });

      // Log OpenAI API response
      console.log('OpenAI API Response:', {
        status: 'success',
        responseLength: completion.choices[0].message.content.length,
        usage: completion.usage,
        state: chatSession.state
      });

      response = completion.choices[0].message.content;

      // Add assistant response to session
      chatSession.messages.push({
        role: 'assistant',
        content: response
      });
    }

    // Save updated session
    await chatSession.save();

    res.json({
      response: response,
      sessionId: chatSession.sessionId,
      state: chatSession.state,
      userInfo: chatSession.userInfo
    });
  } catch (error) {
    console.error('Detailed error in /api/chat:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
});

// Get chat history
app.get('/api/chat/history', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];

    if (!sessionId) {
      console.log('No session ID found in request');
      return res.json({ messages: [], userInfo: {}, sessionId: null });
    }

    const chatSession = await ChatSession.findOne({ sessionId });
    console.log('Found chat session:', chatSession ? 'Yes' : 'No');
    
    if (!chatSession) {
      console.log('No chat session found in database');
      return res.json({ messages: [], userInfo: {}, sessionId: null });
    }

    // Filter out system messages and welcome message
    const filteredMessages = chatSession.messages.filter(msg => 
      msg.role !== 'system' && 
      !(msg.role === 'assistant' && msg.content === WELCOME_MESSAGE)
    );

    res.json({
      messages: filteredMessages,
      userInfo: chatSession.userInfo || {},
      sessionId: chatSession.sessionId
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get chat history by session ID
app.get('/api/chat/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const chatSession = await ChatSession.findOne({ sessionId });
    if (!chatSession) {
      return res.json({ messages: [], sessionId: null });
    }

    res.json({
      messages: chatSession.messages,
      userInfo: chatSession.userInfo,
      sessionId: chatSession.sessionId
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Update user info
app.post('/api/chat/user-info', async (req, res) => {
  try {
    const { name, stream, selectedRole } = req.body;
    const sessionId = req.headers['x-session-id'];

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const chatSession = await ChatSession.findOne({ sessionId });
    if (!chatSession) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    // Only update userInfo if valid values are provided
    const userInfo = {};
    
    // Only set name if it's provided and not empty
    if (name && typeof name === 'string' && name.trim().length > 0) {
      userInfo.name = name.trim();
    }
    
    // Only set stream if it's provided
    if (stream) {
      userInfo.stream = stream;
    }
    
    // Only set selectedRole if it's provided
    if (selectedRole) {
      userInfo.selectedRole = selectedRole;
    }

    // Only update userInfo if we have valid data
    if (Object.keys(userInfo).length > 0) {
      chatSession.userInfo = {
        ...chatSession.userInfo,  // Preserve existing userInfo
        ...userInfo              // Add new userInfo
      };
      await chatSession.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user info:', error);
    res.status(500).json({ error: 'Failed to update user info' });
  }
});

// Start new session
app.post('/api/chat/new-session', async (req, res) => {
  try {
    console.log('Starting new session process...');

    // Create a new chat session
    const newSessionId = uuidv4();
    const newChatSession = new ChatSession({
      sessionId: newSessionId,
      messages: [
        {
          role: 'system',
          content: getSystemPrompt(CONVERSATION_STATES.INITIAL)
        }
      ],
      state: CONVERSATION_STATES.ASK_USER_INFO,
      userInfo: {}
    });

    await newChatSession.save();
    console.log('New chat session created in MongoDB: ', newSessionId);

    res.json({ 
      success: true,
      message: 'New session created successfully',
      sessionId: newSessionId,
      messages: newChatSession.messages,
      userInfo: newChatSession.userInfo
    });
  } catch (error) {
    console.error('Error in new session endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to start new session',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to CareerVerse API' });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

// Export the Express API
export default app; 