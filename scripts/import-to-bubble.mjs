/**
 * Imports data/bookleaf_sample_data.json into the Bubble database through the Data API.
 *
 * Requires a paid Bubble plan: on the free plan Bubble rejects every inbound API call with
 * 401 "This application does not expose an API", so the data was entered in the editor instead.
 *
 *   node scripts/import-to-bubble.mjs            # create or update everything
 *   node scripts/import-to-bubble.mjs --dry-run  # print what would be written, change nothing
 *
 * Safe to re-run: authors and books are matched on author_id / book_id and updated in place.
 * Derived fields (author totals, overdue dates) are computed here so Bubble searches can filter
 * on them directly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const OVERDUE_AFTER_DAYS = 90;
// Knowledge Base: balances under ₹1,000 roll over to the next quarter, so they are never overdue.
const PAYOUT_THRESHOLD_INR = 1000;

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env file: rely on real environment variables.
  }
  return env;
}

const env = loadEnv();
const APP_URL = env.BUBBLE_APP_URL?.replace(/\/$/, "");
const TOKEN = env.BUBBLE_API_TOKEN;
if (!APP_URL || (!TOKEN && !DRY_RUN)) {
  console.error("Set BUBBLE_APP_URL and BUBBLE_API_TOKEN in .env (see .env.example).");
  process.exit(1);
}
const API = `${APP_URL}/api/1.1/obj`;

async function bubble(method, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findOne(type, key, value) {
  const constraints = encodeURIComponent(
    JSON.stringify([{ key, constraint_type: "equals", value }]),
  );
  const data = await bubble("GET", `${type}?constraints=${constraints}`);
  return data.response.results[0] ?? null;
}

/** Creates the record, or updates the existing one with the same business id. Returns its Bubble id. */
async function upsert(type, key, fields) {
  if (DRY_RUN) {
    console.log(`[dry-run] upsert ${type} ${fields[key]}`, fields);
    return `dry-${fields[key]}`;
  }
  const existing = await findOne(type, key, fields[key]);
  if (existing) {
    await bubble("PATCH", `${type}/${existing._id}`, fields);
    return existing._id;
  }
  const created = await bubble("POST", type, fields);
  return created.id;
}

async function patch(type, id, fields) {
  if (DRY_RUN) {
    console.log(`[dry-run] patch ${type} ${id}`, fields);
    return;
  }
  await bubble("PATCH", `${type}/${id}`, fields);
}

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};
const toIso = (isoDate) => (isoDate ? new Date(`${isoDate}T00:00:00Z`).toISOString() : undefined);

/**
 * The date a book's pending royalty counts as overdue (brief: last payout older than 90 days,
 * or never paid for a published book older than 90 days). Undefined when nothing is due.
 */
function overdueFrom(book, authorPending) {
  if (!book.royalty_pending || !book.status.startsWith("Published")) return undefined;
  if (authorPending < PAYOUT_THRESHOLD_INR) return undefined;
  const since = book.last_royalty_payout_date ?? book.publication_date;
  return since ? addDays(since, OVERDUE_AFTER_DAYS) : undefined;
}

/** Bubble rejects null values, so empty fields are left out instead. */
const compact = (fields) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));

function bookFields(book, authorBubbleId, authorPending) {
  return compact({
    book_id: book.book_id,
    title: book.title,
    isbn: book.isbn,
    genre: book.genre,
    publication_date: toIso(book.publication_date),
    status: book.status,
    mrp: book.mrp,
    royalty_per_copy: book.author_royalty_per_copy,
    copies_sold: book.total_copies_sold,
    royalty_earned: book.total_royalty_earned,
    royalty_paid: book.royalty_paid,
    royalty_pending: book.royalty_pending,
    last_payout_date: toIso(book.last_royalty_payout_date),
    print_partner: book.print_partner,
    available_on: book.available_on,
    author: authorBubbleId,
    overdue_from: overdueFrom(book, authorPending),
  });
}

function authorTotals(books) {
  const sum = (key) => books.reduce((total, book) => total + (book[key] ?? 0), 0);
  const pending = sum("royalty_pending");
  const overdueDates = books
    .map((book) => overdueFrom(book, pending))
    .filter(Boolean)
    .sort();
  return compact({
    total_books: books.length,
    total_earned: sum("total_royalty_earned"),
    total_paid: sum("royalty_paid"),
    total_pending: pending,
    overdue_since: overdueDates[0],
  });
}

async function main() {
  const { authors } = JSON.parse(
    readFileSync(join(ROOT, "data", "bookleaf_sample_data.json"), "utf8"),
  );
  console.log(`Importing ${authors.length} authors into ${API}${DRY_RUN ? " (dry run)" : ""}`);

  let bookCount = 0;
  for (const author of authors) {
    const authorId = await upsert("author", "author_id", {
      author_id: author.author_id,
      name: author.name,
      email: author.email,
      phone: author.phone,
      city: author.city,
      joined_date: toIso(author.joined_date),
    });

    const totals = authorTotals(author.books);
    const bookIds = [];
    for (const book of author.books) {
      const fields = bookFields(book, authorId, totals.total_pending);
      bookIds.push(await upsert("book", "book_id", fields));
      bookCount += 1;
    }

    await patch("author", authorId, { books: bookIds, ...totals });
    console.log(`  ✔ ${author.author_id} ${author.name} (${author.books.length} books)`);
  }

  console.log(`Done: ${authors.length} authors, ${bookCount} books.`);
}

main().catch((error) => {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
});
