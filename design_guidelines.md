# Solence Mobile App - Design Guidelines

## Brand Identity

**Purpose**: Solence is a voice-first AI companion for meditation, reflection, and emotional support. It provides users with a calming, judgment-free space for daily conversations.

**Aesthetic Direction**: **Organic minimalism** - The app embodies stillness and warmth through:
- A breathing, living orb as the singular focal point
- Earthy, natural color palette (terracotta, warm neutrals)
- Maximum whitespace and restraint
- Gentle, slow animations that mimic natural breathing

**Memorable Element**: The central orb is the app's identity - it breathes when idle, pulses when listening, and serves as the only interactive element on screen.

## Navigation Architecture

**Structure**: Single-screen app (no tabs, no drawer)
- Main screen: Voice interaction interface
- Modal overlay: Subscription prompt (triggered when free limit reached)

The app intentionally has NO traditional navigation to create focus and remove distractions.

## Screen Specifications

### Main Screen (Solence Voice Interface)

**Purpose**: Enable voice conversations with the AI companion

**Layout**:
- Header: Transparent, centered
  - App title "Solence" (28pt, ultra-light weight, 2px letter-spacing)
  - Usage counter below (14pt, muted) - shows "X messages left today" for free users, hidden for subscribers
- Content area: Non-scrollable, vertically centered
  - Central orb (60% of screen width)
  - State text below orb (16pt, lightweight)
  - Message display area at bottom (max 200pt height, centered text)
- No bottom navigation
- Top safe area inset: insets.top + 40pt
- Bottom safe area inset: insets.bottom + 40pt

**Components**:
- **Breathing Orb**:
  - Radial gradient sphere (terracotta to dark brown)
  - Glow effect behind orb (30% opacity, 130% of orb size)
  - Animation states:
    - Idle: Slow breathing (4s expand to 105%, 4s contract, loop)
    - Listening: Fast pulse (0.6s to 90%, 0.6s to 60%, loop)
    - Responding: Static at 100%
    - Speaking: Static at 100%
  - Tap interaction: Records audio when idle, stops recording when listening
  - Disabled during responding/speaking states
- **State Text**: Single line below orb
  - "Tap to speak" (idle)
  - "Listening..." (recording)
  - "Thinking..." (processing)
  - "Speaking..." (playing response)
- **Message Display**: Appears after AI response
  - Centered text block
  - 18pt font, 28pt line height
  - Fades in when response received
  - Remains until next interaction

**Empty State**: The idle orb IS the empty state - no additional illustration needed.

### Subscription Modal

**Purpose**: Convert free users to paid subscribers after daily limit

**Trigger**: Attempting to send 6th message in a day (free tier allows 5)

**Layout**:
- Full-screen overlay (70% black transparency)
- Centered modal card (340pt max width, 20pt padding)
- Close behavior: Tap "Maybe Later" or anywhere outside modal

**Components**:
- Title: "Unlock Unlimited Conversations" (22pt, semibold)
- Description: 2-3 sentences explaining limit reached (16pt, 24pt line height)
- Primary CTA: "Subscribe - $15.99/month" button (full-width, 30pt border radius, 16pt vertical padding)
- Secondary action: "Maybe Later" text button (12pt vertical padding)

**Modal Specs**:
- Background: Matches app background color (dark or light)
- Border radius: 20pt
- Shadow: None (overlay provides depth)

## Color Palette

**Light Mode**:
- Background: `#faf8f5` (warm off-white)
- Text: `#2d2a26` (dark warm gray)
- Text Muted: `#6b6560` (medium warm gray)
- Orb Primary: `#9d6b53` (terracotta)
- Orb Secondary: `#c4956c` (warm tan)
- Orb Glow: `rgba(196, 149, 108, 0.3)`
- Button Primary: `#9d6b53` (terracotta)
- Button Text: `#ffffff`

**Dark Mode**:
- Background: `#1a1625` (deep purple-black)
- Text: `#e8e4e0` (warm off-white)
- Text Muted: `#a09890` (warm gray)
- Orb colors: Same as light mode
- Button Primary: `#9d6b53`
- Button Text: `#ffffff`

## Typography

**Font**: System default (San Francisco on iOS, Roboto on Android)

**Type Scale**:
- Title (App name): 28pt, weight 300, 2px letter-spacing
- Message: 18pt, weight 300, 28pt line height
- State Text: 16pt, weight 300
- Usage Counter: 14pt, regular weight
- Subscription Title: 22pt, weight 600
- Subscription Body: 16pt, regular, 24pt line height
- Button: 18pt, weight 600

All text is center-aligned except where noted.

## Visual Design

**Interaction Feedback**:
- Orb: Scale animation on press (no shadow)
- Buttons: 90% opacity on press
- Modal buttons: Slight scale down (95%) on press

**Shadows**: AVOID shadows except for orb glow effect (which is a soft gradient, not a drop shadow).

**Icons**: This app uses NO icons - the orb is the only visual element.

## Assets to Generate

1. **icon.png** - App icon
   - Simplified orb on solid background
   - Terracotta gradient sphere
   - WHERE USED: Device home screen

2. **splash-icon.png** - Launch screen
   - Same as app icon
   - WHERE USED: App launch splash

3. **orb-gradient.png** (Optional reference asset)
   - The orb's radial gradient rendered as static image
   - WHERE USED: Reference for developers if SVG gradient is difficult

**No other assets needed** - The app's strength is its extreme simplicity.

## Implementation Notes

**Audio Permissions**: Request microphone access on first tap of orb (standard system permission alert).

**Animation Performance**: All animations must use native drivers for 60fps smoothness - this is critical for the "breathing" meditative feel.

**Accessibility**: Provide VoiceOver labels for orb states ("Tap to speak", "Recording your message", etc.) since there are no text buttons.