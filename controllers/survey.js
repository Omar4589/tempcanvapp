import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cfgPath = path.join(__dirname, "../survey-config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));

export const survey = Router();
survey.get("/survey-config", (_req, res) => res.json(cfg));
