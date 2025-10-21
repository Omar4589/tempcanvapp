import { Schema, model } from 'mongoose';

const Address = new Schema(
  {
    line1: String,
    line2: String,
    city: String,
    state: String,
    zip: String
  },
  { _id: false }
);

const VoterSchema = new Schema(
  {
    vuid: { type: String, index: true, unique: true, sparse: true },
    householdId: { type: String, index: true },
    firstName: String,
    middleName: String,
    lastName: String,
    address: Address,
    latitude: Number,
    longitude: Number,
    precinct: String,
    county: String,
    party: String,
    age: Number,
    sex: String,
    lastStatus: { type: String, default: 'Unvisited' },
    lastUpdatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

VoterSchema.index({ 'address.city': 1, lastName: 1 });
VoterSchema.index({ householdId: 1 });

export const Voter = model('voters', VoterSchema);
