// Converts Bubble Data API responses into the same shape used by the free-plan
// webhook payload. This keeps all royalty calculations in Build royalty facts.
const input = $("Validate input").first().json;
const authorResponse = $("Fetch author (Bubble API)").first().json;
const booksResponse = $("Fetch books (Bubble API)").first().json;

const author = authorResponse.response ?? authorResponse;
const authorRecord = author.results?.[0] ?? author;
const bookRecords = booksResponse.response?.results ?? booksResponse.results ?? [];

const value = (record, key, fallback = "") => record?.[key] ?? fallback;
return [{
  json: {
    valid: true,
    request_id: input.request_id,
    log_id: input.log_id,
    author: {
      author_id: value(authorRecord, "author_id", input.author.author_id),
      name: value(authorRecord, "name", input.author.name),
      email: value(authorRecord, "email", input.author.email),
    },
    books: bookRecords.map((book) => ({
      title: value(book, "title"),
      status: value(book, "status"),
      publication_date: value(book, "publication_date"),
      copies_sold: value(book, "copies_sold", 0),
      royalty_earned: value(book, "royalty_earned", 0),
      royalty_paid: value(book, "royalty_paid", 0),
      royalty_pending: value(book, "royalty_pending", 0),
      last_payout_date: value(book, "last_payout_date"),
    })),
  },
}];
