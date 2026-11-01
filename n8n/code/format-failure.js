// Builds the Failed response for Bubble from any error branch. Only a short, safe message is
// returned: no API keys, headers or raw provider responses.
const item = $input.first().json;
const raw = item.error;
const detail = typeof raw === "string" ? raw : (raw?.message ?? item.message ?? "");
const httpCode = raw?.httpCode ?? raw?.status ?? raw?.cause?.status;

let error;
if (/timeout|timed out|ETIMEDOUT/i.test(detail)) error = "The AI service timed out. Please try again.";
else if (String(httpCode) === "429" || /rate limit/i.test(detail)) error = "The AI service is busy (rate limit). Please try again in a minute.";
else if (["401", "403"].includes(String(httpCode))) error = "The AI service rejected the request (check the AI credential in n8n).";
else if (/AI (returned|response)/.test(detail)) error = detail;
else error = httpCode ? `The AI service failed (HTTP ${httpCode}).` : "The royalty summary could not be generated.";

let requestId = "";
let logId = "";
try {
  const validated = $("Validate input").first().json;
  requestId = validated.request_id;
  logId = validated.log_id;
} catch {
  // The failure happened before the input was read.
}

return [{ json: { status: "Failed", request_id: requestId, log_id: logId, error, completed_at: new Date().toISOString() } }];
