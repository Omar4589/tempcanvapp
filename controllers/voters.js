import { Router } from "express";
import mongoose from "mongoose";
import { Voter } from "../models/Voter.js";

export const voters = Router();

// GET /api/voters?search=&limit=&cursor=&status=&sort=
// status: 'pending' | 'done' | 'all' (default 'all')
// sort:   'status' | 'street' | 'name'  (default 'status')
// Returns household rollups:
// { householdId, address, coords, membersCount, statusColor, statusLabel, streetName, cursor }
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

    // Build pipeline
    const pipeline = [
      { $match: match },
      { $sort: { _id: 1 } },

      // Household rollup
      {
        $group: {
          _id: "$householdId",
          docIds: { $push: "$_id" },
          membersCount: { $sum: 1 },
          address: { $first: "$address" },
          lat: { $first: "$latitude" },
          lng: { $first: "$longitude" },
          statuses: { $addToSet: "$lastStatus" },
          lastNames: { $addToSet: "$lastName" },
        },
      },

      // Compute color (legacy), label (human), and a pending/done bucket
      {
        $addFields: {
          statusColor: {
            $switch: {
              branches: [
                {
                  case: {
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
                  then: "Red",
                },
                { case: { $in: ["Surveyed", "$statuses"] }, then: "Green" },
                { case: { $in: ["Not Home", "$statuses"] }, then: "Blue" },
              ],
              default: "Gray",
            },
          },
        },
      },

      {
        $addFields: {
          // Human-friendly bucket
          statusLabel: {
            $switch: {
              branches: [
                // Done = any conclusive outcome (Green/Red) or explicitly Surveyed
                {
                  case: {
                    $or: [
                      { $in: ["Surveyed", "$statuses"] },
                      {
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
                    ],
                  },
                  then: "Done",
                },
                // Not Home is still pending work
                { case: { $in: ["Not Home", "$statuses"] }, then: "Pending" },
              ],
              // Unvisited/unknown → Pending
              default: "Pending",
            },
          },
        },
      },

      // Extract street name for sorting (drop leading number)
      {
        $addFields: {
          _streetMatch: {
            $regexFind: {
              input: "$address.line1",
              regex: /^\s*\d+\s*(.*)$/, // capture street without number
            },
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

      // Filter by pending/done if provided
      ...(statusFilter === "pending" || statusFilter === "done"
        ? [
            {
              $match: {
                statusLabel: statusFilter === "pending" ? "Pending" : "Done",
              },
            },
          ]
        : []),

      // Final projection
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
        },
      },

      // Sort
      (() => {
        if (sortKey === "street")
          return { $sort: { streetName: 1, householdId: 1 } };
        if (sortKey === "name")
          return { $sort: { "address.line1": 1, householdId: 1 } };
        // default sort: Pending first, then street
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
    const nextCursor = rows.length ? rows[rows.length - 1].cursor : null;
    res.json({ ok: true, rows, cursor: nextCursor });
  } catch (e) {
    next(e);
  }
});
