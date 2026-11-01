// Second line of defence against double clicks (Bubble already blocks a second trigger while a
// summary is processing). Remembers recent requests in the workflow's static data.
// Static data persists only for production (active webhook) executions, not manual test runs.
const REQUEST_TTL_MS = 10 * 60 * 1000;
const SAME_AUTHOR_WINDOW_MS = 60 * 1000;

const input = $input.first().json;
const memory = $getWorkflowStaticData("global");
memory.requests = memory.requests ?? {};
memory.authors = memory.authors ?? {};

const now = Date.now();
for (const store of [memory.requests, memory.authors]) {
  for (const [key, seenAt] of Object.entries(store)) {
    if (now - seenAt > REQUEST_TTL_MS) delete store[key];
  }
}

const authorId = input.author.author_id;
const duplicate =
  memory.requests[input.request_id] !== undefined ||
  (memory.authors[authorId] !== undefined && now - memory.authors[authorId] < SAME_AUTHOR_WINDOW_MS);

if (!duplicate) {
  memory.requests[input.request_id] = now;
  memory.authors[authorId] = now;
}

return [{ json: { ...input, duplicate } }];
