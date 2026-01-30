
# Radiant Tactical Core | Valorant AI Agent

A multimodal AI agent powered by **Gemini 2.5 Flash Native Audio**. It acts as a real-time tactical assistant for Valorant by "seeing" your gameplay and communicating via low-latency voice.

## Features

- **Visual Intercept**: Captures your screen (1280x720) and streams frames to Gemini.
- **Tactical Analysis**: Detects match score, agent played, and enemy sightings on the minimap.
- **Voice Loop**: Proactive voice communication—the agent speaks when it sees something relevant (no wake word needed).
- **Tactical HUD**: A React-based overlay that visualizes the AI's current assessment of the game state.

## Getting Started

1. Clone this repository.
2. Create a `.env` file in the root directory:
   ```bash
   API_KEY=your_google_genai_api_key
   ```
3. Open `index.html` in a modern browser or serve with a local server (e.g., Vite/Live Server).

## Privacy

The API Key is accessed via `process.env.API_KEY`. Ensure this is never committed to GitHub.
