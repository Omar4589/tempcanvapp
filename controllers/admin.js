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
          const vuid =
            pick(row, ["vuid", "VUID"]) ||
            deriveFallbackVuid({
              first: pick(row, ["firstname", "FirstName"]),
              last: pick(row, ["lastname", "LastName"]),
              line1: pick(row, [
                "RegistrationAddress1",
                "address1",
                "Address1",
              ]),
              city: pick(row, ["RegistrationAddressCity", "city", "City"]),
              state: pick(row, ["RegistrationAddressState", "state", "State"]),
              zip: pick(row, ["RegistrationAddressZip5", "zip", "Zip", "Zip5"]),
            });

          const householdId =
            pick(row, ["householdid", "hhid", "HouseholdId", "HouseholdID"]) ||
            `${pick(row, ["RegistrationAddress1"])}|${pick(row, [
              "RegistrationAddressCity",
            ])}|${pick(row, ["RegistrationAddressState"])}|${pick(row, [
              "RegistrationAddressZip5",
            ])}`.toLowerCase();

          const doc = {
            vuid,
            householdId,
            firstName: pick(row, ["firstname", "FirstName"]),
            middleName: pick(row, ["middlename", "MiddleName"]),
            lastName: pick(row, ["lastname", "LastName"]),
            address: {
              line1: pick(row, [
                "RegistrationAddress1",
                "address1",
                "Address1",
              ]),
              line2: pick(row, [
                "RegistrationAddress2",
                "address2",
                "Address2",
              ]),
              city: pick(row, ["RegistrationAddressCity", "City"]),
              state: pick(row, ["RegistrationAddressState", "State"]),
              zip: pick(row, ["RegistrationAddressZip5", "Zip5", "Zip"]),
            },
            latitude: Number(pick(row, ["latitude", "Latitude"])) || undefined,
            longitude:
              Number(pick(row, ["longitude", "Longitude"])) || undefined,
            precinct: pick(row, ["precinct", "Precinct"]),
            county: pick(row, ["county", "County"]),
            party: pick(row, ["party", "Party"]),
            age: Number(pick(row, ["age", "Age"])) || undefined,
            sex: pick(row, ["sex", "Sex"]) || undefined,
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
