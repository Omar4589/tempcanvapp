import { Router } from "express";
import { z } from "zod";
import { Voter } from "../models/Voter.js";
import { Event } from "../models/Event.js";
import { haversineMeters } from "../utils/haversine.js";

export const events = Router();

const EventBody = z.object({
  vuid: z.string().min(1),
  householdId: z.string().min(1),
  status: z.enum(["Surveyed", "Not Home", "Refused", "Wrong Address", "Moved"]),
  surveyAnswers: z.record(z.any()).optional().default({}),
  notes: z.string().max(2000).optional(),
  timestamp: z.string().datetime(),
  deviceId: z.string().min(1),
  geo: z.object({ lat: z.number(), lng: z.number() }),
});

events.post("/events", async (req, res, next) => {
  try {
    console.log("🔥 RAW EVENT BODY:", req.body);

    const body = EventBody.parse(req.body);
    const voter = await Voter.findOne({ vuid: body.vuid }).lean();

    if (
      !voter ||
      typeof voter.latitude !== "number" ||
      typeof voter.longitude !== "number"
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Voter not found or missing coords" });
    }

    const threshold = Number(process.env.SUSPECT_DISTANCE_M || 75);
    const distance = haversineMeters(
      voter.latitude,
      voter.longitude,
      body.geo.lat,
      body.geo.lng
    );
    const suspect = distance > threshold;

    // 🧠 Check if there’s already an event for this voter
    const existing = await Event.findOne({ vuid: body.vuid });

    // 🕐 Prevent overwriting newer data with stale syncs
    if (existing && new Date(existing.timestamp) > new Date(body.timestamp)) {
      console.log(
        `⚠️ Ignored stale event for ${body.vuid} (existing newer at ${existing.timestamp})`
      );
      return res.json({
        ok: true,
        ignored: true,
        message: "Older event ignored",
      });
    }

    // 🔁 Create or overwrite (upsert) the event
    const evt = await Event.findOneAndUpdate(
      { vuid: body.vuid },
      {
        $set: {
          vuid: body.vuid,
          householdId: body.householdId,
          status: body.status,
          surveyAnswers: body.surveyAnswers,
          notes: body.notes,
          timestamp: new Date(body.timestamp),
          serverReceivedAt: new Date(),
          deviceId: body.deviceId,
          geo: body.geo,
          distanceMeters: Math.round(distance),
          suspect,
        },
      },
      { upsert: true, new: true }
    );

    // 🗳️ Update Voter’s last known status
    await Voter.updateOne(
      { vuid: body.vuid },
      { $set: { lastStatus: body.status, lastUpdatedAt: new Date() } }
    );

    res.json({
      ok: true,
      upserted: true,
      suspect,
      distanceMeters: evt.distanceMeters,
    });
  } catch (e) {
    next(e);
  }
});
