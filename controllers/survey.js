import { Router } from "express";
import cfg from "../survey-config.json" assert { type: "json" };

export const survey = Router();
survey.get("/survey-config", (_req, res) => res.json(cfg));
