import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { format } from "@fast-csv/format";
import { Readable } from "node:stream";
import { Voter } from "../models/Voter.js";
import { Event } from "../models/Event.js";
import { deriveFallbackVuid } from "../utils/addressHash.js";

export const admin = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.CSV_MAX_BYTES || 5000000) },
});

admin.post(
  "/admin/upload-csv",
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file)
        return res.status(400).json({ ok: false, error: "file required" });

      const name = (req.file.originalname || "").toLowerCase();
      if (!name.endsWith(".csv"))
        return res.status(400).json({ ok: false, error: "expected .csv" });

      let inserted = 0,
        updated = 0,
        total = 0;

      const pick = (r, ks) => {
        for (const k of ks)
          if (r[k] && String(r[k]).trim()) return String(r[k]).trim();
        return "";
      };

      // detect delimiter automatically
      function detectDelimiter(sample) {
        const counts = {
          ",": (sample.match(/,/g) || []).length,
          "\t": (sample.match(/\t/g) || []).length,
          ";": (sample.match(/;/g) || []).length,
        };
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      }

      // sniff first 1k bytes of buffer to detect delimiter
      const sample = req.file.buffer.toString("utf8", 0, 1000);
      const delimiter = detectDelimiter(sample);

      // build parser with dynamic delimiter
      const parser = parse({
        columns: true,
        trim: true,
        skip_empty_lines: true,
        relax_quotes: true,
        delimiter,
      });

      parser.on("readable", async () => {
        let row;
        while ((row = parser.read())) {
          total++;

          // ✅ normalize all keys to lowercase
          const normalized = {};
          for (const [k, v] of Object.entries(row)) {
            normalized[k.toLowerCase()] = typeof v === "string" ? v.trim() : v;
          }

          // ✅ simplified pick: only use lowercase now
          const pick = (r, keys) => {
            for (const k of keys) {
              if (r[k] && String(r[k]).trim()) return String(r[k]).trim();
            }
            return "";
          };

          const vuid =
            pick(normalized, ["vuid"]) ||
            deriveFallbackVuid({
              first: pick(normalized, ["firstname"]),
              last: pick(normalized, ["lastname"]),
              line1: pick(normalized, [
                "registrationaddress1",
                "address1",
                "address",
              ]),
              city: pick(normalized, ["registrationaddresscity", "city"]),
              state: pick(normalized, ["registrationaddressstate", "state"]),
              zip: pick(normalized, ["registrationaddresszip5", "zip", "zip5"]),
            });

          const householdId =
            pick(normalized, ["householdid", "hhid"]) ||
            `${pick(normalized, ["registrationaddress1"])}|${pick(normalized, [
              "registrationaddresscity",
            ])}|${pick(normalized, ["registrationaddressstate"])}|${pick(
              normalized,
              ["registrationaddresszip5"]
            )}`.toLowerCase();

          const doc = {
            vuid,
            householdId,
            firstName: pick(normalized, ["firstname"]),
            middleName: pick(normalized, ["middlename"]),
            lastName: pick(normalized, ["lastname"]),
            address: {
              line1: pick(normalized, ["registrationaddress1", "address1"]),
              line2: pick(normalized, ["registrationaddress2", "address2"]),
              city: pick(normalized, ["registrationaddresscity", "city"]),
              state: pick(normalized, ["registrationaddressstate", "state"]),
              zip: pick(normalized, ["registrationaddresszip5", "zip", "zip5"]),
            },
            latitude: Number(pick(normalized, ["latitude"])) || undefined,
            longitude: Number(pick(normalized, ["longitude"])) || undefined,
            precinct: pick(normalized, ["precinct"]),
            county: pick(normalized, ["county"]),
            party: pick(normalized, ["party"]),
            age: Number(pick(normalized, ["age"])) || undefined,
            sex: pick(normalized, ["sex"]) || undefined,
          };

          const resu = await Voter.updateOne(
            { vuid },
            { $set: doc, $setOnInsert: { lastStatus: "Unvisited" } },
            { upsert: true }
          );
          if (resu.upsertedCount) inserted++;
          else updated++;
        }
      });

      parser.on("error", (err) => next(err));
      parser.on("end", () => res.json({ ok: true, total, inserted, updated }));
      Readable.from(req.file.buffer).pipe(parser);
    } catch (e) {
      next(e);
    }
  }
);

admin.get("/admin/export", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const match = {};
    if (from)
      match.serverReceivedAt = {
        ...(match.serverReceivedAt || {}),
        $gte: new Date(from),
      };
    if (to)
      match.serverReceivedAt = {
        ...(match.serverReceivedAt || {}),
        $lte: new Date(to),
      };

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="events_export.csv"'
    );

    const csv = format({ headers: true });
    csv.pipe(res);

    const cursor = Event.find(match).sort({ serverReceivedAt: 1 }).cursor();
    for await (const e of cursor) {
      const v = await (
        await import("../models/Voter.js")
      ).Voter.findOne({ vuid: e.vuid }).lean();
      csv.write({
        vuid: e.vuid,
        householdId: e.householdId,
        status: e.status,
        notes: e.notes || "",
        timestamp_client: e.timestamp?.toISOString(),
        timestamp_server: e.serverReceivedAt?.toISOString(),
        deviceId: e.deviceId,
        lat: e.geo?.lat,
        lng: e.geo?.lng,
        distanceMeters: e.distanceMeters,
        suspect: e.suspect ? 1 : 0,
        firstName: v?.firstName || "",
        lastName: v?.lastName || "",
        address1: v?.address?.line1 || "",
        city: v?.address?.city || "",
        state: v?.address?.state || "",
        zip: v?.address?.zip || "",
        precinct: v?.precinct || "",
        county: v?.county || "",
      });
    }
    csv.end();
  } catch (e) {
    next(e);
  }
});
