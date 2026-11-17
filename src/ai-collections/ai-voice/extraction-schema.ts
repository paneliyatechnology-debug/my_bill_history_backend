import { z } from "zod";

export const AiCollectionIntentEnum = z.enum([
  "PROMISE_TO_PAY",
  "ALREADY_PAID",
  "PAYMENT_REPORTED_UNVERIFIED",
  "REQUEST_MORE_TIME",
  "REQUEST_BANK_DETAILS",
  "REQUEST_UPI",
  "DISPUTED",
  "HUMAN_ASSISTANCE",
  "WRONG_NUMBER",
  "UNAVAILABLE",
  "OPT_OUT",
  "GENERAL_QUERY",
]);

export type AiCollectionIntent = z.infer<typeof AiCollectionIntentEnum>;

export const AiConversationTurnSchema = z.object({
  // Customer intent
  intent: AiCollectionIntentEnum,

  // Spoken reply to customer in their preferred language (Gujarati / Hindi / English)
  spokenReply: z.string().describe("Polite, concise response to be spoken to the customer"),

  // Extraction fields
  promised_amount: z.number().nullable().optional(),
  promised_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .nullable()
    .optional(),
  payment_method: z.string().nullable().optional(),
  payment_reference: z.string().nullable().optional(),
  customer_confirmed: z.boolean().default(false),
  dispute_reason: z.string().nullable().optional(),

  // Action flow
  needs_human_followup: z.boolean().default(false),
  next_action: z.enum([
    "CONTINUE_CONVERSATION",
    "CONFIRM_DATE",
    "SHARE_BANK_DETAILS",
    "SHARE_UPI",
    "SCHEDULE_FOLLOWUP",
    "CREATE_STAFF_TASK",
    "OPT_OUT_CUSTOMER",
    "END_CALL_RESOLVED",
    "END_CALL_UNRESOLVED",
  ]),
  is_final_turn: z.boolean().default(false),
  conversation_summary: z.string(),
  detected_language: z.enum(["gujarati", "hindi", "english"]).default("gujarati"),
});

export type AiConversationTurn = z.infer<typeof AiConversationTurnSchema>;

