// Computes every number and date the email needs, then builds the AI request.
// Policy maths stays in code so the model only writes words (Knowledge Base, Assignment 1):
// royalties are calculated quarterly, paid within 45 days of the quarter ending, and balances
// below ₹1,000 roll over to the next quarter.
// SYSTEM_PROMPT and AI_MODEL are injected by scripts/build-n8n-workflow.mjs.
const PAYOUT_WINDOW_DAYS = 45;
const PAYOUT_THRESHOLD_INR = 1000;
const OVERDUE_AFTER_DAYS = 90;
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const input = $input.first().json;
const today = new Date();

const inr = (amount) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
const humanDate = (iso) => {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
const daysSince = (iso) => (iso ? Math.floor((today - new Date(`${iso}T00:00:00Z`)) / DAY_MS) : null);

function payoutSchedule() {
  const quarterOf = (date) => ({ year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 });
  const previous = ({ year, quarter }) => (quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 });
  const deadline = ({ year, quarter }) => new Date(Date.UTC(year, quarter * 3, 0) + PAYOUT_WINDOW_DAYS * DAY_MS);
  const label = ({ year, quarter }) => `Q${quarter} ${year} (${MONTHS[(quarter - 1) * 3]}–${MONTHS[(quarter - 1) * 3 + 2]})`;

  const current = quarterOf(today);
  const closed = previous(current);
  // Inside the 45-day window after a quarter closes, the next payout is for that closed quarter.
  const payoutQuarter = today <= deadline(closed) ? closed : current;
  return {
    payout_quarter: label(payoutQuarter),
    next_payout_by: humanDate(deadline(payoutQuarter).toISOString().slice(0, 10)),
  };
}

const books = input.books.map((book) => ({ ...book, published: book.status.startsWith("Published") }));
const sum = (key) => books.reduce((total, book) => total + book[key], 0);
const totalPending = sum("royalty_pending");
const meetsThreshold = totalPending >= PAYOUT_THRESHOLD_INR;

const overdue = (book) => {
  if (!book.published || book.royalty_pending <= 0 || !meetsThreshold) return false;
  const since = daysSince(book.last_payout_date ?? book.publication_date);
  return since !== null && since > OVERDUE_AFTER_DAYS;
};

const publishedBooks = books
  .filter((book) => book.published)
  .map((book) => ({
    title: book.title,
    copies_sold: book.copies_sold,
    royalty_earned: inr(book.royalty_earned),
    royalty_paid: inr(book.royalty_paid),
    royalty_pending: inr(book.royalty_pending),
    last_payout: humanDate(book.last_payout_date) ?? "No payout made yet",
    overdue: overdue(book),
  }));
const productionBooks = books
  .filter((book) => !book.published)
  .map((book) => ({ title: book.title, status: book.status }));

let situation;
if (publishedBooks.length === 0) situation = "no_published_books";
else if (totalPending === 0) situation = "all_paid";
else if (!meetsThreshold) situation = "below_threshold";
else if (publishedBooks.some((book) => book.overdue)) situation = "overdue";
else situation = "pending_in_cycle";

const facts = {
  author_first_name: input.author.name.split(/\s+/)[0],
  situation,
  totals: {
    published_books: publishedBooks.length,
    copies_sold: sum("copies_sold"),
    total_earned: inr(sum("royalty_earned")),
    total_paid: inr(sum("royalty_paid")),
    total_pending: inr(totalPending),
  },
  payout: {
    threshold: inr(PAYOUT_THRESHOLD_INR),
    meets_threshold: meetsThreshold,
    ...payoutSchedule(),
  },
  published_books: publishedBooks,
  books_in_production: productionBooks,
};

const aiRequest = {
  model: AI_MODEL,
  temperature: 0.3,
  max_completion_tokens: 2000,
  reasoning_effort: "low",
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `<royalty_facts>\n${JSON.stringify(facts, null, 2)}\n</royalty_facts>` },
  ],
};

return [{ json: { request_id: input.request_id, log_id: input.log_id, author: input.author, facts, ai_request: aiRequest } }];
