// Validates the webhook payload sent by Bubble and normalises it for the rest of the workflow.
// Bubble sends the author and their books in the request (the free plan blocks the Data API).
const body = $input.first().json.body ?? {};

const text = (value, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

let books = body.books;
if (typeof books === "string") {
  try {
    books = JSON.parse(books);
  } catch {
    books = null;
  }
}

const author = body.author ?? {};
const errors = [];
if (!text(body.request_id)) errors.push("request_id is required");
if (!text(body.log_id)) errors.push("log_id is required");
if (!text(author.author_id) && !text(body.author_id)) errors.push("author_id is required");
if (!Array.isArray(books) && body.books !== undefined) errors.push("books must be a JSON array");
else if (Array.isArray(books) && books.length > 50) errors.push("books cannot contain more than 50 items");

if (errors.length) {
  return [{ json: { valid: false, request_id: text(body.request_id), error: errors.join("; ") } }];
}

return [
  {
    json: {
      valid: true,
      request_id: text(body.request_id),
      log_id: text(body.log_id),
      author: {
        author_id: text(author.author_id || body.author_id),
        name: text(author.name, 120),
        email: text(author.email, 200),
      },
      books: (Array.isArray(books) ? books : []).map((book) => ({
        title: text(book.title, 200),
        status: text(book.status, 80),
        publication_date: isoDate(book.publication_date),
        copies_sold: number(book.copies_sold),
        royalty_earned: number(book.royalty_earned),
        royalty_paid: number(book.royalty_paid),
        royalty_pending: number(book.royalty_pending),
        last_payout_date: isoDate(book.last_payout_date),
      })),
    },
  },
];
