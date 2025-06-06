import { v4 as uuidv4 } from 'uuid';
import ChatSession from './models/ChatSession.js';
import { getSystemPrompt, CONVERSATION_STATES, WELCOME_MESSAGE, STREAMS, CAREER_CATEGORIES, FORMATTING_RULES } from './prompts/chatPrompts.js';

// Helper function to get or create chat session
export const getOrCreateChatSession = async (req) => {
  try {
    let chatSession;

    console.log('req.session:', req.session);
    
    // Ensure we have a valid session ID
    if (!req.session.id) {
      req.session.id = uuidv4();
    }
    
    if (req.session.chatSessionId) {
      chatSession = await ChatSession.findOne({ sessionId: req.session.chatSessionId });
    }
    
    if (!chatSession) {
      const sessionId = uuidv4();
      chatSession = new ChatSession({
        sessionId,
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
        state: CONVERSATION_STATES.INITIAL,
        userInfo: {}
      });
      await chatSession.save();
      req.session.chatSessionId = sessionId;
      await req.session.save(); // Ensure session is saved
    }
    
    return chatSession;
  } catch (error) {
    console.error('Error in getOrCreateChatSession:', error);
    throw new Error('Failed to get or create chat session');
  }
};

// Helper function to update conversation state
export const updateConversationState = (chatSession, message) => {
  const lowerMessage = message.toLowerCase();
  
  // Only update name if we're in the ASK_USER_INFO state and don't have a name yet
  if (chatSession.state === CONVERSATION_STATES.ASK_USER_INFO && !chatSession.userInfo.name) {
    chatSession.userInfo.name = message.trim();
    chatSession.state = CONVERSATION_STATES.ASK_STREAM;
    return;
  }

  if (!chatSession.userInfo.stream) {
    // Check if the message contains any of the valid streams
    const validStream = STREAMS.find(stream => 
      lowerMessage.includes(stream.toLowerCase())
    );
    
    if (validStream) {
      chatSession.userInfo.stream = validStream;
      chatSession.state = CONVERSATION_STATES.SHOW_CATEGORIES;
    }
    return;
  }

  if (!chatSession.userInfo.selectedRole) {
    // Check if message contains any of the roles from any category
    const allRoles = [
      ...CAREER_CATEGORIES.legacy.roles,
      ...CAREER_CATEGORIES.current.roles,
      ...CAREER_CATEGORIES.emerging.roles,
      ...CAREER_CATEGORIES.future.roles
    ];
    
    const selectedRole = allRoles.find(role => 
      lowerMessage.includes(role.toLowerCase())
    );
    
    if (selectedRole) {
      chatSession.userInfo.selectedRole = selectedRole;
      chatSession.state = CONVERSATION_STATES.IN_SIMULATION;
    }
  }
}; 