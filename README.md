# Career-Verse Backend

This is the backend server for the Career-Verse AI career simulator.

## Setup Instructions

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:

```
PORT=5000
OPENAI_API_KEY=your_openai_api_key_here
```

3. Start the development server:

```bash
npm run dev
```

## API Endpoints

### POST /api/conversation

Send a message to the AI career coach.

Request body:

```json
{
  "message": "Your message here",
  "context": [
    {
      "role": "user",
      "content": "Previous message"
    },
    {
      "role": "assistant",
      "content": "Previous response"
    }
  ]
}
```

### GET /api/health

Health check endpoint to verify the server is running.

## Technologies Used

- Node.js
- Express
- OpenAI GPT-4
- CORS
- dotenv
