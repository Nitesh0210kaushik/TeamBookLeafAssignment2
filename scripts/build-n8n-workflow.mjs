/**
 * Builds n8n/royalty-summary.workflow.json from the Code node sources in n8n/code/ and the
 * system prompt in prompts/royalty-summary.md, so the JavaScript stays readable and testable.
 *
 *   node scripts/build-n8n-workflow.mjs
 *
 * The generated file contains credential placeholders only; credentials are chosen in n8n
 * after import.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AI_MODEL = "openai/gpt-oss-120b";
const AI_URL = "https://api.groq.com/openai/v1/chat/completions";

const code = (file) => readFileSync(join(ROOT, "n8n", "code", file), "utf8");

export function systemPrompt() {
  const markdown = readFileSync(join(ROOT, "prompts", "royalty-summary.md"), "utf8");
  const match = markdown.match(/## System prompt\s+```text\n([\s\S]*?)\n```/);
  if (!match) throw new Error("System prompt block not found in prompts/royalty-summary.md");
  return match[1];
}

const buildFactsCode = () =>
  `const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt())};\nconst AI_MODEL = ${JSON.stringify(AI_MODEL)};\n\n${code("build-facts.js")}`;

const codeNode = (name, jsCode, position, extra = {}) => ({
  parameters: { jsCode },
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  ...extra,
});

const respondNode = (name, statusCode, position) => ({
  parameters: {
    respondWith: "json",
    responseBody: "={{ JSON.stringify($json) }}",
    options: { responseCode: statusCode },
  },
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position,
});

const ifNode = (name, leftValue, position) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [
        {
          id: `${name}-condition`,
          leftValue,
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position,
});

const nodes = [
  {
    parameters: {
      httpMethod: "POST",
      path: "bookleaf-royalty-summary",
      authentication: "headerAuth",
      responseMode: "responseNode",
      options: {},
    },
    name: "Webhook (from Bubble)",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 300],
    webhookId: "bookleaf-royalty-summary",
    credentials: { httpHeaderAuth: { id: "", name: "BookLeaf X-API-Key" } },
  },
  codeNode("Validate input", code("validate-input.js"), [220, 300]),
  ifNode("Input valid?", "={{ $json.valid }}", [440, 300]),
  respondNode("Respond 400 (invalid input)", 400, [660, 500]),
  codeNode("Deduplicate request", code("deduplicate.js"), [660, 200]),
  ifNode("Duplicate?", "={{ $json.duplicate }}", [880, 200]),
  {
    ...respondNode("Respond 409 (duplicate)", 409, [1100, 40]),
    parameters: {
      respondWith: "json",
      responseBody:
        '={{ JSON.stringify({ status: "Failed", request_id: $json.request_id, error: "A summary for this author was requested moments ago. Duplicate ignored." }) }}',
      options: { responseCode: 409 },
    },
  },
  {
    parameters: {
      method: "GET",
      url: "=https://nitesh2kaushik.bubbleapps.io/api/1.1/obj/author?constraints={{ encodeURIComponent(JSON.stringify([{ key: 'author_id', constraint_type: 'equals', value: $json.author.author_id }])) }}",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: { timeout: 15000 },
    },
    name: "Fetch author (Bubble API)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1100, 260],
    credentials: { httpHeaderAuth: { id: "", name: "BookLeaf Bubble API" } },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: "continueErrorOutput",
    notes: "Requires Bubble Data API access and the BookLeaf Bubble API Bearer credential.",
  },
  {
    parameters: {
      method: "GET",
      url: "=https://nitesh2kaushik.bubbleapps.io/api/1.1/obj/book?constraints={{ encodeURIComponent(JSON.stringify([{ key: 'author', constraint_type: 'equals', value: $('Fetch author (Bubble API)').first().json.response?.results?.[0]?._id ?? $('Fetch author (Bubble API)').first().json.results?.[0]?._id }])) }}",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: { timeout: 15000 },
    },
    name: "Fetch books (Bubble API)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1320, 260],
    credentials: { httpHeaderAuth: { id: "", name: "BookLeaf Bubble API" } },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: "continueErrorOutput",
    notes: "Fetches only books linked to the author returned by the previous Bubble API node.",
  },
  codeNode("Prepare fetched data", code("prepare-fetched-data.js"), [1540, 260], { onError: "continueErrorOutput" }),
  codeNode("Build royalty facts", buildFactsCode(), [1760, 260]),
  {
    parameters: {
      method: "POST",
      url: AI_URL,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.ai_request) }}",
      options: { timeout: 30000 },
    },
    name: "Generate email (AI)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1980, 260],
    credentials: { httpHeaderAuth: { id: "", name: "Groq API" } },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "continueErrorOutput",
  },
  codeNode("Parse AI output", code("parse-ai-output.js"), [2200, 200], {
    onError: "continueErrorOutput",
  }),
  {
    parameters: {
      fromEmail: "REPLACE_WITH_SENDER_EMAIL",
      toEmail: "REPLACE_WITH_YOUR_TEST_INBOX",
      subject: "={{ $json.subject }}",
      emailFormat: "text",
      text: "={{ $json.body }}",
      options: {},
    },
    name: "Send email (bonus)",
    type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1,
    position: [2420, 120],
    disabled: true,
    onError: "continueRegularOutput",
    notes:
      "Optional bonus. Add an SMTP credential, set a test inbox (never the dataset's real-looking author emails), then enable this node.",
  },
  {
    ...respondNode("Respond 202 (Accepted)", 202, [2860, 120]),
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify($('Parse AI output').first().json) }}",
      options: { responseCode: 202 },
    },
  },
  {
    parameters: {
      method: "PATCH",
      url: "=https://nitesh2kaushik.bubbleapps.io/api/1.1/obj/notificationlog/{{$json.log_id}}",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ status: $json.status, email_subject: $json.subject, email_body: $json.body, completed_at: $json.completed_at }) }}",
      options: { timeout: 15000 },
    },
    name: "Update NotificationLog (Success)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2640, 120],
    credentials: { httpHeaderAuth: { id: "", name: "BookLeaf Bubble API" } },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: "continueRegularOutput",
  },
  codeNode("Format failure", code("format-failure.js"), [2200, 520]),
  {
    parameters: {
      method: "PATCH",
      url: "=https://nitesh2kaushik.bubbleapps.io/api/1.1/obj/notificationlog/{{$json.log_id}}",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ status: 'Failed', error_message: $json.error, completed_at: $json.completed_at }) }}",
      options: { timeout: 15000 },
    },
    name: "Update NotificationLog (Failed)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2420, 520],
    credentials: { httpHeaderAuth: { id: "", name: "BookLeaf Bubble API" } },
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    onError: "continueRegularOutput",
  },
  respondNode("Respond 202 (Accepted — Failed result)", 202, [2860, 520]),
];

const to = (node, index = 0) => ({ node, type: "main", index });
const connections = {
  "Webhook (from Bubble)": { main: [[to("Validate input")]] },
  "Validate input": { main: [[to("Input valid?")]] },
  "Input valid?": { main: [[to("Deduplicate request")], [to("Respond 400 (invalid input)")]] },
  "Deduplicate request": { main: [[to("Duplicate?")]] },
  "Duplicate?": { main: [[to("Respond 409 (duplicate)")], [to("Fetch author (Bubble API)")]] },
  "Fetch author (Bubble API)": { main: [[to("Fetch books (Bubble API)")], [to("Format failure")]] },
  "Fetch books (Bubble API)": { main: [[to("Prepare fetched data")], [to("Format failure")]] },
  "Prepare fetched data": { main: [[to("Build royalty facts")], [to("Format failure")]] },
  "Build royalty facts": { main: [[to("Generate email (AI)")]] },
  "Generate email (AI)": { main: [[to("Parse AI output")], [to("Format failure")]] },
  "Parse AI output": { main: [[to("Update NotificationLog (Success)")], [to("Format failure")]] },
  "Update NotificationLog (Success)": { main: [[to("Respond 202 (Accepted)")]] },
  "Format failure": { main: [[to("Update NotificationLog (Failed)")]] },
  "Update NotificationLog (Failed)": { main: [[to("Respond 202 (Accepted — Failed result)")]] },
};

const workflow = {
  name: "BookLeaf Royalty Summary",
  nodes,
  connections,
  active: false,
  settings: { executionOrder: "v1" },
  tags: [],
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(ROOT, "n8n", "royalty-summary.workflow.json");
  writeFileSync(out, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(`Wrote ${out} (${nodes.length} nodes)`);
}
