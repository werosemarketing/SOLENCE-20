# Solence - Voice AI Companion

## Overview
Solence is a voice-first AI companion app for meditation, reflection, and emotional support. Users interact with a calming breathing orb to have voice conversations with an AI assistant. Solence is positioned as an adaptive AI presence that grows and evolves with each user's input.

## Current State
- MVP complete with voice recording UI
- Breathing orb animation with idle/listening/responding/speaking states
- Daily usage tracking (5 free messages per day)
- Subscription prompt modal
- Dark/light mode support
- Disclaimer → User Agreement → Onboarding → Main flow for new users
- V1 Solence persona: calm, warm, grounded, emotionally intelligent AI companion
- Web audio playback uses native HTML5 Audio for reliability

## Project Architecture

### Frontend (React Native/Expo)
- **client/screens/DisclaimerScreen.tsx** - "Before You Begin" disclaimer with checkbox consent and link to User Agreement
- **client/screens/UserAgreementScreen.tsx** - Full scrollable legal User Agreement (10 sections)
- **client/screens/OnboardingScreen.tsx** - "Welcome to Solence" single-page welcome with conversation starters and "Grow your own Solence" tagline
- **client/screens/SolenceScreen.tsx** - Main voice interface with orb
- **client/navigation/RootStackNavigator.tsx** - Navigation with Disclaimer → (User Agreement) → Onboarding → Main flow
- **client/constants/theme.ts** - Solence color palette (terracotta, warm neutrals)
- **client/App.tsx** - App root with providers

### Backend (Express)
- **server/index.ts** - Express server on port 5000
- **server/routes.ts** - Voice API with Solence V1 persona system prompt
- **server/db.ts** - Database connection (Neon PostgreSQL)
- **server/replit_integrations/audio/** - OpenAI audio integration (speech-to-text, text-to-speech)
- **shared/schema.ts** - Database schema (conversations, messages tables)

### Voice Chat API
- POST `/api/chat/voice` with JSON body containing `audio` (base64) and/or `text`, plus `sessionId`
- When audio is provided: sends audio directly to gpt-audio as input_audio (single API call for response) while running STT in parallel for transcript storage
- Returns JSON with `text`, `userTranscript`, `audioBase64`, `audioFormat`
- Audio playback: Uses native HTML5 Audio on web, expo-audio useAudioPlayer on native

### Key Features
1. **Breathing Orb** - Animated gradient sphere with multiple layers
   - Idle: Slow breathing animation
   - Listening: Fast pulse animation
   - Responding: Gentle pulsing while waiting for API
   - Speaking: Quick pulse during audio playback

2. **Voice Recording** - Uses expo-audio for recording
   - Microphone permission handling
   - Platform-aware base64 encoding (FileReader on web, FileSystem on native)
   - 15-second auto-stop timer
   - Interrupt playback by tapping orb

3. **Usage Tracking** - AsyncStorage-based daily limit
   - 5 free messages per day
   - Resets at midnight

4. **Subscription Modal** - Triggered when daily limit reached

5. **Onboarding Flow** - Three-stage flow for new users:
   - Disclaimer with checkbox consent
   - Optional User Agreement (full legal text)
   - Welcome screen with conversation starters

## Design System
Colors are defined in `client/constants/theme.ts`:
- Light background: #faf8f5 (warm off-white)
- Dark background: #1a1625 (deep purple-black)
- Orb primary: #9d6b53 (terracotta)
- Orb secondary: #c4956c (warm tan)

## Backend API Configuration

The voice chat endpoint expects:

```
POST /api/chat/voice
Content-Type: application/json

Request body:
{
  "audio": "base64-encoded audio data",
  "text": "optional text input",
  "sessionId": "device identifier"
}

Response:
{
  "text": "AI response transcript",
  "userTranscript": "user speech transcript",
  "audioBase64": "base64-encoded mp3 response",
  "audioFormat": "mp3"
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
- "Giga pet" companion concept: Solence grows with the user
