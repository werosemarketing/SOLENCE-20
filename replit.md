# Solence - Voice AI Companion

## Overview
Solence is a voice-first AI companion app for meditation, reflection, and emotional support. Users interact with a calming breathing orb to have voice conversations with an AI assistant.

## Current State
- MVP complete with voice recording UI
- Breathing orb animation with idle/listening/responding/speaking states
- Daily usage tracking (5 free messages per day)
- Subscription prompt modal
- Dark/light mode support

## Project Architecture

### Frontend (React Native/Expo)
- **client/screens/SolenceScreen.tsx** - Main voice interface with orb
- **client/navigation/RootStackNavigator.tsx** - Single-screen navigation
- **client/constants/theme.ts** - Solence color palette (terracotta, warm neutrals)
- **client/App.tsx** - App root with providers

### Backend (Express)
- **server/index.ts** - Express server on port 5000
- The app expects a voice chat API at `/api/chat/voice` that accepts:
  - POST with FormData containing `audio` (m4a file) and `sessionId`
  - Returns JSON with `text` (response text) and optional `audioUrl` (response audio)

### Key Features
1. **Breathing Orb** - Animated SVG gradient sphere
   - Idle: 4s breathing animation (scale 1.0 → 1.05 → 1.0)
   - Listening: Fast pulse animation (scale 0.95 → 1.15)
   - Responding/Speaking: Static

2. **Voice Recording** - Uses expo-audio for recording
   - Microphone permission handling
   - Audio sent to backend API

3. **Usage Tracking** - AsyncStorage-based daily limit
   - 5 free messages per day
   - Resets at midnight

4. **Subscription Modal** - Triggered when daily limit reached

## Design System
Colors are defined in `client/constants/theme.ts`:
- Light background: #faf8f5 (warm off-white)
- Dark background: #1a1625 (deep purple-black)
- Orb primary: #9d6b53 (terracotta)
- Orb secondary: #c4956c (warm tan)

## Backend API Configuration
The app uses `EXPO_PUBLIC_DOMAIN` environment variable to connect to the backend API. The voice chat endpoint expects:

```
POST /api/chat/voice
Content-Type: multipart/form-data

Request:
- audio: Audio file (m4a)
- sessionId: Session identifier

Response:
{
  "text": "AI response text",
  "audioUrl": "/path/to/response.mp3" (optional)
}
```

## Running the App
- Frontend: `npm run expo:dev` (port 8081)
- Backend: `npm run server:dev` (port 5000)
- Test on device: Scan QR code with Expo Go

## User Preferences
- Minimal, organic design aesthetic
- Terracotta/warm neutral color palette
- No emojis in the app
- Single-screen experience (no navigation tabs)
