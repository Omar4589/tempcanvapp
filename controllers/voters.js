import { Router } from "express";
import mongoose from "mongoose";
import { Voter } from "../models/Voter.js";

export const voters = Router();

// GET /api/voters?search=&limit=&cursor=&status=&sort=
// status: 'pending' | 'done' | 'all' (default 'all')
// sort:   'status' | 'street' | 'name'  (default 'status')
// Rule: DONE if household has ANY status != 'Unvisited' (or null/empty)
//       PENDING only if ALL are Unvisited/empty
voters.get("/voters", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const cursor = req.query.cursor
      ? new mongoose.Types.ObjectId(String(req.query.cursor))
      : null;
    const search = String(req.query.search ?? "").trim();
    const statusFilter = String(req.query.status ?? "all"); // pending|done|all
    const sortKey = String(req.query.sort ?? "status"); // status|street|name

    const match = {};
    if (cursor) match._id = { $gt: cursor };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { lastName: rx },
        { firstName: rx },
        { "address.line1": rx },
        { "address.city": rx },
        { householdId: rx },
      ];
    }

    const pipeline = [
      { $match: match },
      { $sort: { _id: 1 } },

      // Roll up by household
      {
        $group: {
          _id: "$householdId",
          docIds: { $push: "$_id" },
          membersCount: { $sum: 1 },
          address: { $first: "$address" },
          lat: { $first: "$latitude" },
          lng: { $first: "$longitude" },
          statuses: { $addToSet: "$lastStatus" }, // set of statuses across members
        },
      },

      // Flags
      {
        $addFields: {
          // any non-Unvisited present?
          hasVisited: {
            $gt: [
              {
                $size: {
                  $setDifference: ["$statuses", ["Unvisited", null, ""]],
                },
              },
              0,
            ],
          },
          hasSurveyed: { $in: ["Surveyed", "$statuses"] },
          hasBad: {
            $gt: [
              {
                $size: {
                  $setIntersection: [
                    "$statuses",
                    ["Refused", "Wrong Address", "Moved"],
                  ],
                },
              },
              0,
            ],
          },
          hasNotHome: { $in: ["Not Home", "$statuses"] },
        },
      },

      // Keep color scheme for map rings
      {
        $addFields: {
          statusColor: {
            $switch: {
              branches: [
                { case: "$hasBad", then: "Red" },
                { case: "$hasSurveyed", then: "Green" },
                { case: "$hasNotHome", then: "Blue" },
              ],
              default: "Gray",
            },
          },
        },
      },

      // Human bucket
      {
        $addFields: {
          statusLabel: { $cond: ["$hasVisited", "Done", "Pending"] },
        },
      },

      // Extract street name without leading number
      {
        $addFields: {
          _streetMatch: {
            $regexFind: { input: "$address.line1", regex: /^\s*\d+\s*(.*)$/ },
          },
        },
      },
      {
        $addFields: {
          streetName: {
            $cond: [
              {
                $gt: [
                  { $size: { $ifNull: ["$_streetMatch.captures", []] } },
                  0,
                ],
              },
              { $arrayElemAt: ["$_streetMatch.captures", 0] },
              "$address.line1",
            ],
          },
        },
      },

      // Optional filter
      ...(statusFilter === "pending" || statusFilter === "done"
        ? [
            {
              $match: {
                statusLabel: statusFilter === "pending" ? "Pending" : "Done",
              },
            },
          ]
        : []),

      // Final shape
      {
        $project: {
          _id: 0,
          householdId: "$_id",
          address: 1,
          coords: { lat: "$lat", lng: "$lng" },
          membersCount: 1,
          statusColor: 1,
          statusLabel: 1,
          streetName: 1,
          cursor: { $last: "$docIds" },
          // TEMP: keep statuses for quick verification in dev logs (not sent to client)
          _dbg_statuses: "$statuses",
        },
      },

      // Sorting
      (() => {
        if (sortKey === "street")
          return { $sort: { streetName: 1, householdId: 1 } };
        if (sortKey === "name")
          return { $sort: { "address.line1": 1, householdId: 1 } };
        // default: Pending first
        return {
          $addFields: {
            _statusOrder: {
              $cond: [{ $eq: ["$statusLabel", "Pending"] }, 0, 1],
            },
          },
        };
      })(),
      ...(sortKey === "status" || !["street", "name"].includes(sortKey)
        ? [{ $sort: { _statusOrder: 1, streetName: 1, householdId: 1 } }]
        : []),

      { $limit: limit },
    ];

    const rows = await Voter.aggregate(pipeline).exec();

    // quick console peek (dev only)
    if (process.env.NODE_ENV !== "production") {
      // log first 3 households’ statuses so you can see why they bucketed
      // (comment this out when you’re done)
      console.log(
        "[voters] sample statuses:",
        rows.slice(0, 3).map((r) => ({
          hh: r.householdId,
          statuses: r._dbg_statuses,
          label: r.statusLabel,
        }))
      );
    }

    const nextCursor = rows.length ? rows[rows.length - 1].cursor : null;
    // strip debug field before sending
    const clean = rows.map(({ _dbg_statuses, ...r }) => r);
    res.json({ ok: true, rows: clean, cursor: nextCursor });
  } catch (e) {
    next(e);
  }
});
