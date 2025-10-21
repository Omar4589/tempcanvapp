import { Router } from "express";
import { health } from "./health.js";
import { survey } from "./survey.js";
import { voters } from "./voters.js";
import { households } from "./households.js";
import { events } from "./events.js";
import { admin } from "./admin.js";

export const api = Router();
api.use(health);
api.use(survey);
api.use(voters);
api.use(households);
api.use(events);
api.use(admin);
