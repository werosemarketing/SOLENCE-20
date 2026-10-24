---
name: Expo preview testing
description: Avoid testing the Metro host instead of the rendered Expo web app.
---

Use the actual URL reported by the app-preview screenshot when directing browser tests, rather than assuming the bare development domain or appending port 8081.

**Why:** In this workspace, the rendered browser app uses an Expo-specific sibling host. Testing the bare development domain led to timeouts or a blank packager/splash page even though the app rendered correctly at the preview URL.

**How to apply:** Obtain the actual app-preview URL and pass it explicitly to the tester. If sign-up fails only in the web preview, inspect the browser's API preflight and exact Origin before attributing the problem to native authentication or the production database.
