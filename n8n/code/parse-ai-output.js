// Turns the AI response into a clean { subject, body }. Throwing here sends the item to the
// node's error output, so a bad AI answer is reported to Bubble as Failed instead of being sent.
const response = $input.first().json;
const content = response.choices?.[0]?.message?.content;
if (typeof content !== "string" || !content.trim()) {
  throw new Error("The AI returned an empty response.");
}

let parsed;
try {
  parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
} catch {
  throw new Error("The AI response was not valid JSON.");
}

const plain = (value) =>
  String(value ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .trim();

const subject = plain(parsed.subject).slice(0, 150);
const body = plain(parsed.body);
if (!subject || body.length < 80) {
  throw new Error("The AI response was missing a subject or a complete email body.");
}

const context = $("Build royalty facts").first().json;
return [
  {
    json: {
      status: "Success",
      request_id: context.request_id,
      log_id: context.log_id,
      to: context.author.email,
      subject,
      body,
      completed_at: new Date().toISOString(),
    },
  },
];
