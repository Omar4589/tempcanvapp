import { Router } from "express";
import { Voter } from "../models/Voter.js";

export const households = Router();

/** GET /api/households/:householdId */
// GET /api/households/:householdId
households.get("/households/:householdId", async (req, res, next) => {
  try {
    const hh = String(req.params.householdId);
    const members = await Voter.find({ householdId: hh })
      .select("vuid firstName middleName lastName age party sex lastStatus")
      .sort({ lastName: 1, firstName: 1 })
      .lean();

    if (!members.length) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, members });
  } catch (e) {
    next(e);
  }
});
