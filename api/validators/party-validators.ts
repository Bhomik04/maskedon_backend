import { z } from "zod/v4";

const partyBaseSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().max(5000).optional(),
  location_name: z.string().min(1, "Location is required").max(300),
  location_city: z.string().min(1, "City/district is required").max(100),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  date_time: z.string().min(1, "Date/time is required"),
  end_time: z.string().min(1, "End time is required"),
  ticket_price: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  min_rating: z.number().min(0).max(5).optional(),
  // Privacy & access
  is_private: z.boolean().optional(),
  allow_photos: z.boolean().optional(),
  // Party attributes
  food_type: z.enum(["veg", "non_veg", "vegan"]).optional(),
  allows_alcohol: z.boolean().optional(),
  allows_smoking: z.boolean().optional(),
  allows_other_substances: z.boolean().optional(),
  // Structured location
  location_country: z.string().max(100).optional(),
  location_state: z.string().max(100).optional(),
  location_district: z.string().max(100).optional(),
});

export const createPartySchema = partyBaseSchema.refine((data) => {
  return new Date(data.end_time) > new Date(data.date_time);
}, { message: "End time must be after start time" });

export const updatePartySchema = partyBaseSchema.partial();

export const requestActionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export const joinRequestSchema = z.object({
  message: z.string().max(500).optional(),
  tier_id: z.string().uuid("Invalid tier ID").optional().nullable(),
});

export const tierInputSchema = z.object({
  name: z.string().min(1, "Tier name is required").max(100),
  description: z.string().max(300).optional(),
  price: z.number().int().min(0, "Price must be 0 or more"),
  slots: z.number().int().min(1, "Slots must be at least 1").max(20).optional(),
  max_quantity: z.number().int().min(1).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
});

export const tiersArraySchema = z.array(tierInputSchema).min(1).max(20);

export const assignSlotSchema = z.object({
  username: z.string().min(1, "Username is required").max(50),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
export type RequestActionInput = z.infer<typeof requestActionSchema>;
export type JoinRequestInput = z.infer<typeof joinRequestSchema>;
export type TierInput = z.infer<typeof tierInputSchema>;
