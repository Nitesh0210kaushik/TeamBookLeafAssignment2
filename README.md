# BookLeaf Publishing — Technical Assignment 2

This project is a no-code royalty-summary application built with Bubble and n8n.
It gives authors a private dashboard for their books and royalty status, and gives
administrators tools to review authors and request royalty summaries.

## Live application

Bubble test application:

https://nitesh2kaushik.bubbleapps.io/version-test/

Test credentials should be shared privately with the reviewer. They are not stored
in this repository.

## Main features

- Author signup and login.
- Separate author and admin navigation.
- Author dashboard with book, sales, earned, paid, and pending royalty data.
- Royalty status states including Paid up, Pending, Overdue, and In production.
- Admin author directory with search/filter controls and author details.
- Book and author privacy rules so authors only see their own records.
- NotificationLog records for Processing, Success, and Failed states.
- n8n workflow for validation, duplicate-request protection, royalty calculations,
  AI email generation, and success/failure callbacks.
- Sample data for ten authors and their books.

## Repository structure

```text
data/bookleaf_sample_data.json       Supplied sample authors and books
n8n/royalty-summary.workflow.json    19-node n8n workflow export
n8n/code/                            Reusable n8n Code node logic
prompts/royalty-summary.md           AI prompt and royalty communication policy
scripts/test-n8n-code.mjs            Local workflow-code test runner
scripts/build-n8n-workflow.mjs       Rebuilds the n8n JSON export
scripts/import-to-bubble.mjs         Optional Bubble data-import helper
.env.example                         Environment-variable template
```

## Local verification

Requirements: Node.js 18 or newer.

Run the workflow-code tests:

```powershell
node scripts/test-n8n-code.mjs
```

Regenerate the n8n workflow export:

```powershell
node scripts/build-n8n-workflow.mjs
```

The test runner covers all ten sample authors, royalty-status calculations,
invalid input, duplicate requests, AI-output parsing, and failure formatting.

## Bubble setup

1. Open the live test application or the Bubble editor.
2. Confirm that the supplied sample data is loaded.
3. Confirm that the `Author`, `Book`, and `NotificationLog` data types exist.
4. Confirm that author privacy rules restrict records to the current author.
5. Use the admin account to review authors and open an author detail page.

## n8n setup

1. Import `n8n/royalty-summary.workflow.json` into n8n Cloud.
2. Configure the Bubble bearer credential directly in n8n.
3. Configure a separate AI-provider credential directly in n8n.
4. Configure the Bubble webhook/API action with the n8n production URL.
5. Activate the workflow and verify the webhook execution.

Credentials are intentionally not embedded in the workflow JSON or source code.

## Environment variables

Copy the template before running any local import helper:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`. The real Bubble token, n8n webhook key, AI key, passwords,
and private API credentials must remain in local environment files or the relevant
service credential managers.

## Assumptions

- Royalty calculations follow the supplied BookLeaf knowledge base.
- Royalties below the minimum payout threshold roll over to the next cycle.
- The Bubble test application and n8n Cloud workflow are hosted services and are
  configured outside this repository.
- The repository contains the reproducible workflow and test logic; service secrets
  are provided separately to an authorised reviewer.

## Submission contents

Only project files required to reproduce or review the assignment should be pushed:

- Source workflow and Code node files.
- Sample data.
- Prompt and test scripts.
- `.env.example`, `.gitignore`, and this README.

Local secrets, screenshots, temporary files, editor files, and personal notes are
excluded from the submission.
