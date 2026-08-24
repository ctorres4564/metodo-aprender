import { randomUUID } from "node:crypto";
import {
  buildSyntheticPurchaseEvent,
  sendRedditConversion,
} from "../api/_lib/redditConversions.js";

const required = [
  "REDDIT_CAPI_ACCESS_TOKEN",
  "REDDIT_PIXEL_ID",
  "REDDIT_CAPI_TEST_ID",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Variáveis ausentes: ${missing.join(", ")}.`);
  process.exitCode = 1;
} else {
  const event = buildSyntheticPurchaseEvent(Date.now(), randomUUID());
  try {
    await sendRedditConversion({
      accessToken: process.env.REDDIT_CAPI_ACCESS_TOKEN,
      pixelId: process.env.REDDIT_PIXEL_ID,
      testId: process.env.REDDIT_CAPI_TEST_ID,
      event,
    });
    console.log("Purchase sintético aceito pelo Reddit Event Testing.");
    console.log(`conversion_id=${event.metadata.conversion_id}`);
  } catch (error) {
    console.error(`Falha no teste Reddit CAPI: ${error?.code || "request_failed"}.`);
    process.exitCode = 1;
  }
}
