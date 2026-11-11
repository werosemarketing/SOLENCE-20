import express, { type Request, type Response } from "express";
import path from "node:path";

/** Serve an Expo web export without swallowing API or native asset requests. */
export function createWebAppRouter(webRoot: string) {
  const router = express.Router();
  const indexPath = path.resolve(webRoot, "index.html");
  router.use(express.static(webRoot, { index: false, maxAge: "1h" }));
  router.get(/.*/, (req: Request, res: Response, next) => {
    const reserved = /^\/(?:api|manifest|assets|_expo|ios|android)(?:\/|$)/;
    if (reserved.test(req.path) || path.extname(req.path) || !req.accepts("html")) {
      return next();
    }
    // Always revalidate the shell so new releases load their new bundle hashes.
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexPath);
  });
  return router;
}
