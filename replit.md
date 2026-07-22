# Solence - Voice AI Companion

## Overview
Solence is a voice-first AI companion app for meditation, reflection, and emotional support. Users interact with a calming breathing orb to have voice conversations with an AI assistant. Solence is positioned as an adaptive AI presence that grows and evolves with each user's input.

## Current State
- MVP complete with voice recording UI and text input
- Breathing orb animation with idle/listening/responding/speaking states
- Text input field for typing messages (like ChatGPT) with send button
- Starter prompts populate text input on tap
- Daily usage tracking (5 free messages per day)
- Subscription prompt modal
- Dark/light mode support
- Email/password authentication with JWT (register/login/sign-out)
- Sign in with Apple on iOS (native button on Auth screen, links to existing email accounts on first use)
- Disclaimer → User Agreement → Onboarding → Main flow for new users
- V1 Solence persona: calm, warm, grounded, emotionally intelligent AI companion
- Web audio playback uses native HTML5 Audio with safety timeout
- Brand aligned with solence.ai (official icon, colors, font)
- Test account for Apple review: testuser@solence.ai / TestPass123

### Sign in with Apple — accepted audiences
The `/api/auth/apple` endpoint verifies the Apple identity token against a list
of allowed `aud` (audience) values. The list defaults to the production iOS
bundle ID `com.solence.app` and can be extended via the `APPLE_BUNDLE_IDS`
env var (comma-separated, e.g. `com.solence.app.dev,com.solence.app.staging`).
If "Sign in with Apple" starts returning "Could not verify Apple identity
token" with `unexpected "aud" claim value`, check the server logs — the
verifier now logs the offending `tokenAud`/`tokenIss` alongside the
`acceptedAudiences` list — and add the actual `aud` value to
`APPLE_BUNDLE_IDS` (this usually happens when the App Store / provisioning
profile bundle differs from `com.solence.app`).

## Project Architecture

### Frontend (React Native/Expo)
- **client/screens/DisclaimerScreen.tsx** - "Before You Begin" disclaimer with checkbox consent and link to User Agreement
- **client/screens/UserAgreementScreen.tsx** - Full scrollable legal User Agreement (10 sections)
- **client/screens/OnboardingScreen.tsx** - "Welcome to Solence" single-page welcome with conversation starters and "Grow your own Solence" tagline
- **client/screens/AuthScreen.tsx** - Email/password sign-in/sign-up screen
- **client/screens/SolenceScreen.tsx** - Main voice interface with orb, text input, and audio playback
- **client/navigation/RootStackNavigator.tsx** - Navigation with Auth → Disclaimer → (User Agreement) → Onboarding → Main flow
- **client/constants/theme.ts** - Solence brand colors (burnt orange #D66B32, warm cream #FAF1E7)
- **client/App.tsx** - App root with providers, M PLUS Rounded 1c font loading
- **metro.config.js** - Metro bundler config excluding .local and .git directories

### Backend (Express)
- **server/index.ts** - Express server on port 5000
- **server/routes.ts** - Voice API with Solence V1 persona system prompt
- **server/db.ts** - Database connection (Neon PostgreSQL)
- **server/replit_integrations/audio/** - OpenAI audio integration (speech-to-text, text-to-speech)
- **shared/schema.ts** - Database schema (conversations, messages tables)

### Voice Chat API
- POST `/api/chat/voice` with JSON body containing `audio` (base64) and/or `text`, plus `sessionId`
- When audio is provided: transcribes via STT first (supports all mobile formats: m4a, mp4, webm, wav, mp3), then uses a two-call flow: gpt-5.1 generates the reply text (text-only, normal text pricing), then gpt-4o-mini-tts synthesizes the spoken audio from that text (much cheaper than the previous single gpt-audio call, whose audio output tokens cost ~$64/1M). Token accounting sums the chat call's usage plus an estimate of TTS input tokens (~4 chars/token; the TTS endpoint doesn't report usage)
- No ffmpeg dependency - uses OpenAI transcription API which natively handles all audio formats
- Returns JSON with `text`, `userTranscript`, `audioBase64`, `audioFormat`, `tokensUsed`, `tokensRemaining`, `tokenLimit`, `nextResetAt`, `period`
- GET `/api/tokens` returns current token usage balance, daily limit, and the next reset timestamp
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

3. **Token-Based Usage Tracking** - Server-side daily token limit
   - 15,000 free tokens per UTC day (FREE_TOKEN_LIMIT in shared/schema.ts)
   - Tracked via `token_usage` table in PostgreSQL (indexed on user_id + period_start)
   - GET /api/tokens returns current usage, remaining balance, and `nextResetAt`
   - Each request atomically check-and-reserves 500 tokens inside a transaction
     so concurrent requests cannot collectively exceed the daily cap
   - Actual token usage from OpenAI response is recorded after each call
   - Failed STT (no transcript) refunds the 500-token reservation
   - Server errors before the LLM call also refund the reservation
   - Frontend header shows a daily-usage progress indicator: "X of 15.0k used today",
     a thin progress bar (track + fill), and a secondary line "Resets ..." with
     the relative or local-time reset moment
   - The label and bar fill switch from a muted neutral to the orange brand color
     when remaining drops below ~20% of the daily cap (or hits zero)
   - Frontend refreshes the balance on app foreground and shortly after the
     next reset moment so the new day's quota appears automatically
   - Resets daily at 00:00 UTC; UI shows local time ("Comes back tomorrow at 5:00 PM")

4. **Subscription Modal** - Triggered when token limit reached (429 from server)

5. **Onboarding Flow** - Three-stage flow for new users:
   - Disclaimer with checkbox consent
   - Optional User Agreement (full legal text)
   - Welcome screen with conversation starters

6. **Breathing & Grounding mini-experience** - 60-second guided breath ritual
   - "Take a breath" chip on the Solence home screen (visible alongside starter prompts)
   - Tapping opens a full-screen modal (`BreathingScreen.tsx`) with a gently
     expanding/contracting orb on a 4-7-8 cadence (4s inhale, 7s hold, 8s exhale)
   - Phase label fades between "Breathe in" / "Hold" / "Breathe out" in sync with the orb
   - Light haptic at every phase transition, success haptic at completion (skipped on web)
   - Runs 3 cycles (~57s) then shows a soft "How do you feel?" prompt with two options:
     "Start a conversation" (returns to home with a pre-filled starter) or "Close"
   - Closeable any time via the X button (or hardware back on Android)
   - Registered as a modal route in `RootStackNavigator` (`Breathing`)

7. **Saved Moments (favorites)** - Bookmark assistant responses worth revisiting
   - Bookmark icon on every assistant bubble in ConversationDetail (optimistic toggle)
   - "Saved moments" card on Profile lists newest favorites with conversation source + snippet
   - Tapping a saved moment opens the source conversation scrolled to that message with a brief highlight
   - Backend: `favorites` table (unique on userId+messageId, FK cascade), endpoints
     `POST/DELETE /api/messages/:id/favorite` (idempotent, assistant-only) and
     `GET /api/favorites?limit=20`. Messages list endpoint enriches each row with `isFavorite`.

7. **Share as quote card** - Long-press any assistant message (in ConversationDetail or
   on a saved-moment row in Profile) opens a bottom action sheet with three options:
   "Save / Remove", "Share as quote card", and "Copy text". Selecting share opens a
   preview modal rendering a brand-styled QuoteCard (cream background, orange orb mark,
   "Solence — solence.ai" attribution). Tapping Share captures the card via
   `react-native-view-shot` and opens the system share sheet via `expo-sharing` on
   native; on web it triggers a PNG download. Messages over 280 characters render a
   friendly "too long to fit beautifully" notice and recommend Copy text instead.
   Components: `client/components/{QuoteCard,MessageActionSheet,ShareQuoteModal}.tsx`.

## Design System
Colors are defined in `client/constants/theme.ts`:
- Light background: #FAF1E7 (warm cream, matching solence.ai)
- Dark background: #1a1625 (deep purple-black)
- Orb/accent primary: #D66B32 (burnt orange, matching solence.ai)
- Orb/accent secondary: #E8945E (warm orange)
- Text: #403E3E (dark warm gray, matching solence.ai)

Font: M PLUS Rounded 1c (via @expo-google-fonts/m-plus-rounded-1c)
- Loaded in App.tsx with useFonts hook
- Applied globally on web via CSS injection
- Font weights: 300 Light, 400 Regular, 500 Medium, 700 Bold

App icon: Official Solence sunrise/heart mark from solence.ai website

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

## Publishing (deployment build)
- Build cmd: `node tools/build-with-prewarm.js && npm run server:build`
- `tools/build-with-prewarm.js` patches `@react-native/debugger-shell` to a no-op
  (avoids Chromium SUID-sandbox failure in the build container) AND pre-starts
  Metro with a 5-minute readiness window before invoking `scripts/build.js`
  (which only allows 60s). When `scripts/build.js` runs, it sees Metro already
  on `:8081/status` and skips its own short-timeout startup, going straight to
  bundle download.
- Run cmd: `npm run server:prod`. Target: autoscale.

## User Preferences
- Minimal, organic design aesthetic
- Burnt orange / warm cream color palette (from solence.ai brand)
- M PLUS Rounded 1c font (from solence.ai brand)
- No emojis in the app
- Single-screen experience (no navigation tabs)
- "Giga pet" companion concept: Solence grows with the user
