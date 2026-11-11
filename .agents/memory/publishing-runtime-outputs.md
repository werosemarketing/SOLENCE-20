---
name: Publishing runtime outputs
description: Prevent missing compiled files and HTTP-port mismatches when publishing the Expo web/API server.
---

Keep required runtime outputs out of Git if appropriate, but do not exclude them from publishing. This project needs its compiled server, exported web app, and native manifests in the published image.

**Why:** A publish reached startup but crash-looped with a missing compiled server entry after runtime output directories were added to the publishing ignore file. Successful local compilation and browser tests had not caught the packaging error.

**How to apply:** Treat Git exclusions and publishing exclusions as different decisions. For publishing/configuration changes, validate the complete publishing build and production startup, including the exported HTML, JavaScript, and native manifest responses.

The production HTTP listener must match the port mapped to public HTTP, which can differ from the development backend port.

**Why:** The Expo development frontend and API use separate ports; reusing the development API port for the single production process leaves the public startup probe pointed at the wrong listener.

**How to apply:** Inspect the current public port mapping when changing production commands. A healthy development API alone is not evidence that the published startup probe can reach the app.
