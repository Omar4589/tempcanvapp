import { Router } from "express";
export const health = Router();

health.get("/healthz", (_req, res) => {
  res.json({ ok: true, version: "0.1.0" });
});
