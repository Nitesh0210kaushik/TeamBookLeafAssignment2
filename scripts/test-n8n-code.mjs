/**
 * Runs the n8n Code nodes from n8n/royalty-summary.workflow.json locally with a small stand-in for
 * the n8n runtime ($input, $, $getWorkflowStaticData), against every author in the dataset.
 *
 *   node scripts/test-n8n-code.mjs                # logic checks only
 *   GROQ_API_KEY=... node scripts/test-n8n-code.mjs --live AUTH003 AUTH008
 *                                                 # also generate real emails for those authors
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(readFileSync(join(ROOT, "n8n", "royalty-summary.workflow.json"), "utf8"));
const { authors } = JSON.parse(readFileSync(join(ROOT, "data", "bookleaf_sample_data.json"), "utf8"));

const staticData = {};
function runNode(name, json, previous = {}) {
  const node = workflow.nodes.find((n) => n.name === name);
  const run = new Function("$input", "$", "$getWorkflowStaticData", node.parameters.jsCode);
  const $input = { first: () => ({ json }) };
  const $ = (nodeName) => ({ first: () => ({ json: previous[nodeName] }) });
  return run($input, $, () => staticData)[0].json;
}

/** The webhook body Bubble sends for one author (same shape as the API Connector call). */
function bubblePayload(author, requestId) {
  return {
    body: {
      request_id: requestId,
      log_id: `log-${author.author_id}`,
      author: { author_id: author.author_id, name: author.name, email: author.email },
      books: author.books.map((b) => ({
        title: b.title,
        status: b.status,
        publication_date: b.publication_date,
        copies_sold: b.total_copies_sold,
        royalty_earned: b.total_royalty_earned,
        royalty_paid: b.royalty_paid,
        royalty_pending: b.royalty_pending,
        last_payout_date: b.last_royalty_payout_date,
      })),
    },
  };
}

// 1. Every author flows through validate → deduplicate → facts.
const factsByAuthor = {};
for (const author of authors) {
  const validated = runNode("Validate input", bubblePayload(author, `req-${author.author_id}`));
  assert.equal(validated.valid, true, `${author.author_id} should be valid`);
  const deduped = runNode("Deduplicate request", validated);
  assert.equal(deduped.duplicate, false);
  const built = runNode("Build royalty facts", deduped);
  factsByAuthor[author.author_id] = built;
  const f = built.facts;
  console.log(
    `${author.author_id} ${author.name.padEnd(16)} ${f.situation.padEnd(18)} pending ${f.totals.total_pending.padEnd(8)} next payout ${f.payout.next_payout_by} (${f.payout.payout_quarter}) production: ${f.books_in_production.length}`,
  );
}
assert.equal(factsByAuthor.AUTH008.facts.situation, "all_paid");
assert.equal(factsByAuthor.AUTH009.facts.situation, "below_threshold");
assert.equal(factsByAuthor.AUTH003.facts.situation, "overdue");
assert.equal(factsByAuthor.AUTH007.facts.books_in_production.length, 1);
assert.ok(factsByAuthor.AUTH001.facts.totals.total_earned.startsWith("₹"));

// 2. Duplicates: same request id, and the same author again within a minute.
const priya = bubblePayload(authors[0], "req-AUTH001");
assert.equal(runNode("Deduplicate request", runNode("Validate input", priya)).duplicate, true);
const priyaAgain = bubblePayload(authors[0], "req-AUTH001-second-click");
assert.equal(runNode("Deduplicate request", runNode("Validate input", priyaAgain)).duplicate, true);

// 3. Invalid input.
const invalid = runNode("Validate input", { body: { author: {}, books: "not json" } });
assert.equal(invalid.valid, false);
assert.match(invalid.error, /request_id is required/);
const booksAsText = bubblePayload(authors[1], "req-text");
booksAsText.body.books = JSON.stringify(booksAsText.body.books);
assert.equal(runNode("Validate input", booksAsText).valid, true, "books may arrive as JSON text");

// 4. AI output parsing.
const context = { "Build royalty facts": factsByAuthor.AUTH001 };
const aiReply = (content) => ({ choices: [{ message: { content } }] });
const good = runNode(
  "Parse AI output",
  aiReply('```json\n{"subject":"Your royalty update","body":"' + "Hi Priya, **here** is your update. ".repeat(5) + '"}\n```'),
  context,
);
assert.equal(good.status, "Success");
assert.ok(!good.body.includes("**"), "markdown emphasis is stripped");
for (const bad of ["", "not json", '{"subject":"","body":"short"}']) {
  assert.throws(() => runNode("Parse AI output", aiReply(bad), context));
}

// 5. Failure messages stay short and safe.
const failure = (error) => runNode("Format failure", { error }, { "Validate input": { request_id: "req-x" } });
assert.match(failure({ message: "timeout of 30000ms exceeded" }).error, /timed out/);
assert.match(failure({ message: "Too many requests", httpCode: "429" }).error, /rate limit/);
assert.match(failure({ message: "Unauthorized", httpCode: "401" }).error, /credential/);
assert.equal(failure("The AI response was not valid JSON.").status, "Failed");

console.log("\nAll n8n Code node checks passed.");

// Optional: real emails from the AI for chosen authors.
const liveIndex = process.argv.indexOf("--live");
if (liveIndex !== -1) {
  const key = process.env.GROQ_API_KEY;
  assert.ok(key, "Set GROQ_API_KEY to run --live");
  const aiNode = workflow.nodes.find((n) => n.name === "Generate email (AI)");
  for (const authorId of process.argv.slice(liveIndex + 1)) {
    const built = factsByAuthor[authorId];
    const res = await fetch(aiNode.parameters.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(built.ai_request),
    });
    const json = await res.json();
    if (!res.ok) {
      console.log(`\n${authorId}: AI error ${res.status}`, runNode("Format failure", { error: { message: json.error?.message, httpCode: String(res.status) } }, { "Validate input": built }));
      continue;
    }
    const email = runNode("Parse AI output", json, { "Build royalty facts": built });
    console.log(`\n===== ${authorId} (${built.facts.situation}) =====\nSubject: ${email.subject}\n\n${email.body}`);
  }
}
