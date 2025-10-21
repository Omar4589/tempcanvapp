import { Router } from 'express';
import mongoose from 'mongoose';
import { Voter } from '../models/Voter.js';

export const voters = Router();

/**
 * GET /api/voters?search=&limit=&cursor=
 * Returns household rollups for list/map:
 * { householdId, address, coords, membersCount, lastStatus (as color) }
 */
voters.get('/voters', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const cursor = req.query.cursor ? new mongoose.Types.ObjectId(String(req.query.cursor)) : null;
    const search = String(req.query.search ?? '').trim();

    const match = {};
    if (cursor) match._id = { $gt: cursor };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [
        { lastName: rx },
        { firstName: rx },
        { 'address.line1': rx },
        { 'address.city': rx },
        { householdId: rx }
      ];
    }

    const pipeline = [
      { $match: match },
      { $sort: { _id: 1 } },
      {
        $group: {
          _id: '$householdId',
          docIds: { $push: '$_id' },
          membersCount: { $sum: 1 },
          address: { $first: '$address' },
          lat: { $first: '$latitude' },
          lng: { $first: '$longitude' },
          statuses: { $addToSet: '$lastStatus' }
        }
      },
      {
        $project: {
          _id: 0,
          householdId: '$_id',
          address: 1,
          coords: { lat: '$lat', lng: '$lng' },
          membersCount: 1,
          lastStatus: {
            $switch: {
              branches: [
                {
                  case: {
                    $gt: [
                      { $size: { $setIntersection: ['$statuses', ['Refused', 'Wrong Address', 'Moved']] } },
                      0
                    ]
                  },
                  then: 'Red'
                },
                { case: { $in: ['Surveyed', '$statuses'] }, then: 'Green' },
                { case: { $in: ['Not Home', '$statuses'] }, then: 'Blue' }
              ],
              default: 'Gray'
            }
          },
          cursor: { $last: '$docIds' }
        }
      },
      { $limit: limit }
    ];

    const rows = await Voter.aggregate(pipeline).exec();
    const nextCursor = rows.length ? rows[rows.length - 1].cursor : null;
    res.json({ ok: true, rows, cursor: nextCursor });
  } catch (e) {
    next(e);
  }
});
