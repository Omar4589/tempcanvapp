import { Schema, model } from 'mongoose';

const EventSchema = new Schema(
  {
    vuid: { type: String, index: true },
    householdId: { type: String, index: true },
    status: {
      type: String,
      enum: ['Surveyed', 'Not Home', 'Refused', 'Wrong Address', 'Moved']
    },
    surveyAnswers: { type: Schema.Types.Mixed, default: {} },
    notes: String,
    timestamp: { type: Date, required: true }, // client submit time
    serverReceivedAt: { type: Date, default: Date.now }, // server time
    deviceId: String,
    geo: { lat: Number, lng: Number },
    distanceMeters: Number,
    suspect: Boolean
  },
  { timestamps: true }
);

EventSchema.index({ serverReceivedAt: -1 });

export const Event = model('events', EventSchema);
